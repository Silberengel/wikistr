<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent, Event } from '@nostr/tools/pure';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { wot, userWikiRelays } from '$lib/nostr';
  import type { Card, BookCard, ArticleCard } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique, formatRelativeTime } from '$lib/utils';
  import { relayService } from '$lib/relayService';
  import { 
    parseBookWikilink, 
    generateBookSearchQuery, 
    isBookEvent, 
    extractBookMetadata, 
    generateBookTitle,
    formatBookReference,
    type BookReference,
    type BookEvent,
    BOOK_TYPES
  } from '$lib/books';
  import { parseBookWikilink as parseBookWikilinkNKBIP08, type ParsedBookReference } from '$lib/bookWikilinkParser';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { cards } from '$lib/state';

  export let card: Card;
  export let replaceSelf: (card: Card) => void;
  export let createChild: (card: Card) => void;

  let tried = false;
  let eosed = 0;
  let editable = false;
  let versionNotFound = false;
  let fallbackResults: BookEvent[] = [];

  const bookCard = card as BookCard;

  let query: string;
  let seenCache: { [id: string]: string[] } = {};
  let results: BookEvent[] = [];
  let parsedQuery: { references: BookReference[], version?: string, versions?: string[] } | null = null;

  // close handlers
  let uwrcancel: () => void;
  let subs: SubCloser[] = [];

  onMount(() => {
    query = bookCard.data;
    // Check if query is in new NKBIP-08 format (with or without brackets)
    let queryToParse = query;
    if (query.startsWith('book::')) {
      // Search bar format: book::... (no brackets)
      queryToParse = `[[${query}]]`; // Add brackets for parser
    } else if (query.match(/^\[\[book::/)) {
      // Wikilink format: [[book::...]] (already has brackets)
      queryToParse = query;
    }
    
    if (queryToParse.match(/^\[\[book::/)) {
      // New NKBIP-08 format: parse with NKBIP-08 parser
      const parsed = parseBookWikilinkNKBIP08(queryToParse);
      if (parsed && parsed.references.length > 0) {
        // Convert NKBIP-08 format to legacy format for compatibility
        const references: BookReference[] = parsed.references.map(ref => ({
          book: ref.title,
          chapter: ref.chapter ? parseInt(ref.chapter, 10) : undefined,
          verse: ref.section ? (ref.section.length === 1 ? ref.section[0] : ref.section.join(',')) : undefined
        }));
        parsedQuery = {
          references,
          versions: parsed.references[0]?.version
        };
        // Extract bookType from first reference if available
        if (parsed.references[0]?.collection) {
          bookCard.bookType = parsed.references[0].collection;
        }
      }
    } else {
      // Legacy format: use old parser
      parsedQuery = parseBookWikilink(query, bookCard.bookType);
    }
  });

  onMount(() => {
    // we won't do any searches if we already have the results
    if (bookCard.results) {
      seenCache = bookCard.seenCache || {};
      results = bookCard.results || [];

      tried = true;
      return;
    }

    performBookSearch();
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    // search operations are now handled by relayService
  }

  async function performBookSearch() {
    if (!parsedQuery) return;

    // cancel existing subscriptions and zero variables
    destroy();
    tried = false;
    eosed = 0;
    results = [];

    const update = debounce(() => {
      // sort by exact matches first, then by wotness
      results = results.sort((a, b) => {
        return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
      });
      seenCache = seenCache;
    }, 500);

    // Check cache first before making relay queries
    try {
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = await contentCache.getEvents('wiki');
      
      // Filter cached events for book events (kind 30040 and 30041)
      const bookCachedEvents = cachedEvents.filter(cached => 
        cached.event.kind === 30040 || cached.event.kind === 30041
      );
      
      if (bookCachedEvents.length > 0) {
        console.log(`Book: Found ${bookCachedEvents.length} cached book events, filtering...`);
        
        // Filter cached events that match our book query criteria
        for (const cached of bookCachedEvents) {
          const evt = cached.event as BookEvent;
          
          // Check if this event matches our book criteria
          if (isBookEvent(evt, bookCard.bookType) && matchesBookQuery(evt, parsedQuery!)) {
            // Track which relays returned this event
            cached.relays.forEach(relay => {
              if (!seenCache[evt.id]) seenCache[evt.id] = [];
              if (seenCache[evt.id].indexOf(relay) === -1) {
                seenCache[evt.id].push(relay);
              }
            });
            
            if (addUniqueTaggedReplaceable(results, evt)) update();
          }
        }
        
        if (results.length > 0) {
          console.log(`Book: Found ${results.length} matching events in cache`);
          tried = true;
          // Still query relays in background to get fresh results, but show cache immediately
        }
      }
    } catch (error) {
      console.error('Book: Failed to check cache:', error);
    }

    setTimeout(() => {
      tried = true;
    }, 1500);

    const relaysFromPreferredAuthors = unique(
      (await Promise.all(([]).map((pk) => loadRelayList(pk))))
        .map((rl) => rl.items)
        .flat()
        .filter((ri) => ri.write)
        .map((ri) => ri.url)
    );

    let previouslyQueriedRelays: string[] = [];
    uwrcancel = userWikiRelays.subscribe(async (uwr) => {
      const relaysToUseNow = [];

      for (let i = 0; i < uwr.length; i++) {
        let r = uwr[i];
        if (previouslyQueriedRelays.indexOf(r) === -1) {
          relaysToUseNow.push(r);
          previouslyQueriedRelays.push(r);
        }
      }

      for (let i = 0; i < relaysFromPreferredAuthors.length; i++) {
        let r = relaysFromPreferredAuthors[i];
        if (previouslyQueriedRelays.indexOf(r) === -1) {
          relaysToUseNow.push(r);
          previouslyQueriedRelays.push(r);
        }
      }

      if (relaysToUseNow.length === 0) return;

      // Build relay filters using C, T, c, s, v tags (NKBIP-08 format)
      // Query both kind 30040 (index) and 30041 (content) events
      const filters: any[] = [];
      
      for (const ref of parsedQuery!.references) {
        const filter: any = {
          kinds: [30040, 30041],
          limit: 25
        };
        
        // C tag: collection (e.g., "bible")
        if (bookCard.bookType) {
          filter['#C'] = [bookCard.bookType];
        }
        
        // T tag: title/book name (normalized using NIP-54)
        if (ref.book) {
          // Normalize book name using NIP-54 rules: lowercase, replace non-alphanumeric with hyphens
          const normalizedBook = normalizeIdentifier(ref.book);
          filter['#T'] = [normalizedBook];
        }
        
        // c tag: chapter
        if (ref.chapter) {
          filter['#c'] = [ref.chapter.toString()];
        }
        
        // s tag: section/verse
        if (ref.verse) {
          // Handle verse ranges and multiple verses
          const verses = ref.verse.split(/[,\s]+/).filter(v => v.trim());
          filter['#s'] = verses;
        }
        
        // v tag: version
        if (parsedQuery!.version) {
          filter['#v'] = [parsedQuery!.version.toLowerCase()];
        } else if (parsedQuery!.versions && parsedQuery!.versions.length > 0) {
          filter['#v'] = parsedQuery!.versions.map(v => v.toLowerCase());
        }
        
        filters.push(filter);
      }
      
      // Use relayService for book search with tag filters
      try {
        const result = await relayService.queryEvents(
          'anonymous',
          'social-read',
          filters,
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );

        tried = true;
        for (const evt of result.events) {
          // Check if this event matches our book criteria
          if (isBookEvent(evt as BookEvent, bookCard.bookType) && matchesBookQuery(evt as BookEvent, parsedQuery!)) {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          }
        }
      } catch (error) {
        console.error('Failed to search for books:', error);
      }
    });

    function oneose() {
      eosed++;
      if (eosed >= 2) {
        tried = true;
        
        // If we were searching for a specific version and found no results, try fallback
        if (parsedQuery?.version && results.length === 0) {
          versionNotFound = true;
          performFallbackSearch();
        } else {
          bookCard.results = results;
          bookCard.seenCache = seenCache;
        }
      }
    }

    function receivedEvent(relay: AbstractRelay, id: string) {
      if (!(id in seenCache)) seenCache[id] = [];
      if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
    }
  }

  async function performFallbackSearch() {
    if (!parsedQuery) return;

    // Create a new query without the version specification
    const fallbackQuery = { references: parsedQuery.references, version: undefined, versions: undefined };
    
    // Build relay filters using C, T, c, s tags (without v tag for version)
    const filters: any[] = [];
    
    for (const ref of fallbackQuery.references) {
      const filter: any = {
        kinds: [30040, 30041],
        limit: 25
      };
      
      // C tag: collection (e.g., "bible")
      if (bookCard.bookType) {
        filter['#C'] = [bookCard.bookType];
      }
      
      // T tag: title/book name (normalized using NIP-54)
      if (ref.book) {
        const normalizedBook = normalizeIdentifier(ref.book);
        filter['#T'] = [normalizedBook];
      }
      
      // c tag: chapter
      if (ref.chapter) {
        filter['#c'] = [ref.chapter.toString()];
      }
      
      // s tag: section/verse
      if (ref.verse) {
        const verses = ref.verse.split(/[,\s]+/).filter(v => v.trim());
        filter['#s'] = verses;
      }
      
      // No v tag - search all versions
      
      filters.push(filter);
    }
    
    const fallbackUpdate = debounce(() => {
      fallbackResults = fallbackResults.sort((a, b) => {
        return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
      });
    }, 500);

    // Use relayService for fallback search with tag filters
    try {
      const fallbackResult = await relayService.queryEvents(
        'anonymous',
        'social-read',
        filters,
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );

      for (const evt of fallbackResult.events) {
        // Check if this event matches our book criteria (without version restriction)
        if (isBookEvent(evt as BookEvent, bookCard.bookType) && matchesBookQuery(evt as BookEvent, fallbackQuery)) {
          if (addUniqueTaggedReplaceable(fallbackResults, evt)) fallbackUpdate();
        }
      }

      // Update the main results with fallback results
      results = fallbackResults;
      bookCard.results = results;
      bookCard.seenCache = seenCache;
    } catch (error) {
      console.error('Failed to search for fallback books:', error);
    }
  }

  function matchesBookQuery(event: BookEvent, query: { references: BookReference[], version?: string }): boolean {
    const metadata = extractBookMetadata(event);
    
    // If a specific version is requested, check if this event matches that version
    if (query.version && metadata.version) {
      if (metadata.version.toLowerCase() !== query.version.toLowerCase()) {
        return false; // Version doesn't match
      }
    }
    
    // Check if any of the references match
    for (const ref of query.references) {
      if (metadata.book && ref.book.toLowerCase() === metadata.book.toLowerCase()) {
        if (ref.chapter && metadata.chapter && ref.chapter.toString() === metadata.chapter) {
          if (ref.verse && metadata.verse) {
            // Check if verses match (this is a simplified check)
            return metadata.verse.includes(ref.verse) || ref.verse.includes(metadata.verse);
          }
          return true; // Chapter matches
        }
        if (!ref.chapter) {
          return true; // Just book matches
        }
      }
    }
    
    return false;
  }

  function openBookEvent(result: BookEvent, ev?: MouseEvent) {
    // Open panels for ALL matching events from the search results
    // This allows viewing different versions, different sections, etc.
    const isMiddleClick = ev?.button === 1;
    
    // Create ArticleCard for each matching result
    for (let i = 0; i < results.length; i++) {
      const event = results[i];
      const dTag = getTagOr(event, 'd') || event.id;
      const pubkey = event.pubkey;
      const relayHints = seenCache[event.id] || [];
      
      const articleCard: ArticleCard = {
        id: next(),
        type: 'article',
        data: [dTag, pubkey],
        relayHints: relayHints,
        actualEvent: event // Pass the actual event so ArticleCard can use it immediately
      };
      
      if (i === 0) {
        // First event replaces current card or opens as child
        if (isMiddleClick) createChild(articleCard);
        else replaceSelf({ ...articleCard, back: card });
      } else {
        // Subsequent events always open as children (new panels)
        createChild(articleCard);
      }
    }
  }

  function startEditing() {
    debouncedPerformBookSearch.clear();
    editable = true;
  }

  function preventKeys(ev: KeyboardEvent) {
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      (ev.currentTarget as any)?.blur();
      finishedEditing();
    }
  }

  function finishedEditing() {
    if (!editable) return;

    editable = false;
    query = query.replace(/[\r\n]/g, '').replace(/[^\w .:-]/g, '-');
    if (query !== bookCard.data) {
      // replace browser url and history
      let index = $cards.findIndex((t) => t.id === card.id);
      let replacementURL = page.url.pathname.split('/').slice(1);
      replacementURL[index] = query;

      let currentState = page.state as [number, Card];
      replaceState('/' + replacementURL.join('/'), currentState[0] === index ? [] : currentState);

      // update stored card state
      bookCard.data = query;
      bookCard.results = undefined;

      // redo the query
      debouncedPerformBookSearch();
    }
  }

  const debouncedPerformBookSearch = debounce(performBookSearch, 400);

  // Get the display name for the book type
  const bookTypeDisplayName = BOOK_TYPES[bookCard.bookType || 'bible']?.displayName || (bookCard.bookType || 'bible').charAt(0).toUpperCase() + (bookCard.bookType || 'bible').slice(1);

  // Get examples for the book type
  const getExamples = () => {
    switch (bookCard.bookType) {
      case 'quran':
        return [
          'Al-Fatiha 1-7',
          'Al-Baqarah 2:255 | SAHIH',
          'Surah Al-Ikhlas',
          'Al-Fatiha 1-7 | SAHIH PICKTHALL'
        ];
      case 'catechism':
        return [
          'Article 1:1',
          'Part I:1',
          'Article 2:1-5 | CCC',
          'Part II:1 | YOUCAT'
        ];
      default: // bible
        return [
          'John 3:16',
          'John 3:16 | KJV',
          'Psalm 23:1',
          'Genesis 1:1 | KJV',
          'Revelation 11:15 | DRB',
          'Romans 1:16-25; Psalm 19:2-3',
          'Romans 1:16-25 | KJV DRB'
        ];
    }
  };
</script>

<div class="mt-2 font-bold text-4xl">
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="cursor-text"
    onclick={startEditing}
    onkeydown={preventKeys}
    role="textbox"
    tabindex="0"
  >
    {#if editable}
      <input
        bind:value={query}
        class="bg-transparent border-none outline-none w-full text-4xl font-bold"
        onblur={finishedEditing}
        onkeydown={preventKeys}
      />
    {:else}
      {query}
    {/if}
  </div>
</div>

{#if !tried && results.length === 0}
  <!-- Book Search Instructions -->
  <div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
    <h3 class="text-lg font-semibold text-espresso-900 mb-3">📖 {bookTypeDisplayName} Search</h3>
    <div class="text-sm text-espresso-800 space-y-2">
      <p><strong>Search for {bookTypeDisplayName.toLowerCase()} passages using standard notation:</strong></p>
      <div class="p-3 rounded border border-brown-300 font-mono text-xs space-y-1" style="background-color: var(--theme-bg);">
        {#each getExamples() as example}
          <div>{example}</div>
        {/each}
      </div>
      <p><strong>Supported formats:</strong></p>
      <ul class="text-xs text-espresso-700 ml-4 space-y-1">
        {#if bookCard.bookType === 'quran'}
          <li>• Single verse: <code>Al-Fatiha 1</code></li>
          <li>• Surah: <code>Al-Fatiha</code></li>
          <li>• Verse range: <code>Al-Fatiha 1-7</code></li>
          <li>• Multiple verses: <code>Al-Fatiha 1,3,5</code></li>
          <li>• With version: <code>Al-Fatiha 1-7 | SAHIH</code></li>
          <li>• Multiple versions: <code>Al-Fatiha 1-7 | SAHIH PICKTHALL</code></li>
        {:else if bookCard.bookType === 'catechism'}
          <li>• Single article: <code>Article 1:1</code></li>
          <li>• Part: <code>Part I</code></li>
          <li>• Article range: <code>Article 1:1-5</code></li>
          <li>• With version: <code>Article 1:1 | CCC</code></li>
          <li>• Multiple versions: <code>Article 1:1 | CCC YOUCAT</code></li>
        {:else}
          <li>• Single verse: <code>John 3:16</code></li>
          <li>• Chapter: <code>John 3</code></li>
          <li>• Book: <code>John</code></li>
          <li>• Verse range: <code>John 3:16-18</code></li>
          <li>• Multiple verses: <code>John 3:16,18</code></li>
          <li>• With version: <code>John 3:16 | KJV</code></li>
          <li>• Multiple references: <code>Romans 1:16-25; Psalm 19:2-3</code></li>
          <li>• Multiple versions: <code>Romans 1:16-25 | KJV DRB</code></li>
        {/if}
      </ul>
      <p class="text-xs text-espresso-600 mt-2">
        Use abbreviations where available. Case and whitespace are flexible: <code>john3:16</code> works the same as <code>John 3:16</code>
      </p>
      {#if bookCard.bookType === 'bible'}
        <p class="text-xs text-espresso-600 mt-2">
          <strong>Compare Bible versions:</strong> Use <code>diff::</code> prefix in the main search bar:
        </p>
        <div class="p-3 rounded border border-brown-300 font-mono text-xs mt-1" style="background-color: var(--theme-bg);">
          <div>diff::John 3:16 KJV | NIV</div>
          <div>diff::bible:Romans 1:16 KJV | ESV</div>
          <div>diff::Psalm 23:1 KJV | DRB</div>
        </div>
      {/if}
    </div>
  </div>
{:else if tried && results.length === 0 && !versionNotFound}
  <div class="mt-4 text-gray-500 italic">
    No {bookTypeDisplayName.toLowerCase()} passages found for "{query}"
  </div>
{:else if versionNotFound && results.length === 0}
  <div class="mt-4">
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
      <div class="flex items-center space-x-2 text-yellow-800">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
        </svg>
        <span class="font-medium">Version not found</span>
      </div>
      <div class="mt-2 text-sm text-yellow-700">
        The requested version "{parsedQuery?.version}" was not found. Showing all available versions instead.
      </div>
    </div>
    <div class="text-gray-500 italic">
      Searching for all versions of "{query.replace(/\s*\|\s*[^|]+\s*$/, '')}"...
    </div>
  </div>
{:else if results.length > 0}
  {#if versionNotFound}
    <div class="mt-4 mb-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div class="flex items-center space-x-2 text-blue-800">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
          </svg>
          <span class="font-medium">Showing all available versions</span>
        </div>
        <div class="mt-2 text-sm text-blue-700">
          The requested version "{parsedQuery?.version}" was not found. Here are all available versions:
        </div>
      </div>
    </div>
  {/if}
  <div class="mt-4 space-y-4">
    {#each results as result (result.id)}
      {@const metadata = extractBookMetadata(result)}
      {@const title = generateBookTitle(metadata)}
      <div 
        class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
        role="button"
        tabindex="0"
        onclick={(e) => openBookEvent(result, e)}
        onkeydown={(e) => e.key === 'Enter' && openBookEvent(result, undefined)}
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-blue-600 hover:text-blue-800">
              {title}
            </h3>
            <div class="text-sm text-gray-600 mt-1">
              by <span class="font-mono text-xs">{result.pubkey.slice(0, 8)}...</span>
              {#if result.created_at}
                • {formatRelativeTime(result.created_at)}
              {/if}
            </div>
            <div class="mt-2 text-sm text-gray-700 line-clamp-3">
              {result.content.slice(0, 200)}...
            </div>
          </div>
          <div class="ml-4 text-xs text-gray-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </div>
        </div>
      </div>
    {/each}
  </div>
{:else if !tried}
  <div class="mt-4 text-gray-500 italic">
    Searching for {bookTypeDisplayName.toLowerCase()} passages...
  </div>
{/if}

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
