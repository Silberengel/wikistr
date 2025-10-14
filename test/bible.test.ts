import { describe, it, expect } from 'vitest';
import {
  parseBibleWikilink,
  parseBibleNotation,
  isBibleEvent,
  extractBibleMetadata,
  generateBibleTitle,
  generateBibleSearchQuery,
  BIBLE_ABBREVIATIONS
} from '../src/lib/bible';

describe('Bible Notation Parsing', () => {
  it('should parse single verse reference', () => {
    const result = parseBibleNotation('John 3:16');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John',
      chapter: 3,
      verses: '16'
    });
  });

  it('should parse chapter-only reference', () => {
    const result = parseBibleNotation('John 3');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John',
      chapter: 3
    });
  });

  it('should parse book-only reference', () => {
    const result = parseBibleNotation('John');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      book: 'John'
    });
  });

  it('should parse verse range', () => {
    const result = parseBibleNotation('John 3:16-18');
    expect(result).toHaveLength(1);
    expect(result[0].verses).toBe('16-18');
  });

  it('should parse multiple verses', () => {
    const result = parseBibleNotation('John 3:16,18');
    expect(result).toHaveLength(1);
    expect(result[0].verses).toBe('16,18');
  });

  it('should parse abbreviations', () => {
    const result = parseBibleNotation('Jn 3:16');
    expect(result[0].book).toBe('John');
  });

  it('should parse Turabian abbreviations', () => {
    expect(parseBibleNotation('Gen 1:1')[0].book).toBe('Genesis');
    expect(parseBibleNotation('Exod 3:16')[0].book).toBe('Exodus');
    expect(parseBibleNotation('Ps 23:1')[0].book).toBe('Psalms');
    expect(parseBibleNotation('Rev 11:15')[0].book).toBe('Revelation');
  });
});

describe('Bible Wikilink Parsing', () => {
  it('should parse wikilink with version', () => {
    const result = parseBibleWikilink('[[John 3:16 | KJV]]');
    expect(result).not.toBeNull();
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].book).toBe('John');
    expect(result!.versions).toEqual(['KJV']);
  });

  it('should parse wikilink without version', () => {
    const result = parseBibleWikilink('[[John 3:16]]');
    expect(result).not.toBeNull();
    expect(result!.references).toHaveLength(1);
    expect(result!.versions).toBeUndefined();
  });

  it('should parse explicit bible prefix', () => {
    const result = parseBibleWikilink('[[bible:John 3:16 | KJV]]');
    expect(result).not.toBeNull();
    expect(result!.references[0].book).toBe('John');
    expect(result!.versions).toEqual(['KJV']);
  });
});

describe('Bible Event Detection', () => {
  it('should detect Kind 30041 with bible tags', () => {
    const event = {
      kind: 30041,
      tags: [
        ['type', 'bible'],
        ['bible-book', 'John']
      ]
    };
    expect(isBibleEvent(event as any)).toBe(true);
  });

  it('should detect Kind 1 with bible tags', () => {
    const event = {
      kind: 1,
      tags: [
        ['type', 'bible'],
        ['bible-book', 'John']
      ]
    };
    expect(isBibleEvent(event as any)).toBe(true);
  });

  it('should detect event with only bible-book tag', () => {
    const event = {
      kind: 30041,
      tags: [['bible-book', 'John']]
    };
    expect(isBibleEvent(event as any)).toBe(true);
  });

  it('should NOT detect Kind 1 with e tags only', () => {
    const event = {
      kind: 1,
      tags: [['e', 'someid']]
    };
    expect(isBibleEvent(event as any)).toBe(false);
  });

  it('should NOT detect Kind 30818', () => {
    const event = {
      kind: 30818,
      tags: [['subject', 'bible']]
    };
    expect(isBibleEvent(event as any)).toBe(false);
  });
});

describe('Bible Metadata Extraction', () => {
  it('should extract all metadata fields', () => {
    const event = {
      tags: [
        ['bible-book', 'John'],
        ['bible-chapter', '3'],
        ['bible-verses', '16'],
        ['bible-version', 'King James Version']
      ]
    };
    const metadata = extractBibleMetadata(event as any);
    expect(metadata).toEqual({
      book: 'John',
      chapter: '3',
      verses: '16',
      version: 'King James Version'
    });
  });
});

describe('Bible Title Generation', () => {
  it('should generate title for verse', () => {
    const title = generateBibleTitle({
      book: 'John',
      chapter: '3',
      verses: '16',
      version: 'King James Version'
    });
    expect(title).toBe('John 3:16 (King James Version)');
  });

  it('should generate title for chapter', () => {
    const title = generateBibleTitle({
      book: 'John',
      chapter: '3'
    });
    expect(title).toBe('John 3');
  });

  it('should generate title for book', () => {
    const title = generateBibleTitle({
      book: 'John'
    });
    expect(title).toBe('John');
  });
});

describe('Search Query Generation', () => {
  it('should generate query for verse with version', () => {
    const queries = generateBibleSearchQuery([
      { book: 'John', chapter: 3, verses: '16' }
    ], 'King James Version');
    expect(queries).toContain('type:bible bible-book:john bible-chapter:3 bible-verses:16 bible-version:king james version');
  });

  it('should generate query for chapter only', () => {
    const queries = generateBibleSearchQuery([
      { book: 'John', chapter: 3 }
    ]);
    expect(queries[0]).toContain('bible-book:john bible-chapter:3');
    expect(queries[0]).not.toContain('bible-verses');
  });
});

describe('Deuterocanonical Books Support', () => {
  it('should recognize Tobit', () => {
    const result = parseBibleNotation('Tobit 1:1');
    expect(result[0].book).toBe('Tobit');
  });

  it('should recognize Sirach abbreviation', () => {
    const result = parseBibleNotation('Sir 1:1');
    expect(result[0].book).toBe('Sirach');
  });

  it('should recognize Maccabees', () => {
    expect(parseBibleNotation('1 Macc 1:1')[0].book).toBe('1 Maccabees');
    expect(parseBibleNotation('2 Maccabees 1:1')[0].book).toBe('2 Maccabees');
  });
});

