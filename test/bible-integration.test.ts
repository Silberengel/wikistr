import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isBookEvent,
  extractBookMetadata,
  generateBookTitle,
  parseBookWikilink
} from "../src/lib/books";

// Helper function to load test events
function loadTestEvent(filename: string) {
  const filePath = join(__dirname, filename);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

describe('Bible Integration Tests with Real Test Files', () => {
  describe('Kind 30041 Bible Events', () => {
    it('should detect exodus_3_16_30041.json as Bible event', () => {
      const event = loadTestEvent('exodus_3_16_30041.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
    });

    it('should extract metadata from exodus_3_16_30041.json', () => {
      const event = loadTestEvent('exodus_3_16_30041.json');
      const metadata = extractBookMetadata(event);
      expect(metadata.book).toBe('Exodus');
      expect(metadata.chapter).toBe('3');
      expect(metadata.verse).toBe('16');
      expect(metadata.version).toBe('King James Version');
    });

    it('should generate title for exodus_3_16_30041.json', () => {
      const event = loadTestEvent('exodus_3_16_30041.json');
      const metadata = extractBookMetadata(event);
      const title = generateBookTitle(metadata);
      expect(title).toBe('Exodus 3:16 (King James Version)');
    });

    it('should detect john_3_16_30041.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_30041.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
    });

    it('should detect john_3_16_niv_30041.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_niv_30041.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
      const metadata = extractBookMetadata(event);
      expect(metadata.version).toBe('New International Version');
    });

    it('should detect revelation_11_15_30041.json as Bible event', () => {
      const event = loadTestEvent('revelation_11_15_30041.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
      const metadata = extractBookMetadata(event);
      expect(metadata.version).toBe('Douay-Rheims Bible');
    });
  });

  describe('Kind 1 Bible Events', () => {
    it('should detect john_3_16_kind1.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_kind1.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
    });

    it('should extract metadata from john_3_16_kind1.json', () => {
      const event = loadTestEvent('john_3_16_kind1.json');
      const metadata = extractBookMetadata(event);
      expect(metadata.book).toBe('John');
      expect(metadata.chapter).toBe('3');
      expect(metadata.verse).toBe('16');
      expect(metadata.version).toBe('King James Version');
    });

    it('should detect exodus_3_16_kind1.json as Bible event', () => {
      const event = loadTestEvent('exodus_3_16_kind1.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
    });

    it('should detect psalm_23_1_kind1.json as Bible event', () => {
      const event = loadTestEvent('psalm_23_1_kind1.json');
      expect(isBookEvent(event, 'bible')).toBe(true);
      const metadata = extractBookMetadata(event);
      expect(metadata.book).toBe('Psalms');
      expect(metadata.chapter).toBe('23');
      expect(metadata.verse).toBe('1');
    });
  });

  describe('Kind 1 Reference Events (NOT Bible Events)', () => {
    it('should NOT detect bible_verse_note_kind1.json as Bible event', () => {
      const event = loadTestEvent('bible_verse_note_kind1.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });

    it('should NOT detect exodus_verse_note_kind1.json as Bible event', () => {
      const event = loadTestEvent('exodus_verse_note_kind1.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });
  });

  describe('Kind 30818 Wiki Events (NOT Bible Events)', () => {
    it('should NOT detect bible_study_wiki_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_study_wiki_30818.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });

    it('should NOT detect bible_versions_wiki_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_versions_wiki_30818.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });

    it('should NOT detect bible_study_guide_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_study_guide_30818.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });
  });

  describe('Kind 30023 Article Events (NOT Bible Events)', () => {
    it('should NOT detect bible_article_30023.json as Bible event', () => {
      const event = loadTestEvent('bible_article_30023.json');
      expect(isBookEvent(event, 'bible')).toBe(false);
    });
  });

  describe('Version Fallback Testing', () => {
    it('should have multiple versions of John 3:16', () => {
      const kjv = loadTestEvent('john_3_16_30041.json');
      const niv = loadTestEvent('john_3_16_niv_30041.json');
      const esv = loadTestEvent('version_fallback_test_30041.json');
      const kjvKind1 = loadTestEvent('john_3_16_kind1.json');
      const nivKind1 = loadTestEvent('john_3_16_niv_kind1.json');

      // All should be Bible events
      expect(isBookEvent(kjv, 'bible')).toBe(true);
      expect(isBookEvent(niv, 'bible')).toBe(true);
      expect(isBookEvent(esv, 'bible')).toBe(true);
      expect(isBookEvent(kjvKind1, 'bible')).toBe(true);
      expect(isBookEvent(nivKind1, 'bible')).toBe(true);

      // All should be John 3:16
      expect(extractBookMetadata(kjv).book).toBe('John');
      expect(extractBookMetadata(kjv).chapter).toBe('3');
      expect(extractBookMetadata(kjv).verse).toBe('16');

      expect(extractBookMetadata(niv).book).toBe('John');
      expect(extractBookMetadata(niv).chapter).toBe('3');
      expect(extractBookMetadata(niv).verse).toBe('16');

      expect(extractBookMetadata(esv).book).toBe('John');
      expect(extractBookMetadata(esv).chapter).toBe('3');
      expect(extractBookMetadata(esv).verse).toBe('16');

      // Different versions
      expect(extractBookMetadata(kjv).version).toBe('King James Version');
      expect(extractBookMetadata(niv).version).toBe('New International Version');
      expect(extractBookMetadata(esv).version).toBe('English Standard Version');
    });
  });

  describe('Deuterocanonical Books', () => {
    it('should handle Douay-Rheims Bible events', () => {
      const event = loadTestEvent('revelation_11_15_30041.json');
      const metadata = extractBookMetadata(event);
      expect(metadata.version).toBe('Douay-Rheims Bible');
      expect(metadata.book).toBe('Revelation');
    });
  });

  describe('Wikilink Parsing with Test Data', () => {
    it('should parse John 3:16 wikilink', () => {
      const result = parseBookWikilink('[[John 3:16 | KJV]]', 'bible');
      expect(result.references[0].book).toBe('John');
      expect(result.references[0].chapter).toBe(3);
      expect(result.references[0].verse).toBe('16');
      expect(result.versions).toEqual(['KJV']);
    });

    it('should parse chapter-only wikilink', () => {
      const result = parseBookWikilink('[[John 3 | KJV]]', 'bible');
      expect(result.references[0].book).toBe('John');
      expect(result.references[0].chapter).toBe(3);
      expect(result.references[0].verse).toBeUndefined();
      expect(result.versions).toEqual(['KJV']);
    });

    it('should parse explicit bible prefix', () => {
      const result = parseBookWikilink('[[bible:John 3:16 | KJV]]', 'bible');
      expect(result.references[0].book).toBe('John');
      expect(result.versions).toEqual(['KJV']);
    });
  });
});
