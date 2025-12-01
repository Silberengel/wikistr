<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { 
    getBookmarks, 
    removeBookmark, 
    getReadingPlaces, 
    removeReadingPlace 
  } from '$lib/bookmarks';
  import { openOrCreateArticleCard } from '$lib/articleLauncher';
  import { formatRelativeTime } from '$lib/utils';
  import { getTagOr } from '$lib/utils';
  import type { ArticleCard } from '$lib/types';
  import { next } from '$lib/utils';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';

  let activeTab = $state<'bookmarks' | 'last-viewed'>('bookmarks');
  let bookmarks = $state<NostrEvent[]>([]);
  let readingPlaces = $state<Array<{ eventId: string; timestamp: number; parentEventId?: string }>>([]);
  let readingPlaceEvents = $state<Map<string, NostrEvent>>(new Map());
  let selectedItems = $state<Set<string>>(new Set());
  let isLoading = $state(false);

  onMount(() => {
    loadData();
  });

  async function loadData() {
    isLoading = true;
    try {
      if (activeTab === 'bookmarks') {
        bookmarks = await getBookmarks();
      } else {
        readingPlaces = await getReadingPlaces();
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    loadData();
  });

  function toggleSelection(id: string) {
    if (selectedItems.has(id)) {
      selectedItems.delete(id);
    } else {
      selectedItems.add(id);
    }
    selectedItems = new Set(selectedItems); // Trigger reactivity
  }

  async function deleteSelected() {
    if (selectedItems.size === 0) return;
    
    isLoading = true;
    try {
      if (activeTab === 'bookmarks') {
        // Delete bookmarks
        for (const eventId of selectedItems) {
          const event = bookmarks.find(b => b.id === eventId);
          if (event) {
            await removeBookmark(event);
          }
        }
      } else {
        // Delete reading places
        for (const eventId of selectedItems) {
          await removeReadingPlace(eventId);
        }
      }
      
      selectedItems = new Set();
      await loadData();
    } catch (error) {
      console.error('Failed to delete items:', error);
      alert('Failed to delete items. Please try again.');
    } finally {
      isLoading = false;
    }
  }

  async function openEvent(eventId: string, parentEventId?: string) {
    try {
      // If there's a parent event ID (30040 book), open that instead and scroll to the chapter
      if (parentEventId) {
        const parentResult = await relayService.queryEvents(
          $account?.pubkey || 'anonymous',
          'wiki-read',
          [{ ids: [parentEventId], limit: 1 }],
          { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
        );
        
        if (parentResult.events.length > 0) {
          const parentEvent = parentResult.events[0];
          const parentDTag = getTagOr(parentEvent, 'd') || parentEvent.id;
          const articleCard: Omit<ArticleCard, 'id'> = {
            type: 'article',
            data: [parentDTag, parentEvent.pubkey],
            relayHints: parentResult.relays,
            actualEvent: parentEvent
          };
          openOrCreateArticleCard(articleCard);
          
          // Scroll to the chapter after a delay to allow the book to render
          setTimeout(() => {
            const chapterHeading = document.querySelector(`h2[data-nested-event-id="${eventId}"]`);
            if (chapterHeading) {
              chapterHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
              // Highlight the heading briefly
              (chapterHeading as HTMLElement).style.transition = 'background-color 0.3s';
              (chapterHeading as HTMLElement).style.backgroundColor = 'var(--accent)';
              setTimeout(() => {
                (chapterHeading as HTMLElement).style.backgroundColor = '';
              }, 2000);
            }
          }, 1000);
          return;
        }
      }
      
      // Otherwise, open the event directly
      const result = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'wiki-read',
        [{ ids: [eventId], limit: 1 }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      if (result.events.length > 0) {
        const foundEvent = result.events[0];
        const dTag = getTagOr(foundEvent, 'd') || foundEvent.id;
        const articleCard: Omit<ArticleCard, 'id'> = {
          type: 'article',
          data: [dTag, foundEvent.pubkey],
          relayHints: result.relays,
          actualEvent: foundEvent
        };
        openOrCreateArticleCard(articleCard);
      }
    } catch (error) {
      console.error('Failed to open event:', error);
    }
  }

  function getEventTitle(event: NostrEvent): string {
    return event.tags.find(([k]) => k === 'title')?.[1] || getTagOr(event, 'd') || 'Untitled';
  }

  async function loadReadingPlaceEvents() {
    if (activeTab !== 'last-viewed') return;
    
    try {
      const eventIds = readingPlaces.map(p => p.eventId);
      if (eventIds.length === 0) return;
      
      const result = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'wiki-read',
        [{ ids: eventIds, limit: eventIds.length }],
        { excludeUserContent: false, currentUserPubkey: $account?.pubkey }
      );
      
      const eventMap = new Map<string, NostrEvent>();
      for (const event of result.events) {
        eventMap.set(event.id, event);
      }
      readingPlaceEvents = eventMap;
    } catch (error) {
      console.error('Failed to load reading place events:', error);
    }
  }

  $effect(() => {
    if (activeTab === 'last-viewed' && readingPlaces.length > 0) {
      loadReadingPlaceEvents();
    }
  });
</script>

<div class="mt-4 border-t pt-4" style="border-color: var(--border);">
  <div class="flex items-center justify-between mb-4">
    <div class="flex gap-2">
      <button
        onclick={() => { activeTab = 'bookmarks'; }}
        class="px-4 py-2 rounded transition-colors"
        style="
          background-color: {activeTab === 'bookmarks' ? 'var(--accent)' : 'transparent'};
          color: {activeTab === 'bookmarks' ? 'white' : 'var(--text-primary)'};
          border: 1px solid var(--border);
        "
      >
        Bookmarks
      </button>
      <button
        onclick={() => { activeTab = 'last-viewed'; }}
        class="px-4 py-2 rounded transition-colors"
        style="
          background-color: {activeTab === 'last-viewed' ? 'var(--accent)' : 'transparent'};
          color: {activeTab === 'last-viewed' ? 'white' : 'var(--text-primary)'};
          border: 1px solid var(--border);
        "
      >
        Last Viewed
      </button>
    </div>
    
    {#if selectedItems.size > 0}
      <button
        onclick={deleteSelected}
        disabled={isLoading}
        class="px-4 py-2 rounded transition-colors disabled:opacity-50"
        style="
          background-color: var(--accent);
          color: white;
        "
      >
        Delete ({selectedItems.size})
      </button>
    {/if}
  </div>

  {#if isLoading && (activeTab === 'bookmarks' ? bookmarks.length === 0 : readingPlaces.length === 0)}
    <div class="text-center py-8" style="color: var(--text-secondary);">
      Loading...
    </div>
  {:else if activeTab === 'bookmarks'}
    {#if bookmarks.length === 0}
      <div class="text-center py-8" style="color: var(--text-secondary);">
        No bookmarks yet
      </div>
    {:else}
      <div class="space-y-2">
        {#each bookmarks as bookmark (bookmark.id)}
          <div 
            class="flex items-center gap-2 p-3 rounded transition-colors cursor-pointer"
            style="
              background-color: transparent;
            "
            onmouseenter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            role="button"
            tabindex="0"
            onclick={() => openEvent(bookmark.id)}
            onkeydown={(e) => e.key === 'Enter' && openEvent(bookmark.id)}
          >
            <input
              type="checkbox"
              checked={selectedItems.has(bookmark.id)}
              onclick={(e) => { e.stopPropagation(); toggleSelection(bookmark.id); }}
              class="cursor-pointer"
            />
            <div class="flex-1">
              <div class="font-semibold" style="color: var(--text-primary);">
                {getEventTitle(bookmark)}
              </div>
              <div class="text-xs" style="color: var(--text-secondary);">
                {formatRelativeTime(bookmark.created_at || 0)}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    {#if readingPlaces.length === 0}
      <div class="text-center py-8" style="color: var(--text-secondary);">
        No reading places yet
      </div>
    {:else}
      <div class="space-y-2">
        {#each readingPlaces as place (place.eventId)}
          {@const event = readingPlaceEvents.get(place.eventId)}
          <div 
            class="flex items-center gap-2 p-3 rounded transition-colors cursor-pointer"
            style="
              background-color: transparent;
            "
            onmouseenter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            role="button"
            tabindex="0"
            onclick={() => openEvent(place.eventId, place.parentEventId)}
            onkeydown={(e) => e.key === 'Enter' && openEvent(place.eventId, place.parentEventId)}
          >
            <input
              type="checkbox"
              checked={selectedItems.has(place.eventId)}
              onclick={(e) => { e.stopPropagation(); toggleSelection(place.eventId); }}
              class="cursor-pointer"
            />
            <div class="flex-1">
              <div class="font-semibold" style="color: var(--text-primary);">
                {event ? getEventTitle(event) : `Event ${place.eventId.slice(0, 8)}...`}
              </div>
              <div class="text-xs" style="color: var(--text-secondary);">
                {new Date(place.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

