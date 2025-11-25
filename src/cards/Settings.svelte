<script lang="ts">
  import { 
    saveCustomThemeConfig, 
    clearCustomThemeCache, 
    getAvailableThemes,
    saveThemeFile,
    getUploadedThemeFiles,
    deleteThemeFile
  } from '$lib/pdfThemes';
  import { get } from 'idb-keyval';
  import ModeToggle from '$components/ModeToggle.svelte';
  import { contentCache } from '$lib/contentCache';
  import { onMount } from 'svelte';
  import type { Card } from '$lib/types';
  import { account } from '$lib/nostr';
  import { getCacheRelayUrls, saveCacheRelayUrls } from '$lib/cacheRelay';
  import { relayService } from '$lib/relayService';

  interface Props {
    createChild?: (card: Card) => void;
  }

  let { createChild }: Props = $props();

  let activeTab = $state<'general' | 'themes'>('general');
  let activeThemeTab = $state<'config' | 'files'>('config');
  
  let isSaving = $state(false);
  let saveMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let hasCustomTheme = $state(false);
  let availableThemes = $state<string[]>([]);
  let uploadedThemeFiles = $state<Array<{ filename: string; content: string }>>([]);
  let isUploading = $state(false);
  let showInfo = $state(false);
  let currentRelays = $state<string[]>([]);
  let cacheRelays = $state<string[]>([]);
  let editingCacheRelays = $state(false);
  let cacheRelayInput = $state('');
  let isSavingCacheRelays = $state(false);
  let changelogEntry = $state<{ added?: string[]; changed?: string[]; fixed?: string[] } | null>(null);
  let changelogLoading = $state(true);
  let changelogError = $state<string | null>(null);
  let relayStatuses = $state<Map<string, 'parked' | 'retrying' | 'connected'>>(new Map());
  let isRefreshingRelays = $state(false);
  
  // Get version from package.json (injected at build time via vite.config.ts)
  const appVersion = (typeof __VERSION__ !== 'undefined' ? String(__VERSION__) : '5.0.0').trim();
  
  // Get changelog from build-time injection (parsed at build time)
  // __CHANGELOG__ is injected as a JSON string by Vite, so we parse it
  const buildTimeChangelog: { added?: string[]; changed?: string[]; fixed?: string[] } | null = 
    typeof __CHANGELOG__ !== 'undefined' && __CHANGELOG__ !== null && __CHANGELOG__ !== 'null'
      ? (typeof __CHANGELOG__ === 'string' ? JSON.parse(__CHANGELOG__) : __CHANGELOG__)
      : null;
  
  // Debug: log version in development
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('App version:', appVersion, '(type:', typeof appVersion, ')');
    console.log('Build-time changelog:', buildTimeChangelog ? 'loaded' : 'not available');
  }

  // Check if custom theme exists on mount
  async function checkCustomTheme() {
    try {
      const cached = await get('pdf-themes-config');
      hasCustomTheme = !!cached;
      availableThemes = await getAvailableThemes();
      uploadedThemeFiles = await getUploadedThemeFiles();
    } catch (error) {
      console.error('Failed to check custom theme:', error);
    }
  }

  $effect(() => {
    checkCustomTheme();
  });

  function updateRelayStatuses() {
    // Include all current relays so we show status for all of them
    relayStatuses = relayService.getAllRelayStatusesPublic([...currentRelays, ...cacheRelays]);
  }

  async function refreshAllRelays() {
    isRefreshingRelays = true;
    try {
      relayService.resetAllRelayFailuresPublic();
      updateRelayStatuses();
      // Reload relays from cache to refresh the list
      currentRelays = contentCache.getAllRelays();
      saveMessage = { type: 'success', text: 'All relay failures reset. Relays will be retried on next use.' };
      setTimeout(() => { saveMessage = null; }, 5000);
    } catch (error) {
      saveMessage = { type: 'error', text: 'Failed to refresh relays' };
    } finally {
      isRefreshingRelays = false;
    }
  }
  
  function getRelayStatusColor(status: 'parked' | 'retrying' | 'connected'): string {
    // Use theme variables for status colors
    return 'rounded';
  }
  
  function getRelayStatusStyle(status: 'parked' | 'retrying' | 'connected'): string {
    switch (status) {
      case 'parked':
        return 'background-color: var(--bg-secondary); color: var(--accent); opacity: 0.8;';
      case 'retrying':
        return 'background-color: var(--bg-secondary); color: var(--accent); opacity: 0.9;';
      case 'connected':
        return 'background-color: var(--bg-secondary); color: var(--accent);';
      default:
        return 'background-color: var(--bg-secondary); color: var(--text-secondary);';
    }
  }
  
  function getRelayStatusLabel(status: 'parked' | 'retrying' | 'connected'): string {
    switch (status) {
      case 'parked':
        return 'Parked (failed 3+ times)';
      case 'retrying':
        return 'Retrying (will retry with backoff)';
      case 'connected':
        return 'Connected';
      default:
        return 'Unknown';
    }
  }

  onMount(() => {
    // Get current relays from cache
    currentRelays = contentCache.getAllRelays();
    
    // Update relay statuses
    updateRelayStatuses();
    
    // Update relay statuses periodically
    const statusInterval = setInterval(() => {
      updateRelayStatuses();
    }, 5000); // Update every 5 seconds
    
    // Load cache relays (don't block on this)
    if ($account?.pubkey) {
      getCacheRelayUrls().then(urls => {
        cacheRelays = urls;
        updateRelayStatuses();
        // Trigger a status update after a short delay to catch any failures
        setTimeout(() => updateRelayStatuses(), 1000);
      }).catch(error => {
        console.warn('Failed to load cache relays:', error);
        cacheRelays = [];
        updateRelayStatuses();
      });
    }
    
    // Use build-time changelog (parsed during build, no runtime fetch needed)
    if (buildTimeChangelog) {
      changelogEntry = buildTimeChangelog;
      changelogLoading = false;
      changelogError = null;
    } else {
      // Fallback: if build-time changelog is not available, try to fetch it
      // (this should only happen in development if CHANGELOG.md is missing)
      changelogLoading = false;
      changelogError = 'Changelog not available';
      changelogEntry = null;
    }
    
    return () => {
      clearInterval(statusInterval);
    };
  });



  async function handleClear() {
    if (!confirm('Are you sure you want to clear the custom theme configuration? The default theme file will be used instead.')) {
      return;
    }

    try {
      await clearCustomThemeCache();
      hasCustomTheme = false;
      saveMessage = { type: 'success', text: 'Custom theme configuration cleared. Using default theme file.' };
      availableThemes = await getAvailableThemes();
      
      setTimeout(() => {
        saveMessage = null;
      }, 5000);
    } catch (error) {
      saveMessage = { type: 'error', text: 'Failed to clear custom theme' };
    }
  }

  async function handleThemeFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    isUploading = true;
    saveMessage = null;

    try {
      for (const file of Array.from(files)) {
        if (!file.name.endsWith('.yml') && !file.name.endsWith('.yaml')) {
          saveMessage = { type: 'error', text: `File ${file.name} must have .yml or .yaml extension` };
          continue;
        }

        const content = await file.text();
        const result = await saveThemeFile(file.name, content);

        if (result.success) {
          saveMessage = { type: 'success', text: `Theme file ${file.name} uploaded successfully!` };
        } else {
          saveMessage = { type: 'error', text: `Failed to upload ${file.name}: ${result.error}` };
          break;
        }
      }

      uploadedThemeFiles = await getUploadedThemeFiles();
      
      setTimeout(() => {
        saveMessage = null;
      }, 5000);
    } catch (error) {
      saveMessage = { type: 'error', text: error instanceof Error ? error.message : 'Failed to upload theme file' };
    } finally {
      isUploading = false;
      input.value = ''; // Reset input
    }
  }

  async function handlePdfThemesUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.name !== 'pdf-themes.yml' && file.name !== 'pdf-themes.yaml') {
      saveMessage = { type: 'error', text: 'File must be named pdf-themes.yml or pdf-themes.yaml' };
      input.value = '';
      return;
    }

    isSaving = true;
    saveMessage = null;

    try {
      const content = await file.text();
      const result = await saveCustomThemeConfig(content);

      if (result.success) {
        saveMessage = { type: 'success', text: 'pdf-themes.yml uploaded and saved successfully! It will be used for all PDF/EPUB exports.' };
        hasCustomTheme = true;
        availableThemes = await getAvailableThemes();
        
        setTimeout(() => {
          saveMessage = null;
        }, 5000);
      } else {
        saveMessage = { type: 'error', text: result.error || 'Failed to save theme configuration' };
      }
    } catch (error) {
      saveMessage = { type: 'error', text: error instanceof Error ? error.message : 'An unexpected error occurred' };
    } finally {
      isSaving = false;
      input.value = ''; // Reset input
    }
  }

  async function handleDeleteThemeFile(filename: string) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) {
      return;
    }

    try {
      await deleteThemeFile(filename);
      uploadedThemeFiles = await getUploadedThemeFiles();
      saveMessage = { type: 'success', text: `Theme file ${filename} deleted.` };
      
      setTimeout(() => {
        saveMessage = null;
      }, 3000);
    } catch (error) {
      saveMessage = { type: 'error', text: 'Failed to delete theme file' };
    }
  }

