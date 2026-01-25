/**
 * Background cache warming for improved e-reader performance
 * Pre-fetches popular data in the background when homepage is accessed
 */

import { fetchBooks, fetchArticles, fetchEventsByFilters } from './nostr.js';
import { filterTopLevelBooks, buildBookEventHierarchy, collectAllEventsFromHierarchy } from './book.js';
import { fetchComments, buildThreadedComments } from './comments.js';
import { getCache, setCached, getCached, CACHE_TTL } from './cache.js';
import { DEFAULT_RELAYS, DEFAULT_ARTICLE_RELAYS, DEFAULT_FETCH_LIMIT } from './config.js';
import { nip19 } from './nostr.js';

// Track warming status to avoid duplicate requests
const warmingStatus = {
  books: { inProgress: false, lastWarmed: 0 },
  articles: { inProgress: false, lastWarmed: 0 },
  highlights: { inProgress: false, lastWarmed: 0 },
  comments: { inProgress: false, lastWarmed: 0 },
  articleComments: { inProgress: false, lastWarmed: 0 }
};

// Minimum time between warming attempts (5 minutes)
// OPTIMIZED: Reduced cooldown for faster cache updates while still preventing excessive warming
const WARMING_COOLDOWN = 3 * 60 * 1000; // 3 minutes (was 5)

/**
 * Warm book list cache in the background
 * Non-blocking - runs asynchronously
 */
export async function warmBookCache(customRelays = null) {
  const now = Date.now();
  const status = warmingStatus.books;
  
  // Skip if already warming or recently warmed
  if (status.inProgress) {
    console.log('[Cache Warming] Book cache warming already in progress, skipping...');
    return;
  }
  
  if (now - status.lastWarmed < WARMING_COOLDOWN) {
    console.log('[Cache Warming] Book cache recently warmed, skipping...');
    return;
  }
  
  // Check if cache is already fresh
  const cache = getCache();
  const cacheKey = `bookList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
  const cached = getCached(cacheKey, CACHE_TTL.BOOK_LIST);
  
  if (cached && cached.length > 0) {
    console.log('[Cache Warming] Book cache is already fresh, skipping...');
    status.lastWarmed = now;
    return;
  }
  
  // Start warming
  status.inProgress = true;
  console.log('[Cache Warming] Starting background book cache warming...');
  
  try {
    const books = await fetchBooks(DEFAULT_FETCH_LIMIT, customRelays);
    const topLevelBooks = filterTopLevelBooks(books);
    
    setCached(cacheKey, books);
    cache.topLevelBooks = {
      data: topLevelBooks,
      timestamp: now,
      limit: DEFAULT_FETCH_LIMIT
    };
    
    console.log(`[Cache Warming] Book cache warmed successfully: ${books.length} books, ${topLevelBooks.length} top-level`);
    status.lastWarmed = now;
  } catch (error) {
    console.error('[Cache Warming] Error warming book cache:', error);
  } finally {
    status.inProgress = false;
  }
}

/**
 * Warm article list cache in the background
 * Non-blocking - runs asynchronously
 */
export async function warmArticleCache(customRelays = null) {
  const now = Date.now();
  const status = warmingStatus.articles;
  
  // Skip if already warming or recently warmed
  if (status.inProgress) {
    console.log('[Cache Warming] Article cache warming already in progress, skipping...');
    return;
  }
  
  if (now - status.lastWarmed < WARMING_COOLDOWN) {
    console.log('[Cache Warming] Article cache recently warmed, skipping...');
    return;
  }
  
  // Check if cache is already fresh
  const cache = getCache();
  const cacheKey = `articleList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
  const cached = getCached(cacheKey, CACHE_TTL.ARTICLE_LIST);
  
  if (cached && cached.length > 0) {
    console.log('[Cache Warming] Article cache is already fresh, skipping...');
    status.lastWarmed = now;
    return;
  }
  
  // Start warming
  status.inProgress = true;
  console.log('[Cache Warming] Starting background article cache warming...');
  
  try {
    const articles = await fetchArticles(500, customRelays); // Cap at 500 for articles
    
    setCached(cacheKey, articles);
    
    console.log(`[Cache Warming] Article cache warmed successfully: ${articles.length} articles`);
    status.lastWarmed = now;
  } catch (error) {
    console.error('[Cache Warming] Error warming article cache:', error);
  } finally {
    status.inProgress = false;
  }
}

