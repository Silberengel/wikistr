/**
 * Nostr relay operations
 */

import { SimplePool, nip19 } from '@nostr/tools';
import WebSocket from 'ws';
import { DEFAULT_RELAYS, DEFAULT_ARTICLE_RELAYS, DEFAULT_FETCH_LIMIT } from './config.js';
import { getCache, getCached, setCached, CACHE_TTL } from './cache.js';
import { getBookIdentifier } from './utils.js';

// Create a simple pool for fetching events
const pool = new SimplePool({
  websocketImplementation: WebSocket
});

/**
 * Wait for subscriptions to complete
 * OPTIMIZED: Early exit when we have enough results or first relay responds
 * Improved: Use Object.is() for atomic counter checks
 */
function waitForSubscriptions(eoseCount, totalRelays, timeout = 5000, earlyExit = false, minResults = 0) {
  return new Promise((resolve) => {
    let resolved = false;
    const startTime = Date.now();
    
    const checkInterval = setInterval(() => {
      if (resolved) return;
      
      const currentCount = typeof eoseCount === 'object' ? eoseCount.size : eoseCount;
      
      // Early exit if we have results from at least one relay and early exit is enabled
      if (earlyExit && currentCount >= 1 && minResults > 0) {
        clearInterval(checkInterval);
        resolved = true;
        resolve();
        return;
      }
      
      // Normal exit when all relays respond
      if (currentCount >= totalRelays) {
        clearInterval(checkInterval);
        resolved = true;
        resolve();
        return;
      }
      
      // Timeout check (more efficient than separate setTimeout)
      if (Date.now() - startTime >= timeout) {
        clearInterval(checkInterval);
        resolved = true;
        resolve();
      }
    }, 50); // Check every 50ms
    
    // Fallback timeout
    setTimeout(() => {
      if (!resolved) {
        clearInterval(checkInterval);
        resolved = true;
        resolve();
      }
    }, timeout);
  });
}

/**
 * Fetch events from relays with a filter
 * OPTIMIZED: Parallel queries, early exit, reduced timeout, improved deduplication
 */
export async function fetchEventsFromRelays(filter, relays, timeout = 5000, earlyExit = false, minResults = 0) {
  if (!relays || relays.length === 0) {
    return [];
  }
  
  const eventMap = new Map(); // Use Map for O(1) lookup
  const eoseRelays = new Set();
  const totalRelays = relays.length;
  const subscriptions = [];
  
  // Start all subscriptions in parallel for faster results
  const subscriptionPromises = relays.map(async (relayUrl) => {
    try {
      const relay = await pool.ensureRelay(relayUrl);
      const sub = relay.subscribe([filter], {
        onevent: (event) => {
          // Deduplicate by event ID (faster than array.includes)
          if (!eventMap.has(event.id)) {
            eventMap.set(event.id, event);
          }
        },
        oneose: () => {
          eoseRelays.add(relayUrl);
        }
      });
      subscriptions.push(sub);
      return { success: true, relayUrl };
    } catch (error) {
      console.error(`[Nostr] Error subscribing to ${relayUrl}:`, error);
      eoseRelays.add(relayUrl);
      return { success: false, relayUrl, error };
    }
  });
  
  // Wait for all subscriptions to start (don't block on errors)
  await Promise.allSettled(subscriptionPromises);
  
  // Wait for results with early exit if enabled
  await waitForSubscriptions(eoseRelays, totalRelays, timeout, earlyExit, minResults || eventMap.size);
  
  // Close all subscriptions efficiently
  for (const sub of subscriptions) {
    try {
      sub.close();
    } catch (e) {
      // Ignore close errors
    }
  }
  
  // Convert Map to array (more efficient than maintaining array)
  return Array.from(eventMap.values());
}

/**
 * Fetch a book event by naddr
 * OPTIMIZED: Checks book list cache first, then bookDetails cache, then relays
 */
