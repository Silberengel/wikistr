<script lang="ts">
  import { next } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';

  import type { SearchCard, Card } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
  // import { refreshBookConfigurations } from '$lib/bookConfig';
  // import BookConfigForm from '$components/BookConfigForm.svelte';
  // import BookConfigList from '$components/BookConfigList.svelte';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    replaceNewCard: (card: Card) => void;
  }

  let { replaceNewCard }: Props = $props();
  let query = $state('');
  let showBookConfigForm = $state(false);
  let showBookConfigList = $state(false);

  function search(ev: SubmitEvent) {
    ev.preventDefault();

    if (query) {
      const newCard: SearchCard = {
        id: next(),
        type: 'find',
        data: normalizeIdentifier(query),
        preferredAuthors: []
      };
      replaceNewCard(newCard);
      query = '';
    }
  }

  // async function refreshBookConfigs() {
  //   try {
  //     await refreshBookConfigurations();
  //     console.log('Book configurations refreshed successfully');
  //   } catch (error) {
  //     console.error('Failed to refresh book configurations:', error);
  //   }
  // }

  // function openBookConfigForm() {
  //   showBookConfigForm = true;
  // }

  // function closeBookConfigForm() {
  //   showBookConfigForm = false;
  // }

  // function onBookConfigSuccess() {
  //   // Refresh the book configurations after successful creation
  //   refreshBookConfigs();
  // }

  // function openBookConfigList() {
  //   showBookConfigList = true;
  // }

  // function closeBookConfigList() {
  //   showBookConfigList = false;
  // }
</script>

<form onsubmit={search} class="mt- flex rounded-md shadow-sm">
  <div class="relative flex items-stretch flex-grow focus-within:z-10">
    <input
      bind:value={query}
      class="focus:ring-burgundy-500 focus:border-burgundy-500 block w-full rounded-none rounded-l-md sm:text-sm border-espresso-300 bg-brown-50 text-espresso-900 placeholder-espresso-500 {theme.styling.inputStyle}"
      style="font-family: {theme.typography.fontFamily}; font-size: {theme.typography.fontSize.sm};"
      placeholder="article name, search term, or book:type:reference"
    />
  </div>
  <button
    type="submit"
    class="-ml-px inline-flex items-center space-x-2 px-3 py-2 text-sm font-medium rounded-r-md {theme.styling.buttonStyle}"
    style="font-family: {theme.typography.fontFamily}; font-size: {theme.typography.fontSize.sm};"
    >Go</button>
</form>

<!-- Book Configuration Buttons - TEMPORARILY DISABLED -->
<!-- <div class="mt-3 flex gap-2">
  <button
    onclick={refreshBookConfigs}
    class="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 hover:text-gray-900 transition-colors"
    title="Refresh book configurations from Nostr events"
  >
    🔄 Refresh Books
  </button>
  
  <button
    onclick={openBookConfigList}
    class="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 border border-blue-300 rounded text-blue-700 hover:text-blue-900 transition-colors"
    title="View existing book configurations"
  >
    📚 View Configs
  </button>
  
  <button
    onclick={openBookConfigForm}
    class="text-sm px-3 py-1 bg-green-100 hover:bg-green-200 border border-green-300 rounded text-green-700 hover:text-green-900 transition-colors"
    title="Create a new book configuration"
  >
    ➕ Create Config
  </button>
</div> -->

<!-- Search Instructions from Theme -->
<div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
  <h3 class="text-lg font-semibold text-espresso-900 mb-3">Search Instructions</h3>
  <div class="text-sm text-espresso-800 space-y-2">
    {@html theme.searchHelpText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
  </div>
</div>

<!-- Book Configuration Modals - TEMPORARILY DISABLED -->
<!-- {#if showBookConfigForm}
  <BookConfigForm
    onClose={closeBookConfigForm}
    onSuccess={onBookConfigSuccess}
  />
{/if}

{#if showBookConfigList}
  <BookConfigList
    onClose={closeBookConfigList}
    onCreateNew={() => {
      closeBookConfigList();
      openBookConfigForm();
    }}
  />
{/if} -->
