#!/usr/bin/env node

/**
 * Alexandria Catalogue
 * Simple HTTP server for browsing and downloading books (kind 30040) as EPUB files
 * Designed for e-paper readers that can't use websockets
 * 
 * Usage: node epub-download-server.js [port]
 * Default port: 8092
 */

import http from 'http';
import { URL } from 'url';
import { SimplePool, nip19 } from '@nostr/tools';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.EPUB_DOWNLOAD_PORT || process.argv[2] || 8092;
const ASCIIDOCTOR_SERVER_URL = process.env.ASCIIDOCTOR_SERVER_URL || 'http://localhost:8091';

// Cache configuration for e-paper reader optimization
const CACHE_TTL = {
  BOOK_LIST: 5 * 60 * 1000,      // 5 minutes for book lists (relatively static)
  BOOK_DETAIL: 10 * 60 * 1000,   // 10 minutes for individual books
  SEARCH_RESULTS: 2 * 60 * 1000, // 2 minutes for search results
  GENERATED_FILES: 60 * 60 * 1000 // 1 hour for generated files (EPUB, PDF, etc.)
};

// In-memory cache for e-paper reader optimization
const cache = {
  bookList: { data: null, timestamp: 0, limit: 0, showAll: false },
  topLevelBooks: { data: null, timestamp: 0, limit: 0 },
  bookDetails: new Map(), // naddr -> { data, timestamp }
  bookHierarchy: new Map(), // naddr -> { data, timestamp }
  bookComments: new Map(), // naddr -> { data, timestamp }
  searchResults: new Map(), // query -> { data, timestamp }
  generatedFiles: new Map() // naddr:format -> { buffer, mimeType, extension, timestamp }
};

// Create a simple pool for fetching events
// Use WebSocket implementation for Node.js
const pool = new SimplePool({
  websocketImplementation: WebSocket
});

// Default relays to use for fetching book events
const DEFAULT_RELAYS = [
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://nostr.wine',
  'wss://orly-relay.imwald.eu'
];

/**
 * Parse relay URLs from user input
 * Supports ws:// and wss:// formats
 * Accepts comma or newline separated list
 * Returns array of valid relay URLs, or empty array if none valid
 */
function parseRelayUrls(input) {
  if (!input || typeof input !== 'string') {
    return [];
  }
  
  // Split by comma or newline
  const rawUrls = input.split(/[,\n]/)
    .map(url => url.trim())
    .filter(url => url.length > 0);
  
  // Validate and normalize URLs
  const validUrls = [];
  for (const url of rawUrls) {
    // Must start with ws:// or wss://
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      try {
        // Basic validation - check if it's a valid URL format
        const urlObj = new URL(url);
        // WebSocket URLs should not have path, query, or fragment
        if (urlObj.pathname === '/' && urlObj.search === '' && urlObj.hash === '') {
          validUrls.push(url);
        } else {
          console.warn(`[Relay Parser] Ignoring relay URL with path/query/fragment: ${url}`);
        }
      } catch (e) {
        console.warn(`[Relay Parser] Invalid relay URL format: ${url}`);
      }
    } else {
      console.warn(`[Relay Parser] Relay URL must start with ws:// or wss://: ${url}`);
    }
  }
  
  return validUrls;
}

/**
 * Fetch a book event by naddr (with caching for e-paper readers)
 * @param {string} naddr - The naddr to fetch
 * @param {string[]} [customRelays] - Optional custom relay URLs to use instead of defaults
 */
async function fetchBookEvent(naddr, customRelays = null) {
  try {
    // Check cache first
    const cached = cache.bookDetails.get(naddr);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.BOOK_DETAIL) {
      console.log(`[Book] Using cached data for: ${naddr}`);
      return cached.data;
    }
    
    const decoded = nip19.decode(naddr);
    if (decoded.type !== 'naddr') {
      throw new Error('Invalid naddr format');
    }

    const { kind, pubkey, identifier } = decoded.data;
    
    // Only support book kinds (30040 = book index, 30041 = book content)
    if (kind !== 30040 && kind !== 30041) {
      throw new Error(`Unsupported kind: ${kind}. Only book kinds (30040, 30041) are supported.`);
    }

    // Use custom relays if provided, otherwise relay hints from naddr, otherwise defaults
    let relays = DEFAULT_RELAYS;
    if (customRelays && customRelays.length > 0) {
      relays = customRelays;
    } else if (decoded.data.relays && decoded.data.relays.length > 0) {
      relays = decoded.data.relays;
    }

    console.log(`[EPUB Download] Fetching book event: kind=${kind}, pubkey=${pubkey}, identifier=${identifier}`);
    console.log(`[EPUB Download] Using relays: ${relays.join(', ')}`);

    // Query for the event using individual relay subscriptions
    const foundEvents = [];
    const eoseRelays = new Set();
    const totalRelays = relays.length;
    const subscriptions = [];
    
    const filter = {
      kinds: [kind],
      authors: [pubkey],
      '#d': [identifier],
      limit: 1
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            foundEvents.push(event);
          },
          oneose: () => {
            eoseRelays.add(relayUrl);
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
        eoseRelays.add(relayUrl);
      }
    }
    
    // Wait for event or all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (foundEvents.length > 0 || eoseRelays.size >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    const events = foundEvents;

    if (events.length === 0) {
      throw new Error('Book event not found on any relay');
    }

    const bookEvent = events[0];
    
    // Cache the result
    cache.bookDetails.set(naddr, {
      data: bookEvent,
      timestamp: Date.now()
    });
    
    // Limit cache size (keep last 100 books)
    if (cache.bookDetails.size > 100) {
      const firstKey = cache.bookDetails.keys().next().value;
      cache.bookDetails.delete(firstKey);
    }
    
    return bookEvent;
  } catch (error) {
    console.error('[EPUB Download] Error fetching book event:', error);
    throw error;
  }
}

/**
 * Fetch books by d tag (identifier)
 * Returns all books with the given d tag (from any author)
 * @param {string} dTag - The d tag identifier
 * @param {string[]} [customRelays] - Optional custom relay URLs to use instead of defaults
 */
