<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { DEFAULT_WIKI_RELAYS } from '$lib/defaults';
  import { formatDate } from '$lib/utils';
  import AsciidocContent from './AsciidocContent.svelte';
  import { nip19 } from '@nostr/tools';
  import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import UserBadge from './UserBadge.svelte';
  import ProfilePopup from './ProfilePopup.svelte';

  interface Props {
    bech32: string;
    type: 'nevent' | 'note' | 'naddr';
    onClose?: () => void;
    createChild?: ((card: any) => void) | undefined;
  }

  let { bech32, type, onClose, createChild }: Props = $props();
  
  let event = $state<NostrEvent | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let user = $state<NostrUser | null>(null);
  let pubkey = $state<string>('');

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  // Helper function to get display name for tags
  function getTagValue(event: NostrEvent, tagName: string): string | null {
    const tag = event.tags.find(([name]) => name === tagName);
    return tag ? tag[1] : null;
  }

  // Helper function to get all tag values (for multiple hashtags, etc.)
  function getAllTagValues(event: NostrEvent, tagName: string): string[] {
    return event.tags
      .filter(([name]) => name === tagName)
      .map(([, value]) => value);
  }

  function handleProfileClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
  }

  onMount(async () => {
    try {
      let eventId: string;
      let author: string | null = null;

      if (type === 'nevent') {
        const decoded = nip19.decode(bech32);
        if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
          author = decoded.data.author || null;
        } else {
          throw new Error('Invalid nevent format');
        }
      } else if (type === 'note') {
        const decoded = nip19.decode(bech32);
        if (decoded.type === 'note') {
          eventId = decoded.data;
        } else {
          throw new Error('Invalid note format');
        }
      } else if (type === 'naddr') {
        const decoded = nip19.decode(bech32);
        if (decoded.type === 'naddr') {
          // For naddr, fetch by kind, author, and identifier
          eventId = `${decoded.data.pubkey}-${decoded.data.kind}-${decoded.data.identifier}`;
          author = decoded.data.pubkey;
        } else {
          throw new Error('Invalid naddr format');
        }
      } else {
        throw new Error(`Unsupported event type: ${type}`);
      }

      // Fetch the event
      const fetchedEvent = await new Promise<NostrEvent | null>((resolve) => {
        let eventData: NostrEvent | null = null;
        const relays = [...DEFAULT_WIKI_RELAYS];
        
        let sub: any;
        if (type === 'naddr') {
          const decoded = nip19.decode(bech32);
          if (decoded.type === 'naddr') {
            // For naddr, use authors, kinds, and d-tag filters
            sub = pool.subscribeMany(
              relays,
              [{ 
                authors: [decoded.data.pubkey],
                kinds: [decoded.data.kind],
                '#d': [decoded.data.identifier],
                limit: 1 
              }],
              {
                onevent(evt) {
                  if (evt.pubkey === decoded.data.pubkey && 
                      evt.kind === decoded.data.kind &&
                      evt.tags.some(([tag, value]) => tag === 'd' && value === decoded.data.identifier)) {
                    eventData = evt;
                  }
                },
                oneose() {
                  sub.close();
                  resolve(eventData);
                }
              }
            );
          }
        } else {
          // For nevent and note, use event ID
          sub = pool.subscribeMany(
            relays,
            [{ ids: [eventId], limit: 1 }],
            {
              onevent(evt) {
                if (evt.id === eventId) {
                  eventData = evt;
                }
              },
              oneose() {
                sub.close();
                resolve(eventData);
              }
            }
          );
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
          sub.close();
          resolve(eventData);
        }, 5000);
      });

      if (fetchedEvent) {
        event = fetchedEvent;
        pubkey = fetchedEvent.pubkey;
        // Load user data for profile picture
        user = await loadNostrUser(fetchedEvent.pubkey);
      } else {
        error = `Event ${bech32} not found`;
      }
    } catch (e) {
      error = `Failed to fetch event: ${e}`;
    } finally {
      loading = false;
    }
  });

</script>

