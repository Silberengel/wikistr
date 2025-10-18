<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { onMount } from 'svelte';
  import { loadWikiAuthors } from '@nostr/gadgets/lists';
  import type { Card } from '$lib/types';
  import { preprocessContentForAsciidoc } from '$lib/utils';
  import AsciidocContent from './AsciidocContent.svelte';

  interface Props {
    event: NostrEvent;
    createChild: (card: Card) => void;
    replaceSelf: (card: Card) => void;
  }

  let { event, createChild, replaceSelf }: Props = $props();

  let authorPreferredWikiAuthors = $state<string[]>([]);

  onMount(() => {
    loadWikiAuthors(event.pubkey).then((ps) => {
      authorPreferredWikiAuthors = ps.items;
    });
  });
</script>

<AsciidocContent {event} {createChild} {replaceSelf} />
