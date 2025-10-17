<script lang="ts">
  import { onMount } from 'svelte';
  import { next } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';

  import type { SearchCard, Card } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
import ModeToggle from '$components/ModeToggle.svelte';
import ProfilePopup from '$components/ProfilePopup.svelte';
import UserBadge from '$components/UserBadge.svelte';
  import { nip19 } from '@nostr/tools';
  // import { refreshBookConfigurations } from '$lib/bookConfig';
  // import BookConfigForm from '$components/BookConfigForm.svelte';
  // import BookConfigList from '$components/BookConfigList.svelte';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    replaceNewCard: (card: Card) => void;
  }

  let { replaceNewCard }: Props = $props();
  let query = $state('');
  let showBookConfigForm = $state(false);
  let showBookConfigList = $state(false);
  let showSettings = $state(false);
  let showProfilePopup = $state(false);
  
  // Relay information
  let themeRelays = $state<{url: string, hasWiki: boolean, hasSocial: boolean, isUserRelay: boolean}[]>([]);
  let relaysLoaded = $state(false);

  function search(ev: SubmitEvent) {
    ev.preventDefault();

    if (query) {
      const newCard: SearchCard = {
        id: next(),
        type: 'find',
        data: normalizeIdentifier(query),
        preferredAuthors: []
      };
      replaceNewCard(newCard);
      query = '';
    }
  }

  async function loadRelayInfo() {
    try {
      const userPubkey = $account?.pubkey || 'anonymous';
      
      // Get theme relays directly from theme configuration
      const themeWikiRelays = theme.relays?.wiki || [];
      const themeSocialRelays = theme.relays?.social || [];
      
      // Get user relays via relay service (includes user's personal relays)
      const allWikiRelays = await relayService.getRelaysForOperation(userPubkey, 'wiki-read');
      const allSocialRelays = await relayService.getRelaysForOperation(userPubkey, 'social-read');
      
      // Find user-only relays (not in theme config)
      const allUserRelays = [...allWikiRelays, ...allSocialRelays];
      const userOnlyRelays = allUserRelays.filter(relay => 
        !themeWikiRelays.includes(relay) && !themeSocialRelays.includes(relay)
      );
      
      console.log('🔍 Relay loading debug:');
      console.log('  Theme wiki relays:', themeWikiRelays);
      console.log('  Theme social relays:', themeSocialRelays);
      console.log('  All wiki relays:', allWikiRelays);
      console.log('  All social relays:', allSocialRelays);
      console.log('  User-only relays:', userOnlyRelays);
      
      // Combine theme relays + user-only relays
      const allRelays = new Set([...themeWikiRelays, ...themeSocialRelays, ...userOnlyRelays]);
      
      // Map each relay to show its capabilities and source
      themeRelays = Array.from(allRelays).map(relay => {
        const isThemeWiki = themeWikiRelays.includes(relay);
        const isThemeSocial = themeSocialRelays.includes(relay);
        const isUserRelay = !isThemeWiki && !isThemeSocial;
        
        return {
          url: relay,
          hasWiki: isThemeWiki, // Only theme wiki relays have wiki capability
          hasSocial: isThemeSocial, // Only theme social relays have social capability
          isUserRelay: isUserRelay
        };
      });
      
      console.log('🔍 Final relay display:');
      console.log('  Total relays to display:', themeRelays.length);
      themeRelays.forEach((relay, index) => {
        console.log(`  ${index + 1}. ${relay.url} (wiki: ${relay.hasWiki}, social: ${relay.hasSocial}, user: ${relay.isUserRelay})`);
      });
      
      relaysLoaded = true;
    } catch (error) {
      console.error('Failed to load relay information:', error);
    }
  }

  // Load relay information on mount
  onMount(() => {
    loadRelayInfo();
  });

  // async function refreshBookConfigs() {
  //   try {
  //     await refreshBookConfigurations();
  //     console.log('Book configurations refreshed successfully');
  //   } catch (error) {
  //     console.error('Failed to refresh book configurations:', error);
  //   }
  // }

  // function openBookConfigForm() {
  //   showBookConfigForm = true;
  // }

  // function closeBookConfigForm() {
  //   showBookConfigForm = false;
  // }

  // function onBookConfigSuccess() {
  //   // Refresh the book configurations after successful creation
  //   refreshBookConfigs();
  // }

  // function openBookConfigList() {
  //   showBookConfigList = true;
  // }

  // function closeBookConfigList() {
  //   showBookConfigList = false;
  // }

  function toggleSettings() {
    showSettings = !showSettings;
  }

  function openProfilePopup() {
    showProfilePopup = true;
  }

  // Convert npub to hex pubkey for ProfilePopup (static, no need for reactivity)
  const hexPubkey = (() => {
    try {
      const decoded = nip19.decode('npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z');
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch (e) {
      console.error('Failed to decode npub:', e);
    }
    return 'npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z';
  })();

  function closeProfilePopup() {
    showProfilePopup = false;
  }
</script>

<form onsubmit={search} class="mt- flex rounded-md shadow-sm">
  <div class="relative flex items-stretch flex-grow focus-within:z-10">
    <input
      bind:value={query}
      class="block w-full sm:text-sm {theme.styling.inputStyle}"
      style="font-family: {theme.typography.fontFamily}; font-size: {theme.typography.fontSize.sm};"
      placeholder="article name, search term, or book:type:reference"
    />
  </div>
  <button
    type="submit"
    class="-ml-px inline-flex items-center space-x-2 px-3 py-2 text-sm font-medium rounded-r-md {theme.styling.buttonStyle}"
    style="font-family: {theme.typography.fontFamily}; font-size: {theme.typography.fontSize.sm};"
    >Go</button>
</form>

<!-- Search Instructions -->
<div class="mt-4 p-3 rounded-lg border" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};">
  <div class="text-sm whitespace-pre-line" style="color: {theme.textColor};">
    {theme.searchHelpText}
  </div>
