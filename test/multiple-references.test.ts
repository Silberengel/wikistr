import { describe, it, expect } from 'vitest';
import {
  parseBibleNotation,
  parseBibleWikilink,
  generateBibleSearchQuery
} from '../src/lib/bible';

describe('Multiple Bible References', () => {
  describe('parseBibleNotation with multiple references', () => {
    it('should parse multiple references separated by semicolons', () => {
      const result = parseBibleNotation('Romans 1:16-25; Psalm 19:2-3');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        book: 'Romans',
        chapter: 1,
        verses: '16-25'
      });
      expect(result[1]).toEqual({
        book: 'Psalms',
        chapter: 19,
        verses: '2-3'
      });
    });

    it('should parse daily reading format', () => {
      const result = parseBibleNotation('Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('Romans');
      expect(result[1].book).toBe('Psalms');
      expect(result[2].book).toBe('Luke');
    });

    it('should parse version comparison format', () => {
      const result = parseBibleNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        book: 'Romans',
        chapter: 1,
        verses: '16-25',
        version: 'KJV'
      });
      expect(result[1]).toEqual({
        book: 'Romans',
        chapter: 1,
        verses: '16-25',
        version: 'DRB'
      });
    });

    it('should handle mixed single and multiple references', () => {
      const result = parseBibleNotation('John 3:16; Romans 1:16-25; Psalm 19:2-3, 4-5');
      expect(result).toHaveLength(3);
      expect(result[0].verses).toBe('16');
      expect(result[1].verses).toBe('16-25');
      expect(result[2].verses).toBe('2-3, 4-5');
    });
  });

  describe('parseBibleWikilink with multiple references', () => {
    it('should parse multiple references in wikilink', () => {
      const result = parseBibleWikilink('[[Romans 1:16-25; Psalm 19:2-3 | KJV]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.versions).toEqual(['KJV']);
      expect(result!.references[0].book).toBe('Romans');
      expect(result!.references[1].book).toBe('Psalms');
    });

    it('should parse version comparison in wikilink', () => {
      const result = parseBibleWikilink('[[Romans 1:16-25 KJV; Romans 1:16-25 DRB]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.versions).toBeUndefined();
      expect(result!.references[0].book).toBe('Romans');
      expect(result!.references[1].book).toBe('Romans');
    });

    it('should parse daily reading format in wikilink', () => {
      const result = parseBibleWikilink('[[Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(3);
      expect(result!.versions).toBeUndefined();
    });
  });

  describe('generateBibleSearchQuery with multiple references', () => {
    it('should generate multiple search queries for multiple references', () => {
      const references = [
        { book: 'Romans', chapter: 1, verses: '16-25' },
        { book: 'Psalms', chapter: 19, verses: '2-3' }
      ];
      const queries = generateBibleSearchQuery(references, 'KJV');
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('bible-book:romans');
      expect(queries[0]).toContain('bible-chapter:1');
      expect(queries[0]).toContain('bible-verses:16-25');
      expect(queries[0]).toContain('bible-version:kjv');
      
      expect(queries[1]).toContain('bible-book:psalms');
      expect(queries[1]).toContain('bible-chapter:19');
      expect(queries[1]).toContain('bible-verses:2-3');
      expect(queries[1]).toContain('bible-version:kjv');
    });

    it('should generate queries without version when not specified', () => {
      const references = [
        { book: 'Romans', chapter: 1, verses: '16-25' },
        { book: 'Psalms', chapter: 19, verses: '2-3' }
      ];
      const queries = generateBibleSearchQuery(references);
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).not.toContain('bible-version');
      expect(queries[1]).not.toContain('bible-version');
    });
  });

  describe('Version parsing without pipe', () => {
    it('should parse version without pipe separator', () => {
      const result = parseBibleNotation('John 3:16 KJV');
      expect(result).toHaveLength(1);
      expect(result[0].book).toBe('John');
      expect(result[0].chapter).toBe(3);
      expect(result[0].verses).toBe('16');
      expect(result[0].version).toBe('KJV');
    });

    it('should parse version with different abbreviations', () => {
      const result = parseBibleNotation('Romans 1:16-25 DRB');
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('DRB');
    });

    it('should parse multiple references with individual versions', () => {
      const result = parseBibleNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe('KJV');
      expect(result[1].version).toBe('DRB');
    });

    it('should handle mixed version formats', () => {
      const result = parseBibleNotation('John 3:16 KJV; Psalm 23:1 | NIV');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe('KJV');
      expect(result[1].version).toBe('NIV');
    });
  });

  describe('Multiple versions with pipe', () => {
    it('should parse multiple versions after pipe', () => {
      const result = parseBibleWikilink('[[John 3:16 | KJV DRB]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(1);
      expect(result!.references[0].book).toBe('John');
      expect(result!.versions).toEqual(['KJV', 'DRB']);
    });

    it('should parse multiple versions with multiple references', () => {
      const result = parseBibleWikilink('[[Romans 1:16-25; Psalm 19:2-3 | KJV DRB]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.versions).toEqual(['KJV', 'DRB']);
    });

    it('should generate multiple search queries for multiple versions', () => {
      const references = [{ book: 'John', chapter: 3, verses: '16' }];
      const queries = generateBibleSearchQuery(references, undefined, ['KJV', 'DRB']);
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('bible-version:kjv');
      expect(queries[1]).toContain('bible-version:drb');
    });
  });

  describe('Real-world use cases', () => {
    it('should handle daily lectionary readings', () => {
      const result = parseBibleNotation('Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41');
      expect(result).toHaveLength(3);
      
      // Should generate 3 separate search queries
      const queries = generateBibleSearchQuery(result);
      expect(queries).toHaveLength(3);
    });

    it('should handle version comparison studies', () => {
      const result = parseBibleNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB; Romans 1:16-25 NIV');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('Romans');
      expect(result[1].book).toBe('Romans');
      expect(result[2].book).toBe('Romans');
    });

    it('should handle mixed reference types', () => {
      const result = parseBibleNotation('John 3:16; Romans 1; Psalm 19:2-3, 4-5; Genesis 1:1-5');
      expect(result).toHaveLength(4);
      expect(result[0].verses).toBe('16');        // Single verse
      expect(result[1].verses).toBeUndefined();   // Chapter only
      expect(result[2].verses).toBe('2-3, 4-5');  // Multiple verse ranges
      expect(result[3].verses).toBe('1-5');       // Verse range
    });
  });
});
