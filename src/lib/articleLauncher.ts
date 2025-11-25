import { get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { cards } from '$lib/state';
import { next, scrollCardIntoView, normalizeDTag } from '$lib/utils';
import type { Card, ArticleCard, SearchCard } from '$lib/types';

function cardToPath(card: Card): string | null {
  switch (card.type) {
    case 'find':
      return card.data;
    case 'article':
      return (card.data as [string, string]).join('*');
    case 'relay':
      return encodeURIComponent(card.data);
    case 'user':
      return encodeURIComponent(card.data);
    case 'editor':
      return `edit:${encodeURIComponent((card as any).data.title)}`;
    case 'book': {
      const bookData = (card as any).data;
      if (typeof bookData !== 'string') return null;
      return encodeURIComponent(bookData.startsWith('book::') ? bookData : `book::${bookData}`);
    }
    case 'diff':
      return `diff:${encodeURIComponent(card.data)}`;
  }
  return null;
}

function buildPath(cardList: Card[]): string {
  const segments = cardList
    .map(card => cardToPath(card))
    .filter((segment): segment is string => Boolean(segment));
  return '/' + segments.join('/');
}

export const highlightedArticleCardId = writable<number | null>(null);

/**
 * Opens an article card, checking for duplicates first.
 * If a duplicate is found, highlights the existing card.
 * Otherwise, creates a new card and navigates to it.
 * 
 * @param articleCard - The article card to open (with optional properties)
 * @returns true if an existing card was found and highlighted, false if a new card was created
 */
export function openOrCreateArticleCard(articleCard: Omit<ArticleCard, 'id'>): boolean {
  const currentCards = get(cards);
  // Normalize d-tag to ensure consistency
  const identifier = normalizeDTag(articleCard.data[0]);
  const pubkey = articleCard.data[1];

  // Check for existing article card with matching [dTag, pubkey]
  // Only consider duplicates if both dTag AND pubkey match
  // Normalize d-tags for comparison
  const existingArticleCard = currentCards.find(
    card => card.type === 'article' && 
      normalizeDTag((card as ArticleCard).data[0]) === identifier &&
      (card as ArticleCard).data[1] === pubkey
  );

  if (existingArticleCard) {
    goto(buildPath(currentCards));
    setTimeout(() => {
      scrollCardIntoView(String(existingArticleCard.id), true);
      highlightedArticleCardId.set(existingArticleCard.id);
      setTimeout(() => highlightedArticleCardId.set(null), 1200);
    }, 50);
    return true;
  }

  // Check for existing find card with matching identifier
  const existingFindCard = currentCards.find(
    card => card.type === 'find' && (card as SearchCard).data === identifier
  );

  if (existingFindCard) {
    goto(buildPath(currentCards));
    setTimeout(() => {
      scrollCardIntoView(String(existingFindCard.id), true);
      highlightedArticleCardId.set(existingFindCard.id);
      setTimeout(() => highlightedArticleCardId.set(null), 1200);
    }, 50);
    return true;
  }

        // No existing card found, create a new one
        // Ensure d-tag is normalized in the card data
        const newCard: ArticleCard = {
          id: next(),
          ...articleCard,
          data: [identifier, pubkey] // Use normalized identifier
        };

  const updatedCards = [...currentCards, newCard];
  goto(buildPath(updatedCards));
  return false;
}

export function openArticleCard(
  identifier: string, 
  preferredAuthors: string[] = [],
  pubkey?: string
) {
  if (!identifier) return;

  const currentCards = get(cards);
  
  // If pubkey is provided, check for existing article card with matching [dTag, pubkey]
  if (pubkey) {
    const existingArticleCard = currentCards.find(
      card => card.type === 'article' && 
        (card as ArticleCard).data[0] === identifier &&
        (card as ArticleCard).data[1] === pubkey
    );

    if (existingArticleCard) {
      goto(buildPath(currentCards));
      setTimeout(() => {
        scrollCardIntoView(String(existingArticleCard.id), true);
        highlightedArticleCardId.set(existingArticleCard.id);
        setTimeout(() => highlightedArticleCardId.set(null), 1200);
      }, 50);
      return;
    }

    // Create article card with specific pubkey
    const articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [identifier, pubkey],
      relayHints: []
    };

    const updatedCards = [...currentCards, articleCard];
    goto(buildPath(updatedCards));
    return;
  }

  // No pubkey provided - we can't check for duplicates without pubkey
  // Articles with same dTag but different pubkeys are different articles

  // Check for existing find card with matching identifier
  const existingFindCard = currentCards.find(
    card => card.type === 'find' && (card as SearchCard).data === identifier
  );

  if (existingFindCard) {
    goto(buildPath(currentCards));
    setTimeout(() => {
      scrollCardIntoView(String(existingFindCard.id), true);
      highlightedArticleCardId.set(existingFindCard.id);
      setTimeout(() => highlightedArticleCardId.set(null), 1200);
    }, 50);
    return;
  }

  // No existing card found, create a new find card
  const findCard: SearchCard = {
    id: next(),
    type: 'find',
    data: identifier,
    preferredAuthors: preferredAuthors
  };

  const updatedCards = [...currentCards, findCard];
  goto(buildPath(updatedCards));
}

