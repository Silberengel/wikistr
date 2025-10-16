<script lang="ts">
  import { onMount } from 'svelte';
  import { pool } from '@nostr/gadgets/global';
  import { relayService } from '$lib/relayService';
  import { nip19 } from '@nostr/tools';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    pubkey: string;
    bech32: string;
    isOpen: boolean;
    onClose: () => void;
    createChild?: ((card: any) => void) | undefined;
  }

  let { pubkey, bech32, isOpen, onClose, createChild }: Props = $props();
  
  let userData = $state<any>(null);
  let loading = $state(true);
  let isMobile = $state(false);


  // Detect if we're on mobile
  onMount(() => {
    const checkMobile = () => {
      isMobile = window.innerWidth < 768; // Tailwind md breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // Fetch user profile data when popup opens
  async function fetchUserData() {
    if (!isOpen || !pubkey) return;
    
    loading = true;
    userData = null;
    
    try {
      const result = await relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );

      const userEvent = result.events.find(event => event.pubkey === pubkey && event.kind === 0);
      let user = null;
      
      if (userEvent) {
        try {
          const content = JSON.parse(userEvent.content);
          // Generate npub from pubkey (with safety check)
          let npub = '';
          try {
            npub = nip19.npubEncode(userEvent.pubkey);
          } catch (e) {
            console.warn('Invalid pubkey for npub encoding:', userEvent.pubkey);
            npub = userEvent.pubkey; // fallback to raw pubkey
          }
          user = {
            pubkey: userEvent.pubkey,
            npub: npub,
            display_name: content.display_name,
            name: content.name,
            about: content.about,
            picture: content.picture,
            banner: content.banner,
            website: content.website,
            lud16: content.lud16,
            nip05: content.nip05,
            ...content
          };
        } catch (e) {
          console.error('Failed to parse user metadata:', e);
        }
      }
      
      userData = user;
    } catch (e) {
      console.error('ProfilePopup: Failed to fetch user data:', e);
    } finally {
      loading = false;
    }
  }

  // Watch for changes to isOpen and pubkey
  $effect(() => {
    if (isOpen && pubkey) {
      fetchUserData();
    }
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

</script>

{#if isOpen}
  <!-- Backdrop -->
  <div 
    class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
    class:items-center={!isMobile}
    class:items-end={isMobile}
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="profile-title"
  >
    <!-- Popup/Drawer Content -->
    <div 
      class="rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden"
      style="background-color: white !important;"
      class:rounded-t-lg={isMobile}
      class:rounded-b-none={isMobile}
      class:max-w-md={!isMobile}
      class:w-full={isMobile}
      class:max-h-[70vh]={!isMobile}
      class:max-h-[85vh]={isMobile}
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <h2 id="profile-title" class="text-lg font-semibold text-gray-900">
          Profile
        </h2>
        <button
          onclick={onClose}
          class="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close profile"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4 overflow-y-auto">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            <span class="ml-2 text-gray-600">Loading profile...</span>
          </div>
        {:else if userData}
          <!-- Profile Picture and Basic Info -->
          <div class="flex flex-col items-center text-center mb-6">
            <div class="mb-4">
              <UserBadge pubkey={pubkey} {createChild} size="large" />
            </div>
            
          </div>

          <!-- About Section -->
          {#if userData.about}
            <div class="mb-6">
              <h4 class="font-semibold text-gray-900 mb-2">About</h4>
              <p class="text-gray-700 whitespace-pre-wrap">{userData.about}</p>
            </div>
          {/if}

          <!-- Contact Info -->
          <div class="space-y-3">
            {#if userData.website}
              <div>
                <h4 class="font-semibold text-gray-900 mb-1">Website</h4>
                <a 
                  href={userData.website.startsWith('http') ? userData.website : `https://${userData.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-burgundy-700 hover:text-burgundy-800 underline break-all"
                >
                  {userData.website}
                </a>
              </div>
            {/if}

            {#if userData.nip05}
              <div>
                <h4 class="font-semibold text-gray-900 mb-1">NIP-05</h4>
                <span class="text-gray-700 font-mono">{userData.nip05}</span>
              </div>
            {/if}

            {#if userData.lud16}
              <div>
                <h4 class="font-semibold text-gray-900 mb-1">Lightning</h4>
                <span class="text-gray-700 font-mono">{userData.lud16}</span>
              </div>
            {/if}
          </div>

          <!-- Technical Info -->
          <div class="mt-6 pt-4 border-t border-gray-200">
            <h4 class="font-semibold text-gray-900 mb-2">Technical Info</h4>
            <div class="text-sm text-gray-600 space-y-1">
              {#if bech32.startsWith('npub1')}
                <p><span class="font-medium">Npub:</span> 
                  <a 
                    href="https://jumble.imwald.eu/users/{bech32}" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    class="font-mono break-all text-burgundy-700 hover:text-burgundy-800 underline"
                  >
                    {bech32}
                  </a>
                </p>
              {:else if bech32.startsWith('nprofile1')}
                <p><span class="font-medium">Nprofile:</span> <span class="font-mono break-all">{bech32}</span></p>
                <p><span class="font-medium">Npub:</span> 
                  <a 
                    href="https://jumble.imwald.eu/users/{userData.npub}" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    class="font-mono break-all text-burgundy-700 hover:text-burgundy-800 underline"
                  >
                    {userData.npub}
                  </a>
                </p>
              {/if}
              <p><span class="font-medium">Public Key:</span> <span class="font-mono break-all">{userData.pubkey}</span></p>
            </div>
          </div>
        {:else}
          <div class="text-center py-8">
            <p class="text-gray-500">Failed to load profile data</p>
            <p class="text-sm text-gray-400 mt-1">The user may not have published their profile information</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Custom scrollbar for the content area */
  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
  }
</style>

