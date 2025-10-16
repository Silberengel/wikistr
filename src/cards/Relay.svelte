<script lang="ts">
  import { onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';

  import type { ArticleCard, Card } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, urlWithoutScheme } from '$lib/utils';
  import { wikiKind } from '$lib/nostr';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import { account } from '$lib/nostr';
  import { relayService } from '$lib/relayService';

  interface Props {
    card: Card;
    replaceSelf: (card: Card) => void;
    createChild: (card: Card) => void;
  }

  let { card, replaceSelf, createChild }: Props = $props();
  let results = $state<NostrEvent[]>([]);
  let tried = $state(false);

  // Type guard to ensure we have a relay card
  if (card.type !== 'relay') {
    throw new Error('Relay component requires a relay card');
  }
  
  const relayCard = card as { type: 'relay'; data: string };

  onMount(async () => {
    const update = debounce(() => {
      results = results;
    }, 500);

    setTimeout(() => {
      tried = true;
    }, 1500);

    // Use relay service for relay-specific queries
    if ($account) {
      try {
        const result = await relayService.queryEvents(
          $account.pubkey,
          'wiki-read',
          [{ kinds: [wikiKind], limit: 25 }],
          {
            excludeUserContent: true,
            currentUserPubkey: $account.pubkey
          }
        );
        
        result.events.forEach(evt => {
          if (addUniqueTaggedReplaceable(results, evt)) update();
        });
        tried = true;
      } catch (err) {
        console.warn('Failed to load relay articles:', err);
        tried = true;
      }
    }
  });

  function openArticle(result: NostrEvent, ev: MouseEvent) {
    let articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      relayHints: [relayCard.data],
      actualEvent: result
    };
    if (ev.button === 1) createChild(articleCard);
    else replaceSelf(articleCard);
  }
</script>

<div class="mb-0 text-2xl break-all">{urlWithoutScheme(relayCard.data)}</div>
{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}
{#if tried && results.length === 0}
  <div class="px-4 py-5 border-2 border-stone rounded-lg mt-2 min-h-[48px]" style="background-color: var(--theme-bg);">
    <p class="mb-2">No articles found in this relay.</p>
  </div>
{:else if !tried}
  <div class="px-4 py-5 rounded-lg mt-2 min-h-[48px]">Loading...</div>
{/if}
