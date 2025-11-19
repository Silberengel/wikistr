<script lang="ts">
  import { onMount } from 'svelte';
  import { type NostrUser } from '@nostr/gadgets/metadata';
  import type { Card, UserCard } from '$lib/types';
  import { next } from '$lib/utils';

  let user = $state<NostrUser | null>(null);

  interface Props {
    pubkey: string;
    createChild?: ((card: Card) => void) | undefined;
    size?: 'tiny' | 'small' | 'medium' | 'large';
    showAvatar?: boolean;
    onProfileClick?: (pubkey: string) => void;
    hideSearchIcon?: boolean;
    picOnly?: boolean;
  }

  let { pubkey, createChild = undefined, size = 'medium', showAvatar = true, onProfileClick, hideSearchIcon = false, picOnly = false }: Props = $props();

  onMount(async () => {
    // Don't try to load user data if pubkey is invalid
    if (!pubkey || pubkey === 'anonymous' || pubkey === 'undefined' || pubkey === 'null') {
      return;
    }

    // Set immediate fallback user
    user = {
      pubkey: pubkey,
      npub: pubkey,
      shortName: pubkey.slice(0, 8) + '...',
      image: undefined,
      metadata: {},
      lastUpdated: Date.now()
    };
    
    try {
      // Check IndexedDB cache first
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = await contentCache.getEvents('metadata');
      const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === pubkey && cached.event.kind === 0);
      
      if (cachedUserEvent) {
        try {
          const content = JSON.parse(cachedUserEvent.event.content);
          user = {
            pubkey: pubkey,
            npub: pubkey,
            shortName: content.display_name || content.name || pubkey.slice(0, 8) + '...',
            image: content.picture || undefined,
            metadata: content,
            lastUpdated: Date.now()
          };
          return; // Exit early since we found cached data
        } catch (e) {
          console.warn('UserBadge: Failed to parse cached user metadata:', e);
        }
      }
      
      // If user not found in cache, try to load metadata
      
      const { relayService } = await import('$lib/relayService');
      const metadataResult = await relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { excludeUserContent: false, currentUserPubkey: undefined }
      );
      
      if (metadataResult.events.length > 0) {
        const event = metadataResult.events[0];
        try {
          const content = JSON.parse(event.content);
          user = {
            pubkey: pubkey,
            npub: pubkey,
            shortName: content.display_name || content.name || pubkey.slice(0, 8) + '...',
            image: content.picture || undefined,
            metadata: content,
            lastUpdated: Date.now()
          };
          
          // Store the metadata in cache for future use
          const eventsToStore = [{
            event,
            relays: metadataResult.relays
          }];
          await contentCache.storeEvents('metadata', eventsToStore);
        } catch (e) {
          console.warn('UserBadge: Failed to parse user metadata:', e);
        }
      }
      
    } catch (e) {
      // Keep fallback user if loading fails
      console.warn('UserBadge: Failed to load metadata for', pubkey.slice(0, 8) + '...', e);
    }
  });

  function handleProfileClick() {
    if (onProfileClick) {
      onProfileClick(pubkey);
    }
  }

  function handleSearchClick() {
    if (createChild) {
      createChild({ id: next(), type: 'user', data: pubkey } as UserCard);
    }
  }

  // Size configurations
  const sizeConfig = {
    tiny: {
      avatarSize: 'w-5 h-5',
      textSize: 'text-xs',
      gap: 'space-x-2'
    },
    small: {
      avatarSize: 'w-6 h-6',
      textSize: 'text-sm',
      gap: 'space-x-2'
    },
    medium: {
      avatarSize: 'w-8 h-8',
      textSize: 'text-base',
      gap: 'space-x-3'
    },
    large: {
      avatarSize: 'w-12 h-12',
      textSize: 'text-lg',
      gap: 'space-x-4'
    }
  };

  const config = sizeConfig[size];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="inline-flex items-center {picOnly ? '' : config.gap}">
  {#if showAvatar}
    {#if user?.image}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img 
        src={user.image} 
        class="{config.avatarSize} rounded object-cover border cursor-pointer hover:opacity-80 transition-opacity"
        style="border-color: var(--border); aspect-ratio: 1/1;"
        alt="user avatar"
        title="View profile"
        onclick={handleProfileClick}
        onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
      />
    {:else}
      <div 
        class="{config.avatarSize} rounded bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold border cursor-pointer hover:opacity-80 transition-opacity"
        style="border-color: var(--border); aspect-ratio: 1/1;"
        title="View profile"
        onclick={handleProfileClick}
      >
        {user?.shortName?.charAt(0)?.toUpperCase() || (pubkey ? pubkey.slice(0, 2).toUpperCase() : '?')}
      </div>
    {/if}
  {/if}
  
  {#if !picOnly}
    <span 
      class="font-[600] {config.textSize} cursor-pointer transition-colors" 
      style="color: var(--accent);"
      title={user?.npub || pubkey}
      onclick={handleProfileClick}
    >
      {user?.shortName || (pubkey ? pubkey.slice(0, 8) + '...' : 'Anonymous')}
    </span>
    
    <!-- Search icon for article search (except in comments and NewSearch Silberengel) -->
    {#if createChild && !hideSearchIcon}
      <button
        class="ml-1 p-1 rounded transition-colors hover:opacity-80"
        style="background-color: var(--bg-primary); color: var(--accent); border: 1px solid var(--accent);"
        title="Search articles by this user"
        onclick={handleSearchClick}
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
      </button>
    {/if}
  {/if}
</div>
