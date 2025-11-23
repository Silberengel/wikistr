import { describe, it, expect } from 'vitest';
import { parseDiffQuery, diffText } from '../src/lib/diff';
import { extractBookMetadata, isBookEvent } from "../src/lib/books";

// Mock Bible events for testing
const kjvJohn316 = {
  kind: 30041,
  pubkey: 'test-pubkey-1',
  content: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  tags: [
    ['type', 'bible'],
    ['book', 'John'],
    ['chapter', '3'],
    ['verse', '16'],
    ['version', 'KJV'],
    ['d', 'john-3-16-kjv']
  ],
  created_at: 1234567890,
  id: 'test-id-1',
  sig: 'test-sig-1'
};

const nivJohn316 = {
  kind: 30041,
  pubkey: 'test-pubkey-2',
  content: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
  tags: [
    ['type', 'bible'],
    ['book', 'John'],
    ['chapter', '3'],
    ['verse', '16'],
    ['version', 'NIV'],
    ['d', 'john-3-16-niv']
  ],
  created_at: 1234567890,
  id: 'test-id-2',
  sig: 'test-sig-2'
};

const wikiArticle1 = {
  kind: 30818,
  pubkey: 'test-pubkey-3',
  content: 'This is the first version of the article. It contains some initial content about the topic.',
  tags: [
    ['d', 'test-article'],
    ['title', 'Test Article'],
    ['summary', 'A test article for diff comparison']
  ],
  created_at: 1234567890,
  id: 'test-id-3',
  sig: 'test-sig-3'
};

const wikiArticle2 = {
  kind: 30818,
  pubkey: 'test-pubkey-4',
  content: 'This is the updated version of the article. It contains revised content about the topic with additional information.',
  tags: [
    ['d', 'test-article'],
    ['title', 'Test Article'],
    ['summary', 'An updated test article for diff comparison']
  ],
  created_at: 1234567891,
  id: 'test-id-4',
  sig: 'test-sig-4'
};

