<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent, Event } from '@nostr/tools/pure';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { wot, userWikiRelays } from '$lib/nostr';
  // Support all wiki kinds: 30818 (AsciiDoc), 30817 (Markdown), 30040 (Index), 30041 (Content)
  const wikiKinds = [30818, 30817, 30040, 30041];
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import { isDiffQuery } from '$lib/diff';
  import { account } from '$lib/nostr';
  import { relayService } from '$lib/relayService';

  // Theme configuration
  const theme = getThemeConfig();

  let { card, replaceSelf, createChild }: { card: Card; replaceSelf: (card: Card) => void; createChild: (card: Card) => void } = $props();
  let tried = $state(false);
  let eosed = 0;
  let editable = $state(false);

  const searchCard = card as SearchCard;

  let query: string = $state('');
  let seenCache: { [id: string]: string[] } = {};
  let results: NostrEvent[] = $state([]);
  let selectedArticles: Set<string> = $state(new Set());

  // close handlers
  let uwrcancel: () => void;
  let search: SubCloser = { close: () => {} };
  let subs: SubCloser[] = [];

  onMount(() => {
    query = searchCard.data || '';
    
    // Check if this is a diff query and route accordingly
    if (isDiffQuery(query)) {
      const diffCard: Card = {
        id: next(),
        type: 'diff',
        data: query
      };
      replaceSelf(diffCard);
      return;
    }
  });

  onMount(() => {
    // we won't do any searches if we already have the results
    if (searchCard.results && searchCard.results.length > 0) {
      seenCache = searchCard.seenCache || {};
      results = searchCard.results || [];

      tried = true;
      return;
    }

    // Only perform search if we have a meaningful query
    if (query && query.trim() && query.length > 2) {
      performSearch();
    }
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    if (search) search.close();
  }

  async function performSearchWithAllRelays() {
    // Cancel existing subscriptions and zero variables
    destroy();
    tried = false;
    eosed = 0;
    results = [];

    // Only search if we have a meaningful query
    if (!query || !query.trim() || query.length <= 2) return;

    setTimeout(() => {
      tried = true;
    }, 1500);

    const update = debounce(() => {
      // Deduplicate replaceable events by a-tag, keeping only the newest
      const deduplicated = new Map<string, NostrEvent>();
      
      for (const event of results) {
        const isReplaceable = event.kind === 30818 || event.kind === 30817 || event.kind === 30041 || event.kind === 1111;
        
        if (isReplaceable) {
          const dTag = event.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) {
            const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
            const existing = deduplicated.get(aTag);
            if (!existing || event.created_at > existing.created_at) {
              deduplicated.set(aTag, event);
            }
            continue;
          }
        }
        
        // For non-replaceable events, use event.id
        const existing = deduplicated.get(event.id);
        if (!existing) {
          deduplicated.set(event.id, event);
        }
      }
      
      // Convert back to array and sort
      results = Array.from(deduplicated.values());
      
      // Multi-tier sorting: WOT authors > search tier > wotness
      let normalizedIdentifier = normalizeIdentifier(query);
      results = results.sort((a, b) => {
        const aWotScore = $wot[a.pubkey] || 0;
        const bWotScore = $wot[b.pubkey] || 0;
        
        // First priority: Authors in WOT (have WOT score > 0)
        const aInWot = aWotScore > 0;
        const bInWot = bWotScore > 0;
        
        if (aInWot && !bInWot) return -1; // a is in WOT, b is not
        if (!aInWot && bInWot) return 1;  // b is in WOT, a is not
        
        // If both or neither are in WOT, sort by search tier
        const aSearchScore = getSearchScore(a, normalizedIdentifier, query);
        const bSearchScore = getSearchScore(b, normalizedIdentifier, query);
        
        if (aSearchScore !== bSearchScore) {
          return bSearchScore - aSearchScore; // Higher score first
        }
        
        // Finally, sort by WOT score
        return bWotScore - aWotScore;
      });
      
      results = results;
    }, 500);

    try {
      // Check cache first for instant results
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = contentCache.getEvents('wiki');
      const normalizedQuery = normalizeIdentifier(query);
      
      // Filter cached events by d-tag (exact match)
      const cachedMatches = cachedEvents.filter(cached => {
        const dTag = cached.event.tags.find(([t]) => t === 'd')?.[1];
        return dTag && normalizeIdentifier(dTag) === normalizedQuery;
      });
      
      if (cachedMatches.length > 0) {
        console.log(`✅ Found ${cachedMatches.length} cached matches for: "${query}"`);
        cachedMatches.forEach(cached => {
          cached.relays.forEach(relay => {
            if (!seenCache[cached.event.id]) seenCache[cached.event.id] = [];
            if (seenCache[cached.event.id].indexOf(relay) === -1) {
              seenCache[cached.event.id].push(relay);
            }
          });
          
          // Check if this is an exact match from preferred authors
          if (searchCard.preferredAuthors?.includes(cached.event.pubkey)) {
            openArticle(cached.event, undefined, true);
          }
          
          if (addUniqueTaggedReplaceable(results, cached.event)) update();
        });
        tried = true;
      }
      
      // Get all available relays from relayService
      const userPubkey = $account?.pubkey || 'anonymous';
      const allWikiRelays = await relayService.getRelaysForOperation(userPubkey, 'wiki-read');
      
      // If we have preferred authors, prioritize their relays
      let relaysToQuery = allWikiRelays;
      if (searchCard.preferredAuthors && searchCard.preferredAuthors.length > 0) {
        // Query preferred authors' relays first, then all relays
        const preferredRelays = new Set<string>();
        for (const author of searchCard.preferredAuthors) {
          const authorRelays = await relayService.getRelaysForOperation(author, 'wiki-read');
          authorRelays.forEach(r => preferredRelays.add(r));
        }
        relaysToQuery = [...preferredRelays, ...allWikiRelays.filter(r => !preferredRelays.has(r))];
      }

      // Support all wiki event kinds: 30818 (AsciiDoc), 30817 (Markdown), 30040 (Index), 30041 (Content)
      const normalizedId = normalizeIdentifier(query);
      const searchQueries = [
        // 1. Exact match by d-tag for all wiki kinds
        { kinds: wikiKinds, '#d': [normalizedId], limit: 25 }
      ];

      // Search using relay service (it handles relay selection and batching)
      const searchPromises = searchQueries.map(searchQuery => 
        relayService.queryEvents(
          userPubkey,
          'wiki-read',
          [searchQuery],
          {
            excludeUserContent: false,
            currentUserPubkey: $account?.pubkey
          }
        )
      );
      
      // Wait for all searches with timeout
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          tried = true;
          resolve();
        }, 3000); // 3 second timeout
      });
      
      Promise.all(searchPromises).then(searchResults => {
        let foundAny = false;
        searchResults.forEach(result => {
          result.events.forEach(evt => {
            foundAny = true;
            tried = true;
            
            // Track relay sources
            result.relays.forEach(relay => {
              if (!seenCache[evt.id]) seenCache[evt.id] = [];
              if (seenCache[evt.id].indexOf(relay) === -1) {
                seenCache[evt.id].push(relay);
              }
            });

            // Check if this is an exact match from preferred authors
            if (searchCard.preferredAuthors?.includes(evt.pubkey)) {
              openArticle(evt, undefined, true);
            }

            if (addUniqueTaggedReplaceable(results, evt)) update();
          });
        });
        
        if (!foundAny && !cachedMatches.length) {
          tried = true;
        }
        }).catch(error => {
          console.error('Search error:', error);
        tried = true;
        });
      
      // Ensure tried is set after timeout
      timeoutPromise.then(() => {
        if (results.length === 0 && cachedMatches.length === 0) {
          tried = true;
        }
      });

    } catch (error) {
      console.error('Failed to perform search:', error);
      tried = true;
    }
  }

  async function performSearch() {
    // cancel existing subscriptions and zero variables
    destroy();
    tried = false;
    eosed = 0;
    results = [];

    // Only set tried to true if we have a meaningful query to search for
    if (query && query.trim() && query.length > 2) {
      setTimeout(() => {
        tried = true;
      }, 1500);
    }

    const update = debounce(() => {
      // Deduplicate replaceable events by a-tag, keeping only the newest
      const deduplicated = new Map<string, NostrEvent>();
      
      for (const event of results) {
        const isReplaceable = event.kind === 30818 || event.kind === 30817 || event.kind === 30041 || event.kind === 1111;
        
        if (isReplaceable) {
          const dTag = event.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) {
            const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
            const existing = deduplicated.get(aTag);
            if (!existing || event.created_at > existing.created_at) {
              deduplicated.set(aTag, event);
            }
            continue;
          }
        }
        
        // For non-replaceable events, use event.id
        const existing = deduplicated.get(event.id);
        if (!existing) {
          deduplicated.set(event.id, event);
        }
      }
      
      // Convert back to array
      results = Array.from(deduplicated.values());
      
      // Multi-tier sorting: WOT authors > search tier > wotness
      let normalizedIdentifier = normalizeIdentifier(query);
      results = results.sort((a, b) => {
        const aWotScore = $wot[a.pubkey] || 0;
        const bWotScore = $wot[b.pubkey] || 0;
        
        // First priority: Authors in WOT (have WOT score > 0)
        const aInWot = aWotScore > 0;
        const bInWot = bWotScore > 0;
        
        if (aInWot && !bInWot) return -1; // a is in WOT, b is not
        if (!aInWot && bInWot) return 1;  // b is in WOT, a is not
        
        // If both or neither are in WOT, sort by search tier
        const aSearchScore = getSearchScore(a, normalizedIdentifier, query);
        const bSearchScore = getSearchScore(b, normalizedIdentifier, query);
        
        if (aSearchScore !== bSearchScore) {
          return bSearchScore - aSearchScore; // Higher search score first
        }
        
        // Finally, sort by WOT score within same tier
        return bWotScore - aWotScore;
      });
      seenCache = seenCache;
    }, 500);

    const relaysFromPreferredAuthors = unique(
      (await Promise.all((searchCard.preferredAuthors || []).map((pk) => loadRelayList(pk))))
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

      // Use relay service for exact match search
      if ($account) {
        relayService.queryEvents(
          $account.pubkey,
          'wiki-read',
          [{ kinds: wikiKinds, '#d': [normalizeIdentifier(query)], limit: 25 }],
          {
            excludeUserContent: true,
            currentUserPubkey: $account.pubkey
          }
        ).then(result => {
          result.events.forEach(evt => {
            tried = true;

            if (searchCard.preferredAuthors?.includes(evt.pubkey)) {
              // we found an exact match that fits e
              openArticle(evt, undefined, true);
            }

            if (addUniqueTaggedReplaceable(results, evt)) update();
          });
        });
      }

    });

    // Multi-tier search: full-text only (avoiding problematic tag filters)
    if ($account) {
      const searchQueries = [
        // 1. full-text search (most compatible)
        { kinds: wikiKinds, search: query, limit: 30 }
      ];

      // Search all queries using relay service
      searchQueries.forEach((searchQuery) => {
        relayService.queryEvents(
          $account.pubkey,
          'wiki-read',
          [searchQuery],
          {
            excludeUserContent: true,
            currentUserPubkey: $account.pubkey
          }
        ).then(result => {
          result.events.forEach(evt => {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          });
        });
      });
    }

    // Note: oneose is no longer needed since we're using async queries
    // The relay service handles completion internally
    // We'll set tried = true after a reasonable timeout
    setTimeout(() => {
      tried = true;
      searchCard.results = results;
      searchCard.seenCache = seenCache;
    }, 3000);

    function receivedEvent(relay: AbstractRelay, id: string) {
      if (!(id in seenCache)) seenCache[id] = [];
      if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
    }
  }

  const debouncedPerformSearch = debounce(performSearch, 400);

  // Calculate search score for sorting (higher = better match)
  function getSearchScore(event: NostrEvent, normalizedIdentifier: string, query: string): number {
    // 1. d-tag exact match (highest priority)
    if (getTagOr(event, 'd') === normalizedIdentifier) {
      return 100;
    }
    
    // 2. title match
    const title = getTagOr(event, 'title');
    if (title && title.toLowerCase().includes(query.toLowerCase())) {
      return 80;
    }
    
    // 3. summary match
    const summary = getTagOr(event, 'summary');
    if (summary && summary.toLowerCase().includes(query.toLowerCase())) {
      return 60;
    }
    
    // 4. full-text match (lowest priority)
    return 40;
  }

  function openArticle(result: Event, ev?: MouseEvent, direct?: boolean) {
    // Create a clean, serializable copy of the event
    const cleanEvent = {
      id: result.id,
      pubkey: result.pubkey,
      created_at: result.created_at,
      kind: result.kind,
      tags: result.tags.map(tag => [...tag]), // Deep copy tags array
      content: result.content,
      sig: result.sig
    };
    
    let articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      relayHints: seenCache[result.id],
      actualEvent: cleanEvent,
      versions:
        getTagOr(result, 'd') === normalizeIdentifier(query)
          ? results.filter((evt) => getTagOr(evt, 'd') === normalizeIdentifier(query)).map(evt => ({
              id: evt.id,
              pubkey: evt.pubkey,
              created_at: evt.created_at,
              kind: evt.kind,
              tags: evt.tags.map(tag => [...tag]),
              content: evt.content,
              sig: evt.sig
            }))
          : undefined
    };
    if (ev?.button === 1) createChild(articleCard);
    else if (direct)
      // if this is called with 'direct' we won't give it a back button
      replaceSelf(articleCard);
    else replaceSelf({ ...articleCard, back: card }); // otherwise we will
  }

  function toggleArticleSelection(eventId: string) {
    if (selectedArticles.has(eventId)) {
      // If already selected, deselect it
      selectedArticles.delete(eventId);
    } else {
      // If trying to select a new article, check if we're at the limit
      if (selectedArticles.size >= 2) {
        // Show a message or prevent selection
        console.log('⚠️ Maximum of 2 articles can be selected for diff comparison');
        return;
      }
      selectedArticles.add(eventId);
    }
    selectedArticles = new Set(selectedArticles); // Trigger reactivity
  }

  // Check if an article has "Read ... instead" content (redirect article)
  function isRedirectArticle(event: NostrEvent): boolean {
    // Check if the content contains "Read naddr... instead." pattern
    return /Read (naddr[a-zA-Z0-9]+) instead\./.test(event.content);
  }

  function showDiff() {
    if (selectedArticles.size < 2) return;
    
    const selectedEvents = results.filter(event => selectedArticles.has(event.id));
    if (selectedEvents.length < 2) return;
    
    // Create diff query string from selected article titles
    const articleTitles = selectedEvents.map(event => 
      event.tags.find(t => t[0] === 'title')?.[1] || 
      event.tags.find(t => t[0] === 'd')?.[1] || 
      'Untitled'
    );
    
    const diffQuery = `diff::${articleTitles.join(' | ')}`;
    
    // Store selected events in a global cache with the diff query as key
    const diffKey = `diff_${diffQuery}`;
    localStorage.setItem(diffKey, JSON.stringify(selectedEvents.map(event => ({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags.map(tag => [...tag]), // Deep copy tags
      content: event.content,
      sig: event.sig
    }))));
    
    // Create diff card with just the query
    const diffCard: Card = {
      id: next(),
      type: 'diff',
      data: diffQuery
    };
    
    console.log('🔍 Creating diff card with localStorage cache:', diffCard);
    console.log('🔍 Stored events in localStorage with key:', diffKey);
    
    createChild(diffCard);
  }

  function startEditing() {
    debouncedPerformSearch.clear();
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
    if (query !== searchCard.data) {
      // replace browser url and history
      let index = $cards.findIndex((t) => t.id === card.id);
      let replacementURL = page.url.pathname.split('/').slice(1);
      replacementURL[index] = query;

      let currentState = page.state as [number, Card];
      replaceState('/' + replacementURL.join('/'), currentState[0] === index ? [] : currentState);

      // update stored card state
      searchCard.data = normalizeIdentifier(query);
      searchCard.results = undefined;

      // redo the query
      debouncedPerformSearch();
    }
  }

