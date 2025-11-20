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
    isBookEvent, 
    extractBookMetadata, 
    generateBookTitle,
    formatBookReference,
    type BookReference,
    type BookEvent,
    BOOK_TYPES
  } from '$lib/books';
  
  // Helper to extract sections directly from event tags (not from metadata.verse string)
  function extractEventSections(event: BookEvent): string[] {
    // Check for NKBIP-08 format first
    const sectionTags = event.tags.filter(([tag]) => tag === 's').map(([, value]) => value);
    if (sectionTags.length > 0) {
      return sectionTags;
    }
    
    // Fall back to old format
    const verseTag = event.tags.find(([tag]) => tag === 'verse');
    if (verseTag && verseTag[1]) {
      // Expand verse string to sections
      const sections: string[] = [];
      const parts = verseTag[1].split(',').map(p => p.trim());
      
      for (const part of parts) {
        if (part.includes('-')) {
          // It's a range
          const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (let i = start; i <= end; i++) {
              sections.push(i.toString());
            }
          } else {
            sections.push(part);
          }
        } else {
          sections.push(part);
        }
      }
      
      return sections;
    }
    
    return [];
  }
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
      // NKBIP-08 format: parse with NKBIP-08 parser
      const parsed = parseBookWikilinkNKBIP08(queryToParse);
      if (parsed && parsed.references.length > 0) {
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
          bookCard.bookType = parsed.references[0].collection;
        }
        console.log('Book: Parsed query successfully:', { query, queryToParse, parsed, parsedQuery });
      } else {
        console.warn('Book: Parser returned no references for query:', query, 'parsed as:', queryToParse, 'result:', parsed);
      }
    } else {
      // Invalid format - query must start with book::
      console.warn('Book query must use book:: format, got:', query);
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
    if (!parsedQuery) {
      console.warn('Book: Cannot perform search, parsedQuery is null. Query was:', query);
      return;
    }

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
        let matchedCount = 0;
        let rejectedCount = 0;
        for (const cached of bookCachedEvents) {
          const evt = cached.event as BookEvent;
          
          // Check if this event matches our book criteria
          const isBook = isBookEvent(evt, bookCard.bookType);
          if (!isBook) {
            rejectedCount++;
            continue;
          }
          
          const matches = matchesBookQuery(evt, parsedQuery!);
          if (matches) {
            matchedCount++;
            // Track which relays returned this event
            cached.relays.forEach(relay => {
              if (!seenCache[evt.id]) seenCache[evt.id] = [];
              if (seenCache[evt.id].indexOf(relay) === -1) {
                seenCache[evt.id].push(relay);
              }
            });
            
            if (addUniqueTaggedReplaceable(results, evt)) update();
          } else {
            rejectedCount++;
            // Debug: log why events are being rejected
            const metadata = extractBookMetadata(evt);
            console.log('Book: Event rejected:', {
              id: evt.id.slice(0, 8),
              metadata,
              query: parsedQuery,
              tags: evt.tags.filter(([t]) => ['C', 'T', 'c', 's', 'v'].includes(t))
            });
          }
        }
        
        console.log(`Book: Cache filtering complete - matched: ${matchedCount}, rejected: ${rejectedCount}, total cached: ${bookCachedEvents.length}`);
        
        if (results.length > 0) {
          console.log(`Book: Found ${results.length} matching events in cache`);
          tried = true;
          // Still query relays in background to get fresh results, but show cache immediately
        }
      }
    } catch (error) {
      console.error('Book: Failed to check cache:', error);
    }

    // Don't set a timeout if we already have cache results - they'll set tried = true
    // Only set timeout if we have no cache results yet
    if (results.length === 0) {
      setTimeout(() => {
        tried = true;
      }, 3000); // Increased timeout to allow relay queries to complete
    }

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
        
        // C tag: collection (e.g., "bible") - only include if collection is specified
        if (bookCard.bookType) {
          filter['#C'] = [bookCard.bookType];
        }
        
        // T tag: title/book name (normalized using NIP-54)
        if (ref.book) {
          // Normalize book name using NIP-54 rules: lowercase, replace non-alphanumeric with hyphens
          // The parser already normalized it, but we normalize again to ensure consistency
          const normalizedBook = normalizeIdentifier(ref.book);
          filter['#T'] = [normalizedBook];
        }
        
        // c tag: chapter
        if (ref.chapter) {
          filter['#c'] = [ref.chapter.toString()];
        }
        
        // s tag: section/verse
        // Limit expansion to avoid "too many tags" errors from relays
        // Most relays have limits around 20-30 tags per filter
        if (ref.verse) {
          // Expand verse ranges to individual sections (e.g., "2-4" -> ["2", "3", "4"])
          const expandVerseToSections = (verse: string, maxSections: number = 20): string[] => {
            const sections: string[] = [];
            const parts = verse.split(',').map(p => p.trim());
            
            for (const part of parts) {
              if (sections.length >= maxSections) {
                // Stop expanding if we hit the limit
                break;
              }
              
              if (part.includes('-')) {
                // It's a range
                const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                  // Limit range expansion to avoid too many tags
                  const rangeLimit = Math.min(end, start + (maxSections - sections.length) - 1);
                  for (let i = start; i <= rangeLimit && sections.length < maxSections; i++) {
                    sections.push(i.toString());
                  }
                } else {
                  // Invalid range, just add as-is
                  if (sections.length < maxSections) {
                    sections.push(part);
                  }
                }
              } else {
                // Single section
                if (sections.length < maxSections) {
                  sections.push(part);
                }
              }
            }
            
            return sections;
          };
          
          const verses = expandVerseToSections(ref.verse);
          // Only add section filter if we have sections (and not too many)
          if (verses.length > 0 && verses.length <= 20) {
            filter['#s'] = verses;
          }
          // If we have too many sections, omit the section filter and filter client-side
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
      // Note: Some relays may not support all NKBIP-08 tags, so errors are expected
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
        // Some relays may reject filters with certain tags - this is expected
        // We'll still get results from cache and other relays that support the tags
        console.warn('Book search: Some relays rejected the query (this is normal for relays that don\'t support NKBIP-08 tags):', error);
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
      
      // C tag: collection (e.g., "bible") - only include if collection is specified
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
      // Limit expansion to avoid "too many tags" errors from relays
      if (ref.verse) {
        // Expand verse ranges to individual sections (e.g., "2-4" -> ["2", "3", "4"])
        const expandVerseToSections = (verse: string, maxSections: number = 20): string[] => {
          const sections: string[] = [];
          const parts = verse.split(',').map(p => p.trim());
          
          for (const part of parts) {
            if (sections.length >= maxSections) {
              // Stop expanding if we hit the limit
              break;
            }
            
            if (part.includes('-')) {
              // It's a range
              const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
              if (!isNaN(start) && !isNaN(end) && start <= end) {
                // Limit range expansion to avoid too many tags
                const rangeLimit = Math.min(end, start + (maxSections - sections.length) - 1);
                for (let i = start; i <= rangeLimit && sections.length < maxSections; i++) {
                  sections.push(i.toString());
                }
              } else {
                // Invalid range, just add as-is
                if (sections.length < maxSections) {
                  sections.push(part);
                }
              }
            } else {
              // Single section
              if (sections.length < maxSections) {
                sections.push(part);
              }
            }
          }
          
          return sections;
        };
        
        const verses = expandVerseToSections(ref.verse);
        // Only add section filter if we have sections (and not too many)
        if (verses.length > 0 && verses.length <= 20) {
          filter['#s'] = verses;
        }
        // If we have too many sections, omit the section filter and filter client-side
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

  function matchesBookQuery(event: BookEvent, query: { references: BookReference[], version?: string, versions?: string[] }): boolean {
    const metadata = extractBookMetadata(event);
    
    // If a specific version is requested, check if this event matches that version
    // Support both singular 'version' and plural 'versions' from parsed query
    const requestedVersions = query.versions || (query.version ? [query.version] : []);
    if (requestedVersions.length > 0 && metadata.version) {
      const queryVersions = requestedVersions.map(v => v.toLowerCase());
      const eventVersions = metadata.version.toLowerCase().split(/\s+/);
      const hasMatchingVersion = queryVersions.some(qv => eventVersions.includes(qv));
      if (!hasMatchingVersion) {
        return false; // No version matches
      }
    }
    
    // Normalize book names for comparison (both should already be normalized, but ensure consistency)
    const normalizeBookName = (name: string) => normalizeIdentifier(name).toLowerCase();
    
    // Check if any of the references match
    for (const ref of query.references) {
      if (!metadata.book) continue;
      
      // Normalize both sides for comparison
      const normalizedQueryBook = normalizeBookName(ref.book);
      const normalizedEventBook = normalizeBookName(metadata.book);
      
      if (normalizedQueryBook !== normalizedEventBook) {
        continue; // Book doesn't match
      }
      
      // Book matches - check chapter
      if (ref.chapter) {
        if (!metadata.chapter || ref.chapter.toString() !== metadata.chapter) {
          continue; // Chapter doesn't match
        }
        
        // Chapter matches - check verse/section
        if (ref.verse) {
          // Expand verse ranges properly (e.g., "2-4" -> ["2", "3", "4"])
          const expandVerseToSections = (verse: string): string[] => {
            const sections: string[] = [];
            const parts = verse.split(',').map(p => p.trim());
            
            for (const part of parts) {
              if (part.includes('-')) {
                // It's a range
                const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                  for (let i = start; i <= end; i++) {
                    sections.push(i.toString());
                  }
                } else {
                  // Invalid range, just add as-is
                  sections.push(part);
                }
              } else {
                // Single section
                sections.push(part);
              }
            }
            
            return sections;
          };
          
          const querySections = expandVerseToSections(ref.verse);
          // Extract sections directly from event tags (more reliable than metadata.verse)
          const eventSections = extractEventSections(event);
          
          // Check if any query section matches any event section
          const hasMatchingSection = querySections.some(qs => eventSections.includes(qs));
          if (!hasMatchingSection) {
            continue; // No section matches
          }
        }
        // Chapter matches (and verse matches if specified)
        return true;
      } else {
        // Just book matches (no chapter specified)
        return true;
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

{#if tried && results.length === 0 && !versionNotFound}
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
{:else if !tried && parsedQuery}
  <!-- Show loading state while searching -->
  <div class="mt-4 text-gray-500 italic">
    <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 0.5rem; vertical-align: middle;"></div>
    <span>Searching for {bookTypeDisplayName.toLowerCase()} passages...</span>
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
  
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
