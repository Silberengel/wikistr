<script lang="ts">
  // Svelte
  import { onDestroy } from 'svelte';
  
  // External Libraries
  import debounce from 'debounce';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { Event, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';

  // Local Imports
  import {
    signer,
    wikiKind,
    account,
    wot,
    getBasicUserWikiRelays,
    setAccount
  } from '$lib/nostr';
  import type { ArticleCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next } from '$lib/utils';
  import { DEFAULT_WIKI_RELAYS } from '$lib/defaults';
  
  // Components
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import RelayItem from '$components/RelayItem.svelte';

  // Types
  interface Props {
    createChild: (card: Card) => void;
  }

  interface FeedConfig {
    id: string;
    label: string;
    title: string;
    function: () => SubCloser;
  }

  interface SubscriptionFilter {
    kinds: number[];
    authors?: string[];
    limit: number;
    [key: `#${string}`]: string | string[];
  }

  interface SeenCache {
    [eventId: string]: string[];
  }

  // Props and State
  let { createChild }: Props = $props();
  let seenCache: SeenCache = {};
  let results = $state<Event[]>([]);
  let current = $state(2); // Default to "all relays"
  let currentRelays = $state<string[]>([]);

  // Feed Configuration
  const FEED_CONFIGS: FeedConfig[] = [
    {
      id: 'web-of-trust',
      label: 'your web of trust',
      title: 'Articles from your web of trust',
      function: createWebOfTrustFeed
    },
    {
      id: 'inboxes',
      label: 'your inboxes',
      title: 'Recent Articles',
      function: createInboxFeed
    },
    {
      id: 'all-relays',
      label: 'all relays',
      title: 'Articles from all relays',
      function: createAllRelaysFeed
    },
    {
      id: 'yourself',
      label: 'yourself',
      title: 'Your articles',
      function: createSelfFeed
    }
  ];

  const currentFeed = $derived(FEED_CONFIGS[current]);

  const update = debounce(() => {
    // sort by an average of newness and wotness
    results.sort((a, b) => {
      const wotA = $wot[a.pubkey] || 0;
      const wotB = $wot[b.pubkey] || 0;
      let wotAvg = (wotA + wotB) / 2 || 1;
      let tsAvg = (a.created_at + b.created_at) / 2;
      return wotB / wotAvg + b.created_at / tsAvg - (wotA / wotAvg + a.created_at / tsAvg);
    });
    results = results;
    seenCache = seenCache;
  }, 500);

  let close: SubCloser = { close: () => {} };

  onDestroy(() => {
    close.close();
  });

  function doLogin() {
    signer.getPublicKey();
  }

  function doLogout() {
    // Clear the account from local storage
    import('idb-keyval').then(({ del }) => {
      del('wikistr:loggedin');
    });
    // Reset the account store
    setAccount(null);
  }

  function openArticle(result: Event) {
    createChild({
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      actualEvent: result,
      relayHints: seenCache[result.id] || []
    } as ArticleCard);
  }

  // Helper Functions
  async function getUserInboxRelays(pubkey: string): Promise<string[]> {
    // Only use DEFAULT_WIKI_RELAYS to avoid querying user's relay lists
    return DEFAULT_WIKI_RELAYS;
  }

  async function getCombinedRelays(pubkey: string): Promise<string[]> {
    // Only use DEFAULT_WIKI_RELAYS to avoid querying user's relay lists
    return [...new Set([...DEFAULT_WIKI_RELAYS])];
  }

  function createSubscription(
    relays: string[],
    filter: SubscriptionFilter,
    id: string,
    onComplete?: () => void
  ): SubCloser {
    return pool.subscribeMany(relays, [filter as any], {
      id,
      onevent,
      receivedEvent: receivedEvent as any,
      ...(onComplete && { oneose: onComplete })
    });
  }

  // Feed Functions
  function createInboxFeed(): SubCloser {
    let sub: SubCloser | undefined;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();
      if (!account) return;

      const inboxRelays = await getUserInboxRelays(account.pubkey);
      const relays = inboxRelays.length > 0 ? inboxRelays : await getBasicUserWikiRelays(account.pubkey);
      currentRelays = relays;

      console.log('Inbox feed - relays:', relays);

      sub = createSubscription(
        relays,
        { kinds: [wikiKind], limit: 15 },
        'inbox'
      );
    });

    return {
      close: () => {
        if (sub) sub.close();
        cancel();
      }
    };
  }

  function createWebOfTrustFeed(): SubCloser {
    let sub: SubCloser | undefined;
    let wotsubclose: () => void;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();
      if (wotsubclose) wotsubclose();
      if (!account) return;

      const allRelays = await getCombinedRelays(account.pubkey);
      currentRelays = allRelays;

      wotsubclose = wot.subscribe((wot) => {
        if (sub) sub.close();

        const eligibleKeys = Object.entries(wot)
          .filter(([_, v]) => v >= 20)
          .map(([k]) => k);

        console.log('Web of Trust feed - Eligible authors:', eligibleKeys.length, eligibleKeys);
        
        if (eligibleKeys.length > 0) {
          sub = createSubscription(
            allRelays,
            { kinds: [wikiKind], authors: eligibleKeys, limit: 20 },
            'follows',
            () => console.log('Web of Trust feed completed')
          );
        } else {
          console.log('No eligible authors found in Web of Trust');
        }
      });
    });

    return {
      close: () => {
        if (sub) sub.close();
        if (wotsubclose) wotsubclose();
        cancel();
      }
    };
  }

  function createAllRelaysFeed(): SubCloser {
    let sub: SubCloser | undefined;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();
      if (!account) return;

      const allRelays = await getCombinedRelays(account.pubkey);
      currentRelays = allRelays;
      console.log('All relays feed - relays:', allRelays);

      sub = createSubscription(
        allRelays,
        { kinds: [wikiKind], limit: 15 },
        'allrelays'
      );
    });

    return {
      close: () => {
        if (sub) sub.close();
        cancel();
      }
    };
  }

  function createSelfFeed(): SubCloser {
    let sub: SubCloser | undefined;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();
      if (!account) return;

      const allRelays = await getCombinedRelays(account.pubkey);
      currentRelays = allRelays;
      console.log('Self feed - relays:', allRelays);

      sub = createSubscription(
        allRelays,
        { kinds: [wikiKind], authors: [account.pubkey], limit: 15 },
        'self'
      );
    });

    return {
      close: () => {
        if (sub) sub.close();
        cancel();
      }
    };
  }

  // Feed Management
  function restart() {
    close.close();
    results = [];
    seenCache = {};
    console.log('Switching to feed:', currentFeed.label);
    close = currentFeed.function();
  }

  setTimeout(restart, 400);

  function onevent(evt: NostrEvent) {
    if (addUniqueTaggedReplaceable(results, evt)) update();
  }

  function receivedEvent(relay: AbstractRelay, id: string) {
    if (!(id in seenCache)) seenCache[id] = [];
    if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
  }
