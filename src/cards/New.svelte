<script lang="ts">
  import { next } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';

  import type { SearchCard, Card } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    replaceNewCard: (card: Card) => void;
  }

  let { replaceNewCard }: Props = $props();
  let query = $state('');

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

<!-- Search Instructions from Theme -->
<div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
  <h3 class="text-lg font-semibold text-espresso-900 mb-3">Search Instructions</h3>
  <div class="text-sm text-espresso-800 space-y-2">
    {@html theme.searchHelpText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
  </div>
</div>
