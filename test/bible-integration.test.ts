import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isBibleEvent,
  extractBibleMetadata,
  generateBibleTitle,
  parseBibleWikilink
} from '../src/lib/bible';

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
      expect(isBibleEvent(event)).toBe(true);
    });

    it('should extract metadata from exodus_3_16_30041.json', () => {
      const event = loadTestEvent('exodus_3_16_30041.json');
      const metadata = extractBibleMetadata(event);
      expect(metadata.book).toBe('Exodus');
      expect(metadata.chapter).toBe('3');
      expect(metadata.verses).toBe('16');
      expect(metadata.version).toBe('King James Version');
    });

    it('should generate title for exodus_3_16_30041.json', () => {
      const event = loadTestEvent('exodus_3_16_30041.json');
      const metadata = extractBibleMetadata(event);
      const title = generateBibleTitle(metadata);
      expect(title).toBe('Exodus 3:16 (King James Version)');
    });

    it('should detect john_3_16_30041.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_30041.json');
      expect(isBibleEvent(event)).toBe(true);
    });

    it('should detect john_3_16_niv_30041.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_niv_30041.json');
      expect(isBibleEvent(event)).toBe(true);
      const metadata = extractBibleMetadata(event);
      expect(metadata.version).toBe('New International Version');
    });

    it('should detect revelation_11_15_30041.json as Bible event', () => {
      const event = loadTestEvent('revelation_11_15_30041.json');
      expect(isBibleEvent(event)).toBe(true);
      const metadata = extractBibleMetadata(event);
      expect(metadata.version).toBe('Douay-Rheims Bible');
    });
  });

  describe('Kind 1 Bible Events', () => {
    it('should detect john_3_16_kind1.json as Bible event', () => {
      const event = loadTestEvent('john_3_16_kind1.json');
      expect(isBibleEvent(event)).toBe(true);
    });

    it('should extract metadata from john_3_16_kind1.json', () => {
      const event = loadTestEvent('john_3_16_kind1.json');
      const metadata = extractBibleMetadata(event);
      expect(metadata.book).toBe('John');
      expect(metadata.chapter).toBe('3');
      expect(metadata.verses).toBe('16');
      expect(metadata.version).toBe('King James Version');
    });

    it('should detect exodus_3_16_kind1.json as Bible event', () => {
      const event = loadTestEvent('exodus_3_16_kind1.json');
      expect(isBibleEvent(event)).toBe(true);
    });

    it('should detect psalm_23_1_kind1.json as Bible event', () => {
      const event = loadTestEvent('psalm_23_1_kind1.json');
      expect(isBibleEvent(event)).toBe(true);
      const metadata = extractBibleMetadata(event);
      expect(metadata.book).toBe('Psalms');
      expect(metadata.chapter).toBe('23');
      expect(metadata.verses).toBe('1');
    });
  });

  describe('Kind 1 Reference Events (NOT Bible Events)', () => {
    it('should NOT detect bible_verse_note_kind1.json as Bible event', () => {
      const event = loadTestEvent('bible_verse_note_kind1.json');
      expect(isBibleEvent(event)).toBe(false);
    });

    it('should NOT detect exodus_verse_note_kind1.json as Bible event', () => {
      const event = loadTestEvent('exodus_verse_note_kind1.json');
      expect(isBibleEvent(event)).toBe(false);
    });
  });

  describe('Kind 30818 Wiki Events (NOT Bible Events)', () => {
    it('should NOT detect bible_study_wiki_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_study_wiki_30818.json');
      expect(isBibleEvent(event)).toBe(false);
    });

    it('should NOT detect bible_versions_wiki_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_versions_wiki_30818.json');
      expect(isBibleEvent(event)).toBe(false);
    });

    it('should NOT detect bible_study_guide_30818.json as Bible event', () => {
      const event = loadTestEvent('bible_study_guide_30818.json');
      expect(isBibleEvent(event)).toBe(false);
    });
  });

  describe('Kind 30023 Article Events (NOT Bible Events)', () => {
    it('should NOT detect bible_article_30023.json as Bible event', () => {
      const event = loadTestEvent('bible_article_30023.json');
      expect(isBibleEvent(event)).toBe(false);
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
      expect(isBibleEvent(kjv)).toBe(true);
      expect(isBibleEvent(niv)).toBe(true);
      expect(isBibleEvent(esv)).toBe(true);
      expect(isBibleEvent(kjvKind1)).toBe(true);
      expect(isBibleEvent(nivKind1)).toBe(true);

      // All should be John 3:16
      expect(extractBibleMetadata(kjv).book).toBe('John');
      expect(extractBibleMetadata(kjv).chapter).toBe('3');
      expect(extractBibleMetadata(kjv).verses).toBe('16');

      expect(extractBibleMetadata(niv).book).toBe('John');
      expect(extractBibleMetadata(niv).chapter).toBe('3');
      expect(extractBibleMetadata(niv).verses).toBe('16');

      expect(extractBibleMetadata(esv).book).toBe('John');
      expect(extractBibleMetadata(esv).chapter).toBe('3');
      expect(extractBibleMetadata(esv).verses).toBe('16');

      // Different versions
      expect(extractBibleMetadata(kjv).version).toBe('King James Version');
      expect(extractBibleMetadata(niv).version).toBe('New International Version');
      expect(extractBibleMetadata(esv).version).toBe('English Standard Version');
    });
  });

  describe('Deuterocanonical Books', () => {
    it('should handle Douay-Rheims Bible events', () => {
      const event = loadTestEvent('revelation_11_15_30041.json');
      const metadata = extractBibleMetadata(event);
      expect(metadata.version).toBe('Douay-Rheims Bible');
      expect(metadata.book).toBe('Revelation');
    });
  });

  describe('Wikilink Parsing with Test Data', () => {
    it('should parse John 3:16 wikilink', () => {
      const result = parseBibleWikilink('[[John 3:16 | KJV]]');
      expect(result.references[0].book).toBe('John');
      expect(result.references[0].chapter).toBe(3);
      expect(result.references[0].verses).toBe('16');
      expect(result.version).toBe('KJV');
    });

    it('should parse chapter-only wikilink', () => {
      const result = parseBibleWikilink('[[John 3 | KJV]]');
      expect(result.references[0].book).toBe('John');
      expect(result.references[0].chapter).toBe(3);
      expect(result.references[0].verses).toBeUndefined();
      expect(result.version).toBe('KJV');
    });

    it('should parse explicit bible prefix', () => {
      const result = parseBibleWikilink('[[bible:John 3:16 | KJV]]');
      expect(result.references[0].book).toBe('John');
      expect(result.version).toBe('KJV');
    });
  });
});
