<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchOGMetadata, type OGMetadata } from '$lib/ogUtils';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();
  
  let ogData = $state<OGMetadata | null>(null);
  let loading = $state(true);
  let error = $state(false);

  onMount(async () => {
    try {
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
  <div class="rounded-lg border overflow-hidden" style="background-color: var(--bg-secondary); border-color: var(--border);">
    <div class="h-48" style="background-color: var(--bg-tertiary);"></div>
    <div class="p-4">
      <div class="h-5 rounded mb-2" style="background-color: var(--bg-tertiary); width: 70%;"></div>
      <div class="h-4 rounded mb-2" style="background-color: var(--bg-tertiary); width: 90%;"></div>
      <div class="h-4 rounded" style="background-color: var(--bg-tertiary); width: 60%;"></div>
    </div>
  </div>
{:else if ogData && !error}
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="block rounded-lg border overflow-hidden transition-all hover:opacity-90 hover:shadow-lg"
    style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
  >
    {#if ogData.image}
      <div class="w-full h-48 overflow-hidden" style="background-color: var(--bg-tertiary);">
        <img
          src={ogData.image}
          alt={ogData.title || 'Preview'}
          class="w-full h-full object-cover"
          onerror={(e) => {
            const target = e.target as HTMLImageElement;
            if (target) {
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent) parent.style.display = 'none';
            }
          }}
        />
      </div>
    {/if}
    <div class="p-4">
      <div class="font-semibold text-lg mb-2" style="color: var(--text-primary);">
        {ogData.title}
      </div>
      {#if ogData.description}
        <div class="text-sm mb-2 line-clamp-3" style="color: var(--text-secondary);">
          {ogData.description}
        </div>
      {/if}
      {#if ogData.siteName}
        <div class="text-xs" style="color: var(--text-secondary);">
          {ogData.siteName}
        </div>
      {/if}
    </div>
  </a>
{:else}
  <!-- Will be handled by LinkFallback component -->
{/if}

