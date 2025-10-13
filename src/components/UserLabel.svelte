<script lang="ts">
  import { onMount } from 'svelte';
  import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';

  import type { Card, UserCard } from '$lib/types';
  import { next } from '$lib/utils';

  let user = $state<NostrUser | null>(null);

  interface Props {
    pubkey: string;
    createChild?: ((card: Card) => void) | undefined;
    showAvatar?: boolean;
  }

  let { pubkey, createChild = undefined, showAvatar = true }: Props = $props();

  onMount(async () => {
    user = await loadNostrUser(pubkey);
  });

  function handleClick() {
    if (createChild) {
      createChild({ id: next(), type: 'user', data: pubkey } as UserCard);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="inline-flex items-center"
  class:cursor-pointer={!!createChild}
  onclick={handleClick}
>
      {#if showAvatar && user?.image && !user.image.includes('void.cat')}
        <img 
          src={user.image} 
          class="w-8 h-8 rounded-full object-cover border border-gray-300 ml-1" 
          style="aspect-ratio: 1/1;"
          alt="user avatar"
          onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
        />&nbsp;
      {/if}
  <span class="text-gray-600 font-[600]" title={user?.npub}
    >{user?.shortName || pubkey}</span
  >
</div>
