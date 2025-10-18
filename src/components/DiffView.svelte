<script lang="ts">
  import type { DiffResult, DiffChange } from '$lib/diff';
  import { formatDiffChange } from '$lib/diff';
  import { getThemeConfig } from '$lib/themes';
  import UserBadge from './UserBadge.svelte';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    diffResult: DiffResult;
    expanded?: boolean;
  }

  let { diffResult, expanded = false }: Props = $props();
  
  // Word wrap state
  let wordWrap = $state(false);
  
  // Function to highlight differences in content
  function highlightDifferences(content: string, changes: DiffChange[], isLeft: boolean = true): string {
    let highlightedContent = content;
    
    // Filter changes relevant to this side
    const relevantChanges = changes.filter(change => {
      if (isLeft) {
        return change.type === 'removed' || change.type === 'modified';
      } else {
        return change.type === 'added' || change.type === 'modified';
      }
    });
    
    // Sort changes by line number (descending) to avoid offset issues
    const sortedChanges = [...relevantChanges].sort((a, b) => (b.leftLine || b.rightLine || 0) - (a.leftLine || a.rightLine || 0));
    
    for (const change of sortedChanges) {
      if (change.type === 'modified') {
        const textToHighlight = isLeft ? change.leftText : change.rightText;
        if (textToHighlight) {
          const highlighted = `<span style="background-color: ${theme.accentColor}30; color: var(--theme-text); padding: 1px 2px; border-radius: 2px; border-left: 3px solid ${theme.accentColor};">${textToHighlight}</span>`;
          highlightedContent = highlightedContent.replace(textToHighlight, highlighted);
        }
      } else if (change.type === 'added' && !isLeft && change.rightText) {
        // For added lines on right side, highlight in green
        const addedHighlighted = `<span style="background-color: #dcfce7; color: #166534; padding: 1px 2px; border-radius: 2px; border-left: 3px solid #22c55e;">+ ${change.rightText}</span>`;
        highlightedContent = highlightedContent.replace(change.rightText, addedHighlighted);
      } else if (change.type === 'removed' && isLeft && change.leftText) {
        // For removed lines on left side, highlight in red
        const removedHighlighted = `<span style="background-color: #fef2f2; color: #dc2626; padding: 1px 2px; border-radius: 2px; border-left: 3px solid #ef4444;">- ${change.leftText}</span>`;
        highlightedContent = highlightedContent.replace(change.leftText, removedHighlighted);
      }
    }
    
    return highlightedContent;
  }
</script>

