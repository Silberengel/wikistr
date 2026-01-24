/**
 * Configuration constants for Alexandria Catalogue
 */

export const PORT = process.env.EPUB_DOWNLOAD_PORT || process.argv[2] || 8092;
export const ASCIIDOCTOR_SERVER_URL = process.env.ASCIIDOCTOR_SERVER_URL || 'http://localhost:8091';

export const CACHE_TTL = {
  BOOK_LIST: 5 * 60 * 1000,      // 5 minutes
  BOOK_DETAIL: 10 * 60 * 1000,   // 10 minutes
  SEARCH_RESULTS: 2 * 60 * 1000, // 2 minutes
  GENERATED_FILES: 60 * 60 * 1000 // 1 hour
};

export const DEFAULT_RELAYS = [
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://nostr.wine',
  'wss://orly-relay.imwald.eu'
];

export const ITEMS_PER_PAGE = 50;
export const DEFAULT_FETCH_LIMIT = 10000;
export const MAX_FETCH_LIMIT = 10000;
