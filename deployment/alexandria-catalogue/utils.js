/**
 * Utility functions
 */

import { nip19 } from '@nostr/tools';

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text to max length
 */
export function truncate(text, maxLength = 200) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Format timestamp to readable date
 */
export function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Calculate approximate size of an object in bytes
 */
export function calculateObjectSize(obj) {
  if (obj === null || obj === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch (e) {
    return String(obj).length * 2; // Rough estimate
  }
}

/**
 * Set appropriate HTTP cache headers for different content types
 * Optimized for e-readers and performance
 */
export function setCacheHeaders(res, type = 'html', maxAge = 300) {
  const headers = {};
  
  switch (type) {
    case 'html':
      // HTML pages: short cache for dynamic content, allow revalidation
      headers['Cache-Control'] = `public, max-age=${maxAge}, must-revalidate`;
      headers['Vary'] = 'Accept';
      break;
    case 'static':
      // Static pages (home, status): longer cache
      headers['Cache-Control'] = `public, max-age=${maxAge}`;
      break;
    case 'dynamic':
      // Dynamic content (search results, book details): no cache or very short
      headers['Cache-Control'] = 'no-cache, must-revalidate';
      headers['Pragma'] = 'no-cache';
      break;
    case 'download':
      // Generated files: cache for 1 hour
      headers['Cache-Control'] = 'public, max-age=3600';
      break;
    case 'image':
      // Images: cache for 1 day
      headers['Cache-Control'] = 'public, max-age=86400';
      break;
    default:
      headers['Cache-Control'] = `public, max-age=${maxAge}`;
  }
  
  return headers;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Parse relay URLs from user input
 */
export function parseRelayUrls(input) {
  if (!input || typeof input !== 'string') {
    return [];
  }
  
  const rawUrls = input.split(/[,\n]/)
    .map(url => url.trim())
    .filter(url => url.length > 0);
  
  const validUrls = [];
  for (const url of rawUrls) {
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      try {
        const urlObj = new URL(url);
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
 * Check if input is a naddr
 */
export function isNaddr(input) {
  return input && input.startsWith('naddr1');
}

/**
 * Normalize text for exact matching (preserves accents)
 */
export function normalizeForExactMatch(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize text for fuzzy matching (removes accents)
 */
export function normalizeForSearch(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get book title from event tags
 */
export function getBookTitle(event) {
  return event.tags.find(([k]) => k === 'title')?.[1] || 
         event.tags.find(([k]) => k === 'T')?.[1] ||
         'Untitled';
}

/**
 * Get book author from event tags or encode pubkey
 */
export function getBookAuthor(event) {
  const author = event.tags.find(([k]) => k === 'author')?.[1];
  if (author) return author;
  return nip19.npubEncode(event.pubkey).substring(0, 16) + '...';
}

/**
 * Get book identifier (d tag or event ID)
 */
export function getBookIdentifier(event) {
  return event.tags.find(([k]) => k === 'd')?.[1] || event.id;
}
