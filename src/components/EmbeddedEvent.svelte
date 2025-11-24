<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { relayService } from '$lib/relayService';
  import { formatRelativeTime } from '$lib/utils';
  import AsciidocContent from './AsciidocContent.svelte';
  import { nip19 } from '@nostr/tools';
  import type { NostrUser } from '@nostr/gadgets/metadata';
  import UserBadge from './UserBadge.svelte';
  import ProfilePopup from './ProfilePopup.svelte';

  interface Props {
    bech32: string;
    type: 'nevent' | 'note' | 'naddr';
    onClose?: () => void;
    createChild?: ((card: any) => void) | undefined;
    relayHints?: string[];
  }

  let { bech32, type, onClose, createChild, relayHints = [] }: Props = $props();
  
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
      let kind: number | null = null;
      let identifier: string | null = null;

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
          kind = decoded.data.kind;
          identifier = decoded.data.identifier;
        } else {
          throw new Error('Invalid naddr format');
        }
      } else {
        throw new Error(`Unsupported event type: ${type}`);
      }

      // Check cache first before querying relays
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = contentCache.getEvents('wiki');
      let cachedEvent: NostrEvent | null = null;
      
      if (type === 'naddr' && author && kind && identifier) {
        // For naddr, find by pubkey, kind, and d-tag
        cachedEvent = cachedEvents.find(cached => 
          cached.event.pubkey === author &&
          cached.event.kind === kind &&
          cached.event.tags.some(([tag, value]) => tag === 'd' && value === identifier)
        )?.event || null;
      } else if (eventId) {
        // For nevent and note, find by event ID
        cachedEvent = cachedEvents.find(cached => cached.event.id === eventId)?.event || null;
      }
      
      if (cachedEvent) {
        console.log('EmbeddedEvent: Found cached event');
        event = cachedEvent;
        pubkey = cachedEvent.pubkey;
        loading = false;
        // Load user data - check cache first
        try {
          const { contentCache } = await import('$lib/contentCache');
          const cachedEvents = contentCache.getEvents('metadata');
          const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === cachedEvent.pubkey && cached.event.kind === 0);
          
          let result: any;
          if (cachedUserEvent) {
            result = { events: [cachedUserEvent.event], relays: cachedUserEvent.relays };
          } else {
            const { relayService } = await import('$lib/relayService');
            result = await relayService.queryEvents(
              'anonymous',
              'metadata-read',
              [{ kinds: [0], authors: [cachedEvent.pubkey], limit: 1 }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            
            // Store in cache for future use
            if (result.events.length > 0) {
              await contentCache.storeEvents('metadata', result.events.map((event: any) => ({
                event,
                relays: result.relays
              })));
            }
          }
          
          if (result.events.length > 0) {
            const event = result.events[0];
            try {
              const content = JSON.parse(event.content);
              user = {
                pubkey: cachedEvent.pubkey,
                npub: cachedEvent.pubkey,
                shortName: content.display_name || content.name || cachedEvent.pubkey.slice(0, 8) + '...',
                image: content.picture || undefined,
                metadata: content,
                lastUpdated: Date.now()
              };
            } catch (e) {
              console.warn('EmbeddedEvent: Failed to parse user metadata:', e);
              user = {
                pubkey: cachedEvent.pubkey,
                npub: cachedEvent.pubkey,
                shortName: cachedEvent.pubkey.slice(0, 8) + '...',
                image: undefined,
                metadata: {},
                lastUpdated: Date.now()
              };
            }
          } else {
            user = {
              pubkey: cachedEvent.pubkey,
              npub: cachedEvent.pubkey,
              shortName: cachedEvent.pubkey.slice(0, 8) + '...',
              image: undefined,
              metadata: {},
              lastUpdated: Date.now()
            };
          }
        } catch (e) {
          console.warn('EmbeddedEvent: Failed to load user data:', e);
          user = {
            pubkey: cachedEvent.pubkey,
            npub: cachedEvent.pubkey,
            shortName: cachedEvent.pubkey.slice(0, 8) + '...',
            image: undefined,
            metadata: {},
            lastUpdated: Date.now()
          };
        }
        return; // Exit early - no need to query relays
      }

      // Fetch the event from relays if not in cache
      const fetchedEvent = await new Promise<NostrEvent | null>(async (resolve) => {
        let eventData: NostrEvent | null = null;
        // relays are now handled by relayService
        
        let sub: any;
        if (type === 'naddr') {
          const decoded = nip19.decode(bech32);
          if (decoded.type === 'naddr') {
            // For naddr, use authors, kinds, and d-tag filters
            try {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ 
                  authors: [decoded.data.pubkey],
                  kinds: [decoded.data.kind],
                  '#d': [decoded.data.identifier],
                  limit: 1 
                }],
                {
                  excludeUserContent: false,
                  currentUserPubkey: undefined,
                  customRelays: relayHints.length > 0 ? relayHints : undefined
                }
              );

              const evt = result.events.find(evt => 
                evt.pubkey === decoded.data.pubkey && 
                evt.kind === decoded.data.kind &&
                evt.tags.some(([tag, value]) => tag === 'd' && value === decoded.data.identifier)
              );
              
              if (evt) {
                eventData = evt;
              }
              resolve(eventData);
            } catch (error) {
              console.error('Failed to fetch naddr event:', error);
              resolve(eventData);
            }
          }
        } else {
          // For nevent and note, use event ID
          try {
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [{ ids: [eventId], limit: 1 }],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined,
                customRelays: relayHints.length > 0 ? relayHints : undefined
              }
            );

            const evt = result.events.find(evt => evt.id === eventId);
            if (evt) {
              eventData = evt;
            }
            resolve(eventData);
          } catch (error) {
            console.error('Failed to fetch event:', error);
            resolve(eventData);
          }
        }
      });

      if (fetchedEvent) {
        event = fetchedEvent;
        pubkey = fetchedEvent.pubkey;
        // Load user data - check cache first
        try {
          const { contentCache } = await import('$lib/contentCache');
          const cachedEvents = contentCache.getEvents('metadata');
          const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === fetchedEvent.pubkey && cached.event.kind === 0);
          
          let result: any;
          if (cachedUserEvent) {
            result = { events: [cachedUserEvent.event], relays: cachedUserEvent.relays };
          } else {
            const { relayService } = await import('$lib/relayService');
            result = await relayService.queryEvents(
              'anonymous',
              'metadata-read',
              [{ kinds: [0], authors: [fetchedEvent.pubkey], limit: 1 }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            
            // Store in cache for future use
            if (result.events.length > 0) {
              await contentCache.storeEvents('metadata', result.events.map((event: any) => ({
                event,
                relays: result.relays
              })));
            }
          }
          
          if (result.events.length > 0) {
            const event = result.events[0];
            try {
              const content = JSON.parse(event.content);
              user = {
                pubkey: fetchedEvent.pubkey,
                npub: fetchedEvent.pubkey,
                shortName: content.display_name || content.name || fetchedEvent.pubkey.slice(0, 8) + '...',
                image: content.picture || undefined,
                metadata: content,
                lastUpdated: Date.now()
              };
            } catch (e) {
              console.warn('EmbeddedEvent: Failed to parse user metadata:', e);
              user = {
                pubkey: fetchedEvent.pubkey,
                npub: fetchedEvent.pubkey,
                shortName: fetchedEvent.pubkey.slice(0, 8) + '...',
                image: undefined,
                metadata: {},
                lastUpdated: Date.now()
              };
            }
          } else {
            user = {
              pubkey: fetchedEvent.pubkey,
              npub: fetchedEvent.pubkey,
              shortName: fetchedEvent.pubkey.slice(0, 8) + '...',
              image: undefined,
              metadata: {},
              lastUpdated: Date.now()
            };
          }
        } catch (e) {
          console.warn('EmbeddedEvent: Failed to load user data:', e);
          user = {
            pubkey: fetchedEvent.pubkey,
            npub: fetchedEvent.pubkey,
            shortName: fetchedEvent.pubkey.slice(0, 8) + '...',
            image: undefined,
            metadata: {},
            lastUpdated: Date.now()
          };
        }
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

<div class="embedded-event border-2 rounded-2xl p-6 my-6 shadow-lg hover:shadow-xl transition-all duration-300 max-w-5xl mx-auto" style="background-color: var(--bg-primary); border-color: var(--border);">
  {#if loading}
    <div class="flex items-center space-x-2">
      <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
      <span class="text-sm" style="color: var(--text-secondary);">Loading event...</span>
    </div>
  {:else if error}
    <div class="text-center p-4 rounded-lg border" style="background-color: var(--bg-secondary); border-color: var(--border);">
      <div class="text-sm mb-3" style="color: var(--text-secondary);">
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
            <UserBadge pubkey={pubkey} {createChild} onProfileClick={handleProfileClick} size="small" hideSearchIcon={false} />
          </div>
          
          <!-- Date -->
          <div class="flex items-center space-x-4 text-base" style="color: var(--text-primary);">
            <span class="font-semibold" style="color: var(--text-primary);">{formatRelativeTime(event.created_at)}</span>
          </div>
          </div>
          
          <!-- Close Button -->
          {#if onClose}
            <button
              onclick={onClose}
              class="flex-shrink-0 p-2 rounded-lg transition-colors hover:opacity-70"
              style="color: var(--text-secondary); background-color: var(--bg-secondary);"
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
            <h3 class="text-2xl font-bold leading-tight" style="color: var(--text-primary);">
              {getTagValue(event, 'title')}
            </h3>
          </div>
        {/if}

        <!-- Summary -->
        {#if getTagValue(event, 'summary')}
          <div class="text-lg italic p-4 rounded-xl border-l-6 font-semibold shadow-sm" style="color: var(--text-primary); background: linear-gradient(to right, var(--bg-secondary), var(--bg-tertiary)); border-left-color: var(--accent);">
            {getTagValue(event, 'summary')}
          </div>
        {/if}

        <!-- Description -->
        {#if getTagValue(event, 'description')}
          <div class="text-lg leading-relaxed font-semibold p-4 rounded-lg" style="color: var(--text-primary); background-color: var(--bg-secondary);">
            {getTagValue(event, 'description')}
          </div>
        {/if}

        <!-- Content with markup parsing -->
        {#if event.content}
          <div class="text-lg leading-relaxed p-4 rounded-xl border-2 shadow-inner" style="color: var(--text-primary); background: linear-gradient(to bottom right, var(--bg-secondary), var(--bg-tertiary)); border-color: var(--border);">
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
          <div class="text-base p-3 rounded-lg border-l-4" style="color: var(--text-primary); background-color: var(--bg-secondary); border-left-color: var(--accent);">
            <span class="font-bold" style="color: var(--text-primary);">👥 Additional Authors:</span>
            <div class="flex flex-wrap gap-3 mt-2">
              {#each getAllTagValues(event, 'author') as author}
                <span class="text-sm px-2 py-1 rounded font-mono" style="background-color: var(--bg-tertiary);">{author.slice(0, 8)}...</span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Event ID (as nevent link to Alexandria) -->
        <div class="pt-4 border-t-2" style="border-color: var(--border);">
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
/>

<style>
  .embedded-event {
    font-family: inherit;
  }
</style>
