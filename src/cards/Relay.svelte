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

    // Always query the specific relay directly (no cache for relay-specific views)
    const relayUrl = relayCard.data;
    
    if ($account) {
      try {
        console.log(`Relay: Querying ONLY relay ${relayUrl} directly`);
        
        // Query only the specific relay, not all relays
        const filters = [{ kinds: [wikiKind], limit: 25 }];
        const events: NostrEvent[] = [];
        let subscriptionClosed = false;
        
        const subscription = pool.subscribeMany([relayUrl], filters, {
          onevent: (event: any) => {
            if (subscriptionClosed) return;
            
            // Filter out user's own content if requested
            if (event.pubkey === $account.pubkey) {
              return;
            }
            
            events.push(event);
            if (addUniqueTaggedReplaceable(results, event)) update();
          },
          oneose: () => {
            if (subscriptionClosed) return;
            subscriptionClosed = true;
            subscription.close();
            tried = true;
          }
        });
        
        // Timeout after 8 seconds
        setTimeout(() => {
          if (!subscriptionClosed) {
            subscriptionClosed = true;
            subscription.close();
            tried = true;
          }
        }, 8000);
        
      } catch (err) {
        console.warn('Failed to load relay articles:', err);
        tried = true;
      }
    }
  });

  function openArticle(result: NostrEvent, ev: MouseEvent) {
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
    
    let articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [getTagOr(result, 'd'), result.pubkey],
      relayHints: [relayCard.data],
      actualEvent: cleanEvent
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
