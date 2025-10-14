<script lang="ts">
  import { onMount } from 'svelte';

  import '../app.postcss';
  import { cards } from '$lib/state';
  import { isElementInViewport, getParentCard } from '$lib/utils';
  import CardElement from '$components/CardElement.svelte';
  import { getThemeConfig } from '$lib/themes';

  // Theme configuration
  const theme = getThemeConfig();
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
              'wss://nostr.sovbit.host (write-only auth)',
              'wss://bevo.nostr1.com (may require auth)',
              'wss://nostr.land (may require auth)',
              'wss://nostr.wine (may require auth)'
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
        if ((message.includes('websocket') || message.includes('failed')) && error.stack?.includes('wss://undefined')) {
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
  <title>{theme.title}</title>
  <style>
    :root {
      --theme-bg: {theme.backgroundColor};
      --theme-text: {theme.textColor};
      --theme-font: {theme.typography.fontFamily};
      --theme-font-heading: {theme.typography.fontFamilyHeading};
      --theme-accent: {theme.accentColor};
      --theme-highlight: {theme.highlightColor};
    }
    
    /* Override Tailwind with theme colors */
    body {
      background-color: var(--theme-bg) !important;
      color: var(--theme-text) !important;
      font-family: var(--theme-font) !important;
    }
    
    /* Force theme colors on all elements */
    * {
      color: inherit !important;
    }
    
    /* Specific overrides for common classes */
    .text-espresso-900, .text-espresso-800, .text-espresso-700, .text-espresso-600, .text-espresso-500,
    .text-gray-900, .text-gray-800, .text-gray-700, .text-gray-600, .text-gray-500,
    .text-slate-900, .text-slate-800, .text-slate-700, .text-slate-600, .text-slate-500 {
      color: var(--theme-text) !important;
    }
    
    .bg-brown-50, .bg-gray-50, .bg-slate-50, .bg-white {
      background-color: var(--theme-bg) !important;
    }
    
    /* Force antique serif fonts on ALL headers and titles */
    h1, h2, h3, h4, h5, h6, 
    .text-lg, .text-xl, .text-2xl, .text-3xl, .text-4xl, .text-5xl, .text-6xl,
    .font-semibold, .font-bold, .font-medium,
    [class*="title"], [class*="header"], [class*="heading"],
    .text-2xl, .text-3xl, .text-4xl, .text-5xl, .text-6xl,
    .font-bold, .font-semibold, .font-medium {
      font-family: var(--theme-font-heading) !important;
      color: var(--theme-text) !important;
    }
    
    /* Force antique fonts on specific elements */
    .card-title, .article-title, .comment-title, .section-title {
      font-family: var(--theme-font-heading) !important;
    }
    
    /* Burgundy hover effects for links */
    a:hover {
      color: var(--theme-highlight) !important;
      text-decoration: underline !important;
    }
    
    /* Button hover effects are handled above */
    
    /* Make sure hover states work */
    a, button, .cursor-pointer {
      transition: color 0.2s ease, background-color 0.2s ease !important;
    }
    
    /* Fix pale text */
    .text-xs {
      color: var(--theme-text) !important;
      opacity: 0.8 !important;
    }
    
    /* Remove light coloring from tagline and GitCitadel text */
    .tagline, [class*="tagline"], .description, [class*="description"],
    p[style*="opacity: 0.8"], div[style*="opacity: 0.7"], div[style*="opacity: 0.3"],
    div[style*="opacity: 0.7"], .mt-4.text-sm, [class*="mt-4"][class*="text-sm"] {
      opacity: 1 !important; /* make them fully opaque */
      color: rgb(26, 26, 26) !important; /* ensure dark color */
    }
    
    /* Target inline styles specifically */
    div[style*="opacity: 0.7"][style*="color: rgb(26, 26, 26)"] {
      opacity: 1 !important;
      color: rgb(26, 26, 26) !important;
    }
    
    /* Inline code styling - very pale burgundy */
    code:not(pre code), .code, [class*="code"] {
      background-color: #f5e6e6 !important; /* very pale burgundy */
      color: var(--theme-text) !important;
      padding: 0.125rem 0.25rem !important;
      border-radius: 0.25rem !important;
      border: 1px solid #e6c7c7 !important;
    }
    
    /* Make all card sections lighter */
    .bg-gray-50, .bg-brown-100, .bg-brown-200 {
      background-color: #fafafa !important; /* much lighter gray */
    }
    
    /* Make comment cards lighter */
    .comment-card, [class*="comment"] .bg-gray-50,
    .article-card, [class*="article"] .bg-gray-50 {
      background-color: #fafafa !important; /* much lighter gray */
    }
    
    /* Target the specific comment element from dev tools */
    .py-3.px-3.bg-white, div[class*="py-3"][class*="px-3"][class*="bg-white"] {
      background-color: #fafafa !important; /* same lighter color */
    }
    
    
    /* Input focus states */
    input:focus, textarea:focus, select:focus {
      border-color: var(--theme-highlight) !important;
      box-shadow: 0 0 0 2px var(--theme-highlight) !important;
    }
    
    /* All buttons white/transparent background with gray border - EXTREME override */
    button, input[type="submit"], input[type="button"], 
    [role="button"], [type="submit"], [type="button"],
    button[class*="bg-"], button[class*="text-"] {
      background-color: transparent !important; /* transparent background */
      background: transparent !important;
      color: #b91c1c !important; /* burgundy text */
      border: 1px solid #d1d5db !important; /* subtle gray border */
      padding: 0.375rem 0.75rem !important; /* smaller padding */
      border-radius: 0.25rem !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: "Crimson Text", "Times New Roman", "Times", "Georgia", serif !important;
      font-size: 0.875rem !important; /* smaller font size */
      text-decoration: none !important;
      transition: all 0.2s ease !important;
      opacity: 1 !important;
      visibility: visible !important;
      min-height: 2rem !important; /* smaller height */
      min-width: 3rem !important; /* smaller width */
      text-shadow: none !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
    }
    
    /* Override ALL possible Tailwind button classes with transparent background */
    button.bg-espresso-700, button.bg-primary-600, button.bg-primary-500,
    button.bg-brown-100, button.bg-gray-100, button.bg-white, button.bg-transparent,
    button.bg-slate-100, button.bg-gray-50, button.bg-blue-600, button.bg-red-600,
    button.bg-gray-200, button.bg-slate-200, button.bg-zinc-100 {
      background-color: transparent !important; /* transparent background */
      background: transparent !important;
    }
    
    button.text-white, button.text-espresso-700, button.text-gray-600,
    button.text-black, button.text-gray-900, button.text-slate-900,
    button.text-gray-800, button.text-slate-800, button.text-zinc-800 {
      color: #b91c1c !important; /* burgundy text */
    }
    
    /* Force visibility on any hidden buttons */
    button.hidden, button[style*="display: none"], button[style*="opacity: 0"] {
      display: inline-flex !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    /* Special styling for X buttons - transparent background with gray border */
    button[title*="close"], button[aria-label*="close"], 
    button[title*="Close"], button[aria-label*="Close"],
    button:has-text("X"), button:has-text("×"), button:has-text("✕"),
    .close-button, .x-button, [class*="close"], [class*="x-"] {
      background-color: transparent !important; /* transparent background */
      background: transparent !important;
      color: #b91c1c !important; /* burgundy text */
      border: 1px solid #d1d5db !important; /* subtle gray border */
      font-weight: 600 !important;
      font-size: 1rem !important;
      font-family: "Crimson Text", "Times New Roman", "Times", "Georgia", serif !important;
    }
    
    /* Article X button - transparent background with gray border */
    .card-close, .article-close, [class*="card"] button[title*="close"],
    [class*="article"] button[title*="close"], .close {
      background-color: transparent !important; /* transparent background */
      background: transparent !important;
      border: 1px solid #d1d5db !important; /* subtle gray border */
      color: #b91c1c !important; /* burgundy text */
    }
    
    /* Fix SVG stroke colors in close buttons */
    button svg, button[aria-label*="close"] svg, 
    button[title*="close"] svg, .close-button svg {
      stroke: #b91c1c !important; /* burgundy for SVG strokes */
    }
    
    /* Override Tailwind stroke classes */
    .stroke-stone-800, .stroke-gray-800, .stroke-slate-800,
    .stroke-black, .stroke-gray-900, .stroke-slate-900 {
      stroke: #b91c1c !important; /* burgundy */
    }
    
    /* Buttons on hover/inactive: burgundy background with light text (same as X buttons) */
    button:hover, button:disabled, button:inactive {
      background-color: #b91c1c !important; /* burgundy background on hover */
      background: #b91c1c !important;
      color: #f5f5dc !important; /* light text on hover */
      border-color: #b91c1c !important;
    }
    
    /* X button hover states */
    button[title*="close"]:hover, button[aria-label*="close"]:hover,
    button[title*="Close"]:hover, button[aria-label*="Close"]:hover,
    .close-button:hover, .x-button:hover {
      background-color: #b91c1c !important;
      background: #b91c1c !important;
      color: #f5f5dc !important;
      border-color: #b91c1c !important;
    }
    
    /* SVG stroke colors on hover - consistent for all buttons */
    button:hover svg, button[title*="close"]:hover svg,
    button[aria-label*="close"]:hover svg, button svg:hover {
      stroke: #f5f5dc !important; /* light color on hover */
    }
    
    /* Icon buttons - ensure SVG icons are visible on hover */
    button:hover svg, button:hover svg path, button:hover svg circle,
    button:hover svg rect, button:hover svg polygon, button:hover svg line {
      stroke: #f5f5dc !important;
      fill: #f5f5dc !important;
      color: #f5f5dc !important;
    }
    
    /* Override specific Tailwind classes for icon buttons */
    button[class*="text-burgundy"]:hover, button[class*="hover:text-burgundy"]:hover,
    button[class*="hover:bg-brown"]:hover, button[class*="p-2"]:hover,
    button[title*="Copy"]:hover, button[title*="Reply"]:hover {
      background-color: #b91c1c !important;
      background: #b91c1c !important;
      color: #f5f5dc !important;
      border-color: #b91c1c !important;
    }
    
    /* Override Tailwind icon colors on hover */
    button[class*="text-burgundy"]:hover svg, button[class*="hover:text-burgundy"]:hover svg,
    button[title*="Copy"]:hover svg, button[title*="Reply"]:hover svg {
      stroke: #f5f5dc !important;
      fill: #f5f5dc !important;
      color: #f5f5dc !important;
    }
    
    /* Post Comment button - disabled state (grayed out) - SPECIFIC to submit buttons */
    button[type="submit"]:disabled, button[type="submit"][disabled],
    button:disabled[class*="submit"], button[disabled][class*="submit"] {
      background-color: #e5e7eb !important; /* gray background */
      background: #e5e7eb !important;
      color: #9ca3af !important; /* gray text */
      border-color: #d1d5db !important; /* gray border */
      cursor: not-allowed !important;
      opacity: 0.5 !important;
    }
    
    /* Post Comment button - active state (burgundy) - SPECIFIC to submit buttons */
    button[type="submit"]:not(:disabled), button[type="submit"]:not([disabled]),
    button:not(:disabled)[class*="submit"], button:not([disabled])[class*="submit"] {
      background-color: #b91c1c !important; /* burgundy background when active */
      background: #b91c1c !important;
      color: #f5f5dc !important; /* light text when active */
      border-color: #b91c1c !important; /* burgundy border when active */
      cursor: pointer !important;
      opacity: 1 !important;
    }
    
    /* Make sure buttons are always visible */
    button:not([style*="display: none"]) {
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    /* Profile popup fix - make it solid and visible */
    .profile-popup, [class*="popup"], [class*="Profile"],
    .bg-white, [class*="bg-white"], .fixed, .absolute,
    div[class*="bg-white"][class*="rounded-lg"],
    div[class*="bg-white"][class*="shadow-xl"] {
      background-color: #ffffff !important; /* solid white background */
      border: 2px solid var(--theme-highlight) !important;
      border-radius: 0.5rem !important;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1) !important;
      opacity: 1 !important;
      z-index: 1000 !important;
    }
    
    /* Fix comment input areas separately */
    .comment-form, .comment-input, textarea {
      background-color: #ffffff !important; /* solid white background */
      opacity: 1 !important;
    }
    
    /* Fix any remaining transparent overlays - BROAD TARGETING */
    .overlay, [class*="overlay"], .user-info, [class*="user-info"],
    .profile-info, [class*="profile-info"], .avatar-container,
    [class*="avatar"], .user-badge, [class*="badge"],
    div[style*="opacity"], div[style*="transparent"],
    [style*="background: transparent"], [style*="background-color: transparent"],
    [style*="opacity: 0"], [style*="opacity: 0."] {
      background-color: #ffffff !important; /* solid white background */
      opacity: 1 !important;
      border: 1px solid var(--theme-highlight) !important;
      border-radius: 0.25rem !important;
    }
    
    /* Force all divs in comments area to be solid */
    .comments div, .comment div, .comment-form div {
      background-color: #ffffff !important;
      opacity: 1 !important;
    }
    
    /* Profile popup content */
    .profile-popup * {
      color: var(--theme-text) !important;
    }
    
    /* Make UserBadge handles burgundy */
    .userbadge, [class*="userbadge"], .user-badge, [class*="user-badge"],
    .username, [class*="username"], .handle, [class*="handle"],
    .text-gray-600, span[class*="text-gray-600"], 
    span[title*="npub"], span[title*="npub1"] {
      color: #b91c1c !important; /* direct burgundy color */
    }
    
    /* Make only highlighted/selected text lighter than panel back */
    ::selection, ::-moz-selection,
    .highlight, .highlighted, [class*="highlight"],
    .selected, [class*="selected"] {
      background-color: #fefefe !important; /* lighter than panel back */
    }
    
    /* Make comment input areas lighter */
    .comment-input, .comment-form, textarea {
      background-color: #fefefe !important; /* lighter than panel back */
    }
    
    /* Make comment and article content text areas lighter */
    .comment-content, .comment-text, .comment-body,
    .article-content, .article-text, .article-body,
    .prose-content, .content-text {
      background-color: #fefefe !important; /* lighter than panel back */
      padding: 0.5rem !important;
      border-radius: 0.25rem !important;
    }
  </style>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="flex overflow-x-scroll pb-2" draggable="false" bind:this={slider} style="background-color: {theme.backgroundColor}; color: {theme.textColor}; font-family: {theme.typography.fontFamily};">
  <CardElement card={{ type: 'welcome', id: -1 }} />

  {#each $cards as card (card.id)}
    <CardElement {card} />
  {/each}

  <!-- this is just empty -->
  {@render children?.()}

  <CardElement card={{ type: 'new', id: -1, back: undefined }} />
</div>
