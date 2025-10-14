<script lang="ts">
  import { next } from '$lib/utils';

  import type { SearchCard, Card } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

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
      class="focus:ring-burgundy-500 focus:border-burgundy-500 block w-full rounded-none rounded-l-md sm:text-sm border-espresso-300 bg-brown-50 text-espresso-900 placeholder-espresso-500"
      placeholder="article name or search term"
    />
  </div>
  <button
    type="submit"
    class="-ml-px inline-flex items-center space-x-2 px-3 py-2 border border-brown-300 text-sm font-medium rounded-r-md bg-espresso-700 hover:bg-espresso-800 focus:outline-none focus:ring-1 focus:ring-espresso-500 focus:border-espresso-500 text-white"
    >Go</button
  >
</form>

<!-- Search Instructions -->
<div class="px-4 py-6 bg-brown-200 border border-brown-300 rounded-lg mt-4">
  <h3 class="text-lg font-semibold text-espresso-900 mb-3">🔍 Search Instructions</h3>
  <div class="text-sm text-espresso-800 space-y-2">
    <p><strong>This unified search finds both wiki articles and Bible passages:</strong></p>
    <ul class="text-xs text-espresso-700 ml-4 space-y-1">
      <li>• <strong>Wiki articles</strong> (d-tag, title, summary, full-text search)</li>
      <li>• <strong>Bible passages</strong> (all versions and translations)</li>
    </ul>
    <p><strong>Search for Bible passages:</strong></p>
    <div class="bg-brown-100 p-3 rounded border border-brown-300 font-mono text-xs">
      <div>bible:John 3:16</div>
      <div>bible:John 3:16 KJV</div>
      <div>bible:Psalm 23:1</div>
      <div>bible:Genesis 1:1 KJV</div>
      <div>bible:Romans 1:16-25; Psalm 19:2-3</div>
    </div>
    <p class="text-xs text-espresso-600 mt-2">
      💡 <strong>Use <code>bible:</code> prefix for more reliable results</strong> - avoids false positives with names like "John Smith". Case and whitespace are flexible: <code>bible:john3:16</code> works the same as <code>bible:John 3:16</code>
    </p>
    <p><strong>In wiki articles, use Bible wikilinks:</strong></p>
    <div class="bg-brown-100 p-3 rounded border border-brown-300 font-mono text-xs">
      <div>[[bible:John 3:16 | KJV]]</div>
      <div>[[bible:Psalm 23:1]]</div>
      <div>[[bible:Genesis 1:1 | KJV]]</div>
      <div>[[bible:Romans 1:16-25; Psalm 19:2-3]]</div>
    </div>
    <p class="text-xs text-espresso-600 mt-2">
      🔍 <strong>Compare content with diff:</strong>
    </p>
    <div class="bg-white p-3 rounded border border-brown-300 font-mono text-xs mt-1">
      <div>diff::article1 | article2</div>
      <div>diff::John 3:16 KJV | NIV</div>
      <div>diff::article1; article2; article3</div>
      <div>diff::John 3:16 KJV | ESV</div>
    </div>
    <p class="text-xs text-espresso-600 mt-1">
      💡 Use <code>diff::</code> prefix to compare wiki articles, Bible versions, or any content. Supports pipe <code>|</code> and semicolon <code>;</code> separation.
    </p>
  </div>
</div>