<div class="diff-container border rounded-lg overflow-hidden w-full" 
     style="background-color: var(--theme-bg); border-color: var(--theme-border); width: 100%; min-width: 100%;">

  <!-- Header with Word Wrap Toggle -->
  <div class="px-4 py-2 border-b flex justify-between items-center" style="background-color: var(--theme-bg-secondary); border-color: var(--theme-border);">
    <h3 class="text-lg font-semibold" style="color: {theme.accentColor};">
      Diff View
    </h3>
    <button
      onclick={() => { wordWrap = !wordWrap; }}
      class="px-3 py-1 rounded text-sm transition-colors"
      style="background-color: {wordWrap ? theme.accentColor : 'var(--theme-bg)'}; color: {wordWrap ? 'white' : 'var(--theme-text)'}; border: 1px solid {theme.accentColor};"
      title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
    >
      {wordWrap ? '📄 Wrap' : '📄 No Wrap'}
    </button>
  </div>

  <!-- Content Comparison -->
  <div class="flex w-full" style="width: 100%; min-width: 100%;">
    <!-- Left Side -->
    <div class="flex-1 border-r" style="border-color: var(--theme-border); width: 50%; min-width: 0; max-width: 50%;">
      <div class="px-4 py-2 border-b" style="background-color: var(--theme-bg-secondary); border-color: var(--theme-border);">
        {#if expanded}
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium" style="color: var(--theme-text);">{diffResult.left.title}</span>
            <span class="text-sm" style="color: var(--theme-text-secondary);">by</span>
            {#if diffResult.left.pubkey}
              <UserBadge pubkey={diffResult.left.pubkey} size="small" hideSearchIcon={true} />
            {/if}
          </div>
        {:else}
          <div class="flex flex-col">
            <h4 class="font-medium" style="color: var(--theme-text);">{diffResult.left.title}</h4>
            <div class="flex items-center gap-2 mt-1">
              <span style="color: var(--theme-text-secondary);">by</span>
              {#if diffResult.left.pubkey}
                <UserBadge pubkey={diffResult.left.pubkey} size="small" hideSearchIcon={true} />
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div style="background-color: var(--theme-bg); width: 100%;">
        <pre class="text-xs font-mono leading-relaxed p-2 border w-full {wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} {wordWrap ? 'overflow-x-hidden' : 'overflow-x-auto'}" 
             style="color: var(--theme-text); background-color: var(--theme-bg-secondary); border-color: var(--theme-border); font-family: {theme.typography.fontFamilyMono}; width: 100%; margin: 0; padding: 8px; {wordWrap ? 'word-break: break-all !important; overflow-wrap: anywhere !important; white-space: pre-wrap !important; max-width: 100% !important;' : ''}">
          {@html highlightDifferences(diffResult.left.content, diffResult.changes, true)}
        </pre>
      </div>
    </div>

    <!-- Right Side -->
    <div class="flex-1" style="width: 50%; min-width: 0; max-width: 50%;">
      <div class="px-4 py-2 border-b" style="background-color: var(--theme-bg-secondary); border-color: var(--theme-border);">
        {#if expanded}
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium" style="color: var(--theme-text);">{diffResult.right.title}</span>
            <span class="text-sm" style="color: var(--theme-text-secondary);">by</span>
            {#if diffResult.right.pubkey}
              <UserBadge pubkey={diffResult.right.pubkey} size="small" hideSearchIcon={true} />
            {/if}
          </div>
        {:else}
          <div class="flex flex-col">
            <h4 class="font-medium" style="color: var(--theme-text);">{diffResult.right.title}</h4>
            <div class="flex items-center gap-2 mt-1">
              <span style="color: var(--theme-text-secondary);">by</span>
              {#if diffResult.right.pubkey}
                <UserBadge pubkey={diffResult.right.pubkey} size="small" hideSearchIcon={true} />
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div style="background-color: var(--theme-bg); width: 100%;">
        <pre class="text-xs font-mono leading-relaxed p-2 border w-full {wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} {wordWrap ? 'overflow-x-hidden' : 'overflow-x-auto'}" 
             style="color: var(--theme-text); background-color: var(--theme-bg-secondary); border-color: var(--theme-border); font-family: {theme.typography.fontFamilyMono}; width: 100%; margin: 0; padding: 8px; {wordWrap ? 'word-break: break-all !important; overflow-wrap: anywhere !important; white-space: pre-wrap !important; max-width: 100% !important;' : ''}">
          {@html highlightDifferences(diffResult.right.content, diffResult.changes, false)}
        </pre>
      </div>
    </div>
  </div>

  <!-- Changes Summary -->
  {#if diffResult.changes.length > 0}
    <div class="border-t" style="border-color: var(--theme-border); background-color: var(--theme-bg-secondary);">
      <div class="px-4 py-3">
        <h4 class="font-medium mb-2" style="color: var(--theme-text);">Changes ({diffResult.changes.length})</h4>
        <div class="space-y-1 max-h-40 overflow-y-auto">
          {#each diffResult.changes as change}
            <div class="text-xs font-mono px-2 py-1 rounded border"
              style="font-family: {theme.typography.fontFamilyMono}; 
                     {change.type === 'added' ? `background-color: ${theme.accentColor}20; color: ${theme.accentColor}; border-color: ${theme.accentColor}40;` : ''}
                     {change.type === 'removed' ? 'background-color: #fef2f2; color: #dc2626; border-color: #fecaca;' : ''}
                     {change.type === 'modified' ? 'background-color: #fffbeb; color: #d97706; border-color: #fed7aa;' : ''}
              ">
              {formatDiffChange(change)}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="border-t px-4 py-3" style="border-color: var(--theme-border); background-color: var(--theme-bg-secondary);">
      <p class="text-sm" style="color: var(--theme-text-secondary);">✅ No differences found - content is identical</p>
    </div>
  {/if}
</div>
