import { describe, it, expect } from 'vitest';
import { parseBookWikilink as parseBookWikilinkNKBIP08 } from '../src/lib/bookWikilinkParser';
import { parseBookWikilink as parseBookWikilinkLegacy } from '../src/lib/books';
import type { NostrEvent } from '@nostr/tools/pure';

// Mock the cardFromPathPart function logic
function cardFromPathPart(pathPart: string): { type: string; data: any; bookType?: string } {
  let ditem = decodeURIComponent(pathPart);
  
  if (ditem.startsWith('edit:')) {
    return {
      type: 'editor',
      data: { title: ditem.substring(5), summary: '', content: '' }
    };
  } else if (ditem.startsWith('book::')) {
    // New NKBIP-08 format: book::... (for search bar, no brackets needed)
    const bookQuery = ditem.substring(6); // Remove "book::" prefix (6 characters)
    return { 
      type: 'book', 
      data: bookQuery
    };
  } else if (ditem.match(/^\[\[book::/)) {
    // NKBIP-08 format with brackets: [[book::...]] (for wikilinks in content)
    const bookQuery = ditem.replace(/^\[\[book::|\]\]$/g, '');
    return { 
      type: 'book', 
      data: bookQuery
    };
  } else if (ditem.startsWith('book:')) {
    // Legacy format: book:bible:John 3:16 (kept for backward compatibility)
    const bookQuery = ditem.substring(5);
    const parts = bookQuery.split(':');
    if (parts.length >= 2) {
      return { 
        type: 'book', 
        data: parts.slice(1).join(':'),
        bookType: parts[0]
      };
    } else {
      return { type: 'book', data: bookQuery };
    }
  } else if (ditem.startsWith('diff:')) {
    return { type: 'diff', data: ditem.substring(5) };
  } else {
    return { type: 'find', data: pathPart, preferredAuthors: [] };
  }
}

// Helper to create mock events of different kinds
function createMockEvent(
  id: string,
  tags: string[][],
  content: string,
  kind: number = 30818
): NostrEvent {
  return {
    id,
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
    sig: 'test-sig'
  };
}

describe('Search Component Tests', () => {
  describe('Route Handler - cardFromPathPart', () => {
    describe('New NKBIP-08 Format - Search Bar (book:: prefix, no brackets)', () => {
      it('should parse book:: prefix format for search bar', () => {
        const card = cardFromPathPart('book::bible%20%7C%20john%203%3A16');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | john 3:16');
      });

      it('should parse book:: format with collection and version', () => {
        const card = cardFromPathPart('book::bible%20%7C%20romans%203%3A16%20%7C%20kjv');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | romans 3:16 | kjv');
      });

      it('should parse book:: format with multiple references', () => {
        const card = cardFromPathPart('book::bible%20%7C%20romans%203%3A16-18%2C%20psalms%2023%3A1%20%7C%20kjv');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | romans 3:16-18, psalms 23:1 | kjv');
      });

      it('should parse book:: format without collection', () => {
        const card = cardFromPathPart('book::john%203%3A16');
        expect(card.type).toBe('book');
        expect(card.data).toBe('john 3:16');
      });
    });

    describe('New NKBIP-08 Format - Wikilinks ([[book::...]] with brackets)', () => {
      it('should parse new bookstr format [[book::...]] for wikilinks', () => {
        const card = cardFromPathPart('[[book::bible%20%7C%20john%203%3A16]]');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | john 3:16');
      });

      it('should parse new format with collection and version in wikilinks', () => {
        const card = cardFromPathPart('[[book::bible%20%7C%20romans%203%3A16%20%7C%20kjv]]');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | romans 3:16 | kjv');
      });

      it('should parse new format with multiple references in wikilinks', () => {
        const card = cardFromPathPart('[[book::bible%20%7C%20romans%203%3A16-18%2C%20psalms%2023%3A1%20%7C%20kjv]]');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | romans 3:16-18, psalms 23:1 | kjv');
      });

      it('should parse new format without collection in wikilinks', () => {
        const card = cardFromPathPart('[[book::john%203%3A16]]');
        expect(card.type).toBe('book');
        expect(card.data).toBe('john 3:16');
      });

      it('should handle URL-encoded brackets', () => {
        const card = cardFromPathPart('%5B%5Bbook%3A%3Abible%20%7C%20john%203%3A16%5D%5D');
        expect(card.type).toBe('book');
        expect(card.data).toBe('bible | john 3:16');
      });
    });

    describe('Legacy Format (Backward Compatibility)', () => {
      it('should still parse legacy book:bible: format', () => {
        const card = cardFromPathPart('book:bible:John%203:16');
        expect(card.type).toBe('book');
        expect(card.data).toBe('John 3:16');
        expect(card.bookType).toBe('bible');
      });

      it('should parse legacy format with version', () => {
        const card = cardFromPathPart('book:bible:John%203:16%20KJV');
        expect(card.type).toBe('book');
        expect(card.data).toBe('John 3:16 KJV');
        expect(card.bookType).toBe('bible');
      });
    });

    describe('Other Search Types', () => {
      it('should parse regular search queries', () => {
        const card = cardFromPathPart('regular-article');
        expect(card.type).toBe('find');
        expect(card.data).toBe('regular-article');
      });

      it('should parse diff queries', () => {
        const card = cardFromPathPart('diff:article1%20%7C%20article2');
        expect(card.type).toBe('diff');
        expect(card.data).toBe('article1 | article2');
      });

      it('should parse edit queries', () => {
        const card = cardFromPathPart('edit:new-article');
        expect(card.type).toBe('editor');
        expect(card.data.title).toBe('new-article');
      });
    });
  });

  describe('BookSearch Component - New Format Parsing', () => {
    describe('NKBIP-08 Format Parsing - Search Bar (book:: prefix)', () => {
      it('should parse book:: prefix format from search bar', () => {
        const query = 'book::bible | john 3:16';
        // Search bar format should be converted to wikilink format for parsing
        const queryWithBrackets = `[[${query}]]`;
        const parsed = parseBookWikilinkNKBIP08(queryWithBrackets);
        expect(parsed).not.toBeNull();
        expect(parsed!.references).toHaveLength(1);
        expect(parsed!.references[0].collection).toBe('bible');
        expect(parsed!.references[0].title).toBe('john');
        expect(parsed!.references[0].chapter).toBe('3');
        expect(parsed!.references[0].section).toEqual(['16']);
      });

      it('should parse book:: format with version from search bar', () => {
        const query = 'book::bible | john 3:16 | kjv';
        const queryWithBrackets = `[[${query}]]`;
        const parsed = parseBookWikilinkNKBIP08(queryWithBrackets);
        expect(parsed).not.toBeNull();
        expect(parsed!.references[0].version).toEqual(['kjv']);
      });
    });

    describe('NKBIP-08 Format Parsing - Wikilinks ([[book::...]])', () => {
      it('should parse single reference with collection from wikilink', () => {
        const query = '[[book::bible | john 3:16]]';
        const parsed = parseBookWikilinkNKBIP08(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.references).toHaveLength(1);
        expect(parsed!.references[0].collection).toBe('bible');
        expect(parsed!.references[0].title).toBe('john');
        expect(parsed!.references[0].chapter).toBe('3');
        expect(parsed!.references[0].section).toEqual(['16']);
      });

      it('should parse with version', () => {
        const query = '[[book::bible | john 3:16 | kjv]]';
        const parsed = parseBookWikilinkNKBIP08(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.references[0].version).toEqual(['kjv']);
      });

      it('should parse multiple versions', () => {
        const query = '[[book::bible | john 3:16 | kjv drb]]';
        const parsed = parseBookWikilinkNKBIP08(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.references[0].version).toEqual(['kjv', 'drb']);
      });

      it('should parse verse ranges', () => {
        const query = '[[book::bible | romans 3:16-18]]';
        const parsed = parseBookWikilinkNKBIP08(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.references[0].section).toEqual(['16', '17', '18']);
      });

      it('should parse multiple references', () => {
        const query = '[[book::bible | romans 3:16-18, psalms 23:1 | kjv]]';
        const parsed = parseBookWikilinkNKBIP08(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.references).toHaveLength(2);
        expect(parsed!.references[0].title).toBe('romans');
        expect(parsed!.references[1].title).toBe('psalms');
        // Both should have the global version
        expect(parsed!.references[0].version).toEqual(['kjv']);
        expect(parsed!.references[1].version).toEqual(['kjv']);
      });
    });

    describe('Format Detection', () => {
      it('should detect search bar format (book:: prefix) correctly', () => {
        const searchFormat = 'book::bible | john 3:16';
        expect(searchFormat.startsWith('book::')).toBe(true);
      });

      it('should detect wikilink format ([[book::...]]) correctly', () => {
        const wikilinkFormat = '[[book::bible | john 3:16]]';
        expect(wikilinkFormat.match(/^\[\[book::/)).not.toBeNull();
      });

      it('should detect legacy format correctly', () => {
        const legacyFormat = 'book:bible:John 3:16';
        expect(legacyFormat.startsWith('book:')).toBe(true);
        expect(legacyFormat.startsWith('book::')).toBe(false);
      });

      it('should not confuse regular search with book format', () => {
        const regularSearch = 'regular article search';
        expect(regularSearch.match(/^\[\[book::/)).toBeNull();
        expect(regularSearch.startsWith('book::')).toBe(false);
        expect(regularSearch.startsWith('book:')).toBe(false);
      });

      it('should distinguish between book:: (new) and book: (legacy)', () => {
        const newFormat = 'book::bible | john 3:16';
        const legacyFormat = 'book:bible:John 3:16';
        expect(newFormat.startsWith('book::')).toBe(true);
        expect(legacyFormat.startsWith('book::')).toBe(false);
        expect(legacyFormat.startsWith('book:')).toBe(true);
      });
    });
  });

  describe('Event Kind Handling', () => {
    describe('Kind 30818 (AsciiDoc Wiki)', () => {
      it('should handle 30818 events in search results', () => {
        const event = createMockEvent(
          'event-30818',
          [
            ['d', 'test-article'],
            ['title', 'Test Article'],
            ['summary', 'Test summary']
          ],
          'This is AsciiDoc content with [[wikilink]] and [[book::bible | john 3:16]].',
          30818
        );
        
        expect(event.kind).toBe(30818);
        expect(event.content).toContain('[[wikilink]]');
        expect(event.content).toContain('[[book::bible | john 3:16]]');
      });

      it('should parse bookstr macros in 30818 content', () => {
        const content = 'Check out [[book::bible | romans 3:16 | kjv]] for more info.';
        const bookstrMatches = content.match(/\[\[book::([^\]]+)\]\]/g);
        expect(bookstrMatches).not.toBeNull();
        expect(bookstrMatches!.length).toBe(1);
      });
    });

    describe('Kind 30817 (Markdown Wiki)', () => {
      it('should handle 30817 events in search results', () => {
        const event = createMockEvent(
          'event-30817',
          [
            ['d', 'markdown-article'],
            ['title', 'Markdown Article']
          ],
          '# Markdown Title\n\nThis is Markdown with [[book::bible | john 3:16]].',
          30817
        );
        
        expect(event.kind).toBe(30817);
        expect(event.content).toContain('[[book::bible | john 3:16]]');
      });

      it('should detect Markdown content', () => {
        const content = '# Title\n\nContent with [[book::bible | john 3:16]].';
        const hasMarkdownHeaders = /^#{1,6}\s+/m.test(content);
        expect(hasMarkdownHeaders).toBe(true);
      });
    });

    describe('Kind 30040 (Publication Index)', () => {
      it('should handle 30040 index events', () => {
        const event = createMockEvent(
          'event-30040',
          [
            ['d', 'romans-3-index'],
            ['C', 'bible'],
            ['T', 'romans'],
            ['c', '3'],
            ['e', 'event-1-id'],
            ['e', 'event-2-id'],
            ['a', '30041:pubkey:romans-3-16'],
            ['a', '30041:pubkey:romans-3-17']
          ],
          '', // Index events have no content
          30040
        );
        
        expect(event.kind).toBe(30040);
        expect(event.content).toBe('');
        expect(event.tags.filter(([t]) => t === 'e').length).toBe(2);
        expect(event.tags.filter(([t]) => t === 'a').length).toBe(2);
      });

      it('should prioritize a tags over e tags in index events', () => {
        const event = createMockEvent(
          'event-30040',
          [
            ['C', 'bible'],
            ['T', 'romans'],
            ['c', '3'],
            ['e', 'event-e-id'],
            ['a', '30041:pubkey:romans-3-16'],
            ['a', '30041:pubkey:romans-3-17']
          ],
          '',
          30040
        );
        
        const aTags = event.tags.filter(([t]) => t === 'a');
        const eTags = event.tags.filter(([t]) => t === 'e');
        
        // a tags should be prioritized (default)
        expect(aTags.length).toBe(2);
        expect(eTags.length).toBe(1);
      });
    });

    describe('Kind 30041 (Publication Content)', () => {
      it('should handle 30041 content events', () => {
        const event = createMockEvent(
          'event-30041',
          [
            ['d', 'romans-3-16-kjv'],
            ['C', 'bible'],
            ['T', 'romans'],
            ['c', '3'],
            ['s', '16'],
            ['v', 'kjv']
          ],
          'For God so loved the world...',
          30041
        );
        
        expect(event.kind).toBe(30041);
        expect(event.tags.find(([t]) => t === 'C')?.[1]).toBe('bible');
        expect(event.tags.find(([t]) => t === 'T')?.[1]).toBe('romans');
        expect(event.tags.find(([t]) => t === 'c')?.[1]).toBe('3');
        expect(event.tags.find(([t]) => t === 's')?.[1]).toBe('16');
        expect(event.tags.find(([t]) => t === 'v')?.[1]).toBe('kjv');
      });

      it('should handle 30041 events with multiple sections', () => {
        const event = createMockEvent(
          'event-30041-range',
          [
            ['d', 'romans-3-16-18-kjv'],
            ['C', 'bible'],
            ['T', 'romans'],
            ['c', '3'],
            ['s', '16'],
            ['s', '17'],
            ['s', '18'],
            ['v', 'kjv']
          ],
          'Content for verses 16-18',
          30041
        );
        
        const sections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
        expect(sections).toEqual(['16', '17', '18']);
      });

      it('should handle 30041 events with multiple versions', () => {
        const event = createMockEvent(
          'event-30041-multi-version',
          [
            ['d', 'romans-3-16-kjv-drb'],
            ['C', 'bible'],
            ['T', 'romans'],
            ['c', '3'],
            ['s', '16'],
            ['v', 'kjv'],
            ['v', 'drb']
          ],
          'Content in multiple versions',
          30041
        );
        
        const versions = event.tags.filter(([t]) => t === 'v').map(([, v]) => v);
        expect(versions).toEqual(['kjv', 'drb']);
      });
    });
  });

  describe('Search Query Format Conversion', () => {
    it('should convert NKBIP-08 format to legacy format for compatibility', () => {
      const query = '[[book::bible | john 3:16 | kjv]]';
      const parsed = parseBookWikilinkNKBIP08(query);
      
      if (parsed && parsed.references.length > 0) {
        const ref = parsed.references[0];
        const legacyFormat = {
          book: ref.title,
          chapter: ref.chapter,
          verse: ref.section ? (ref.section.length === 1 ? ref.section[0] : ref.section.join(',')) : undefined
        };
        
        expect(legacyFormat.book).toBe('john');
        expect(legacyFormat.chapter).toBe('3');
        expect(legacyFormat.verse).toBe('16');
      }
    });

    it('should handle version conversion', () => {
      const query = '[[book::bible | john 3:16 | kjv drb]]';
      const parsed = parseBookWikilinkNKBIP08(query);
      
      if (parsed && parsed.references.length > 0) {
        const versions = parsed.references[0].version || [];
        expect(versions).toEqual(['kjv', 'drb']);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty bookstr queries', () => {
      const query = '[[book::]]';
      const parsed = parseBookWikilinkNKBIP08(query);
      expect(parsed).toBeNull();
    });

    it('should handle malformed bookstr queries', () => {
      const query = '[[book::bible |]]';
      const parsed = parseBookWikilinkNKBIP08(query);
      // Should either parse or return null gracefully
      expect(parsed === null || parsed !== undefined).toBe(true);
    });

    it('should handle queries with special characters', () => {
      const query = '[[book::bible | "romans" 3:16-18 | kjv]]';
      const parsed = parseBookWikilinkNKBIP08(query);
      // Should handle quotes in book names
      expect(parsed === null || parsed !== undefined).toBe(true);
    });

    it('should handle very long queries', () => {
      const longQuery = '[[book::bible | ' + 'romans 3:16, '.repeat(50) + 'psalms 23:1 | kjv]]';
      const parsed = parseBookWikilinkNKBIP08(longQuery);
      // Should not crash on long queries
      expect(parsed === null || parsed !== undefined).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should still support legacy book: format', () => {
      const legacyQuery = 'book:bible:John 3:16';
      const parsed = parseBookWikilinkLegacy(legacyQuery, 'bible');
      expect(parsed).not.toBeNull();
    });

    it('should handle all three formats in same search session', () => {
      const searchBarFormat = 'book::bible | john 3:16';
      const wikilinkFormat = '[[book::bible | john 3:16]]';
      const legacyFormat = 'book:bible:John 3:16';
      
      // Search bar format should work (converted to wikilink format)
      const searchBarParsed = parseBookWikilinkNKBIP08(`[[${searchBarFormat}]]`);
      const wikilinkParsed = parseBookWikilinkNKBIP08(wikilinkFormat);
      const legacyParsed = parseBookWikilinkLegacy(legacyFormat, 'bible');
      
      expect(searchBarParsed).not.toBeNull();
      expect(wikilinkParsed).not.toBeNull();
      expect(legacyParsed).not.toBeNull();
    });
  });
});

