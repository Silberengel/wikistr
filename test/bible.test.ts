import { describe, it, expect } from 'vitest';
import {
  parseBookNotation,
  isBookEvent,
  extractBookMetadata,
  generateBookTitle,
  generateBookSearchQuery,
  BOOK_TYPES
} from '../src/lib/books';
import { parseBookWikilink } from '../src/lib/bookWikilinkParser';

describe('Bible Notation Parsing', () => {
  it('should parse single verse reference', () => {
    const result = parseBookNotation('John 3:16', 'bible');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John',
      chapter: 3,
      verse: '16'
    });
  });

  it('should parse chapter-only reference', () => {
    const result = parseBookNotation('John 3', 'bible');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John',
      chapter: 3
    });
  });

  it('should parse book-only reference', () => {
    const result = parseBookNotation('John', 'bible');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John'
    });
  });

  it('should parse verse range', () => {
    const result = parseBookNotation('John 3:16-18', 'bible');
    expect(result).toHaveLength(1);
    expect(result[0].verse).toBe('16-18');
  });

  it('should parse multiple verses', () => {
    const result = parseBookNotation('John 3:16,18', 'bible');
    expect(result).toHaveLength(1);
    expect(result[0].verse).toBe('16,18');
  });

  it('should parse abbreviations', () => {
    const result = parseBookNotation('Jn 3:16', 'bible');
    expect(result[0].book).toBe('John');
  });

  it('should parse Turabian abbreviations', () => {
    expect(parseBookNotation('Gen 1:1', 'bible')[0].book).toBe('Genesis');
    expect(parseBookNotation('Exod 3:16', 'bible')[0].book).toBe('Exodus');
    expect(parseBookNotation('Ps 23:1', 'bible')[0].book).toBe('Psalms');
    expect(parseBookNotation('Rev 11:15', 'bible')[0].book).toBe('Revelation');
  });
});

describe('Bible Wikilink Parsing (NKBIP-08 format)', () => {
  it('should parse wikilink with version', () => {
    const result = parseBookWikilink('[[book::bible | john 3:16 | kjv]]');
    expect(result).not.toBeNull();
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].title).toBe('john');
    expect(result!.references[0].version).toEqual(['kjv']);
  });

  it('should parse wikilink without version', () => {
    const result = parseBookWikilink('[[book::bible | john 3:16]]');
    expect(result).not.toBeNull();
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].version).toBeUndefined();
  });

  it('should parse without collection', () => {
    const result = parseBookWikilink('[[book::john 3:16 | kjv]]');
    expect(result).not.toBeNull();
    expect(result!.references[0].title).toBe('john');
    expect(result!.references[0].version).toEqual(['kjv']);
  });
});

describe('Bible Event Detection', () => {
  it('should detect Kind 30041 with bible tags', () => {
    const event = {
      kind: 30041,
      tags: [
        ['type', 'bible'],
        ['book', 'John']
      ]
    };
    expect(isBookEvent(event as any, 'bible')).toBe(true);
  });

  it('should detect Kind 1 with bible tags', () => {
    const event = {
      kind: 1,
      tags: [
        ['type', 'bible'],
        ['book', 'John']
      ]
    };
    expect(isBookEvent(event as any, 'bible')).toBe(true);
  });

  it('should detect event with only book tag', () => {
    const event = {
      kind: 30041,
      tags: [['book', 'John']]
    };
    expect(isBookEvent(event as any, 'bible')).toBe(true);
  });

  it('should NOT detect Kind 1 with e tags only', () => {
    const event = {
      kind: 1,
      tags: [['e', 'someid']]
    };
    expect(isBookEvent(event as any, 'bible')).toBe(false);
  });

  it('should NOT detect Kind 30818', () => {
    const event = {
      kind: 30818,
      tags: [['subject', 'bible']]
    };
    expect(isBookEvent(event as any, 'bible')).toBe(false);
  });
});

describe('Bible Metadata Extraction', () => {
  it('should extract all metadata fields', () => {
    const event = {
      tags: [
        ['book', 'John'],
        ['chapter', '3'],
        ['verse', '16'],
        ['version', 'King James Version']
      ]
    };
    const metadata = extractBookMetadata(event as any);
    expect(metadata).toEqual({
      book: 'John',
      chapter: '3',
      verse: '16',
      version: 'King James Version'
    });
  });
});

describe('Bible Title Generation', () => {
  it('should generate title for verse', () => {
    const title = generateBookTitle({
      book: 'John',
      chapter: '3',
      verse: '16',
      version: 'King James Version'
    });
    expect(title).toBe('John 3:16 (King James Version)');
  });

  it('should generate title for chapter', () => {
    const title = generateBookTitle({
      book: 'John',
      chapter: '3'
    });
    expect(title).toBe('John 3');
  });

  it('should generate title for book', () => {
    const title = generateBookTitle({
      book: 'John'
    });
    expect(title).toBe('John');
  });
});

describe('Search Query Generation', () => {
  it('should generate query for verse with version', () => {
    const queries = generateBookSearchQuery([
      { book: 'John', chapter: 3, verse: '16' }
    ], 'bible', 'King James Version');
    expect(queries).toContain('type:bible book:john chapter:3 verse:16 version:king james version');
  });

  it('should generate query for chapter only', () => {
    const queries = generateBookSearchQuery([
      { book: 'John', chapter: 3 }
    ], 'bible');
    expect(queries[0]).toContain('book:john chapter:3');
    expect(queries[0]).not.toContain('verse');
  });
});

describe('Deuterocanonical Books Support', () => {
  it('should recognize Tobit', () => {
    const result = parseBookNotation('Tobit 1:1', 'bible');
    expect(result[0].book).toBe('Tobit');
  });

  it('should recognize Sirach abbreviation', () => {
    const result = parseBookNotation('Sir 1:1', 'bible');
    expect(result[0].book).toBe('Sirach');
  });

  it('should recognize Maccabees', () => {
    expect(parseBookNotation('1 Macc 1:1', 'bible')[0].book).toBe('1 Maccabees');
    expect(parseBookNotation('2 Maccabees 1:1', 'bible')[0].book).toBe('2 Maccabees');
  });
});