describe('Diff Integration Tests', () => {
  describe('Bible Diff Integration', () => {
    it('should parse Bible diff queries and extract metadata', () => {
      const diffQuery = 'diff::bible:John 3:16 KJV | NIV';
      const parsed = parseDiffQuery(diffQuery);
      
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('bible');
      expect(parsed!.left).toBe('bible:John 3:16 KJV');
      expect(parsed!.right).toBe('NIV');
    });

    it('should generate meaningful diff between Bible versions', () => {
      const kjvContent = kjvJohn316.content;
      const nivContent = nivJohn316.content;
      
      const diff = diffText(kjvContent, nivContent);
      
      // Should have at least one change
      expect(diff.length).toBeGreaterThan(0);
      
      // The diff library returns removed/added segments, not modified
      expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
      
      // Check that we have changes related to the verse content
      const hasRelevantChange = diff.some(segment => 
        (segment.leftText && segment.leftText.includes('For God so loved the world')) ||
        (segment.rightText && segment.rightText.includes('For God so loved the world'))
      );
      expect(hasRelevantChange).toBe(true);
    });

    it('should identify Bible events correctly for diff', () => {
      expect(isBookEvent(kjvJohn316, 'bible')).toBe(true);
      expect(isBookEvent(nivJohn316, 'bible')).toBe(true);
      expect(isBookEvent(wikiArticle1, 'bible')).toBe(false);
    });

    it('should extract Bible metadata for diff comparison', () => {
      const kjvMetadata = extractBookMetadata(kjvJohn316);
      const nivMetadata = extractBookMetadata(nivJohn316);
      
      expect(kjvMetadata).not.toBeNull();
      expect(nivMetadata).not.toBeNull();
      
      expect(kjvMetadata!.book).toBe('John');
      expect(kjvMetadata!.chapter).toBe('3');
      expect(kjvMetadata!.verse).toBe('16');
      expect(kjvMetadata!.version).toBe('KJV');
      
      expect(nivMetadata!.book).toBe('John');
      expect(nivMetadata!.chapter).toBe('3');
      expect(nivMetadata!.verse).toBe('16');
      expect(nivMetadata!.version).toBe('NIV');
    });
  });

  describe('Wiki Diff Integration', () => {
    it('should parse wiki diff queries', () => {
      const diffQuery = 'diff::test-article | test-article-v2';
      const parsed = parseDiffQuery(diffQuery);
      
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('wiki');
      expect(parsed!.left).toBe('test-article');
      expect(parsed!.right).toBe('test-article-v2');
    });

    it('should generate diff between wiki article versions', () => {
      const content1 = wikiArticle1.content;
      const content2 = wikiArticle2.content;
      
      const diff = diffText(content1, content2);
      
      // Should have at least one change
      expect(diff.length).toBeGreaterThan(0);
      
      // The diff library returns removed/added segments, not modified
      expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
      
      // Check that we have changes related to the article content
      const hasRelevantChange = diff.some(segment => 
        (segment.leftText && segment.leftText.includes('This is')) ||
        (segment.rightText && segment.rightText.includes('This is'))
      );
      expect(hasRelevantChange).toBe(true);
    });

    it('should handle multiple wiki articles in diff', () => {
      const diffQuery = 'diff::article1; article2; article3';
      const parsed = parseDiffQuery(diffQuery);
      
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('wiki');
      expect(parsed!.left).toBe('article1');
      expect(parsed!.right).toBe('article2');
      expect(parsed!.items).toEqual(['article3']);
    });
  });

  describe('Mixed Content Diff', () => {
    it('should handle diff between different content types', () => {
      const diffQuery = 'diff::bible:John 3:16 KJV | wiki-article';
      const parsed = parseDiffQuery(diffQuery);
      
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('bible'); // Detected as Bible due to bible: prefix
      expect(parsed!.left).toBe('bible:John 3:16 KJV');
      expect(parsed!.right).toBe('wiki-article');
    });

    it('should generate diff between Bible and wiki content', () => {
      const bibleContent = kjvJohn316.content;
      const wikiContent = wikiArticle1.content;
      
      const diff = diffText(bibleContent, wikiContent);
      
      // The diff library returns separate removed and added segments
      expect(diff.length).toBeGreaterThanOrEqual(1);
      expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
      
      // Check that we have the relevant content
      const hasBibleContent = diff.some(segment => segment.leftText && segment.leftText.includes(bibleContent));
      const hasWikiContent = diff.some(segment => segment.rightText && segment.rightText.includes(wikiContent));
      expect(hasBibleContent || hasWikiContent).toBe(true);
    });
  });

  describe('Real-world Diff Scenarios', () => {
    it('should handle Bible chapter comparisons', () => {
      const kjvChapter = 'In the beginning was the Word, and the Word was with God, and the Word was God. The same was in the beginning with God.';
      const nivChapter = 'In the beginning was the Word, and the Word was with God, and the Word was God. He was with God in the beginning.';
      
      const diff = diffText(kjvChapter, nivChapter);
      
      expect(diff.length).toBeGreaterThan(0);
      expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
    });

    it('should handle wiki article revisions', () => {
      const original = 'The quick brown fox jumps over the lazy dog. This is a test sentence.';
      const revised = 'The quick brown fox jumps over the lazy dog. This is a revised test sentence with more detail.';
      
      const diff = diffText(original, revised);
      
      expect(diff.length).toBeGreaterThan(0);
      expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
    });

    it('should handle complex multi-paragraph diffs', () => {
      const text1 = `Paragraph 1: This is the first paragraph.
      
Paragraph 2: This is the second paragraph with some content.

Paragraph 3: This is the third paragraph.`;

      const text2 = `Paragraph 1: This is the first paragraph.
      
Paragraph 2: This is the modified second paragraph with updated content.

Paragraph 3: This is the third paragraph.
      
Paragraph 4: This is a new fourth paragraph.`;

      const diff = diffText(text1, text2);
      
      expect(diff.length).toBeGreaterThan(0);
      expect(diff.some(segment => segment.type === 'modified' || segment.type === 'added')).toBe(true);
    });
  });
});
