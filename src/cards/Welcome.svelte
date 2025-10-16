<script lang="ts">
  import { onDestroy } from 'svelte';
  import { nip19 } from '@nostr/tools';
  import type { Event, NostrEvent } from '@nostr/tools/pure';
  import type { ArticleCard, Card } from '$lib/types';
  import { relayService } from '$lib/relayService';
  import { wikiKind, account, setAccount } from '$lib/nostr';
  import { getThemeConfig } from '$lib/themes';
  import { next } from '$lib/utils';
  
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
  let current = $state(2); // Default to "all relays"
  let currentRelays = $state<string[]>([]);
  let isLoading = $state(false);
  let lastLoadTime = $state(0);

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
      function: loadInboxFeed
    },
    {
      id: 'all-relays',
      label: 'all relays',
      title: 'Articles from all relays',
      function: loadAllRelaysFeed
    },
    {
      id: 'yourself',
      label: 'yourself',
      title: 'Your articles',
      function: loadSelfFeed
    }
  ];

  const currentFeed = $derived(FEED_CONFIGS[current]);

  // Prevent doom loops with rate limiting
  const MIN_LOAD_INTERVAL = 5000; // 5 seconds minimum between loads
  
  /**
   * Rate-limited feed loading to prevent doom loops
   */
  async function loadFeed() {
    const now = Date.now();
    
    // Prevent rapid successive loads
    if (now - lastLoadTime < MIN_LOAD_INTERVAL) {
      console.log('⏳ Feed load rate limited, skipping...');
      return;
    }
    
    if (isLoading) {
      console.log('⏳ Feed already loading, skipping...');
      return;
    }
    
    isLoading = true;
    lastLoadTime = now;
    
    try {
      console.log('🔄 Loading feed:', currentFeed.label);
      await currentFeed.function();
      console.log('✅ Feed loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load feed:', error);
    } finally {
      isLoading = false;
    }
  }

  /**
   * Load inbox feed for logged-in users
   */
  async function loadInboxFeed(): Promise<void> {
    const userAccount = $account;
    if (!userAccount) {
      console.log('No account for inbox feed');
      return;
    }

    try {
      const result = await relayService.queryEvents(
        userAccount.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], limit: 15 }],
        {
          excludeUserContent: true,
          currentUserPubkey: userAccount.pubkey
        }
      );
      
      currentRelays = result.relays;
      results = result.events;
      console.log(`📰 Inbox feed: ${result.events.length} events from ${result.relays.length} relays`);
    } catch (error) {
      console.error('Failed to load inbox feed:', error);
      currentRelays = [];
      results = [];
    }
  }

  /**
   * Load all relays feed (works for anonymous users)
   */
  async function loadAllRelaysFeed(): Promise<void> {
    const userPubkey = $account?.pubkey || 'anonymous';
    
    try {
      const result = await relayService.queryEvents(
        userPubkey,
        'wiki-read',
        [{ kinds: [wikiKind], limit: 15 }],
        {
          excludeUserContent: true,
          currentUserPubkey: $account?.pubkey
        }
      );
      
      currentRelays = result.relays;
      results = result.events;
      console.log(`🌐 All relays feed: ${result.events.length} events from ${result.relays.length} relays`);
    } catch (error) {
      console.error('Failed to load all relays feed:', error);
      currentRelays = [];
      results = [];
    }
  }

  /**
   * Load self feed for logged-in users
   */
  async function loadSelfFeed(): Promise<void> {
    const userAccount = $account;
    if (!userAccount) {
      console.log('No account for self feed');
      return;
    }

    try {
      const result = await relayService.queryEvents(
        userAccount.pubkey,
        'wiki-read',
        [{ kinds: [wikiKind], authors: [userAccount.pubkey], limit: 15 }],
        {
          excludeUserContent: false,
          currentUserPubkey: userAccount.pubkey
        }
      );
      
      currentRelays = result.relays;
      results = result.events;
      console.log(`👤 Self feed: ${result.events.length} events from ${result.relays.length} relays`);
    } catch (error) {
      console.error('Failed to load self feed:', error);
      currentRelays = [];
      results = [];
    }
  }

  /**
   * Switch to a different feed
   */
  function switchFeed(newIndex: number) {
    if (newIndex === current) return;
    
    current = newIndex;
    results = []; // Clear previous results
    currentRelays = [];
    
    // Load new feed after a short delay
    setTimeout(() => {
      loadFeed();
    }, 100);
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

  // Initialize feed once when component mounts
  let initialized = false;
  
  // Watch for account changes and reload feed appropriately
  $effect(() => {
    if (!initialized) {
      initialized = true;
      // Initial load after a delay
      setTimeout(() => {
        loadFeed();
      }, 1000);
    }
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
