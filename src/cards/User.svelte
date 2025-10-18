<script lang="ts">
  import { onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent } from '@nostr/tools/pure';

  import type { ArticleCard, Card, UserCard } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next } from '$lib/utils';
  import { wikiKind } from '$lib/nostr';
  import ArticleListItem from '$components/ArticleListItem.svelte';
  import UserLabel from '$components/UserLabel.svelte';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';

  interface Props {
    card: UserCard;
    createChild: (card: Card) => void;
  }

  let { card, createChild }: Props = $props();
  let seenCache: { [id: string]: string[] } = {};
  let results = $state<NostrEvent[]>([]);
  let tried = $state(false);

  onMount(async () => {
    const update = debounce(() => {
      results = results;
      seenCache = seenCache;
    }, 500);

    setTimeout(() => {
      tried = true;
    }, 1500);

    try {
      // Check cache first before making relay queries
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = await contentCache.getEvents('wiki');
      
      // Filter cached events for this specific user
      const userCachedEvents = cachedEvents.filter(cached => 
        cached.event.pubkey === card.data
      );
      
      if (userCachedEvents.length > 0) {
        console.log(`User: Found ${userCachedEvents.length} cached events for user ${card.data.slice(0, 8)}...`);
        userCachedEvents.forEach(cached => {
          // Track which relays returned this event
          cached.relays.forEach(relay => {
            if (!seenCache[cached.event.id]) seenCache[cached.event.id] = [];
            if (seenCache[cached.event.id].indexOf(relay) === -1) {
              seenCache[cached.event.id].push(relay);
            }
          });
          
          if (addUniqueTaggedReplaceable(results, cached.event)) update();
        });
        tried = true;
      } else {
        // Use relayService directly if no cache
        console.log(`User: No cached events, loading from relays for user ${card.data.slice(0, 8)}...`);
        const result = await relayService.queryEvents(
          card.data,
          'wiki-read',
          [{ kinds: [wikiKind], authors: [card.data], limit: 50 }],
          {
            excludeUserContent: false,
            currentUserPubkey: $account?.pubkey
          }
        );

        // Process events and track relay sources
        result.events.forEach(event => {
          // Track which relays returned this event
          result.relays.forEach(relay => {
            if (!seenCache[event.id]) seenCache[event.id] = [];
            if (seenCache[event.id].indexOf(relay) === -1) {
              seenCache[event.id].push(relay);
            }
          });
          
          if (addUniqueTaggedReplaceable(results, event)) update();
        });

        tried = true;
      }
    } catch (error) {
      console.warn('Failed to load user articles:', error);
      tried = true;
    }
  });

  function openArticle(result: NostrEvent) {
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
      relayHints: seenCache[result.id] || [],
      actualEvent: cleanEvent
    };
    createChild(articleCard);
  }
</script>

<div class="mb-0 text-2xl break-all">
  <UserLabel pubkey={card.data} />
</div>
{#each results as result (result.id)}
  <ArticleListItem event={result} {openArticle} />
{/each}
{#if tried && results.length === 0}
  <div class="px-4 py-5 border-2 border-stone rounded-lg mt-2 min-h-[48px]" style="background-color: var(--theme-bg);">
    <p class="mb-2">No articles found for this user.</p>
  </div>
{:else if !tried}
  <div class="px-4 py-5 rounded-lg mt-2 min-h-[48px]">Loading...</div>
{/if}
