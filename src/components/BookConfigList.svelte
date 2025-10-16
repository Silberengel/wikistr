<script lang="ts">
  import { bookConfigurations } from '$lib/bookConfig';
  import { onMount } from 'svelte';

  export let onClose: () => void;
  export let onCreateNew: () => void;

  let configs: any[] = [];
  let selectedConfig: any = null;
  let isLoading = true;

  onMount(() => {
    const unsubscribe = bookConfigurations.subscribe((configsList) => {
      configs = configsList;
      isLoading = false;
    });

    return unsubscribe;
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
  <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex">
    <!-- Left Panel - Config List -->
    <div class="w-1/3 border-r border-gray-200 flex flex-col">
      <div class="p-4 border-b border-gray-200">
        <div class="flex justify-between items-center">
          <h2 class="text-xl font-bold text-gray-900">Book Configurations</h2>
          <button
            onclick={onClose}
            class="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>
        <button
          onclick={onCreateNew}
          class="mt-3 w-full px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm"
        >
          + Create New Configuration
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        {#if isLoading}
          <div class="p-4 text-center text-gray-500">Loading configurations...</div>
        {:else if configs.length === 0}
          <div class="p-4 text-center text-gray-500">
            <p>No book configurations found.</p>
            <p class="text-sm mt-2">Create your first configuration to get started!</p>
          </div>
        {:else}
          <div class="divide-y divide-gray-100">
            {#each configs as config}
              <button
                type="button"
                class="w-full text-left p-4 cursor-pointer hover:bg-gray-50 {selectedConfig?.id === config.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''}"
                onclick={() => selectConfig(config)}
                onkeydown={(e) => e.key === 'Enter' && selectConfig(config)}
              >
                <div class="font-medium text-gray-900">{config.displayName}</div>
                <div class="text-sm text-gray-500 mt-1">
                  Type: {config.name}
                </div>
                <div class="text-xs text-gray-400 mt-1">
                  {Object.keys(config.books).length} books • {Object.keys(config.versions).length} versions
                </div>
                <div class="text-xs text-gray-400">
                  {formatDate(config.created_at)}
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
        <div class="p-4 border-b border-gray-200">
          <h3 class="text-lg font-medium text-gray-900">{selectedConfig.displayName}</h3>
          <p class="text-sm text-gray-500">Type: {selectedConfig.name}</p>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <!-- Books Section -->
          <div>
            <h4 class="text-md font-medium text-gray-900 mb-3">Books ({Object.keys(selectedConfig.books).length})</h4>
            <div class="space-y-2">
              {#each Object.entries(selectedConfig.books) as [fullName, abbreviations]}
                <div class="bg-gray-50 p-3 rounded-md">
                  <div class="font-medium text-gray-900">{fullName}</div>
                  <div class="text-sm text-gray-600 mt-1">
                    Abbreviations: {(abbreviations as string[]).join(', ')}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Versions Section -->
          <div>
            <h4 class="text-md font-medium text-gray-900 mb-3">Versions ({Object.keys(selectedConfig.versions).length})</h4>
            <div class="space-y-2">
              {#each Object.entries(selectedConfig.versions) as [abbrev, fullName]}
                <div class="bg-gray-50 p-3 rounded-md">
                  <div class="font-medium text-gray-900">{abbrev}</div>
                  <div class="text-sm text-gray-600">{fullName}</div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Parsing Rules -->
          <div>
            <h4 class="text-md font-medium text-gray-900 mb-3">Parsing Rules</h4>
            <div class="bg-gray-50 p-3 rounded-md space-y-2">
              <div>
                <span class="text-sm font-medium text-gray-700">Book Pattern:</span>
                <code class="text-sm text-gray-600 ml-2">{selectedConfig.parsingRules.bookPattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium text-gray-700">Chapter Pattern:</span>
                <code class="text-sm text-gray-600 ml-2">{selectedConfig.parsingRules.chapterPattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium text-gray-700">Verse Pattern:</span>
                <code class="text-sm text-gray-600 ml-2">{selectedConfig.parsingRules.versePattern}</code>
              </div>
              <div>
                <span class="text-sm font-medium text-gray-700">Version Pattern:</span>
                <code class="text-sm text-gray-600 ml-2">{selectedConfig.parsingRules.versionPattern}</code>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div>
            <h4 class="text-md font-medium text-gray-900 mb-3">Metadata</h4>
            <div class="bg-gray-50 p-3 rounded-md space-y-2">
              <div>
                <span class="text-sm font-medium text-gray-700">Created:</span>
                <span class="text-sm text-gray-600 ml-2">{formatDate(selectedConfig.created_at)}</span>
              </div>
              <div>
                <span class="text-sm font-medium text-gray-700">Publisher:</span>
                <code class="text-sm text-gray-600 ml-2">{selectedConfig.pubkey.slice(0, 16)}...</code>
              </div>
            </div>
          </div>

          <!-- Raw JSON -->
          <div>
            <div class="flex justify-between items-center mb-3">
              <h4 class="text-md font-medium text-gray-900">Raw Configuration</h4>
              <button
                onclick={() => copyConfigJson(selectedConfig)}
                class="px-2 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
              >
                Copy JSON
              </button>
            </div>
            <pre class="bg-gray-50 p-3 rounded-md text-xs text-gray-600 overflow-x-auto">{JSON.stringify(JSON.parse(selectedConfig.content), null, 2)}</pre>
          </div>
        </div>
      {:else}
        <div class="flex-1 flex items-center justify-center text-gray-500">
          <div class="text-center">
            <p class="text-lg">Select a configuration to view details</p>
            <p class="text-sm mt-2">Click on any configuration from the list to see its contents</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