async function fetchBooksByDTag(dTag, customRelays = null) {
  try {
    console.log(`[Books] Fetching books by d tag: ${dTag}`);
    
    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
    
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    let eoseCount = 0;
    const totalRelays = relays.length;
    const subscriptions = [];
    
    const filter = {
      kinds: [30040],
      '#d': [dTag],
      limit: 100
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Books] Error subscribing to ${relayUrl}:`, error);
        eoseCount++;
      }
    }
    
    // Wait for all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseCount >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 15000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    // Deduplicate by d-tag: if multiple events have the same d-tag, keep only the newest one
    const dTagMap = new Map(); // kind:pubkey:d -> event with highest created_at
    for (const event of foundEvents) {
      const eventDTag = event.tags.find(([k]) => k === 'd')?.[1];
      if (eventDTag === dTag) {
        const dTagKey = `${event.kind}:${event.pubkey}:${eventDTag}`;
        const existing = dTagMap.get(dTagKey);
        if (!existing || event.created_at > existing.created_at) {
          dTagMap.set(dTagKey, event);
        }
      }
    }
    
    const deduplicatedEvents = Array.from(dTagMap.values());
    console.log(`[Books] Found ${foundEvents.length} books with d tag: ${dTag}, ${deduplicatedEvents.length} after d-tag deduplication`);
    return deduplicatedEvents;
  } catch (error) {
    console.error('[Books] Error fetching books by d tag:', error);
    throw error;
  }
}

/**
 * Normalize text for exact matching (lowercase, normalize whitespace, but keep accents)
 */
function normalizeForExactMatch(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u017F]/g, ' ') // Replace punctuation but keep word chars and accented letters
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Normalize text for fuzzy matching (lowercase, handle foreign characters, normalize whitespace)
 * Handles foreign characters like ö, ß, é, etc. by normalizing accented characters to their base form
 * This allows "Charlotte Bronte" to match "Charlotte Brontë"
 */
function normalizeForSearch(text) {
  if (!text) return '';
  // Use Unicode-aware normalization (NFD) to decompose accented characters
  // Then remove diacritics (combining marks) to match accented and non-accented versions
  // Example: "Brontë" (ë = e + ¨) -> "bronte" after removing the combining mark
  return text
    .normalize('NFD') // Decompose characters (é -> e + ´, ë -> e + ¨)
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks (accents)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation but keep word chars
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if a book matches a search query (exact match first, then fuzzy matching)
 * Searches in: d tag, title/T tag, C tag (content/description), author tag, and pubkey (npub)
 */
function matchesSearch(book, query) {
  // Check if query is a Nostr identifier (npub, nevent, note, naddr) or hex ID
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
      const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
      console.log(`[Search] Query looks like npub but decode failed: ${errorMsg}`);
    }
  }
  
  // Check for nevent
  if (query.startsWith('nevent1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'nevent') {
        hexEventIdToSearch = decoded.data.id;
        // Also check if author matches
        if (decoded.data.author) {
          hexPubkeyToSearch = decoded.data.author;
        }
      }
    } catch (e) {
      const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
      console.log(`[Search] Query looks like nevent but decode failed: ${errorMsg}`);
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
      const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
      console.log(`[Search] Query looks like note but decode failed: ${errorMsg}`);
    }
  }
  
  // Check for naddr (book address)
  if (query.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(query);
      if (decoded.type === 'naddr') {
        // For naddr, match by kind, pubkey, and d tag
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
      const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
      console.log(`[Search] Query looks like naddr but decode failed: ${errorMsg}`);
    }
  }
  
  // Check if query matches hex event ID directly (64 hex chars)
  if (!hexEventIdToSearch && query.match(/^[0-9a-fA-F]{64}$/)) {
    // Could be either event ID or pubkey - check both
    hexEventIdToSearch = query;
    if (!hexPubkeyToSearch) {
      hexPubkeyToSearch = query;
    }
  }
  
  // If we have a hex event ID to search for, check id field
  if (hexEventIdToSearch) {
    const queryLower = hexEventIdToSearch.toLowerCase();
    if (book.id && typeof book.id === 'string' && book.id.toLowerCase() === queryLower) {
      return true;
    }
  }
  
  // If we have a hex pubkey to search for, check pubkey, id, and p tags
  if (hexPubkeyToSearch) {
    const queryLower = hexPubkeyToSearch.toLowerCase();
    // Check pubkey and id fields
    if ((book.pubkey && typeof book.pubkey === 'string' && book.pubkey.toLowerCase() === queryLower) ||
        (book.id && typeof book.id === 'string' && book.id.toLowerCase() === queryLower)) {
      return true;
    }
    // Check p tags (pubkey references)
    const pTags = book.tags.filter(([k]) => k === 'p').map(([, v]) => v || '');
    for (const pTag of pTags) {
      if (typeof pTag === 'string' && pTag.toLowerCase() === queryLower) {
        return true;
      }
    }
  }
  
  // First try exact match (case-insensitive, but keeping accents)
  const exactQuery = normalizeForExactMatch(query);
  if (exactQuery) {
    // Get d-tag (identifier)
    const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
    const exactDTag = normalizeForExactMatch(dTag);
    
    // Get title (check both 'title' and 'T' tags)
    const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                 book.tags.find(([k]) => k === 'T')?.[1] || '';
    const exactTitle = normalizeForExactMatch(title);
    
    // Get content/description (C tag)
    const content = book.tags.find(([k]) => k === 'C')?.[1] || '';
    const exactContent = normalizeForExactMatch(content);
    
    // Get author tag (check all 'author' tags)
    const authorTags = book.tags.filter(([k]) => k === 'author').map(([, v]) => v || '');
    const exactAuthors = authorTags.map(a => normalizeForExactMatch(a));
    
    // Check exact matches first (preserving accents)
    if (exactDTag.includes(exactQuery) || 
        exactTitle.includes(exactQuery) ||
        exactContent.includes(exactQuery)) {
      return true;
    }
    
    // Check author tags (exact)
    for (const exactAuthor of exactAuthors) {
      if (exactAuthor.includes(exactQuery)) {
        return true;
      }
    }
    
    // Check summary tags (exact)
    const summaryTags = book.tags.filter(([k]) => k === 'summary').map(([, v]) => v || '');
    const exactSummaries = summaryTags.map(s => normalizeForExactMatch(s));
    for (const exactSummary of exactSummaries) {
      if (exactSummary.includes(exactQuery)) {
        return true;
      }
    }
  }
  
  // If no exact match, try normalized (accent-removed) matching
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return false;
  
  // Get d-tag (identifier)
  const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
  const normalizedDTag = normalizeForSearch(dTag);
  
  // Get title (check both 'title' and 'T' tags)
  const title = book.tags.find(([k]) => k === 'title')?.[1] || 
               book.tags.find(([k]) => k === 'T')?.[1] || '';
  const normalizedTitle = normalizeForSearch(title);
  
  // Get content/description (C tag)
  const content = book.tags.find(([k]) => k === 'C')?.[1] || '';
  const normalizedContent = normalizeForSearch(content);
  
  // Get author tag (check all 'author' tags)
  const authorTags = book.tags.filter(([k]) => k === 'author').map(([, v]) => v || '');
  const normalizedAuthors = authorTags.map(a => normalizeForSearch(a));
  
  // Check if query matches d-tag, title, content, or author (normalized, accent-removed)
  if (normalizedDTag.includes(normalizedQuery) || 
      normalizedTitle.includes(normalizedQuery) ||
      normalizedContent.includes(normalizedQuery)) {
    return true;
  }
  
  // Check author tags (normalized)
  for (const normalizedAuthor of normalizedAuthors) {
    if (normalizedAuthor.includes(normalizedQuery)) {
      return true;
    }
  }
  
  // If no matches found yet, try summary tags as fallback (normalized)
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
 * Search books by fuzzy matching on d-tag and title
 */
/**
 * Get cached data if still valid
 */
function getCached(key, ttl) {
  const cached = cache[key];
  if (cached && cached.data && (Date.now() - cached.timestamp) < ttl) {
    return cached.data;
  }
  return null;
}

/**
 * Set cache data
 */
function setCached(key, data, extra = {}) {
  cache[key] = {
    data,
    timestamp: Date.now(),
    ...extra
  };
}

/**
 * Filter out nested books (books that are referenced by other 30040 events via 'a' tags)
 * Returns only top-level books (not nested within another book)
 */
function filterTopLevelBooks(allBooks) {
  // Build a set of all book identifiers that are referenced by other books
  // Books can be referenced via 'a' tags (kind:pubkey:d format) or 'e' tags (event ID)
  const referencedBookIds = new Set();
  const referencedEventIds = new Set();
  
  // First pass: collect all references
  for (const book of allBooks) {
    // Check all tags in this book
    for (const tag of book.tags) {
      if (tag[0] === 'a' && tag[1]) {
        // Parse the 'a' tag: kind:pubkey:d
        const [kindStr, pubkey, dTag] = tag[1].split(':');
        if (kindStr === '30040' && pubkey && dTag) {
          // This book references another 30040 event via 'a' tag
          // Create a unique identifier for the referenced book
          const referencedId = `${pubkey}:${dTag}`;
          referencedBookIds.add(referencedId);
        }
      } else if (tag[0] === 'e' && tag[1]) {
        // 'e' tag references another event by ID
        // Check if the referenced event is a 30040 event in our list
        const referencedEvent = allBooks.find(b => b.id === tag[1] && b.kind === 30040);
        if (referencedEvent) {
          // This is a reference to another 30040 event
          const identifier = referencedEvent.tags.find(([k]) => k === 'd')?.[1] || referencedEvent.id;
          const referencedId = `${referencedEvent.pubkey}:${identifier}`;
          referencedBookIds.add(referencedId);
          referencedEventIds.add(tag[1]); // Also track by event ID for direct lookup
        }
      }
    }
  }
  
  // Filter to only books that are NOT referenced by other books
  const topLevelBooks = allBooks.filter(book => {
    // Check if referenced by 'a' tag (pubkey:d format)
    const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
    const bookId = `${book.pubkey}:${identifier}`;
    if (referencedBookIds.has(bookId)) {
      return false;
    }
    // Check if referenced by 'e' tag (event ID)
    if (referencedEventIds.has(book.id)) {
      return false;
    }
    return true;
  });
  
  console.log(`[Books] Filtered ${allBooks.length} books to ${topLevelBooks.length} top-level books`);
  return topLevelBooks;
}

/**
 * Search books by query
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of books to fetch
 * @param {string[]} [customRelays] - Optional custom relay URLs to use instead of defaults
 */
async function searchBooks(query, limit = 10000, customRelays = null) {
  try {
    console.log(`[Search] Searching books with query: ${query}`);
    
    // Fetch all books (or a large set) - search includes nested books too
    const allBooks = await fetchBooks(limit, customRelays);
    
    // Filter by fuzzy matching - search through ALL books (not just top-level)
    const matchingBooks = allBooks.filter(book => matchesSearch(book, query));
    
    console.log(`[Search] Found ${matchingBooks.length} matching books out of ${allBooks.length} total (including nested)`);
    return matchingBooks;
  } catch (error) {
    console.error('[Search] Error searching books:', error);
    throw error;
  }
}

/**
 * Check if input is a naddr or just a d tag
 */
function isNaddr(input) {
  return input && input.startsWith('naddr1');
}

/**
 * Build book event hierarchy (tree structure)
 * @param {Object} indexEvent - The root book event
 * @param {Set} visitedIds - Set of already visited event IDs (for cycle detection)
 * @param {string[]} [customRelays] - Optional custom relay URLs to use instead of defaults
 */
async function buildBookEventHierarchy(indexEvent, visitedIds = new Set(), customRelays = null) {
  if (visitedIds.has(indexEvent.id)) {
    return [];
  }
  visitedIds.add(indexEvent.id);

  const nodes = [];
  
  // Collect all 'a' and 'e' tags in their original order
  const aTags = [];
  const eTags = [];
  const tagOrder = [];
  
  indexEvent.tags.forEach((tag, index) => {
    if (tag[0] === 'a' && tag[1]) {
      aTags.push(tag[1]);
      tagOrder.push({ type: 'a', value: tag[1], index });
    } else if (tag[0] === 'e' && tag[1] && tag[1] !== indexEvent.id && !visitedIds.has(tag[1])) {
      eTags.push(tag[1]);
      tagOrder.push({ type: 'e', value: tag[1], index });
    }
  });

  // Fetch all events in parallel
  const aTagEvents = new Map();
  const eTagEvents = new Map();

  // Fetch events by 'a' tags - batch all filters into a single query
  if (aTags.length > 0) {
    try {
      const aTagFilters = [];
      for (const aTag of aTags) {
        const [kindStr, pubkey, dTag] = aTag.split(':');
        if (kindStr && pubkey && dTag) {
          const kind = parseInt(kindStr, 10);
          if (kind === 30040 || kind === 30041) {
            aTagFilters.push({
              kinds: [kind],
              authors: [pubkey],
              '#d': [dTag]
            });
          }
        }
      }

      if (aTagFilters.length > 0) {
        // Batch all filters into a single subscription for much better performance
        const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
        const foundEvents = [];
        const eventMap = new Map(); // Deduplicate by event ID
        const eoseRelays = new Set();
        const totalRelays = relays.length;
        
        // Subscribe to all relays with all filters at once
        const subscriptions = [];
        for (const relayUrl of relays) {
          try {
            const relay = await pool.ensureRelay(relayUrl);
            // Subscribe with all filters at once - relay will return events matching any filter
            const sub = relay.subscribe(aTagFilters, {
              onevent: (event) => {
                // Deduplicate events by ID
                if (!eventMap.has(event.id)) {
                  eventMap.set(event.id, event);
                  foundEvents.push(event);
                }
              },
              oneose: () => {
                eoseRelays.add(relayUrl);
              }
            });
            subscriptions.push(sub);
          } catch (error) {
            console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
            eoseRelays.add(relayUrl);
          }
        }
        
        // Wait for all relays to respond or timeout (reduced to 5 seconds)
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (eoseRelays.size >= totalRelays) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50); // Check more frequently
          
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 5000); // Reduced timeout from 10s to 5s
        });
        
        // Close all subscriptions
        subscriptions.forEach(s => s.close());
        
        // Map events by their a-tag identifier, deduplicating by d-tag (keep newest)
        const dTagMap = new Map(); // kind:pubkey:d -> event with highest created_at
        for (const event of foundEvents) {
          if (event.kind === 30040 || event.kind === 30041) {
            const dTag = event.tags.find(([k]) => k === 'd')?.[1];
            if (dTag) {
              const dTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
              const existing = dTagMap.get(dTagKey);
              if (!existing || event.created_at > existing.created_at) {
                dTagMap.set(dTagKey, event);
              }
            }
          }
        }
        // Convert dTagMap to aTagEvents format
        for (const [dTagKey, event] of dTagMap.entries()) {
          aTagEvents.set(dTagKey, event);
        }
      }
    } catch (error) {
      console.error('[EPUB Download] Error processing a-tags:', error);
    }
  }

  // Fetch events by 'e' tags
  if (eTags.length > 0) {
    try {
      const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
      const foundEvents = [];
      const eventMap = new Map(); // Deduplicate by event ID
      const subscriptions = [];
      const eoseRelays = new Set();
      const totalRelays = relays.length;
      
      const filter = { ids: eTags };
      
      // Subscribe to each relay individually
      for (const relayUrl of relays) {
        try {
          const relay = await pool.ensureRelay(relayUrl);
          const sub = relay.subscribe([filter], {
            onevent: (event) => {
              // Deduplicate events by ID
              if (!eventMap.has(event.id)) {
                eventMap.set(event.id, event);
                foundEvents.push(event);
              }
            },
            oneose: () => {
              eoseRelays.add(relayUrl);
            }
          });
          subscriptions.push(sub);
        } catch (error) {
          console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
          eoseRelays.add(relayUrl);
        }
      }
      
      // Wait for all relays to respond or timeout (reduced to 5 seconds)
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (eoseRelays.size >= totalRelays) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50); // Check more frequently
        
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000); // Reduced timeout from 10s to 5s
      });
      
      // Close all subscriptions
      subscriptions.forEach(s => s.close());
      
      for (const event of foundEvents) {
        eTagEvents.set(event.id, event);
      }
    } catch (error) {
      console.error('[EPUB Download] Error fetching events by e-tags:', error);
    }
  }

  // Build nodes in original tag order - parallelize recursive calls for better performance
  const nodePromises = [];
  const branchNodes = []; // Track branch nodes that need children loaded
  
  // First pass: create all nodes and collect promises for branch nodes
  for (const tagInfo of tagOrder) {
    if (tagInfo.type === 'a') {
      const [kindStr, pubkey, dTag] = tagInfo.value.split(':');
      if (kindStr && pubkey && dTag) {
        const aTagKey = `${kindStr}:${pubkey}:${dTag}`;
        const event = aTagEvents.get(aTagKey);
        if (event) {
          const node = {
            event,
            children: []
          };
          
          // If this is a 30040 event (branch), recursively fetch its children
          if (event.kind === 30040 && !visitedIds.has(event.id)) {
            // Create promise for fetching children
            const promiseIndex = nodePromises.length;
            nodePromises.push(buildBookEventHierarchy(event, visitedIds, customRelays));
            branchNodes.push({ node, promiseIndex });
            nodes.push(node); // Add node now, fill children later
          } else {
            // Leaf node
            nodes.push(node);
          }
        }
      }
    } else if (tagInfo.type === 'e') {
      const event = eTagEvents.get(tagInfo.value);
      if (event) {
        nodes.push({
          event,
          children: []
        });
      }
    }
  }
  
  // Wait for all recursive calls to complete in parallel
  if (nodePromises.length > 0) {
    const allChildren = await Promise.all(nodePromises);
    // Fill in children for branch nodes
    for (const { node, promiseIndex } of branchNodes) {
      node.children = allChildren[promiseIndex];
    }
  }

  return nodes;
}

/**
 * Combine book events into AsciiDoc content
 * Renders hierarchical structure from nodes
 */
function combineBookEvents(indexEvent, hierarchy) {
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = nip19.npubEncode(indexEvent.pubkey);
  }

  // Build basic document structure
  let doc = `= ${title}\n`;
  if (author) {
    doc += `${author}\n`;
  }
  doc += `:doctype: book\n`;
  doc += `:toc:\n`;
  doc += `:toclevels: 1\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  
  if (author) {
    doc += `:author: ${author}\n`;
  }

  const version = indexEvent.tags.find(([k]) => k === 'version')?.[1] || 'first edition';
  doc += `:version: ${version}\n`;
  doc += `:revnumber: ${version}\n`;

  const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
  if (image) {
    // Add cover image for all formats (EPUB, PDF, HTML)
    doc += `:front-cover-image: ${image}\n`;
    doc += `:epub-cover-image: ${image}\n`; // Also set epub-cover-image for EPUB compatibility
  }

  doc += `\n\n`;

  // Render hierarchy recursively
  function renderNode(node, level = 2) {
    const event = node.event;
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1] || 
                        event.tags.find(([k]) => k === 'T')?.[1];
    
    if (sectionTitle) {
      const headingLevel = '='.repeat(Math.min(level, 6)); // Max level 6
      doc += `${headingLevel} ${sectionTitle}\n\n`;
    }
    
    // Add content if it exists
    if (event.content && event.content.trim().length > 0) {
      doc += `${event.content}\n\n`;
    }
    
    // Render children
    for (const child of node.children) {
      renderNode(child, level + 1);
    }
  }

  // Render all top-level nodes
  for (const node of hierarchy) {
    renderNode(node, 2);
  }

  return { content: doc, title, author };
}

/**
 * Collect all events from book hierarchy (recursive)
 */
function collectAllEventsFromHierarchy(indexEvent, hierarchy) {
  const events = [indexEvent];
  
  function collectFromNode(node) {
    events.push(node.event);
    for (const child of node.children) {
      collectFromNode(child);
    }
  }
  
  for (const node of hierarchy) {
    collectFromNode(node);
  }
  
  return events;
}

/**
 * Generate EPUB using AsciiDoctor server
 */
