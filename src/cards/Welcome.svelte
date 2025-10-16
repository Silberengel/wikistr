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
  import UserBadge from '$components/UserBadge.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import { nip19 } from '@nostr/tools';
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
  import { getThemeConfig, getCurrentTheme } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  
  // Components
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import RelayItem from '$components/RelayItem.svelte';

  // Theme configuration
  const theme = getThemeConfig();

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

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

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

  function handleProfileClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
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
    // Use relayService to get default wiki relays
    return await relayService.getRelaysForOperation('anonymous', 'wiki-read');
  }

  async function getCombinedRelays(pubkey: string): Promise<string[]> {
    // Use relayService to get default wiki relays
    const relays = await relayService.getRelaysForOperation('anonymous', 'wiki-read');
    return [...new Set([...relays])];
  }


  // Feed Functions
  function createInboxFeed(): SubCloser {
    let sub: SubCloser | undefined;
    let cancel = account.subscribe(async (account) => {
      if (sub) sub.close();
      if (!account) return;

      // Use relay service for inbox feed
      relayService.queryEvents(
        account.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], limit: 15 }],
        {
          excludeUserContent: true,
          currentUserPubkey: account.pubkey
        }
      ).then(result => {
        currentRelays = result.relays;
        console.log('Inbox feed - relays:', result.relays);
        
        result.events.forEach(evt => {
          if (addUniqueTaggedReplaceable(results, evt)) update();
        });
      });
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
          // Use relay service for web of trust feed
          relayService.queryEvents(
            account.pubkey,
            'wiki-read',
            [{ kinds: [wikiKind], authors: eligibleKeys, limit: 20 }],
            {
              excludeUserContent: true,
              currentUserPubkey: account.pubkey
            }
          ).then(result => {
            console.log('Web of Trust feed completed');
            result.events.forEach(evt => {
              if (addUniqueTaggedReplaceable(results, evt)) update();
            });
          });
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
      
      // For anonymous users, use relayService with anonymous pubkey
      if (!account) {
        console.log('Anonymous user - using relayService for wiki content');
        
        try {
          const result = await relayService.queryEvents(
            'anonymous',
            'wiki-read',
            [{ kinds: [wikiKind], limit: 15 }],
            {
              excludeUserContent: true,
              currentUserPubkey: undefined
            }
          );
          
          currentRelays = result.relays;
          console.log('Anonymous feed - relays:', result.relays);
          
          result.events.forEach(evt => {
            if (addUniqueTaggedReplaceable(results, evt)) {
              // Populate seenCache with the relays used
              seenCache[evt.id] = result.relays;
              update();
            }
          });
        } catch (error) {
          console.error('Failed to load anonymous feed:', error);
        }
        return;
      }

      // Use relay service for logged-in users
      relayService.queryEvents(
        account.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], limit: 15 }],
        {
          excludeUserContent: true,
          currentUserPubkey: account.pubkey
        }
      ).then(result => {
        currentRelays = result.relays;
        console.log('All relays feed - relays:', result.relays);
        
        result.events.forEach(evt => {
          if (addUniqueTaggedReplaceable(results, evt)) {
            // Populate seenCache with the relays used
            seenCache[evt.id] = result.relays;
            update();
          }
        });
      });
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

      // Use relay service for self feed
      relayService.queryEvents(
        account.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], authors: [account.pubkey], limit: 15 }],
        {
          excludeUserContent: false,
          currentUserPubkey: account.pubkey
        }
      ).then(result => {
        currentRelays = result.relays;
        console.log('Self feed - relays:', result.relays);
        
        result.events.forEach(evt => {
          if (addUniqueTaggedReplaceable(results, evt)) update();
        });
      });
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

<!-- Theme-aware Header -->
<section class="mb-8 text-center" style="font-family: {theme.typography.fontFamilyHeading};">
  <h1 class="text-6xl font-bold mb-2 {theme.styling.headerStyle}" style="font-size: {theme.typography.fontSize['6xl']}; color: {theme.textColor};">{theme.title}</h1>
  <p class="text-lg italic" style="font-size: {theme.typography.fontSize.lg}; color: {theme.textColor}; opacity: 0.8;">{theme.tagline}</p>
  <div class="mt-4 text-sm" style="font-size: {theme.typography.fontSize.sm}; color: {theme.textColor}; opacity: 0.7;">
    {theme.description}
  </div>
  <div class="mt-3 text-xs border-t pt-3" style="color: {theme.textColor}; opacity: 0.9; border-color: {theme.textColor}; opacity: 0.3;">
    A <a href="https://jumble.imwald.eu/users/npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz" class="text-burgundy-700 hover:text-burgundy-800 underline">GitCitadel</a> fork of <a href="https://github.com/silberengel/wikistr" class="text-burgundy-700 hover:text-burgundy-800 underline">WikiStr</a>
  </div>
</section>

<!-- Account Section -->
<section class="mb-4">
  <h2 class="font-bold text-2xl" style="color: {theme.textColor};">Account</h2>
  
  {#if $account}
    <!-- User Profile -->
    <div class="mt-2 flex items-center justify-between">
      <div class="flex items-center">
        <UserBadge pubkey={$account.pubkey} {createChild} onProfileClick={handleProfileClick} size="medium" />
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
      <label for="feed-select" class="text-sm font-medium" style="color: {theme.textColor}; opacity: 0.8;">
        Browse articles from:
      </label>
      <select
        id="feed-select"
        bind:value={current}
        onchange={restart}
        class="px-3 py-2 border rounded-lg shadow-sm focus:outline-none transition-colors sm:text-sm w-48 {theme.styling.inputStyle}"
        style="font-family: {theme.typography.fontFamily}; font-size: {theme.typography.fontSize.sm};"
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
  <h2 class="mb-2 font-bold text-2xl" style="color: {theme.textColor};">
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

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
  {createChild}
/>

<style>
  /* Custom dropdown styling to match theme */
  #feed-select {
    background-color: rgb(253, 252, 251); /* brown-50 */
    color: rgb(87, 83, 78); /* espresso-700 */
    border-color: rgb(214, 211, 209); /* espresso-300 */
  }
  
  #feed-select:focus {
    border-color: rgb(147, 51, 234); /* burgundy-500 */
    box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1); /* burgundy-500 with opacity */
  }
  
  #feed-select:hover {
    background-color: rgb(249, 247, 244); /* brown-100 */
  }
  
  #feed-select option {
    background-color: rgb(253, 252, 251); /* brown-50 */
    color: rgb(87, 83, 78); /* espresso-700 */
    padding: 8px 12px;
  }
  
  #feed-select option:hover,
  #feed-select option:focus,
  #feed-select option:checked {
    background-color: rgb(147, 51, 234); /* burgundy-500 */
    color: white;
  }
</style>
