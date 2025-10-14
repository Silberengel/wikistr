<script lang="ts">
  import { onMount } from 'svelte';
  import type { Card } from '$lib/types';
  import { parseDiffQuery, isDiffQuery, diffText, generateDiffTitle } from '$lib/diff';
  import { parseBookWikilink, generateBookSearchQuery } from '$lib/books';
  import DiffView from '$components/DiffView.svelte';
  import type { DiffResult } from '$lib/diff';

  interface Props {
    card: Card;
  }

  let { card }: Props = $props();
  const diffCard = card as any; // We'll create a proper DiffCard type later

  let query = $state<string>('');
  let diffResult = $state<DiffResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    query = diffCard.data;
    performDiff();
  });

  async function performDiff() {
    if (!isDiffQuery(query)) {
      error = 'Invalid diff query format';
      return;
    }

    const parsed = parseDiffQuery(query);
    if (!parsed) {
      error = 'Could not parse diff query';
      return;
    }

    loading = true;
    error = null;

    try {
      // For now, we'll create a simple mock diff
      // In a real implementation, this would fetch actual content
      const mockDiffResult: DiffResult = {
        type: 'bible',
        left: {
          title: parsed.left,
          content: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
          version: 'KJV'
        },
        right: {
          title: parsed.right,
          content: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
          version: 'NIV'
        },
        changes: []
      };

      // Calculate actual differences
      mockDiffResult.changes = diffText(mockDiffResult.left.content, mockDiffResult.right.content);
      
      diffResult = mockDiffResult;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<div class="diff-card p-4">
  <div class="mb-4">
    <h2 class="text-xl font-bold text-gray-900 mb-2">📊 Diff View</h2>
    <p class="text-sm text-gray-600">Query: <code class="bg-gray-100 px-2 py-1 rounded">{query}</code></p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <span class="ml-2 text-gray-600">Loading diff...</span>
    </div>
  {:else if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4">
      <h3 class="text-red-800 font-medium">Error</h3>
      <p class="text-red-700 text-sm mt-1">{error}</p>
    </div>
  {:else if diffResult}
    <DiffView {diffResult} />
  {:else}
    <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <p class="text-gray-600">No diff data available</p>
    </div>
  {/if}
</div>
