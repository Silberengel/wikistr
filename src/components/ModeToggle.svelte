<script lang="ts">
  import { onMount } from 'svelte';
  import { getThemeConfig, getThemeDefaultMode } from '$lib/themes';
  
  let currentMode = $state<'light' | 'dark'>('dark');
  
  // Load saved mode preference or use theme default
  onMount(() => {
    const savedMode = localStorage.getItem('wikistr-mode') as 'light' | 'dark' | null;
    const themeDefault = getThemeDefaultMode();
    console.log('🎨 Mode initialization:', { savedMode, themeDefault });
    
    if (savedMode) {
      currentMode = savedMode;
      console.log('🎨 Using saved mode:', savedMode);
    } else {
      // Use theme's default mode if no saved preference
      currentMode = themeDefault;
      console.log('🎨 Using theme default mode:', themeDefault);
    }
    applyMode();
  });
  
  function toggleMode() {
    currentMode = currentMode === 'light' ? 'dark' : 'light';
    applyMode();
    localStorage.setItem('wikistr-mode', currentMode);
  }
  
  function applyMode() {
    console.log('🎨 Applying mode:', currentMode);
    document.documentElement.setAttribute('data-mode', currentMode);
    // Also update the main container div that has data-mode attribute
    const mainContainer = document.querySelector('[data-theme]');
    if (mainContainer) {
      mainContainer.setAttribute('data-mode', currentMode);
      console.log('🎨 Updated main container data-mode to:', currentMode);
    } else {
      console.warn('⚠️ Main container with data-theme not found');
    }
    
    // Dispatch custom event to notify layout of mode change
    window.dispatchEvent(new CustomEvent('mode-change', { 
      detail: { mode: currentMode } 
    }));
  }
  
  // Export for external access
  export function getCurrentMode() {
    return currentMode;
  }
  
  export function setMode(mode: 'light' | 'dark') {
    currentMode = mode;
    applyMode();
    localStorage.setItem('wikistr-mode', mode);
  }
</script>

<button
  onclick={toggleMode}
  class="mode-toggle"
  type="button"
  aria-label="Toggle light/dark mode"
  title="Toggle light/dark mode"
>
  {#if currentMode === 'dark'}
    <!-- Sun icon for light mode -->
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  {:else}
    <!-- Moon icon for dark mode -->
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  {/if}
</button>

<style>
  .mode-toggle {
    @apply p-2 rounded-md border transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2;
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--border);
  }
  
  .mode-toggle:hover {
    background-color: var(--bg-tertiary);
  }
  
  .mode-toggle:focus {
    --tw-ring-color: var(--accent);
  }
</style>
