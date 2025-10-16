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
  
  // Components
  import UserBadge from '$components/UserBadge.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import RelayItem from '$components/RelayItem.svelte';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    createChild: (card: Card) => void;
  }

  interface FeedConfig {
    id: string;
    label: string;
    title: string;
    function: () => Promise<void>;
  }

  // Props and State
  let { createChild }: Props = $props();
  let results = $state<Event[]>([]);
  let current = $state(1); // Default to "all relays"
  let currentRelays = $state<string[]>([]);
  let isLoading = $state(false);
  let lastLoadTime = $state(0);
  
  // Cache state
  let allRelaysUsed = $state<string[]>([]);
  let cacheTimestamp = $state(0);
  let backgroundUpdateInterval: ReturnType<typeof setInterval> | null = null;

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  // Feed Configuration
  const FEED_CONFIGS: FeedConfig[] = [
    {
      id: 'inboxes',
      label: 'your inboxes',
      title: 'Recent Articles',
      function: loadInboxWikiArticles
    },
    {
      id: 'all-relays',
      label: 'all relays',
      title: 'Articles from all relays',
      function: loadAllWikiArticles
    },
    {
      id: 'wot',
      label: 'web of trust',
      title: 'Articles from trusted users',
      function: loadWOTWikiArticles
    },
    {
      id: 'yourself',
      label: 'yourself',
      title: 'Your articles',
      function: loadAllWikiArticles
    }
  ];

  const currentFeed = $derived(FEED_CONFIGS[current]);

  // Prevent doom loops with rate limiting
  const MIN_LOAD_INTERVAL = 5000; // 5 seconds minimum between loads
  
  /**
   * Load wiki articles from inbox relays only (for inbox feed)
   */
  async function loadInboxWikiArticles(): Promise<void> {
    const userAccount = $account;
    if (!userAccount) {
      console.log('No account for inbox feed');
      results = [];
      currentRelays = [];
      return;
    }

    if (isLoading) {
      console.log('⏳ Inbox query already in progress, skipping...');
      return;
    }

    isLoading = true;

    try {
      console.log('🔄 Loading inbox wiki articles...');
      
      // Query wiki articles from inbox/social relays only
      const result = await relayService.queryEvents(
        userAccount.pubkey,
        'social-read', // Use social relays for inbox
        [{ kinds: [wikiKind], limit: 100 }],
        {
          excludeUserContent: true, // Exclude user's own content for inbox
          currentUserPubkey: userAccount.pubkey
        }
      );
      
      results = result.events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 15);
      currentRelays = result.relays;
      
      console.log(`📰 Inbox feed: ${results.length} articles from ${currentRelays.length} relays`);
      
    } catch (error) {
      console.error('❌ Failed to load inbox wiki articles:', error);
      results = [];
      currentRelays = [];
    } finally {
      isLoading = false;
    }
  }

  /**
   * Background cache update - runs periodically to keep cache fresh
   */
  async function backgroundCacheUpdate(): Promise<void> {
    try {
      console.log('🔄 Background cache update started...');
      
      const userPubkey = $account?.pubkey || 'anonymous';
      const relaySet = new Set<string>();
      
      // Only update content types that are stale
      const cacheChecks = await Promise.all([
        contentCache.isCacheFresh('wiki'),
        contentCache.isCacheFresh('reactions'),
        contentCache.isCacheFresh('deletes'),
        contentCache.isCacheFresh('kind1'),
        contentCache.isCacheFresh('kind1111'),
        contentCache.isCacheFresh('kind30041'),
        contentCache.isCacheFresh('metadata'),
        contentCache.isCacheFresh('bookConfigs')
      ]);
      
      const [wikiFresh, reactionsFresh, deletesFresh, kind1Fresh, kind1111Fresh, kind30041Fresh, metadataFresh, bookConfigsFresh] = cacheChecks;
      
      // Build queries for stale content types
      const queries = [];
      
      if (!wikiFresh) {
        queries.push(relayService.queryEvents(userPubkey, 'wiki-read', [{ kinds: [wikiKind], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!reactionsFresh) {
        // Get wiki article IDs for targeted reaction queries
        const wikiEvents = await contentCache.getEvents('wiki');
        const wikiArticleIds = wikiEvents.map(cached => cached.event.id);
        
        if (wikiArticleIds.length > 0) {
          queries.push(relayService.queryEvents(userPubkey, 'social-read', [{ kinds: [reactionKind], '#e': wikiArticleIds, limit: 200 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
        }
      }
      if (!deletesFresh) {
        queries.push(relayService.queryEvents(userPubkey, 'social-read', [{ kinds: [5], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!kind1Fresh) {
        queries.push(relayService.queryEvents(userPubkey, 'social-read', [{ kinds: [1], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!kind1111Fresh) {
        queries.push(relayService.queryEvents(userPubkey, 'social-read', [{ kinds: [1111], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!kind30041Fresh) {
        queries.push(relayService.queryEvents(userPubkey, 'wiki-read', [{ kinds: [30041], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!metadataFresh) {
        queries.push(relayService.queryEvents(userPubkey, 'metadata-read', [{ kinds: [0], limit: 100 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      if (!bookConfigsFresh) {
        queries.push(relayService.queryEvents(userPubkey, 'wiki-read', [{ kinds: [30078], limit: 50 }], { excludeUserContent: false, currentUserPubkey: $account?.pubkey }));
      }
      
      if (queries.length === 0) {
        console.log('📦 All caches are fresh, skipping background update');
        return;
      }
      
      console.log(`🔄 Updating ${queries.length} stale cache types in background...`);
      
      const results = await Promise.all(queries);
      
      // Store updated content in cache
      const storePromises = [];
      let resultIndex = 0;
      
      if (!wikiFresh) {
        storePromises.push(contentCache.storeEvents('wiki', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!reactionsFresh) {
        storePromises.push(contentCache.storeEvents('reactions', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!deletesFresh) {
        storePromises.push(contentCache.storeEvents('deletes', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!kind1Fresh) {
        storePromises.push(contentCache.storeEvents('kind1', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!kind1111Fresh) {
        storePromises.push(contentCache.storeEvents('kind1111', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!kind30041Fresh) {
        storePromises.push(contentCache.storeEvents('kind30041', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!metadataFresh) {
        storePromises.push(contentCache.storeEvents('metadata', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      if (!bookConfigsFresh) {
        storePromises.push(contentCache.storeEvents('bookConfigs', results[resultIndex].events.map(event => ({ event, relays: results[resultIndex].relays }))));
        resultIndex++;
      }
      
      await Promise.all(storePromises);
      
      // Collect relays
      results.forEach(result => result.relays.forEach(relay => relaySet.add(relay)));
      
      console.log(`✅ Background cache update completed - updated ${queries.length} content types`);
      
    } catch (error) {
      console.error('❌ Background cache update failed:', error);
    }
  }

  /**
   * Load all content from all wiki relays and cache them
   */
  async function loadAllWikiArticles(): Promise<void> {
    const now = Date.now();
    
    // Check if we have fresh cache for all content types
    const allCacheFresh = await Promise.all([
      contentCache.isCacheFresh('wiki'),
      contentCache.isCacheFresh('reactions'),
      contentCache.isCacheFresh('deletes'),
      contentCache.isCacheFresh('kind1'),
      contentCache.isCacheFresh('kind1111'),
      contentCache.isCacheFresh('kind30041'),
      contentCache.isCacheFresh('metadata'),
      contentCache.isCacheFresh('bookConfigs')
    ]);
    
    const allFresh = allCacheFresh.every(fresh => fresh) && now - cacheTimestamp < 30000;
    
    if (allFresh) {
      console.log('📦 Using fresh cached content for all types');
      buildFeedFromCache();
      return;
    }
    
    if (isLoading) {
      console.log('⏳ Content query already in progress, skipping...');
      return;
    }
    
    isLoading = true;
    cacheTimestamp = now;
    
    try {
      console.log('🔄 Loading all content from all wiki relays...');
      
      const userPubkey = $account?.pubkey || 'anonymous';
      const relaySet = new Set<string>();
      
      // First, get wiki articles to extract their IDs for reaction queries
      const wikiResult = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [wikiKind], limit: 100 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      // Extract wiki article IDs for targeted reaction queries
      const wikiArticleIds = wikiResult.events.map(event => event.id);
      
      // Parallel queries for remaining content types
      const queries = [
        // Reactions (kind 7) - only for wiki articles
        wikiArticleIds.length > 0 
          ? relayService.queryEvents(
              userPubkey,
              'social-read',
              [{ kinds: [reactionKind], '#e': wikiArticleIds, limit: 200 }],
              { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
            )
          : Promise.resolve({ events: [], relays: [] }),
        
        // Deletes (kind 5)
        relayService.queryEvents(
          userPubkey,
          'social-read',
          [{ kinds: [5], limit: 100 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        ),
        
        // Kind 1 posts
        relayService.queryEvents(
          userPubkey,
          'social-read',
          [{ kinds: [1], limit: 100 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        ),
        
        // Kind 1111 comments
        relayService.queryEvents(
          userPubkey,
          'social-read',
          [{ kinds: [1111], limit: 100 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        ),
        
        // Kind 30041 - Asciidoc Notes
        relayService.queryEvents(
          userPubkey,
          'wiki-read',
          [{ kinds: [30041], limit: 100 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        ),
        
        // Metadata (kind 0) - for user profiles
        relayService.queryEvents(
          userPubkey,
          'metadata-read',
          [{ kinds: [0], limit: 100 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        ),
        
        // Book configurations (kind 30078)
        relayService.queryEvents(
          userPubkey,
          'wiki-read',
          [{ kinds: [30078], limit: 50 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        )
      ];
      
      const results = await Promise.all(queries);
      const [reactionsResult, deletesResult, kind1Result, kind1111Result, kind30041Result, metadataResult, bookConfigsResult] = results;
      
      // Store all results in IndexedDB cache
      await Promise.all([
        contentCache.storeEvents('wiki', wikiResult.events.map(event => ({ event, relays: wikiResult.relays }))),
        contentCache.storeEvents('reactions', reactionsResult.events.map(event => ({ event, relays: reactionsResult.relays }))),
        contentCache.storeEvents('deletes', deletesResult.events.map(event => ({ event, relays: deletesResult.relays }))),
        contentCache.storeEvents('kind1', kind1Result.events.map(event => ({ event, relays: kind1Result.relays }))),
        contentCache.storeEvents('kind1111', kind1111Result.events.map(event => ({ event, relays: kind1111Result.relays }))),
        contentCache.storeEvents('kind30041', kind30041Result.events.map(event => ({ event, relays: kind30041Result.relays }))),
        contentCache.storeEvents('metadata', metadataResult.events.map(event => ({ event, relays: metadataResult.relays }))),
        contentCache.storeEvents('bookConfigs', bookConfigsResult.events.map(event => ({ event, relays: bookConfigsResult.relays })))
      ]);
      
      // Collect all relays
      [wikiResult, reactionsResult, deletesResult, kind1Result, kind1111Result, kind30041Result, metadataResult, bookConfigsResult]
        .forEach(result => result.relays.forEach(relay => relaySet.add(relay)));
      
      allRelaysUsed = Array.from(relaySet);
      
      console.log(`📦 Cached content to IndexedDB:`);
      console.log(`  📰 Wiki articles: ${wikiResult.events.length}`);
      console.log(`  ❤️  Reactions: ${reactionsResult.events.length}`);
      console.log(`  🗑️  Deletes: ${deletesResult.events.length}`);
      console.log(`  💬 Kind 1 posts: ${kind1Result.events.length}`);
      console.log(`  💭 Kind 1111 comments: ${kind1111Result.events.length}`);
      console.log(`  📝 Kind 30041 notes: ${kind30041Result.events.length}`);
      console.log(`  👤 Metadata: ${metadataResult.events.length}`);
      console.log(`  📚 Book configs: ${bookConfigsResult.events.length}`);
      console.log(`  🌐 From ${allRelaysUsed.length} relays`);
      
      // Build the current feed from cache
      buildFeedFromCache();
      
    } catch (error) {
      console.error('❌ Failed to load content:', error);
      allRelaysUsed = [];
      results = [];
      currentRelays = [];
    } finally {
      isLoading = false;
    }
  }

  /**
   * Load WOT (Web of Trust) wiki articles
   */
  async function loadWOTWikiArticles(): Promise<void> {
    const userAccount = $account;
    if (!userAccount) {
      console.log('No account for WOT feed');
      results = [];
      currentRelays = [];
      return;
    }

    if (isLoading) {
      console.log('⏳ WOT query already in progress, skipping...');
      return;
    }

    isLoading = true;

    try {
      console.log('🔄 Loading WOT wiki articles...');
      
      // Get trusted users from WOT
      const trustedUsers = $wot;
      if (!trustedUsers || trustedUsers.length === 0) {
        console.log('No trusted users found for WOT feed');
        results = [];
        currentRelays = [];
        return;
      }
      
      // Query wiki articles from trusted users using all wiki relays
      const result = await relayService.queryEvents(
        userAccount.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], authors: trustedUsers, limit: 100 }],
        {
          excludeUserContent: true, // Exclude user's own content
          currentUserPubkey: userAccount.pubkey
        }
      );
      
      results = result.events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 15);
      currentRelays = result.relays;
      
      console.log(`🔗 WOT feed: ${results.length} articles from ${currentRelays.length} relays`);
      console.log(`🔗 Trusted users: ${trustedUsers.length}`);
      
    } catch (error) {
      console.error('❌ Failed to load WOT wiki articles:', error);
      results = [];
      currentRelays = [];
    } finally {
      isLoading = false;
    }
  }
  
  /**
   * Build the current feed from cached data
   */
  function buildFeedFromCache(): void {
    const currentFeedType = currentFeed.id;
    const userPubkey = $account?.pubkey;
    
    console.log(`🏗️ Building ${currentFeedType} feed from IndexedDB cache`);
    console.log(`🏗️ User pubkey: ${userPubkey ? 'logged in' : 'anonymous'}`);
    
    let filteredEvents: Event[] = [];
    
    switch (currentFeedType) {
      case 'inboxes':
        // Inbox feed uses its own loading function, not cache
        console.log('⚠️ Inbox feed should use loadInboxWikiArticles, not cache');
        loadInboxWikiArticles();
        return;
        
      case 'all-relays':
        // Show all articles from all relays
        const cachedWikiEvents = contentCache.getEvents('wiki');
        console.log(`📦 Retrieved ${cachedWikiEvents.length} cached wiki events from cache`);
        
        filteredEvents = cachedWikiEvents
          .map(cached => cached.event)
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
          .slice(0, 15);
        
        console.log(`📰 Processed ${filteredEvents.length} events for all-relays feed`);
        break;
        
      case 'wot':
        // WOT feed uses its own loading function, not cache
        console.log('⚠️ WOT feed should use loadWOTWikiArticles, not cache');
        loadWOTWikiArticles();
        return;
        
      case 'yourself':
        // Show only user's own articles
        if (userPubkey) {
          filteredEvents = contentCache.getEvents('wiki')
            .filter(cached => cached.event.pubkey === userPubkey)
            .map(cached => cached.event)
            .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
            .slice(0, 15);
        }
        break;
    }
    
    results = filteredEvents;
    currentRelays = contentCache.getAllRelays();
    
    console.log(`✅ ${currentFeedType} feed built: ${results.length} articles from ${currentRelays.length} relays`);
    console.log(`📊 Results array:`, $state.snapshot(results));
    console.log(`📊 Current relays:`, $state.snapshot(currentRelays));
  }


  /**
   * Switch to a different feed
   */
  function switchFeed(newIndex: number, forceLoad = false) {
    console.log(`🔄 switchFeed called with index: ${newIndex}, current: ${current}, forceLoad: ${forceLoad}`);
    if (newIndex === current && !forceLoad) {
      console.log('⏭️ Same index, skipping switch');
      return;
    }
    
    current = newIndex;
    
    // Call the appropriate loading function for each feed type
    const currentFeedType = currentFeed.id;
    console.log(`🎯 Switching to feed type: ${currentFeedType}`);
    
    switch (currentFeedType) {
      case 'inboxes':
        loadInboxWikiArticles();
        break;
      case 'all-relays':
      case 'yourself':
        // Always try to build from cache first, then load fresh data if needed
        const cachedEvents = contentCache.getEvents('wiki');
        console.log(`🔍 Checking cache for ${currentFeedType}: found ${cachedEvents.length} events`);
        if (cachedEvents.length > 0) {
          console.log(`📦 Found ${cachedEvents.length} cached wiki events, building feed from cache`);
          buildFeedFromCache();
        } else {
          console.log('📦 No cached wiki events found, loading fresh data from relays');
          loadAllWikiArticles();
        }
        break;
      case 'wot':
        loadWOTWikiArticles();
        break;
    }
  }

  /**
   * Login function
   */
  async function doLogin() {
    try {
      if (!(window as any).nostr) {
        console.log('Nostr extension not found, falling back to anonymous mode');
        fallbackToAnonymous();
        return;
      }
      
      const pubkey = await (window as any).nostr.getPublicKey();
      console.log('Login successful:', pubkey);
      setAccount(pubkey);
    } catch (error) {
      console.error('Login failed, falling back to anonymous mode:', error);
      fallbackToAnonymous();
    }
  }

  /**
   * Fallback to anonymous mode
   */
  function fallbackToAnonymous() {
    // Use a dummy pubkey that won't cause hex encoding errors
    const anonymousAccount = {
      pubkey: '0000000000000000000000000000000000000000000000000000000000000000',
      name: 'Anonymous User',
      about: 'Using Wikistr in anonymous mode',
      picture: '',
      nip05: '',
      lud16: ''
    };
    
    setAccount(anonymousAccount as any);
    
    // Set Wikistr as the default theme
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'wikistr';
    if (currentTheme !== 'wikistr') {
      document.documentElement.setAttribute('data-theme', 'wikistr');
    }
    
    console.log('Falling back to anonymous mode with Wikistr theme');
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
   * Get cached content for other components to use
   */
  export function getCachedContent() {
    return {
      wiki: contentCache.getEvents('wiki'),
      reactions: contentCache.getEvents('reactions'),
      deletes: contentCache.getEvents('deletes'),
      kind1: contentCache.getEvents('kind1'),
      kind1111: contentCache.getEvents('kind1111'),
      kind30041: contentCache.getEvents('kind30041'),
      metadata: contentCache.getEvents('metadata'),
      bookConfigs: contentCache.getEvents('bookConfigs'),
      stats: contentCache.getStats(),
      allRelays: contentCache.getAllRelays()
    };
  }

  /**
   * Open article
   */
  function openArticle(result: Event) {
    createChild({
      id: next(),
      type: 'article',
      data: [result.tags.find(t => t[0] === 'd')?.[1] || '', result.pubkey],
      actualEvent: result,
      relayHints: currentRelays
    } as ArticleCard);
  }

  // Initialize wiki data when component mounts
  let initialized = false;
  
  // Watch for account changes and reload wiki data appropriately
  $effect(() => {
    if (!initialized) {
      initialized = true;
      // Initial load after ensuring cache is ready
      setTimeout(async () => {
        console.log('🚀 Initializing feed with current index:', current);
        
        // Ensure cache is loaded before switching feeds
        try {
          await contentCache.initialize();
          console.log('✅ Cache initialized, switching to feed');
        } catch (error) {
          console.error('❌ Cache initialization failed:', error);
        }
        
        switchFeed(current, true); // Force initial load
      }, 1500); // Increased delay to ensure cache is loaded
      
      // Start background cache updates every 2 minutes
      backgroundUpdateInterval = setInterval(() => {
        backgroundCacheUpdate().catch(console.error);
      }, 2 * 60 * 1000); // 2 minutes
    }
    
    // Cleanup on unmount
    return () => {
      if (backgroundUpdateInterval) {
        clearInterval(backgroundUpdateInterval);
        backgroundUpdateInterval = null;
      }
    };
  });

  // Auto-fallback to anonymous mode if no account after delay
  setTimeout(() => {
    if (!$account) {
      console.log('No account found, auto-falling back to anonymous mode');
      fallbackToAnonymous();
    }
  }, 2000);
</script>

<!-- Theme-aware Header -->
<section class="mb-8 text-center" style="font-family: {theme.typography.fontFamilyHeading};">
  <h1 class="text-6xl font-bold mb-2 {theme.styling.headerStyle}" style="font-size: {theme.typography.fontSize['6xl']}; color: {theme.textColor};">{theme.title}</h1>
  <p class="text-lg italic mx-auto max-w-prose" style="font-size: {theme.typography.fontSize.lg}; color: {theme.textColor}; opacity: 0.8; direction: rtl;">{@html theme.tagline}</p>
  <div class="mt-4 text-sm" style="font-size: {theme.typography.fontSize.sm}; color: {theme.textColor}; opacity: 0.9;">
    {theme.description}
  </div>
  <div class="mt-3 text-xs border-t pt-3" style="color: {theme.textColor}; opacity: 0.8; border-color: {theme.textColor}; opacity: 0.5;">
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
        class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        style="color: #fbbf24;"
      >
        Logout
      </button>
    </div>

    <!-- Feed Selector -->
    <div class="mt-4 flex items-center space-x-2">
      <label for="feed-select" class="text-sm font-medium" style="color: {theme.textColor}; opacity: 0.95;">
        Browse articles from:
      </label>
      <select
        id="feed-select"
        bind:value={current}
        onchange={() => switchFeed(current)}
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
  
  <!-- Loading indicator -->
  {#if isLoading}
    <div class="text-sm text-gray-500 mb-2">
      Loading articles...
    </div>
  {/if}
  
  <!-- Relay List -->
  <div class="flex items-center flex-wrap mt-2">
    <div class="mr-1 font-normal text-xs">from</div>
    {#each currentRelays as url}
      <RelayItem {url} {createChild} />
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
  {createChild}
/>
