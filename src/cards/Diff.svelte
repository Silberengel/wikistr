<script lang="ts">
  import { onMount } from 'svelte';
  import type { Card } from '$lib/types';
  import { parseDiffQuery, isDiffQuery, diffText, generateDiffTitle } from '$lib/diff';
  import { parseBookWikilink, generateBookSearchQuery } from '$lib/books';
  import DiffView from '$components/DiffView.svelte';
  import type { DiffResult } from '$lib/diff';
  import { getThemeConfig } from '$lib/themes';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    card: Card;
    expanded?: boolean;
    toggleExpand?: () => void;
  }

  let { card, expanded = false, toggleExpand }: Props = $props();
  const diffCard = card as any; // We'll create a proper DiffCard type later

  let selectedEvents = $state<any[]>([]);
  let diffResult = $state<DiffResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  
  // Calculate selected count from actual events
  const selectedCount = $derived(selectedEvents.length);
  
  // Calculate expand width based on number of articles (limited to 2)
  function getExpandWidth() {
    const count = selectedEvents.length;
    if (count <= 2) return '1500px';
    return '1500px'; // Always 1500px for two-pane layout
  }

  // Helper function to get article title
  function getArticleTitle(event: any): string {
    return event.tags.find((t: any) => t[0] === 'title')?.[1] || 
           event.tags.find((t: any) => t[0] === 'd')?.[1] || 
           'Untitled';
  }

  onMount(() => {
    console.log('🔍 Diff component received with localStorage approach:', diffCard);
    console.log('🔍 data:', diffCard.data);
    
    // Try to retrieve selected events from localStorage
    const query = diffCard.data;
    const diffKey = `diff_${query}`;
    const storedEvents = localStorage.getItem(diffKey);
    
    if (storedEvents) {
      try {
        console.log('✅ Found stored events in localStorage');
        selectedEvents = JSON.parse(storedEvents);
        // Clean up the localStorage entry after use
        localStorage.removeItem(diffKey);
        performDiff();
      } catch (err) {
        console.error('❌ Failed to parse stored events:', err);
        error = 'Failed to load selected articles for comparison';
      }
    } else {
      console.log('❌ No stored events found in localStorage');
      // Fallback to old query-based format
      if (isDiffQuery(query)) {
        const parsed = parseDiffQuery(query);
        if (parsed) {
          // Handle old format - for now show error
          error = 'Legacy diff format not supported. Please select articles and use the diff button.';
        }
      } else {
        error = 'Invalid diff data format';
      }
    }
  });

  async function performDiff() {
    if (selectedEvents.length < 2) {
      error = 'Need at least 2 articles to compare';
      return;
    }

    loading = true;
    error = null;

    try {
      // For now, compare the first two selected events
      // TODO: In the future, we could implement multi-way diff comparison
      const leftEvent = selectedEvents[0];
      const rightEvent = selectedEvents[1];

      // Extract titles and content
      const leftTitle = getArticleTitle(leftEvent);
      const rightTitle = getArticleTitle(rightEvent);

      const result: DiffResult = {
        type: 'wiki',
        left: {
          title: leftTitle,
          content: leftEvent.content,
          pubkey: leftEvent.pubkey
        },
        right: {
          title: rightTitle,
          content: rightEvent.content,
          pubkey: rightEvent.pubkey
        },
        changes: []
      };

      // Calculate actual differences
      result.changes = diffText(result.left.content, result.right.content);
      
      diffResult = result;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<div class="diff-card w-full" 
     style="background-color: var(--theme-bg); color: var(--theme-text); transition: all 0.3s ease; width: 100%;">
  <div class="mb-4 flex justify-between items-center">
    <!-- Expand/Collapse Button -->
    {#if toggleExpand}
      <button
        onclick={toggleExpand}
        class="inline-flex items-center p-2 text-sm font-medium rounded-md transition-colors"
        style="color: {theme.accentColor}; background-color: var(--bg-primary); border: 1px solid {theme.accentColor};"
        onmouseover={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '0.8';
          }
        }}
        onmouseout={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '1';
          }
        }}
        onfocus={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '0.8';
          }
        }}
        onblur={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '1';
          }
        }}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {#if expanded}
          <!-- Collapse icon (compress) -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h6v6"/>
            <path d="M20 10h-6V4"/>
            <path d="M14 10l7-7"/>
            <path d="M3 21l7-7"/>
          </svg>
        {:else}
          <!-- Expand icon (maximize) -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>
            <path d="M21 8H8l5-5"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2" style="border-color: {theme.accentColor};"></div>
      <span class="ml-2" style="color: var(--theme-text-secondary);">Loading diff...</span>
    </div>
  {:else if error}
    <div class="rounded-lg p-4" style="background-color: #fef2f2; border: 1px solid #fecaca;">
      <h3 class="font-medium" style="color: #dc2626;">Error</h3>
      <p class="text-sm mt-1" style="color: #b91c1c;">{error}</p>
    </div>
  {:else if diffResult}
    <DiffView {diffResult} {expanded} />
  {:else}
    <div class="rounded-lg p-4" style="background-color: var(--theme-bg-secondary); border: 1px solid var(--theme-border);">
      <p style="color: var(--theme-text-secondary);">No diff data available</p>
    </div>
  {/if}
</div>
