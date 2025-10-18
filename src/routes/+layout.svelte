<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.postcss';
  import { cards } from '$lib/state';
  import { isElementInViewport, getParentCard } from '$lib/utils';
  import CardElement from '$components/CardElement.svelte';
  import { getThemeConfig, generatePaletteFromAccent, getThemeDefaultMode } from '$lib/themes';
  import Toast from '$components/Toast.svelte';
  import { initializeBookConfigurations } from '$lib/bookConfig';

  // Theme configuration
  const theme = getThemeConfig();
  
  // Generate palette from accent color
  const palette = generatePaletteFromAccent(theme.accentColor, theme);
  
  // Get theme's default mode
  const themeDefaultMode = getThemeDefaultMode();
  
  // Reactive mode state - will be updated by ModeToggle
  let currentMode = $state(themeDefaultMode);
  
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
      
      // Initialize book configurations
      console.log('📚 Initializing book configurations...');
      await initializeBookConfigurations();
      console.log('✅ Book configurations initialized');
      
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
    
    // Initialize mode from localStorage
    const savedMode = localStorage.getItem('wikistr-mode') as 'light' | 'dark' | null;
    if (savedMode) {
      currentMode = savedMode;
    }
    
    // Listen for mode changes from ModeToggle
    const handleModeChange = (event: CustomEvent) => {
      currentMode = event.detail.mode;
    };
    
    window.addEventListener('mode-change', handleModeChange as EventListener);
    
    return () => {
      cleanup();
      window.removeEventListener('mode-change', handleModeChange as EventListener);
    };
  });

  // Reactive effect to update CSS variables when mode changes
  $effect(() => {
    const root = document.documentElement;
    const paletteToUse = currentMode === 'light' ? palette.light : palette.dark;
    
    // Use the proper palette colors for each mode
    if (currentMode === 'light') {
      // Light mode: use light colors from palette
      // Page background is now derived from accent color
      root.style.setProperty('--page-bg', paletteToUse.pageBg); // Derived from accent color
      root.style.setProperty('--bg-primary', paletteToUse.primary); // White/light beige panels
      root.style.setProperty('--bg-secondary', paletteToUse.secondary); // Slightly darker for secondary elements
      root.style.setProperty('--bg-tertiary', paletteToUse.tertiary); // Even darker for tertiary elements
      root.style.setProperty('--text-primary', paletteToUse.text); // Algorithmic text color
      root.style.setProperty('--text-secondary', paletteToUse.textSecondary); // Algorithmic secondary text
      root.style.setProperty('--text-muted', paletteToUse.textMuted); // Algorithmic muted text
    } else {
      // Dark mode: use dark colors from palette
      root.style.setProperty('--page-bg', paletteToUse.pageBg); // Derived from accent color
      root.style.setProperty('--bg-primary', paletteToUse.primary); // Dark panels
      root.style.setProperty('--bg-secondary', paletteToUse.secondary); // Slightly lighter dark for secondary elements
      root.style.setProperty('--bg-tertiary', paletteToUse.tertiary); // Even lighter dark for tertiary elements
      root.style.setProperty('--text-primary', paletteToUse.text); // Light text for dark backgrounds
      root.style.setProperty('--text-secondary', paletteToUse.textSecondary); // Slightly dimmed light text
      root.style.setProperty('--text-muted', paletteToUse.textMuted); // Muted light text
    }
    root.style.setProperty('--border', paletteToUse.border);
    root.style.setProperty('--accent', paletteToUse.accent);
    root.style.setProperty('--accent-hover', paletteToUse.accentHover);
    root.style.setProperty('--highlight', paletteToUse.highlight);
    
    // Code styling - inline code gets pale accent background
    if (currentMode === 'light') {
      root.style.setProperty('--code-bg', 'rgba(139, 92, 246, 0.1)'); // Pale accent color
      root.style.setProperty('--code-text', '#374151'); // Dark gray text
      root.style.setProperty('--code-border', 'rgba(139, 92, 246, 0.2)');
    } else {
      root.style.setProperty('--code-bg', 'rgba(139, 92, 246, 0.15)'); // Slightly more visible pale accent
      root.style.setProperty('--code-text', '#e5e7eb'); // Light gray text
      root.style.setProperty('--code-border', 'rgba(139, 92, 246, 0.3)');
    }
    
    // Code block styling - use appropriate colors for each mode
    root.style.setProperty('--code-block-bg', currentMode === 'light' ? '#374151' : '#1f2937');
    root.style.setProperty('--code-block-text', currentMode === 'light' ? '#f9fafb' : '#e5e7eb');
    root.style.setProperty('--code-block-border', currentMode === 'light' ? '#4b5563' : '#374151');
    
    // Syntax highlighting colors for better contrast
    if (currentMode === 'light') {
      // Light mode syntax highlighting
      root.style.setProperty('--syntax-string', '#0d9488'); // Dark teal for strings
      root.style.setProperty('--syntax-number', '#dc2626'); // Dark red for numbers
      root.style.setProperty('--syntax-literal', '#7c2d12'); // Dark orange for literals
      root.style.setProperty('--syntax-keyword', '#7c3aed'); // Purple for keywords
      root.style.setProperty('--syntax-attr', '#059669'); // Dark green for attributes
      root.style.setProperty('--syntax-json-key', '#2563eb'); // Dark blue for JSON keys
      root.style.setProperty('--syntax-json-string', '#0d9488'); // Dark teal for JSON strings
      root.style.setProperty('--syntax-json-number', '#dc2626'); // Dark red for JSON numbers
      root.style.setProperty('--syntax-json-literal', '#7c2d12'); // Dark orange for JSON literals
    } else {
      // Dark mode syntax highlighting - brighter colors for better contrast
      root.style.setProperty('--syntax-string', '#6ee7b7'); // Bright green for strings
      root.style.setProperty('--syntax-number', '#fde047'); // Bright yellow for numbers
      root.style.setProperty('--syntax-literal', '#fb7185'); // Bright pink for literals
      root.style.setProperty('--syntax-keyword', '#a78bfa'); // Purple for keywords
      root.style.setProperty('--syntax-attr', '#86efac'); // Bright green for attributes
      root.style.setProperty('--syntax-json-key', '#93c5fd'); // Light blue for JSON keys
      root.style.setProperty('--syntax-json-string', '#6ee7b7'); // Bright green for JSON strings
      root.style.setProperty('--syntax-json-number', '#fde047'); // Bright yellow for JSON numbers
      root.style.setProperty('--syntax-json-literal', '#fb7185'); // Bright pink for JSON literals
    }
    
    console.log('🎨 CSS variables updated for mode:', currentMode);
  });
</script>

<svelte:head>
  <title>{theme.title}</title>
  <style>
    /* Theme variables - dynamically generated from accent color */
    :root {
      /* Default dark mode palette */
      --bg-primary: {palette.dark.primary};
      --bg-secondary: {palette.dark.secondary};
      --bg-tertiary: {palette.dark.tertiary};
      --text-primary: {palette.dark.text};
      --text-secondary: {palette.dark.textSecondary};
      --text-muted: {palette.dark.textMuted};
      --border: {palette.dark.border};
      --accent: {palette.dark.accent};
      --accent-hover: {palette.dark.accentHover};
      --highlight: {palette.dark.highlight};
      --page-bg: {palette.dark.pageBg};
      --font-family: {theme.typography.fontFamily};
      --font-family-heading: {theme.typography.fontFamilyHeading};
    }
  </style>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="flex overflow-x-scroll pb-2 pr-4" draggable="false" bind:this={slider} data-theme={theme.name} data-mode={currentMode}>
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
