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
    
    console.log(`[Books] Found ${foundEvents.length} books with d tag: ${dTag}`);
    return foundEvents;
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
        
        // Map events by their a-tag identifier
        for (const event of foundEvents) {
          if (event.kind === 30040 || event.kind === 30041) {
            const dTag = event.tags.find(([k]) => k === 'd')?.[1];
            if (dTag) {
              const aTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
              aTagEvents.set(aTagKey, event);
            }
          }
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
async function generateEPUB(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/epub`;
  
  console.log(`[EPUB Download] Generating EPUB via ${url}`);
  console.log(`[EPUB Download] Content length: ${content.length} chars`);

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
    
    console.log(`[Books] Found ${foundEvents.length} books`);
    return foundEvents;
  } catch (error) {
    console.error('[Books] Error fetching books:', error);
    throw error;
  }
}

/**
 * Fetch comments (kind 1111) and highlights (kind 9802) for a book event
 */
async function fetchComments(bookEvent) {
  try {
    // Build article coordinate: kind:pubkey:identifier
    const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
    const articleCoordinate = `${bookEvent.kind}:${bookEvent.pubkey}:${identifier}`;
    
    console.log(`[Comments] Fetching comments and highlights for coordinate: ${articleCoordinate}`);
    
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    let eoseCount = 0;
    const totalRelays = DEFAULT_RELAYS.length;
    const subscriptions = [];
    
    // Fetch both kind 1111 (comments) and kind 9802 (highlights)
    const filter = {
      kinds: [1111, 9802],
      '#A': [articleCoordinate], // NIP-22: uppercase A tag for root scope
      limit: 500
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of DEFAULT_RELAYS) {
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
        console.error(`[Comments] Error subscribing to ${relayUrl}:`, error);
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
      }, 10000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    console.log(`[Comments] Found ${foundEvents.length} comments and highlights`);
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
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .header {
      background: white;
      border-bottom: 1px solid #ddd;
      padding: 1em;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .header h1 {
      font-size: 1.2em;
      font-weight: 600;
      color: #333;
      margin: 0;
    }
    
    .header .book-info {
      color: #666;
      font-size: 0.9em;
    }
    
    .header .actions {
      display: flex;
      gap: 0.5em;
    }
    
    .header .actions a {
      padding: 0.5em 1em;
      background: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 0.9em;
      transition: background 0.2s;
    }
    
    /* Removed hover effects for e-paper readers */
    
    .viewer-container {
      flex: 1;
      overflow: hidden;
      position: relative;
      background: white;
    }
    
    #viewer {
      width: 100%;
      height: 100%;
      border: none;
    }
    
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #666;
    }
    
    .loading-spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #007bff;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 1em;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #d32f2f;
      padding: 2em;
      background: #ffebee;
      border-radius: 8px;
      max-width: 500px;
    }
    
    .error h2 {
      margin-bottom: 0.5em;
    }
    
    .error a {
      color: #007bff;
      text-decoration: none;
      margin-top: 1em;
      display: inline-block;
    }
    
    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5em;
      }
      
      .header .actions {
        width: 100%;
        flex-direction: column;
      }
      
      .header .actions a {
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="book-info">${escapeHtml(author || 'Unknown Author')}</div>
    </div>
    <div class="actions">
      <a href="/?naddr=${encodeURIComponent(naddr)}">Back to Book</a>
      <a href="/download-epub?naddr=${encodeURIComponent(naddr)}">Download</a>
    </div>
  </div>
  
  <div class="viewer-container">
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
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .message-box { margin: 1em 0; padding: 1em; border-radius: 4px; border-left: 4px solid; }
    .message-box.error { background: #fee; border-color: #d32f2f; color: #c62828; }
    .message-box.warning { background: #fff3cd; border-color: #ff9800; color: #f57c00; }
    .message-box.info { background: #e3f2fd; border-color: #2196f3; color: #1976d2; }
    .message-box-header { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; }
    .message-box-icon { font-size: 1.2em; }
    .message-box-title { font-size: 1.1em; }
    .message-box-content p { margin: 0; }
    .message-box-details { margin-top: 0.5em; }
    .message-box-details summary { cursor: pointer; font-weight: bold; margin-bottom: 0.5em; }
    .message-box-details pre { background: rgba(0,0,0,0.05); padding: 0.5em; border-radius: 3px; overflow-x: auto; font-size: 0.9em; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  <h1>${escapeHtml(title)}</h1>
  ${generateMessageBox('error', errorMessage, details)}
  <p style="margin-top: 2em;"><a href="${escapeHtml(backUrl)}">← Go back</a></p>
</body>
</html>`;
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

  if (req.method !== 'GET') {
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
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    /* Removed hover effects for e-paper readers */
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    /* Removed hover effects for e-paper readers */
    .results-header { margin: 1.5em 0; }
    .book-result { margin: 1.5em 0; padding: 1em; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; }
    .book-title { font-size: 1.2em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #666; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 0.5em; display: flex; flex-wrap: wrap; gap: 1em; align-items: center; }
    .view-buttons { display: flex; gap: 0.5em; }
    .view-buttons a { display: inline-block; padding: 0.5em 1em; color: white; background: #007bff; text-decoration: none; border-radius: 4px; }
    /* Removed hover effects for e-paper readers */
    .download-section { display: flex; gap: 0.5em; align-items: center; }
    .download-section label { font-weight: bold; color: #333; }
    .download-section select { padding: 0.5em; font-size: 1em; border: 1px solid #ddd; border-radius: 4px; }
    .download-section button { padding: 0.5em 1em; color: white; background: #28a745; border: none; cursor: pointer; border-radius: 4px; }
    /* Removed hover effects for e-paper readers */
    .no-results { color: #666; font-style: italic; margin: 2em 0; text-align: center; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="results-header">
    <h2>Search Results for: "${escapeHtml(query)}"</h2>
    <p>Found ${books.length} book${books.length !== 1 ? 's' : ''} matching your search:</p>
    <div style="margin-top: 0.5em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
      <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
      <br><span style="color: #666; font-size: 0.85em;">(${isCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
      ${!showCustomRelays && !isCustomRelays ? `<br><a href="/?naddr=${encodeURIComponent(query)}&show_custom_relays=1" style="color: #007bff; text-decoration: none; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
    </div>
    ${showCustomRelays || isCustomRelays ? `
    <form method="GET" action="/" style="margin-top: 1em; padding: 1em; background: #f5f5f5; border-radius: 4px;">
      <input type="hidden" name="naddr" value="${escapeHtml(query)}">
      <label for="relays-input-search" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #333;">Custom Relays:</label>
      <p style="font-size: 0.9em; color: #666; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
      <textarea id="relays-input-search" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">${escapeHtml(relayInput)}</textarea>
      <div style="margin-top: 0.5em;">
        <button type="submit" style="padding: 0.5em 1em; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Update Search</button>
        <a href="/?naddr=${encodeURIComponent(query)}" style="color: #666; text-decoration: none; font-size: 0.9em; margin-left: 1em;">Cancel</a>
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
      Author: ${escapeHtml(author)}<br>
      Created: ${date}
    </div>
    <div class="book-actions">
      <div class="view-buttons">
        <a href="/view?naddr=${encodeURIComponent(naddr)}">View as HTML</a>
        <a href="/view-epub?naddr=${encodeURIComponent(naddr)}">View as EPUB</a>
      </div>
      <div class="download-section">
        <form method="GET" action="/download" style="display: flex; gap: 0.5em; align-items: center;">
          <input type="hidden" name="naddr" value="${encodeURIComponent(naddr)}">
          <label for="download-format-search-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}">Download as:</label>
          <select id="download-format-search-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}" name="format" required>
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
  </div>
`;
            }
          }
          
          html += `
  <script>
    function downloadBook(naddr, format) {
      const url = '/download?naddr=' + encodeURIComponent(naddr) + '&format=' + encodeURIComponent(format);
      window.location.href = url;
    }
  </script>
</body>
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
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
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

        // Fetch comments and highlights
        console.log(`[Book View] Fetching comments and highlights...`);
        const allItems = await fetchComments(bookEvent);
        console.log(`[Book View] Found ${allItems.length} comments and highlights`);

        // Build threaded structure
        const threadedItems = buildThreadedComments(allItems);
        
        // Count comments and highlights separately
        const commentCount = allItems.filter(e => e.kind === 1111).length;
        const highlightCount = allItems.filter(e => e.kind === 9802).length;

        const title = bookEvent.tags.find(([k]) => k === 'title')?.[1] || 
                     bookEvent.tags.find(([k]) => k === 'T')?.[1] ||
                     'Untitled';
        const author = bookEvent.tags.find(([k]) => k === 'author')?.[1] || 
                      nip19.npubEncode(bookEvent.pubkey).substring(0, 16) + '...';
        const date = formatDate(bookEvent.created_at);
        
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
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    /* Removed hover effects for e-paper readers */
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    /* Removed hover effects for e-paper readers */
    .book-header { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    .book-title { font-size: 1.5em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #666; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 1em; display: flex; flex-wrap: wrap; gap: 1em; align-items: center; }
    .view-buttons { display: flex; gap: 0.5em; }
    .view-buttons a { display: inline-block; padding: 0.5em 1em; color: white; background: #007bff; text-decoration: none; border-radius: 4px; }
    /* Removed hover effects for e-paper readers */
    .download-section { display: flex; gap: 0.5em; align-items: center; }
    .download-section label { font-weight: bold; color: #333; }
    .download-section select { padding: 0.5em; font-size: 1em; border: 1px solid #ddd; border-radius: 4px; }
    .download-section button { padding: 0.5em 1em; color: white; background: #28a745; border: none; cursor: pointer; border-radius: 4px; }
    /* Removed hover effects for e-paper readers */
    .comments-section { margin-top: 2em; }
    .comment, .highlight { margin: 1.5em 0; padding: 1em; border-left: 3px solid #ddd; background: #fafafa; }
    .highlight { border-left-color: #ffc107; background: #fffbf0; }
    .comment-author, .highlight-author { font-weight: bold; color: #333; margin-bottom: 0.5em; }
    .comment-date, .highlight-date { color: #666; font-size: 0.85em; }
    .comment-content, .highlight-content { margin-top: 0.5em; white-space: pre-wrap; word-wrap: break-word; }
    .comment-type { display: inline-block; padding: 0.2em 0.5em; font-size: 0.75em; border-radius: 3px; margin-left: 0.5em; }
    .comment-type.comment { background: #e3f2fd; color: #1976d2; }
    .comment-type.highlight { background: #fff3cd; color: #856404; }
    .no-comments { color: #666; font-style: italic; margin: 1em 0; }
    .thread-reply { margin-left: 2em; margin-top: 1em; border-left: 2px solid #ccc; padding-left: 1em; }
    .thread-reply .comment, .thread-reply .highlight { border-left-width: 2px; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="book-header">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      Author: ${escapeHtml(author)}<br>
      Created: ${date}
    </div>
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
  </div>
  
  <div class="comments-section">
    <h2>Comments & Highlights (${commentCount} comments, ${highlightCount} highlights)</h2>
`;

        if (threadedItems.length === 0) {
          html += '<p class="no-comments">No comments or highlights yet.</p>';
        } else {
          // Recursive function to render threaded items
          const renderItem = (item, depth = 0) => {
            const isHighlight = item.kind === 9802;
            const itemClass = isHighlight ? 'highlight' : 'comment';
            const authorClass = isHighlight ? 'highlight-author' : 'comment-author';
            const dateClass = isHighlight ? 'highlight-date' : 'comment-date';
            const contentClass = isHighlight ? 'highlight-content' : 'comment-content';
            
            const author = nip19.npubEncode(item.pubkey).substring(0, 16) + '...';
            const date = formatDate(item.created_at);
            const content = escapeHtml(truncate(item.content || '', 1000));
            const typeLabel = isHighlight ? 'Highlight' : 'Comment';
            
            let itemHtml = `
    <div class="${itemClass}"${depth > 0 ? ' style="margin-left: ' + (depth * 2) + 'em;"' : ''}>
      <div class="${authorClass}">
        ${escapeHtml(author)}
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
          
          for (const item of threadedItems) {
            html += renderItem(item);
          }
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
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
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
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    /* Removed hover effects for e-paper readers */
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    /* Removed hover effects for e-paper readers */
    .info { color: #666; margin: 1em 0; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
    
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="naddr1... or d tag..." required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  <div style="margin-top: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
    <strong>Default relays:</strong> ${DEFAULT_RELAYS.map(r => escapeHtml(r)).join(', ')}
    ${url.searchParams.get('show_custom_relays') !== '1' ? `<br><a href="/?show_custom_relays=1" style="color: #007bff; text-decoration: none; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
  </div>
  ${url.searchParams.get('show_custom_relays') === '1' ? `
  <form method="GET" action="/" style="margin-top: 1em; padding: 1em; background: #f5f5f5; border-radius: 4px;">
    <label for="relays-input-home" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #333;">Custom Relays:</label>
    <p style="font-size: 0.9em; color: #666; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
    <textarea id="relays-input-home" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;"></textarea>
    <div style="margin-top: 0.5em;">
      <button type="submit" style="padding: 0.5em 1em; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Save Relays</button>
      <a href="/" style="color: #666; text-decoration: none; font-size: 0.9em; margin-left: 1em;">Cancel</a>
    </div>
  </form>
  ` : ''}
  
  <details style="max-width: 800px; margin: 2em auto;">
    <summary style="cursor: pointer; padding: 1em; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff; font-weight: bold; color: #333; user-select: none;">
      Alexandria Catalogue - How It Works
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

      // Send HTML as response
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(htmlContent);
      
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

      // Generate EPUB
      console.log(`[EPUB Viewer] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author);
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

      // Generate EPUB
      console.log(`[EPUB Viewer] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author);
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
      searchResults: cache.searchResults.size,
      generatedFiles: cache.generatedFiles.size,
      topLevelBooks: cache.topLevelBooks.data ? cache.topLevelBooks.data.length : 0,
      topLevelBooksTimestamp: cache.topLevelBooks.timestamp ? new Date(cache.topLevelBooks.timestamp).toISOString() : null
    };
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Server Status - Alexandria Catalogue</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .status-section { margin: 1em 0; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    .status-section h2 { margin-top: 0; }
    .status-item { margin: 0.5em 0; }
    .status-label { font-weight: bold; display: inline-block; width: 200px; }
    .message-box { margin: 1em 0; padding: 1em; border-radius: 4px; border-left: 4px solid; }
    .message-box.info { background: #e3f2fd; border-color: #2196f3; color: #1976d2; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
    <a href="/status">Status</a>
  </nav>
  <h1>Server Status</h1>
  ${generateMessageBox('info', 'Server is running. Cache statistics below.', null)}
  <div class="status-section">
    <h2>Cache Statistics</h2>
    <div class="status-item"><span class="status-label">Cached Book Details:</span> ${cacheStats.bookDetails}</div>
    <div class="status-item"><span class="status-label">Cached Search Results:</span> ${cacheStats.searchResults}</div>
    <div class="status-item"><span class="status-label">Cached Generated Files:</span> ${cacheStats.generatedFiles}</div>
    <div class="status-item"><span class="status-label">Top-Level Books Cached:</span> ${cacheStats.topLevelBooks}</div>
    ${cacheStats.topLevelBooksTimestamp ? `<div class="status-item"><span class="status-label">Last Updated:</span> ${cacheStats.topLevelBooksTimestamp}</div>` : ''}
  </div>
  <div class="status-section">
    <h2>Cache Configuration</h2>
    <div class="status-item"><span class="status-label">Book List Cache:</span> ${CACHE_TTL.BOOK_LIST / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Book Detail Cache:</span> ${CACHE_TTL.BOOK_DETAIL / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Search Results Cache:</span> ${CACHE_TTL.SEARCH_RESULTS / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Generated Files Cache:</span> ${CACHE_TTL.GENERATED_FILES / 60000} minutes</div>
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
    body { font-family: sans-serif; max-width: 1200px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    /* Removed hover effects for e-paper readers */
    table { width: 100%; border-collapse: collapse; margin-top: 1em; }
    th, td { padding: 0.75em; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    tr:hover { background: #f9f9f9; }
    .book-link { color: #007bff; text-decoration: none; }
    /* Removed hover effects for e-paper readers */
    .book-title { font-weight: bold; }
    .book-author { color: #666; font-size: 0.9em; }
    .book-date { color: #666; font-size: 0.85em; white-space: nowrap; }
    .loading { text-align: center; color: #666; padding: 2em; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
    .book-count { color: #666; margin-bottom: 1em; }
    .pagination { margin-top: 2em; text-align: center; }
    .pagination a, .pagination span { display: inline-block; padding: 0.5em 1em; margin: 0 0.25em; 
      text-decoration: none; border: 1px solid #ddd; border-radius: 4px; color: #007bff; }
    /* Removed hover effects for e-paper readers */
    .pagination .current { background: #007bff; color: white; border-color: #007bff; }
    .pagination .disabled { color: #999; cursor: not-allowed; pointer-events: none; }
    .expand-button { margin: 1em 0; padding: 0.75em 1.5em; background: #007bff; color: white; 
      border: none; border-radius: 4px; cursor: pointer; font-size: 1em; text-decoration: none; display: inline-block; }
    .expand-button:hover { background: #0056b3; }
    .controls { margin: 1em 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1em; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue - Browse Library</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  <div style="margin-bottom: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
    <strong>Relays used:</strong> ${(customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS).map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #666; font-size: 0.85em;">(${customRelays && customRelays.length > 0 ? 'Custom relays' : 'Default relays'})</span>
    ${!showCustomRelays && !(customRelays && customRelays.length > 0) ? `<br><a href="/books?page=${page}&limit=${limit}&show_all=${showAll ? '1' : '0'}&show_custom_relays=1" style="color: #007bff; text-decoration: none; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
  </div>
  ${showCustomRelays || (customRelays && customRelays.length > 0) ? `
  <form method="GET" action="/books" style="margin-bottom: 1em; padding: 1em; background: #f5f5f5; border-radius: 4px;">
    <input type="hidden" name="page" value="${page}">
    <input type="hidden" name="limit" value="${limit}">
    <input type="hidden" name="show_all" value="${showAll ? '1' : '0'}">
    <label for="relays-input-books" style="display: block; margin-bottom: 0.5em; font-weight: bold; color: #333;">Custom Relays:</label>
    <p style="font-size: 0.9em; color: #666; margin-bottom: 0.5em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>
    <textarea id="relays-input-books" name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">${escapeHtml(relayInput)}</textarea>
    <div style="margin-top: 0.5em;">
      <button type="submit" style="padding: 0.5em 1em; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Update Relays</button>
      <a href="/books?page=${page}&limit=${limit}&show_all=${showAll ? '1' : '0'}" style="color: #666; text-decoration: none; font-size: 0.9em; margin-left: 1em;">Cancel</a>
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
              <p style="margin-top: 1em; font-size: 0.9em; color: #666;">Try using custom relays or check the server logs for errors.</p>
            </div>
          </div>`;
        } else {
          html += `<div class="loading">
            <p>Found ${allBooks.length} books, but none are top-level (all are nested within other books).</p>
            <p style="font-size: 0.9em; color: #666; margin-top: 0.5em;">Try searching for a specific book using its naddr or d tag.</p>
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
