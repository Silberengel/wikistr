<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchOGMetadata, type OGMetadata } from '$lib/ogUtils';
  import LinkFallback from './LinkFallback.svelte';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();
  
  let ogData = $state<OGMetadata | null>(null);
  let loading = $state(true);
  let showFallback = $state(false);

  onMount(async () => {
    try {
      const data = await fetchOGMetadata(url);
      if (data && data.title) {
        // Only use OG data if we got a valid title
        ogData = data;
        showFallback = false;
      } else {
        // No data returned (proxy down, etc.) - show fallback
        ogData = null;
        showFallback = true;
      }
    } catch (e) {
      // Proxy might be down - fail silently and show fallback
      ogData = null;
      showFallback = true;
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
{:else if ogData && !showFallback}
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
        <div class="text-xs mb-2" style="color: var(--text-secondary);">
          {ogData.siteName}
        </div>
      {/if}
      {#if ogData.url && !ogData.urlFromOG}
        <div class="text-xs truncate pt-2 border-t" style="color: var(--text-secondary); border-color: var(--border);">
          {ogData.url}
        </div>
      {/if}
    </div>
  </a>
{:else}
  <!-- Show fallback when OG fetch fails (proxy down, etc.) -->
  <LinkFallback url={url} />
{/if}

