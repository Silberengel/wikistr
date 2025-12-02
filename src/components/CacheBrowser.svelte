<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { contentCache } from '$lib/contentCache';
  import { getTagOr } from '$lib/utils';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let cachedEvents = $state<NostrEvent[]>([]);
  let tombstonedEventIds = $state<string[]>([]);
  let isLoading = $state(false);
  let searchQuery = $state('');
  let selectedKind = $state<string>('all');
  let selectedEvent: NostrEvent | null = $state(null);
  let isClearing = $state(false);
  let showTombstoned = $state(false);

  const kindOptions = [
    { value: 'all', label: 'All Kinds' },
    { value: 'metadata', label: 'Metadata (All)' },
    { value: '0', label: '  0 - Profile Metadata' },
    { value: '10002', label: '  10002 - Relay List' },
    { value: '10003', label: '  10003 - Bookmarks' },
    { value: '10133', label: '  10133 - Payment Metadata' },
    { value: '10432', label: '  10432 - Cache Relay' },
    { value: '1111', label: '1111 - Comments' },
    { value: '30023', label: '30023 - Long-form' },
    { value: '30040', label: '30040 - Book Index' },
    { value: '30041', label: '30041 - Book Content' },
    { value: '30817', label: '30817 - Markdown Article' },
    { value: '30818', label: '30818 - AsciiDoc Article' }
  ];

  // Metadata kinds category
  const metadataKinds = [0, 10002, 10003, 10133];

  onMount(() => {
    loadEvents();
    
    // Listen for cache updates and refresh
    const handleCacheUpdate = async () => {
      // Small delay to ensure IndexedDB persistence has completed
      await new Promise(resolve => setTimeout(resolve, 100));
      await loadEvents();
    };
    window.addEventListener('wikistr:cache-updated', handleCacheUpdate);
    
    return () => {
      window.removeEventListener('wikistr:cache-updated', handleCacheUpdate);
    };
  });

  async function loadEvents() {
    isLoading = true;
    try {
      // Ensure cache is fully initialized before reading
      await contentCache.ensureInitialized();
      
      // Get all cached events from all content types
      const allCached = [
        ...contentCache.getEvents('publications'), // 30040, 30041
        ...contentCache.getEvents('longform'),     // 30023
        ...contentCache.getEvents('wikis'),        // 30817, 30818
        ...contentCache.getEvents('kind1111'),
        ...contentCache.getEvents('kind10002'),
        ...contentCache.getEvents('kind10432'),
        ...contentCache.getEvents('profile')
      ];
      
      // Filter out tombstoned events
      const tombstonedCount = allCached.filter(cached => contentCache.isTombstoned(cached.event.id)).length;
      cachedEvents = allCached
        .filter(cached => {
          // Skip if tombstoned
          if (contentCache.isTombstoned(cached.event.id)) {
            return false;
          }
          return true;
        })
        .map(cached => cached.event);
        
      console.log(`[CacheBrowser] Loaded ${cachedEvents.length} events (filtered out ${tombstonedCount} tombstoned events)`);
      
      // Load tombstoned event IDs
      tombstonedEventIds = contentCache.getTombstonedEventIds();
    } catch (error) {
      console.error('Failed to load cached events:', error);
    } finally {
      isLoading = false;
    }
  }

  async function search() {
    isLoading = true;
    try {
      // Ensure cache is fully initialized before reading
      await contentCache.ensureInitialized();
      
      // Get all cached events first
      const allCached = [
        ...contentCache.getEvents('publications'), // 30040, 30041
        ...contentCache.getEvents('longform'),     // 30023
        ...contentCache.getEvents('wikis'),        // 30817, 30818
        ...contentCache.getEvents('kind1111'),
        ...contentCache.getEvents('kind10002'),
        ...contentCache.getEvents('kind10432'),
        ...contentCache.getEvents('profile')
      ];
      
      // Filter out tombstoned events
      let all = allCached
        .filter(cached => {
          // Skip if tombstoned
          if (contentCache.isTombstoned(cached.event.id)) {
            return false;
          }
          return true;
        })
        .map(cached => cached.event);
      
      // Filter by kind if selected
      if (selectedKind !== 'all') {
        if (selectedKind === 'metadata') {
          // Filter by metadata category (all metadata kinds)
          all = all.filter(e => metadataKinds.includes(e.kind));
        } else {
          // Filter by specific kind
          const kindNum = parseInt(selectedKind);
          all = all.filter(e => e.kind === kindNum);
      }
      }
      
      // Filter by search query if provided
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        all = all.filter(e => {
          // Try to match event ID
        if (searchQuery.length === 64 && /^[0-9a-f]+$/i.test(searchQuery)) {
            return e.id.toLowerCase().includes(query);
          }
          // Search in content and tags
          const contentMatch = e.content.toLowerCase().includes(query);
          const tagMatch = e.tags.some(t => t.some(v => String(v).toLowerCase().includes(query)));
            return contentMatch || tagMatch;
          });
      }
      
      cachedEvents = all;
    } catch (error) {
      console.error('Failed to search cache:', error);
    } finally {
      isLoading = false;
    }
  }

  function getEventTitle(event: NostrEvent): string {
    return getTagOr(event, 'title') || getTagOr(event, 'd') || event.id.slice(0, 16) + '...';
  }

  function formatEvent(event: NostrEvent): string {
    return JSON.stringify(event, null, 2);
  }

  async function tombstoneEvent(event: NostrEvent) {
    if (!confirm(`Are you sure you want to TOMBSTONE this event?\n\nThis will permanently delete it from cache and prevent it from being re-added, even if relays send it again.\n\nEvent: ${getEventTitle(event)}\nID: ${event.id.slice(0, 16)}...`)) {
      return;
    }
    try {
      await contentCache.tombstoneEvent(event.id);
      
      // Reload events to reflect the change
      await loadEvents();
      
      // Dispatch event to trigger feed refresh
      window.dispatchEvent(new CustomEvent('wikistr:cache-updated', { 
        detail: { deletedEventIds: [event.id] } 
      }));
      
      alert('Event has been tombstoned and will not reappear in cache.');
    } catch (error) {
      console.error('Failed to tombstone event:', error);
      alert('Failed to tombstone event');
    }
  }

  function isTombstoned(eventId: string): boolean {
    return contentCache.isTombstoned(eventId);
  }

  async function untombstoneEvent(eventId: string) {
    if (!confirm(`Are you sure you want to remove this event from the tombstone list?\n\nThis will allow the event to be cached again if relays send it.\n\nEvent ID: ${eventId.slice(0, 16)}...`)) {
      return;
    }
    try {
      await contentCache.untombstoneEvent(eventId);
      
      // Reload events and tombstone list to reflect the change
      await loadEvents();
      
      // Dispatch event to trigger feed refresh
      window.dispatchEvent(new CustomEvent('wikistr:cache-updated', { 
        detail: { deletedEventIds: [eventId] } 
      }));
    } catch (error) {
      console.error('Failed to untombstone event:', error);
      alert('Failed to remove event from tombstone list');
    }
  }

  async function clearAllCache() {
    const eventCount = cachedEvents.length;
    if (eventCount === 0) {
      return;
    }
    
    if (!confirm(`Are you sure you want to delete all ${eventCount} cached events? This action cannot be undone.`)) {
      return;
    }
    
    isClearing = true;
    try {
      await contentCache.clearAll();
      cachedEvents = [];
      selectedEvent = null;
      alert(`Successfully cleared ${eventCount} cached events.`);
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('Failed to clear cache. Please try again.');
    } finally {
      isClearing = false;
    }
  }
