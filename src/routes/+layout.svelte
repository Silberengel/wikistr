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
        // Filter out common image loading errors
        if (
          (message.includes('void.cat') && message.includes('ERR_NAME_NOT_RESOLVED')) ||
          (message.includes('ERR_BLOCKED_BY_RESPONSE') && message.includes('NotSameOrigin')) ||
          (message.includes('GET') && message.includes('403 (Forbidden)')) ||
          (message.includes('net::ERR_BLOCKED_BY_RESPONSE'))
        ) {
          return; // Suppress these specific errors
        }
        originalError.apply(console, args);
      };
    }

    // Global error handler for unhandled promise rejections (like auth-required errors)
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      if (error && typeof error === 'object' && error.message) {
        const message = error.message.toLowerCase();
        
        // Handle auth-required errors gracefully
        if (message.includes('auth-required') || message.includes('auth required')) {
          // Try to extract relay information from error stack or context
          let relayUrl = 'Unknown relay';
          let relayInfo = '';
          
          // Check if error has relay information
          if (error.relay) {
            relayUrl = error.relay;
            relayInfo = `Failed relay: ${relayUrl}`;
          } else if (error.url) {
            relayUrl = error.url;
            relayInfo = `Failed relay: ${relayUrl}`;
          } else {
            // Try to extract from stack trace
            const stack = error.stack || '';
            const relayMatch = stack.match(/wss?:\/\/[^\s\)]+/);
            if (relayMatch) {
              relayUrl = relayMatch[0];
              relayInfo = `Failed relay: ${relayUrl}`;
            } else {
              relayInfo = 'Could not determine which relay failed';
            }
          }
          
          console.info('ℹ️ Relay Authentication Required:', {
            message: error.message,
            relay: relayUrl,
            details: `A relay (${relayUrl}) requires authentication for write access. This is normal for many relays and doesn't affect reading articles.`,
            commonAuthRequiredRelays: [
              'wss://relay.damus.io (often requires auth)',
              'wss://freelay.sovbit.host (write-only auth)',
              'wss://bevo.nostr1.com (may require auth)'
            ],
            action: 'You can still read articles from this relay. Publishing may require authentication with a Nostr client.',
            stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : undefined
          });
          
          // Prevent the error from showing in console
          event.preventDefault();
          return;
        }
        
        // Handle other common relay errors gracefully
        if (message.includes('rate-limited') || message.includes('rate limited')) {
          // Extract relay info for rate limiting
          let relayUrl = 'Unknown relay';
          if (error.relay) relayUrl = error.relay;
          else if (error.url) relayUrl = error.url;
          else {
            const stack = error.stack || '';
            const relayMatch = stack.match(/wss?:\/\/[^\s\)]+/);
            if (relayMatch) relayUrl = relayMatch[0];
          }
          
          console.info('ℹ️ Relay Rate Limited:', {
            message: error.message,
            relay: relayUrl,
            details: `This relay (${relayUrl}) is temporarily rate limiting requests. This is normal behavior.`,
            action: 'Please wait a moment before trying again.'
          });
          event.preventDefault();
          return;
        }
        
        if (message.includes('connection') || message.includes('network')) {
          // Extract relay info for connection issues
          let relayUrl = 'Unknown relay';
          if (error.relay) relayUrl = error.relay;
          else if (error.url) relayUrl = error.url;
          else {
            const stack = error.stack || '';
            const relayMatch = stack.match(/wss?:\/\/[^\s\)]+/);
            if (relayMatch) relayUrl = relayMatch[0];
          }
          
          console.info('ℹ️ Relay Connection Issue:', {
            message: error.message,
            relay: relayUrl,
            details: `There was a temporary connection issue with relay ${relayUrl}.`,
            action: 'The app will automatically retry. This is normal behavior.'
          });
          event.preventDefault();
          return;
        }
        
        // Handle "Account is timed out" errors
        if (message.includes('account is timed out') || message.includes('timeout')) {
          // Extract relay info for timeout issues
          let relayUrl = 'Unknown relay';
          if (error.relay) relayUrl = error.relay;
          else if (error.url) relayUrl = error.url;
          else {
            const stack = error.stack || '';
            const relayMatch = stack.match(/wss?:\/\/[^\s\)]+/);
            if (relayMatch) relayUrl = relayMatch[0];
          }
          
          console.info('ℹ️ Relay Timeout:', {
            message: error.message,
            relay: relayUrl,
            details: `Connection to relay ${relayUrl} timed out. This is normal behavior.`,
            action: 'The app will automatically retry. This is normal behavior.'
          });
          event.preventDefault();
          return;
        }
        
        // Handle WebSocket connection failures (especially undefined URLs)
        if (message.includes('websocket') || message.includes('failed') && error.stack?.includes('wss://undefined')) {
          console.info('ℹ️ Invalid Relay URL:', {
            message: 'Attempted to connect to undefined relay URL',
            details: 'A relay URL was not properly configured. This has been filtered out.',
            action: 'The app will continue with valid relays only.'
          });
          event.preventDefault();
          return;
        }
      }
    });

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
  <title>Biblestr</title>
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
