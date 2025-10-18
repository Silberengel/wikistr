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

    // Check cache first before making relay queries
    const { contentCache } = await import('$lib/contentCache');
    const cachedEvents = await contentCache.getEvents('wiki');
    const relayUrl = relayCard.data;
    
    // Filter cached events for this specific relay
    const relayCachedEvents = cachedEvents.filter(cached => 
      cached.relays.includes(relayUrl)
    );
    
    if (relayCachedEvents.length > 0) {
      console.log(`Relay: Found ${relayCachedEvents.length} cached events for relay ${relayUrl}`);
      relayCachedEvents.forEach(cached => {
        if (addUniqueTaggedReplaceable(results, cached.event)) update();
      });
      tried = true;
    } else {
      // Use relay service for relay-specific queries if no cache
      if ($account) {
        try {
          console.log(`Relay: No cached events, loading from relay ${relayUrl}`);
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
