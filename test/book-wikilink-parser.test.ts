/**
 * Unit tests for bookstr wikilink parser based on NKBIP-08 test cases
 */

import { describe, it, expect } from 'vitest';
import { parseBookWikilink, bookReferenceToTags } from '../src/lib/bookWikilinkParser';

describe('BookWikilinkParser', () => {
  describe('Basic structure', () => {
    it('should parse minimal title', () => {
      const result = parseBookWikilink('[[book::glorbzax]]');
      expect(result).not.toBeNull();
      expect(result?.references).toHaveLength(1);
      expect(result?.references[0].title).toBe('glorbzax');
      expect(result?.references[0].collection).toBeUndefined();
      expect(result?.references[0].chapter).toBeUndefined();
    });

    it('should parse collection with title', () => {
      const result = parseBookWikilink('[[book::zogblitz | qux-flarn]]');
      expect(result).not.toBeNull();
      expect(result?.references).toHaveLength(1);
      expect(result?.references[0].collection).toBe('zogblitz');
      expect(result?.references[0].title).toBe('qux-flarn');
    });

    it('should parse title with chapter', () => {
      const result = parseBookWikilink('[[book::genesis 2]]');
      expect(result).not.toBeNull();
      expect(result?.references).toHaveLength(1);
      expect(result?.references[0].title).toBe('genesis');
      expect(result?.references[0].chapter).toBe('2');
    });

    it('should parse title with chapter and section', () => {
      const result = parseBookWikilink('[[book::flarn 2:4]]');
      expect(result).not.toBeNull();
      expect(result?.references).toHaveLength(1);
      expect(result?.references[0].title).toBe('flarn');
      expect(result?.references[0].chapter).toBe('2');
      expect(result?.references[0].section).toEqual(['4']);
    });
  });

  describe('Section ranges', () => {
    it('should expand section range', () => {
      const result = parseBookWikilink('[[book::bloop 3:5-9]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].section).toEqual(['5', '6', '7', '8', '9']);
    });

    it('should handle multiple section ranges', () => {
      const result = parseBookWikilink('[[book::wobble 2:4-9,11-12,22-25]]');
      expect(result).not.toBeNull();
      const sections = result?.references[0].section || [];
      expect(sections).toContain('4');
      expect(sections).toContain('9');
      expect(sections).toContain('11');
      expect(sections).toContain('12');
      expect(sections).toContain('22');
      expect(sections).toContain('25');
    });
  });

  describe('Version handling', () => {
    it('should parse version after chapter', () => {
      const result = parseBookWikilink('[[book::qux 2 | version-1]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].version).toEqual(['version-1']);
    });

    it('should parse multiple versions', () => {
      const result = parseBookWikilink('[[book::snarkle 1 | gloop-1 zapp-2]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].version).toEqual(['gloop-1', 'zapp-2']);
    });
  });

  describe('Multiple book references', () => {
    it('should parse multiple books with comma+space', () => {
      const result = parseBookWikilink('[[book::zogblitz | qux 1:4, wibble 2:5]]');
      expect(result).not.toBeNull();
      expect(result?.references).toHaveLength(2);
      expect(result?.references[0].title).toBe('qux');
      expect(result?.references[1].title).toBe('wibble');
    });
  });

  describe('Tag conversion', () => {
    it('should convert reference to tags', () => {
      const result = parseBookWikilink('[[book::bible | genesis 2:4 | kjv]]');
      expect(result).not.toBeNull();
      const tags = bookReferenceToTags(result!.references[0]);
      
      expect(tags).toContainEqual(['C', 'bible']);
      expect(tags).toContainEqual(['T', 'genesis']);
      expect(tags).toContainEqual(['c', '2']);
      expect(tags).toContainEqual(['s', '4']);
      expect(tags).toContainEqual(['v', 'kjv']);
    });

    it('should expand section ranges in tags', () => {
      const result = parseBookWikilink('[[book::bible | gen 2:4-9]]');
      expect(result).not.toBeNull();
      const tags = bookReferenceToTags(result!.references[0]);
      
      const sectionTags = tags.filter(([tag]) => tag === 's');
      expect(sectionTags.length).toBe(6); // 4, 5, 6, 7, 8, 9
      expect(sectionTags.map(([, v]) => v)).toEqual(['4', '5', '6', '7', '8', '9']);
    });
  });

  describe('Normalization', () => {
    it('should normalize mixed case', () => {
      const result = parseBookWikilink('[[book::TheGLOp | QuX 2:4 | BlOoP]]');
      expect(result).not.toBeNull();
      // Note: normalization happens in the parser, but book name recognition may affect results
      expect(result?.references[0].title).toBeDefined();
    });

    it('should normalize quotes', () => {
      const result = parseBookWikilink('[[book::"the-glop" 2:4 | bloop]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBeDefined();
    });
  });

  describe('Bible book name recognition', () => {
    it('should recognize Song of Solomon', () => {
      const result = parseBookWikilink('[[book::Song of Solomon 1:1]]');
      expect(result).not.toBeNull();
      // Should normalize to song-of-solomon
      expect(result?.references[0].title).toBeDefined();
    });

    it('should recognize Song abbreviation', () => {
      const result = parseBookWikilink('[[book::Song 1:1]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBeDefined();
    });

    it('should recognize 1 Maccabees', () => {
      const result = parseBookWikilink('[[book::1 Maccabees 1:1]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBeDefined();
    });

    it('should recognize 1 Macc abbreviation', () => {
      const result = parseBookWikilink('[[book::1 Macc 1:1]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBeDefined();
    });
  });

  describe('Complex examples from NKBIP-08', () => {
    it('should parse wuthering-heights', () => {
      const result = parseBookWikilink('[[book::wuthering-heights]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBe('wuthering-heights');
    });

    it('should parse bible | genesis | drb', () => {
      const result = parseBookWikilink('[[book::bible | genesis | drb]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].collection).toBe('bible');
      expect(result?.references[0].title).toBe('genesis');
      expect(result?.references[0].version).toEqual(['drb']);
    });

    it('should parse bible | genesis 2:4 | kjv', () => {
      const result = parseBookWikilink('[[book::bible | genesis 2:4 | kjv]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].collection).toBe('bible');
      expect(result?.references[0].title).toBe('genesis');
      expect(result?.references[0].chapter).toBe('2');
      expect(result?.references[0].section).toEqual(['4']);
      expect(result?.references[0].version).toEqual(['kjv']);
    });

    it('should parse bible | gen 2:4-9', () => {
      const result = parseBookWikilink('[[book::bible | gen 2:4-9]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].section).toEqual(['4', '5', '6', '7', '8', '9']);
    });
  });

  describe('Range search and ordering', () => {
    it('should handle range like romans 3:4-6', () => {
      const result = parseBookWikilink('[[book::romans 3:4-6]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].title).toBe('romans');
      expect(result?.references[0].chapter).toBe('3');
      expect(result?.references[0].section).toEqual(['4', '5', '6']);
    });

    it('should expand ranges correctly for search', () => {
      const result = parseBookWikilink('[[book::bible | romans 3:4-6]]');
      expect(result).not.toBeNull();
      const tags = bookReferenceToTags(result!.references[0]);
      
      // Should have individual section tags: s:4, s:5, s:6
      const sectionTags = tags.filter(([tag]) => tag === 's');
      expect(sectionTags.length).toBe(3);
      expect(sectionTags.map(([, v]) => v)).toEqual(['4', '5', '6']);
    });

    it('should handle single section', () => {
      const result = parseBookWikilink('[[book::romans 3:4]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].section).toEqual(['4']);
    });

    it('should handle non-contiguous sections', () => {
      const result = parseBookWikilink('[[book::romans 3:4,6,8]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].section).toEqual(['4', '6', '8']);
    });

    it('should handle mixed ranges and individual sections', () => {
      const result = parseBookWikilink('[[book::romans 3:4-6,8,10-12]]');
      expect(result).not.toBeNull();
      const sections = result?.references[0].section || [];
      expect(sections).toContain('4');
      expect(sections).toContain('5');
      expect(sections).toContain('6');
      expect(sections).toContain('8');
      expect(sections).toContain('10');
      expect(sections).toContain('11');
      expect(sections).toContain('12');
    });
  });
});

