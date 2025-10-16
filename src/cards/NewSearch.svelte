<script lang="ts">
  import { onMount } from 'svelte';
  import { next } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';

  import type { SearchCard, Card } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
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

<!-- Search Instructions from Theme -->
<div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
  <h3 class="text-lg font-semibold text-espresso-900 mb-3">Search Instructions</h3>
  <div class="text-sm text-espresso-800 space-y-2">
    {@html theme.searchHelpText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
  </div>
</div>

<!-- Theme Relays -->
{#if relaysLoaded}
<div class="px-4 py-6 border rounded-lg mt-4" style="background-color: {theme.backgroundColor}; border-color: {theme.accentColor};">
  <h3 class="text-lg font-semibold mb-3" style="color: {theme.textColor};">Current Relays</h3>
  
  {#if themeRelays.length > 0}
    <div class="space-y-1">
      {#each themeRelays as relay}
        <div class="flex items-center justify-between p-1">
          <span class="font-mono text-sm" style="color: {theme.textColor};">{relay.url}</span>
          <div class="flex items-center space-x-2">
            <!-- Wiki icon (book/document) -->
            <svg 
              class="w-4 h-4" 
              fill="{relay.hasWiki ? theme.accentColor : '#9ca3af'}"
              viewBox="0 0 20 20"
            >
              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
            </svg>
            <!-- Social icon (users/community) -->
            <svg 
              class="w-4 h-4" 
              fill="{relay.hasSocial ? theme.accentColor : '#9ca3af'}"
              viewBox="0 0 20 20"
            >
              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
            </svg>
            <!-- User relay icon (person/user) -->
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
    <p class="text-sm italic" style="color: {theme.textColor}; opacity: 0.7;">No theme relays configured</p>
  {/if}
</div>
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