</script>

<div class="mt-2 font-bold text-4xl flex items-center gap-4">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  "<span
    role="textbox"
    tabindex="0"
    ondblclick={startEditing}
    onblur={finishedEditing}
    onkeydown={preventKeys}
    contenteditable="plaintext-only"
    bind:textContent={query}
  ></span>"
  
</div>

<!-- Diff Button -->
{#if results.length > 1}
  <div class="mt-4 mb-4">
    <button
      onclick={showDiff}
      disabled={selectedArticles.size < 2}
      class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors disabled:cursor-not-allowed"
      style="color: {theme.accentColor}; background-color: var(--bg-primary); border: 1px solid {theme.accentColor};"
      onmouseover={(e) => {
        if (selectedArticles.size >= 2 && e.target) {
          (e.target as HTMLButtonElement).style.opacity = '0.8';
        }
      }}
      onmouseout={(e) => {
        if (selectedArticles.size >= 2 && e.target) {
          (e.target as HTMLButtonElement).style.opacity = '1';
        }
      }}
      onfocus={(e) => {
        if (selectedArticles.size >= 2 && e.target) {
          (e.target as HTMLButtonElement).style.opacity = '0.8';
        }
      }}
      onblur={(e) => {
        if (selectedArticles.size >= 2 && e.target) {
          (e.target as HTMLButtonElement).style.opacity = '1';
        }
      }}
    >
      Diff ({selectedArticles.size}/2 selected)
    </button>
  </div>
{/if}

{#each results as result (result.id)}
  <ArticleListItem 
    event={result} 
    {openArticle} 
    toggleArticleSelection={isRedirectArticle(result) ? undefined : toggleArticleSelection} 
    selected={selectedArticles.has(result.id)} 
  />
{/each}

{#if tried}
  <div class="px-4 py-4 border-2 border-stone rounded-lg mt-4" style="background-color: var(--theme-bg);">
    <p class="mb-2 mt-0">
      {results.length < 1 ? "Can't find this article." : "Didn't find what you were looking for?"}
    </p>
    <button
      onclick={() => {
        // Create a clean, serializable card reference
        const cleanCard = {
          id: card.id,
          type: card.type,
          data: (card as any).data || null
        };
        replaceSelf({ id: next(), type: 'editor', data: { title: query, previous: cleanCard } } as any);
      }}
      class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm"
      style="font-family: {theme.typography.fontFamily};"
    >
      Create this article!
    </button>
    <button
      onclick={async () => {
        // Expand search to all available relays and relaunch
        await performSearchWithAllRelays();
      }}
      class="ml-1 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-espresso-700 bg-brown-100 hover:bg-brown-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-espresso-500"
    >
      Add more relays
    </button>
  </div>
{:else}
  <div class="px-4 py-5 rounded-lg mt-2">Loading...</div>
{/if}
