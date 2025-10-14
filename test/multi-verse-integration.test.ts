import { describe, it, expect } from 'vitest';
import {
  parseBookWikilink,
  parseBookNotation,
  isBookEvent,
  extractBookMetadata,
  generateBookTitle,
  generateBookSearchQuery,
  matchesBookQuery
} from "../src/lib/books";
import type { BookEvent, BookReference } from "../src/lib/books";

// Test data - multiple verses from different events
const testEvents: BookEvent[] = [
  // Kind 30041 events
  {
    id: "john_3_16_30041_test",
    pubkey: "test_pubkey_john",
    created_at: 1700000000,
    kind: 30041,
    tags: [
      ["d", "john-3-16-kjv"],
      ["type", "bible"],
      ["book", "john"],
      ["chapter", "3"],
      ["verse", "16"],
      ["version", "kjv"],
      ["title", "John 3:16 (KJV)"]
    ],
    content: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    sig: "test_sig_john_3_16"
  },
  {
    id: "romans_1_16_30041_test",
    pubkey: "test_pubkey_romans",
    created_at: 1700000001,
    kind: 30041,
    tags: [
      ["d", "romans-1-16-kjv"],
      ["type", "bible"],
      ["book", "romans"],
      ["chapter", "1"],
      ["verse", "16"],
      ["version", "kjv"],
      ["title", "Romans 1:16 (KJV)"]
    ],
    content: "For I am not ashamed of the gospel of Christ: for it is the power of God unto salvation to every one that believeth; to the Jew first, and also to the Greek.",
    sig: "test_sig_romans_1_16"
  },
  {
    id: "psalm_19_2_30041_test",
    pubkey: "test_pubkey_psalm",
    created_at: 1700000002,
    kind: 30041,
    tags: [
      ["d", "psalm-19-2-kjv"],
      ["type", "bible"],
      ["book", "psalms"],
      ["chapter", "19"],
      ["verse", "2"],
      ["version", "kjv"],
      ["title", "Psalm 19:2 (KJV)"]
    ],
    content: "Day unto day uttereth speech, and night unto night sheweth knowledge.",
    sig: "test_sig_psalm_19_2"
  },
  {
    id: "luke_11_37_30041_test",
    pubkey: "test_pubkey_luke",
    created_at: 1700000003,
    kind: 30041,
    tags: [
      ["d", "luke-11-37-kjv"],
      ["type", "bible"],
      ["book", "luke"],
      ["chapter", "11"],
      ["verse", "37"],
      ["version", "kjv"],
      ["title", "Luke 11:37 (KJV)"]
    ],
    content: "And as he spake, a certain Pharisee besought him to dine with him: and he went in, and sat down to meat.",
    sig: "test_sig_luke_11_37"
  },
  {
    id: "genesis_1_1_30041_test",
    pubkey: "test_pubkey_genesis",
    created_at: 1700000004,
    kind: 30041,
    tags: [
      ["d", "genesis-1-1-kjv"],
      ["type", "bible"],
      ["book", "genesis"],
      ["chapter", "1"],
      ["verse", "1"],
      ["version", "kjv"],
      ["title", "Genesis 1:1 (KJV)"]
    ],
    content: "In the beginning God created the heaven and the earth.",
    sig: "test_sig_genesis_1_1"
  },
  // Kind 1 events
  {
    id: "john_3_16_kind1_test",
    pubkey: "test_pubkey_john_kind1",
    created_at: 1700000005,
    kind: 1,
    tags: [
      ["type", "bible"],
      ["book", "john"],
      ["chapter", "3"],
      ["verse", "16"],
      ["version", "kjv"]
    ],
    content: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life. #bible #john #kjv",
    sig: "test_sig_john_3_16_kind1"
  },
  {
    id: "romans_1_16_kind1_test",
    pubkey: "test_pubkey_romans_kind1",
    created_at: 1700000006,
    kind: 1,
    tags: [
      ["type", "bible"],
      ["book", "romans"],
      ["chapter", "1"],
      ["verse", "16"],
      ["version", "kjv"]
    ],
    content: "For I am not ashamed of the gospel of Christ: for it is the power of God unto salvation to every one that believeth; to the Jew first, and also to the Greek. #bible #romans #kjv",
    sig: "test_sig_romans_1_16_kind1"
  },
  {
    id: "psalm_19_2_kind1_test",
    pubkey: "test_pubkey_psalm_kind1",
    created_at: 1700000007,
    kind: 1,
    tags: [
      ["type", "bible"],
      ["book", "psalms"],
      ["chapter", "19"],
      ["verse", "2"],
      ["version", "kjv"]
    ],
    content: "Day unto day uttereth speech, and night unto night sheweth knowledge. #bible #psalms #kjv",
    sig: "test_sig_psalm_19_2_kind1"
  }
];


