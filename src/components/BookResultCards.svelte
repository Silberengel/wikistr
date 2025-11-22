<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import type { ParsedBookReference } from '$lib/bookWikilinkParser';
  import { formatSections } from '$lib/utils';

  interface Props {
    // Passages grouped by version
    passagesByVersion: Map<string | undefined, Array<{ 
      event: NostrEvent; 
      reference: ParsedBookReference; 
      sectionValue?: string; 
      version?: string 
    }>>;
    // Bible Gateway URL for the entire query
    bibleGatewayUrl: string | null;
    // Function to open an event
    openEvent: (event: NostrEvent, ev?: MouseEvent) => void;
  }

  let {
    passagesByVersion,
    bibleGatewayUrl,
    openEvent
  }: Props = $props();
</script>

<div 
  class="book-passage-group" 
  style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding: 1.25rem; background-color: var(--bg-secondary); border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative;"
>
  <!-- Bible Gateway link (top-right) -->
  {#if bibleGatewayUrl}
    <a 
      href={bibleGatewayUrl} 
      target="_blank" 
      rel="noopener noreferrer"
      class="bible-gateway-link"
      style="position: absolute; top: 0.75rem; right: 0.75rem; text-decoration: none; color: var(--accent); font-size: 1.25rem; transition: opacity 0.2s;"
      title="View on Bible Gateway"
    >
      🔗
    </a>
  {/if}

  <!-- All passages grouped by version -->
  {#each Array.from(passagesByVersion.entries()) as [version, versionPassages], i}
    <!-- Version header -->
    <div class="version-header" style="font-weight: 600; font-size: 1rem; margin-bottom: 1rem; margin-top: {i === 0 ? '0' : '1.5rem'}; color: var(--text-secondary); text-transform: uppercase;">
      {version ? version.toUpperCase() : 'DRB'}
    </div>

    <!-- All passages for this version -->
    {#each versionPassages as { event, reference, sectionValue } (event.id)}
      <div class="book-passage-item" style="margin-bottom: 1rem; padding: 1rem; background-color: var(--bg-primary); border-radius: 0.375rem;">
        <!-- Passage title/reference - clickable to open event -->
        <div 
          class="passage-reference" 
          style="font-weight: bold; margin-bottom: 0.5rem; color: var(--accent); cursor: pointer; text-decoration: underline;"
          onclick={(e) => openEvent(event, e)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && openEvent(event, undefined)}
          title="Click to open this passage in a new panel"
        >
          {reference.title}
          {#if reference.chapter}
            {reference.chapter}
            {#if sectionValue}
              :{sectionValue}
            {:else if reference.section && reference.section.length > 0}
              :{formatSections(reference.section)}
            {/if}
          {/if}
        </div>

        <!-- Passage content -->
        <div class="passage-content" style="font-style: italic; color: var(--text-primary);">
          {event.content}
        </div>
      </div>
    {/each}
  {/each}
</div>

<style>
  .book-passage-group {
    font-family: inherit;
  }
  
  .bible-gateway-link:hover {
    opacity: 0.7;
  }
</style>

