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
  let isLoading = $state(false);
  let searchQuery = $state('');
  let selectedKind = $state<string>('all');
  let selectedEvent: NostrEvent | null = $state(null);
  let isClearing = $state(false);

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
    { value: '30078', label: '30078 - Book Config' },
    { value: '30817', label: '30817 - Markdown Article' },
    { value: '30818', label: '30818 - AsciiDoc Article' }
  ];

  // Metadata kinds category
  const metadataKinds = [0, 10002, 10003, 10133, 10432];

  onMount(async () => {
    await loadEvents();
  });

  async function loadEvents() {
    isLoading = true;
    try {
      // Get all cached events from all content types
      // Note: metadata contains kind 0, wiki contains 30817/30818/30023/30040, etc.
      const allCached = [
        ...contentCache.getEvents('wiki'),
        ...contentCache.getEvents('kind1111'),
        ...contentCache.getEvents('kind30041'),
        ...contentCache.getEvents('kind10002'),
        ...contentCache.getEvents('kind10432'),
        ...contentCache.getEvents('metadata'),
        ...contentCache.getEvents('bookConfigs')
      ];
      cachedEvents = allCached.map(cached => cached.event);
    } catch (error) {
      console.error('Failed to load cached events:', error);
    } finally {
      isLoading = false;
    }
  }

  async function search() {
    isLoading = true;
    try {
      // Get all cached events first
      const allCached = [
        ...contentCache.getEvents('wiki'),
        ...contentCache.getEvents('kind1111'),
        ...contentCache.getEvents('kind30041'),
        ...contentCache.getEvents('kind10002'),
        ...contentCache.getEvents('kind10432'),
        ...contentCache.getEvents('metadata'),
        ...contentCache.getEvents('bookConfigs')
      ];
      let all = allCached.map(cached => cached.event);
      
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

  async function deleteEvent(event: NostrEvent) {
    if (!confirm('Are you sure you want to delete this event from cache?')) {
      return;
    }
    try {
      // Find which content type this event belongs to and remove it
      type ContentType = 'wiki' | 'kind1111' | 
                         'kind30041' | 'kind10002' | 'kind10432' | 'metadata' | 'bookConfigs';
      const contentTypes: ContentType[] = [
        'wiki', 'kind1111', 'kind30041', 'kind10002', 'kind10432', 'metadata', 'bookConfigs'
      ];
      
      for (const contentType of contentTypes) {
        const cached = contentCache.getEvent(contentType, event.id);
        if (cached) {
          // Get all events for this content type
          const allCached = contentCache.getEvents(contentType);
          const filtered = allCached.filter(c => c.event.id !== event.id);
          
          // Rebuild the cache without this event
          // Note: This is a workaround since contentCache doesn't have a direct delete method
          // We'd need to clear and re-add, but for now just reload
          await loadEvents();
          return;
        }
      }
      
      await loadEvents();
    } catch (error) {
      console.error('Failed to delete event from cache:', error);
      alert('Failed to delete event from cache');
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
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search by ID, content, or tags..."
          class="flex-1 px-3 py-2 border rounded-md"
          style="background-color: var(--bg-secondary); color: var(--text-primary); border-color: var(--border);"
          onkeydown={(e) => e.key === 'Enter' && search()}
        />
        <select
          bind:value={selectedKind}
          class="px-3 py-2 border rounded-md"
          style="background-color: var(--bg-secondary); color: var(--text-primary); border-color: var(--border);"
        >
          {#each kindOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <button
          onclick={search}
          class="px-4 py-2 text-white rounded-md hover:opacity-90"
          style="background-color: var(--accent);"
        >
          Search
        </button>
        <button
          onclick={loadEvents}
          class="px-4 py-2 text-white rounded-md hover:opacity-90"
          style="background-color: var(--text-secondary);"
        >
          Refresh
        </button>
        <button
          onclick={clearAllCache}
          disabled={isClearing || cachedEvents.length === 0}
          class="px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style="background-color: #dc2626;"
          title={cachedEvents.length === 0 ? 'No events to clear' : 'Clear all cached events'}
        >
          {isClearing ? 'Clearing...' : 'Clear Cache'}
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      {#if isLoading}
        <div class="text-center py-8" style="color: var(--text-primary);">Loading...</div>
      {:else if cachedEvents.length === 0}
        <div class="text-center py-8" style="color: var(--text-secondary);">No cached events found</div>
      {:else}
        <div class="space-y-2">
          {#each cachedEvents as event (event.id)}
            <div
              class="cache-event-item p-3 border rounded-md cursor-pointer"
              style="background-color: var(--bg-secondary); border-color: var(--border);"
              onclick={() => selectedEvent = selectedEvent?.id === event.id ? null : event}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedEvent = selectedEvent?.id === event.id ? null : event; } }}
              role="button"
              tabindex="0"
            >
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <div class="font-semibold" style="color: var(--text-primary);">{getEventTitle(event)}</div>
                  <div class="text-sm" style="color: var(--text-secondary);">
                    Kind {event.kind} • {new Date(event.created_at * 1000).toLocaleString()}
                  </div>
                </div>
                <button
                  onclick={(e) => { e.stopPropagation(); deleteEvent(event); }}
                  class="ml-2 hover:opacity-80"
                  style="color: #dc2626;"
                >
                  Delete
                </button>
              </div>
              {#if selectedEvent?.id === event.id}
                <div class="mt-3 p-3 rounded text-xs font-mono overflow-auto max-h-96" style="background-color: var(--bg-tertiary); color: var(--text-primary);">
                  <pre style="color: var(--text-primary);">{formatEvent(event)}</pre>
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
    }
    .cache-browser > div {
      max-height: 80vh;
      border-radius: 1rem 1rem 0 0;
    }
  }
</style>

