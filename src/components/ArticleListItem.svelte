<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { nip19 } from '@nostr/tools';

  import UserLabel from './UserLabel.svelte';
  import { formatRelativeTime } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    openArticle: (event: NostrEvent, ev: MouseEvent) => void;
    event: NostrEvent;
    toggleArticleSelection?: (eventId: string) => void;
    selected?: boolean;
  }

  let { openArticle, event, toggleArticleSelection, selected = false }: Props = $props();

  // Get emoji for event type
  function getEventEmoji(event: NostrEvent): string {
    // Check for wiki articles (30818, 30817, and 30023)
    if (event.kind === 30818 || event.kind === 30817 || event.kind === 30023) {
      return '📝';
    }
    
    // Check for publication events (30040 and 30041)
    if (event.kind === 30040 || event.kind === 30041) {
      // Check if it's a bible event - look for "bible" in C tag or type tag
      const cTag = event.tags.find(([k]) => k === 'C' || k === 'c');
      const typeTag = event.tags.find(([k]) => k === 'type');
      const collectionTag = event.tags.find(([k]) => k === 'collection');
      
      const isBible = 
        (cTag && cTag[1]?.toLowerCase() === 'bible') ||
        (typeTag && typeTag[1]?.toLowerCase() === 'bible') ||
        (collectionTag && collectionTag[1]?.toLowerCase() === 'bible');
      
      if (isBible) {
        return '✝️';
      } else {
        return '📖';
      }
    }
    
    return '';
  }

  let plainText = $derived(
    event.content
      .slice(0, 210)
      .replace(/\[\[(.*?)\]\]/g, (_: any, content: any) => {
        return content;
      })
      .slice(0, 190)
  );

  let encodedPubkey = $derived.by(() => {
    try {
      return nip19.npubEncode(event.pubkey).slice(0, 16) + '...';
    } catch {
      return event.pubkey.slice(0, 16) + '...';
    }
  });

  function handleClick(ev: MouseEvent) {
    // Don't open if clicking on the checkbox or its container
    const target = ev.target as HTMLElement;
    if ((target instanceof HTMLInputElement && target.type === 'checkbox') || 
        target.closest('input[type="checkbox"]') ||
        target.closest('.checkbox-container')) {
      ev.stopPropagation(); // Stop propagation for checkbox clicks
      return; // Let the checkbox handle its own click
    }
    // Prevent default to avoid any navigation issues
    ev.preventDefault();
    openArticle(event, ev);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  onclick={handleClick}
  class="cursor-pointer p-4 border-2 border-stone-200 rounded-lg mt-2 relative"
  style="background-color: var(--theme-bg);"
>
  <!-- Checkbox for diff selection -->
  {#if toggleArticleSelection}
    <div 
      class="checkbox-container absolute top-2 right-2 z-10 pointer-events-auto"
      onclick={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
      onmouseup={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={selected}
        onchange={(e) => {
          e.stopPropagation();
          toggleArticleSelection(event.id);
        }}
        onclick={(e) => {
          e.stopPropagation();
        }}
        onmousedown={(e) => e.stopPropagation()}
        onmouseup={(e) => e.stopPropagation()}
        class="w-4 h-4 rounded focus:ring-2 cursor-pointer pointer-events-auto"
        style="accent-color: {theme.accentColor}; --tw-ring-color: {theme.accentColor};"
      />
    </div>
  {/if}
  <h1 class="text-xl font-bold" style="font-family: {theme.typography.fontFamilyHeading};">
    {#if getEventEmoji(event)}
      <span class="event-emoji">{getEventEmoji(event)}</span>
    {/if}
    {event.tags.find((e) => e[0] == 'title')?.[0] && event.tags.find((e) => e[0] == 'title')?.[1]
      ? event.tags.find((e) => e[0] == 'title')?.[1]
      : event.tags.find((e) => e[0] == 'd')?.[1]}
  </h1>
  <p class="text-xs my-1">
    {#if event.tags.find((e) => e[0] == 'author')?.[1]}
      {event.tags.find((e) => e[0] == 'author')?.[1]} • 
    {/if}
    <UserLabel pubkey={event.pubkey} showAvatar={false} /> • 
    {encodedPubkey}
    • {formatRelativeTime(event.created_at)} 
  </p>
  <p class="text-xs text-wrap break-words whitespace-pre-wrap">
    {#if event.tags.find((e) => e[0] == 'summary')?.[0] && event.tags.find((e) => e[0] == 'summary')?.[1]}
      {event.tags
        .find((e) => e[0] == 'summary')?.[1]
        .slice(
          0,
          192
        )}{#if String(event.tags.find((e) => e[0] == 'summary')?.[1])?.length > 192}...{/if}
    {:else}
      {plainText.length <= 170 ? plainText : plainText.substring(0, 167) + '...'}
    {/if}
  </p>
</div>
