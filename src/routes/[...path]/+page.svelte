<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { normalizeURL } from '@nostr/tools/utils';
  import { decode } from '@nostr/tools/nip19';

  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import { next, scrollCardIntoView } from '$lib/utils';
  import type { ArticleCard, Card, EditorCard, RelayCard, SearchCard, UserCard, BookCard, DiffCard } from '$lib/types';

  // Track previous path to avoid infinite loops
  let prevP: string[] = [];

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
    let nextP = (page.params.path || '').split('/').filter((str) => str !== '');

    // Check if path actually changed to prevent infinite loops
    if (nextP.length === prevP.length && nextP.every((val, idx) => val === prevP[idx])) {
      return; // Path hasn't changed, no need to update
    }

    // Use untrack to read from $cards without making it a reactive dependency
    const currentCards = untrack(() => $cards);
    
    let nextCards: Card[] = [];
    for (let n = 0; n < nextP.length; n++) {
      // for all the path parts in the next url we try to find them in the previous
      let found = false;
      for (let p = 0; p < prevP.length; p++) {
        if (prevP[p] === nextP[n]) {
          // when we find something that means we will keep the corresponding card
          // but at the new index (which is likely to be the same, but not always)
          nextCards[n] = currentCards[p];
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
          const newCard = cardFromPathPart(nextP[n]);
          
          // Check for duplicates in:
          // 1. Already-processed cards in nextCards (from earlier in this loop)
          // 2. Current cards from the existing state
          // 3. Upcoming cards in nextP that match this path segment
          const existingCard = [
            ...nextCards.filter((c): c is Card => c !== undefined).slice(0, n), // Already processed in this loop
            ...currentCards, // Existing cards
            ...nextCards.filter((c): c is Card => c !== undefined).slice(n + 1) // Already processed later in the array
          ].find(
            (existing) => {
              // For article cards, check by data (dTag * pubkey) - BOTH must match
              // Articles with same dTag but different pubkeys are NOT duplicates
              if (existing.type === 'article' && newCard.type === 'article') {
                const existingData = (existing as ArticleCard).data;
                const newData = (newCard as ArticleCard).data;
                return existingData[0] === newData[0] && existingData[1] === newData[1];
              }
              // For find cards, check by data (identifier)
              if (existing.type === 'find' && newCard.type === 'find') {
                return (existing as SearchCard).data === (newCard as SearchCard).data;
              }
              // Don't match article vs find - they're different card types
              // Same article identifier from different authors should be allowed
              // For other card types, check by matching path representation
              return false;
            }
          );
          
          // First check if the same path segment appears earlier in nextP (exact URL match)
          const duplicatePathIndex = nextP.slice(0, n).findIndex((path) => path === nextP[n]);
          if (duplicatePathIndex !== -1 && nextCards[duplicatePathIndex]) {
            // Same path segment found earlier - reuse that card
            nextCards[n] = nextCards[duplicatePathIndex];
          } else if (existingCard) {
            // Use existing card instead of creating a new one
            nextCards[n] = existingCard;
          } else {
            nextCards[n] = newCard;
          }
        }
      }
    }

    cards.set(nextCards);
    prevP = nextP;
  });

  function cardFromPathPart(pathPart: string): Card {
    // This function always returns a Card - all code paths end with a return statement
    let ditem = decodeURIComponent(pathPart);
    if (ditem.startsWith('edit:')) {
      return {
        id: next(),
        type: 'editor',
        data: { title: ditem.substring(5), summary: '', content: '' }
      } as EditorCard;
    } else if (ditem.startsWith('book::')) {
      // New NKBIP-08 format: book::... (for search bar, no brackets needed)
      // Keep the full book:: prefix in the data
      return { 
        id: next(), 
        type: 'book', 
        data: ditem
      } as BookCard;
    } else if (ditem.match(/^\[\[book::/)) {
      // NKBIP-08 format with brackets: [[book::...]] (for wikilinks in content)
      // Extract the content and add book:: prefix
      const bookQuery = ditem.replace(/^\[\[book::|\]\]$/g, '');
      return { 
        id: next(), 
        type: 'book', 
        data: `book::${bookQuery}`
      } as BookCard;
    } else if (ditem.startsWith('diff:')) {
      return { id: next(), type: 'diff', data: ditem.substring(5) } as DiffCard;
    } else if (ditem.startsWith('npub1')) {
      return { id: next(), type: 'user', data: decode(ditem).data as string } as UserCard;
    } else if (ditem.startsWith('nevent1')) {
      // Handle nevent - decode and create appropriate card based on event kind
      try {
        const decoded = decode(ditem);
        if (decoded.type === 'nevent' && decoded.data.id) {
          // Create a find card that will handle the nevent lookup
          return { id: next(), type: 'find', data: ditem, preferredAuthors: [] } as SearchCard;
        }
      } catch (e) {
        // If decode fails, fall through to default
      }
      // If nevent decode failed or not a valid nevent, create find card
      return { id: next(), type: 'find', data: pathPart, preferredAuthors: [] } as SearchCard;
    } else if (ditem.startsWith('naddr1')) {
      // Handle naddr - ALWAYS create article card, never book card
      try {
        const decoded = decode(ditem);
        if (decoded.type === 'naddr') {
          const articleKinds = [30023, 30817, 30041, 30040, 30818];
          if (decoded.data.kind && articleKinds.includes(decoded.data.kind)) {
            // ALWAYS create article card - never use book:: prefix for naddr
            const identifier = decoded.data.identifier || '';
            const pubkey = decoded.data.pubkey || '';
            return { 
              id: next(), 
              type: 'article', 
              data: [identifier, pubkey],
              relayHints: decoded.data.relays || []
            } as ArticleCard;
          }
        }
      } catch (e) {
        // If decode fails, fall through to default
      }
      // If naddr decode succeeded but not a recognized kind, or decode failed, create find card
      return { id: next(), type: 'find', data: pathPart, preferredAuthors: [] } as SearchCard;
    } else if (
      ditem.split('.').length >= 2 ||
      ditem.startsWith('wss://') ||
      ditem.startsWith('ws://')
    ) {
      return { id: next(), type: 'relay', data: normalizeURL(ditem) } as RelayCard;
    } else if (pathPart.match(/^[\w-]+\*[a-f0-9]{64}$/)) {
      return { id: next(), type: 'article', data: pathPart.split('*') } as ArticleCard;
    } else if (pathPart.match(/^[a-f0-9]{64}$/i)) {
      // 64-character hex string - could be event ID or pubkey
      // Create a find card that will handle the lookup
      return { id: next(), type: 'find', data: pathPart, preferredAuthors: [] } as SearchCard;
    } else {
      return { id: next(), type: 'find', data: pathPart, preferredAuthors: [] } as SearchCard;
    }
  }
</script>
