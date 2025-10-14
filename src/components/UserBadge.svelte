<script lang="ts">
  import { onMount } from 'svelte';
  import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import type { Card, UserCard } from '$lib/types';
  import { next } from '$lib/utils';

  let user = $state<NostrUser | null>(null);

  interface Props {
    pubkey: string;
    createChild?: ((card: Card) => void) | undefined;
    size?: 'tiny' | 'small' | 'medium' | 'large';
    showAvatar?: boolean;
    onProfileClick?: (pubkey: string) => void;
  }

  let { pubkey, createChild = undefined, size = 'medium', showAvatar = true, onProfileClick }: Props = $props();

  onMount(async () => {
    user = await loadNostrUser(pubkey);
  });

  function handleUsernameClick() {
    if (createChild) {
      createChild({ id: next(), type: 'user', data: pubkey } as UserCard);
    }
  }

  function handleAvatarClick() {
    if (onProfileClick) {
      onProfileClick(pubkey);
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
<div class="inline-flex items-center {config.gap}">
  {#if showAvatar}
    {#if user?.image}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img 
        src={user.image} 
        class="{config.avatarSize} rounded object-cover border border-gray-300 cursor-pointer hover:opacity-80 transition-opacity" 
        style="aspect-ratio: 1/1;"
        alt="user avatar"
        title="View profile"
        onclick={handleAvatarClick}
        onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
      />
    {:else}
      <div 
        class="{config.avatarSize} rounded bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold border border-gray-300 cursor-pointer hover:opacity-80 transition-opacity" 
        style="aspect-ratio: 1/1;"
        title="View profile"
        onclick={handleAvatarClick}
      >
        {user?.shortName?.charAt(0)?.toUpperCase() || pubkey.slice(0, 2).toUpperCase()}
      </div>
    {/if}
  {/if}
  
  <span 
    class="text-gray-600 font-[600] {config.textSize} cursor-pointer hover:text-gray-800 transition-colors" 
    title={user?.npub}
    onclick={handleUsernameClick}
  >
    {user?.shortName || pubkey}
  </span>
</div>
