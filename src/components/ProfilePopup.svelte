<script lang="ts">
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { nip19 } from '@nostr/tools';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    pubkey: string;
    bech32: string;
    isOpen: boolean;
    onClose: () => void;
  }

  let { pubkey, bech32, isOpen, onClose }: Props = $props();
  
  let userData = $state<any>(null);
  let loading = $state(true);
  let isMobile = $state(false);
  let aboutElement = $state<HTMLElement>();
  let nip05Verified = $state(false);
  let nip05Verifying = $state(false);

  // Detect if we're on mobile
  onMount(() => {
    const checkMobile = () => {
      isMobile = window.innerWidth < 768;
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // Fetch user profile data
  async function fetchUserData() {
    if (!isOpen || !pubkey) return;
    
    loading = true;
    userData = null;
    
    try {
      // Decode npub to get hex pubkey if needed
      let hexPubkey = pubkey;
      let npub = pubkey;
      
      if (pubkey.startsWith('npub')) {
        try {
          const decoded = nip19.decode(pubkey);
          if (decoded.type === 'npub') {
            hexPubkey = decoded.data;
            npub = pubkey; // Keep original npub
          }
        } catch (e) {
          console.error('Failed to decode npub:', e);
          throw e;
        }
      } else {
        // If it's already a hex pubkey, encode it to npub for display
        try {
          npub = nip19.npubEncode(pubkey);
        } catch (e) {
          console.error('Failed to encode npub:', e);
          npub = pubkey; // Fallback to original
        }
      }
      
      // Fetch profile data with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
      );
      
      const fetchPromise = relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [hexPubkey], limit: 1 }],
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );
      
      const result = await Promise.race([fetchPromise, timeoutPromise]) as any;
      const userEvent = result.events.find((event: any) => event.pubkey === hexPubkey && event.kind === 0);
      
      if (userEvent) {
        try {
          const content = JSON.parse(userEvent.content);
          
          userData = {
            pubkey: hexPubkey,
            npub: npub,
            display_name: content.display_name || content.name || 'Unknown',
            name: content.name || 'Unknown',
            about: content.about || '',
            picture: content.picture || '',
            banner: content.banner || '',
            website: content.website || '',
            lud16: content.lud16 || '',
            nip05: content.nip05 || ''
          };
          
        } catch (e) {
          console.error('Failed to parse user metadata:', e);
          throw e;
        }
      } else {
        userData = {
          pubkey: hexPubkey,
          npub: npub,
          display_name: 'Unknown',
          name: 'Unknown',
          about: '',
          picture: '',
          banner: '',
          website: '',
          lud16: '',
          nip05: ''
        };
      }
    } catch (e) {
      console.error('ProfilePopup: Failed to fetch user data:', e);
      userData = {
        pubkey: pubkey,
        npub: pubkey,
        display_name: 'Profile Unavailable',
        name: 'Profile Unavailable',
        about: 'Unable to load profile data. This may be due to network issues or the profile not being found.',
        picture: '',
        banner: '',
        website: '',
        lud16: '',
        nip05: ''
      };
    } finally {
      loading = false;
    }
  }

  // Initialize when component mounts
  onMount(() => {
    // Reset NIP-05 states
    nip05Verifying = false;
    nip05Verified = false;
    if (isOpen && pubkey) {
      // Set immediate fallback profile
      userData = {
        pubkey: pubkey,
        npub: pubkey,
        display_name: 'Loading...',
        name: 'Loading...',
        about: 'Loading profile data...',
        picture: '',
        banner: '',
        website: '',
        lud16: '',
        nip05: ''
      };
      loading = true; // Keep loading true until fetchUserData completes
      
      // Try to load real profile data in background
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

  // Process links in about text
  function processAboutLinks() {
    if (!aboutElement || !userData?.about) return;

    const text = userData.about;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    aboutElement.innerHTML = '';

    parts.forEach((part: string) => {
      if (urlRegex.test(part)) {
        const link = document.createElement('a');
        link.href = part;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'text-blue-600 hover:text-blue-800 underline';
        link.textContent = part;
        aboutElement?.appendChild(link);
      } else {
        const textNode = document.createTextNode(part);
        aboutElement?.appendChild(textNode);
      }
    });
  }

  // Verify NIP-05
  async function verifyNip05() {
    if (!userData?.nip05 || nip05Verifying || nip05Verified) return;
    
    nip05Verifying = true;
    
    try {
      const [name, domain] = userData.nip05.split('@');
      const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${name}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(wellKnownUrl, {
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        const names = data.names || {};
        const wellKnownPubkey = names[name];
        nip05Verified = wellKnownPubkey === userData.pubkey;
      } else {
        nip05Verified = false;
      }
      
      // Reset verifying state
      nip05Verifying = false;
    } catch (e) {
      console.error('NIP-05 verification failed:', e);
      nip05Verified = false;
    } finally {
      nip05Verifying = false;
    }
  }

  // Open NIP-05 well-known URL
  function openNip05WellKnown() {
    if (!userData?.nip05) return;
    
    const [name, domain] = userData.nip05.split('@');
    const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${name}`;
    window.open(wellKnownUrl, '_blank', 'noopener,noreferrer');
  }

  // Process links when userData changes
  $effect(() => {
    if (userData && aboutElement) {
      processAboutLinks();
    }
    
    // Verify NIP-05 when userData is loaded
    if (userData && userData.nip05 && !nip05Verifying) {
      verifyNip05();
    }
  });
</script>

<!-- Profile Popup -->
{#if isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    onclick={handleBackdropClick}
    onkeydown={(e) => {
      handleKeydown(e);
      if (e.key === 'Enter' || e.key === ' ') {
        handleBackdropClick(e as any);
      }
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="Profile popup"
  >
    <div
      class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <h3 class="text-lg font-semibold" style="color: var(--text-primary);">Profile</h3>
        <button
          onclick={onClose}
          class="transition-colors"
          style="color: var(--text-muted);"
          aria-label="Close profile"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <div class="w-8 h-8 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin" style="border-color: var(--border); border-top-color: var(--accent);"></div>
            <span class="ml-3" style="color: var(--text-secondary);">Loading profile...</span>
          </div>
        {:else if userData}
          <!-- Profile Picture and Name -->
          <div class="flex items-center space-x-4 mb-6">
            {#if userData.picture}
              <img
                src={userData.picture}
                alt={userData.display_name}
                class="w-16 h-16 rounded-full object-cover"
                onerror={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (target) target.style.display = 'none';
                }}
              />
            {:else}
              <div class="w-16 h-16 rounded-full flex items-center justify-center" style="background-color: var(--bg-tertiary);">
                <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20" style="color: var(--text-secondary);">
                  <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                </svg>
              </div>
            {/if}
            <div>
              <h2 class="text-xl font-semibold" style="color: var(--text-primary);">{userData.display_name}</h2>
              {#if userData.name && userData.name !== userData.display_name}
                <p style="color: var(--text-secondary);">@{userData.name}</p>
              {/if}
            </div>
          </div>

          <!-- About Section -->
          {#if userData.about}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">About</h4>
              <div class="whitespace-pre-wrap" style="color: var(--text-primary);" bind:this={aboutElement}>
                {userData.about}
              </div>
            </div>
          {/if}

          <!-- Website -->
          {#if userData.website}
            <div class="mb-6">
              <h4 class="font-semibold mb-1" style="color: var(--text-primary);">Website</h4>
              <a
                href={userData.website}
                target="_blank"
                rel="noopener noreferrer"
                class="text-blue-600 hover:text-blue-800 underline break-all"
              >
                {userData.website}
              </a>
            </div>
          {/if}

          <!-- NIP-05 -->
          {#if userData.nip05}
            <div class="mb-6">
              <h4 class="font-semibold mb-1">NIP-05</h4>
              <div class="flex items-center space-x-2">
                <button
                  onclick={openNip05WellKnown}
                  class="font-mono underline cursor-pointer"
                  style="color: var(--text-primary);"
                  title="Open well-known JSON"
                >
                  {userData.nip05}
                </button>
                {#if nip05Verifying && !nip05Verified}
                  <div class="w-4 h-4 border-2 rounded-full animate-spin" style="border-color: var(--border); border-top-color: var(--accent);"></div>
                {:else if nip05Verified}
                  <svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                  </svg>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Lightning -->
          {#if userData.lud16}
            <div class="mb-6">
              <h4 class="font-semibold mb-1">Lightning</h4>
              <div class="flex items-center space-x-2">
                <span class="font-mono" style="color: var(--text-primary);">{userData.lud16}</span>
                <button
                  onclick={() => navigator.clipboard.writeText(userData.lud16)}
                  class="p-1 rounded transition-colors"
                  style="background-color: var(--bg-secondary);"
                  title="Copy lightning address"
                >
                  <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
                  </svg>
                </button>
              </div>
            </div>
          {/if}

          <!-- Technical Info -->
          <div class="pt-4 border-t" style="border-color: var(--border);">
            <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Technical Info</h4>
            <div class="text-sm space-y-1" style="color: var(--text-secondary);">
              <p><span class="font-medium">Npub:</span>
                <a
                  href="https://jumble.imwald.eu/users/{userData.npub}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-mono break-all text-blue-600 hover:text-blue-800 underline ml-1"
                >
                  {userData.npub}
                </a>
              </p>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
