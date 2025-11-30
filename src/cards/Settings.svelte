<script lang="ts">
  import ModeToggle from '$components/ModeToggle.svelte';
  import { contentCache } from '$lib/contentCache';
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { Card } from '$lib/types';
  import { account } from '$lib/nostr';
  import { getCacheRelayUrls, saveCacheRelayUrls } from '$lib/cacheRelay';
  import { relayService } from '$lib/relayService';
  import BookmarksPanel from '$components/BookmarksPanel.svelte';
  import { consoleLogStore, type ConsoleLog, type LogLevel } from '$lib/consoleLogStore';

  interface Props {
    createChild?: (card: Card) => void;
  }

  let { createChild }: Props = $props();

  let activeTab = $state<'general' | 'bookmarks' | 'versions' | 'console'>('general');
  
  let saveMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
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
  
  // Console viewer state
  let consoleLogs = $state<ConsoleLog[]>([]);
  let consoleSearchQuery = $state('');
  let consoleLogLevelFilter = $state<LogLevel | 'ALL'>('ALL');
  let originalConsoleLog: typeof console.log | null = null;
  let originalConsoleError: typeof console.error | null = null;
  let originalConsoleWarn: typeof console.warn | null = null;
  let unsubscribeConsoleLogs: (() => void) | null = null;
  let copyButtonText = $state('Copy Logs');
  
  // Helper to safely update filter
  function setLogLevelFilter(level: LogLevel | 'ALL') {
    try {
      consoleLogLevelFilter = level;
    } catch (error) {
      console.error('Error setting log level filter:', error);
    }
  }
  
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

  // Console log capture functions
  function startConsoleCapture() {
    if (originalConsoleLog) return; // Already capturing
    
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;

    console.log = (...args: any[]) => {
      consoleLogStore.addLog('LOG', ...args);
      originalConsoleLog?.apply(console, args);
    };

    console.error = (...args: any[]) => {
      consoleLogStore.addLog('ERROR', ...args);
      originalConsoleError?.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      consoleLogStore.addLog('WARN', ...args);
      originalConsoleWarn?.apply(console, args);
    };
  }

  function stopConsoleCapture() {
    if (!originalConsoleLog) return;
    
    if (originalConsoleLog) {
      console.log = originalConsoleLog;
      originalConsoleLog = null;
    }
    if (originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
    if (originalConsoleWarn) {
      console.warn = originalConsoleWarn;
      originalConsoleWarn = null;
    }
  }

  function clearConsoleLogs() {
    consoleLogStore.clearLogs();
  }

  async function copyLogs() {
    try {
      // Format logs as text
      const logText = filteredLogs.map(log => {
        const timestamp = formatTimestamp(log.timestamp);
        return `[${log.level}] ${timestamp}\n${log.message}`;
      }).join('\n\n');
      
      await navigator.clipboard.writeText(logText);
      copyButtonText = 'Copied!';
      setTimeout(() => {
        copyButtonText = 'Copy Logs';
      }, 2000);
    } catch (error) {
      console.error('Failed to copy logs:', error);
      copyButtonText = 'Copy Failed';
      setTimeout(() => {
        copyButtonText = 'Copy Logs';
      }, 2000);
    }
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  // Filtered logs based on search and level
  const filteredLogs = $derived.by(() => {
    try {
      // Ensure consoleLogs is an array
      if (!Array.isArray(consoleLogs)) {
        return [];
      }
      
      let logs = [...consoleLogs]; // Create a copy to avoid mutation issues
      
      // Filter by level
      if (consoleLogLevelFilter !== 'ALL') {
        logs = logs.filter(log => log && log.level === consoleLogLevelFilter);
      }
      
      // Filter by search query
      if (consoleSearchQuery.trim()) {
        const query = consoleSearchQuery.toLowerCase();
        logs = logs.filter(log => log && log.message && log.message.toLowerCase().includes(query));
      }
      
      return logs;
    } catch (error) {
      console.error('Error filtering logs:', error);
      return [];
    }
  });

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
    
    // Start capturing console logs
    startConsoleCapture();
    
    // Subscribe to console log store updates
    unsubscribeConsoleLogs = consoleLogStore.subscribe((logs) => {
      try {
        // Ensure logs is an array before assigning
        if (Array.isArray(logs)) {
          // Create a new array reference to trigger reactivity properly
          consoleLogs = [...logs];
        } else {
          consoleLogs = [];
        }
      } catch (error) {
        console.error('Error updating console logs:', error);
        consoleLogs = [];
      }
    });
    
    return () => {
      clearInterval(statusInterval);
      stopConsoleCapture();
      if (unsubscribeConsoleLogs) {
        unsubscribeConsoleLogs();
        unsubscribeConsoleLogs = null;
      }
    };
  });
  
  onDestroy(() => {
    if (unsubscribeConsoleLogs) {
      unsubscribeConsoleLogs();
    }
  });




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
        onclick={() => activeTab = 'bookmarks'}
        class="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
        style="border-color: {activeTab === 'bookmarks' ? 'var(--accent)' : 'transparent'}; color: {activeTab === 'bookmarks' ? 'var(--accent)' : 'var(--text-secondary)'};"
        onmouseenter={(e) => { if (activeTab !== 'bookmarks') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onmouseleave={(e) => { if (activeTab !== 'bookmarks') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        Bookmarks
      </button>
      <button
        onclick={() => activeTab = 'versions'}
        class="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
        style="border-color: {activeTab === 'versions' ? 'var(--accent)' : 'transparent'}; color: {activeTab === 'versions' ? 'var(--accent)' : 'var(--text-secondary)'};"
        onmouseenter={(e) => { if (activeTab !== 'versions') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onmouseleave={(e) => { if (activeTab !== 'versions') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        Versions
      </button>
      <button
        onclick={() => activeTab = 'console'}
        class="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
        style="border-color: {activeTab === 'console' ? 'var(--accent)' : 'transparent'}; color: {activeTab === 'console' ? 'var(--accent)' : 'var(--text-secondary)'};"
        onmouseenter={(e) => { if (activeTab !== 'console') { e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onmouseleave={(e) => { if (activeTab !== 'console') { e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        Console
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

    </div>
  {/if}

  <!-- Bookmarks Tab -->
  {#if activeTab === 'bookmarks'}
    <div class="border rounded-lg p-4 md:p-6 lg:p-8 min-h-[60vh] md:min-h-[70vh]" style="border-color: var(--border);">
      <h2 class="text-2xl font-semibold mb-6">Bookmarks & Reading Places</h2>
      <BookmarksPanel />
    </div>
  {/if}

  <!-- Versions Tab -->
  {#if activeTab === 'versions'}
    <div class="border rounded-lg p-4 md:p-6 lg:p-8 min-h-[60vh] md:min-h-[70vh]" style="border-color: var(--border);">
      <h2 class="text-2xl font-semibold mb-6">Version Information</h2>
      <div class="space-y-6">
        <div>
          <h3 class="text-lg font-medium mb-2">Version</h3>
          <div style="color: var(--text-primary);">WikiStr v{appVersion}</div>
          <div class="mt-1" style="color: var(--text-secondary);">from GitCitadel</div>
        </div>
        <div class="p-4 rounded-lg border" style="background-color: var(--bg-primary); border-color: var(--border);">
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

  <!-- Console Tab -->
  {#if activeTab === 'console'}
    <div class="border rounded-lg p-4 md:p-6 lg:p-8 min-h-[60vh] md:min-h-[70vh]" style="border-color: var(--border);">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold">Console Viewer</h2>
        <div class="flex gap-2">
          <button
            onclick={copyLogs}
            disabled={filteredLogs.length === 0}
            class="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copyButtonText}
          </button>
          <button
            onclick={clearConsoleLogs}
            class="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Clear Logs
          </button>
        </div>
      </div>
      
      <!-- Search and Filter Controls -->
      <div class="space-y-4 mb-4">
        <!-- Search Bar -->
        <div>
          <input
            type="text"
            bind:value={consoleSearchQuery}
            placeholder="Search logs..."
            class="w-full px-4 py-2 rounded-md border focus:outline-none focus:ring-2"
            style="background-color: var(--bg-primary); border-color: var(--border); color: var(--text-primary); --tw-ring-color: var(--accent);"
          />
        </div>
        
        <!-- Log Level Filter -->
        <div class="flex gap-2 flex-wrap">
          <button
            onclick={() => setLogLevelFilter('ALL')}
            class="px-3 py-1.5 text-sm rounded-md border transition-colors"
            style="background-color: {consoleLogLevelFilter === 'ALL' ? 'var(--accent)' : 'var(--bg-primary)'}; border-color: var(--border); color: {consoleLogLevelFilter === 'ALL' ? 'white' : 'var(--text-primary)'};"
          >
            All ({consoleLogs.length})
          </button>
          <button
            onclick={() => setLogLevelFilter('LOG')}
            class="px-3 py-1.5 text-sm rounded-md border transition-colors"
            style="background-color: {consoleLogLevelFilter === 'LOG' ? 'var(--accent)' : 'var(--bg-primary)'}; border-color: var(--border); color: {consoleLogLevelFilter === 'LOG' ? 'white' : 'var(--text-primary)'};"
          >
            Log ({consoleLogs.filter(l => l && l.level === 'LOG').length})
          </button>
          <button
            onclick={() => setLogLevelFilter('WARN')}
            class="px-3 py-1.5 text-sm rounded-md border transition-colors"
            style="background-color: {consoleLogLevelFilter === 'WARN' ? 'var(--accent)' : 'var(--bg-primary)'}; border-color: var(--border); color: {consoleLogLevelFilter === 'WARN' ? 'white' : 'var(--text-primary)'};"
          >
            Warn ({consoleLogs.filter(l => l && l.level === 'WARN').length})
          </button>
          <button
            onclick={() => setLogLevelFilter('ERROR')}
            class="px-3 py-1.5 text-sm rounded-md border transition-colors"
            style="background-color: {consoleLogLevelFilter === 'ERROR' ? 'var(--accent)' : 'var(--bg-primary)'}; border-color: var(--border); color: {consoleLogLevelFilter === 'ERROR' ? 'white' : 'var(--text-primary)'};"
          >
            Error ({consoleLogs.filter(l => l && l.level === 'ERROR').length})
          </button>
        </div>
      </div>
      
      <!-- Logs Display -->
      <div class="border rounded-md overflow-hidden" style="border-color: var(--border); background-color: var(--bg-primary);">
        <div class="max-h-[60vh] overflow-y-auto p-4 font-mono text-xs" style="background-color: var(--bg-secondary);">
          {#if filteredLogs.length > 0}
            {#each filteredLogs as log, index (log.timestamp + '-' + index)}
              {#if log}
                <div class="mb-2 pb-2 border-b last:border-b-0" style="border-color: var(--border);">
                  <div class="flex items-start gap-2">
                    <span
                      class="px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
                      style="background-color: {
                        log.level === 'ERROR' ? '#ef4444' :
                        log.level === 'WARN' ? '#f59e0b' :
                        '#3b82f6'
                      }; color: white;"
                    >
                      {log.level || 'LOG'}
                    </span>
                    <span class="text-xs opacity-70" style="color: var(--text-secondary);">
                      {log.timestamp ? formatTimestamp(log.timestamp) : ''}
                    </span>
                  </div>
                  <div class="mt-1 break-words whitespace-pre-wrap" style="color: var(--text-primary);">
                    {@html (log.message || '').replace(/\n/g, '<br>')}
                  </div>
                </div>
              {/if}
            {/each}
          {:else}
            <div class="text-center py-8" style="color: var(--text-secondary);">
              {#if consoleSearchQuery.trim() || consoleLogLevelFilter !== 'ALL'}
                No logs match your filters
              {:else}
                No logs captured yet. Console logs will appear here as they occur.
              {/if}
            </div>
          {/if}
        </div>
      </div>
      
      <div class="mt-4 text-xs" style="color: var(--text-secondary);">
        Showing {filteredLogs.length} of {consoleLogs.length} logs
        {#if consoleLogs.length >= 1000}
          <span class="text-orange-500">(limited to 1000 most recent)</span>
        {/if}
      </div>
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