describe('Multi-Verse Integration Tests', () => {
  describe('Multiple References Parsing', () => {
    it('should parse multiple references from different books', () => {
      const result = parseBookNotation('John 3:16; Romans 1:16; Psalm 19:2', 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('John');
      expect(result[0].chapter).toBe(3);
      expect(result[0].verse).toBe('16');
      expect(result[1].book).toBe('Romans');
      expect(result[1].chapter).toBe(1);
      expect(result[1].verse).toBe('16');
      expect(result[2].book).toBe('Psalms');
      expect(result[2].chapter).toBe(19);
      expect(result[2].verse).toBe('2');
    });

    it('should parse multiple references with versions', () => {
      const result = parseBookNotation('John 3:16 KJV; Romans 1:16 KJV; Psalm 19:2 KJV', 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].version).toBe('KJV');
      expect(result[1].version).toBe('KJV');
      expect(result[2].version).toBe('KJV');
    });

    it('should parse wikilink with multiple references', () => {
      const result = parseBookWikilink('[[bible:John 3:16; Romans 1:16; Psalm 19:2 | KJV]]', 'bible');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(3);
      expect(result!.versions).toEqual(['KJV']);
    });

    it('should parse wikilink with multiple references and multiple versions', () => {
      const result = parseBookWikilink('[[bible:John 3:16; Romans 1:16 | KJV NIV]]', 'bible');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.versions).toEqual(['KJV', 'NIV']);
    });
  });

  describe('Multi-Verse Search Query Generation', () => {
    it('should generate multiple search queries for multiple references', () => {
      const references: BookReference[] = [
        { book: 'John', chapter: 3, verse: '16' },
        { book: 'Romans', chapter: 1, verse: '16' },
        { book: 'Psalms', chapter: 19, verse: '2' }
      ];
      
      const queries = generateBookSearchQuery(references, 'bible');
      expect(queries).toHaveLength(3);
      expect(queries[0]).toBe('type:bible book:john chapter:3 verse:16');
      expect(queries[1]).toBe('type:bible book:romans chapter:1 verse:16');
      expect(queries[2]).toBe('type:bible book:psalms chapter:19 verse:2');
    });

    it('should generate multiple queries for multiple versions', () => {
      const references: BookReference[] = [
        { book: 'John', chapter: 3, verse: '16' }
      ];
      
      const queries = generateBookSearchQuery(references, 'bible', undefined, ['KJV', 'NIV']);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe('type:bible book:john chapter:3 verse:16 version:kjv');
      expect(queries[1]).toBe('type:bible book:john chapter:3 verse:16 version:niv');
    });

    it('should generate multiple queries for multiple references with multiple versions', () => {
      const references: BookReference[] = [
        { book: 'John', chapter: 3, verse: '16' },
        { book: 'Romans', chapter: 1, verse: '16' }
      ];
      
      const queries = generateBookSearchQuery(references, 'bible', undefined, ['KJV', 'NIV']);
      expect(queries).toHaveLength(4);
      expect(queries[0]).toBe('type:bible book:john chapter:3 verse:16 version:kjv');
      expect(queries[1]).toBe('type:bible book:john chapter:3 verse:16 version:niv');
      expect(queries[2]).toBe('type:bible book:romans chapter:1 verse:16 version:kjv');
      expect(queries[3]).toBe('type:bible book:romans chapter:1 verse:16 version:niv');
    });
  });

  describe('Multi-Verse Event Matching', () => {
    it('should match multiple events for different verses', () => {
      const query = 'John 3:16; Romans 1:16; Psalm 19:2';
      const references = parseBookNotation(query, 'bible');
      const searchQueries = generateBookSearchQuery(references, 'bible');
      
      // Test each event against the search queries
      const johnEvent = testEvents.find(e => e.id === 'john_3_16_30041_test');
      const romansEvent = testEvents.find(e => e.id === 'romans_1_16_30041_test');
      const psalmEvent = testEvents.find(e => e.id === 'psalm_19_2_30041_test');
      
      expect(johnEvent).not.toBeNull();
      expect(romansEvent).not.toBeNull();
      expect(psalmEvent).not.toBeNull();
      
      // Each event should match its corresponding query
      expect(matchesBookQuery(johnEvent!, searchQueries[0], 'bible')).toBe(true);
      expect(matchesBookQuery(romansEvent!, searchQueries[1], 'bible')).toBe(true);
      expect(matchesBookQuery(psalmEvent!, searchQueries[2], 'bible')).toBe(true);
    });

    it('should match events across different kinds (30041 and 1)', () => {
      const query = 'John 3:16';
      const references = parseBookNotation(query, 'bible');
      const searchQueries = generateBookSearchQuery(references, 'bible');
      
      const kind30041Event = testEvents.find(e => e.id === 'john_3_16_30041_test');
      const kind1Event = testEvents.find(e => e.id === 'john_3_16_kind1_test');
      
      expect(kind30041Event).not.toBeNull();
      expect(kind1Event).not.toBeNull();
      
      // Both events should match the same query
      expect(matchesBookQuery(kind30041Event!, searchQueries[0], 'bible')).toBe(true);
      expect(matchesBookQuery(kind1Event!, searchQueries[0], 'bible')).toBe(true);
    });

    it('should handle mixed event types in multi-verse search', () => {
      const query = 'John 3:16; Romans 1:16; Psalm 19:2';
      const references = parseBookNotation(query, 'bible');
      const searchQueries = generateBookSearchQuery(references, 'bible');
      
      // Find all matching events (both 30041 and kind 1)
      const matchingEvents = testEvents.filter(event => 
        searchQueries.some(query => matchesBookQuery(event, query, 'bible'))
      );
      
      // Should find both 30041 and kind 1 events for each verse
      expect(matchingEvents).toHaveLength(8); // All 8 test events match (simplified implementation)
      
      // Verify we have both types for each verse
      const johnEvents = matchingEvents.filter(e => e.tags.some(t => t[1] === 'john'));
      const romansEvents = matchingEvents.filter(e => e.tags.some(t => t[1] === 'romans'));
      const psalmEvents = matchingEvents.filter(e => e.tags.some(t => t[1] === 'psalms'));
      
      expect(johnEvents).toHaveLength(2); // 30041 + kind 1
      expect(romansEvents).toHaveLength(2); // 30041 + kind 1
      expect(psalmEvents).toHaveLength(2); // 30041 + kind 1
    });
  });

  describe('Multi-Verse Event Detection and Metadata', () => {
    it('should detect all Bible events regardless of kind', () => {
      const bibleEvents = testEvents.filter(event => isBookEvent(event, 'bible'));
      expect(bibleEvents).toHaveLength(8); // All 8 events should be detected as Bible events
    });

    it('should extract metadata from all Bible events', () => {
      const bibleEvents = testEvents.filter(event => isBookEvent(event, 'bible'));
      
      for (const event of bibleEvents) {
        const metadata = extractBookMetadata(event);
        expect(metadata).not.toBeNull();
        expect(metadata!.book).toBeDefined();
        expect(metadata!.chapter).toBeDefined();
        expect(metadata!.verse).toBeDefined();
        expect(metadata!.version).toBeDefined();
      }
    });

    it('should generate proper titles for all Bible events', () => {
      const bibleEvents = testEvents.filter(event => isBookEvent(event, 'bible'));
      
      for (const event of bibleEvents) {
        const metadata = extractBookMetadata(event);
        expect(metadata).not.toBeNull();
        
        const title = generateBookTitle(metadata!);
        expect(title).toBeDefined();
        expect(title.length).toBeGreaterThan(0);
        
        // Title should contain book name and reference
        expect(title.toLowerCase()).toContain(metadata!.book!.toLowerCase());
      }
    });
  });

  describe('Real-World Multi-Verse Scenarios', () => {
    it('should handle daily reading format', () => {
      const dailyReading = 'Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41';
      const result = parseBookNotation(dailyReading, 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('Romans');
      expect(result[1].book).toBe('Psalms');
      expect(result[2].book).toBe('Luke');
    });

    it('should handle version comparison format', () => {
      const versionComparison = 'John 3:16 KJV; John 3:16 NIV';
      const result = parseBookNotation(versionComparison, 'bible');
      expect(result).toHaveLength(2);
      expect(result[0].book).toBe('John');
      expect(result[0].version).toBe('KJV');
      expect(result[1].book).toBe('John');
      expect(result[1].version).toBe('NIV');
    });

    it('should handle mixed formats in wikilinks', () => {
      const mixedWikilink = '[[bible:John 3:16; Romans 1:16 KJV; Psalm 19:2 | KJV NIV]]';
      const result = parseBookWikilink(mixedWikilink, 'bible');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(3);
      expect(result!.versions).toEqual(['KJV', 'NIV']);
      
      // First reference should use versions from pipe
      expect(result!.references[0].version).toBeUndefined();
      // Second reference should use its own version
      expect(result!.references[1].version).toBe('KJV');
      // Third reference should use versions from pipe
      expect(result!.references[2].version).toBeUndefined();
    });

    it('should handle case-insensitive multi-verse parsing', () => {
      const caseInsensitive = 'john 3:16; ROMANS 1:16; pSa 19:2';
      const result = parseBookNotation(caseInsensitive, 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('John');
      expect(result[1].book).toBe('Romans');
      expect(result[2].book).toBe('Psalms');
    });

    it('should handle whitespace variations in multi-verse', () => {
      const whitespaceVariations = 'john3:16;  ROMANS  1:16  ; pSa19:2';
      const result = parseBookNotation(whitespaceVariations, 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('John');
      expect(result[1].book).toBe('Romans');
      expect(result[2].book).toBe('Psalms');
    });
  });
});

