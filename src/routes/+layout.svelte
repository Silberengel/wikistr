<script lang="ts">
  import { onMount } from 'svelte';

  import '../app.postcss';
  import { cards } from '$lib/state';
  import { isElementInViewport, getParentCard } from '$lib/utils';
  import CardElement from '$components/CardElement.svelte';
  import { getThemeConfig } from '$lib/themes';
  import { initializeBookConfigurations } from '$lib/bookConfig';

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
    // Initialize book configurations on startup
    initializeBookConfigurations();
    
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
      --theme-border: #374151;
    }
    
    /* Override Tailwind with theme colors */
    body {
      background-color: var(--theme-bg) !important;
      color: var(--theme-text) !important;
      font-family: var(--theme-font) !important;
    }
    
    /* Theme-specific styling - only apply biblestr styles when theme is biblestr */
    [data-theme="biblestr"] {
      /* Apply biblestr-specific overrides */
    }
    
    /* Theme-specific styling - only apply wikistr styles when theme is wikistr */
    [data-theme="wikistr"] {
      /* Apply wikistr-specific overrides */
    }
    
    /* Wikistr buttons - modern dark theme styling */
    [data-theme="wikistr"] button, [data-theme="wikistr"] input[type="submit"], [data-theme="wikistr"] input[type="button"], 
    [data-theme="wikistr"] [role="button"], [data-theme="wikistr"] [type="submit"], [data-theme="wikistr"] [type="button"] {
      background-color: #374151 !important; /* dark gray background */
      background: #374151 !important;
      color: #f8fafc !important; /* light text */
      border: 1px solid #4b5563 !important; /* darker gray border */
      padding: 0.375rem 0.75rem !important;
      border-radius: 0.25rem !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      font-size: 0.875rem !important;
      text-decoration: none !important;
      transition: all 0.2s ease !important;
      opacity: 1 !important;
      visibility: visible !important;
      min-height: 2rem !important;
      min-width: 3rem !important;
      text-shadow: none !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
    }
    
    /* Wikistr button hover */
    [data-theme="wikistr"] button:hover, [data-theme="wikistr"] button:focus, [data-theme="wikistr"] button:active {
      background-color: #4b5563 !important; /* lighter gray on hover */
      background: #4b5563 !important;
      color: #ffffff !important; /* white text on hover */
      border-color: #6b7280 !important;
    }
    
    /* Wikistr panels and cards - darker backgrounds */
    [data-theme="wikistr"] .bg-white, [data-theme="wikistr"] .bg-gray-50, [data-theme="wikistr"] .bg-gray-100,
    [data-theme="wikistr"] .bg-brown-50, [data-theme="wikistr"] .bg-brown-100, [data-theme="wikistr"] .bg-brown-200,
    [data-theme="wikistr"] .bg-slate-50, [data-theme="wikistr"] .bg-slate-100 {
      background-color: #111827 !important; /* darker gray panels */
    }
    
    /* Wikistr card styling */
    [data-theme="wikistr"] .card, [data-theme="wikistr"] [class*="card"],
    [data-theme="wikistr"] .bg-white, [data-theme="wikistr"] .bg-gray-50 {
      background-color: #111827 !important; /* darker gray cards */
      border-color: #374151 !important; /* darker gray borders */
    }
    
    /* Wikistr input fields */
    [data-theme="wikistr"] input, [data-theme="wikistr"] textarea, [data-theme="wikistr"] select {
      background-color: #374151 !important; /* dark gray inputs */
      border-color: #4b5563 !important;
      color: #f8fafc !important; /* light text */
    }
    
    /* Wikistr text colors - make all text lighter */
    [data-theme="wikistr"] h1, [data-theme="wikistr"] h2, [data-theme="wikistr"] h3, [data-theme="wikistr"] h4, [data-theme="wikistr"] h5, [data-theme="wikistr"] h6,
    [data-theme="wikistr"] p, [data-theme="wikistr"] div, [data-theme="wikistr"] span,
    [data-theme="wikistr"] .text-gray-900, [data-theme="wikistr"] .text-gray-800, [data-theme="wikistr"] .text-gray-700,
    [data-theme="wikistr"] .text-espresso-900, [data-theme="wikistr"] .text-espresso-800, [data-theme="wikistr"] .text-espresso-700,
    [data-theme="wikistr"] .text-espresso-600, [data-theme="wikistr"] .text-espresso-500, [data-theme="wikistr"] .text-espresso-400 {
      color: #e5e7eb !important; /* light gray text */
    }
    
    /* Wikistr borders - muted mauve instead of bright white */
    [data-theme="wikistr"] .border, [data-theme="wikistr"] .border-gray-300, [data-theme="wikistr"] .border-gray-200,
    [data-theme="wikistr"] .border-white, [data-theme="wikistr"] .border-slate-300, [data-theme="wikistr"] .border-slate-200 {
      border-color: #6b46c1 !important; /* muted mauve borders */
    }
    
    /* Wikistr divider lines */
    [data-theme="wikistr"] .divide-y > *, [data-theme="wikistr"] .divide-x > *,
    [data-theme="wikistr"] hr, [data-theme="wikistr"] .border-t, [data-theme="wikistr"] .border-b {
      border-color: #6b46c1 !important; /* muted mauve dividers */
    }
    
    /* Wikistr - make remaining white sections one level lighter than panels */
    [data-theme="wikistr"] .bg-white, [data-theme="wikistr"] input, [data-theme="wikistr"] textarea,
    [data-theme="wikistr"] select, [data-theme="wikistr"] button, [data-theme="wikistr"] [class*="bg-white"],
    [data-theme="wikistr"] .py-3, [data-theme="wikistr"] .px-3, [data-theme="wikistr"] .p-3,
    [data-theme="wikistr"] .py-4, [data-theme="wikistr"] .px-4, [data-theme="wikistr"] .p-4,
    [data-theme="wikistr"] .py-6, [data-theme="wikistr"] .px-6, [data-theme="wikistr"] .p-6 {
      background-color: #1f2937 !important; /* one level lighter than panels */
    }
    
    /* Wikistr - target specific elements that might still be white */
    [data-theme="wikistr"] .comment, [data-theme="wikistr"] .article-content,
    [data-theme="wikistr"] .search-instructions, [data-theme="wikistr"] .welcome-card,
    [data-theme="wikistr"] .account-section, [data-theme="wikistr"] .relay-list,
    [data-theme="wikistr"] .article-list-item, [data-theme="wikistr"] .user-badge {
      background-color: #1f2937 !important; /* one level lighter than panels */
    }
    
    /* Wikistr - target all remaining white elements with comprehensive selectors */
    [data-theme="wikistr"] div, [data-theme="wikistr"] section, [data-theme="wikistr"] article,
    [data-theme="wikistr"] .mt-3, [data-theme="wikistr"] .text-xs, [data-theme="wikistr"] .border-t, [data-theme="wikistr"] .pt-3,
    [data-theme="wikistr"] .mt-4, [data-theme="wikistr"] .mt-2, [data-theme="wikistr"] .mt-1,
    [data-theme="wikistr"] .mb-3, [data-theme="wikistr"] .mb-4, [data-theme="wikistr"] .mb-2, [data-theme="wikistr"] .mb-1,
    [data-theme="wikistr"] .py-2, [data-theme="wikistr"] .py-1, [data-theme="wikistr"] .px-2, [data-theme="wikistr"] .px-1,
    [data-theme="wikistr"] .p-2, [data-theme="wikistr"] .p-1 {
      background-color: #1f2937 !important; /* one level lighter than panels */
    }
    
    /* Wikistr - target any element with white background specifically */
    [data-theme="wikistr"] *[style*="background-color: white"],
    [data-theme="wikistr"] *[style*="background-color: #ffffff"],
    [data-theme="wikistr"] *[style*="background-color: #fff"],
    [data-theme="wikistr"] *[style*="background: white"],
    [data-theme="wikistr"] *[style*="background: #ffffff"],
    [data-theme="wikistr"] *[style*="background: #fff"] {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - ensure all divs and containers are dark */
    [data-theme="wikistr"] div:not([class*="bg-"]), [data-theme="wikistr"] section:not([class*="bg-"]),
    [data-theme="wikistr"] article:not([class*="bg-"]), [data-theme="wikistr"] aside:not([class*="bg-"]) {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - ensure all text in dark elements is light */
    [data-theme="wikistr"] .mt-3, [data-theme="wikistr"] .text-xs, [data-theme="wikistr"] .border-t, [data-theme="wikistr"] .pt-3,
    [data-theme="wikistr"] .mt-4, [data-theme="wikistr"] .mt-2, [data-theme="wikistr"] .mt-1,
    [data-theme="wikistr"] .mb-3, [data-theme="wikistr"] .mb-4, [data-theme="wikistr"] .mb-2, [data-theme="wikistr"] .mb-1,
    [data-theme="wikistr"] .py-2, [data-theme="wikistr"] .py-1, [data-theme="wikistr"] .px-2, [data-theme="wikistr"] .px-1,
    [data-theme="wikistr"] .p-2, [data-theme="wikistr"] .p-1,
    [data-theme="wikistr"] div, [data-theme="wikistr"] section, [data-theme="wikistr"] article {
      color: #e5e7eb !important; /* light gray text */
    }
    
    /* Wikistr - target any element with dark text specifically */
    [data-theme="wikistr"] *[style*="color: #1A1A1A"], [data-theme="wikistr"] *[style*="color: #1a1a1a"],
    [data-theme="wikistr"] *[style*="color: black"], [data-theme="wikistr"] *[style*="color: #000000"],
    [data-theme="wikistr"] *[style*="color: #000"] {
      color: #e5e7eb !important; /* light gray text */
    }
    
    /* Wikistr - target brown background classes specifically */
    [data-theme="wikistr"] .bg-brown-100, [data-theme="wikistr"] .bg-brown-200, [data-theme="wikistr"] .bg-brown-300,
    [data-theme="wikistr"] .bg-brown-400, [data-theme="wikistr"] .bg-brown-500, [data-theme="wikistr"] .bg-brown-600,
    [data-theme="wikistr"] .bg-brown-700, [data-theme="wikistr"] .bg-brown-800, [data-theme="wikistr"] .bg-brown-900 {
      background-color: #1f2937 !important; /* one level lighter than panels */
    }
    
    /* Wikistr - target any element with brown background inline styles */
    [data-theme="wikistr"] *[style*="background-color: rgb(242, 237, 230)"],
    [data-theme="wikistr"] *[style*="background-color: #f2ede6"],
    [data-theme="wikistr"] *[style*="background: rgb(242, 237, 230)"],
    [data-theme="wikistr"] *[style*="background: #f2ede6"] {
      background-color: #1f2937 !important; /* one level lighter than panels */
    }
    
    /* Wikistr - make inline code elements darker */
    [data-theme="wikistr"] code:not(pre code), [data-theme="wikistr"] .code, [data-theme="wikistr"] [class*="code"] {
      background-color: #374151 !important; /* darker gray background */
      color: #e5e7eb !important; /* light text */
      border: 1px solid #4b5563 !important; /* darker border */
    }
    
    /* Wikistr - target code blocks specifically */
    [data-theme="wikistr"] pre code, [data-theme="wikistr"] pre, [data-theme="wikistr"] .code-block {
      background-color: #1f2937 !important; /* dark background */
      color: #e5e7eb !important; /* light text */
      border: 1px solid #374151 !important;
    }
    
    /* Wikistr - catch any remaining light elements with aggressive targeting */
    [data-theme="wikistr"] * {
      background-color: inherit !important;
    }
    
    /* Wikistr - force dark backgrounds on any element that might be light */
    [data-theme="wikistr"] *:not([class*="bg-"]) {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - override any remaining light backgrounds */
    [data-theme="wikistr"] *[style*="background-color: rgb(255, 255, 255)"],
    [data-theme="wikistr"] *[style*="background-color: #ffffff"],
    [data-theme="wikistr"] *[style*="background-color: #fff"],
    [data-theme="wikistr"] *[style*="background-color: white"],
    [data-theme="wikistr"] *[style*="background: rgb(255, 255, 255)"],
    [data-theme="wikistr"] *[style*="background: #ffffff"],
    [data-theme="wikistr"] *[style*="background: #fff"],
    [data-theme="wikistr"] *[style*="background: white"] {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - target main content areas and article sections specifically */
    [data-theme="wikistr"] .prose, [data-theme="wikistr"] .prose-sm, [data-theme="wikistr"] .prose-lg,
    [data-theme="wikistr"] .max-w-none, [data-theme="wikistr"] .max-w-4xl, [data-theme="wikistr"] .max-w-6xl,
    [data-theme="wikistr"] .article-content, [data-theme="wikistr"] .content, [data-theme="wikistr"] .main-content,
    [data-theme="wikistr"] .card-content, [data-theme="wikistr"] .panel-content {
      background-color: #1f2937 !important; /* dark background for content areas */
    }
    
    /* Wikistr - target any element with very light gray backgrounds */
    [data-theme="wikistr"] *[style*="background-color: rgb(249, 250, 251)"],
    [data-theme="wikistr"] *[style*="background-color: #f9fafb"],
    [data-theme="wikistr"] *[style*="background-color: rgb(243, 244, 246)"],
    [data-theme="wikistr"] *[style*="background-color: #f3f4f6"],
    [data-theme="wikistr"] *[style*="background: rgb(249, 250, 251)"],
    [data-theme="wikistr"] *[style*="background: #f9fafb"],
    [data-theme="wikistr"] *[style*="background: rgb(243, 244, 246)"],
    [data-theme="wikistr"] *[style*="background: #f3f4f6"] {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - NUCLEAR OPTION: Force ALL elements to dark background */
    [data-theme="wikistr"] * {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - Then restore specific elements that should be darker */
    [data-theme="wikistr"] body, [data-theme="wikistr"] html, [data-theme="wikistr"] main {
      background-color: #0f172a !important; /* darker for main containers */
    }
    
    [data-theme="wikistr"] .bg-gray-900, [data-theme="wikistr"] .bg-slate-900 {
      background-color: #0f172a !important;
    }
    
    /* Wikistr - Force text to be light on all elements */
    [data-theme="wikistr"] * {
      color: #e5e7eb !important;
    }
    
    /* Wikistr - Override UserBadge handles to be highlighted - MORE AGGRESSIVE */
    [data-theme="wikistr"] .userbadge *,
    [data-theme="wikistr"] .user-badge *,
    [data-theme="wikistr"] .username *,
    [data-theme="wikistr"] .handle *,
    [data-theme="wikistr"] span[title*="npub"],
    [data-theme="wikistr"] span[title*="npub1"],
    [data-theme="wikistr"] span[title*="npub"][class*="text-gray"],
    [data-theme="wikistr"] span[title*="npub1"][class*="text-gray"],
    [data-theme="wikistr"] .text-gray-600[title*="npub"],
    [data-theme="wikistr"] span[class*="text-gray-600"][title*="npub"],
    [data-theme="wikistr"] .cursor-pointer[class*="hover:text"][title*="npub"],
    [data-theme="wikistr"] *[title*="npub"] {
      color: #ef4444 !important;
    }
    
    /* Wikistr - Force tagline and description to be light */
    [data-theme="wikistr"] h1, [data-theme="wikistr"] p, [data-theme="wikistr"] div {
      color: #f8fafc !important;
    }
    
    /* Wikistr - Specifically target Welcome card text */
    [data-theme="wikistr"] .text-center * {
      color: #f8fafc !important;
    }
    
    /* Wikistr - Target description text specifically */
    [data-theme="wikistr"] .text-center div,
    [data-theme="wikistr"] .text-center p,
    [data-theme="wikistr"] .text-center span,
    [data-theme="wikistr"] [style*="opacity: 0.7"],
    [data-theme="wikistr"] [style*="opacity: 0.8"] {
      color: #f8fafc !important;
    }
    
    /* Wikistr - Force links to be light blue */
    [data-theme="wikistr"] a {
      color: #60a5fa !important;
    }
    
    [data-theme="wikistr"] a:hover {
      color: #93c5fd !important;
    }
    
    /* Wikistr - Dark scrollbars */
    [data-theme="wikistr"] ::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }
    
    [data-theme="wikistr"] ::-webkit-scrollbar-track {
      background: #374151;
    }
    
    [data-theme="wikistr"] ::-webkit-scrollbar-thumb {
      background: #6b7280;
      border-radius: 6px;
    }
    
    [data-theme="wikistr"] ::-webkit-scrollbar-thumb:hover {
      background: #9ca3af;
    }
    
    [data-theme="wikistr"] ::-webkit-scrollbar-corner {
      background: #374151;
    }
    
    /* Wikistr - Override specific Tailwind classes that create light backgrounds */
    [data-theme="wikistr"] .bg-white,
    [data-theme="wikistr"] .bg-gray-50,
    [data-theme="wikistr"] .bg-gray-100,
    [data-theme="wikistr"] .bg-gray-200,
    [data-theme="wikistr"] .bg-stone-50,
    [data-theme="wikistr"] .bg-stone-100,
    [data-theme="wikistr"] .bg-slate-50,
    [data-theme="wikistr"] .bg-slate-100,
    [data-theme="wikistr"] .bg-zinc-50,
    [data-theme="wikistr"] .bg-zinc-100,
    [data-theme="wikistr"] .bg-red-50,
    [data-theme="wikistr"] .bg-orange-50,
    [data-theme="wikistr"] .bg-yellow-50,
    [data-theme="wikistr"] .bg-green-50,
    [data-theme="wikistr"] .bg-blue-50,
    [data-theme="wikistr"] .bg-indigo-50,
    [data-theme="wikistr"] .bg-purple-50,
    [data-theme="wikistr"] .bg-pink-50,
    [data-theme="wikistr"] .bg-emerald-50,
    [data-theme="wikistr"] .bg-teal-50,
    [data-theme="wikistr"] .bg-cyan-50,
    [data-theme="wikistr"] .bg-sky-50,
    [data-theme="wikistr"] .bg-violet-50,
    [data-theme="wikistr"] .bg-fuchsia-50,
    [data-theme="wikistr"] .bg-rose-50,
    [data-theme="wikistr"] .bg-neutral-50,
    [data-theme="wikistr"] .bg-amber-50,
    [data-theme="wikistr"] .bg-lime-50 {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - Target specific component classes */
    [data-theme="wikistr"] .embedded-event,
    [data-theme="wikistr"] .article-card,
    [data-theme="wikistr"] .comment-card,
    [data-theme="wikistr"] .event-card,
    [data-theme="wikistr"] .card,
    [data-theme="wikistr"] .panel,
    [data-theme="wikistr"] .comment,
    [data-theme="wikistr"] .comment-item {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - Target any element with bg- prefix */
    [data-theme="wikistr"] [class*="bg-"] {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - Override any remaining white backgrounds with more aggressive selectors */
    [data-theme="wikistr"] *[class*="bg-white"],
    [data-theme="wikistr"] *[class*="bg-gray-50"],
    [data-theme="wikistr"] *[class*="bg-stone-50"],
    [data-theme="wikistr"] *[class*="bg-slate-50"] {
      background-color: #1f2937 !important;
    }
    
    /* Wikistr - Override light borders */
    [data-theme="wikistr"] .border-gray-100,
    [data-theme="wikistr"] .border-gray-200,
    [data-theme="wikistr"] .border-gray-300,
    [data-theme="wikistr"] .border-stone-200,
    [data-theme="wikistr"] .border-slate-200,
    [data-theme="wikistr"] .border-zinc-200,
    [data-theme="wikistr"] .border,
    [data-theme="wikistr"] .border-2,
    [data-theme="wikistr"] .border-4,
    [data-theme="wikistr"] *[class*="border-"] {
      border-color: #374151 !important;
    }
    
    /* Wikistr - Override any white or light borders */
    [data-theme="wikistr"] *[style*="border-color: white"],
    [data-theme="wikistr"] *[style*="border-color: #ffffff"],
    [data-theme="wikistr"] *[style*="border-color: #fff"],
    [data-theme="wikistr"] *[style*="border: 1px solid white"],
    [data-theme="wikistr"] *[style*="border: 2px solid white"],
    [data-theme="wikistr"] *[style*="border: 1px solid #ffffff"],
    [data-theme="wikistr"] *[style*="border: 2px solid #ffffff"] {
      border-color: #374151 !important;
    }
    
    /* Wikistr - Force embedded event borders to be dark */
    [data-theme="wikistr"] .embedded-event,
    [data-theme="wikistr"] .embedded-event *,
    [data-theme="wikistr"] div[class*="embedded-event"] {
      border-color: #374151 !important;
    }
    
    /* Wikistr - Target any element with border-2 class specifically */
    [data-theme="wikistr"] .border-2 {
      border-color: #374151 !important;
    }
    
    /* Wikistr - Target content borders within embedded events */
    [data-theme="wikistr"] .border-gray-200,
    [data-theme="wikistr"] .border-gray-100,
    [data-theme="wikistr"] .border-gray-300,
    [data-theme="wikistr"] div[class*="border-gray-200"],
    [data-theme="wikistr"] div[class*="border-gray-100"],
    [data-theme="wikistr"] div[class*="border-gray-300"] {
      border-color: #374151 !important;
    }
    
    /* Wikistr - Target gradient backgrounds and make them dark */
    [data-theme="wikistr"] .bg-gradient-to-br,
    [data-theme="wikistr"] .from-gray-50,
    [data-theme="wikistr"] .to-gray-100,
    [data-theme="wikistr"] div[class*="bg-gradient"],
    [data-theme="wikistr"] div[class*="from-gray-50"],
    [data-theme="wikistr"] div[class*="to-gray-100"] {
      background: #1f2937 !important;
      border-color: #374151 !important;
    }
    
    /* Wikistr - Override light text colors */
    [data-theme="wikistr"] .text-gray-500,
    [data-theme="wikistr"] .text-gray-600,
    [data-theme="wikistr"] .text-gray-700,
    [data-theme="wikistr"] .text-gray-800,
    [data-theme="wikistr"] .text-gray-900,
    [data-theme="wikistr"] .text-stone-500,
    [data-theme="wikistr"] .text-stone-600,
    [data-theme="wikistr"] .text-slate-500,
    [data-theme="wikistr"] .text-slate-600 {
      color: #e5e7eb !important;
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
    
    /* Force antique serif fonts on ALL headers and titles - ONLY for biblestr theme */
    [data-theme="biblestr"] h1, [data-theme="biblestr"] h2, [data-theme="biblestr"] h3, [data-theme="biblestr"] h4, [data-theme="biblestr"] h5, [data-theme="biblestr"] h6, 
    [data-theme="biblestr"] .text-lg, [data-theme="biblestr"] .text-xl, [data-theme="biblestr"] .text-2xl, [data-theme="biblestr"] .text-3xl, [data-theme="biblestr"] .text-4xl, [data-theme="biblestr"] .text-5xl, [data-theme="biblestr"] .text-6xl,
    [data-theme="biblestr"] .font-semibold, [data-theme="biblestr"] .font-bold, [data-theme="biblestr"] .font-medium,
    [data-theme="biblestr"] [class*="title"], [data-theme="biblestr"] [class*="header"], [data-theme="biblestr"] [class*="heading"],
    [data-theme="biblestr"] .text-2xl, [data-theme="biblestr"] .text-3xl, [data-theme="biblestr"] .text-4xl, [data-theme="biblestr"] .text-5xl, [data-theme="biblestr"] .text-6xl,
    [data-theme="biblestr"] .font-bold, [data-theme="biblestr"] .font-semibold, [data-theme="biblestr"] .font-medium {
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
    
    /* All buttons white/transparent background with gray border - ONLY for biblestr theme */
    [data-theme="biblestr"] button, [data-theme="biblestr"] input[type="submit"], [data-theme="biblestr"] input[type="button"], 
    [data-theme="biblestr"] [role="button"], [data-theme="biblestr"] [type="submit"], [data-theme="biblestr"] [type="button"],
    [data-theme="biblestr"] button[class*="bg-"], [data-theme="biblestr"] button[class*="text-"] {
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
    
    /* LaTeX styling */
    .katex {
      font-size: 1em !important;
    }
    
    /* Ensure LaTeX expressions are visible with proper colors */
    .katex, .katex * {
      color: var(--theme-text) !important;
    }
    
    /* Override any global color inheritance for LaTeX */
    code .katex, code .katex * {
      color: var(--theme-text) !important;
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
<div class="flex overflow-x-scroll pb-2" draggable="false" bind:this={slider} data-theme={theme.name} style="background-color: {theme.backgroundColor}; color: {theme.textColor}; font-family: {theme.typography.fontFamily};">
  <CardElement card={{ type: 'welcome', id: -1 }} />

  {#each $cards as card (card.id)}
    <CardElement {card} />
  {/each}

  <!-- this is just empty -->
  {@render children?.()}

  <CardElement card={{ type: 'new', id: -1, back: undefined }} />
</div>
