import { describe, it, expect } from 'vitest';
import {
  parseBookNotation,
  generateBookSearchQuery
} from "../src/lib/books";
import { parseBookWikilink } from "../src/lib/bookWikilinkParser";

describe('Multiple Bible References', () => {
  describe('parseBookNotation with multiple references', () => {
    it('should parse multiple references separated by semicolons', () => {
      const result = parseBookNotation('Romans 1:16-25; Psalm 19:2-3', 'bible');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        book: 'Romans',
        chapter: 1,
        verse: '16-25'
      });
      expect(result[1]).toEqual({
        book: 'Psalms',
        chapter: 19,
        verse: '2-3'
      });
    });

    it('should parse daily reading format', () => {
      const result = parseBookNotation('Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41', 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('Romans');
      expect(result[1].book).toBe('Psalms');
      expect(result[2].book).toBe('Luke');
    });

    it('should parse version comparison format', () => {
      const result = parseBookNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB', 'bible');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        book: 'Romans',
        chapter: 1,
        verse: '16-25',
        version: 'KJV'
      });
      expect(result[1]).toEqual({
        book: 'Romans',
        chapter: 1,
        verse: '16-25',
        version: 'DRB'
      });
    });

    it('should handle mixed single and multiple references', () => {
      const result = parseBookNotation('John 3:16; Romans 1:16-25; Psalm 19:2-3, 4-5', 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].verse).toBe('16');
      expect(result[1].verse).toBe('16-25');
      expect(result[2].verse).toBe('2-3, 4-5');
    });
  });

  describe('parseBookWikilink with multiple references (NKBIP-08 format)', () => {
    it('should parse multiple references in wikilink', () => {
      const result = parseBookWikilink('[[book::bible | romans 1:16-25, psalms 19:2-3 | kjv]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.references[0].version).toEqual(['kjv']);
      expect(result!.references[0].title).toBe('romans');
      expect(result!.references[1].title).toBe('psalms');
    });

    it('should parse version comparison in wikilink', () => {
      const result = parseBookWikilink('[[book::bible | romans 1:16-25 | kjv, romans 1:16-25 | drb]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.references[0].title).toBe('romans');
      expect(result!.references[1].title).toBe('romans');
    });

    it('should parse daily reading format in wikilink', () => {
      const result = parseBookWikilink('[[book::bible | romans 1:16-25, psalms 19:2-3, luke 11:37-41]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(3);
    });
  });

  describe('generateBookSearchQuery with multiple references', () => {
    it('should generate multiple search queries for multiple references', () => {
      const references = [
        { book: 'Romans', chapter: 1, verse: '16-25' },
        { book: 'Psalms', chapter: 19, verse: '2-3' }
      ];
      const queries = generateBookSearchQuery(references, 'bible', 'KJV');
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('book:romans');
      expect(queries[0]).toContain('chapter:1');
      expect(queries[0]).toContain('verse:16-25');
      expect(queries[0]).toContain('version:kjv');
      
      expect(queries[1]).toContain('book:psalms');
      expect(queries[1]).toContain('chapter:19');
      expect(queries[1]).toContain('verse:2-3');
      expect(queries[1]).toContain('version:kjv');
    });

    it('should generate queries without version when not specified', () => {
      const references = [
        { book: 'Romans', chapter: 1, verse: '16-25' },
        { book: 'Psalms', chapter: 19, verse: '2-3' }
      ];
      const queries = generateBookSearchQuery(references, 'bible');
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).not.toContain('bible-version');
      expect(queries[1]).not.toContain('bible-version');
    });
  });

  describe('Version parsing without pipe', () => {
    it('should parse version without pipe separator', () => {
      const result = parseBookNotation('John 3:16 KJV', 'bible');
      expect(result).toHaveLength(1);
      expect(result[0].book).toBe('John');
      expect(result[0].chapter).toBe(3);
      expect(result[0].verse).toBe('16');
      expect(result[0].version).toBe('KJV');
    });

    it('should parse version with different abbreviations', () => {
      const result = parseBookNotation('Romans 1:16-25 DRB', 'bible');
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('DRB');
    });

    it('should parse multiple references with individual versions', () => {
      const result = parseBookNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB', 'bible');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe('KJV');
      expect(result[1].version).toBe('DRB');
    });

    it('should handle mixed version formats', () => {
      const result = parseBookNotation('John 3:16 KJV; Psalm 23:1 | NIV', 'bible');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe('KJV');
      expect(result[1].version).toBe('NIV');
    });
  });

  describe('Multiple versions with pipe (NKBIP-08 format)', () => {
    it('should parse multiple versions after pipe', () => {
      const result = parseBookWikilink('[[book::bible | john 3:16 | kjv drb]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(1);
      expect(result!.references[0].title).toBe('john');
      expect(result!.references[0].version).toEqual(['kjv', 'drb']);
    });

    it('should parse multiple versions with multiple references', () => {
      const result = parseBookWikilink('[[book::bible | romans 1:16-25, psalms 19:2-3 | kjv drb]]');
      expect(result).not.toBeNull();
      expect(result!.references).toHaveLength(2);
      expect(result!.references[0].version).toEqual(['kjv', 'drb']);
    });

    it('should generate multiple search queries for multiple versions', () => {
      const references = [{ book: 'John', chapter: 3, verse: '16' }];
      const queries = generateBookSearchQuery(references, 'bible', undefined, ['KJV', 'DRB']);
      
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('version:kjv');
      expect(queries[1]).toContain('version:drb');
    });
  });

  describe('Real-world use cases', () => {
    it('should handle daily lectionary readings', () => {
      const result = parseBookNotation('Romans 1:16-25; Psalm 19:2-3; Luke 11:37-41', 'bible');
      expect(result).toHaveLength(3);
      
      // Should generate 3 separate search queries
      const queries = generateBookSearchQuery(result, 'bible');
      expect(queries).toHaveLength(3);
    });

    it('should handle version comparison studies', () => {
      const result = parseBookNotation('Romans 1:16-25 KJV; Romans 1:16-25 DRB; Romans 1:16-25 NIV', 'bible');
      expect(result).toHaveLength(3);
      expect(result[0].book).toBe('Romans');
      expect(result[1].book).toBe('Romans');
      expect(result[2].book).toBe('Romans');
    });

    it('should handle mixed reference types', () => {
      const result = parseBookNotation('John 3:16; Romans 1; Psalm 19:2-3, 4-5; Genesis 1:1-5', 'bible');
      expect(result).toHaveLength(4);
      expect(result[0].verse).toBe('16');        // Single verse
      expect(result[1].verse).toBeUndefined();   // Chapter only
      expect(result[2].verse).toBe('2-3, 4-5');  // Multiple verse ranges
      expect(result[3].verse).toBe('1-5');       // Verse range
    });
  });
});
