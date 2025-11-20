import { get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { cards } from '$lib/state';
import { next, scrollCardIntoView } from '$lib/utils';
import type { Card, BookCard } from '$lib/types';

function normalizeBookQuery(query: string): string {
  if (!query) return '';
  let normalized = query.trim();

  if (normalized.startsWith('[[') && normalized.endsWith(']]')) {
    normalized = normalized.substring(2, normalized.length - 2).trim();
  }

  if (!normalized.startsWith('book::')) {
    normalized = `book::${normalized}`;
  }

  return normalized.replace(/\s*\|\s*/g, ' | ');
}

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
      const bookData = (card as BookCard).data;
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

export const highlightedBookCardId = writable<number | null>(null);

export function openBookSearchCard(rawQuery: string) {
  const normalized = normalizeBookQuery(rawQuery);
  if (!normalized) return;

  const currentCards = get(cards);
  const existingCard = currentCards.find(
    card => card.type === 'book' && (card as BookCard).data === normalized
  );

  if (existingCard) {
    goto(buildPath(currentCards));
    setTimeout(() => {
      scrollCardIntoView(String(existingCard.id), true);
      highlightedBookCardId.set(existingCard.id);
      setTimeout(() => highlightedBookCardId.set(null), 1200);
    }, 50);
    return;
  }

  const bookCard: BookCard = {
    id: next(),
    type: 'book',
    data: normalized
  };

  const updatedCards = [...currentCards, bookCard];
  goto(buildPath(updatedCards));
}