</script>

<!-- Account Section -->
<section class="mb-4">
  <h1 class="font-bold text-4xl">Account</h1>
  
  {#if $account}
    <!-- User Profile -->
    <div class="mt-2 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        {#if $account.image && !$account.image.includes('void.cat')}
          <img 
            class="h-12 w-12 rounded-full" 
            src={$account.image} 
            alt="user avatar"
            onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
          />
        {/if}
        <div>
          <p class="text-sm font-medium text-gray-900">{$account.shortName}</p>
          <p class="text-xs text-gray-500 truncate w-48">{$account.npub}</p>
        </div>
      </div>
      <button
        onclick={doLogout}
        type="button"
        class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-white"
      >
        Logout
      </button>
    </div>

    <!-- Feed Selector -->
    <div class="mt-4 flex items-center space-x-2">
      <label for="feed-select" class="text-sm font-medium text-gray-700">
        Browse articles from:
      </label>
      <select
        id="feed-select"
        bind:value={current}
        onchange={restart}
        class="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
      >
        {#each FEED_CONFIGS as feed, index}
          <option value={index}>{feed.label}</option>
        {/each}
      </select>
    </div>
  {:else}
    <!-- Login Button -->
    <div class="mt-2">
      <button
        onclick={doLogin}
        type="submit"
        class="btn-primary"
      >
        Login
      </button>
    </div>
  {/if}
</section>

<!-- Articles Section -->
<section>
  <h2 class="mb-2 font-bold text-4xl">
    {currentFeed.title}
  </h2>
  
  <!-- Relay List -->
  <div class="flex items-center flex-wrap mt-2">
    <div class="mr-1 font-normal text-xs">from</div>
    {#each currentRelays as url}
      <RelayItem {url} {createChild} />
    {/each}
  </div>

  <!-- Article List -->
  <div class="mt-4">
    {#each results as result (result.id)}
      <ArticleListItem event={result} {openArticle} />
    {/each}
  </div>
</section>
