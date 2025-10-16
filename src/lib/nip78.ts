/**
 * NIP-78: Arbitrary custom app data support for Wikistr
 * Handles book configuration events with kind 30078
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { pool } from '@nostr/gadgets/global';
import { relayService } from './relayService';
import type { BookType } from './books';

export interface BookConfiguration {
  id: string;
  pubkey: string;
  name: string;
  displayName: string;
  books: { [fullName: string]: string[] };
  versions: { [abbrev: string]: string };
  parsingRules: {
    bookPattern: string;
    chapterPattern: string;
    versePattern: string;
    versionPattern: string;
  };
  displayFormat: {
    bookChapterVerse: string; // Function as string for serialization
    withVersion: string; // Function as string for serialization
  };
  created_at: number;
  content: string;
}

export interface NIP78BookConfig {
  app: 'Wikistr';
  type: 'book-config';
  name: string;
  displayName: string;
  books: { [fullName: string]: string[] };
  versions: { [abbrev: string]: string };
  parsingRules: {
    bookPattern: string;
    chapterPattern: string;
    versePattern: string;
    versionPattern: string;
  };
  displayFormat: {
    bookChapterVerse: string;
    withVersion: string;
  };
}

/**
 * Parse NIP-78 book configuration from event content
 */
export function parseBookConfigFromEvent(event: NostrEvent): BookConfiguration | null {
  try {
    // Quick check: if content doesn't contain "Wikistr", skip parsing
    if (!event.content.includes('Wikistr')) {
      return null;
    }
    
    const content = JSON.parse(event.content);
    
    // Validate that this is a Wikistr book configuration
    if (content.app !== 'Wikistr' || content.type !== 'book-config') {
      return null;
    }
    
    // Validate required fields
    if (!content.name || !content.displayName || !content.books || !content.versions) {
      return null;
    }
    
    return {
      id: event.id,
      pubkey: event.pubkey,
      name: content.name,
      displayName: content.displayName,
      books: content.books,
      versions: content.versions,
      parsingRules: content.parsingRules || {
        bookPattern: '.*',
        chapterPattern: '^\\d+$',
        versePattern: '^\\d+(?:[-,\\s]\\d+)*$',
        versionPattern: '.*'
      },
      displayFormat: content.displayFormat || {
        bookChapterVerse: 'default',
        withVersion: 'default'
      },
      created_at: event.created_at,
      content: event.content
    };
  } catch (error) {
    console.error('Failed to parse NIP-78 book configuration:', error);
    return null;
  }
}

/**
 * Convert NIP-78 book configuration to BookType format
 */
export function convertToBookType(config: BookConfiguration): BookType {
  return {
    name: config.name,
    displayName: config.displayName,
    books: config.books,
    versions: config.versions,
    parsingRules: {
      bookPattern: new RegExp(config.parsingRules.bookPattern, 'i'),
      chapterPattern: new RegExp(config.parsingRules.chapterPattern),
      versePattern: new RegExp(config.parsingRules.versePattern),
      versionPattern: new RegExp(config.parsingRules.versionPattern, 'i')
    },
    displayFormat: {
      bookChapterVerse: createDisplayFunction(config.displayFormat.bookChapterVerse),
      withVersion: createWithVersionFunction(config.displayFormat.withVersion)
    }
  };
}

/**
 * Create display function from string representation
 */
function createDisplayFunction(format: string): (book: string, chapter?: number, verse?: string) => string {
  if (format === 'default') {
    return (book: string, chapter?: number, verse?: string) => {
      let formatted = book;
      if (chapter) {
        formatted += ` ${chapter}`;
        if (verse) {
          formatted += `:${verse}`;
        }
      }
      return formatted;
    };
  }
  
  // For now, return default function
  // In a full implementation, you might want to support more complex format strings
  return (book: string, chapter?: number, verse?: string) => {
    let formatted = book;
    if (chapter) {
      formatted += ` ${chapter}`;
      if (verse) {
        formatted += `:${verse}`;
      }
    }
    return formatted;
  };
}

/**
 * Create withVersion function from string representation
 */
function createWithVersionFunction(format: string): (ref: string, version?: string) => string {
  if (format === 'default') {
    return (ref: string, version?: string) => {
      return version ? `${ref} (${version})` : ref;
    };
  }
  
  // For now, return default function
  return (ref: string, version?: string) => {
    return version ? `${ref} (${version})` : ref;
  };
}

/**
 * Load book configurations from Nostr events
 */
export async function loadBookConfigurations(): Promise<BookConfiguration[]> {
  try {
    const result = await relayService.queryEvents(
      'anonymous',
      'arbitrary-ids-read',
      [{ kinds: [30078], limit: 100 }],
      { excludeUserContent: false, currentUserPubkey: undefined }
    );

    const configurations: BookConfiguration[] = [];
    for (const event of result.events) {
      if (event.kind === 30078) {
        const config = parseBookConfigFromEvent(event);
        if (config) {
          configurations.push(config);
        }
      }
    }
    
    return configurations;
  } catch (error) {
    console.error('Failed to load book configurations:', error);
    return [];
  }
}

/**
 * Create a NIP-78 book configuration event
 */
export function createBookConfigEvent(
  signer: any,
  config: NIP78BookConfig,
  dTag: string = 'wikistr-book-config'
): Promise<NostrEvent> {
  const eventTemplate = {
    kind: 30078,
    content: JSON.stringify(config),
    tags: [
      ['d', dTag],
      ['app', 'Wikistr'],
      ['type', 'book-config'],
      ['name', config.name]
    ],
    created_at: Math.floor(Date.now() / 1000)
  };
  
  return signer.signEvent(eventTemplate);
}

/**
 * Store for managing book configurations
 */
import { writable } from 'svelte/store';

export const bookConfigurations = writable<BookConfiguration[]>([]);
export const customBookTypes = writable<{ [name: string]: BookType }>({});

/**
 * Load and store book configurations
 */
export async function loadAndStoreBookConfigurations() {
  try {
    const configs = await loadBookConfigurations();
    bookConfigurations.set(configs);
    
    // Convert to BookType format and store
    const bookTypes: { [name: string]: BookType } = {};
    configs.forEach(config => {
      bookTypes[config.name] = convertToBookType(config);
    });
    customBookTypes.set(bookTypes);
    
    console.log(`Loaded ${configs.length} custom book configurations`);
  } catch (error) {
    console.error('Failed to load book configurations:', error);
  }
}