</div>

<!-- Bottom Panel -->
<div class="mt-4 flex justify-between items-center">
  <!-- About Statement (Bottom Left) -->
  <div class="flex items-center space-x-2">
    <span class="text-xs" style="color: {theme.textColor}; opacity: 0.7;">
      Need help? Contact 
    </span>
    <UserBadge 
      pubkey="fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1"
      size="small"
      showAvatar={true}
      onProfileClick={openProfilePopup}
      hideSearchIcon={true}
    />
    <span class="text-xs" style="color: {theme.textColor}; opacity: 0.7;">
      for support.
    </span>
  </div>

  <!-- Settings Button (Bottom Right) -->
  <button
    onclick={toggleSettings}
    class="p-2 rounded-md border transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2"
    style="background-color: {theme.backgroundColor}; color: {theme.textColor}; border-color: {theme.accentColor};"
    title="Settings"
    aria-label="Open settings"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  </button>
</div>

<!-- Settings Panel -->
{#if showSettings}
<!-- Mobile: Full-screen drawer -->
<div class="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50" onclick={toggleSettings} onkeydown={(e) => e.key === 'Escape' && toggleSettings()} role="dialog" aria-modal="true" tabindex="-1">
  <div class="fixed bottom-0 left-0 right-0 p-4 rounded-t-lg border-t" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="button" tabindex="0">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold" style="color: {theme.textColor};">Settings</h3>
      <button
        onclick={toggleSettings}
        class="p-1 rounded hover:bg-gray-100 transition-colors"
        style="color: {theme.textColor};"
        aria-label="Close settings"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
    
    <!-- Mode Toggle -->
    <div class="mb-4">
      <div class="block text-sm font-medium mb-2" style="color: {theme.textColor};">Appearance</div>
      <div class="flex items-center space-x-3">
        <ModeToggle />
        <span class="text-sm" style="color: {theme.textColor}; opacity: 0.8;">Toggle light/dark mode</span>
      </div>
    </div>
    
    <!-- Relays Section -->
    <div>
      <div class="block text-sm font-medium mb-2" style="color: {theme.textColor};">Relays</div>
      {#if relaysLoaded}
        {#if themeRelays.length > 0}
          <div class="space-y-2 max-h-48 overflow-y-auto">
            {#each themeRelays as relay}
              <div class="flex items-center justify-between p-2 rounded border" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};">
                <span class="font-mono text-sm" style="color: {theme.textColor};">{relay.url}</span>
                <div class="flex items-center space-x-2">
                  <!-- Wiki icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.hasWiki ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
                  </svg>
                  <!-- Social icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.hasSocial ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
                  </svg>
                  <!-- User relay icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.isUserRelay ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                  </svg>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm italic" style="color: {theme.textColor}; opacity: 0.7;">No relays configured</p>
        {/if}
      {:else}
        <p class="text-sm" style="color: {theme.textColor}; opacity: 0.7;">Loading relays...</p>
      {/if}
    </div>
  </div>
</div>

<!-- Desktop: Popup -->
<div class="hidden md:block fixed inset-0 z-50 bg-black bg-opacity-50" onclick={toggleSettings} onkeydown={(e) => e.key === 'Escape' && toggleSettings()} role="dialog" aria-modal="true" tabindex="-1">
  <div class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 max-w-md p-4 rounded-lg border shadow-lg" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="button" tabindex="0">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold" style="color: {theme.textColor};">Settings</h3>
      <button
        onclick={toggleSettings}
        class="p-1 rounded hover:bg-gray-100 transition-colors"
        style="color: {theme.textColor};"
        aria-label="Close settings"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
    
    <!-- Mode Toggle -->
    <div class="mb-4">
      <div class="block text-sm font-medium mb-2" style="color: {theme.textColor};">Appearance</div>
      <div class="flex items-center space-x-3">
        <ModeToggle />
        <span class="text-sm" style="color: {theme.textColor}; opacity: 0.8;">Toggle light/dark mode</span>
      </div>
    </div>
    
    <!-- Relays Section -->
    <div>
      <div class="block text-sm font-medium mb-2" style="color: {theme.textColor};">Relays</div>
      {#if relaysLoaded}
        {#if themeRelays.length > 0}
          <div class="space-y-2 max-h-48 overflow-y-auto">
            {#each themeRelays as relay}
              <div class="flex items-center justify-between p-2 rounded border" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};">
                <span class="font-mono text-sm" style="color: {theme.textColor};">{relay.url}</span>
                <div class="flex items-center space-x-2">
                  <!-- Wiki icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.hasWiki ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
                  </svg>
                  <!-- Social icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.hasSocial ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
                  </svg>
                  <!-- User relay icon -->
                  <svg 
                    class="w-4 h-4" 
                    fill="{relay.isUserRelay ? theme.accentColor : '#9ca3af'}"
                    viewBox="0 0 20 20"
                  >
                    <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                  </svg>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm italic" style="color: {theme.textColor}; opacity: 0.7;">No relays configured</p>
        {/if}
      {:else}
        <p class="text-sm" style="color: {theme.textColor}; opacity: 0.7;">Loading relays...</p>
      {/if}
    </div>
  </div>
</div>
{/if}

<!-- Book Configuration Buttons - TEMPORARILY DISABLED -->
<!-- <div class="mt-3 flex gap-2">
  <button
    onclick={refreshBookConfigs}
    class="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 hover:text-gray-900 transition-colors"
    title="Refresh book configurations from Nostr events"
  >
    🔄 Refresh Books
  </button>
  
  <button
    onclick={openBookConfigList}
    class="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 border border-blue-300 rounded text-blue-700 hover:text-blue-900 transition-colors"
    title="View existing book configurations"
  >
    📚 View Configs
  </button>
  
  <button
    onclick={openBookConfigForm}
    class="text-sm px-3 py-1 bg-green-100 hover:bg-green-200 border border-green-300 rounded text-green-700 hover:text-green-900 transition-colors"
    title="Create a new book configuration"
  >
    ➕ Create Config
  </button>
</div> -->

<!-- Profile Popup -->
{#if showProfilePopup}
  <ProfilePopup
    pubkey={hexPubkey}
    bech32="npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z"
    isOpen={showProfilePopup}
    onClose={closeProfilePopup}
  />
{/if}

<!-- Book Configuration Modals - TEMPORARILY DISABLED -->
<!-- {#if showBookConfigForm}
  <BookConfigForm
    onClose={closeBookConfigForm}
    onSuccess={onBookConfigSuccess}
  />
{/if}

{#if showBookConfigList}
  <BookConfigList
    onClose={closeBookConfigList}
    onCreateNew={() => {
      closeBookConfigList();
      openBookConfigForm();
    }}
  />
{/if} -->
