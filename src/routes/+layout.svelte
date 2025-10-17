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
    /* Theme variables - minimal override for dynamic theme switching */
    :root {
      --accent: {theme.accentColor};
      --accent-hover: {theme.accentColor};
      --highlight: {theme.highlightColor};
      --font-family: {theme.typography.fontFamily};
      --font-family-heading: {theme.typography.fontFamilyHeading};
    }
  </style>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="flex overflow-x-scroll pb-2" draggable="false" bind:this={slider} data-theme={theme.name} data-mode="dark">
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
