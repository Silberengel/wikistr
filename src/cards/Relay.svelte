<script lang="ts">
  import { onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent } from '@nostr/tools/pure';

  import type { ArticleCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, urlWithoutScheme } from '$lib/utils';
  // Support all wiki kinds: 30818 (AsciiDoc), 30817 (Markdown), 30040 (Index), 30041 (Content)
  const wikiKinds = [30818, 30817, 30040, 30041, 30023];
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import { account } from '$lib/nostr';
  import { relayService } from '$lib/relayService';
  import { openOrCreateArticleCard } from '$lib/articleLauncher';

  interface Props {
    card: Card;
    replaceSelf: (card: Card) => void;
    createChild: (card: Card) => void;
  }

  let { card, replaceSelf, createChild }: Props = $props();
  let results = $state<NostrEvent[]>([]);
  let tried = $state(false);
  let isLoading = $state(false);
  let isOpeningArticle = $state(false);

  // Type guard to ensure we have a relay card
  if (card.type !== 'relay') {
    throw new Error('Relay component requires a relay card');
  }
  
  const relayCard = card as { type: 'relay'; data: string };

  const update = debounce(() => {
    results = results;
  }, 500);

  async function loadRelayArticles() {
    isLoading = true;
    tried = false;
    results = [];

    // Always query the specific relay directly (no cache for relay-specific views)
    const relayUrl = relayCard.data;
    
    try {
      // Use relayService to query the specific relay with proper filter formatting
      // Create a custom relay service instance that only uses this one relay
      const result = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'wiki-read',
        [{ kinds: wikiKinds, limit: 25 }],
        {
          excludeUserContent: false,
          currentUserPubkey: $account?.pubkey,
          // Override relays to only use this specific relay
          customRelays: [relayUrl]
        }
      );
      
      // Store events in appropriate caches based on kind (even for relay-specific views)
      if (result.events.length > 0) {
        const { contentCache } = await import('$lib/contentCache');
        for (const event of result.events) {
          const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                           event.kind === 30023 ? 'longform' :
                           (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
          if (cacheType) {
            await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
          }
        }
      }

      // Process events and add to results
      for (const event of result.events) {
        // Filter out user's own content if requested
        if ($account && event.pubkey === $account.pubkey) {
          continue;
        }
        
        if (addUniqueTaggedReplaceable(results, event)) update();
      }
      
      tried = true;
    } catch (err) {
      console.warn('Failed to load relay articles:', err);
      tried = true;
    } finally {
      isLoading = false;
    }
  }

  onMount(async () => {
    setTimeout(() => {
      if (!tried) {
        tried = true;
      }
    }, 1500);

    await loadRelayArticles();
  });

  function openArticle(result: NostrEvent, ev: MouseEvent) {
    // Prevent multiple handlers from firing
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    
    // Prevent rapid clicks from creating multiple cards
    if (isOpeningArticle) {
      return;
    }
    isOpeningArticle = true;
    
    // Reset flag after a short delay
    setTimeout(() => {
      isOpeningArticle = false;
    }, 500);
    
    // Create a clean, serializable copy of the event
    const cleanEvent = {
      id: result.id,
      pubkey: result.pubkey,
      created_at: result.created_at,
      kind: result.kind,
      tags: result.tags.map(tag => [...tag]), // Deep copy tags array
      content: result.content,
      sig: result.sig
    };
    
    const articleCardData: Omit<ArticleCard, 'id'> = {
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      relayHints: [relayCard.data],
      actualEvent: cleanEvent
    };
    
    if (ev.button === 1 || ev.ctrlKey || ev.metaKey) {
      // Middle-click or Ctrl/Cmd-click: open in new card with duplicate checking
      openOrCreateArticleCard(articleCardData);
    } else {
      // Left-click: replace current card
      const articleCard: ArticleCard = {
        id: next(),
        ...articleCardData
      };
      replaceSelf(articleCard);
    }
  }
</script>

<div class="mb-0 text-2xl break-all">{urlWithoutScheme(relayCard.data)}</div>
{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}
{#if tried && results.length === 0 && !isLoading}
  <div class="px-4 py-5 border-2 border-stone rounded-lg mt-2 min-h-[48px]" style="background-color: var(--theme-bg);">
    <p class="mb-2">No articles found in this relay.</p>
    <button
      onclick={loadRelayArticles}
      type="button"
      class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
      style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
    >
      Retry
    </button>
  </div>
{:else if isLoading || !tried}
  <div class="px-4 py-5 rounded-lg mt-2 min-h-[48px]">Loading...</div>
{/if}
