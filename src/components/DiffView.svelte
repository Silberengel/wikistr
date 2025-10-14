<script lang="ts">
  import type { DiffResult, DiffChange } from '$lib/diff';
  import { formatDiffChange } from '$lib/diff';

  interface Props {
    diffResult: DiffResult;
  }

  let { diffResult }: Props = $props();
</script>

<div class="diff-container bg-white border border-gray-200 rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="bg-gray-50 px-4 py-3 border-b border-gray-200">
    <h3 class="text-lg font-semibold text-gray-900">
      📊 {diffResult.left.title} vs {diffResult.right.title}
    </h3>
    {#if diffResult.left.version || diffResult.right.version}
      <p class="text-sm text-gray-600 mt-1">
        {diffResult.left.version || 'Unknown'} vs {diffResult.right.version || 'Unknown'}
      </p>
    {/if}
  </div>

  <!-- Content Comparison -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-0">
    <!-- Left Side -->
    <div class="border-r border-gray-200">
      <div class="bg-red-50 px-4 py-2 border-b border-gray-200">
        <h4 class="font-medium text-red-900">Left: {diffResult.left.title}</h4>
      </div>
      <div class="p-4">
        <pre class="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">{diffResult.left.content}</pre>
      </div>
    </div>

    <!-- Right Side -->
    <div>
      <div class="bg-green-50 px-4 py-2 border-b border-gray-200">
        <h4 class="font-medium text-green-900">Right: {diffResult.right.title}</h4>
      </div>
      <div class="p-4">
        <pre class="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">{diffResult.right.content}</pre>
      </div>
    </div>
  </div>

  <!-- Changes Summary -->
  {#if diffResult.changes.length > 0}
    <div class="border-t border-gray-200 bg-gray-50">
      <div class="px-4 py-3">
        <h4 class="font-medium text-gray-900 mb-2">Changes ({diffResult.changes.length})</h4>
        <div class="space-y-1 max-h-40 overflow-y-auto">
          {#each diffResult.changes as change}
            <div class="text-xs font-mono px-2 py-1 rounded
              {change.type === 'added' ? 'bg-green-100 text-green-800' : ''}
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
    <div class="border-t border-gray-200 bg-gray-50 px-4 py-3">
      <p class="text-sm text-gray-600">✅ No differences found - content is identical</p>
    </div>
  {/if}
</div>
