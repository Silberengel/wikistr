<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { getAllCachedEvents, queryCacheRelay } from '$lib/cacheRelay';
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

  const kindOptions = [
    { value: 'all', label: 'All Kinds' },
    { value: '30023', label: '30023 - Long-form' },
    { value: '30040', label: '30040 - Book Index' },
    { value: '30041', label: '30041 - Book Content' },
    { value: '30817', label: '30817 - Markdown Article' },
    { value: '30818', label: '30818 - AsciiDoc Article' },
    { value: '10003', label: '10003 - Bookmarks' },
    { value: '10432', label: '10432 - Cache Relay' }
  ];

  onMount(async () => {
    await loadEvents();
  });

  async function loadEvents() {
    isLoading = true;
    try {
      const all = await getAllCachedEvents();
      cachedEvents = all;
    } catch (error) {
      console.error('Failed to load cached events:', error);
    } finally {
      isLoading = false;
    }
  }

  async function search() {
    isLoading = true;
    try {
      const filters: any[] = [];
      
      if (selectedKind !== 'all') {
        filters.push({ kinds: [parseInt(selectedKind)] });
      }
      
      if (searchQuery.trim()) {
        // Try to parse as event ID
        if (searchQuery.length === 64 && /^[0-9a-f]+$/i.test(searchQuery)) {
          filters.push({ ids: [searchQuery] });
        } else {
          // Search in content and tags
          const all = await getAllCachedEvents();
          cachedEvents = all.filter(e => {
            const contentMatch = e.content.toLowerCase().includes(searchQuery.toLowerCase());
            const tagMatch = e.tags.some(t => t.some(v => v.toLowerCase().includes(searchQuery.toLowerCase())));
            return contentMatch || tagMatch;
          });
          return;
        }
      }
      
      if (filters.length > 0) {
        const results = await queryCacheRelay(filters);
        cachedEvents = results;
      } else {
        await loadEvents();
      }
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
      const idbkv = await import('idb-keyval');
      const store = idbkv.createStore('wikistr-cache-relay', 'events-store');
      const allEvents = await getAllCachedEvents();
      const filtered = allEvents.filter(e => e.id !== event.id);
      await idbkv.set('cache-relay:events', filtered, store);
      await loadEvents();
    } catch (error) {
      console.error('Failed to delete event from cache:', error);
      alert('Failed to delete event from cache');
    }
  }
</script>

<div class="cache-browser fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
      <h2 class="text-2xl font-bold">Cache Browser</h2>
      <button
        onclick={onClose}
        class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        ✕
      </button>
    </div>

    <!-- Search and Filters -->
    <div class="p-4 border-b border-gray-200 dark:border-gray-700 space-y-2">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search by ID, content, or tags..."
          class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
          onkeydown={(e) => e.key === 'Enter' && search()}
        />
        <select
          bind:value={selectedKind}
          class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
        >
          {#each kindOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <button
          onclick={search}
          class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          Search
        </button>
        <button
          onclick={loadEvents}
          class="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      {#if isLoading}
        <div class="text-center py-8">Loading...</div>
      {:else if cachedEvents.length === 0}
        <div class="text-center py-8 text-gray-500">No cached events found</div>
      {:else}
        <div class="space-y-2">
          {#each cachedEvents as event (event.id)}
            <div
              class="p-3 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              onclick={() => selectedEvent = selectedEvent?.id === event.id ? null : event}
            >
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <div class="font-semibold">{getEventTitle(event)}</div>
                  <div class="text-sm text-gray-500">
                    Kind {event.kind} • {new Date(event.created_at * 1000).toLocaleString()}
                  </div>
                </div>
                <button
                  onclick={(e) => { e.stopPropagation(); deleteEvent(event); }}
                  class="ml-2 text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
              {#if selectedEvent?.id === event.id}
                <div class="mt-3 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono overflow-auto max-h-96">
                  <pre>{formatEvent(event)}</pre>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500">
      Total: {cachedEvents.length} events
    </div>
  </div>
</div>

<style>
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