export async function fetchBookEvent(naddr, customRelays = null) {
  const cache = getCache();
  
  // First check bookDetails cache (fastest)
  const cached = cache.bookDetails.get(naddr);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.BOOK_DETAIL) {
    console.log(`[Book] Using cached data from bookDetails for: ${naddr}`);
    return cached.data;
  }
  
  const decoded = nip19.decode(naddr);
  if (decoded.type !== 'naddr') {
    throw new Error('Invalid naddr format');
  }

  const { kind, pubkey, identifier } = decoded.data;
  
  if (kind !== 30040 && kind !== 30041) {
    throw new Error(`Unsupported kind: ${kind}. Only book kinds (30040, 30041) are supported.`);
  }

  // Second: Check book list cache before fetching from relays
  console.log(`[Book] Checking book list cache for: ${naddr}`);
  const cacheKey = `bookList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
  const cachedBooks = getCached(cacheKey, Infinity) || []; // Check regardless of TTL
  const foundInCache = cachedBooks.find(b => {
    const bookPubkey = b.pubkey.toLowerCase();
    const bookIdentifier = getBookIdentifier(b).toLowerCase();
    return bookPubkey === pubkey.toLowerCase() && bookIdentifier === identifier.toLowerCase();
  });
  
  if (foundInCache) {
    console.log(`[Book] Found in book list cache, updating bookDetails cache`);
    // Update bookDetails cache for faster future lookups
    cache.bookDetails.set(naddr, {
      data: foundInCache,
      timestamp: Date.now()
    });
    
    if (cache.bookDetails.size > 100) {
      const firstKey = cache.bookDetails.keys().next().value;
      cache.bookDetails.delete(firstKey);
    }
    
    return foundInCache;
  }

  // Third: Fetch from relays if not in cache
  let relays = DEFAULT_RELAYS;
  if (customRelays && customRelays.length > 0) {
    relays = customRelays;
  } else if (decoded.data.relays && decoded.data.relays.length > 0) {
    relays = decoded.data.relays;
  }

  console.log(`[Book] Not in cache, fetching from relays: kind=${kind}, pubkey=${pubkey}, identifier=${identifier}`);
  console.log(`[Book] Using relays: ${relays.join(', ')}`);

  const filter = {
    kinds: [kind],
    authors: [pubkey],
    '#d': [identifier],
    limit: 1
  };
  
  // Optimized: Early exit when we find the book (limit: 1)
  const events = await fetchEventsFromRelays(filter, relays, 5000, true, 1);

  if (events.length === 0) {
    throw new Error('Book event not found on any relay');
  }

  const bookEvent = events[0];
  
  // Update both caches
  console.log(`[Book] Found on relay, updating caches`);
  
  // Update bookDetails cache
  cache.bookDetails.set(naddr, {
    data: bookEvent,
    timestamp: Date.now()
  });
  
  if (cache.bookDetails.size > 100) {
    const firstKey = cache.bookDetails.keys().next().value;
    cache.bookDetails.delete(firstKey);
  }
  
  // Also add to book list cache if it exists (append and deduplicate)
  if (cachedBooks.length > 0) {
    const bookMap = new Map();
    // Add existing books
    for (const book of cachedBooks) {
      const dTag = getBookIdentifier(book);
      const key = `${book.kind}:${book.pubkey}:${dTag}`;
      const existing = bookMap.get(key);
      if (!existing || book.created_at > existing.created_at) {
        bookMap.set(key, book);
      }
    }
    // Add new book
    const dTag = getBookIdentifier(bookEvent);
    const key = `${bookEvent.kind}:${bookEvent.pubkey}:${dTag}`;
    const existing = bookMap.get(key);
    if (!existing || bookEvent.created_at > existing.created_at) {
      bookMap.set(key, bookEvent);
    }
    
    const updatedBooks = Array.from(bookMap.values());
    // Update cache using setCached (which will also update cache.bookList)
    setCached(cacheKey, updatedBooks);
    console.log(`[Book] Updated book list cache: ${cachedBooks.length} -> ${updatedBooks.length} books`);
  }
  
  return bookEvent;
}

/**
 * Fetch an event by naddr (supports books 30040/30041 and articles 30023)
 * OPTIMIZED: Checks list cache first, then details cache, then relays
 */
export async function fetchEventByNaddr(naddr, customRelays = null) {
  const decoded = nip19.decode(naddr);
  if (decoded.type !== 'naddr') {
    throw new Error('Invalid naddr format');
  }

  const { kind, pubkey, identifier } = decoded.data;
  
  // Determine which cache and relays to use based on kind
  const cache = getCache();
  const isBook = kind === 30040 || kind === 30041;
  const isArticle = kind === 30023 || kind === 30041; // 30041 can be both book and article
  
  // First: Check bookDetails/articleDetails cache (fastest)
  if (isBook) {
    const cached = cache.bookDetails.get(naddr);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.BOOK_DETAIL) {
      console.log(`[Book] Using cached data from bookDetails for: ${naddr}`);
      return cached.data;
    }
  } else if (isArticle) {
    const cached = cache.bookDetails.get(naddr);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.ARTICLE_DETAIL) {
      console.log(`[Article] Using cached data from bookDetails for: ${naddr}`);
      return cached.data;
    }
  }
  
  if (!isBook && !isArticle) {
    throw new Error(`Unsupported kind: ${kind}. Only book kinds (30040, 30041) and article kind (30023) are supported.`);
  }

  // Second: Check list cache before fetching from relays
  let foundInCache = null;
  
  if (isBook) {
    console.log(`[Book] Checking book list cache for: ${naddr}`);
    const cacheKey = `bookList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    const cachedBooks = getCached(cacheKey, Infinity) || [];
    foundInCache = cachedBooks.find(b => {
      const bookPubkey = b.pubkey.toLowerCase();
      const bookIdentifier = getBookIdentifier(b).toLowerCase();
      return bookPubkey === pubkey.toLowerCase() && bookIdentifier === identifier.toLowerCase();
    });
  } else if (isArticle) {
    console.log(`[Article] Checking article list cache for: ${naddr}`);
    const cacheKey = `articleList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    const cachedArticles = getCached(cacheKey, Infinity) || [];
    foundInCache = cachedArticles.find(a => {
      const articlePubkey = a.pubkey.toLowerCase();
      const articleDTag = a.tags.find(([k]) => k === 'd')?.[1] || a.id;
      return articlePubkey === pubkey.toLowerCase() && articleDTag.toLowerCase() === identifier.toLowerCase();
    });
  }
  
  if (foundInCache) {
    console.log(`[${isBook ? 'Book' : 'Article'}] Found in list cache, updating details cache`);
    // Update bookDetails cache for faster future lookups
    cache.bookDetails.set(naddr, {
      data: foundInCache,
      timestamp: Date.now()
    });
    
    if (cache.bookDetails.size > 100) {
      const firstKey = cache.bookDetails.keys().next().value;
      cache.bookDetails.delete(firstKey);
    }
    
    return foundInCache;
  }

  // Third: Fetch from relays if not in cache
  let relays = isArticle ? DEFAULT_ARTICLE_RELAYS : DEFAULT_RELAYS;
  if (customRelays && customRelays.length > 0) {
    relays = customRelays;
  } else if (decoded.data.relays && decoded.data.relays.length > 0) {
    relays = decoded.data.relays;
  }

  console.log(`[${isBook ? 'Book' : 'Article'}] Not in cache, fetching from relays: kind=${kind}, pubkey=${pubkey}, identifier=${identifier}`);
  console.log(`[${isBook ? 'Book' : 'Article'}] Using relays: ${relays.join(', ')}`);

  const filter = {
    kinds: [kind],
    authors: [pubkey],
    '#d': [identifier],
    limit: 1
  };
  
  // Optimized: Early exit when we find the event (limit: 1)
  const events = await fetchEventsFromRelays(filter, relays, 5000, true, 1);

  if (events.length === 0) {
    throw new Error(`${isBook ? 'Book' : 'Article'} event not found on any relay`);
  }

  const event = events[0];
  
  // Update both caches
  console.log(`[${isBook ? 'Book' : 'Article'}] Found on relay, updating caches`);
  
  // Update bookDetails cache
  cache.bookDetails.set(naddr, {
    data: event,
    timestamp: Date.now()
  });
  
  if (cache.bookDetails.size > 100) {
    const firstKey = cache.bookDetails.keys().next().value;
    cache.bookDetails.delete(firstKey);
  }
  
  // Also add to list cache if it exists (append and deduplicate)
  if (isBook) {
    const cacheKey = `bookList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    const cachedBooks = getCached(cacheKey, Infinity) || [];
    if (cachedBooks.length > 0) {
      const bookMap = new Map();
      // Add existing books
      for (const book of cachedBooks) {
        const dTag = getBookIdentifier(book);
        const key = `${book.kind}:${book.pubkey}:${dTag}`;
        const existing = bookMap.get(key);
        if (!existing || book.created_at > existing.created_at) {
          bookMap.set(key, book);
        }
      }
      // Add new book
      const dTag = getBookIdentifier(event);
      const key = `${event.kind}:${event.pubkey}:${dTag}`;
      const existing = bookMap.get(key);
      if (!existing || event.created_at > existing.created_at) {
        bookMap.set(key, event);
      }
      
      const updatedBooks = Array.from(bookMap.values());
      setCached(cacheKey, updatedBooks);
      console.log(`[Book] Updated book list cache: ${cachedBooks.length} -> ${updatedBooks.length} books`);
    }
  } else if (isArticle) {
    const cacheKey = `articleList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    const cachedArticles = getCached(cacheKey, Infinity) || [];
    if (cachedArticles.length > 0) {
      const articleMap = new Map();
      // Add existing articles
      for (const article of cachedArticles) {
        const dTag = article.tags.find(([k]) => k === 'd')?.[1] || article.id;
        const key = `${article.pubkey}:${dTag}`;
        const existing = articleMap.get(key);
        if (!existing || article.created_at > existing.created_at) {
          articleMap.set(key, article);
        }
      }
      // Add new article
      const dTag = event.tags.find(([k]) => k === 'd')?.[1] || event.id;
      const key = `${event.pubkey}:${dTag}`;
      const existing = articleMap.get(key);
      if (!existing || event.created_at > existing.created_at) {
        articleMap.set(key, event);
      }
      
      const updatedArticles = Array.from(articleMap.values());
      setCached(cacheKey, updatedArticles);
      console.log(`[Article] Updated article list cache: ${cachedArticles.length} -> ${updatedArticles.length} articles`);
    }
  }
  
  return event;
}

/**
 * Fetch books by d tag
 */
export async function fetchBooksByDTag(dTag, customRelays = null, limit = 10000) {
  console.log(`[Books] Fetching books by d tag: ${dTag} (limit: ${limit})`);
  
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
  
  const filter = {
    kinds: [30040],
    '#d': [dTag],
    limit: Number(limit)
  };
  
  // Optimized: Reduced timeout for faster responses
  const timeoutMs = Math.min(Math.max(5000, (limit / 200) * 1000), 30000);
  // Early exit when we have enough results (50% of limit)
  const foundEvents = await fetchEventsFromRelays(filter, relays, timeoutMs, true, Math.floor(limit * 0.5));
  
  // Deduplicate by d-tag
  const dTagMap = new Map();
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
}

/**
 * Fetch kind 30040 events (books)
 */
export async function fetchBooks(limit = 50, customRelays = null) {
  console.log(`[Books] Fetching ${limit} books from relays...`);
  
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
  
  const filter = {
    kinds: [30040],
    limit: Number(limit)
  };
  
  console.log(`[Books] Using filter:`, JSON.stringify(filter));
  console.log(`[Books] Using relays: ${relays.join(', ')}`);
  
  // Optimized: Reduced timeout for faster responses
  // For large limits (refresh operations), use longer timeout and disable early exit to get more results
  const timeoutMs = limit > 1000 
    ? Math.min(Math.max(10000, (limit / 100) * 1000), 60000) // Longer timeout for large fetches
    : Math.min(Math.max(5000, (limit / 200) * 1000), 30000);
  // Early exit only for smaller limits to avoid missing books during refresh
  const useEarlyExit = limit <= 1000;
  const minResults = useEarlyExit ? Math.floor(limit * 0.5) : 0;
  const foundEvents = await fetchEventsFromRelays(filter, relays, timeoutMs, useEarlyExit, minResults);
  
  // Deduplicate by d-tag
  const dTagMap = new Map();
  for (const event of foundEvents) {
    const dTag = event.tags.find(([k]) => k === 'd')?.[1];
    if (dTag) {
      const dTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
      const existing = dTagMap.get(dTagKey);
      if (!existing || event.created_at > existing.created_at) {
        dTagMap.set(dTagKey, event);
      }
    } else {
      const idKey = `id:${event.id}`;
      if (!dTagMap.has(idKey)) {
        dTagMap.set(idKey, event);
      }
    }
  }
  
  const deduplicatedEvents = Array.from(dTagMap.values());
  console.log(`[Books] Found ${foundEvents.length} books, ${deduplicatedEvents.length} after d-tag deduplication`);
  return deduplicatedEvents;
}

/**
 * Fetch kind 30023 events (markdown articles)
 * Note: 30041 (asciidoc) articles are parts of publications and should not be included in browse/search
 */
export async function fetchArticles(limit = 500, customRelays = null) {
  console.log(`[Articles] Fetching ${limit} articles from relays...`);
  
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_ARTICLE_RELAYS;
  
  const filter = {
    kinds: [30023], // Only markdown articles (30041 are publication parts, not standalone articles)
    limit: Math.min(Number(limit), 500) // Cap at 500
  };
  
  console.log(`[Articles] Using filter:`, JSON.stringify(filter));
  console.log(`[Articles] Using relays: ${relays.join(', ')}`);
  
  // Optimized: Reduced timeout for faster responses
  const timeoutMs = Math.min(Math.max(5000, (limit / 200) * 1000), 30000);
  // Early exit when we have enough results (50% of limit)
  const foundEvents = await fetchEventsFromRelays(filter, relays, timeoutMs, true, Math.floor(limit * 0.5));
  
  // Deduplicate by d-tag
  const dTagMap = new Map();
  for (const event of foundEvents) {
    const dTag = event.tags.find(([k]) => k === 'd')?.[1];
    if (dTag) {
      const dTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
      const existing = dTagMap.get(dTagKey);
      if (!existing || event.created_at > existing.created_at) {
        dTagMap.set(dTagKey, event);
      }
    } else {
      const idKey = `id:${event.id}`;
      if (!dTagMap.has(idKey)) {
        dTagMap.set(idKey, event);
      }
    }
  }
  
  const deduplicatedEvents = Array.from(dTagMap.values());
  console.log(`[Articles] Found ${foundEvents.length} articles, ${deduplicatedEvents.length} after d-tag deduplication`);
  return deduplicatedEvents;
}

/**
 * Fetch a single article event by pubkey and d-tag (supports both 30023 and 30041)
 */
export async function fetchArticleEvent(pubkey, dTag, customRelays = null) {
  // OPTIMIZED: Check cache first before fetching from relays
  const cache = getCache();
  const articleCacheKey = `${pubkey}:${dTag}`;
  const cached = cache.articleDetails.get(articleCacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.ARTICLE_DETAIL) {
    console.log(`[Article] Using cached data for: ${articleCacheKey}`);
    return cached.data;
  }
  
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_ARTICLE_RELAYS;
  
  const filter = {
    kinds: [30023, 30041], // Both markdown and asciidoc articles
    authors: [pubkey],
    '#d': [dTag],
    limit: 1
  };
  
  // Optimized: Early exit when we find the article (limit: 1)
  const events = await fetchEventsFromRelays(filter, relays, 5000, true, 1);
  
  if (events.length === 0) {
    throw new Error('Article event not found on any relay');
  }
  
  const event = events[0];
  
  // OPTIMIZED: Cache the article for future requests
  cache.articleDetails.set(articleCacheKey, {
    data: event,
    timestamp: Date.now()
  });
  
  if (cache.articleDetails.size > 100) {
    const firstKey = cache.articleDetails.keys().next().value;
    cache.articleDetails.delete(firstKey);
  }
  
  return event;
}

/**
 * Fetch user handle/name from kind 0 profile event
 * OPTIMIZED: Caches full profile events for faster subsequent lookups
 */
export async function fetchUserHandle(pubkey, customRelays = null) {
  const cache = getCache();
  const now = Date.now();
  
  // First: Check handle cache (fastest)
  const cachedHandle = cache.userHandles.get(pubkey);
  if (cachedHandle && (now - cachedHandle.timestamp) < CACHE_TTL.USER_HANDLE) {
    console.log(`[Profile] Using cached handle for: ${pubkey.substring(0, 16)}...`);
    return cachedHandle.data;
  }
  
  // Second: Check profile event cache (full event, can extract handle)
  const cachedProfile = cache.userProfiles.get(pubkey);
  if (cachedProfile && (now - cachedProfile.timestamp) < CACHE_TTL.USER_HANDLE) {
    console.log(`[Profile] Using cached profile event for: ${pubkey.substring(0, 16)}...`);
    const profileEvent = cachedProfile.data;
    let handle = null;
    if (profileEvent && profileEvent.content) {
      try {
        const metadata = JSON.parse(profileEvent.content);
        handle = metadata.name || metadata.display_name || metadata.nip05 || null;
      } catch (e) {
        console.error('[Profile] Error parsing cached metadata:', e);
        handle = null;
      }
    }
    // Update handle cache for faster future lookups
    cache.userHandles.set(pubkey, {
      data: handle,
      timestamp: now
    });
    return handle;
  }
  
  // Third: Fetch from relays if not in cache
  if (customRelays === undefined) {
    customRelays = null;
  }
  
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
  
  const filter = {
    kinds: [0],
    authors: [pubkey],
    limit: 1
  };
  
  console.log(`[Profile] Fetching profile event from relays for: ${pubkey.substring(0, 16)}...`);
  // Optimized: Reduced timeout for profile lookups
  const foundEvents = await fetchEventsFromRelays(filter, relays, 2000, true, 1);
  
  let handle = null;
  let profileEvent = null;
  
  if (foundEvents.length > 0) {
    profileEvent = foundEvents[0];
    try {
      const metadata = JSON.parse(profileEvent.content);
      handle = metadata.name || metadata.display_name || metadata.nip05 || null;
    } catch (e) {
      console.error('[Profile] Error parsing metadata:', e);
      handle = null;
    }
  }
  
  // Cache both the full profile event and the extracted handle
  if (profileEvent) {
    cache.userProfiles.set(pubkey, {
      data: profileEvent,
      timestamp: now
    });
    
    if (cache.userProfiles.size > 1000) {
      const firstKey = cache.userProfiles.keys().next().value;
      cache.userProfiles.delete(firstKey);
    }
  }
  
  // Cache the handle (even if null) for faster future lookups
  cache.userHandles.set(pubkey, {
    data: handle,
    timestamp: now
  });
  
  if (cache.userHandles.size > 500) {
    const firstKey = cache.userHandles.keys().next().value;
    cache.userHandles.delete(firstKey);
  }
  
  return handle;
}

/**
 * Test relay connectivity
 * OPTIMIZED: Tests all relays in parallel instead of sequentially
 */
export async function testRelayConnectivity(relays) {
  // Test all relays in parallel for much faster results
  const testPromises = relays.map(async (relayUrl) => {
    try {
      console.log(`[Relay Test] Testing connection to ${relayUrl}...`);
      const relay = await pool.ensureRelay(relayUrl);
      
      const testFilter = { kinds: [30040], limit: 1 };
      let connected = false;
      
      try {
        const sub = relay.subscribe([testFilter], {
          onevent: () => {
            connected = true;
          },
          oneose: () => {
            connected = true;
          }
        });
        
        await new Promise((resolve) => {
          setTimeout(() => {
            sub.close();
            resolve();
          }, 2000); // Reduced from 3s to 2s for faster status page
        });
        
        if (connected) {
          console.log(`[Relay Test] ✓ ${relayUrl} - Connected`);
          return { url: relayUrl, status: 'connected', error: null };
        } else {
          console.log(`[Relay Test] ⚠ ${relayUrl} - Timeout (no response)`);
          return { url: relayUrl, status: 'timeout', error: 'No response within 2 seconds' };
        }
      } catch (testError) {
        const testErrorMsg = testError?.message || String(testError);
        console.log(`[Relay Test] ✗ ${relayUrl} - Error: ${testErrorMsg}`);
        return { url: relayUrl, status: 'error', error: testErrorMsg };
      }
    } catch (connError) {
      const errorMsg = connError?.message || String(connError);
      console.log(`[Relay Test] ✗ ${relayUrl} - Connection failed: ${errorMsg}`);
      return { url: relayUrl, status: 'error', error: errorMsg };
    }
  });
  
  // Wait for all tests to complete in parallel
  const results = await Promise.all(testPromises);
  return results;
}

/**
 * Fetch events by multiple filters (for batch operations)
 */
export async function fetchEventsByFilters(filters, relays, timeout = 5000) {
  const foundEvents = [];
  const eventMap = new Map();
  const eoseRelays = new Set();
  const totalRelays = relays.length;
  const subscriptions = [];
  
  for (const relayUrl of relays) {
    try {
      const relay = await pool.ensureRelay(relayUrl);
      const sub = relay.subscribe(filters, {
        onevent: (event) => {
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
      console.error(`[Nostr] Error subscribing to ${relayUrl}:`, error);
      eoseRelays.add(relayUrl);
    }
  }
  
  await waitForSubscriptions(eoseRelays.size, totalRelays, timeout);
  subscriptions.forEach(s => s.close());
  
  return foundEvents;
}

/**
 * Fetch events by IDs
 */
export async function fetchEventsByIds(ids, relays, timeout = 5000) {
  const filter = { ids };
  return await fetchEventsFromRelays(filter, relays, timeout);
}

/**
 * Close pool (for graceful shutdown)
 */
export function closePool() {
  pool.close();
}

export { nip19 };
