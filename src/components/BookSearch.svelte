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

  // close handlers
  let uwrcancel: () => void;
  let subs: SubCloser[] = [];

  onMount(() => {
    // Parse the book query
    parsedQuery = parseBookWikilink(query, bookType);
    if (parsedQuery) {
      performBookSearch();
    }
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    // search is now handled by relayService
  }

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
          console.log(`📦 Using ${filteredBooks.length} cached book events for ${bookType}`);
          result = {
            events: filteredBooks.map(cached => cached.event),
            relays: [...new Set(filteredBooks.flatMap(cached => cached.relays))]
          };
        } else {
          console.log('🔄 No cached book events found, querying relays...');
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
        console.log(`📦 Using ${searchFilteredBooks.length} cached book events for search: ${query}`);
        searchResult = {
          events: searchFilteredBooks.map(cached => cached.event),
          relays: [...new Set(searchFilteredBooks.flatMap(cached => cached.relays))]
        };
      } else {
        console.log('🔄 No cached search results found, querying relays...');
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
  {#if tried && results.length === 0 && !versionNotFound}
    <div class="text-gray-500 italic">
      No {bookTypeDisplayName.toLowerCase()} passages found for "{query}"
    </div>
  {:else if versionNotFound && results.length === 0}
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
      <div class="flex items-center space-x-2 text-yellow-800">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
        </svg>
        <span class="font-medium">Version not found</span>
      </div>
      <div class="mt-2 text-sm text-yellow-700">
        The requested version "{parsedQuery?.version}" was not found. Searching for all available versions...
      </div>
    </div>
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
    <div class="text-gray-500 italic">
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
</style>
