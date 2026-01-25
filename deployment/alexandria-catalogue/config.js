/**
 * Configuration constants for Alexandria Catalogue
 */

export const PORT = process.env.EPUB_DOWNLOAD_PORT || process.argv[2] || 8092;
export const ASCIIDOCTOR_SERVER_URL = process.env.ASCIIDOCTOR_SERVER_URL || 'http://localhost:8091';

// OPTIMIZED: Extended cache TTLs for e-reader use cases
export const CACHE_TTL = {
  BOOK_LIST: 30 * 60 * 1000,      // 30 minutes (was 5)
  BOOK_DETAIL: 60 * 60 * 1000,    // 1 hour (was 10 minutes)
  SEARCH_RESULTS: 10 * 60 * 1000, // 10 minutes (was 2)
  GENERATED_FILES: 24 * 60 * 60 * 1000, // 24 hours (was 1 hour)
  ARTICLE_LIST: 30 * 60 * 1000,   // 30 minutes (was 5)
  ARTICLE_DETAIL: 60 * 60 * 1000, // 1 hour (was 10 minutes)
  HIGHLIGHTS_LIST: 30 * 60 * 1000, // 30 minutes (same as articles)
  USER_HANDLE: 60 * 60 * 1000     // 1 hour (user handles don't change often)
};

export const DEFAULT_RELAYS = [
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://nostr.wine',
  'wss://orly-relay.imwald.eu'
];

export const DEFAULT_ARTICLE_RELAYS = [
  'wss://theforest.nostr1.com',
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://nostr.wine'
];

export const ITEMS_PER_PAGE = 50;
export const DEFAULT_FETCH_LIMIT = 10000;
export const MAX_FETCH_LIMIT = 10000;