/**
 * Warm highlights list cache in the background
 * Non-blocking - runs asynchronously
 */
export async function warmHighlightsCache(customRelays = null) {
  const now = Date.now();
  const status = warmingStatus.highlights;
  
  // Skip if already warming or recently warmed
  if (status.inProgress) {
    console.log('[Cache Warming] Highlights cache warming already in progress, skipping...');
    return;
  }
  
  if (now - status.lastWarmed < WARMING_COOLDOWN) {
    console.log('[Cache Warming] Highlights cache recently warmed, skipping...');
    return;
  }
  
  // Check if cache is already fresh
  const cache = getCache();
  const fetchLimit = 500; // Cap at 500 for highlights
  const cacheKey = `highlightsList_${fetchLimit}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
  const cached = getCached(cacheKey, CACHE_TTL.HIGHLIGHTS_LIST);
  
  if (cached && cached.length > 0) {
    console.log('[Cache Warming] Highlights cache is already fresh, skipping...');
    status.lastWarmed = now;
    return;
  }
  
  // Start warming
  status.inProgress = true;
  console.log('[Cache Warming] Starting background highlights cache warming...');
  
  try {
    const relaysUsed = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_ARTICLE_RELAYS;
    
    // Fetch highlights (kind 9802) from relays
    const highlightFilter = {
      kinds: [9802],
      limit: fetchLimit
    };
    
    let highlights = await fetchEventsByFilters([highlightFilter], relaysUsed, 10000);
    
    // Filter to only show highlights from 30023, 30041, or URLs
    // Same logic as highlights route handler
    highlights = highlights.filter(highlight => {
      // Get highlight source reference (a, e, or r tag)
      const aTag = highlight.tags.find(([k]) => k === 'a');
      const eTag = highlight.tags.find(([k]) => k === 'e');
      const rTag = highlight.tags.find(([k]) => k === 'r');
      
      // URLs (r tags) are always allowed
      if (rTag && rTag[1]) return true;
      
      // For event addresses (a tags), check the kind
      if (aTag && aTag[1]) {
        const parts = aTag[1].split(':');
        if (parts.length >= 1) {
          const kind = parseInt(parts[0], 10);
          return kind === 30023 || kind === 30041;
        }
      }
      
      // For event ids (e tags), we can't determine the kind without fetching
      // Include them but they might not link properly
      if (eTag && eTag[1]) return true;
      
      return false; // No valid source tag found
    });
    
    setCached(cacheKey, highlights);
    
    console.log(`[Cache Warming] Highlights cache warmed successfully: ${highlights.length} highlights`);
    status.lastWarmed = now;
  } catch (error) {
    console.error('[Cache Warming] Error warming highlights cache:', error);
  } finally {
    status.inProgress = false;
  }
}

/**
 * Warm comments cache for top books in the background
 * Non-blocking - runs asynchronously
 * Warms comments for the top N books from the book list cache
 */
export async function warmCommentsCache(customRelays = null) {
  const now = Date.now();
  const status = warmingStatus.comments;
  
  // Skip if already warming or recently warmed
  if (status.inProgress) {
    console.log('[Cache Warming] Comments cache warming already in progress, skipping...');
    return;
  }
  
  if (now - status.lastWarmed < WARMING_COOLDOWN) {
    console.log('[Cache Warming] Comments cache recently warmed, skipping...');
    return;
  }
  
  // Start warming
  status.inProgress = true;
  console.log('[Cache Warming] Starting background comments cache warming...');
  
  try {
    const cache = getCache();
    
    // Get top-level books from cache (if available)
    const topLevelBooks = cache.topLevelBooks.data;
    if (!topLevelBooks || topLevelBooks.length === 0) {
      console.log('[Cache Warming] No top-level books in cache yet, skipping comments warming...');
      status.lastWarmed = now;
      return;
    }
    
    // Warm comments for top 10 books (most recent/popular)
    const booksToWarm = topLevelBooks
      .sort((a, b) => b.created_at - a.created_at) // Most recent first
      .slice(0, 10);
    
    console.log(`[Cache Warming] Warming comments for ${booksToWarm.length} top books...`);
    
    // Warm comments for each book in parallel (but limit concurrency)
    const warmPromises = booksToWarm.map(async (bookEvent) => {
      try {
        // Build hierarchy for this book
        const hierarchy = await buildBookEventHierarchy(bookEvent, new Set(), customRelays);
        
        // Generate cache key (same as used in home.js)
        const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
        const naddr = nip19.naddrEncode({
          kind: bookEvent.kind,
          pubkey: bookEvent.pubkey,
          identifier: identifier
        });
        const hierarchyCacheKey = `${naddr}_${hierarchy.map(h => h.id).join(',')}`;
        const commentsCacheKey = hierarchyCacheKey;
        
        // Check if already cached
        const cachedComments = cache.bookComments.get(commentsCacheKey);
        if (cachedComments && (Date.now() - cachedComments.timestamp) < CACHE_TTL.BOOK_DETAIL) {
          return; // Already cached and fresh
        }
        
        // Fetch comments
        const allItems = await fetchComments(bookEvent, hierarchy, customRelays);
        
        // Cache comments
        cache.bookComments.set(commentsCacheKey, {
          data: allItems,
          timestamp: Date.now()
        });
        
        // Limit cache size
        if (cache.bookComments.size > 100) {
          const firstKey = cache.bookComments.keys().next().value;
          cache.bookComments.delete(firstKey);
        }
        
        console.log(`[Cache Warming] Warmed comments for book: ${identifier} (${allItems.length} items)`);
      } catch (error) {
        console.error(`[Cache Warming] Error warming comments for book ${bookEvent.id}:`, error);
        // Continue with other books even if one fails
      }
    });
    
    // Wait for all comment warming to complete (but don't block homepage)
    await Promise.allSettled(warmPromises);
    
    console.log(`[Cache Warming] Comments cache warmed successfully for ${booksToWarm.length} books`);
    status.lastWarmed = now;
  } catch (error) {
    console.error('[Cache Warming] Error warming comments cache:', error);
  } finally {
    status.inProgress = false;
  }
}

/**
 * Warm article comments cache for top articles in the background
 * Non-blocking - runs asynchronously
 * Warms comments for the top N articles from the article list cache
 */
export async function warmArticleCommentsCache(customRelays = null) {
  const now = Date.now();
  const status = warmingStatus.articleComments;
  
  // Skip if already warming or recently warmed
  if (status.inProgress) {
    console.log('[Cache Warming] Article comments cache warming already in progress, skipping...');
    return;
  }
  
  if (now - status.lastWarmed < WARMING_COOLDOWN) {
    console.log('[Cache Warming] Article comments cache recently warmed, skipping...');
    return;
  }
  
  // Start warming
  status.inProgress = true;
  console.log('[Cache Warming] Starting background article comments cache warming...');
  
  try {
    const cache = getCache();
    
    // Get article list from cache (if available)
    const cacheKey = `articleList_${DEFAULT_FETCH_LIMIT}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    const cachedArticles = getCached(cacheKey, CACHE_TTL.ARTICLE_LIST);
    
    if (!cachedArticles || cachedArticles.length === 0) {
      console.log('[Cache Warming] No articles in cache yet, skipping article comments warming...');
      status.lastWarmed = now;
      return;
    }
    
    // Warm comments for top 10 articles (most recent)
    const articlesToWarm = cachedArticles
      .sort((a, b) => b.created_at - a.created_at) // Most recent first
      .slice(0, 10);
    
    console.log(`[Cache Warming] Warming comments for ${articlesToWarm.length} top articles...`);
    
    const relaysUsed = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_ARTICLE_RELAYS;
    
    // Warm comments for each article in parallel
    const warmPromises = articlesToWarm.map(async (article) => {
      try {
        // Get article d-tag
        const dTag = article.tags.find(([k]) => k === 'd')?.[1] || article.id;
        const articleCoordinate = `${article.kind}:${article.pubkey}:${dTag}`;
        
        // Check if already cached (using bookComments cache with article coordinate as key)
        const commentsCacheKey = `article_${articleCoordinate}`;
        const cachedComments = cache.bookComments.get(commentsCacheKey);
        if (cachedComments && (Date.now() - cachedComments.timestamp) < CACHE_TTL.ARTICLE_DETAIL) {
          return; // Already cached and fresh
        }
        
        // Fetch comments for this article
        const commentFilter = {
          kinds: [1111],
          '#A': [articleCoordinate],
          limit: 500
        };
        
        const allComments = await fetchEventsByFilters([commentFilter], relaysUsed, 10000);
        const threadedComments = buildThreadedComments(allComments);
        
        // Cache comments (reuse bookComments cache structure)
        cache.bookComments.set(commentsCacheKey, {
          data: allComments,
          threaded: threadedComments,
          timestamp: Date.now()
        });
        
        // Limit cache size
        if (cache.bookComments.size > 100) {
          const firstKey = cache.bookComments.keys().next().value;
          cache.bookComments.delete(firstKey);
        }
        
        console.log(`[Cache Warming] Warmed comments for article: ${dTag} (${allComments.length} comments)`);
      } catch (error) {
        console.error(`[Cache Warming] Error warming comments for article ${article.id}:`, error);
        // Continue with other articles even if one fails
      }
    });
    
    // Wait for all comment warming to complete (but don't block homepage)
    await Promise.allSettled(warmPromises);
    
    console.log(`[Cache Warming] Article comments cache warmed successfully for ${articlesToWarm.length} articles`);
    status.lastWarmed = now;
  } catch (error) {
    console.error('[Cache Warming] Error warming article comments cache:', error);
  } finally {
    status.inProgress = false;
  }
}