</script>

<!-- Main Tabs -->
<div class="w-full max-w-6xl mx-auto">
  <div class="border-b mb-6" style="border-color: var(--border);">
    <nav class="flex space-x-8" aria-label="Tabs">
      <button
        onclick={() => activeTab = 'general'}
        class="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
        style="border-color: {activeTab === 'general' ? 'var(--accent)' : 'transparent'}; color: {activeTab === 'general' ? 'var(--accent)' : 'var(--text-secondary)'};"
        onmouseenter={(e) => { if (activeTab !== 'general') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onmouseleave={(e) => { if (activeTab !== 'general') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        General
      </button>
      <button
        onclick={() => activeTab = 'themes'}
        class="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
        style="border-color: {activeTab === 'themes' ? 'var(--accent)' : 'transparent'}; color: {activeTab === 'themes' ? 'var(--accent)' : 'var(--text-secondary)'};"
        onmouseenter={(e) => { if (activeTab !== 'themes') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onmouseleave={(e) => { if (activeTab !== 'themes') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        PDF Themes
      </button>
    </nav>
  </div>

  <!-- General Tab -->
  {#if activeTab === 'general'}
    <div class="space-y-6 min-h-[60vh] md:min-h-[70vh]">
      <!-- Appearance -->
      <div>
        <h3 class="text-lg font-medium mb-2">Appearance</h3>
        <div class="flex items-center gap-2">
          <span>Toggle light/dark mode</span>
          <ModeToggle />
        </div>
      </div>

      <!-- Relays -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-medium">Relays</h3>
          <button
            onclick={refreshAllRelays}
            disabled={isRefreshingRelays}
            class="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefreshingRelays ? 'Refreshing...' : 'Refresh Relays'}
          </button>
        </div>
        {#if currentRelays.length > 0}
          <ul class="space-y-2 max-h-64 overflow-y-auto list-none p-3 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
            {#each currentRelays as relay}
              {@const status = relayStatuses.get(relay) || 'connected'}
              <li class="flex items-center gap-2 text-sm">
                <span class="flex-1 break-all" style="color: var(--text-primary);">{relay}</span>
                <span class="text-xs px-2 py-0.5 rounded {getRelayStatusColor(status)}" style={getRelayStatusStyle(status)} title={getRelayStatusLabel(status)}>
                  {status === 'parked' ? '🔴' : status === 'retrying' ? '🟡' : '🟢'}
                </span>
                {#if cacheRelays.includes(relay)}
                  <span class="text-xs px-2 py-0.5 rounded" style="background-color: var(--bg-secondary); color: var(--accent);">Cache</span>
                {/if}
              </li>
            {/each}
          </ul>
          <div class="mt-2 text-xs p-2 rounded border" style="background-color: var(--bg-primary); border-color: var(--border); color: var(--text-secondary);">
            <div>🟢 Connected</div>
            <div>🟡 Retrying (1-2 failures)</div>
            <div>🔴 Parked (3+ failures, click Refresh to retry)</div>
          </div>
        {:else}
          <p class="text-sm" style="color: var(--text-secondary);">No relays used yet</p>
        {/if}
      </div>

      <!-- Cache Relays -->
      {#if $account?.pubkey}
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-lg font-medium">Cache Relays</h3>
            {#if !editingCacheRelays}
              <button
                onclick={() => {
                  editingCacheRelays = true;
                  cacheRelayInput = cacheRelays.join('\n');
                }}
                class="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
              >
                {cacheRelays.length > 0 ? 'Edit' : 'Add'}
              </button>
            {/if}
          </div>
          
          {#if editingCacheRelays}
            <div class="space-y-3 p-4 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
              <div>
                <label for="cache-relay-input" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">
                  Cache Relay URLs (one per line, ws:// or wss://)
                </label>
                <textarea
                  id="cache-relay-input"
                  bind:value={cacheRelayInput}
                  placeholder="ws://localhost:8080&#10;ws://192.168.1.100:8080"
                  rows="4"
                  class="w-full px-3 py-2 rounded-md shadow-sm focus:outline-none focus:ring-2"
                  style="background-color: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); --tw-ring-color: var(--accent);"
                ></textarea>
                <p class="mt-1 text-xs" style="color: var(--text-secondary);">
                  Enter cache relay URLs (ws:// or wss:// addresses), one per line
                </p>
              </div>
              <div class="flex gap-2 mt-3">
                <button
                  onclick={async () => {
                    isSavingCacheRelays = true;
                    saveMessage = null;
                    try {
                      const urls = cacheRelayInput
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0);
                      
                      const result = await saveCacheRelayUrls(urls);
                      if (result.success) {
                        cacheRelays = urls;
                        editingCacheRelays = false;
                        cacheRelayInput = '';
                        saveMessage = { type: 'success', text: 'Cache relays saved successfully!' };
                        setTimeout(() => { saveMessage = null; }, 5000);
                      } else {
                        saveMessage = { type: 'error', text: result.error || 'Failed to save cache relays' };
                      }
                    } catch (error) {
                      saveMessage = { type: 'error', text: error instanceof Error ? error.message : 'Failed to save cache relays' };
                    } finally {
                      isSavingCacheRelays = false;
                    }
                  }}
                  disabled={isSavingCacheRelays}
                  class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isSavingCacheRelays ? 'Saving...' : 'Save'}
                </button>
                <button
                  onclick={() => {
                    editingCacheRelays = false;
                    cacheRelayInput = '';
                  }}
                  disabled={isSavingCacheRelays}
                  class="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <div class="p-3 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
              {#if cacheRelays.length > 0}
                <ul class="space-y-1 list-none">
                  {#each cacheRelays as relay}
                    <li class="text-sm" style="color: var(--text-primary);">{relay}</li>
                  {/each}
                </ul>
              {:else}
                <p class="text-sm" style="color: var(--text-secondary);">No cache relays configured</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Version -->
      <div>
        <h3 class="text-lg font-medium mb-2">Version</h3>
        <div>WikiStr v{appVersion}</div>
        <div class="mt-1 opacity-75">from GitCitadel</div>
        <div class="mt-4 p-4 rounded-lg border" style="background-color: var(--bg-primary); border-color: var(--border);">
          <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Recent Changes</h4>
          {#if changelogEntry}
            <div class="text-sm space-y-2" style="color: var(--text-primary);">
              {#if changelogEntry.added && changelogEntry.added.length > 0}
                <div>
                  <span class="font-medium" style="color: var(--accent);">Added:</span>
                  <ul class="list-disc list-inside ml-2 mt-1" style="color: var(--text-primary);">
                    {#each changelogEntry.added as item}
                      <li>{item}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if changelogEntry.changed && changelogEntry.changed.length > 0}
                <div>
                  <span class="font-medium" style="color: var(--accent);">Changed:</span>
                  <ul class="list-disc list-inside ml-2 mt-1" style="color: var(--text-primary);">
                    {#each changelogEntry.changed as item}
                      <li>{item}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if changelogEntry.fixed && changelogEntry.fixed.length > 0}
                <div>
                  <span class="font-medium" style="color: var(--accent);">Fixed:</span>
                  <ul class="list-disc list-inside ml-2 mt-1" style="color: var(--text-primary);">
                    {#each changelogEntry.fixed as item}
                      <li>{item}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {:else if changelogLoading}
            <div class="text-sm" style="color: var(--text-secondary);">
              Loading changelog...
            </div>
          {:else if changelogError}
            <div class="text-sm" style="color: var(--text-secondary);">
              {changelogError}
            </div>
          {:else}
            <div class="text-sm" style="color: var(--text-secondary);">
              No changelog available for this version.
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- PDF Themes Tab -->
  {#if activeTab === 'themes'}
    <div class="border rounded-lg p-4 md:p-6 lg:p-8 min-h-[60vh] md:min-h-[70vh]" style="border-color: var(--border);">
      <div class="flex items-center gap-2 mb-6">
        <h2 class="text-2xl font-semibold">PDF Theme Configuration</h2>
        <div class="relative">
          <button
            type="button"
            onmouseenter={() => showInfo = true}
            onmouseleave={() => showInfo = false}
            class="w-6 h-6 rounded-full border border-gray-400 dark:border-gray-600 flex items-center justify-center text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-help"
            title="Click for info"
          >
            i
          </button>
          {#if showInfo}
            <div class="absolute left-0 top-8 w-80 md:w-96 p-4 rounded-lg shadow-lg z-10 text-sm border" style="background-color: var(--bg-primary); border-color: var(--border);">
              <p class="mb-2 font-semibold" style="color: var(--text-primary);">How it works:</p>
              <ul class="list-disc list-inside space-y-1" style="color: var(--text-primary);">
                <li>Upload <code class="px-1 rounded" style="background-color: var(--bg-secondary);">pdf-themes.yml</code> to define which themes appear in the download menu dropdown</li>
                <li>Upload individual theme files (e.g., <code class="px-1 rounded" style="background-color: var(--bg-secondary);">my-theme.yml</code>) that define the actual styling</li>
                <li>The <code class="px-1 rounded" style="background-color: var(--bg-secondary);">pdf-themes.yml</code> file references these theme files via the <code class="px-1 rounded" style="background-color: var(--bg-secondary);">file</code> field</li>
                <li>Only the newest <code class="px-1 rounded" style="background-color: var(--bg-secondary);">pdf-themes.yml</code> is used (uploading a new one replaces the old)</li>
                <li>You can upload multiple theme files - all will be available if referenced in <code class="px-1 rounded" style="background-color: var(--bg-secondary);">pdf-themes.yml</code></li>
              </ul>
            </div>
          {/if}
        </div>
      </div>
      
      {#if hasCustomTheme}
        <div class="mb-6 p-4 rounded border" style="background-color: var(--bg-secondary); border-color: var(--border);">
          <p class="text-sm" style="color: var(--text-primary);">
            ✓ Custom theme configuration is active. It will be used instead of the default theme file.
          </p>
        </div>
      {/if}

      {#if saveMessage}
        <div class="mb-6 p-4 rounded {saveMessage.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}">
          <p class="text-sm {saveMessage.type === 'success' ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}">
            {saveMessage.text}
          </p>
        </div>
      {/if}

      <!-- Theme Sub-tabs -->
      <div class="border-b mb-6" style="border-color: var(--border);">
        <nav class="flex space-x-4 md:space-x-8 overflow-x-auto" aria-label="Theme sub-tabs">
          <button
            onclick={() => activeThemeTab = 'config'}
            class="py-3 px-2 md:px-4 border-b-2 font-medium text-sm whitespace-nowrap transition-colors"
            style="border-color: {activeThemeTab === 'config' ? 'var(--accent)' : 'transparent'}; color: {activeThemeTab === 'config' ? 'var(--accent)' : 'var(--text-secondary)'};"
            onmouseenter={(e) => { if (activeThemeTab !== 'config') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
            onmouseleave={(e) => { if (activeThemeTab !== 'config') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
          >
            Configuration
          </button>
          <button
            onclick={() => activeThemeTab = 'files'}
            class="py-3 px-2 md:px-4 border-b-2 font-medium text-sm whitespace-nowrap transition-colors"
            style="border-color: {activeThemeTab === 'files' ? 'var(--accent)' : 'transparent'}; color: {activeThemeTab === 'files' ? 'var(--accent)' : 'var(--text-secondary)'};"
            onmouseenter={(e) => { if (activeThemeTab !== 'files') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
            onmouseleave={(e) => { if (activeThemeTab !== 'files') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
          >
            Theme Files
          </button>
        </nav>
      </div>

      <!-- Configuration Tab -->
      {#if activeThemeTab === 'config'}
        <div class="space-y-6">
          <div>
            <label for="pdf-themes-upload" class="block text-sm font-medium mb-3">
              Upload pdf-themes.yml (replaces existing)
            </label>
            <input
              type="file"
              id="pdf-themes-upload"
              accept=".yml,.yaml"
              onchange={handlePdfThemesUpload}
              disabled={isSaving || isUploading}
              class="block w-full text-base md:text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-3 md:file:py-2 file:px-6 md:file:px-4 file:rounded-md file:border-0 file:text-base md:file:text-sm file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-900/20 file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/40 disabled:opacity-50 cursor-pointer"
            />
            <p class="mt-2 text-sm" style="color: var(--text-secondary);">
              Upload a pdf-themes.yml file to define available themes. Only the newest upload is used.
            </p>
          </div>

          {#if availableThemes.length > 0}
            <div class="p-4 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
              <p class="text-sm font-medium mb-3" style="color: var(--text-primary);">Available Themes (from pdf-themes.yml):</p>
              <div class="flex flex-wrap gap-2">
                {#each availableThemes as theme}
                  <span class="px-3 py-1.5 rounded text-sm" style="background-color: var(--bg-secondary); color: var(--text-primary);">
                    {theme}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          {#if hasCustomTheme}
            <div>
              <button
                onclick={handleClear}
                disabled={isSaving || isUploading}
                class="inline-flex items-center px-6 py-3 border border-gray-300 dark:border-gray-700 text-base md:text-sm font-medium rounded-md shadow-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear Custom Theme Config
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Theme Files Tab -->
      {#if activeThemeTab === 'files'}
        <div class="space-y-6">
          <div>
            <label for="theme-files-upload" class="block text-sm font-medium mb-3">
              Upload Theme Files (.yml)
            </label>
            <input
              type="file"
              id="theme-files-upload"
              accept=".yml,.yaml"
              multiple
              onchange={handleThemeFileUpload}
              disabled={isSaving || isUploading}
              class="block w-full text-base md:text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-3 md:file:py-2 file:px-6 md:file:px-4 file:rounded-md file:border-0 file:text-base md:file:text-sm file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-900/20 file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/40 disabled:opacity-50 cursor-pointer"
            />
            <p class="mt-2 text-sm" style="color: var(--text-secondary);">
              Upload one or more theme files (e.g., my-theme.yml). These define the actual PDF styling.
            </p>
          </div>

          {#if uploadedThemeFiles.length > 0}
            <div>
              <p class="text-sm font-medium mb-3">Uploaded Theme Files:</p>
              <div class="space-y-2 max-h-64 md:max-h-96 overflow-y-auto">
                {#each uploadedThemeFiles as file}
                  <div class="flex items-center justify-between p-3 md:p-2 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
                    <span class="text-sm md:text-base font-mono break-all" style="color: var(--text-primary);">{file.filename}</span>
                    <button
                      onclick={() => handleDeleteThemeFile(file.filename)}
                      class="ml-4 text-lg md:text-base font-bold hover:opacity-80"
                      style="color: var(--accent);"
                      title="Delete theme file"
                    >
                      ✕
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="text-center py-8 rounded border" style="background-color: var(--bg-primary); border-color: var(--border);">
              <p style="color: var(--text-secondary);">No theme files uploaded yet.</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Ensure proper scrolling on mobile */
  @media (max-width: 768px) {
    :global(.settings-container) {
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }
  }
</style>
