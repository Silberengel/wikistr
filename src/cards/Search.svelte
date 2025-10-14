<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent, Event } from '@nostr/tools/pure';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { wot, wikiKind, userWikiRelays } from '$lib/nostr';
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique } from '$lib/utils';
  import { DEFAULT_SEARCH_RELAYS, DEFAULT_WIKI_RELAYS, DEFAULT_METADATA_QUERY_RELAYS } from '$lib/defaults';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import { isDiffQuery } from '$lib/diff';

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
  let search: SubCloser;
  let subs: SubCloser[] = [];

  onMount(() => {
    query = searchCard.data;
    
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
    if (searchCard.results) {
      seenCache = searchCard.seenCache || {};
      results = searchCard.results || [];

      tried = true;
      return;
    }

    performSearch();
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

    setTimeout(() => {
      tried = true;
    }, 1500);

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

      let subc = pool.subscribeMany(
        relaysToUseNow,
        [{ kinds: [wikiKind], '#d': [normalizeIdentifier(query)], limit: 25 }],
        {
          id: 'find-exactmatch',
          onevent(evt) {
            tried = true;

            if (searchCard.preferredAuthors.includes(evt.pubkey)) {
              // we found an exact match that fits the list of preferred authors
              // jump straight into it
              openArticle(evt, undefined, true);
            }

            if (addUniqueTaggedReplaceable(results, evt)) update();
          },
          oneose,
          receivedEvent: (relay: any, id: string) => {
            if (!(id in seenCache)) seenCache[id] = [];
            if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
          }
        }
      );

      subs.push(subc);
    });

    // Multi-tier search: d-tag, title, summary, then full-text
    const searchQueries = [
      // 1. d-tag search (already done above with exact match)
      // 2. title search
      { kinds: [wikiKind], '#title': [query], limit: 10 },
      // 3. summary search  
      { kinds: [wikiKind], '#summary': [query], limit: 10 },
      // 4. full-text search
      { kinds: [wikiKind], search: query, limit: 10 }
    ];

    // Search all queries using the same relay sets, but prioritize by author WOT score
    searchQueries.forEach((searchQuery, index) => {
      const sub = pool.subscribeMany(
        DEFAULT_SEARCH_RELAYS,
        [searchQuery],
        {
          id: `find-search-${index}`,
          onevent(evt) {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          },
          oneose,
          receivedEvent: (relay: any, id: string) => {
            if (!(id in seenCache)) seenCache[id] = [];
            if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
          }
        }
      );
      subs.push(sub);
    });

    function oneose() {
      eosed++;
      // We now have: exact match (1) + title search (1) + summary search (1) + full-text search (1) = 4 total
      if (eosed === 4) {
        tried = true;
        searchCard.results = results;
        searchCard.seenCache = seenCache;
      }
    }

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

<div class="mt-2 font-bold text-4xl">
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  "<span
    on:dblclick={startEditing}
    on:blur={finishedEditing}
    on:keydown={preventKeys}
    contenteditable="plaintext-only"
    bind:textContent={query}
  ></span>"
</div>
{#if !tried && results.length === 0}
  <!-- Bible Search Instructions -->
  <div class="px-4 py-6 bg-blue-50 border border-blue-200 rounded-lg mt-4">
    <h3 class="text-lg font-semibold text-blue-900 mb-3">🔍 Search Instructions</h3>
    <div class="text-sm text-blue-800 space-y-2">
      <p><strong>This search finds wiki articles using multi-tier search:</strong></p>
      <ul class="text-xs text-blue-700 ml-4 space-y-1">
        <li>• <strong>d-tag</strong> (exact identifier match)</li>
        <li>• <strong>title</strong> (title tag matches)</li>
        <li>• <strong>summary</strong> (summary tag matches)</li>
        <li>• <strong>full-text</strong> (content search)</li>
      </ul>
      <p><strong>To search for Bible passages, use:</strong></p>
      <div class="bg-white p-3 rounded border border-blue-200 font-mono text-xs">
        <div>/bible:John 3:16</div>
        <div>/bible:John 3:16 | KJV</div>
        <div>/bible:Psalm 23:1</div>
        <div>/bible:Genesis 1:1 | KJV</div>
        <div>/bible:Romans 1:16-25; Psalm 19:2-3</div>
        <div>/bible:Romans 1:16-25 | KJV DRB</div>
      </div>
      <p><strong>In wiki articles, use Bible wikilinks:</strong></p>
      <div class="bg-white p-3 rounded border border-blue-200 font-mono text-xs">
        <div>[[bible:John 3:16 | KJV]]</div>
        <div>[[bible:Psalm 23:1]]</div>
        <div>[[bible:Genesis 1:1 | KJV]]</div>
        <div>[[bible:Romans 1:16-25; Psalm 19:2-3]]</div>
        <div>[[bible:Romans 1:16-25 | KJV DRB]]</div>
      </div>
      <p class="text-xs text-blue-600 mt-2">
        💡 Use <code>bible:</code> prefix to avoid false positives with names like "John Smith". Case and whitespace are flexible: <code>john3:16</code> works the same as <code>John 3:16</code>
      </p>
      <p class="text-xs text-blue-600 mt-2">
        🔍 <strong>Compare content with diff:</strong>
      </p>
      <div class="bg-white p-3 rounded border border-blue-200 font-mono text-xs mt-1">
        <div>diff::article1 | article2</div>
        <div>diff::bible:John 3:16 KJV | NIV</div>
        <div>diff::article1; article2; article3</div>
        <div>diff::John 3:16 KJV | ESV</div>
      </div>
      <p class="text-xs text-blue-600 mt-1">
        💡 Use <code>diff::</code> prefix to compare wiki articles, Bible versions, or any content. Supports pipe <code>|</code> and semicolon <code>;</code> separation.
      </p>
    </div>
  </div>
{/if}

{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}
{#if tried}
  <div class="px-4 py-4 bg-white border-2 border-stone rounded-lg mt-4">
    <p class="mb-2 mt-0">
      {results.length < 1 ? "Can't find this article." : "Didn't find what you were looking for?"}
    </p>
    <button
      on:click={() => {
        replaceSelf({ id: next(), type: 'editor', data: { title: query, previous: card } } as any);
      }}
      class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
    >
      Create this article!
    </button>
    <button
      on:click={() => createChild({ id: next(), type: 'settings' })}
      class="ml-1 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
    >
      Add more relays
    </button>
  </div>
{:else}
  <div class="px-4 py-5 rounded-lg mt-2">Loading...</div>
{/if}
