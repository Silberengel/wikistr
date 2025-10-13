<script lang="ts">
  import { onMount } from 'svelte';

  import '../app.postcss';
  import { cards } from '$lib/state';
  import { isElementInViewport, getParentCard } from '$lib/utils';
  import CardElement from '$components/CardElement.svelte';
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let dragging = false;
  let startX: number;
  let scrollLeft: number;
  let slider: HTMLElement;

  onMount(() => {
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousemove', onMouseMove);
    
    // Global image error handler - silently hide broken images
    document.addEventListener('error', (e) => {
      if (e.target instanceof HTMLImageElement) {
        const img = e.target as HTMLImageElement;
        // Hide broken images silently, especially void.cat which is often down
        img.style.display = 'none';
        // Prevent the error from bubbling up to avoid console spam
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Suppress known problematic network errors in console during development
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      const originalError = console.error;
      console.error = (...args) => {
        const message = args.join(' ');
        // Filter out void.cat DNS resolution errors
        if (message.includes('void.cat') && message.includes('ERR_NAME_NOT_RESOLVED')) {
          return; // Suppress these specific errors
        }
        originalError.apply(console, args);
      };
    }

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousemove', onMouseMove);
    };

    function onMouseDown(ev: MouseEvent) {
      if (!slider) return;

      let path = ev.composedPath();
      if (path[0] !== slider) {
        return;
      }

      if (ev.target instanceof HTMLElement) {
        let card = getParentCard(ev.target);
        if (card && isElementInViewport(card)) return;
      }

      dragging = true;
      startX = ev.clientX - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    }

    function onMouseUp(ev: MouseEvent) {
      if (dragging) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
      }
      dragging = false;
    }

    function onMouseMove(ev: MouseEvent) {
      if (!slider) return;
      if (!dragging) return;
      ev.preventDefault();
      slider.scrollLeft = scrollLeft + startX - ev.clientX;
    }
  });
</script>

<svelte:head>
  <title>wikistr</title>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="flex overflow-x-scroll pb-2" draggable="false" bind:this={slider}>
  <CardElement card={{ type: 'welcome', id: -1 }} />

  {#each $cards as card (card.id)}
    <CardElement {card} />
  {/each}

  <!-- this is just empty -->
  {@render children?.()}

  <CardElement card={{ type: 'new', id: -1, back: undefined }} />
</div>
