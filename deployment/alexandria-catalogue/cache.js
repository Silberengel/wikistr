/**
 * Cache management for Alexandria Catalogue
 */

import { CACHE_TTL } from './config.js';
import { calculateObjectSize, formatBytes } from './utils.js';

// In-memory cache
const cache = {
  bookList: { data: null, timestamp: 0, limit: 0, showAll: false },
  topLevelBooks: { data: null, timestamp: 0, limit: 0 },
  articleList: new Map(), // Cache for article lists
  highlightsList: new Map(), // Cache for highlights lists
  bookDetails: new Map(), // Cache for book and article details (by naddr)
  articleDetails: new Map(), // Cache for article details (by pubkey:dTag)
  bookHierarchy: new Map(),
  bookComments: new Map(),
  userHandles: new Map(), // Cache for user handles (by pubkey)
  searchResults: new Map(),
  generatedFiles: new Map()
};

/**
 * Get cached data if still valid
 */
export function getCached(key, ttl) {
  // Check if it's a Map-based cache (articleList, highlightsList, bookDetails, etc.)
  if (key.startsWith('articleList_')) {
    const cached = cache.articleList.get(key);
    if (cached && cached.data && (Date.now() - cached.timestamp) < ttl) {
      return cached.data;
    }
    return null;
  }
  
  if (key.startsWith('highlightsList_')) {
    const cached = cache.highlightsList.get(key);
    if (cached && cached.data && (Date.now() - cached.timestamp) < ttl) {
      return cached.data;
    }
    return null;
  }
  
  // For other caches, use direct property access
  const cached = cache[key];
  if (cached && cached.data && (Date.now() - cached.timestamp) < ttl) {
    return cached.data;
  }
  return null;
}

/**
 * Set cache data
 */
export function setCached(key, data, extra = {}) {
  // Check if it's a Map-based cache (articleList, highlightsList, bookDetails, etc.)
  if (key.startsWith('articleList_')) {
    cache.articleList.set(key, {
      data,
      timestamp: Date.now(),
      ...extra
    });
    // Limit articleList cache size
    if (cache.articleList.size > 50) {
      const firstKey = cache.articleList.keys().next().value;
      cache.articleList.delete(firstKey);
    }
    return;
  }
  
  if (key.startsWith('highlightsList_')) {
    cache.highlightsList.set(key, {
      data,
      timestamp: Date.now(),
      ...extra
    });
    // Limit highlightsList cache size
    if (cache.highlightsList.size > 50) {
      const firstKey = cache.highlightsList.keys().next().value;
      cache.highlightsList.delete(firstKey);
    }
    return;
  }
  
  // For other caches, use direct property access
  cache[key] = {
    data,
    timestamp: Date.now(),
    ...extra
  };
}

/**
 * Get cache instance (for direct Map access)
 */
export function getCache() {
  return cache;
}

/**
 * Clear all caches
 */
export function clearAllCaches() {
  cache.bookList = { data: null, timestamp: 0, limit: 0, showAll: false };
  cache.topLevelBooks = { data: null, timestamp: 0, limit: 0 };
  cache.articleList.clear();
  cache.highlightsList.clear();
  cache.bookDetails.clear();
  cache.articleDetails.clear();
  cache.bookHierarchy.clear();
  cache.bookComments.clear();
  cache.userHandles.clear();
  cache.searchResults.clear();
  cache.generatedFiles.clear();
}

/**
 * Calculate total cache size
 */
export function calculateCacheSize() {
  let totalBytes = 0;
  const sizes = {
    bookList: 0,
    topLevelBooks: 0,
    articleList: 0,
    highlightsList: 0,
    bookDetails: 0,
    articleDetails: 0,
    bookHierarchy: 0,
    bookComments: 0,
    userHandles: 0,
    searchResults: 0,
    generatedFiles: 0
  };
  
  for (const [key, map] of Object.entries(cache)) {
    if (map instanceof Map) {
      let mapSize = 0;
      for (const [mapKey, value] of map.entries()) {
        mapSize += calculateObjectSize(mapKey);
        mapSize += calculateObjectSize(value);
      }
      if (key === 'bookList') sizes.bookList = mapSize;
      else if (key === 'topLevelBooks') sizes.topLevelBooks = mapSize;
      else if (key === 'articleList') sizes.articleList = mapSize;
      else if (key === 'highlightsList') sizes.highlightsList = mapSize;
      else if (key === 'bookDetails') sizes.bookDetails = mapSize;
      else if (key === 'articleDetails') sizes.articleDetails = mapSize;
      else if (key === 'bookHierarchy') sizes.bookHierarchy = mapSize;
      else if (key === 'bookComments') sizes.bookComments = mapSize;
      else if (key === 'userHandles') sizes.userHandles = mapSize;
      else if (key === 'searchResults') sizes.searchResults = mapSize;
      else if (key === 'generatedFiles') sizes.generatedFiles = mapSize;
      totalBytes += mapSize;
    } else if (typeof map === 'object' && map !== null) {
      const objSize = calculateObjectSize(map);
      if (key === 'bookList') sizes.bookList = objSize;
      else if (key === 'topLevelBooks') sizes.topLevelBooks = objSize;
      totalBytes += objSize;
    }
  }
  
  return { total: totalBytes, sizes };
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    bookDetails: cache.bookDetails.size,
    articleDetails: cache.articleDetails.size,
    bookHierarchy: cache.bookHierarchy.size,
    bookComments: cache.bookComments.size,
    searchResults: cache.searchResults.size,
    generatedFiles: cache.generatedFiles.size,
    articleList: cache.articleList.size,
    highlightsList: cache.highlightsList.size,
    topLevelBooks: cache.topLevelBooks.data ? cache.topLevelBooks.data.length : 0,
    topLevelBooksTimestamp: cache.topLevelBooks.timestamp ? new Date(cache.topLevelBooks.timestamp).toISOString() : null
  };
}

export { CACHE_TTL };
