<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchOGMetadata, type OGMetadata, extractNostrIdentifier } from '$lib/ogUtils';
  import LinkFallback from './LinkFallback.svelte';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();
  
  let ogData = $state<OGMetadata | null>(null);
  let loading = $state(true);
  let error = $state(false);
  let hasNostrId = $state(false);

  onMount(async () => {
    try {
      // First check if URL contains a Nostr identifier - if so, use LinkFallback instead
      const nostrId = extractNostrIdentifier(url);
      if (nostrId) {
        hasNostrId = true;
        loading = false;
        return;
      }
      
      const data = await fetchOGMetadata(url);
      ogData = data;
      error = !data;
    } catch (e) {
      console.error('Failed to fetch OG data:', e);
      error = true;
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="flex items-center space-x-3 p-3 rounded border" style="background-color: var(--bg-secondary); border-color: var(--border);">
    <div class="w-16 h-16 rounded flex-shrink-0" style="background-color: var(--bg-tertiary);"></div>
    <div class="flex-1 min-w-0">
      <div class="h-4 rounded mb-2" style="background-color: var(--bg-tertiary); width: 60%;"></div>
      <div class="h-3 rounded" style="background-color: var(--bg-tertiary); width: 80%;"></div>
    </div>
  </div>
{:else if ogData && !error}
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center space-x-3 p-3 rounded border transition-colors hover:opacity-80"
    style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
  >
    {#if ogData.image}
      <img
        src={ogData.image}
        alt={ogData.title || 'Preview'}
        class="w-16 h-16 rounded object-cover flex-shrink-0"
        style="min-width: 64px;"
        onerror={(e) => {
          const target = e.target as HTMLImageElement;
          if (target) target.style.display = 'none';
        }}
      />
    {/if}
    <div class="flex-1 min-w-0">
      <div class="font-semibold text-sm mb-1 truncate" style="color: var(--text-primary);">
        {ogData.title}
      </div>
      {#if ogData.description}
        <div class="text-xs line-clamp-2" style="color: var(--text-secondary);">
          {ogData.description}
        </div>
      {/if}
      {#if ogData.siteName}
        <div class="text-xs mt-1" style="color: var(--text-secondary);">
          {ogData.siteName}
        </div>
      {/if}
      {#if ogData.url && !ogData.urlFromOG}
        <div class="text-xs truncate mt-1 pt-1 border-t" style="color: var(--text-secondary); border-color: var(--border);">
          {ogData.url}
        </div>
      {/if}
    </div>
  </a>
{:else if hasNostrId}
  <!-- Use LinkFallback for Nostr identifiers -->
  <LinkFallback url={url} />
{:else}
  <!-- Fallback: just show the URL as a link -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="block p-3 rounded border transition-colors hover:opacity-80"
    style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--accent); text-decoration: none;"
  >
    {url}
  </a>
{/if}

