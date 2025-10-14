<script lang="ts">
  import UserBadge from './UserBadge.svelte';
  import type { Card } from '$lib/types';

  interface Props {
    pubkey: string;
    createChild?: ((card: Card) => void) | undefined;
    showAvatar?: boolean;
  }

  let { pubkey, createChild, showAvatar = true }: Props = $props();
</script>

<UserBadge {pubkey} {createChild} {showAvatar} size="small" />
