<script lang="ts">
  import type { DiffResult, DiffChange } from '$lib/diff';
  import { formatDiffChange } from '$lib/diff';

  interface Props {
    diffResult: DiffResult;
  }

  let { diffResult }: Props = $props();
</script>

<div class="diff-container border rounded-lg overflow-hidden" style="background-color: var(--bg-primary); border-color: var(--border);">
  <!-- Header -->
  <div class="px-4 py-3 border-b" style="background-color: var(--bg-secondary); border-color: var(--border);">
    <h3 class="text-lg font-semibold" style="color: var(--text-primary);">
      📊 {diffResult.left.title} vs {diffResult.right.title}
    </h3>
    {#if diffResult.left.version || diffResult.right.version}
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        {diffResult.left.version || 'Unknown'} vs {diffResult.right.version || 'Unknown'}
      </p>
    {/if}
  </div>

  <!-- Content Comparison -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-0">
    <!-- Left Side -->
    <div class="border-r" style="border-color: var(--border);">
      <div class="px-4 py-2 border-b" style="background-color: var(--bg-secondary); border-color: var(--border);">
        <h4 class="font-medium" style="color: var(--text-primary);">Left: {diffResult.left.title}</h4>
      </div>
      <div class="p-4">
        <pre class="text-sm whitespace-pre-wrap font-mono leading-relaxed" style="color: var(--text-primary);">{diffResult.left.content}</pre>
      </div>
    </div>

    <!-- Right Side -->
    <div>
      <div class="px-4 py-2 border-b" style="background-color: var(--bg-secondary); border-color: var(--border);">
        <h4 class="font-medium" style="color: var(--text-primary);">Right: {diffResult.right.title}</h4>
      </div>
      <div class="p-4">
        <pre class="text-sm whitespace-pre-wrap font-mono leading-relaxed" style="color: var(--text-primary);">{diffResult.right.content}</pre>
      </div>
    </div>
  </div>

  <!-- Changes Summary -->
  {#if diffResult.changes.length > 0}
    <div class="border-t" style="border-color: var(--border); background-color: var(--bg-secondary);">
      <div class="px-4 py-3">
        <h4 class="font-medium mb-2" style="color: var(--text-primary);">Changes ({diffResult.changes.length})</h4>
        <div class="space-y-1 max-h-40 overflow-y-auto">
          {#each diffResult.changes as change}
            <div class="text-xs font-mono px-2 py-1 rounded
              {change.type === 'added' ? 'bg-brown-100 text-brown-800' : ''}
              {change.type === 'removed' ? 'bg-red-100 text-red-800' : ''}
              {change.type === 'modified' ? 'bg-yellow-100 text-yellow-800' : ''}
            ">
              {formatDiffChange(change)}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="border-t px-4 py-3" style="border-color: var(--border); background-color: var(--bg-secondary);">
      <p class="text-sm" style="color: var(--text-secondary);">✅ No differences found - content is identical</p>
    </div>
  {/if}
</div>
