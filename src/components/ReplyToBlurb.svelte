<script lang="ts">
  import UserBadge from './UserBadge.svelte';

  interface Props {
    pubkey: string;
    content: string;
    variant?: 'default' | 'compact' | 'inline' | 'deeply-nested';
  }

  let { pubkey, content, variant = 'default' }: Props = $props();
</script>

{#if variant === 'compact'}
  <!-- Compact variant for nested replies -->
  <div class="mb-1 text-xs px-3 py-0.5 rounded-full flex items-center gap-2" style="color: var(--text-muted); background-color: var(--bg-tertiary);">
    <span>reply to:</span>
    <UserBadge {pubkey} size="tiny" picOnly={true} />
    <span>{content.length > 150 ? content.substring(0, 150) + '...' : content}</span>
  </div>
{:else if variant === 'inline'}
  <!-- Inline variant for tight spacing -->
  <div class="mb-1 text-xs px-1 py-0 rounded-full flex items-center gap-1 leading-tight" style="color: var(--text-muted); background-color: var(--bg-tertiary);">
    <UserBadge {pubkey} size="tiny" picOnly={true} />
    <div class="flex-1 min-w-0">
      <span class="block">reply to: {content.length > 150 ? content.substring(0, 150) + '...' : content}</span>
    </div>
  </div>
{:else if variant === 'deeply-nested'}
  <!-- Deeply nested variant to show this is a deeply nested reply -->
  <div class="mb-1 text-xs px-3 py-1 rounded-full flex items-center gap-2 border" style="color: var(--text-muted); background-color: var(--bg-tertiary); border-color: var(--border);">
    <span class="text-xs">↳ deeply nested reply to:</span>
    <UserBadge {pubkey} size="tiny" picOnly={true} />
    <span>{content.length > 100 ? content.substring(0, 100) + '...' : content}</span>
  </div>
{:else}
  <!-- Default variant for reply forms -->
  <div class="mb-3 text-xs px-3 py-0.5 rounded-full flex items-center gap-2" style="color: var(--text-muted); background-color: var(--bg-tertiary);">
    <span>reply to:</span>
    <UserBadge {pubkey} size="tiny" picOnly={true} />
    <span>{content.length > 150 ? content.substring(0, 150) + '...' : content}</span>
  </div>
{/if}