</script>

<div class="cache-browser fixed inset-0 z-50 flex items-center justify-center" style="background-color: rgba(0, 0, 0, 0.5);" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" tabindex="-1">
  <div class="rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col" style="background-color: var(--bg-primary);" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="0">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b" style="border-color: var(--border);">
      <h2 class="text-2xl font-bold" style="color: var(--text-primary);">Cache Browser</h2>
      <button
        onclick={onClose}
        class="hover:opacity-70"
        style="color: var(--text-secondary);"
      >
        ✕
      </button>
    </div>

    <!-- Search and Filters -->
    <div class="p-4 border-b space-y-2" style="border-color: var(--border);">
      <div class="flex flex-col md:flex-row gap-2">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search by ID, content, or tags..."
          class="flex-1 px-3 py-2 border rounded-md min-h-[44px]"
          style="background-color: var(--bg-secondary); color: var(--text-primary); border-color: var(--border);"
          onkeydown={(e) => e.key === 'Enter' && search()}
        />
        <select
          bind:value={selectedKind}
          class="px-3 py-2 border rounded-md min-h-[44px]"
          style="background-color: var(--bg-secondary); color: var(--text-primary); border-color: var(--border);"
        >
          {#each kindOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <div class="flex gap-2">
          <button
            onclick={search}
            class="px-4 py-2 text-white rounded-md hover:opacity-90 min-h-[44px] flex-1 md:flex-none"
            style="background-color: var(--accent);"
          >
            Search
          </button>
          <button
            onclick={loadEvents}
            class="px-4 py-2 text-white rounded-md hover:opacity-90 min-h-[44px] flex-1 md:flex-none"
            style="background-color: var(--text-secondary);"
          >
            Refresh
          </button>
          <button
            onclick={clearAllCache}
            disabled={isClearing || cachedEvents.length === 0}
            class="px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] flex-1 md:flex-none"
            style="background-color: #dc2626;"
            title={cachedEvents.length === 0 ? 'No events to clear' : 'Clear all cached events'}
          >
            {isClearing ? 'Clearing...' : 'Clear Cache'}
          </button>
          <button
            onclick={() => { showTombstoned = !showTombstoned; }}
            class="px-4 py-2 text-white rounded-md hover:opacity-90 min-h-[44px] flex-1 md:flex-none"
            style="background-color: #7c3aed;"
            title="View/manage tombstoned events"
          >
            {showTombstoned ? 'Hide' : 'Show'} Tombstoned ({tombstonedEventIds.length})
          </button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      {#if isLoading}
        <div class="text-center py-8" style="color: var(--text-primary);">Loading...</div>
      {:else if showTombstoned}
        <!-- Tombstoned Events Section -->
        <div class="space-y-2">
          <h3 class="text-lg font-semibold mb-4" style="color: var(--text-primary);">
            Tombstoned Events ({tombstonedEventIds.length})
          </h3>
          {#if tombstonedEventIds.length === 0}
            <div class="text-center py-8" style="color: var(--text-secondary);">No tombstoned events</div>
          {:else}
            {#each tombstonedEventIds as eventId (eventId)}
              <div
                class="cache-event-item p-3 border rounded-md min-h-[60px]"
                style="background-color: var(--bg-secondary); border-color: var(--border);"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="font-mono text-sm break-all" style="color: var(--text-primary);">
                      {eventId}
                    </div>
                    <div class="text-xs mt-1" style="color: var(--text-secondary);">
                      Tombstoned (permanently deleted from cache)
                    </div>
                  </div>
                  <button
                    onclick={() => untombstoneEvent(eventId)}
                    class="hover:opacity-80 min-h-[44px] px-3 py-2 rounded flex-shrink-0"
                    style="color: #10b981; background-color: rgba(16, 185, 129, 0.1);"
                    title="Remove from tombstone list (allow event to be cached again)"
                  >
                    ✓ Untombstone
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {:else if cachedEvents.length === 0}
        <div class="text-center py-8" style="color: var(--text-secondary);">No cached events found</div>
      {:else}
        <div class="space-y-2">
          {#each cachedEvents as event (event.id)}
            <div
              class="cache-event-item p-3 border rounded-md cursor-pointer min-h-[60px] touch-manipulation"
              style="background-color: var(--bg-secondary); border-color: var(--border);"
              onclick={() => selectedEvent = selectedEvent?.id === event.id ? null : event}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedEvent = selectedEvent?.id === event.id ? null : event; } }}
              role="button"
              tabindex="0"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="font-semibold break-words" style="color: var(--text-primary);">{getEventTitle(event)}</div>
                  <div class="text-sm break-words" style="color: var(--text-secondary);">
                    Kind {event.kind} • {new Date(event.created_at * 1000).toLocaleString()}
                  </div>
                </div>
                <div class="flex gap-2 flex-shrink-0">
                  {#if isTombstoned(event.id)}
                    <button
                      onclick={(e) => { e.stopPropagation(); untombstoneEvent(event.id); }}
                      class="hover:opacity-80 min-h-[44px] px-3 py-2 rounded"
                      style="color: #10b981; background-color: rgba(16, 185, 129, 0.1);"
                      title="Remove from tombstone list (allow event to be cached again)"
                    >
                      ✓ Untombstone
                    </button>
                  {:else}
                    <button
                      onclick={(e) => { e.stopPropagation(); tombstoneEvent(event); }}
                      class="hover:opacity-80 min-h-[44px] px-3 py-2 rounded"
                      style="color: #7c3aed;"
                      title="Tombstone event (permanent deletion, prevents reappearing)"
                    >
                      🗿 Tombstone
                    </button>
                  {/if}
                </div>
              </div>
              {#if selectedEvent?.id === event.id}
                <div class="mt-3 p-3 rounded text-xs font-mono overflow-x-auto max-h-96" style="background-color: #1e1e1e; color: #d4d4d4;">
                  <pre style="color: #d4d4d4; background-color: #1e1e1e; margin: 0; white-space: pre; word-wrap: normal; overflow-wrap: normal;">{formatEvent(event)}</pre>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t text-sm" style="border-color: var(--border); color: var(--text-secondary);">
      Total: {cachedEvents.length} events
    </div>
  </div>
</div>

<style>
  .cache-event-item:hover {
    background-color: var(--bg-tertiary) !important;
  }

  select option {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
  }

  @media (max-width: 768px) {
    .cache-browser {
      align-items: flex-end;
      padding: 0;
    }
    .cache-browser > div {
      max-height: 90vh;
      border-radius: 1rem 1rem 0 0;
      width: 100%;
      margin: 0;
    }
    .cache-event-item {
      min-height: 72px;
    }
  }
</style>


