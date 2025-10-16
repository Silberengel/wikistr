<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent, Event } from '@nostr/tools/pure';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { wot, wikiKind, userWikiRelays } from '$lib/nostr';
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

  export let card: Card;
  export let replaceSelf: (card: Card) => void;
  export let createChild: (card: Card) => void;
  let tried = false;
  let eosed = 0;
  let editable = false;

  const searchCard = card as SearchCard;

  let query: string;
  let seenCache: { [id: string]: string[] } = {};
  let results: NostrEvent[] = [];

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
          [{ kinds: [wikiKind], '#d': [normalizeIdentifier(query)], limit: 25 }],
          {
            excludeUserContent: true,
            currentUserPubkey: $account.pubkey
          }
        ).then(result => {
          result.events.forEach(evt => {
            tried = true;

            if (searchCard.preferredAuthors.includes(evt.pubkey)) {
              // we found an exact match that fits the list of preferred authors
              // jump straight into it
              openArticle(evt, undefined, true);
            }

            if (addUniqueTaggedReplaceable(results, evt)) update();
          });
        });
      }

    });

    // Multi-tier search: title, summary, then full-text
    if ($account) {
      const searchQueries = [
        // 1. title search
        { kinds: [wikiKind], '#title': [query], limit: 10 },
        // 2. summary search  
        { kinds: [wikiKind], '#summary': [query], limit: 10 },
        // 3. full-text search
        { kinds: [wikiKind], search: query, limit: 10 }
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
    let articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      relayHints: seenCache[result.id],
      actualEvent: result,
      versions:
        getTagOr(result, 'd') === normalizeIdentifier(query)
          ? results.filter((evt) => getTagOr(evt, 'd') === normalizeIdentifier(query))
          : undefined
    };
    if (ev?.button === 1) createChild(articleCard);
    else if (direct)
      // if this is called with 'direct' we won't give it a back button
      replaceSelf(articleCard);
    else replaceSelf({ ...articleCard, back: card }); // otherwise we will
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
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  "<span
    ondblclick={startEditing}
    onblur={finishedEditing}
    onkeydown={preventKeys}
    contenteditable="plaintext-only"
    bind:textContent={query}
  ></span>"
  
</div>


{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}

{#if tried}
  <div class="px-4 py-4 border-2 border-stone rounded-lg mt-4" style="background-color: var(--theme-bg);">
    <p class="mb-2 mt-0">
      {results.length < 1 ? "Can't find this article." : "Didn't find what you were looking for?"}
    </p>
    <button
      onclick={() => {
        replaceSelf({ id: next(), type: 'editor', data: { title: query, previous: card } } as any);
      }}
      class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm"
      style="font-family: {theme.typography.fontFamily};"
    >
      Create this article!
    </button>
    <button
      onclick={() => createChild({ id: next(), type: 'settings' })}
      class="ml-1 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-espresso-700 bg-brown-100 hover:bg-brown-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-espresso-500"
    >
      Add more relays
    </button>
  </div>
{:else}
  <div class="px-4 py-5 rounded-lg mt-2">Loading...</div>
{/if}
