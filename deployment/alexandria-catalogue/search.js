/**
 * Search functionality for books
 */

import { nip19 } from './nostr.js';
import { fetchBooks } from './nostr.js';
import { normalizeForExactMatch, normalizeForSearch } from './utils.js';

/**
 * Check if a book matches a search query
 */
export function matchesSearch(book, query) {
  let hexEventIdToSearch = null;
  let hexPubkeyToSearch = null;
  
  // Check for npub
  if (query.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'npub') {
        hexPubkeyToSearch = decoded.data;
      }
    } catch (e) {
      console.log(`[Search] Query looks like npub but decode failed: ${e?.message || String(e)}`);
    }
  }
  
  // Check for nevent
  if (query.startsWith('nevent1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'nevent') {
        hexEventIdToSearch = decoded.data.id;
        if (decoded.data.author) {
          hexPubkeyToSearch = decoded.data.author;
        }
      }
    } catch (e) {
      console.log(`[Search] Query looks like nevent but decode failed: ${e?.message || String(e)}`);
    }
  }
  
  // Check for note
  if (query.startsWith('note1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'note') {
        hexEventIdToSearch = decoded.data;
      }
    } catch (e) {
      console.log(`[Search] Query looks like note but decode failed: ${e?.message || String(e)}`);
    }
  }
  
  // Check for naddr
  if (query.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'naddr') {
        if (book.kind === decoded.data.kind &&
            book.pubkey && typeof book.pubkey === 'string' &&
            book.pubkey.toLowerCase() === decoded.data.pubkey.toLowerCase()) {
          const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
          if (dTag === decoded.data.identifier) {
            return true;
          }
        }
      }
    } catch (e) {
      console.log(`[Search] Query looks like naddr but decode failed: ${e?.message || String(e)}`);
    }
  }
  
  // Check if query matches hex event ID directly
  if (!hexEventIdToSearch && query.match(/^[0-9a-fA-F]{64}$/)) {
    hexEventIdToSearch = query;
    if (!hexPubkeyToSearch) {
      hexPubkeyToSearch = query;
    }
  }
  
  // Check hex event ID
  if (hexEventIdToSearch) {
    const queryLower = hexEventIdToSearch.toLowerCase();
    if (book.id && typeof book.id === 'string' && book.id.toLowerCase() === queryLower) {
      return true;
    }
  }
  
  // Check hex pubkey
  if (hexPubkeyToSearch) {
    const queryLower = hexPubkeyToSearch.toLowerCase();
    if ((book.pubkey && typeof book.pubkey === 'string' && book.pubkey.toLowerCase() === queryLower) ||
        (book.id && typeof book.id === 'string' && book.id.toLowerCase() === queryLower)) {
      return true;
    }
    const pTags = book.tags.filter(([k]) => k === 'p').map(([, v]) => v || '');
    for (const pTag of pTags) {
      if (typeof pTag === 'string' && pTag.toLowerCase() === queryLower) {
        return true;
      }
    }
  }
  
  // Try exact match first
  const exactQuery = normalizeForExactMatch(query);
  if (exactQuery) {
    const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
    const exactDTag = normalizeForExactMatch(dTag);
    
    const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                 book.tags.find(([k]) => k === 'T')?.[1] || '';
    const exactTitle = normalizeForExactMatch(title);
    
    const content = book.tags.find(([k]) => k === 'C')?.[1] || '';
    const exactContent = normalizeForExactMatch(content);
    
    const authorTags = book.tags.filter(([k]) => k === 'author').map(([, v]) => v || '');
    const exactAuthors = authorTags.map(a => normalizeForExactMatch(a));
    
    if (exactDTag.includes(exactQuery) || 
        exactTitle.includes(exactQuery) ||
        exactContent.includes(exactQuery)) {
      return true;
    }
    
    for (const exactAuthor of exactAuthors) {
      if (exactAuthor.includes(exactQuery)) {
        return true;
      }
    }
    
    const summaryTags = book.tags.filter(([k]) => k === 'summary').map(([, v]) => v || '');
    const exactSummaries = summaryTags.map(s => normalizeForExactMatch(s));
    for (const exactSummary of exactSummaries) {
      if (exactSummary.includes(exactQuery)) {
        return true;
      }
    }
  }
  
  // Try normalized (accent-removed) matching
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return false;
  
  const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
  const normalizedDTag = normalizeForSearch(dTag);
  
  const title = book.tags.find(([k]) => k === 'title')?.[1] || 
               book.tags.find(([k]) => k === 'T')?.[1] || '';
  const normalizedTitle = normalizeForSearch(title);
  
  const content = book.tags.find(([k]) => k === 'C')?.[1] || '';
  const normalizedContent = normalizeForSearch(content);
  
  const authorTags = book.tags.filter(([k]) => k === 'author').map(([, v]) => v || '');
  const normalizedAuthors = authorTags.map(a => normalizeForSearch(a));
  
  if (normalizedDTag.includes(normalizedQuery) || 
      normalizedTitle.includes(normalizedQuery) ||
      normalizedContent.includes(normalizedQuery)) {
    return true;
  }
  
  for (const normalizedAuthor of normalizedAuthors) {
    if (normalizedAuthor.includes(normalizedQuery)) {
      return true;
    }
  }
  
  const summaryTags = book.tags.filter(([k]) => k === 'summary').map(([, v]) => v || '');
  const normalizedSummaries = summaryTags.map(s => normalizeForSearch(s));
  for (const normalizedSummary of normalizedSummaries) {
    if (normalizedSummary.includes(normalizedQuery)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Search books by query
 */
export async function searchBooks(query, limit = 10000, customRelays = null) {
  console.log(`[Search] Searching books with query: ${query}`);
  
  const allBooks = await fetchBooks(limit, customRelays);
  const matchingBooks = allBooks.filter(book => matchesSearch(book, query));
  
  console.log(`[Search] Found ${matchingBooks.length} matching books out of ${allBooks.length} total`);
  return matchingBooks;
}
