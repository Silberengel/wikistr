<script lang="ts">
  import { bookConfigurations, allBookTypes } from '$lib/bookConfig';
  import { BOOK_TYPES } from '$lib/books';
  import { onMount } from 'svelte';

  export let onClose: () => void;
  export let onCreateNew: () => void;

  let configs: any[] = [];
  let selectedConfig: any = null;
  let isLoading = true;

  onMount(() => {
    // Subscribe to both hardcoded and custom configurations
    const unsubscribe1 = allBookTypes.subscribe((bookTypes) => {
      // Convert hardcoded book types to config format
      const hardcodedConfigs = Object.entries(bookTypes).map(([name, bookType]) => ({
        id: `hardcoded-${name}`,
        name: bookType.name,
        displayName: bookType.displayName,
        books: bookType.books,
        versions: bookType.versions,
        parsingRules: {
          bookPattern: bookType.parsingRules.bookPattern.toString(),
          chapterPattern: bookType.parsingRules.chapterPattern.toString(),
          versePattern: bookType.parsingRules.versePattern.toString(),
          versionPattern: bookType.parsingRules.versionPattern.toString()
        },
        displayFormat: {
          bookChapterVerse: 'default',
          withVersion: 'default'
        },
        created_at: 0, // Hardcoded configs have no timestamp
        pubkey: 'system',
        content: JSON.stringify(bookType),
        isHardcoded: true
      }));

      // Get custom configurations from NIP-78 events
      const unsubscribe2 = bookConfigurations.subscribe((customConfigs) => {
        configs = [...hardcodedConfigs, ...customConfigs];
        isLoading = false;
      });

      return () => {
        unsubscribe1();
        unsubscribe2();
      };
    });

    return unsubscribe1;
  });

  function selectConfig(config: any) {
    selectedConfig = config;
  }

  function formatDate(timestamp: number) {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function copyConfigJson(config: any) {
    try {
      const configJson = JSON.stringify(JSON.parse(config.content), null, 2);
      navigator.clipboard.writeText(configJson);
    } catch (error) {
      console.error('Failed to copy config:', error);
    }
  }
</script>

<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
  <div class="rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex" style="background-color: var(--bg-primary);">
    <!-- Left Panel - Config List -->
    <div class="w-1/3 border-r flex flex-col" style="border-color: var(--border);">
      <div class="p-4 border-b" style="border-color: var(--border);">
        <div class="flex justify-between items-center">
          <h2 class="text-xl font-bold" style="color: var(--text-primary);">Book Configurations</h2>
          <button
            onclick={onClose}
            class="text-2xl transition-colors hover:opacity-70"
            style="color: var(--text-secondary);"
          >
            ×
          </button>
        </div>
        <button
          onclick={onCreateNew}
          class="mt-3 w-full px-3 py-2 rounded-md text-sm transition-colors"
          style="background-color: var(--accent); color: white; border: 1px solid var(--accent);"
        >
          + Create New Configuration
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        {#if isLoading}
          <div class="p-4 text-center" style="color: var(--text-secondary);">Loading configurations...</div>
        {:else if configs.length === 0}
          <div class="p-4 text-center" style="color: var(--text-secondary);">
            <p>No book configurations found.</p>
            <p class="text-sm mt-2">Create your first configuration to get started!</p>
          </div>
        {:else}
          <div class="divide-y" style="border-color: var(--border);">
            {#each configs as config}
              <button
                type="button"
                class="w-full text-left p-4 cursor-pointer transition-colors"
                style="background-color: {selectedConfig?.id === config.id ? 'var(--bg-secondary)' : 'var(--bg-primary)'}; border-right: {selectedConfig?.id === config.id ? '2px solid var(--accent)' : 'none'};"
                onclick={() => selectConfig(config)}
                onkeydown={(e) => e.key === 'Enter' && selectConfig(config)}
              >
                <div class="font-medium" style="color: var(--text-primary);">{config.displayName}</div>
                <div class="text-sm mt-1" style="color: var(--text-secondary);">
                  Type: {config.name}
                  {#if config.isHardcoded}
                    <span class="ml-2 px-2 py-1 text-xs rounded" style="background-color: var(--bg-secondary); color: var(--text-secondary);">Built-in</span>
                  {/if}
                </div>
                <div class="text-xs mt-1" style="color: var(--text-muted);">
                  {Object.keys(config.books).length} books • {Object.keys(config.versions).length} versions
                </div>
                <div class="text-xs" style="color: var(--text-muted);">
                  {#if !config.isHardcoded}
                    {formatDate(config.created_at)}
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Right Panel - Config Details -->
    <div class="w-2/3 flex flex-col">
      {#if selectedConfig}
        <div class="p-4 border-b" style="border-color: var(--border);">
          <h3 class="text-lg font-medium" style="color: var(--text-primary);">{selectedConfig.displayName}</h3>
          <p class="text-sm" style="color: var(--text-secondary);">Type: {selectedConfig.name}</p>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <!-- Books Section -->
          <div>
            <h4 class="text-md font-medium mb-3" style="color: var(--text-primary);">Books ({Object.keys(selectedConfig.books).length})</h4>
            <div class="space-y-2">
              {#each Object.entries(selectedConfig.books) as [fullName, abbreviations]}
                <div class="p-3 rounded-md" style="background-color: var(--bg-secondary);">
                  <div class="font-medium" style="color: var(--text-primary);">{fullName}</div>
                  <div class="text-sm mt-1" style="color: var(--text-secondary);">
                    Abbreviations: {(abbreviations as string[]).join(', ')}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Versions Section -->
          <div>
            <h4 class="text-md font-medium mb-3" style="color: var(--text-primary);">Versions ({Object.keys(selectedConfig.versions).length})</h4>
            <div class="space-y-2">
              {#each Object.entries(selectedConfig.versions) as [abbrev, fullName]}
                <div class="p-3 rounded-md" style="background-color:pos var(--bg-secondary);">
                  <div class="font-medium" style="color: var(--text-primary);">{abbrev}</div>
                  <div class="text-sm" style="color: var(--text-secondary);">{fullName}</div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Parsing Rules -->
          <div>
            <h4 class="text-md font-medium mb-3" style="color: var(--text-primary);">Parsing Rules</h4>
            <div class="p-3 rounded-md space-y-2" style="background-color: var(--bg-secondary);">
              <div>
                <span class="text-sm font-medium" style="color: var(--text-primary);">Book Pattern:</span>
                <code class="text-sm ml-2 px-2 py-1 rounded font-mono" style="background-color: var(--bg-secondary); color: var(--accent); border: 1px solid var(--border);">{selectedConfig.parsingRules.bookPattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium" style="color: var(--text-primary);">Chapter Pattern:</span>
                <code class="text-sm ml-2 px-2 py-1 rounded font-mono" style="background-color: var(--bg-secondary); color: var(--accent); border: 1px solid var(--border);">{selectedConfig.parsingRules.chapterPattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium" style="color: var(--text-primary);">Verse Pattern:</span>
                <code class="text-sm ml-2 px-2 py-1 rounded font-mono" style="background-color: var(--bg-secondary); color: var(--accent); border: 1px solid var(--border);">{selectedConfig.parsingRules.versePattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium" style="color: var(--text-primary);">Version Pattern:</span>
                <code class="text-sm ml-2 px-2 py-1 rounded font-mono" style="background-color: var(--bg-secondary); color: var(--accent); border: 1px solid var(--border);">{selectedConfig.parsingRules.versionPattern}</code>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div>
            <h4 class="text-md font-medium mb-3" style="color: var(--text-primary);">Metadata</h4>
            <div class="p-3 rounded-md space-y-2" style="background-color: var(--bg-secondary);">
              {#if selectedConfig.isHardcoded}
                <div>
                  <span class="text-sm font-medium" style="color: var(--text-primary);">Type:</span>
                  <span class="text-sm ml-2" style="color: var(--text-secondary);">Built-in Configuration</span>
                </div>
                <div>
                  <span class="text-sm font-medium" style="color: var(--text-primary);">Source:</span>
                  <span class="text-sm ml-2" style="color: var(--text-secondary);">Wikistr Core</span>
                </div>
              {:else}
                <div>
                  <span class="text-sm font-medium" style="color: var(--text-primary);">Created:</span>
                  <span class="text-sm ml-2" style="color: var(--text-secondary);">{formatDate(selectedConfig.created_at)}</span>
                </div>
                <div>
                  <span class="text-sm font-medium" style="color: var(--text-primary);">Publisher:</span>
                  <code class="text-sm ml-2" style="color: var(--text-secondary);">{selectedConfig.pubkey.slice(0, 16)}...</code>
                </div>
              {/if}
            </div>
          </div>

          <!-- Raw JSON -->
          <div>
            <div class="flex justify-between items-center mb-3">
              <h4 class="text-md font-medium" style="color: var(--text-primary);">Raw Configuration</h4>
              <button
                onclick={() => copyConfigJson(selectedConfig)}
                class="px-2 py-1 rounded text-sm transition-colors"
                style="background-color: var(--bg-secondary); color: var(--text-primary);"
              >
                Copy JSON
              </button>
            </div>
            <pre class="p-3 rounded-md text-xs overflow-x-auto" style="background-color: var(--bg-secondary); color: var(--text-secondary);">{JSON.stringify(JSON.parse(selectedConfig.content), null, 2)}</pre>
          </div>
        </div>
      {:else}
        <div class="flex-1 flex items-center justify-center" style="color: var(--text-secondary);">
          <div class="text-center">
            <p class="text-lg">Select a configuration to view details</p>
            <p class="text-sm mt-2">Click on any configuration from the list to see its contents</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
