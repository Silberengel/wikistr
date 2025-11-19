<script lang="ts">
  import { onMount } from 'svelte';
  import { normalizeURL } from '@nostr/tools/utils';
  import { decode } from '@nostr/tools/nip19';

  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import { next, scrollCardIntoView } from '$lib/utils';
  import type { ArticleCard, Card, EditorCard, RelayCard, SearchCard, UserCard, BookCard, DiffCard } from '$lib/types';

  onMount(() => {
    if ($cards.length !== 0) return;

    page.url.pathname
      .split('/')
      .filter((str) => str !== '')
      .forEach((pathPart: string) => {
        $cards.push(cardFromPathPart(pathPart));
      });

    cards.set($cards);

    if ($cards.length) {
      const lastCard = $cards[$cards.length - 1];
      if (lastCard && typeof lastCard.id === 'number') {
        // Add a small delay to ensure the element is rendered
        setTimeout(() => {
          scrollCardIntoView(String(lastCard.id), true);
        }, 100);
      }
    }
  });

  $effect(() => {
    let prevP: string[] = [];
    let nextP = (page.params.path || '').split('/').filter((str) => str !== '');

    let nextCards: Card[] = [];
    for (let n = 0; n < nextP.length; n++) {
      // for all the path parts in the next url we try to find them in the previous
      let found = false;
      for (let p = 0; p < prevP.length; p++) {
        if (prevP[p] === nextP[n]) {
          // when we find something that means we will keep the corresponding card
          // but at the new index (which is likely to be the same, but not always)
          nextCards[n] = $cards[p];
          found = true;

          // we also null this, so repeated pathnames cannot be re-found
          prevP[p] = '___';

          break;
        }
      }

      if (!found) {
        // when we didn't find we either
        if (page.state && (page.state as [number, Card])[0] === n) {
          // get a card from the routing state and assign it to this place
          // (this is preferrable as that card in the state might contain hints that are no available in the URL)
          nextCards[n] = (page.state as [number, Card])[1];
        } else {
          // or create a new card from the path and assign it to this place
          nextCards[n] = cardFromPathPart(nextP[n]);
        }
      }
    }

    cards.set(nextCards);
    prevP = nextP;
  });

  function cardFromPathPart(pathPart: string): Card {
    let ditem = decodeURIComponent(pathPart);
    if (ditem.startsWith('edit:')) {
      return {
        id: next(),
        type: 'editor',
        data: { title: ditem.substring(5), summary: '', content: '' }
      } as EditorCard;
    } else if (ditem.startsWith('book::')) {
      // New NKBIP-08 format: book::... (for search bar, no brackets needed)
      const bookQuery = ditem.substring(6); // Remove "book::" prefix (6 characters)
      return { 
        id: next(), 
        type: 'book', 
        data: bookQuery
      } as BookCard;
    } else if (ditem.match(/^\[\[book::/)) {
      // NKBIP-08 format with brackets: [[book::...]] (for wikilinks in content)
      const bookQuery = ditem.replace(/^\[\[book::|\]\]$/g, '');
      return { 
        id: next(), 
        type: 'book', 
        data: bookQuery
      } as BookCard;
    } else if (ditem.startsWith('book:')) {
      // Legacy format: book:bible:John 3:16 (kept for backward compatibility)
      const bookQuery = ditem.substring(5);
      const parts = bookQuery.split(':');
      if (parts.length >= 2) {
        return { 
          id: next(), 
          type: 'book', 
          data: parts.slice(1).join(':'),
          bookType: parts[0]
        } as BookCard;
      } else {
        return { id: next(), type: 'book', data: bookQuery } as BookCard;
      }
    } else if (ditem.startsWith('diff:')) {
      return { id: next(), type: 'diff', data: ditem.substring(5) } as DiffCard;
    } else if (ditem.startsWith('npub1')) {
      return { id: next(), type: 'user', data: decode(ditem).data as string } as UserCard;
    } else if (
      ditem.split('.').length >= 2 ||
      ditem.startsWith('wss://') ||
      ditem.startsWith('ws://')
    ) {
      return { id: next(), type: 'relay', data: normalizeURL(ditem) } as RelayCard;
    } else if (pathPart.match(/^[\w-]+\*[a-f0-9]{64}$/)) {
      return { id: next(), type: 'article', data: pathPart.split('*') } as ArticleCard;
    } else {
      return { id: next(), type: 'find', data: pathPart, preferredAuthors: [] } as SearchCard;
    }
  }
</script>