async function generateEPUB(content, title, author, image = null) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/epub`;
  
  console.log(`[EPUB Download] Generating EPUB via ${url}`);
  console.log(`[EPUB Download] Content length: ${content.length} chars`);

  const requestBody = {
    content,
    title,
    author
  };
  
  if (image) {
    requestBody.image = image;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();
  return blob;
}

/**
 * Generate PDF using AsciiDoctor server
 */
async function generatePDF(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/pdf`;
  
  console.log(`[PDF Download] Generating PDF via ${url}`);
  console.log(`[PDF Download] Content length: ${content.length} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      title,
      author
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();
  return blob;
}

/**
 * Generate HTML using AsciiDoctor server
 */
async function generateHTML(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/html5`;
  
  console.log(`[HTML View] Generating HTML via ${url}`);
  console.log(`[HTML View] Content length: ${content.length} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      title,
      author
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const html = await response.text();
  return html;
}

/**
 * Generate file in specified format using AsciiDoctor server
 */
async function generateFile(content, title, author, format, image) {
  // Handle AsciiDoc separately - it's the input format, so we just return the content
  if (format.toLowerCase() === 'asciidoc' || format.toLowerCase() === 'adoc') {
    return {
      blob: new Blob([content], { type: 'text/asciidoc' }),
      mimeType: 'text/asciidoc',
      extension: 'adoc'
    };
  }

  const formatMap = {
    'epub3': { endpoint: 'epub', mimeType: 'application/epub+zip', extension: 'epub' },
    'pdf': { endpoint: 'pdf', mimeType: 'application/pdf', extension: 'pdf' },
    'html5': { endpoint: 'html5', mimeType: 'text/html', extension: 'html' },
    'docbook5': { endpoint: 'docbook5', mimeType: 'application/xml', extension: 'xml' },
    'mobi': { endpoint: 'mobi', mimeType: 'application/x-mobipocket-ebook', extension: 'mobi' },
    'azw3': { endpoint: 'azw3', mimeType: 'application/vnd.amazon.ebook', extension: 'azw3' }
  };

  const formatInfo = formatMap[format.toLowerCase()];
  if (!formatInfo) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/${formatInfo.endpoint}`;
  
  console.log(`[File Generation] Generating ${format} via ${url}`);
  console.log(`[File Generation] Content length: ${content.length} chars`);

  const requestBody = {
    content,
    title,
    author: author || ''
  };
  
  // Add image if provided
  if (image) {
    requestBody.image = image;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();
  return { blob, mimeType: formatInfo.mimeType, extension: formatInfo.extension };
}

/**
 * Test relay connectivity
 * @param {string[]} relays - Array of relay URLs to test
 * @returns {Promise<Array<{url: string, status: string, error?: string}>>} Array of relay status objects
 */
async function testRelayConnectivity(relays) {
  const results = [];
  
  for (const relayUrl of relays) {
    try {
      console.log(`[Relay Test] Testing connection to ${relayUrl}...`);
      const relay = await pool.ensureRelay(relayUrl);
      
      // Try to get relay status by attempting a simple query with a short timeout
      const testFilter = { kinds: [30040], limit: 1 };
      let connected = false;
      let error = null;
      
      try {
        const sub = relay.subscribe([testFilter], {
          onevent: () => {
            connected = true;
          },
          oneose: () => {
            connected = true;
          }
        });
        
        // Wait up to 3 seconds for connection
        await new Promise((resolve) => {
          setTimeout(() => {
            sub.close();
            resolve();
          }, 3000);
        });
        
        if (connected) {
          results.push({ url: relayUrl, status: 'connected', error: null });
          console.log(`[Relay Test] ✓ ${relayUrl} - Connected`);
        } else {
          results.push({ url: relayUrl, status: 'timeout', error: 'No response within 3 seconds' });
          console.log(`[Relay Test] ⚠ ${relayUrl} - Timeout (no response)`);
        }
      } catch (testError) {
        const testErrorMsg = testError?.message || String(testError);
        results.push({ url: relayUrl, status: 'error', error: testErrorMsg });
        console.log(`[Relay Test] ✗ ${relayUrl} - Error: ${testErrorMsg}`);
      }
    } catch (connError) {
      const errorMsg = connError?.message || String(connError);
      results.push({ url: relayUrl, status: 'error', error: errorMsg });
      console.log(`[Relay Test] ✗ ${relayUrl} - Connection failed: ${errorMsg}`);
    }
  }
  
  return results;
}

/**
 * Fetch kind 30040 events (books)
 * @param {number} limit - Maximum number of books to fetch
 * @param {string[]} [customRelays] - Optional custom relay URLs to use instead of defaults
 */
async function fetchBooks(limit = 50, customRelays = null) {
  try {
    console.log(`[Books] Fetching ${limit} books from relays...`);
    
    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
    
    const filter = {
      kinds: [30040],
      limit: Number(limit)
    };
    
    console.log(`[Books] Using filter:`, JSON.stringify(filter));
    console.log(`[Books] Using relays: ${relays.join(', ')}`);
    
    // Use individual relay subscriptions to avoid subscribeMany serialization issues
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    const eoseRelays = new Set();
    const totalRelays = relays.length;
    const subscriptions = [];
    
    // Subscribe to each relay individually
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseRelays.add(relayUrl);
            console.log(`[Books] EOSE from ${relayUrl} (${eoseRelays.size}/${totalRelays})`);
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Books] Error subscribing to ${relayUrl}:`, error);
        eoseRelays.add(relayUrl); // Mark as done (failed)
      }
    }
    
    // Wait for all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseRelays.size >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      // Increase timeout for large limits (allow 1 second per 100 books, minimum 15s, maximum 120s)
      const timeoutMs = Math.min(Math.max(15000, (limit / 100) * 1000), 120000);
      setTimeout(() => {
        clearInterval(checkInterval);
        console.log(`[Books] Timeout reached after ${eoseRelays.size}/${totalRelays} relays responded`);
        resolve();
      }, timeoutMs);
    });
    
    // Close all subscriptions
    subscriptions.forEach(sub => sub.close());
    
    // Deduplicate by d-tag: if multiple events have the same d-tag, keep only the newest one
    const dTagMap = new Map(); // kind:pubkey:d -> event with highest created_at
    for (const event of foundEvents) {
      const dTag = event.tags.find(([k]) => k === 'd')?.[1];
      if (dTag) {
        const dTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
        const existing = dTagMap.get(dTagKey);
        if (!existing || event.created_at > existing.created_at) {
          dTagMap.set(dTagKey, event);
        }
      } else {
        // Events without d-tag: deduplicate by event ID (shouldn't happen for 30040, but just in case)
        const idKey = `id:${event.id}`;
        if (!dTagMap.has(idKey)) {
          dTagMap.set(idKey, event);
        }
      }
    }
    
    const deduplicatedEvents = Array.from(dTagMap.values());
    console.log(`[Books] Found ${foundEvents.length} books, ${deduplicatedEvents.length} after d-tag deduplication`);
    return deduplicatedEvents;
  } catch (error) {
    console.error('[Books] Error fetching books:', error);
    throw error;
  }
}

/**
 * Fetch user handle/name from kind 0 profile event
 */
async function fetchUserHandle(pubkey, customRelays = null) {
  // Handle both null and undefined for customRelays
  if (customRelays === undefined) {
    customRelays = null;
  }
  try {
    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
    
    const foundEvents = [];
    const eventMap = new Map();
    let eoseCount = 0;
    const totalRelays = relays.length;
    const subscriptions = [];
    
    const filter = {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    };
    
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Profile] Error subscribing to ${relayUrl}:`, error);
        eoseCount++;
      }
    }
    
    // Wait for response or timeout (shorter timeout for profile)
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseCount >= totalRelays || foundEvents.length > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 3000); // 3 second timeout for profile
    });
    
    subscriptions.forEach(s => s.close());
    
    if (foundEvents.length > 0) {
      try {
        const metadata = JSON.parse(foundEvents[0].content);
        // Return name, display_name, or nip05 (in that order of preference)
        return metadata.name || metadata.display_name || metadata.nip05 || null;
      } catch (e) {
        console.error('[Profile] Error parsing metadata:', e);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Profile] Error fetching user handle:', error);
    return null;
  }
}

/**
 * Fetch comments (kind 1111) and highlights (kind 9802) for a book event
 * Comments are only fetched for the root 30040 event
 * Highlights are fetched for all events in the hierarchy (root + all nested events)
 */
async function fetchComments(bookEvent, hierarchy = [], customRelays = null) {
  try {
    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
    
    // Build article coordinate for the root 30040 event (for comments only)
    const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
    const rootCoordinate = `${bookEvent.kind}:${bookEvent.pubkey}:${identifier}`;
    
    // Collect all event coordinates from the hierarchy (for highlights)
    const allEvents = collectAllEventsFromHierarchy(bookEvent, hierarchy);
    const highlightCoordinates = [];
    const coordinateSet = new Set(); // Deduplicate coordinates
    
    for (const event of allEvents) {
      // For highlights, we need to use the d-tag (not event.id) to match the "a" tag format
      const dTag = event.tags.find(([k]) => k === 'd')?.[1];
      if (dTag) {
        const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
        if (!coordinateSet.has(coordinate)) {
          coordinateSet.add(coordinate);
          highlightCoordinates.push(coordinate);
        }
      } else {
        // If no d-tag, use event.id as fallback (though highlights typically use d-tag format)
        const coordinate = `${event.kind}:${event.pubkey}:${event.id}`;
        if (!coordinateSet.has(coordinate)) {
          coordinateSet.add(coordinate);
          highlightCoordinates.push(coordinate);
        }
      }
    }
    
    console.log(`[Comments] Fetching comments for root coordinate: ${rootCoordinate}`);
    console.log(`[Comments] Fetching highlights for ${highlightCoordinates.length} events in hierarchy`);
    if (highlightCoordinates.length > 0 && highlightCoordinates.length <= 10) {
      console.log(`[Comments] Highlight coordinates:`, highlightCoordinates);
    } else if (highlightCoordinates.length > 10) {
      console.log(`[Comments] Highlight coordinates (first 10):`, highlightCoordinates.slice(0, 10));
    }
    
    // Debug: Log all events in hierarchy to verify they have d-tags
    console.log(`[Comments] All events in hierarchy:`, allEvents.map(e => ({
      kind: e.kind,
      id: e.id.substring(0, 16) + '...',
      pubkey: e.pubkey.substring(0, 16) + '...',
      dTag: e.tags.find(([k]) => k === 'd')?.[1] || 'NO D-TAG'
    })));
    
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    let eoseCount = 0;
    const totalRelays = relays.length;
    const subscriptions = [];
    
    // Fetch comments (kind 1111) only for the root 30040 event
    const commentFilter = {
      kinds: [1111],
      '#A': [rootCoordinate], // NIP-22: uppercase A tag for root scope
      limit: 500
    };
    
    // Fetch highlights (kind 9802) for all events in the hierarchy
    const highlightFilter = {
      kinds: [9802],
      '#A': highlightCoordinates, // All coordinates from the hierarchy
      limit: 1000 // Higher limit since we're fetching from multiple events
    };
    
    // Subscribe to each relay individually for comments
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([commentFilter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Comments] Error subscribing to ${relayUrl} for comments:`, error);
        eoseCount++;
      }
    }
    
    // Subscribe to each relay individually for highlights
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([highlightFilter], {
          onevent: (event) => {
            // Debug: Log received highlights
            const aTag = event.tags.find(([k]) => k === 'a' || k === 'A')?.[1];
            console.log(`[Comments] Received highlight ${event.id.substring(0, 16)}... with a-tag: ${aTag}`);
            
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Comments] Error subscribing to ${relayUrl} for highlights:`, error);
        eoseCount++;
      }
    }
    
    // Wait for all relays to respond or timeout
    // Note: eoseCount will be 2x totalRelays since we have 2 subscriptions per relay
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseCount >= totalRelays * 2) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    const commentCount = foundEvents.filter(e => e.kind === 1111).length;
    const highlightCount = foundEvents.filter(e => e.kind === 9802).length;
    console.log(`[Comments] Found ${commentCount} comments and ${highlightCount} highlights`);
    return foundEvents;
  } catch (error) {
    console.error('[Comments] Error fetching comments:', error);
    return [];
  }
}

/**
 * Build threaded structure for comments and highlights
 */
function buildThreadedComments(events) {
  // Create a map of all events by ID
  const eventMap = new Map();
  for (const event of events) {
    eventMap.set(event.id, { ...event, children: [] });
  }
  
  // Build tree structure
  const rootEvents = [];
  const processed = new Set();
  
  for (const event of events) {
    if (processed.has(event.id)) continue;
    
    // Find parent via 'e' tag (NIP-22: lowercase 'e' for parent event)
    const parentETag = event.tags.find(([k]) => k === 'e');
    const parentEventId = parentETag?.[1];
    
    // Also check for 'a' tag (article reference) - might reference another comment/highlight
    const parentATag = event.tags.find(([k]) => k === 'a');
    let parentEvent = null;
    
    if (parentEventId && eventMap.has(parentEventId)) {
      parentEvent = eventMap.get(parentEventId);
    } else if (parentATag && parentATag[1]) {
      // Try to find parent by a-tag (format: kind:pubkey:identifier)
      const [kindStr, pubkey, identifier] = parentATag[1].split(':');
      if (kindStr && pubkey && identifier) {
        // Look for a comment/highlight with matching kind, pubkey, and d-tag
        for (const e of events) {
          if (e.kind === parseInt(kindStr, 10) && 
              e.pubkey === pubkey && 
              e.tags.find(([k]) => k === 'd')?.[1] === identifier) {
            parentEvent = eventMap.get(e.id);
            break;
          }
        }
      }
    }
    
    if (parentEvent && parentEvent.id !== event.id) {
      // Add as child of parent
      parentEvent.children.push(eventMap.get(event.id));
      processed.add(event.id);
    } else {
      // Root level comment/highlight
      rootEvents.push(eventMap.get(event.id));
      processed.add(event.id);
    }
  }
  
  // Sort by created_at
  const sortByDate = (a, b) => a.created_at - b.created_at;
  rootEvents.sort(sortByDate);
  for (const event of eventMap.values()) {
    if (event.children.length > 0) {
      event.children.sort(sortByDate);
    }
  }
  
  return rootEvents;
}

/**
 * Generate EPUB viewer HTML with EPUB.js
 */
