<script lang="ts">
  import type { RelayCard, Card } from '$lib/types';
  import { next, urlWithoutScheme } from '$lib/utils';

  interface Props {
    url: string;
    createChild: (card: Card) => void;
    selected?: boolean;
  }

  let { url, createChild, selected = false }: Props = $props();
  
  // Debug logging
  if (selected) {
    console.log('🎯 RelayItem selected:', url, 'selected:', selected);
  }

  function openRelay(relay: string) {
    let relayCard: RelayCard = { id: next(), type: 'relay', data: relay };
    createChild(relayCard);
  }
</script>

<button
  class="font-normal text-xs px-1 py-0.5 mr-1 my-0.5 rounded cursor-pointer transition-colors"
  style="background-color: {selected ? 'var(--accent)' : 'var(--bg-secondary)'}; color: {selected ? 'white' : 'var(--text-primary)'}; border: 1px solid {selected ? 'var(--accent)' : 'var(--border)'}; opacity: {selected ? '0.9' : '1'};"
  onmouseup={openRelay.bind(null, url)}
>
  {urlWithoutScheme(url)}
</button>
