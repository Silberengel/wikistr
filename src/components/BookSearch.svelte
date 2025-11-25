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
  import type { Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique, formatRelativeTime } from '$lib/utils';
  import { relayService } from '$lib/relayService';
  import { contentCache } from '$lib/contentCache';
  import { 
    generateBookSearchQuery,
    isBookEvent, 
    extractBookMetadata, 
    generateBookTitle,
    formatBookReference,
    type BookReference,
    type BookEvent,
    BOOK_TYPES
  } from '$lib/books';
  import { parseBookWikilink as parseBookWikilinkNKBIP08, bookReferenceToTags, type ParsedBookReference } from '$lib/bookWikilinkParser';
  import { generateBibleGatewayUrl, fetchBibleGatewayOg } from '$lib/bibleGatewayUtils';
  import BookFallbackCards from '$components/BookFallbackCards.svelte';
  import { generateBibleGatewayUrlForReference } from '$lib/bibleGatewayUtils';

  interface Props {
    query: string;
    bookType?: string;
    createChild: (card: Card) => void;
    onResults?: (results: BookEvent[]) => void;
  }

  let { query, bookType = 'bible', createChild, onResults }: Props = $props();

  let tried = $state(false);
  let eosed = 0;
  let seenCache: { [id: string]: string[] } = {};
  let results = $state<BookEvent[]>([]);
  let parsedQuery = $state<{ references: BookReference[], version?: string, versions?: string[] } | null>(null);
  let versionNotFound = $state(false);
  let fallbackResults = $state<BookEvent[]>([]);
  let ogPreview = $state<{ title?: string; description?: string; image?: string } | null>(null);
  let ogLoading = $state(false);
  let ogError = $state<string | null>(null);
  let ogLoadedQuery = $state('');
  // Individual reference OG previews (same as multi-reference layout)
  let referenceOgPreviews = $state<Map<string, { title?: string; description?: string; image?: string } | null>>(new Map());
  let referenceOgLoading = $state<Map<string, boolean>>(new Map());
  let referenceOgErrors = $state<Map<string, string | null>>(new Map());
  const bibleGatewayUrlForQuery = $derived.by(() => (bookType === 'bible' && parsedQuery ? generateBibleGatewayUrl(parsedQuery) : null));

  // close handlers
  let uwrcancel: () => void;
  let subs: SubCloser[] = [];

  onMount(async () => {
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
      // NKBIP-08 format: parse with NKBIP-08 parser
      const parsed = parseBookWikilinkNKBIP08(queryToParse);
      if (parsed && parsed.references.length > 0) {
        // Check if this is actually a valid book reference (has chapter:section)
        // If not, treat it as a publication identifier
        const hasChapterOrSection = parsed.references.some(ref => ref.chapter || (ref.section && ref.section.length > 0));
        
        if (!hasChapterOrSection) {
          // This is not a book reference, it's a publication identifier
          // Extract the identifier (everything after book::)
          const identifier = query.replace(/^book::/, '').trim();
          
          // Search for kind 30040 or 30041 events with this d-tag
          try {
            const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [{ kinds: [30040, 30041], '#d': [identifier] }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            
            if (result.events.length > 0) {
              const foundEvent = result.events[0];
              // Check if it has T tags (bookstr tags) - if so, it's a bookstr event
              const hasTTags = foundEvent.tags.some((tag: string[]) => tag[0] === 'T' || tag[0] === 't');
              
              if (hasTTags && (foundEvent.kind === 30040 || foundEvent.kind === 30041)) {
                // Bookstr event - open as book card
                const { openBookSearchCard } = await import('$lib/bookSearchLauncher');
                openBookSearchCard(`book::${identifier}`);
                return;
              } else {
                // Regular publication/article - open as article card
                const { getTagOr } = await import('$lib/utils');
                openOrCreateArticleCard({
                  type: 'article',
                  data: [getTagOr(foundEvent, 'd') || identifier, foundEvent.pubkey],
                  actualEvent: foundEvent,
                  relayHints: result.relays
                });
                return;
              }
            } else {
              // Event not found, but create article card anyway
              openOrCreateArticleCard({
                type: 'article',
                data: [identifier, ''],
                actualEvent: undefined,
                relayHints: []
              });
              return;
            }
          } catch (error) {
            console.error('Failed to search for publication:', error);
            // Fallback: create article card
            const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
            openOrCreateArticleCard({
              type: 'article',
              data: [identifier, ''],
              actualEvent: undefined,
              relayHints: []
            });
            return;
          }
        }
        
        // Valid book reference - proceed with book search
        // Convert NKBIP-08 format to BookReference format
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
          bookType = parsed.references[0].collection;
        }
        performBookSearch();
      } else {
        // Parsing failed - treat as publication identifier
        const identifier = query.replace(/^book::/, '').trim();
        try {
          const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
          const result = await relayService.queryEvents(
            'anonymous',
            'wiki-read',
            [{ kinds: [30040, 30041], '#d': [identifier] }],
            { excludeUserContent: false, currentUserPubkey: undefined }
          );
          
          if (result.events.length > 0) {
            const foundEvent = result.events[0];
            // Check if it has T tags (bookstr tags) - if so, it's a bookstr event
            const hasTTags = foundEvent.tags.some((tag: string[]) => tag[0] === 'T' || tag[0] === 't');
            
            if (hasTTags && (foundEvent.kind === 30040 || foundEvent.kind === 30041)) {
              // Bookstr event - open as book card
              const { openBookSearchCard } = await import('$lib/bookSearchLauncher');
              openBookSearchCard(`book::${identifier}`);
              return;
            } else {
              // Regular publication/article - open as article card
              const { getTagOr } = await import('$lib/utils');
              openOrCreateArticleCard({
                type: 'article',
                data: [getTagOr(foundEvent, 'd') || identifier, foundEvent.pubkey],
                actualEvent: foundEvent,
                relayHints: result.relays
              });
              return;
            }
          } else {
            openOrCreateArticleCard({
              type: 'article',
              data: [identifier, ''],
              actualEvent: undefined,
              relayHints: []
            });
            return;
          }
        } catch (error) {
          console.error('Failed to search for publication:', error);
          const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
          openOrCreateArticleCard({
            type: 'article',
            data: [identifier, ''],
            actualEvent: undefined,
            relayHints: []
          });
          return;
        }
      }
    } else {
      // Invalid format - query must start with book::
      console.warn('Book query must use book:: format, got:', query);
    }
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    // search is now handled by relayService
  }

  async function loadBibleGatewayPreview() {
    const targetUrl = generateBibleGatewayUrl(parsedQuery);
    console.log('BookSearch: loadBibleGatewayPreview', { query, targetUrl, bookType, tried, resultsLength: results.length, versionNotFound });
    
    if (!targetUrl) {
      console.log('BookSearch: No BibleGateway URL generated for query:', query);
      ogPreview = null;
      ogError = null;
      ogLoadedQuery = query;
      return;
    }

    if (ogLoadedQuery === query || ogLoading) {
      console.log('BookSearch: Skipping OG load - already loaded or loading', { ogLoadedQuery, query, ogLoading });
      return;
    }

    console.log('BookSearch: Loading OG preview from:', targetUrl);
    ogLoading = true;
    ogError = null;

    try {
      ogPreview = await fetchBibleGatewayOg(targetUrl);
      console.log('BookSearch: OG preview loaded:', ogPreview);
      ogLoadedQuery = query;
    } catch (error) {
      console.error('BookSearch: Failed to load OG preview:', error);
      ogError = (error as Error).message;
    } finally {
      ogLoading = false;
    }
  }

  $effect(() => {
    if (query && ogLoadedQuery !== query) {
      ogPreview = null;
      ogError = null;
    }
  });

  // Helper functions for individual reference OG previews (same as multi-reference layout)
  function getReferenceKey(ref: BookReference): string {
    return `${ref.book}:${ref.chapter}:${ref.verse || ''}`;
  }

  async function loadReferenceOgPreview(ref: BookReference) {
    const refKey = getReferenceKey(ref);
    if (referenceOgPreviews.has(refKey) || referenceOgLoading.get(refKey)) {
      return;
    }

    const targetUrl = generateBibleGatewayUrlForReference(ref);
    if (!targetUrl) {
      referenceOgErrors.set(refKey, 'Could not generate URL');
      return;
    }

    referenceOgLoading.set(refKey, true);
    referenceOgErrors.set(refKey, null);

    try {
      const preview = await fetchBibleGatewayOg(targetUrl);
      referenceOgPreviews.set(refKey, preview);
    } catch (error) {
      referenceOgErrors.set(refKey, (error as Error).message);
      referenceOgPreviews.set(refKey, null);
    } finally {
      referenceOgLoading.set(refKey, false);
    }
  }

  // Load OG previews for individual references when no results
  $effect(() => {
    if (!tried || results.length > 0 || !parsedQuery || !parsedQuery.references.length) return;
    
    // Load OG preview for each reference
    for (const ref of parsedQuery.references) {
      const refKey = getReferenceKey(ref);
      if (!referenceOgPreviews.has(refKey) && !referenceOgLoading.get(refKey)) {
        loadReferenceOgPreview(ref).catch(err => console.error('Failed to load reference OG:', err));
      }
    }
  });

  $effect(() => {
    const shouldLoad = query && ogLoadedQuery !== query && !ogLoading && bookType === 'bible' && tried && (results.length === 0 || versionNotFound);
    console.log('BookSearch: OG preview effect', { query, ogLoadedQuery, ogLoading, bookType, tried, resultsLength: results.length, versionNotFound, shouldLoad });
    if (shouldLoad) {
      loadBibleGatewayPreview();
    }
  });

  async function performBookSearch() {
    if (!parsedQuery) return;

    // cancel existing subscriptions and zero variables
    destroy();
    tried = false;
    eosed = 0;
    results = [];

    setTimeout(() => {
      tried = true;
    }, 1500);

    const update = debounce(() => {
      // sort by exact matches first, then by wotness
      results = results.sort((a, b) => {
        return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
      });
      seenCache = seenCache;
      
      if (onResults) {
        onResults(results);
      }
    }, 500);

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

      // Search for book events (kind 30041) with book tags
      const searchQueries = generateBookSearchQuery(parsedQuery!.references, bookType, parsedQuery!.version, parsedQuery!.versions);
      
      // Check cache first, then use relayService for book search
      try {
        let result;
        
        // First, try to get book events from cache
        const cachedBooks = await contentCache.getEvents('kind30041');
        const filteredBooks = cachedBooks.filter(cached => 
          cached.event.tags.some(tag => tag[0] === 'type' && tag[1] === bookType)
        );
        
        if (filteredBooks.length > 0) {
          result = {
            events: filteredBooks.map(cached => cached.event),
            relays: [...new Set(filteredBooks.flatMap(cached => cached.relays))]
          };
        } else {
          result = await relayService.queryEvents(
            'anonymous',
            'social-read',
            [{ kinds: [30041], '#type': [bookType], limit: 25 }],
            {
              excludeUserContent: false,
              currentUserPubkey: undefined
            }
          );
        }

        tried = true;
        for (const evt of result.events) {
          // Check if this event matches our book criteria
          if (isBookEvent(evt as BookEvent, bookType) && matchesBookQuery(evt as BookEvent, parsedQuery!, bookType)) {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          }
        }
      } catch (error) {
        console.error('Failed to search for books:', error);
      }
    });

    // Also search using general search for book-related content
    try {
      let searchResult;
      
      // First, try to get book events from cache using search
      const cachedBooks = await contentCache.getEvents('kind30041');
      const searchFilteredBooks = cachedBooks.filter(cached => 
        cached.event.content.toLowerCase().includes(query.toLowerCase()) ||
        cached.event.tags.some(tag => tag[1]?.toLowerCase().includes(query.toLowerCase()))
      );
      
      if (searchFilteredBooks.length > 0) {
        searchResult = {
          events: searchFilteredBooks.map(cached => cached.event),
          relays: [...new Set(searchFilteredBooks.flatMap(cached => cached.relays))]
        };
      } else {
        searchResult = await relayService.queryEvents(
          'anonymous',
          'social-read',
          [{ kinds: [30041], search: query, limit: 10 }],
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );
      }

      for (const evt of searchResult.events) {
        if (isBookEvent(evt as BookEvent, bookType) && matchesBookQuery(evt as BookEvent, parsedQuery!, bookType)) {
          if (addUniqueTaggedReplaceable(results, evt)) update();
        }
      }
    } catch (error) {
      console.error('Failed to search for books:', error);
    }

    function oneose() {
      eosed++;
      if (eosed >= 2) {
        tried = true;
        
        // If we were searching for a specific version and found no results, try fallback
        if (parsedQuery?.version && results.length === 0) {
          versionNotFound = true;
          performFallbackSearch();
        } else {
          if (onResults) {
            onResults(results);
          }
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
    
    // Search for all versions of the same book reference
    const searchQueries = generateBookSearchQuery(fallbackQuery.references, bookType, fallbackQuery.version, fallbackQuery.versions);
    
    let fallbackEosed = 0;
    const fallbackSubs: SubCloser[] = [];
    
    const fallbackUpdate = debounce(() => {
      fallbackResults = fallbackResults.sort((a, b) => {
        return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
      });
    }, 500);

    // Use relayService for fallback search
    try {
      const fallbackResult = await relayService.queryEvents(
        'anonymous',
        'social-read',
        [{ kinds: [30041], '#type': [bookType], limit: 25 }],
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );

      for (const evt of fallbackResult.events) {
        // Check if this event matches our book criteria (without version restriction)
        if (isBookEvent(evt as BookEvent, bookType) && matchesBookQuery(evt as BookEvent, fallbackQuery, bookType)) {
          if (addUniqueTaggedReplaceable(fallbackResults, evt)) fallbackUpdate();
        }
      }

      // Update the main results with fallback results
      results = fallbackResults;
      if (onResults) {
        onResults(results);
      }
    } catch (error) {
      console.error('Failed to search for fallback books:', error);
    }
  }

  function matchesBookQuery(event: BookEvent, query: { references: BookReference[], version?: string }, bookType: string): boolean {
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
    const metadata = extractBookMetadata(result);
    const title = generateBookTitle(metadata);
    
    // Create a search card for the book event
    const searchCard = {
      id: next(),
      type: 'find' as const,
      data: getTagOr(result, 'd') || result.id,
      preferredAuthors: [result.pubkey]
    };
    
    if (ev?.button === 1) createChild(searchCard);
    else createChild(searchCard);
  }

  // Get the display name for the book type
  const bookTypeDisplayName = BOOK_TYPES[bookType]?.displayName || bookType.charAt(0).toUpperCase() + bookType.slice(1);
</script>

<div class="book-search-results">
  <!-- Retry button at top of results pane -->
  {#if tried || results.length > 0}
    <div class="mb-4 flex justify-end">
      <button
        onclick={() => performBookSearch()}
        class="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors shadow-sm hover:shadow"
        title="Retry search"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Retry
      </button>
    </div>
  {/if}

  {#if (tried && results.length === 0 && !versionNotFound) || (versionNotFound && results.length === 0)}
    <BookFallbackCards
      parsedQuery={parsedQuery}
      bibleGatewayUrl={bibleGatewayUrlForQuery}
      referenceOgPreviews={referenceOgPreviews}
      referenceOgLoading={referenceOgLoading}
      referenceOgErrors={referenceOgErrors}
      getReferenceKey={getReferenceKey}
      showBibleGateway={bookType === 'bible'}
    />
  {:else if results.length > 0}
    {#if versionNotFound}
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
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
    {/if}
    <div class="space-y-4">
      {#each results as result (result.id)}
        {@const metadata = extractBookMetadata(result)}
        {@const title = generateBookTitle(metadata)}
        <div 
          class="border rounded-lg p-4 cursor-pointer transition-colors"
          style="border-color: var(--border); background-color: var(--bg-secondary);"
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
              <div class="text-sm mt-1" style="color: var(--text-secondary);">
                by <span class="font-mono text-xs">{result.pubkey.slice(0, 8)}...</span>
                {#if result.created_at}
                  • {formatRelativeTime(result.created_at)}
                {/if}
              </div>
              <div class="mt-2 text-sm line-clamp-3" style="color: var(--text-primary);">
                {result.content.slice(0, 200)}...
              </div>
            </div>
            <div class="ml-4 text-xs" style="color: var(--text-muted);">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if !tried}
    <div class="italic" style="color: var(--text-secondary);">
      Searching for {bookTypeDisplayName.toLowerCase()} passages...
    </div>
  {/if}
</div>

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .book-search-results h3 {
    font-family: var(--font-family-heading);
  }


  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
