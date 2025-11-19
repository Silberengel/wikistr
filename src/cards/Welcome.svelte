<script lang="ts">
  import { onDestroy } from 'svelte';
  import { nip19 } from '@nostr/tools';
  import type { Event, NostrEvent } from '@nostr/tools/pure';
  import type { ArticleCard, Card } from '$lib/types';
  import { relayService } from '$lib/relayService';
  import { wikiKind, reactionKind, account, setAccount, wot } from '$lib/nostr';
  import { getThemeConfig } from '$lib/themes';
  import { next } from '$lib/utils';
  import { contentCache } from '$lib/contentCache';
  import { cards } from '$lib/state';
  
  // Components
  import UserBadge from '$components/UserBadge.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import ModeToggle from '$components/ModeToggle.svelte';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    createChild: (card: Card) => void;
  }

  interface FeedConfig {
    id: string;
    label: string;
    title: string;
  }

  // Props and State
  let { createChild }: Props = $props();
  let results = $state<Event[]>([]);
  let currentRelays = $state<string[]>([]);
  let isLoading = $state(false);
  
  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  // Simple feed - no filtering
  const currentFeed = {
    id: 'all-relays',
    label: 'all relays',
    title: 'Articles from all relays'
  };
  
  // Get the currently selected relay URL from the cards array
  const selectedRelayUrl = $derived.by(() => {
    const relayCard = $cards.find(card => card.type === 'relay');
    return relayCard ? (relayCard as any).data : null;
  });

  /**
   * Build feed from cache - filter out non-wiki events
   */
  function buildFeedFromCache(): void {
    const allCachedEvents = contentCache.getEvents('wiki');
    
    // Only include actual wiki article kinds
    const wikiKinds = [30818, 30817, 30040, 30041];
    
    // Valid d-tag pattern: only alphanumeric and hyphens (no spaces, underscores, or special symbols)
    const validDTagPattern = /^[a-zA-Z0-9-]+$/;
    
    // Deduplicate replaceable events by a-tag, keeping only the newest
    const deduplicated = new Map<string, Event>();
    
    for (const cached of allCachedEvents) {
      const event = cached.event;
      
      // Only process wiki article kinds
      if (!wikiKinds.includes(event.kind)) {
        continue;
      }
      
      const isReplaceable = event.kind === 30818 || event.kind === 30817 || event.kind === 30041 || event.kind === 1111;
      
      if (isReplaceable) {
        const dTag = event.tags.find(([t]) => t === 'd')?.[1];
        if (dTag) {
          // Skip events with invalid d-tags (contains spaces, special symbols, etc.)
          if (!validDTagPattern.test(dTag)) {
            continue;
          }
          
          const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
          const existing = deduplicated.get(aTag);
          if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
            deduplicated.set(aTag, event);
          }
          continue;
        } else {
          // Skip replaceable events without d-tags
          continue;
        }
      }
      
      // For non-replaceable events, use event.id
      const existing = deduplicated.get(event.id);
      if (!existing) {
        deduplicated.set(event.id, event);
      }
    }
    
    // Sort by created_at (newest first) and take top 100
    results = Array.from(deduplicated.values())
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 100);
    
    currentRelays = contentCache.getAllRelays();
  }


  // No feed switching needed - just one simple feed

  /**
   * Update all caches immediately on mount
   */
  async function updateAllCaches(): Promise<void> {
    try {
      const userPubkey = $account?.pubkey || 'anonymous';
      
      // Update wiki cache - include all wiki kinds: 30818, 30817, 30040, 30041
      const wikiKinds = [30818, 30817, 30040, 30041];
      const wikiResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: wikiKinds, limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (wikiResult.events.length > 0) {
        await contentCache.storeEvents('wiki', wikiResult.events.map(event => ({ event, relays: wikiResult.relays })));
      }
      
      // Update reactions cache
      const reactionsResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [reactionKind], limit: 200 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (reactionsResult.events.length > 0) {
        await contentCache.storeEvents('reactions', reactionsResult.events.map(event => ({ event, relays: reactionsResult.relays })));
      }
      
      // Update deletes cache
      const deletesResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [5], limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (deletesResult.events.length > 0) {
        await contentCache.storeEvents('deletes', deletesResult.events.map(event => ({ event, relays: deletesResult.relays })));
      }
      
      // Update kind1 cache
      const kind1Result = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [1], limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (kind1Result.events.length > 0) {
        await contentCache.storeEvents('kind1', kind1Result.events.map(event => ({ event, relays: kind1Result.relays })));
      }
      
      // Update kind1111 cache
      const kind1111Result = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [1111], limit: 200 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (kind1111Result.events.length > 0) {
        await contentCache.storeEvents('kind1111', kind1111Result.events.map(event => ({ event, relays: kind1111Result.relays })));
      }
      
      // Update kind30041 cache
      const kind30041Result = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [30041], limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (kind30041Result.events.length > 0) {
        await contentCache.storeEvents('kind30041', kind30041Result.events.map(event => ({ event, relays: kind30041Result.relays })));
      }
      
      // Update metadata cache
      const authors = [...new Set(wikiResult.events.map(event => event.pubkey))];
      if (authors.length > 0) {
        const metadataResult = await relayService.queryEvents(
          'anonymous',
          'metadata-read',
          [{ kinds: [0], authors, limit: authors.length }],
          { excludeUserContent: false, currentUserPubkey: undefined }
        );
        
        if (metadataResult.events.length > 0) {
          await contentCache.storeEvents('metadata', metadataResult.events.map(event => ({ event, relays: metadataResult.relays })));
        }
      }
      
      // Update bookConfigs cache
      const bookConfigsResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [30078], '#d': ['wikistr-book-config'], limit: 50 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (bookConfigsResult.events.length > 0) {
        await contentCache.storeEvents('bookConfigs', bookConfigsResult.events.map(event => ({ event, relays: bookConfigsResult.relays })));
      }
      
    } catch (error) {
      console.error('❌ Failed to update all caches on mount:', error);
    }
  }

  /**
   * Background cache update - runs periodically
   */
  async function backgroundCacheUpdate(): Promise<void> {
    try {
      const userPubkey = $account?.pubkey || 'anonymous';
      
      // Always update wiki cache to ensure it's populated
      
      // Update wiki cache - include all wiki kinds: 30818, 30817, 30040, 30041
      const wikiKinds = [30818, 30817, 30040, 30041];
      const wikiResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: wikiKinds, limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      // Store wiki events in cache
      if (wikiResult.events.length > 0) {
        await contentCache.storeEvents('wiki', wikiResult.events.map(event => ({ event, relays: wikiResult.relays })));
        
        // Rebuild feed with new data
        buildFeedFromCache();
      }
      
      // Check other caches for updates
      const cacheChecks = await Promise.all([
        contentCache.isCacheFresh('reactions'),
        contentCache.isCacheFresh('metadata')
      ]);
      
      const [reactionsFresh, metadataFresh] = cacheChecks;
      
      const queries = [];
      
      if (!reactionsFresh) {
        const wikiEvents = contentCache.getEvents('wiki');
        const articleIds = wikiEvents.map(cached => cached.event.id);
        
        if (articleIds.length > 0) {
          // Batch article IDs to avoid "too many tags" relay errors
          // Most relays limit tag arrays to ~10-20 items, use conservative size
          const BATCH_SIZE = 10;
          const batches: string[][] = [];
          
          for (let i = 0; i < articleIds.length; i += BATCH_SIZE) {
            batches.push(articleIds.slice(i, i + BATCH_SIZE));
          }
          
          // Create a query for each batch
          for (const batch of batches) {
            queries.push(
              relayService.queryEvents(
                userPubkey,
                'wiki-read',
                [{ kinds: [reactionKind], '#e': batch, limit: 200 }],
                { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
              )
            );
          }
        }
      }
      
      if (!metadataFresh) {
        const wikiEvents = contentCache.getEvents('wiki');
        const authors = [...new Set(wikiEvents.map(cached => cached.event.pubkey))];
        
        if (authors.length > 0) {
          queries.push(
            relayService.queryEvents(
              'anonymous',
              'metadata-read',
              [{ kinds: [0], authors, limit: authors.length }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            )
          );
        }
      }
      
      if (queries.length === 0) {
        return;
      }
      
      const results = await Promise.all(queries);
      
      // Store results in cache
      let resultIndex = 0;
      const storePromises = [];
      
      
      if (!reactionsFresh) {
        storePromises.push(
          contentCache.storeEvents('reactions', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays })))
        );
        resultIndex++;
      }
      
      if (!metadataFresh) {
        storePromises.push(
          contentCache.storeEvents('metadata', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays })))
        );
        resultIndex++;
      }
      
      await Promise.all(storePromises);
      
    } catch (error) {
      console.error('❌ Background cache update failed:', error);
    }
  }

  /**
   * Login function
   */
  async function doLogin() {
    try {
      if (!(window as any).nostr) {
        return;
      }
      
      const pubkey = await (window as any).nostr.getPublicKey();
      setAccount(pubkey);
    } catch (error) {
      console.error('Login failed:', error);
    }
  }

  /**
   * Logout function
   */
  function doLogout() {
    import('idb-keyval').then(({ del }) => {
      del('wikistr:loggedin');
    });
    setAccount(null);
  }

  /**
   * Handle profile click
   */
  function handleProfileClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
  }

  /**
   * Open article
   */
  function openArticle(result: Event) {
    const cleanEvent = {
      id: result.id,
      pubkey: result.pubkey,
      created_at: result.created_at,
      kind: result.kind,
      tags: result.tags.map(tag => [...tag]),
      content: result.content,
      sig: result.sig
    };
    
    createChild({
      id: next(),
      type: 'article',
      data: [result.tags.find(t => t[0] === 'd')?.[1] || '', result.pubkey],
      actualEvent: cleanEvent,
      relayHints: currentRelays
    } as ArticleCard);
  }

  // Initialize
  let initialized = false;
  let backgroundInterval: ReturnType<typeof setInterval> | null = null;
  
  $effect(() => {
    if (!initialized) {
      initialized = true;
      
      // Initialize cache and force update all caches immediately on mount
      (async () => {
        try {
          await contentCache.initialize();
          
          // Force update ALL caches immediately on mount
          await updateAllCaches();
          
          buildFeedFromCache();
        } catch (error) {
          console.error('❌ Cache initialization failed:', error);
        }
      })();
      
      // Start background updates
      backgroundInterval = setInterval(() => {
        if (!isLoading) {
          backgroundCacheUpdate().catch(console.error);
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
    
    return () => {
      if (backgroundInterval) {
        clearInterval(backgroundInterval);
        backgroundInterval = null;
      }
    };
  });
</script>

<!-- Theme-aware Header -->
<section class="mb-8 text-center" style="font-family: {theme.typography.fontFamilyHeading};">
  <h1 class="text-6xl font-bold mb-2" style="color: var(--text-primary);">{theme.title}</h1>
  <p class="text-lg italic mx-auto max-w-prose" style="color: var(--text-primary); opacity: 0.8;" dir={theme.readingDirection}>{@html theme.tagline}</p>
  <div class="mt-4 text-sm" style="color: var(--text-primary); opacity: 0.9;">
    {theme.description}
  </div>
  <div class="mt-3 text-xs border-t pt-3" style="color: var(--text-secondary); border-color: var(--border);">
    A <a href="https://jumble.imwald.eu/users/npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz" style="color: var(--accent); text-decoration: underline;">GitCitadel</a> fork of <a href="https://github.com/silberengel/wikistr" style="color: var(--accent); text-decoration: underline;">WikiStr</a>
  </div>
</section>

<!-- Account Section -->
<section class="mb-4">
  <h2 class="font-bold text-2xl" style="color: var(--text-primary);">Account</h2>
  
  {#if $account}
    <!-- User Profile -->
    <div class="mt-2 flex items-center justify-between">
      <div class="flex items-center">
        {#if $account?.pubkey}
          <UserBadge pubkey={$account.pubkey} {createChild} onProfileClick={handleProfileClick} size="medium" hideSearchIcon={false} />
        {/if}
      </div>
      <button
        onclick={doLogout}
        type="button"
        class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
        style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
      >
        Logout
      </button>
    </div>

  {:else}
    <!-- Login Button -->
    <div class="mt-2">
      <button
        onclick={doLogin}
        type="submit"
        class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
        style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
      >
        Login
      </button>
    </div>
  {/if}
</section>

<!-- Articles Section -->
<section>
  <h2 class="mb-2 font-bold text-2xl" style="color: var(--text-primary);">
    {currentFeed.title}
  </h2>
  
  <!-- Article count -->
  {#if $account}
    <div class="text-sm text-gray-600 dark:text-gray-400 mb-2">
      Articles count: ({results.length})
    </div>
  {/if}
  
  <!-- Loading indicator -->
  {#if isLoading}
    <div class="text-sm text-gray-500 mb-2">
      Loading articles...
    </div>
  {/if}
  
  <!-- Current Relays List -->
  <div class="flex items-center flex-wrap mt-2">
    <div class="mr-1 font-normal text-xs">from</div>
    {#each currentRelays as url}
      <RelayItem {url} {createChild} selected={selectedRelayUrl && (url === selectedRelayUrl || url.includes(selectedRelayUrl.replace(/^wss?:\/\//, '').replace(/\/$/, '')))} />
    {/each}
  </div>

  <!-- Article List -->
  <div class="mt-4">
    {#if results.length === 0 && !isLoading}
      <div class="text-sm text-gray-500">
        No articles found. Try switching feeds or check your relay connections.
      </div>
    {:else}
      {#each results as result (result.id)}
        <ArticleListItem event={result} {openArticle} />
      {/each}
    {/if}
  </div>
</section>

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
/>
