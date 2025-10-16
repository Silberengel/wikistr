<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.postcss';
  import { cards } from '$lib/state';
  import { isElementInViewport, getParentCard } from '$lib/utils';
  import CardElement from '$components/CardElement.svelte';
  import { getThemeConfig } from '$lib/themes';
  import Toast from '$components/Toast.svelte';

  // Theme configuration
  const theme = getThemeConfig();
  
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Drag scrolling state
  let dragging = false;
  let startX: number;
  let scrollLeft: number;
  let slider: HTMLElement;

  // Initialization state to prevent loops
  let initialized = false;
  let initializationPromise: Promise<void> | null = null;

  /**
   * Initialize layout with error handling and loop prevention
   */
  async function initializeLayout(): Promise<void> {
    if (initialized) return;
    
    if (initializationPromise) {
      return initializationPromise;
    }
    
    initializationPromise = performInitialization();
    await initializationPromise;
  }

  async function performInitialization(): Promise<void> {
    if (initialized) return;
    
    try {
      console.log('🚀 Initializing layout...');
      
      // Set up event listeners
      setupEventListeners();
      
      // Set up error handlers
      setupErrorHandlers();
      
      initialized = true;
      console.log('✅ Layout initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize layout:', error);
      // Don't rethrow - allow app to continue
    }
  }

  /**
   * Set up mouse event listeners for drag scrolling
   */
  function setupEventListeners(): void {
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousemove', onMouseMove);
  }

  /**
   * Set up global error handlers
   */
  function setupErrorHandlers(): void {
    // Handle image loading errors silently
    document.addEventListener('error', (e) => {
      if (e.target instanceof HTMLImageElement) {
        const img = e.target as HTMLImageElement;
        img.style.display = 'none';
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      if (error && typeof error === 'object' && error.message) {
        const message = error.message.toLowerCase();
        
        // Handle common relay errors gracefully
        if (message.includes('auth-required') || 
            message.includes('rate-limited') || 
            message.includes('connection') ||
            message.includes('timeout')) {
          
          console.info('ℹ️ Relay operation info:', {
            message: error.message,
            details: 'This is normal behavior for relay operations',
            action: 'The app will continue normally'
          });
          
          event.preventDefault();
          return;
        }
        
        // Log other errors but don't crash
        console.warn('Unhandled promise rejection:', error);
        event.preventDefault();
      }
    });

    // Handle general errors
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      // Don't prevent default - let browser handle it
    });
  }

  /**
   * Mouse down handler for drag scrolling
   */
  function onMouseDown(ev: MouseEvent): void {
    if (!slider) return;

    const path = ev.composedPath();
    if (path[0] !== slider) return;

    if (ev.target instanceof HTMLElement) {
      const card = getParentCard(ev.target);
      if (card && isElementInViewport(card)) return;
    }

    dragging = true;
    startX = ev.clientX - slider.offsetLeft;
    scrollLeft = slider.scrollLeft;
  }

  /**
   * Mouse up handler
   */
  function onMouseUp(ev: MouseEvent): void {
    if (dragging) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    dragging = false;
  }

  /**
   * Mouse move handler for drag scrolling
   */
  function onMouseMove(ev: MouseEvent): void {
    if (!slider || !dragging) return;
    
    ev.preventDefault();
    slider.scrollLeft = scrollLeft + startX - ev.clientX;
  }

  /**
   * Cleanup function
   */
  function cleanup(): void {
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousemove', onMouseMove);
  }

  // Initialize on mount
  onMount(() => {
    initializeLayout();
    
    return cleanup;
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
    
    /* Theme-specific styling */
    [data-theme="biblestr"] {
      /* Apply biblestr-specific overrides */
    }
    
    [data-theme="wikistr"] {
      /* Apply wikistr-specific overrides */
    }
    
    /* Wikistr buttons - modern dark theme styling */
    [data-theme="wikistr"] button, [data-theme="wikistr"] input[type="submit"], [data-theme="wikistr"] input[type="button"], 
    [data-theme="wikistr"] [role="button"], [data-theme="wikistr"] [type="submit"], [data-theme="wikistr"] [type="button"] {
      background-color: #374151 !important;
      background: #374151 !important;
      color: #f8fafc !important;
      border: 1px solid #4b5563 !important;
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
      background-color: #4b5563 !important;
      background: #4b5563 !important;
      color: #ffffff !important;
      border-color: #6b7280 !important;
    }
    
    /* Wikistr panels and cards - darker backgrounds */
    [data-theme="wikistr"] .bg-white, [data-theme="wikistr"] .bg-gray-50, [data-theme="wikistr"] .bg-gray-100,
    [data-theme="wikistr"] .bg-brown-50, [data-theme="wikistr"] .bg-brown-100, [data-theme="wikistr"] .bg-brown-200,
    [data-theme="wikistr"] .bg-slate-50, [data-theme="wikistr"] .bg-slate-100 {
      background-color: #111827 !important;
    }
    
    /* Wikistr text colors - make all text lighter */
    [data-theme="wikistr"] h1, [data-theme="wikistr"] h2, [data-theme="wikistr"] h3, [data-theme="wikistr"] h4, [data-theme="wikistr"] h5, [data-theme="wikistr"] h6,
    [data-theme="wikistr"] p, [data-theme="wikistr"] div, [data-theme="wikistr"] span,
    [data-theme="wikistr"] .text-gray-900, [data-theme="wikistr"] .text-gray-800, [data-theme="wikistr"] .text-gray-700,
    [data-theme="wikistr"] .text-espresso-900, [data-theme="wikistr"] .text-espresso-800, [data-theme="wikistr"] .text-espresso-700,
    [data-theme="wikistr"] .text-espresso-600, [data-theme="wikistr"] .text-espresso-500, [data-theme="wikistr"] .text-espresso-400 {
      color: #e5e7eb !important;
    }
    
    /* Wikistr borders - muted colors */
    [data-theme="wikistr"] .border, [data-theme="wikistr"] .border-gray-300, [data-theme="wikistr"] .border-gray-200,
    [data-theme="wikistr"] .border-white, [data-theme="wikistr"] .border-slate-300, [data-theme="wikistr"] .border-slate-200 {
      border-color: #6b46c1 !important;
    }
    
    /* Wikistr input fields */
    [data-theme="wikistr"] input, [data-theme="wikistr"] textarea, [data-theme="wikistr"] select {
      background-color: #374151 !important;
      border-color: #4b5563 !important;
      color: #f8fafc !important;
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
    
    /* Burgundy hover effects for links */
    a:hover {
      color: var(--theme-highlight) !important;
      text-decoration: underline !important;
    }
    
    /* Make sure hover states work */
    a, button, .cursor-pointer {
      transition: color 0.2s ease, background-color 0.2s ease !important;
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

<!-- Toast Notifications -->
<Toast />