<div class="embedded-event border-2 rounded-2xl p-6 my-6 shadow-lg hover:shadow-xl transition-all duration-300 max-w-5xl mx-auto" style="background-color: var(--theme-bg); border-color: var(--theme-border);">
  {#if loading}
    <div class="flex items-center space-x-2">
      <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
      <span class="text-sm text-gray-600">Loading event...</span>
    </div>
  {:else if error}
    <div class="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
      <div class="text-gray-600 text-sm mb-3">
        Could not load embedded event
      </div>
      <a 
        href="https://next-alexandria.gitcitadel.eu/events?id={bech32}" 
        target="_blank" 
        rel="noopener noreferrer"
        class="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        🔗 View on Alexandria
      </a>
    </div>
  {:else if event}
    <!-- Rendered View -->
      <div class="space-y-4">
        <!-- Header with profile pic and date -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <!-- Small round profile picture using Tailwind avatar -->
            <div class="flex-shrink-0">
            <UserBadge pubkey={pubkey} {createChild} onProfileClick={handleProfileClick} size="small" />
          </div>
          
          <!-- Date -->
          <div class="flex items-center space-x-4 text-base text-gray-800">
            <span class="text-gray-700 font-semibold">{formatDate(event.created_at)}</span>
          </div>
          </div>
          
          <!-- Close Button -->
          {#if onClose}
            <button
              onclick={onClose}
              class="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close embedded event"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          {/if}
        </div>

        <!-- Title on its own row -->
        {#if getTagValue(event, 'title')}
          <div class="mb-4">
            <h3 class="text-2xl font-bold text-gray-900 leading-tight">
              {getTagValue(event, 'title')}
            </h3>
          </div>
        {/if}

        <!-- Summary -->
        {#if getTagValue(event, 'summary')}
          <div class="text-lg text-gray-900 italic bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border-l-6 border-blue-500 font-semibold shadow-sm">
            {getTagValue(event, 'summary')}
          </div>
        {/if}

        <!-- Description -->
        {#if getTagValue(event, 'description')}
          <div class="text-lg text-gray-900 leading-relaxed font-semibold bg-gray-50 p-4 rounded-lg">
            {getTagValue(event, 'description')}
          </div>
        {/if}

        <!-- Content with markup parsing -->
        {#if event.content}
          <div class="text-lg text-gray-900 leading-relaxed bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-xl border-2 border-gray-200 shadow-inner">
            <AsciidocContent {event} createChild={() => {}} />
          </div>
        {/if}

        <!-- Hashtags -->
        {#if getAllTagValues(event, 't').length > 0}
          <div class="flex flex-wrap gap-3">
            {#each getAllTagValues(event, 't') as hashtag}
              <span class="inline-block px-4 py-2 text-base bg-gradient-to-r from-blue-200 to-purple-200 text-blue-900 rounded-full font-bold border-2 border-blue-400 shadow-sm hover:shadow-md transition-all">
                #{hashtag}
              </span>
            {/each}
          </div>
        {/if}

        <!-- Other tags -->
        {#if getAllTagValues(event, 'author').length > 0}
          <div class="text-base text-gray-700 bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-400">
            <span class="font-bold text-gray-800">👥 Additional Authors:</span>
            <div class="flex flex-wrap gap-3 mt-2">
              {#each getAllTagValues(event, 'author') as author}
                <span class="text-sm bg-gray-100 px-2 py-1 rounded font-mono">{author.slice(0, 8)}...</span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Event ID (as nevent link to Alexandria) -->
        <div class="pt-4 border-t-2 border-gray-200">
          <a 
            href="https://next-alexandria.gitcitadel.eu/events?id={bech32}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="text-sm text-blue-600 hover:text-blue-800 font-mono bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg inline-block border border-blue-200 hover:border-blue-300 transition-colors"
          >
            {bech32.slice(0, 25)}...
          </a>
        </div>
      </div>
  {/if}
</div>

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
  {createChild}
/>

<style>
  .embedded-event {
    font-family: inherit;
  }
</style>
