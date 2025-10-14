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
  import type { Card, BibleCard } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique } from '$lib/utils';
  import { DEFAULT_SEARCH_RELAYS } from '$lib/defaults';
  import { 
    parseBibleWikilink, 
    generateBibleSearchQuery, 
    isBibleEvent, 
    extractBibleMetadata, 
    generateBibleTitle,
    formatBibleReference,
    type BibleReference,
    type BibleEvent
  } from '$lib/bible';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import BibleDisplay from '$components/BibleDisplay.svelte';

  export let card: Card;
  export let replaceSelf: (card: Card) => void;
  export let createChild: (card: Card) => void;

  let tried = false;
  let eosed = 0;
  let editable = false;
  let versionNotFound = false;
  let fallbackResults: BibleEvent[] = [];

  const bibleCard = card as BibleCard;

  let query: string;
  let seenCache: { [id: string]: string[] } = {};
  let results: BibleEvent[] = [];
  let parsedQuery: { references: BibleReference[], version?: string, versions?: string[] } | null = null;

  // close handlers
  let uwrcancel: () => void;
  let search: SubCloser;
  let subs: SubCloser[] = [];

  onMount(() => {
    query = bibleCard.data;
    parsedQuery = parseBibleWikilink(query);
  });

  onMount(() => {
    // we won't do any searches if we already have the results
    if (bibleCard.results) {
      seenCache = bibleCard.seenCache || {};
      results = bibleCard.results || [];

      tried = true;
      return;
    }

    performBibleSearch();
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    if (search) search.close();
  }

  async function performBibleSearch() {
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

      // Search for Bible events (kind 30041) with Bible tags
      const searchQueries = generateBibleSearchQuery(parsedQuery!.references, parsedQuery!.version, parsedQuery!.versions);
      
      for (const searchQuery of searchQueries) {
        let subc = pool.subscribeMany(
          relaysToUseNow,
          [{ kinds: [30041], '#type': ['bible'], limit: 25 }],
          {
            id: 'find-bible-exact',
            onevent(evt) {
              tried = true;

              // Check if this event matches our Bible criteria
              if (isBibleEvent(evt as BibleEvent) && matchesBibleQuery(evt as BibleEvent, parsedQuery!)) {
                if (addUniqueTaggedReplaceable(results, evt)) update();
              }
            },
            oneose,
            receivedEvent: (relay: any, id: string) => {
            if (!(id in seenCache)) seenCache[id] = [];
            if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
          }
          }
        );

        subs.push(subc);
      }
    });

    // Also search using general search for Bible-related content
    search = pool.subscribeMany(
      DEFAULT_SEARCH_RELAYS,
      [{ kinds: [30041], search: query, limit: 10 }],
      {
        id: 'find-bible-search',
        onevent(evt) {
          if (isBibleEvent(evt as BibleEvent) && matchesBibleQuery(evt as BibleEvent, parsedQuery!)) {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          }
        },
        oneose,
        receivedEvent: (relay: any, id: string) => {
          if (!(id in seenCache)) seenCache[id] = [];
          if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
        }
      }
    );

    function oneose() {
      eosed++;
      if (eosed >= 2) {
        tried = true;
        
        // If we were searching for a specific version and found no results, try fallback
        if (parsedQuery?.version && results.length === 0) {
          versionNotFound = true;
          performFallbackSearch();
        } else {
          bibleCard.results = results;
          bibleCard.seenCache = seenCache;
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
    
    // Search for all versions of the same Bible reference
    const searchQueries = generateBibleSearchQuery(fallbackQuery.references, fallbackQuery.version, fallbackQuery.versions);
    
    let fallbackEosed = 0;
    const fallbackSubs: SubCloser[] = [];
    
    const fallbackUpdate = debounce(() => {
      fallbackResults = fallbackResults.sort((a, b) => {
        return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
      });
    }, 500);

    for (const searchQuery of searchQueries) {
      let subc = pool.subscribeMany(
        DEFAULT_SEARCH_RELAYS,
        [{ kinds: [30041], '#type': ['bible'], limit: 25 }],
        {
          id: 'find-bible-fallback',
          onevent(evt) {
            // Check if this event matches our Bible criteria (without version restriction)
            if (isBibleEvent(evt as BibleEvent) && matchesBibleQuery(evt as BibleEvent, fallbackQuery)) {
              if (addUniqueTaggedReplaceable(fallbackResults, evt)) fallbackUpdate();
            }
          },
          oneose() {
            fallbackEosed++;
            if (fallbackEosed >= 1) {
              // Update the main results with fallback results
              results = fallbackResults;
              bibleCard.results = results;
              bibleCard.seenCache = seenCache;
            }
          },
          receivedEvent: (relay: any, id: string) => {
            if (!(id in seenCache)) seenCache[id] = [];
            if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
          }
        }
      );

      fallbackSubs.push(subc);
    }
  }

  function matchesBibleQuery(event: BibleEvent, query: { references: BibleReference[], version?: string }): boolean {
    const metadata = extractBibleMetadata(event);
    
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
          if (ref.verses && metadata.verses) {
            // Check if verses match (this is a simplified check)
            return metadata.verses.includes(ref.verses) || ref.verses.includes(metadata.verses);
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

  function openBibleEvent(result: BibleEvent, ev?: MouseEvent) {
    const metadata = extractBibleMetadata(result);
    const title = generateBibleTitle(metadata);
    
    // Create a Bible card for the Bible event
    const bibleEventCard = {
      id: next(),
      type: 'bible' as const,
      data: getTagOr(result, 'd') || result.id,
      preferredAuthors: [result.pubkey]
    };
    
    if (ev?.button === 1) createChild(bibleEventCard);
    else replaceSelf({ ...bibleEventCard, back: card });
  }

  function startEditing() {
    debouncedPerformBibleSearch.clear();
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
    if (query !== bibleCard.data) {
      // replace browser url and history
      let index = $cards.findIndex((t) => t.id === card.id);
      let replacementURL = page.url.pathname.split('/').slice(1);
      replacementURL[index] = query;

      let currentState = page.state as [number, Card];
      replaceState('/' + replacementURL.join('/'), currentState[0] === index ? [] : currentState);

      // update stored card state
      bibleCard.data = query;
      bibleCard.results = undefined;

      // redo the query
      debouncedPerformBibleSearch();
    }
  }

  const debouncedPerformBibleSearch = debounce(performBibleSearch, 400);
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
  <!-- Bible Search Instructions -->
  <div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
    <h3 class="text-lg font-semibold text-espresso-900 mb-3">📖 Bible Search</h3>
    <div class="text-sm text-espresso-800 space-y-2">
      <p><strong>Search for Bible passages using standard notation:</strong></p>
      <div class="bg-white p-3 rounded border border-brown-300 font-mono text-xs space-y-1">
        <div>John 3:16</div>
        <div>John 3:16 | KJV</div>
        <div>Psalm 23:1</div>
        <div>Genesis 1:1 | KJV</div>
        <div>Revelation 11:15 | DRB</div>
        <div>Romans 1:16-25; Psalm 19:2-3</div>
        <div>Romans 1:16-25 | KJV DRB</div>
      </div>
      <p><strong>Supported formats:</strong></p>
      <ul class="text-xs text-espresso-700 ml-4 space-y-1">
        <li>• Single verse: <code>John 3:16</code></li>
        <li>• Chapter: <code>John 3</code></li>
        <li>• Book: <code>John</code></li>
        <li>• Verse range: <code>John 3:16-18</code></li>
        <li>• Multiple verses: <code>John 3:16,18</code></li>
        <li>• With version: <code>John 3:16 | KJV</code></li>
        <li>• Multiple references: <code>Romans 1:16-25; Psalm 19:2-3</code></li>
        <li>• Multiple versions: <code>Romans 1:16-25 | KJV DRB</code></li>
      </ul>
      <p class="text-xs text-espresso-600 mt-2">
        Use abbreviations like Gen, Exod, Ps, Rev, etc. Case and whitespace are flexible: <code>john3:16</code> works the same as <code>John 3:16</code>
      </p>
      <p class="text-xs text-espresso-600 mt-2">
        <strong>Compare Bible versions:</strong> Use <code>diff::</code> prefix in the main search bar:
      </p>
      <div class="bg-white p-3 rounded border border-brown-300 font-mono text-xs mt-1">
        <div>diff::John 3:16 KJV | NIV</div>
        <div>diff::bible:Romans 1:16 KJV | ESV</div>
        <div>diff::Psalm 23:1 KJV | DRB</div>
      </div>
    </div>
  </div>
{:else if tried && results.length === 0 && !versionNotFound}
  <div class="mt-4 text-gray-500 italic">
    No Bible passages found for "{query}"
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
      {@const metadata = extractBibleMetadata(result)}
      {@const title = generateBibleTitle(metadata)}
      <div 
        class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
        role="button"
        tabindex="0"
        onclick={(e) => openBibleEvent(result, e)}
        onkeydown={(e) => e.key === 'Enter' && openBibleEvent(result, undefined)}
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-blue-600 hover:text-blue-800">
              {title}
            </h3>
            <div class="text-sm text-gray-600 mt-1">
              by <span class="font-mono text-xs">{result.pubkey.slice(0, 8)}...</span>
              {#if result.created_at}
                • {new Date(result.created_at * 1000).toLocaleDateString()}
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
    Searching for Bible passages...
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