/**
 * Warm all caches in the background
 * Non-blocking - runs asynchronously, doesn't wait for completion
 * YES: All three (books, articles, highlights) run in PARALLEL
 * Comments warming runs after books/articles are warmed (since they depend on lists)
 */
/**
 * Warm all caches in the background
 * OPTIMIZED: More efficient parallel execution with better error handling
 * Returns a Promise for error handling in server.js
 */
export function warmAllCaches(customRelays = null) {
  // Start all warming operations in parallel, but don't wait for them
  // This ensures the homepage response is not delayed
  // OPTIMIZED: Use Promise.allSettled for better parallel execution
  const warmingPromises = [
    warmBookCache(customRelays)
      .then(() => {
        // After books are warmed, warm comments for top books
        return warmCommentsCache(customRelays);
      })
      .catch(err => {
        console.error('[Cache Warming] Book/comments cache warming failed:', err);
      }),
    
    warmArticleCache(customRelays)
      .then(() => {
        // After articles are warmed, warm comments for top articles
        return warmArticleCommentsCache(customRelays);
      })
      .catch(err => {
        console.error('[Cache Warming] Article/comments cache warming failed:', err);
      }),
    
    warmHighlightsCache(customRelays).catch(err => {
      console.error('[Cache Warming] Highlights cache warming failed:', err);
    })
  ];
  
  console.log('[Cache Warming] Background cache warming initiated (books, articles, highlights in parallel)');
  
  // Return Promise for error handling in server.js
  return Promise.allSettled(warmingPromises).then(() => {
    console.log('[Cache Warming] Background cache warming completed');
  });
}

/**
 * Get warming status (for monitoring/debugging)
 */
export function getWarmingStatus() {
  return {
    books: {
      inProgress: warmingStatus.books.inProgress,
      lastWarmed: warmingStatus.books.lastWarmed ? new Date(warmingStatus.books.lastWarmed).toISOString() : null
    },
    articles: {
      inProgress: warmingStatus.articles.inProgress,
      lastWarmed: warmingStatus.articles.lastWarmed ? new Date(warmingStatus.articles.lastWarmed).toISOString() : null
    },
    highlights: {
      inProgress: warmingStatus.highlights.inProgress,
      lastWarmed: warmingStatus.highlights.lastWarmed ? new Date(warmingStatus.highlights.lastWarmed).toISOString() : null
    },
    comments: {
      inProgress: warmingStatus.comments.inProgress,
      lastWarmed: warmingStatus.comments.lastWarmed ? new Date(warmingStatus.comments.lastWarmed).toISOString() : null
    },
    articleComments: {
      inProgress: warmingStatus.articleComments.inProgress,
      lastWarmed: warmingStatus.articleComments.lastWarmed ? new Date(warmingStatus.articleComments.lastWarmed).toISOString() : null
    }
  };
}