function generateEPUBViewerHTML(title, author, epubDataUri, naddr) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)} - EPUB Reader</title>
  <style>${getEPUBViewerStyles()}</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="book-info">${escapeHtml(author || 'Unknown Author')}</div>
    </div>
    <div class="actions">
      <a href="/?naddr=${encodeURIComponent(naddr)}">Back to Book</a>
      <a href="/view?naddr=${encodeURIComponent(naddr)}">View as HTML</a>
      <a href="/download?naddr=${encodeURIComponent(naddr)}&format=epub3">Download EPUB</a>
    </div>
  </div>
  
  <div class="viewer-container">
    <noscript>
      <div class="error" style="position: relative; transform: none; top: auto; left: auto; margin: 2em auto; max-width: 500px;">
        <h2>JavaScript Required</h2>
        <p>The EPUB viewer requires JavaScript to function. Please enable JavaScript in your browser, or download the EPUB file directly:</p>
        <p style="margin-top: 1em;">
          <a href="/download?naddr=${encodeURIComponent(naddr)}&format=epub3" style="display: inline-block; padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; border: 2px solid #000000;">Download EPUB</a>
        </p>
        <p style="margin-top: 1em;">
          <a href="/?naddr=${encodeURIComponent(naddr)}">← Back to Book</a>
        </p>
      </div>
    </noscript>
    <div id="loading" class="loading">
      <div class="loading-spinner"></div>
      <div>Loading EPUB...</div>
    </div>
    <div id="error" class="error" style="display: none;">
      <h2>Error Loading EPUB</h2>
      <p id="error-message"></p>
      <a href="/?naddr=${encodeURIComponent(naddr)}">Go back</a>
    </div>
    <div id="viewer"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js"></script>
  <script>
    (function() {
      const viewer = document.getElementById('viewer');
      const loading = document.getElementById('loading');
      const errorDiv = document.getElementById('error');
      const errorMessage = document.getElementById('error-message');
      
      // Initialize EPUB.js
      const book = ePub('${epubDataUri}');
      
      // Render the book
      const rendition = book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });
      
      // Handle errors
      book.ready.catch(function(err) {
        console.error('EPUB loading error:', err);
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
        errorMessage.textContent = err.message || 'Failed to load EPUB file';
      });
      
      // When book is ready, display it
      book.ready.then(function() {
        console.log('EPUB loaded successfully');
        return rendition.display();
      }).then(function() {
        console.log('EPUB rendered successfully');
        loading.style.display = 'none';
        
        // Add navigation controls
        setupNavigation(rendition, book);
      }).catch(function(err) {
        console.error('EPUB rendering error:', err);
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
        errorMessage.textContent = err.message || 'Failed to render EPUB';
      });
      
      // Navigation setup
      function setupNavigation(rendition, book) {
        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (e.key === 'ArrowLeft') {
              rendition.prev();
            } else {
              rendition.next();
            }
          }
        });
        
        // Touch/swipe navigation for mobile
        let touchStartX = 0;
        let touchEndX = 0;
        
        viewer.addEventListener('touchstart', function(e) {
          touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        viewer.addEventListener('touchend', function(e) {
          touchEndX = e.changedTouches[0].screenX;
          handleSwipe();
        }, { passive: true });
        
        function handleSwipe() {
          const swipeThreshold = 50;
          const diff = touchStartX - touchEndX;
          
          if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
              // Swipe left - next page
              rendition.next();
            } else {
              // Swipe right - previous page
              rendition.prev();
            }
          }
        }
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Format timestamp to readable date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate message box component for status/errors/warnings (no JavaScript required)
 */
function generateMessageBox(type, message, details = null) {
  const typeClass = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
  const icon = type === 'error' ? '⚠️' : type === 'warning' ? 'ℹ️' : 'ℹ️';
  
  let html = `
  <div class="message-box ${typeClass}">
    <div class="message-box-header">
      <span class="message-box-icon">${icon}</span>
      <strong class="message-box-title">${escapeHtml(type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Information')}</strong>
    </div>
    <div class="message-box-content">
      <p>${escapeHtml(message)}</p>`;
  
  if (details) {
    html += `
      <details class="message-box-details">
        <summary>Details</summary>
        <pre>${escapeHtml(typeof details === 'string' ? details : JSON.stringify(details, null, 2))}</pre>
      </details>`;
  }
  
  html += `
    </div>
  </div>`;
  
  return html;
}

/**
 * Generate error page with message box
 */
function generateErrorPage(title, errorMessage, details = null, backUrl = '/') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)}</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  <h1>${escapeHtml(title)}</h1>
  ${generateMessageBox('error', errorMessage, details)}
  <p style="margin-top: 2em;"><a href="${escapeHtml(backUrl)}">← Go back</a></p>
</body>
</html>`;
}

/**
 * Wrap HTML content with navigation header
 */
function wrapHTMLWithNavigation(htmlContent, title, author, naddr) {
  // Extract body content if HTML is complete, otherwise use content as-is
  let bodyContent = htmlContent;
  
  // Try to extract body content from complete HTML
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    bodyContent = bodyMatch[1];
  } else {
    // If no body tag, try to extract content after head
    const headMatch = htmlContent.match(/<\/head>([\s\S]*)/i);
    if (headMatch) {
      bodyContent = headMatch[1];
    }
  }
  
  // Build navigation header
  const navHeader = `
    <div style="background: white; border-bottom: 1px solid #ddd; padding: 1em; margin-bottom: 1em;">
      <div style="display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto;">
        <div>
          <h1 style="font-size: 1.2em; font-weight: 600; color: #000000; margin: 0;">${escapeHtml(title)}</h1>
          <div style="color: #1a1a1a; font-size: 0.9em; margin-top: 0.25em;">${escapeHtml(author || 'Unknown Author')}</div>
        </div>
        <div style="display: flex; gap: 0.5em;">
          <a href="/?naddr=${encodeURIComponent(naddr)}" style="padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000;">Back to Book</a>
          <a href="/view-epub?naddr=${encodeURIComponent(naddr)}" style="padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000;">View as EPUB</a>
        </div>
      </div>
    </div>
  `;
  
  // If HTML already has a body, inject navigation at the start
  if (htmlContent.match(/<body[^>]*>/i)) {
    return htmlContent.replace(/(<body[^>]*>)/i, `$1${navHeader}`);
  }
  
  // Otherwise, wrap in complete HTML structure
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)} - HTML View</title>
</head>
<body>
${navHeader}
<div style="max-width: 1200px; margin: 0 auto; padding: 1em;">
${bodyContent}
</div>
</body>
</html>`;
}

/**
 * Get consolidated CSS styles for all pages
 */
function getCommonStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; background: #ffffff; color: #000000; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 2px solid #000000; }
    nav a { margin-right: 1em; color: #0066cc; text-decoration: underline; }
    nav a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    a { color: #0066cc; text-decoration: underline; }
    a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    h1, h2, h3 { color: #000000; }
    button { padding: 0.5em 1em; font-size: 1em; background: #000000; color: #ffffff; border: 2px solid #000000; cursor: pointer; font-weight: bold; }
    button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    input[type="text"] { padding: 0.5em; font-size: 1em; border: 2px solid #000000; border-radius: 4px; color: #000000; background: #ffffff; }
    input[type="text"]:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    textarea { padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; background: #ffffff; color: #000000; }
    textarea:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    select { padding: 0.5em; font-size: 1em; border: 2px solid #000000; border-radius: 4px; background: #ffffff; color: #000000; }
    select:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .book-result { margin: 1.5em 0; padding: 1em; border: 2px solid #000000; border-radius: 4px; background: #ffffff; }
    .book-title { font-size: 1.2em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #1a1a1a; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 0.5em; display: flex; flex-wrap: wrap; gap: 1em; align-items: center; }
    .book-header { margin-bottom: 2em; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .view-buttons { display: flex; gap: 0.5em; }
    .view-buttons a { display: inline-block; padding: 0.5em 1em; color: #ffffff; background: #000000; text-decoration: none; border-radius: 4px; border: 2px solid #000000; }
    .view-buttons a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .download-section { display: flex; gap: 0.5em; align-items: center; }
    .download-section label { font-weight: bold; color: #000000; }
    .download-section button { padding: 0.5em 1em; color: #ffffff; background: #000000; border: 2px solid #000000; cursor: pointer; border-radius: 4px; font-weight: bold; }
    .download-section button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .message-box { margin: 1em 0; padding: 1em; border-radius: 4px; border-left: 4px solid; }
    .message-box.error { background: #ffffff; border-color: #cc0000; color: #000000; border: 2px solid #cc0000; }
    .message-box.warning { background: #ffffff; border-color: #cc6600; color: #000000; border: 2px solid #cc6600; }
    .message-box.info { background: #ffffff; border-color: #0066cc; color: #000000; border: 2px solid #0066cc; }
    .message-box-header { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; }
    .message-box-icon { font-size: 1.2em; }
    .message-box-title { font-size: 1.1em; font-weight: bold; }
    .message-box-content p { margin: 0; color: #000000; }
    .message-box-details { margin-top: 0.5em; }
    .message-box-details summary { cursor: pointer; font-weight: bold; margin-bottom: 0.5em; color: #000000; }
    .message-box-details summary:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .message-box-details pre { background: #f0f0f0; border: 1px solid #000000; padding: 0.5em; border-radius: 3px; overflow-x: auto; font-size: 0.9em; color: #000000; }
    .error { color: #000000; margin: 1em 0; padding: 1em; background: #ffffff; border: 2px solid #cc0000; }
    .no-results { color: #1a1a1a; font-style: italic; margin: 2em 0; text-align: center; }
    .no-comments { color: #1a1a1a; font-style: italic; margin: 1em 0; }
    .info { color: #1a1a1a; margin: 1em 0; }
    .comment, .highlight { margin: 1.5em 0; padding: 1em; border-left: 4px solid #000000; background: #ffffff; border: 1px solid #000000; }
    .highlight { border-left-color: #cc6600; border-color: #cc6600; }
    .comment-author, .highlight-author { font-weight: bold; color: #000000; margin-bottom: 0.5em; }
    .comment-date, .highlight-date { color: #1a1a1a; font-size: 0.85em; }
    .comment-content, .highlight-content { margin-top: 0.5em; white-space: pre-wrap; word-wrap: break-word; color: #000000; }
    .comment-type.comment { background: #ffffff; border: 2px solid #0066cc; color: #000000; }
    .comment-type.highlight { background: #ffffff; border: 2px solid #cc6600; color: #000000; }
    .comment-type { display: inline-block; padding: 0.2em 0.5em; font-size: 0.75em; border-radius: 3px; margin-left: 0.5em; }
    .thread-reply { margin-left: 2em; margin-top: 1em; border-left: 2px solid #ccc; padding-left: 1em; }
    .thread-reply .comment, .thread-reply .highlight { border-left-width: 2px; }
    .comments-section { margin-top: 2em; }
    .status-section { margin: 1em 0; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .status-section h2 { margin-top: 0; color: #000000; }
    .status-item { margin: 0.5em 0; color: #000000; }
    .status-label { font-weight: bold; display: inline-block; width: 200px; }
    .results-header { margin: 1.5em 0; }
  `;
}

/**
 * Get table-specific styles
 */
function getTableStyles() {
  return `
    table { width: 100%; border-collapse: collapse; margin-top: 1em; border: 2px solid #000000; }
    th, td { padding: 0.75em; text-align: left; border-bottom: 1px solid #000000; border-right: 1px solid #000000; }
    th { background: #000000; color: #ffffff; font-weight: bold; }
    th a { color: #ffffff; text-decoration: underline; }
    th a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    td { background: #ffffff; color: #000000; }
    .book-link { color: #0066cc; text-decoration: underline; }
    .book-link:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .book-author { color: #1a1a1a; font-size: 0.9em; }
    .book-date { color: #1a1a1a; font-size: 0.85em; white-space: nowrap; }
    .pagination { margin-top: 2em; text-align: center; }
    .pagination a, .pagination span { display: inline-block; padding: 0.5em 1em; margin: 0 0.25em; text-decoration: underline; border: 2px solid #000000; border-radius: 4px; color: #0066cc; }
    .pagination a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .pagination .current { background: #000000; color: #ffffff; border-color: #000000; }
    .pagination .disabled { color: #4a4a4a; cursor: not-allowed; pointer-events: none; }
    .expand-button { margin: 1em 0; padding: 0.75em 1.5em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-size: 1em; text-decoration: none; display: inline-block; font-weight: bold; }
    .expand-button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .controls { margin: 1em 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1em; }
    .loading { text-align: center; color: #000000; padding: 2em; }
    .book-count { color: #1a1a1a; margin-bottom: 1em; }
  `;
}

/**
 * Get EPUB viewer-specific styles
 */
function getEPUBViewerStyles() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #ffffff; color: #000000; height: 100vh; display: flex; flex-direction: column; }
    .header { background: #ffffff; border-bottom: 2px solid #000000; padding: 1em; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .header h1 { font-size: 1.2em; font-weight: 600; color: #000000; margin: 0; }
    .header .book-info { color: #1a1a1a; font-size: 0.9em; }
    .header .actions { display: flex; gap: 0.5em; }
    .header .actions a { padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000; }
    .header .actions a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .viewer-container { flex: 1; overflow: hidden; position: relative; background: white; }
    #viewer { width: 100%; height: 100%; border: none; }
    .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #000000; }
    .loading-spinner { border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1em; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .error { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #000000; padding: 2em; background: #ffffff; border: 3px solid #cc0000; border-radius: 8px; max-width: 500px; }
    .error h2 { margin-bottom: 0.5em; color: #cc0000; }
    .error a { color: #0066cc; text-decoration: underline; margin-top: 1em; display: inline-block; }
    .error a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    @media (max-width: 768px) {
      .header { flex-direction: column; align-items: flex-start; gap: 0.5em; }
      .header .actions { width: 100%; flex-direction: column; }
      .header .actions a { text-align: center; }
    }
  `;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text
 */
function truncate(text, maxLength = 200) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Calculate approximate size of an object in bytes
 */
function calculateObjectSize(obj) {
  if (obj === null || obj === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch (e) {
    // Fallback: estimate based on string representation
    return String(obj).length * 2; // Rough estimate: 2 bytes per character
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Calculate total cache size
 */
function calculateCacheSize() {
  let totalBytes = 0;
  const sizes = {
    bookList: 0,
    topLevelBooks: 0,
    bookDetails: 0,
    bookHierarchy: 0,
    bookComments: 0,
    searchResults: 0,
    generatedFiles: 0
  };
  
  // Calculate size of Maps
  for (const [key, map] of Object.entries(cache)) {
    if (map instanceof Map) {
      let mapSize = 0;
      for (const [mapKey, value] of map.entries()) {
        mapSize += calculateObjectSize(mapKey);
        mapSize += calculateObjectSize(value);
      }
      if (key === 'bookList') sizes.bookList = mapSize;
      else if (key === 'topLevelBooks') sizes.topLevelBooks = mapSize;
      else if (key === 'bookDetails') sizes.bookDetails = mapSize;
      else if (key === 'bookHierarchy') sizes.bookHierarchy = mapSize;
      else if (key === 'bookComments') sizes.bookComments = mapSize;
      else if (key === 'searchResults') sizes.searchResults = mapSize;
      else if (key === 'generatedFiles') sizes.generatedFiles = mapSize;
      totalBytes += mapSize;
    } else if (typeof map === 'object' && map !== null) {
      // For objects like bookList, topLevelBooks
      const objSize = calculateObjectSize(map);
      if (key === 'bookList') sizes.bookList = objSize;
      else if (key === 'topLevelBooks') sizes.topLevelBooks = objSize;
      totalBytes += objSize;
    }
  }
  
  return { total: totalBytes, sizes };
}

/**
 * Handle HTTP request
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS headers for e-paper readers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle POST requests for cache clearing
  if (req.method === 'POST' && url.pathname === '/clear-cache') {
    // Clear all caches
    cache.bookList = { data: null, timestamp: 0, limit: 0, showAll: false };
    cache.topLevelBooks = { data: null, timestamp: 0, limit: 0 };
    cache.bookDetails.clear();
    cache.bookHierarchy.clear();
    cache.bookComments.clear();
    cache.searchResults.clear();
    cache.generatedFiles.clear();
    
    console.log('[Cache] All caches cleared');
    
    // Redirect back to status page with success message
    res.writeHead(302, { 'Location': '/status?cleared=1' });
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  // Handle favicon requests (both explicit and browser default)
  if (url.pathname === '/favicon_alex-catalogue.png' || url.pathname === '/favicon.ico') {
    try {
      const faviconPath = join(__dirname, '..', 'static', 'favicon_alex-catalogue.png');
      console.log(`[Favicon] Attempting to serve favicon from: ${faviconPath}`);
      const faviconData = readFileSync(faviconPath);
      console.log(`[Favicon] Successfully loaded favicon (${faviconData.length} bytes)`);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400' // Cache for 1 day
      });
      res.end(faviconData);
      return;
    } catch (error) {
      console.error('[Favicon] Error serving favicon:', error);
      console.error('[Favicon] Error details:', error.message);
      console.error('[Favicon] __dirname:', __dirname);
      console.error('[Favicon] Attempted path:', join(__dirname, '..', 'static', 'favicon_alex-catalogue.png'));
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Favicon not found');
      return;
    }
  }

  // Handle root - show book view with search
  if (url.pathname === '/' || url.pathname === '') {
    const query = url.searchParams.get('naddr') || url.searchParams.get('q') || url.searchParams.get('d');
    const searchType = url.searchParams.get('type'); // 'naddr', 'd', or auto-detect
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    
    // If query provided, process it
    if (query) {
      // Auto-detect if it's a naddr or d tag
      let isNaddrQuery = false;
      if (searchType === 'naddr') {
        isNaddrQuery = true;
      } else if (searchType === 'd') {
        isNaddrQuery = false;
      } else {
        isNaddrQuery = isNaddr(query);
      }
      
      // If it's a d tag search, show multiple results
      if (!isNaddrQuery) {
        try {
          const showCustomRelays = url.searchParams.get('show_custom_relays') === '1';
          console.log(`[Search] Searching for books with query: ${query}`);
          if (customRelays && customRelays.length > 0) {
            console.log(`[Search] Using custom relays: ${customRelays.join(', ')}`);
          }
          // Use fuzzy search instead of exact d-tag match
          // Fetch more books (500) to have better search coverage
          const books = await searchBooks(query, 500, customRelays && customRelays.length > 0 ? customRelays : undefined);
          
          // Sort by created_at (newest first)
          books.sort((a, b) => b.created_at - a.created_at);
          
          // Determine which relays are being used
          const relaysUsed = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
          const isCustomRelays = customRelays && customRelays.length > 0;
          
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          
          let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Search Results - Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="results-header">
    <h2>Search Results for: "${escapeHtml(query)}"</h2>
    <p>Found ${books.length} book${books.length !== 1 ? 's' : ''} matching your search:</p>
    <div style="margin-top: 0.5em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
      <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
      <br><span style="color: #1a1a1a; font-size: 0.85em;">(${isCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
      ${!showCustomRelays && !isCustomRelays ? `<br><a href="/?naddr=${encodeURIComponent(query)}&show_custom_relays=1" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
    </div>
    ${showCustomRelays || isCustomRelays ? `
    <form method="GET" action="/" style="margin-top: 1em; padding: 1em; background: #f5f5f5; border-radius: 4px;">
      <input type="hidden" name="naddr" value="${escapeHtml(query)}">
      <label for="relays-input-search" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #000000;">Custom Relays:</label>
      <p style="font-size: 0.9em; color: #1a1a1a; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
      <textarea id="relays-input-search" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; box-sizing: border-box; background: #ffffff; color: #000000;"></textarea>
      <div style="margin-top: 0.5em;">
        <button type="submit" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-size: 0.9em; font-weight: bold;">Update Search</button>
        <a href="/?naddr=${encodeURIComponent(query)}" style="color: #1a1a1a; text-decoration: underline; font-size: 0.9em; margin-left: 1em;">Cancel</a>
      </div>
    </form>
    ` : ''}
  </div>
`;

          if (books.length === 0) {
            html += '<p class="no-results">No books found with this d tag.</p>';
          } else {
            for (const book of books) {
              const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                           book.tags.find(([k]) => k === 'T')?.[1] ||
                           'Untitled';
              const author = book.tags.find(([k]) => k === 'author')?.[1] || 
                            nip19.npubEncode(book.pubkey).substring(0, 16) + '...';
              const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
              const date = formatDate(book.created_at);
              
              // Extract metadata
              const version = book.tags.find(([k]) => k === 'version')?.[1];
              const description = book.tags.find(([k]) => k === 'description')?.[1];
              const summary = book.tags.find(([k]) => k === 'summary')?.[1];
              const published_on = book.tags.find(([k]) => k === 'published_on')?.[1];
              
              // Generate naddr
              let naddr = '';
              try {
                naddr = nip19.naddrEncode({
                  kind: book.kind,
                  pubkey: book.pubkey,
                  identifier: identifier
                });
              } catch (e) {
                console.error('[Search] Error encoding naddr:', e);
                continue;
              }
              
              html += `
  <div class="book-result">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      ${author ? `Author: ${escapeHtml(author)}<br>` : ''}
      ${version ? `Version: ${escapeHtml(version)}<br>` : ''}
      ${published_on ? `Published: ${escapeHtml(published_on)}<br>` : ''}
      Created: ${date}<br>
      ${description ? `<div style="margin-top: 0.5em; font-style: italic; font-size: 0.9em;">${escapeHtml(description)}</div>` : ''}
      ${summary ? `<div style="margin-top: 0.5em; font-size: 0.9em;">${escapeHtml(summary)}</div>` : ''}
    </div>
    <div class="book-actions">
      <div class="view-buttons">
        <a href="/?naddr=${encodeURIComponent(naddr)}">View Details</a>
      </div>
    </div>
  </div>
`;
            }
          }
          
          html += `</body>
</html>
`;
          
          res.end(html);
        } catch (error) {
          console.error('[Search] Error:', error);
          const errorMsg = error?.message || String(error);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Error - Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="error">
    <h2>Error</h2>
    <p>${escapeHtml(errorMsg)}</p>
  </div>
</body>
</html>
          `);
        }
        return;
      }
      
      // It's a naddr, show single book
      const naddr = query;
      try {
        console.log(`[Book View] Request received for naddr: ${naddr}`);
        if (customRelays && customRelays.length > 0) {
          console.log(`[Book View] Using custom relays: ${customRelays.join(', ')}`);
        }
        
        // Fetch the book event
        const bookEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
        console.log(`[Book View] Found book event: ${bookEvent.id}`);

        // Build book hierarchy to check if there's content (with caching)
        // Normalize cache key: handle null, undefined, empty array consistently
        const relayKey = (customRelays && customRelays.length > 0) ? customRelays.sort().join(',') : 'default';
        const hierarchyCacheKey = `${naddr}:${relayKey}`;
        let hierarchy;
        const cachedHierarchy = cache.bookHierarchy.get(hierarchyCacheKey);
        if (cachedHierarchy && (Date.now() - cachedHierarchy.timestamp) < CACHE_TTL.BOOK_DETAIL) {
          console.log(`[Book View] Using cached hierarchy for: ${naddr}`);
          hierarchy = cachedHierarchy.data;
        } else {
          console.log(`[Book View] Building book hierarchy to check for content...`);
          hierarchy = await buildBookEventHierarchy(bookEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
          cache.bookHierarchy.set(hierarchyCacheKey, {
            data: hierarchy,
            timestamp: Date.now()
          });
          // Limit cache size (keep last 100 hierarchies)
          if (cache.bookHierarchy.size > 100) {
            const firstKey = cache.bookHierarchy.keys().next().value;
            cache.bookHierarchy.delete(firstKey);
          }
        }
        const hasContent = hierarchy.length > 0;
        console.log(`[Book View] Book has content: ${hasContent} (${hierarchy.length} top-level nodes)`);

        // Fetch comments and highlights (with caching)
        // Use same normalized cache key
        const commentsCacheKey = hierarchyCacheKey; // Same key as hierarchy since they use same relays
        let allItems;
        const cachedComments = cache.bookComments.get(commentsCacheKey);
        if (cachedComments && (Date.now() - cachedComments.timestamp) < CACHE_TTL.BOOK_DETAIL) {
          console.log(`[Book View] Using cached comments/highlights for: ${naddr}`);
          allItems = cachedComments.data;
        } else {
          console.log(`[Book View] Fetching comments and highlights...`);
          // Comments are only for the root 30040 event, highlights are for all events in hierarchy
          allItems = await fetchComments(bookEvent, hierarchy, customRelays && customRelays.length > 0 ? customRelays : null);
          cache.bookComments.set(commentsCacheKey, {
            data: allItems,
            timestamp: Date.now()
          });
          // Limit cache size (keep last 100 comment sets)
          if (cache.bookComments.size > 100) {
            const firstKey = cache.bookComments.keys().next().value;
            cache.bookComments.delete(firstKey);
          }
        }
        console.log(`[Book View] Found ${allItems.length} comments and highlights`);

        // Separate comments and highlights
        const comments = allItems.filter(e => e.kind === 1111);
        const highlights = allItems.filter(e => e.kind === 9802);
        
        // Build threaded structure for comments
        const threadedComments = buildThreadedComments(comments);
        
        // Group highlights by pubkey, then build threaded structure for replies
        const highlightsByPubkey = new Map();
        for (const highlight of highlights) {
          if (!highlightsByPubkey.has(highlight.pubkey)) {
            highlightsByPubkey.set(highlight.pubkey, []);
          }
          highlightsByPubkey.get(highlight.pubkey).push(highlight);
        }
        
        // For each pubkey group, build threaded structure (for replies to highlights)
        const groupedHighlights = [];
        for (const [pubkey, pubkeyHighlights] of highlightsByPubkey.entries()) {
          const threaded = buildThreadedComments(pubkeyHighlights);
          groupedHighlights.push({
            pubkey: pubkey,
            highlights: threaded
          });
        }
        
        // Sort groups by first highlight's created_at
        groupedHighlights.sort((a, b) => {
          const aFirst = a.highlights[0]?.created_at || 0;
          const bFirst = b.highlights[0]?.created_at || 0;
          return aFirst - bFirst;
        });
        
        // Count comments and highlights separately
        const commentCount = comments.length;
        const highlightCount = highlights.length;

        // Extract all metadata
        const title = bookEvent.tags.find(([k]) => k === 'title')?.[1] || 
                     bookEvent.tags.find(([k]) => k === 'T')?.[1] ||
                     'Untitled';
        const author = bookEvent.tags.find(([k]) => k === 'author')?.[1] || 
                      nip19.npubEncode(bookEvent.pubkey).substring(0, 16) + '...';
        const date = formatDate(bookEvent.created_at);
        
        // Fetch user handle for pubkey display
        const userHandle = await fetchUserHandle(bookEvent.pubkey, customRelays && customRelays.length > 0 ? customRelays : null);
        
        // Extract all metadata tags
        const npub = nip19.npubEncode(bookEvent.pubkey);
        const npubDisplay = npub.substring(0, 20) + '...';
        const pubkeyDisplay = userHandle ? `${npubDisplay} (${escapeHtml(userHandle)})` : npubDisplay;
        
        const metadata = {
          title: bookEvent.tags.find(([k]) => k === 'title')?.[1] || bookEvent.tags.find(([k]) => k === 'T')?.[1] || null,
          author: bookEvent.tags.find(([k]) => k === 'author')?.[1] || null,
          version: bookEvent.tags.find(([k]) => k === 'version')?.[1] || null,
          description: bookEvent.tags.find(([k]) => k === 'description')?.[1] || null,
          summary: bookEvent.tags.find(([k]) => k === 'summary')?.[1] || null,
          published_on: bookEvent.tags.find(([k]) => k === 'published_on')?.[1] || null,
          image: bookEvent.tags.find(([k]) => k === 'image')?.[1] || null,
          d: bookEvent.tags.find(([k]) => k === 'd')?.[1] || null,
          created_at: formatDate(bookEvent.created_at),
          pubkey: pubkeyDisplay,
          event_id: bookEvent.id
        };
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)}</title>
  <style>
    .book-title { font-size: 1.5em; }
    .book-actions { margin-top: 1em; }
    ${getCommonStyles()}
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="book-header">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      ${metadata.author ? `Author: ${escapeHtml(metadata.author)}<br>` : ''}
      ${metadata.version ? `Version: ${escapeHtml(metadata.version)}<br>` : ''}
      ${metadata.published_on ? `Published: ${escapeHtml(metadata.published_on)}<br>` : ''}
      Created: ${metadata.created_at}<br>
      ${metadata.description ? `<div style="margin-top: 0.5em; font-style: italic;">${escapeHtml(metadata.description)}</div>` : ''}
      ${metadata.summary ? `<div style="margin-top: 0.5em;">${escapeHtml(metadata.summary)}</div>` : ''}
      ${metadata.image ? `<div style="margin-top: 0.5em;"><img src="${escapeHtml(metadata.image)}" alt="Cover" style="max-width: 200px; max-height: 300px; border: 1px solid #ddd; border-radius: 4px;"></div>` : ''}
      <div style="margin-top: 0.5em; font-size: 0.85em; color: #4a4a4a;">
        Event ID: ${escapeHtml(metadata.event_id.substring(0, 16))}...<br>
        Pubkey: ${metadata.pubkey}<br>
        ${metadata.d ? `D-tag: ${escapeHtml(metadata.d)}<br>` : ''}
      </div>
    </div>
    ${hasContent ? `
    <div class="book-actions">
      <div class="view-buttons">
        <a href="/view?naddr=${encodeURIComponent(naddr)}">View as HTML</a>
        <a href="/view-epub?naddr=${encodeURIComponent(naddr)}">View as EPUB</a>
      </div>
      <div class="download-section">
        <form method="GET" action="/download" style="display: flex; gap: 0.5em; align-items: center;">
          <input type="hidden" name="naddr" value="${encodeURIComponent(naddr)}">
          <label for="download-format-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}">Download as:</label>
          <select id="download-format-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}" name="format" required>
            <option value="epub3">EPUB3</option>
            <option value="pdf">PDF</option>
            <option value="html5">HTML5</option>
            <option value="docbook5">DocBook5</option>
            <option value="asciidoc">AsciiDoc</option>
            <optgroup label="Recommended for Kindle">
              <option value="mobi">MOBI</option>
              <option value="azw3">AZW3</option>
            </optgroup>
            <option value="jsonl">JSONL</option>
          </select>
          <button type="submit">Download File</button>
        </form>
      </div>
    </div>
    ` : `
    <div style="margin-top: 1em; padding: 1em; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; color: #856404;">
      <strong>Library Index Card</strong><br>
      This book entry has no content yet. It may be under copyright or not yet imported. Comments and highlights are still available below.
    </div>
    `}
  </div>
  
  <div class="comments-section">
    <h2>Comments & Highlights (${commentCount} comments, ${highlightCount} highlights)</h2>
`;

        // Fetch handles for all unique pubkeys
        const uniquePubkeys = new Set();
        const collectPubkeys = (items) => {
          for (const item of items) {
            uniquePubkeys.add(item.pubkey);
            if (item.children && item.children.length > 0) {
              collectPubkeys(item.children);
            }
          }
        };
        collectPubkeys(threadedComments);
        for (const group of groupedHighlights) {
          collectPubkeys(group.highlights);
        }
        
        const handleMap = new Map();
        const handlePromises = Array.from(uniquePubkeys).map(async (pubkey) => {
          const handle = await fetchUserHandle(pubkey, customRelays && customRelays.length > 0 ? customRelays : null);
          handleMap.set(pubkey, handle);
        });
        await Promise.all(handlePromises);
        
        // Recursive function to render threaded items (for comments and replies to highlights)
        const renderItem = (item, depth = 0) => {
          const isHighlight = item.kind === 9802;
          const itemClass = isHighlight ? 'highlight' : 'comment';
          const authorClass = isHighlight ? 'highlight-author' : 'comment-author';
          const dateClass = isHighlight ? 'highlight-date' : 'comment-date';
          const contentClass = isHighlight ? 'highlight-content' : 'comment-content';
          
          // Format author with npub and handle
          const npub = nip19.npubEncode(item.pubkey);
          const npubDisplay = npub.substring(0, 20) + '...';
          const handle = handleMap.get(item.pubkey);
          const authorDisplay = handle ? `${npubDisplay} (${escapeHtml(handle)})` : npubDisplay;
          
          const date = formatDate(item.created_at);
          const content = escapeHtml(truncate(item.content || '', 1000));
          const typeLabel = isHighlight ? 'Highlight' : 'Comment';
          
          let itemHtml = `
    <div class="${itemClass}"${depth > 0 ? ' style="margin-left: ' + (depth * 2) + 'em;"' : ''}>
      <div class="${authorClass}">
        ${escapeHtml(authorDisplay)}
        <span class="comment-type ${itemClass}">${typeLabel}</span>
      </div>
      <div class="${dateClass}">${date}</div>
      <div class="${contentClass}">${content}</div>
`;
          
          // Render children (replies)
          if (item.children && item.children.length > 0) {
            itemHtml += '      <div class="thread-replies">\n';
            for (const child of item.children) {
              itemHtml += renderItem(child, depth + 1);
            }
            itemHtml += '      </div>\n';
          }
          
          itemHtml += '    </div>\n';
          return itemHtml;
        };
        
        // Render comments (threaded)
        if (threadedComments.length > 0) {
          html += '<div class="comments-group" style="margin-bottom: 2em;">';
          html += '<h3 style="font-size: 1.1em; font-weight: 600; margin-bottom: 1em; color: #000000;">Comments</h3>';
          for (const comment of threadedComments) {
            html += renderItem(comment);
          }
          html += '</div>';
        }
        
        // Render highlights (grouped by pubkey, with replies threaded)
        if (groupedHighlights.length > 0) {
          html += '<div class="highlights-group" style="margin-bottom: 2em;">';
          html += '<h3 style="font-size: 1.1em; font-weight: 600; margin-bottom: 1em; color: #000000;">Highlights</h3>';
          for (const group of groupedHighlights) {
            const npub = nip19.npubEncode(group.pubkey);
            const npubDisplay = npub.substring(0, 20) + '...';
            const handle = handleMap.get(group.pubkey);
            const authorDisplay = handle ? `${npubDisplay} (${escapeHtml(handle)})` : npubDisplay;
            
            html += `<div class="highlight-group" style="margin-bottom: 1.5em; padding: 1em; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #28a745;">`;
            html += `<div style="font-weight: 600; margin-bottom: 0.5em; color: #000000;">${escapeHtml(authorDisplay)}</div>`;
            for (const highlight of group.highlights) {
              html += renderItem(highlight);
            }
            html += '</div>';
          }
          html += '</div>';
        }
        
        if (threadedComments.length === 0 && groupedHighlights.length === 0) {
          html += '<p class="no-comments">No comments or highlights yet.</p>';
        }
        
        html += `
  </div>
</body>
</html>
`;
        
        res.end(html);
      } catch (error) {
        console.error('[Book View] Error:', error);
        const errorMsg = error?.message || String(error);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Error</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="error">
    <h2>Error</h2>
    <p>${escapeHtml(errorMsg)}</p>
  </div>
</body>
</html>
        `);
      }
      return;
    }
    
    // No naddr - show search form
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
    
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="naddr1... or d tag..." required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  <div style="margin-top: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
    <strong>Default relays:</strong> ${DEFAULT_RELAYS.map(r => escapeHtml(r)).join(', ')}
    ${url.searchParams.get('show_custom_relays') !== '1' ? `<br><a href="/?show_custom_relays=1" style="color: #007bff; text-decoration: none; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
  </div>
  ${url.searchParams.get('show_custom_relays') === '1' ? `
  <form method="GET" action="/" style="margin-top: 1em; padding: 1em; background: #f5f5f5; border-radius: 4px;">
    <label for="relays-input-home" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #000000;">Custom Relays:</label>
    <p style="font-size: 0.9em; color: #1a1a1a; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
    <textarea id="relays-input-home" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; box-sizing: border-box; background: #ffffff; color: #000000;"></textarea>
    <div style="margin-top: 0.5em;">
      <button type="submit" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-size: 0.9em; font-weight: bold;">Save Relays</button>
      <a href="/" style="color: #1a1a1a; text-decoration: underline; font-size: 0.9em; margin-left: 1em;">Cancel</a>
    </div>
  </form>
  ` : ''}
  
  <details style="max-width: 800px; margin: 2em auto;">
    <summary style="cursor: pointer; padding: 1em; background: #ffffff; border-radius: 8px; border-left: 4px solid #0066cc; border: 2px solid #000000; font-weight: bold; color: #000000; user-select: none;">
      How It Works
    </summary>
    <div class="info" style="padding: 1.5em; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff; margin-top: 0.5em;">
     <p style="margin-bottom: 1em; line-height: 1.6;">The Alexandria Catalogue is an e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>, a Nostr-based publishing platform. It allows you to browse, search, and download books (kind 30040 events) in various formats optimized for e-paper readers.</p>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Searching for Books</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">You can search for books using several methods:</p>
    <ul style="line-height: 1.8; margin-left: 1.5em;">
      <li><strong>Event Identifiers:</strong> Enter any Nostr event identifier to find a specific book:
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>naddr</strong> (e.g., <code>naddr1qq...</code>): Nostr address - the most precise identifier for a book, includes kind, author, and d tag</li>
          <li><strong>nevent</strong> (e.g., <code>nevent1qq...</code>): Event reference with optional author hint</li>
          <li><strong>note</strong> (e.g., <code>note1qq...</code>): Simple event ID reference</li>
          <li><strong>Hex Event ID:</strong> A 64-character hexadecimal event ID</li>
        </ul>
      </li>
      <li><strong>Book Metadata:</strong> Search by book information:
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>Title:</strong> Search by book title (searches in both "title" and "T" tags)</li>
          <li><strong>d tag identifier:</strong> Enter a d tag (book identifier) to find all books with that identifier. If multiple authors have published books with the same d tag, all will be shown</li>
          <li><strong>Collection:</strong> Search within publication/book collections (searches in "C" tags)</li>
        </ul>
      </li>
      <li><strong>Author search:</strong> Search by author name (e.g., "Charlotte Bronte" or "Charlotte Brontë" - both will match). The search handles accented characters and matches both exact and normalized versions.</li>
      <li><strong>Pubkey search:</strong> Enter an npub (e.g., <code>npub1...</code>) or hex pubkey to find all books by that author or that reference that pubkey in "p" tags.</li>
    </ul>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Viewing and Downloading</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">Once you find a book, you can:</p>
    <ul style="line-height: 1.8; margin-left: 1.5em;">
      <li><strong>View as HTML:</strong> Read the book directly in your browser.</li>
      <li><strong>View as EPUB:</strong> Use the built-in EPUB.js viewer to read the book in your browser.</li>
      <li><strong>Download formats:</strong>
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>EPUB3:</strong> Standard EPUB format for most e-readers</li>
          <li><strong>PDF:</strong> Portable Document Format</li>
          <li><strong>HTML5:</strong> Standalone HTML file with embedded images</li>
          <li><strong>DocBook5:</strong> XML-based documentation format</li>
          <li><strong>MOBI/AZW3:</strong> Recommended for Kindle devices</li>
          <li><strong>AsciiDoc:</strong> Source format (.adoc file)</li>
          <li><strong>JSONL:</strong> Export all events in the book hierarchy as JSON Lines format</li>
        </ul>
      </li>
    </ul>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Browse Library</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">Visit the <a href="/books" style="color: #007bff; text-decoration: none;">Browse Library</a> page to see all available books. The library shows top-level books (not nested within other books) and supports pagination. You can expand to view up to 10,000 books.</p>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Custom Relays</h3>
    <p style="margin-bottom: 0; line-height: 1.6;">By default, the catalogue searches public Nostr relays. You can specify custom relays (ws:// or wss:// format) to search your local or private relays. Click "Use custom relays" in the relay information box to configure custom relays.</p>
    </div>
  </details>
</body>
</html>
    `);
    return;
  }

  // Handle view endpoint - render book as HTML
  if (url.pathname === '/view') {
    const naddr = url.searchParams.get('naddr');
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('Missing Parameter', 'Missing naddr parameter. Please provide a book naddr.', null, '/'));
      return;
    }

    try {
      console.log(`[HTML View] Request received for naddr: ${naddr}`);
      if (customRelays.length > 0) {
        console.log(`[HTML View] Using custom relays: ${customRelays.join(', ')}`);
      }
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[HTML View] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[HTML View] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[HTML View] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[HTML View] Combined content: ${content.length} chars`);

      // Generate HTML
      console.log(`[HTML View] Generating HTML...`);
      const htmlContent = await generateHTML(content, title, author);
      console.log(`[HTML View] HTML generated: ${htmlContent.length} chars`);

      // Wrap HTML content with navigation header
      const htmlWithNavigation = wrapHTMLWithNavigation(htmlContent, title, author, naddr);
      
      // Send HTML as response
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(htmlWithNavigation);
      
      console.log(`[HTML View] HTML sent successfully`);
    } catch (error) {
      console.error('[HTML View] Error:', error);
      const errorMsg = error?.message || String(error);
      const errorDetails = error?.stack || null;
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('HTML View Error', errorMsg, errorDetails, `/?naddr=${encodeURIComponent(naddr || '')}`));
    }
    return;
  }

  // Handle EPUB viewer endpoint (requires JavaScript for EPUB.js, but we'll keep it for now)
  if (url.pathname === '/view-epub') {
    const naddr = url.searchParams.get('naddr');
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('Missing Parameter', 'Missing naddr parameter. Please provide a book naddr.', null, '/'));
      return;
    }

    try {
      console.log(`[EPUB Viewer] Request received for naddr: ${naddr}`);
      if (customRelays.length > 0) {
        console.log(`[EPUB Viewer] Using custom relays: ${customRelays.join(', ')}`);
      }
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[EPUB Viewer] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[EPUB Viewer] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[EPUB Viewer] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[EPUB Viewer] Combined content: ${content.length} chars`);

      // Extract image tag if present
      const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];

      // Generate EPUB
      console.log(`[EPUB Viewer] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author, image);
      console.log(`[EPUB Viewer] EPUB generated: ${epubBlob.size} bytes`);

      // Convert to data URI for EPUB.js
      const arrayBuffer = await epubBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const epubDataUri = `data:application/epub+zip;base64,${base64}`;

      // Generate viewer HTML
      const viewerHTML = generateEPUBViewerHTML(title, author, epubDataUri, naddr);
      
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(viewerHTML);
      
      console.log(`[EPUB Viewer] Viewer page sent successfully`);
    } catch (error) {
      console.error('[EPUB Viewer] Error:', error);
      const errorMsg = error?.message || String(error);
      const errorDetails = error?.stack || null;
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('EPUB Viewer Error', errorMsg, errorDetails, `/?naddr=${encodeURIComponent(naddr || '')}`));
    }
    return;
  }

  // Handle EPUB viewer endpoint
  if (url.pathname === '/view-epub') {
    const naddr = url.searchParams.get('naddr');
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[EPUB Viewer] Request received for naddr: ${naddr}`);
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr);
      console.log(`[EPUB Viewer] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[EPUB Viewer] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent);
      console.log(`[EPUB Viewer] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[EPUB Viewer] Combined content: ${content.length} chars`);

      // Extract image tag if present
      const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];

      // Generate EPUB
      console.log(`[EPUB Viewer] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author, image);
      console.log(`[EPUB Viewer] EPUB generated: ${epubBlob.size} bytes`);

      // Convert blob to base64 data URI for embedding
      const epubArrayBuffer = await epubBlob.arrayBuffer();
      const epubBase64 = Buffer.from(epubArrayBuffer).toString('base64');
      const epubDataUri = `data:application/epub+zip;base64,${epubBase64}`;

      // Generate viewer HTML with EPUB.js
      const viewerHTML = generateEPUBViewerHTML(title, author, epubDataUri, naddr);

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(viewerHTML);
      
      console.log(`[EPUB Viewer] Viewer page sent successfully`);
    } catch (error) {
      console.error('[EPUB Viewer] Error:', error);
      const errorMsg = error?.message || String(error);
      const errorDetails = error?.stack || null;
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('EPUB Viewer Error', errorMsg, errorDetails, `/?naddr=${encodeURIComponent(naddr || '')}`));
    }
    return;
  }

  // Handle status endpoint - show server status and cache information
  if (url.pathname === '/status') {
    const cacheStats = {
      bookDetails: cache.bookDetails.size,
      bookHierarchy: cache.bookHierarchy.size,
      bookComments: cache.bookComments.size,
      searchResults: cache.searchResults.size,
      generatedFiles: cache.generatedFiles.size,
      topLevelBooks: cache.topLevelBooks.data ? cache.topLevelBooks.data.length : 0,
      topLevelBooksTimestamp: cache.topLevelBooks.timestamp ? new Date(cache.topLevelBooks.timestamp).toISOString() : null
    };
    
    // Calculate cache sizes
    const cacheSizes = calculateCacheSize();
    
    // Check if cache was just cleared
    const cacheCleared = url.searchParams.get('cleared') === '1';
    const successMessage = cacheCleared ? generateMessageBox('info', 'Cache cleared successfully! All cached data has been removed.', null) : '';
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Server Status - Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  <h1>Server Status</h1>
  ${successMessage}
  ${generateMessageBox('info', 'Server is running. Cache statistics below.', null)}
  <div class="status-section">
    <h2>Cache Statistics</h2>
    <div class="status-item"><span class="status-label">Cached Book Details:</span> ${cacheStats.bookDetails} entries (${formatBytes(cacheSizes.sizes.bookDetails || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Book Hierarchies:</span> ${cacheStats.bookHierarchy} entries (${formatBytes(cacheSizes.sizes.bookHierarchy || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Comments/Highlights:</span> ${cacheStats.bookComments} entries (${formatBytes(cacheSizes.sizes.bookComments || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Search Results:</span> ${cacheStats.searchResults} entries (${formatBytes(cacheSizes.sizes.searchResults || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Generated Files:</span> ${cacheStats.generatedFiles} entries (${formatBytes(cacheSizes.sizes.generatedFiles || 0)})</div>
    <div class="status-item"><span class="status-label">Top-Level Books Cached:</span> ${cacheStats.topLevelBooks} entries (${formatBytes(cacheSizes.sizes.topLevelBooks || 0)})</div>
    <div class="status-item"><span class="status-label">Book List Cache:</span> ${cache.bookList.data ? cache.bookList.data.length + ' entries' : 'empty'} (${formatBytes(cacheSizes.sizes.bookList || 0)})</div>
    ${cacheStats.topLevelBooksTimestamp ? `<div class="status-item"><span class="status-label">Last Updated:</span> ${cacheStats.topLevelBooksTimestamp}</div>` : ''}
    <div class="status-item" style="margin-top: 1em; padding-top: 1em; border-top: 2px solid #000000; font-weight: bold;"><span class="status-label">Total Cache Size:</span> ${formatBytes(cacheSizes.total)}</div>
  </div>
  <div class="status-section">
    <h2>Cache Configuration</h2>
    <div class="status-item"><span class="status-label">Book List Cache:</span> ${CACHE_TTL.BOOK_LIST / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Book Detail Cache:</span> ${CACHE_TTL.BOOK_DETAIL / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Search Results Cache:</span> ${CACHE_TTL.SEARCH_RESULTS / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Generated Files Cache:</span> ${CACHE_TTL.GENERATED_FILES / 60000} minutes</div>
  </div>
  <div class="status-section" style="margin-top: 2em; padding: 1em; background: #ffffff; border: 2px solid #cc0000; border-radius: 4px;">
    <h2 style="margin-top: 0; color: #000000;">Cache Management</h2>
    <p style="color: #000000; margin-bottom: 1em;">Clear all cached data. This will force the server to fetch fresh data from relays on the next request.</p>
    <form method="POST" action="/clear-cache" style="margin: 0;">
      <button type="submit" style="padding: 0.75em 1.5em; background: #cc0000; color: #ffffff; border: 2px solid #cc0000; border-radius: 4px; cursor: pointer; font-size: 1em; font-weight: bold;">Clear All Cache</button>
    </form>
  </div>
  <p style="margin-top: 2em;"><a href="/">← Go back</a></p>
</body>
</html>
    `);
    return;
  }

  // Handle generic download endpoint
  if (url.pathname === '/download') {
    const naddr = url.searchParams.get('naddr');
    const format = url.searchParams.get('format') || 'epub3';
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[Download] Request received for naddr: ${naddr}, format: ${format}`);
      if (customRelays.length > 0) {
        console.log(`[Download] Using custom relays: ${customRelays.join(', ')}`);
      }
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[Download] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[Download] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
      console.log(`[Download] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Handle JSONL format separately
      if (format === 'jsonl') {
        // Collect all events from hierarchy
        const allEvents = collectAllEventsFromHierarchy(indexEvent, hierarchy);
        console.log(`[Download] Collected ${allEvents.length} events for JSONL`);
        
        // Create JSONL content (one JSON object per line)
        const jsonlLines = allEvents.map(e => JSON.stringify(e));
        const jsonlContent = jsonlLines.join('\n');
        
        const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                      indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                      indexEvent.id.slice(0, 8);
        const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `${safeTitle}.jsonl`;
        const buffer = Buffer.from(jsonlContent, 'utf-8');
        
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buffer.length
        });
        res.end(buffer);
        
        console.log(`[Download] JSONL sent successfully`);
        return;
      }

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[Download] Combined content: ${content.length} chars`);
      
      // Extract cover image from indexEvent
      const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];

      // Handle AsciiDoc format separately - return the combined AsciiDoc content directly
      if (format === 'asciidoc' || format === 'adoc') {
        const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `${safeTitle}.adoc`;
        const buffer = Buffer.from(content, 'utf-8');
        
        res.writeHead(200, {
          'Content-Type': 'text/asciidoc',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buffer.length
        });
        res.end(buffer);
        
        console.log(`[Download] AsciiDoc sent successfully`);
        return;
      }

      // Check cache for generated file
      const cacheKey = `${naddr}:${format}`;
      let buffer, mimeType, extension;
      
      const cachedFile = cache.generatedFiles.get(cacheKey);
      if (cachedFile && (Date.now() - cachedFile.timestamp) < CACHE_TTL.GENERATED_FILES) {
        console.log(`[Download] Using cached ${format} file for: ${naddr}`);
        buffer = cachedFile.buffer;
        mimeType = cachedFile.mimeType;
        extension = cachedFile.extension;
      } else {
        // Generate file in requested format
        console.log(`[Download] Generating ${format}...`);
        const { blob, mimeType: mt, extension: ext } = await generateFile(content, title, author, format, image);
        console.log(`[Download] ${format} generated: ${blob.size} bytes`);

        // Convert blob to buffer
        const arrayBuffer = await blob.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        mimeType = mt;
        extension = ext;
        
        // Cache the generated file
        cache.generatedFiles.set(cacheKey, {
          buffer,
          mimeType,
          extension,
          timestamp: Date.now()
        });
        
        // Limit cache size (keep last 50 generated files)
        if (cache.generatedFiles.size > 50) {
          const firstKey = cache.generatedFiles.keys().next().value;
          cache.generatedFiles.delete(firstKey);
        }
      }

      // Determine filename
      const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `${safeTitle}.${extension}`;

      // Send file
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length
      });
      res.end(buffer);
      
      console.log(`[Download] ${format} sent successfully`);
    } catch (error) {
      console.error('[Download] Error:', error);
      const errorMsg = error?.message || String(error);
      const errorDetails = error?.stack || null;
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('Download Error', errorMsg, errorDetails, `/?naddr=${encodeURIComponent(naddr || '')}`));
    }
    return;
  }

  // Handle EPUB download endpoint (legacy, redirects to generic download)
  if (url.pathname === '/download-epub') {
    const naddr = url.searchParams.get('naddr');
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[EPUB Download] Request received for naddr: ${naddr}`);
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr);
      console.log(`[EPUB Download] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[EPUB Download] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent);
      console.log(`[EPUB Download] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[EPUB Download] Combined content: ${content.length} chars`);

      // Generate EPUB
      console.log(`[EPUB Download] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author);
      console.log(`[EPUB Download] EPUB generated: ${epubBlob.size} bytes`);

      // Send EPUB as download
      const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
      res.writeHead(200, {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': epubBlob.size
      });
      
      const buffer = Buffer.from(await epubBlob.arrayBuffer());
      res.end(buffer);
      
      console.log(`[EPUB Download] EPUB sent successfully`);
    } catch (error) {
      console.error('[EPUB Download] Error:', error);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      const errorMsg = error?.message || String(error);
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>${escapeHtml(errorMsg)}</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
    }
    return;
  }

  // Handle PDF download (legacy, redirects to generic download)
  if (url.pathname === '/download-pdf') {
    const naddr = url.searchParams.get('naddr');
    if (naddr) {
      res.writeHead(302, { 'Location': `/download?naddr=${encodeURIComponent(naddr)}&format=pdf` });
      res.end();
      return;
    }
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
    `);
    return;
  }

  // Handle books browse page - table/list of all 30040 indexes
  if (url.pathname === '/books') {
    try {
      // Parse query parameters
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);
      const showAll = url.searchParams.get('show_all') === '1';
      const showCustomRelays = url.searchParams.get('show_custom_relays') === '1';
      const relayInput = url.searchParams.get('relays') || '';
      const customRelays = parseRelayUrls(relayInput);
      const sortBy = url.searchParams.get('sort') || 'created';
      const sortOrder = url.searchParams.get('order') || 'desc';
      const itemsPerPage = 50; // Number of books per page
      
      console.log(`[Books] Fetching books list (page=${page}, limit=${limit}, showAll=${showAll})...`);
      if (customRelays && customRelays.length > 0) {
        console.log(`[Books] Using custom relays: ${customRelays.join(', ')}`);
      } else {
        console.log(`[Books] Using default relays: ${DEFAULT_RELAYS.join(', ')}`);
      }
      
      // Fetch books - use larger limit if showing all
      const fetchLimit = showAll ? 10000 : limit;
      
      // When expanding to 10k, always fetch fresh data to bypass any cached 200-limit results
      let allBooks;
      if (showAll) {
        console.log(`[Books] Expanding to 10k - fetching fresh data (bypassing cache)...`);
        allBooks = await fetchBooks(fetchLimit, customRelays && customRelays.length > 0 ? customRelays : undefined);
        // Cache the expanded results
        const cacheKey = `bookList_${fetchLimit}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
        setCached(cacheKey, allBooks);
        console.log(`[Books] Fetched ${allBooks.length} total books from relays`);
      } else {
        // Use cache for normal 200-limit requests
        const cacheKey = `bookList_${fetchLimit}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
        allBooks = getCached(cacheKey, 5 * 60 * 1000); // 5 minute cache
        
        if (!allBooks) {
          console.log(`[Books] Cache miss - fetching fresh data...`);
          allBooks = await fetchBooks(fetchLimit, customRelays && customRelays.length > 0 ? customRelays : undefined);
          setCached(cacheKey, allBooks);
          console.log(`[Books] Fetched ${allBooks.length} total books from relays`);
        } else {
          console.log(`[Books] Using cached data: ${allBooks.length} books`);
        }
      }
      
      // Filter to top-level books only (not nested)
      const topLevelBooks = filterTopLevelBooks(allBooks);
      console.log(`[Books] Filtered to ${topLevelBooks.length} top-level books`);
      
      // Sort by created_at (newest first)
      topLevelBooks.sort((a, b) => b.created_at - a.created_at);
      
      // Calculate pagination
      const totalBooks = topLevelBooks.length;
      const totalPages = Math.ceil(totalBooks / itemsPerPage);
      const currentPage = Math.max(1, Math.min(page, totalPages));
      const startIndex = (currentPage - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const paginatedBooks = topLevelBooks.slice(startIndex, endIndex);
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      
      let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Alexandria Catalogue - Browse Library</title>
  <style>
    body { max-width: 1200px; }
    input[type="text"] { width: 70%; margin-right: 0.5em; }
    .results-header { margin: 1.5em 0; }
    ${getCommonStyles()}
    ${getTableStyles()}
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue - Browse Library</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  <div style="margin-bottom: 1em; padding: 0.75em; background: #ffffff; border: 2px solid #0066cc; border-radius: 4px; font-size: 0.9em; color: #000000;">
    <strong>Relays used:</strong> ${(customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS).map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #1a1a1a; font-size: 0.85em;">(${customRelays && customRelays.length > 0 ? 'Custom relays' : 'Default relays'})</span>
    ${!showCustomRelays && !(customRelays && customRelays.length > 0) ? `<br><a href="/books?page=${page}&limit=${limit}&show_all=${showAll ? '1' : '0'}&show_custom_relays=1" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
  </div>
  ${showCustomRelays || (customRelays && customRelays.length > 0) ? `
  <form method="GET" action="/books" style="margin-bottom: 1em; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px;">
    <input type="hidden" name="page" value="${page}">
    <input type="hidden" name="limit" value="${limit}">
    <input type="hidden" name="show_all" value="${showAll ? '1' : '0'}">
    <label for="relays-input-books" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #000000;">Custom Relays:</label>
    <p style="font-size: 0.9em; color: #1a1a1a; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
      <textarea id="relays-input-books" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; box-sizing: border-box; background: #ffffff; color: #000000;"></textarea>
    <div style="margin-top: 0.5em;">
      <button type="submit" style="padding: 0.5em 1em; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Update Relays</button>
      <a href="/books?page=${page}&limit=${limit}&show_all=${showAll ? '1' : '0'}" style="color: #1a1a1a; text-decoration: underline; font-size: 0.9em; margin-left: 1em;">Cancel</a>
    </div>
  </form>
  ` : ''}
`;
      
      if (paginatedBooks.length === 0) {
        if (allBooks.length === 0) {
          // Test relay connectivity to provide better error information
          const relaysToTest = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
          console.log(`[Books] No books found, testing relay connectivity...`);
          const relayStatus = await testRelayConnectivity(relaysToTest);
          
          const connectedCount = relayStatus.filter(r => r.status === 'connected').length;
          const errorCount = relayStatus.filter(r => r.status === 'error').length;
          const timeoutCount = relayStatus.filter(r => r.status === 'timeout').length;
          
          let relayStatusHtml = '<div style="margin-top: 1em; padding: 1em; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">';
          relayStatusHtml += '<p style="margin-top: 0; font-weight: bold;">Relay Connection Status:</p>';
          relayStatusHtml += '<ul style="text-align: left; margin: 0.5em 0; padding-left: 1.5em;">';
          
          for (const status of relayStatus) {
            let icon = '❌';
            let color = '#dc3545';
            if (status.status === 'connected') {
              icon = '✓';
              color = '#28a745';
            } else if (status.status === 'timeout') {
              icon = '⏱';
              color = '#ffc107';
            }
            
            relayStatusHtml += `<li style="color: ${color}; margin: 0.3em 0;">
              ${icon} <strong>${escapeHtml(status.url)}</strong>
              ${status.status === 'connected' ? '(Connected)' : status.status === 'timeout' ? '(Timeout - no response)' : `(Error: ${escapeHtml(status.error || 'Unknown error')})`}
            </li>`;
          }
          
          relayStatusHtml += '</ul>';
          relayStatusHtml += `<p style="margin-top: 0.5em; font-size: 0.9em;">Summary: ${connectedCount} connected, ${timeoutCount} timeout, ${errorCount} error(s)</p>`;
          relayStatusHtml += '</div>';
          
          // Build retry URL with current parameters
          const retryParams = new URLSearchParams();
          retryParams.set('page', page.toString());
          retryParams.set('limit', limit.toString());
          if (showAll) retryParams.set('show_all', '1');
          if (customRelays && customRelays.length > 0) {
            retryParams.set('relays', customRelays.join(','));
          }
          const retryUrl = `/books?${retryParams.toString()}`;
          
          html += `<div class="loading" style="text-align: left; max-width: 600px; margin: 2em auto;">
            <p><strong>No books found on any relay.</strong></p>
            <p>This could mean:</p>
            <ul style="text-align: left;">
              <li>The relays are not responding</li>
              <li>The relays don't have any books (kind 30040)</li>
              <li>There was a connection error</li>
            </ul>
            ${relayStatusHtml}
            <div style="margin-top: 1.5em; text-align: center;">
              <a href="${retryUrl}" style="display: inline-block; padding: 0.75em 1.5em; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 1em;">Retry</a>
              <p style="margin-top: 1em; font-size: 0.9em; color: #1a1a1a;">Try using custom relays or check the server logs for errors.</p>
            </div>
          </div>`;
        } else {
          html += `<div class="loading">
            <p>Found ${allBooks.length} books, but none are top-level (all are nested within other books).</p>
            <p style="font-size: 0.9em; color: #1a1a1a; margin-top: 0.5em;">Try searching for a specific book using its naddr or d tag.</p>
          </div>`;
        }
      } else {
        html += `<div class="controls" style="margin: 1em 0; padding: 1em; background: #f5f5f5; border-radius: 4px;">
          <p class="book-count" style="margin: 0 0 0.5em 0;">Showing ${startIndex + 1}-${Math.min(endIndex, totalBooks)} of ${totalBooks} top-level books${showAll ? ' (expanded to 10,000)' : ''}</p>`;
        
        // Add expand button if not already showing all
        // Note: We show this button regardless of book count, since the initial fetch limit (200) 
        // is separate from pagination (50 per page), so users should always be able to expand
        if (!showAll) {
          html += `<div style="margin-top: 0.75em;">
            <a href="/books?page=1&limit=10000&show_all=1${customRelays && customRelays.length > 0 ? '&relays=' + encodeURIComponent(customRelays.join(',')) : ''}" style="display: inline-block; padding: 0.75em 1.5em; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Expand to 10,000 Books</a>
          </div>`;
        }
        
        html += `</div>`;
        
        // Build sort URLs for table headers
        const buildSortUrl = (column) => {
          const params = new URLSearchParams();
          params.set('page', '1'); // Reset to page 1 when sorting
          params.set('limit', limit.toString());
          if (showAll) params.set('show_all', '1');
          if (customRelays && customRelays.length > 0) {
            params.set('relays', customRelays.join(','));
          }
          // Toggle sort order if clicking the same column, otherwise default to asc
          if (sortBy === column) {
            params.set('sort', column);
            params.set('order', sortOrder === 'asc' ? 'desc' : 'asc');
          } else {
            params.set('sort', column);
            params.set('order', 'asc');
          }
          return `/books?${params.toString()}`;
        };
        
        // Get sort indicator for headers
        const getSortIndicator = (column) => {
          if (sortBy !== column) return '';
          return sortOrder === 'asc' ? ' ↑' : ' ↓';
        };
        
        html += `
  <table>
    <thead>
      <tr>
        <th><a href="${buildSortUrl('title')}" style="color: inherit; text-decoration: none; font-weight: bold;">Title${getSortIndicator('title')}</a></th>
        <th><a href="${buildSortUrl('author')}" style="color: inherit; text-decoration: none; font-weight: bold;">Author${getSortIndicator('author')}</a></th>
        <th><a href="${buildSortUrl('created')}" style="color: inherit; text-decoration: none; font-weight: bold;">Created${getSortIndicator('created')}</a></th>
      </tr>
    </thead>
    <tbody>
`;
        
        for (const book of paginatedBooks) {
          const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                       book.tags.find(([k]) => k === 'T')?.[1] ||
                       'Untitled';
          const author = book.tags.find(([k]) => k === 'author')?.[1] || 
                        nip19.npubEncode(book.pubkey).substring(0, 16) + '...';
          const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
          
          // Generate naddr
          let naddr = '';
          try {
            naddr = nip19.naddrEncode({
              kind: book.kind,
              pubkey: book.pubkey,
              identifier: identifier
            });
          } catch (e) {
            console.error('[Books] Error encoding naddr:', e);
            continue; // Skip this book if we can't encode naddr
          }
          
          const date = formatDate(book.created_at);
          
          html += `
      <tr>
        <td class="book-title">
          <a href="/?naddr=${encodeURIComponent(naddr)}" class="book-link">${escapeHtml(title)}</a>
        </td>
        <td class="book-author">${escapeHtml(author)}</td>
        <td class="book-date">${date}</td>
      </tr>
`;
        }
        
        html += `
    </tbody>
  </table>
`;
        
        // Add pagination controls
        if (totalPages > 1) {
          // Helper function to build pagination URL with all current parameters
          const buildPageUrl = (pageNum) => {
            const params = new URLSearchParams();
            params.set('page', pageNum.toString());
            params.set('limit', limit.toString());
            if (showAll) params.set('show_all', '1');
            if (sortBy && sortBy !== 'created') params.set('sort', sortBy);
            if (sortOrder && sortOrder !== 'desc') params.set('order', sortOrder);
            if (customRelays && customRelays.length > 0) {
              params.set('relays', customRelays.join(','));
            }
            return `/books?${params.toString()}`;
          };
          
          html += '<div class="pagination">';
          
          // Previous button
          if (currentPage > 1) {
            html += `<a href="${buildPageUrl(currentPage - 1)}">« Previous</a>`;
          } else {
            html += '<span class="disabled">« Previous</span>';
          }
          
          // Page numbers (show up to 10 pages around current)
          const startPage = Math.max(1, currentPage - 5);
          const endPage = Math.min(totalPages, currentPage + 5);
          
          if (startPage > 1) {
            html += `<a href="${buildPageUrl(1)}">1</a>`;
            if (startPage > 2) html += '<span>...</span>';
          }
          
          for (let p = startPage; p <= endPage; p++) {
            if (p === currentPage) {
              html += `<span class="current">${p}</span>`;
            } else {
              html += `<a href="${buildPageUrl(p)}">${p}</a>`;
            }
          }
          
          if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span>...</span>';
            html += `<a href="${buildPageUrl(totalPages)}">${totalPages}</a>`;
          }
          
          // Next button
          if (currentPage < totalPages) {
            html += `<a href="${buildPageUrl(currentPage + 1)}">Next »</a>`;
          } else {
            html += '<span class="disabled">Next »</span>';
          }
          
          html += '</div>';
        }
      }
      
      html += `
  <div style="margin-top: 2em; text-align: center;">
    <a href="/" style="color: #007bff; text-decoration: none; font-size: 1em;">← Back to Search</a>
  </div>
</body>
</html>
`;
      
      res.end(html);
    } catch (error) {
      console.error('[Books] Error:', error);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      const errorMsg = error?.message || String(error);
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>${escapeHtml(errorMsg)}</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`[Alexandria Catalogue] Listening on port ${PORT}`);
  console.log(`[Alexandria Catalogue] Access at http://localhost:${PORT}`);
  console.log(`[Alexandria Catalogue] AsciiDoctor server: ${ASCIIDOCTOR_SERVER_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  pool.close();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  pool.close();
  server.close(() => {
    process.exit(0);
  });
});
