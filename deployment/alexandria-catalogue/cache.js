/**
 * Cache management for Alexandria Catalogue
 */

import { CACHE_TTL } from './config.js';
import { calculateObjectSize, formatBytes } from './utils.js';

// In-memory cache
const cache = {
  bookList: { data: null, timestamp: 0, limit: 0, showAll: false },
  topLevelBooks: { data: null, timestamp: 0, limit: 0 },
  bookDetails: new Map(),
  bookHierarchy: new Map(),
  bookComments: new Map(),
  searchResults: new Map(),
  generatedFiles: new Map()
};

/**
 * Get cached data if still valid
 */
export function getCached(key, ttl) {
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
  cache.bookDetails.clear();
  cache.bookHierarchy.clear();
  cache.bookComments.clear();
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
    bookDetails: 0,
    bookHierarchy: 0,
    bookComments: 0,
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
      else if (key === 'bookDetails') sizes.bookDetails = mapSize;
      else if (key === 'bookHierarchy') sizes.bookHierarchy = mapSize;
      else if (key === 'bookComments') sizes.bookComments = mapSize;
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
    bookHierarchy: cache.bookHierarchy.size,
    bookComments: cache.bookComments.size,
    searchResults: cache.searchResults.size,
    generatedFiles: cache.generatedFiles.size,
    topLevelBooks: cache.topLevelBooks.data ? cache.topLevelBooks.data.length : 0,
    topLevelBooksTimestamp: cache.topLevelBooks.timestamp ? new Date(cache.topLevelBooks.timestamp).toISOString() : null
  };
}

export { CACHE_TTL };
