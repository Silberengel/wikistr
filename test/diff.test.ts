import { describe, it, expect } from 'vitest';
import { parseDiffQuery, isDiffQuery, diffText } from '../src/lib/diff';

describe('Diff Query Parsing', () => {
  it('should detect diff queries correctly', () => {
    expect(isDiffQuery('diff::article1 | article2')).toBe(true);
    expect(isDiffQuery('diff::bible:John 3:16 KJV | NIV')).toBe(true);
    expect(isDiffQuery('diff::article1; article2; article3')).toBe(true);
    expect(isDiffQuery('regular search')).toBe(false);
    expect(isDiffQuery('diff:not-diff')).toBe(false);
  });

  it('should parse Bible diff queries with pipe separation', () => {
    const result = parseDiffQuery('diff::bible:John 3:16 KJV | NIV');
    expect(result).toEqual({
      type: 'bible',
      left: 'bible:John 3:16 KJV',
      right: 'NIV'
    });
  });

  it('should parse Bible diff queries without pipe', () => {
    const result = parseDiffQuery('diff::bible:John 3:16 KJV');
    expect(result).toEqual({
      type: 'bible',
      left: 'bible:John 3:16 KJV',
      right: 'bible:John 3:16 KJV'
    });
  });

  it('should parse wiki diff queries with pipe separation', () => {
    const result = parseDiffQuery('diff::article1 | article2');
    expect(result).toEqual({
      type: 'wiki',
      left: 'article1',
      right: 'article2'
    });
  });

  it('should parse wiki diff queries with semicolon separation', () => {
    const result = parseDiffQuery('diff::article1; article2; article3');
    expect(result).toEqual({
      type: 'wiki',
      left: 'article1',
      right: 'article2',
      items: ['article3']
    });
  });

  it('should parse single item diff queries', () => {
    const result = parseDiffQuery('diff::single-article');
    expect(result).toEqual({
      type: 'wiki',
      left: 'single-article',
      right: 'single-article'
    });
  });

  it('should handle Bible version detection', () => {
    const result1 = parseDiffQuery('diff::John 3:16 KJV | ESV');
    expect(result1?.type).toBe('bible');

    const result2 = parseDiffQuery('diff::Romans 1:16 NIV');
    expect(result2?.type).toBe('bible');

    const result3 = parseDiffQuery('diff::regular-article');
    expect(result3?.type).toBe('wiki');
  });

  it('should return null for non-diff queries', () => {
    expect(parseDiffQuery('regular search')).toBeNull();
    expect(parseDiffQuery('diff:not-diff')).toBeNull();
    expect(parseDiffQuery('')).toBeNull();
  });
});

describe('Diff Text Generation', () => {
  it('should generate diff for identical texts', () => {
    const text1 = 'Hello world';
    const text2 = 'Hello world';
    const diff = diffText(text1, text2);
    
    expect(diff).toEqual([]); // No changes for identical text
  });

  it('should generate diff for completely different texts', () => {
    const text1 = 'Hello world';
    const text2 = 'Goodbye universe';
    const diff = diffText(text1, text2);
    
    // The diff library returns separate removed and added segments, not modified
    expect(diff).toEqual([
      { type: 'removed', leftLine: 1, leftText: 'Hello world' },
      { type: 'added', rightLine: 1, rightText: 'Goodbye universe' }
    ]);
  });

  it('should generate diff for texts with additions', () => {
    const text1 = 'Hello world';
    const text2 = 'Hello world\nGoodbye universe';
    const diff = diffText(text1, text2);
    
    // The diff library may treat this differently - check that we have the added line
    expect(diff.length).toBeGreaterThan(0);
    const addedChange = diff.find(segment => segment.type === 'added' && segment.rightText === 'Goodbye universe');
    expect(addedChange).toBeDefined();
  });

  it('should generate diff for texts with deletions', () => {
    const text1 = 'Hello world\nGoodbye universe';
    const text2 = 'Hello world';
    const diff = diffText(text1, text2);
    
    // The diff library may treat this differently - check that we have the removed line
    expect(diff.length).toBeGreaterThan(0);
    const removedChange = diff.find(segment => segment.type === 'removed' && segment.leftText === 'Goodbye universe');
    expect(removedChange).toBeDefined();
  });

  it('should generate diff for texts with modifications', () => {
    const text1 = 'The quick brown fox\nJumps over the lazy dog';
    const text2 = 'The slow red fox\nJumps over the lazy dog';
    const diff = diffText(text1, text2);
    
    // The diff library returns separate removed and added segments for modifications
    expect(diff).toEqual([
      { type: 'removed', leftLine: 1, leftText: 'The quick brown fox' },
      { type: 'added', rightLine: 1, rightText: 'The slow red fox' }
    ]);
  });

  it('should handle empty texts', () => {
    const diff1 = diffText('', 'Hello');
    // Empty string to non-empty: just an addition
    expect(diff1).toEqual([
      { type: 'added', rightLine: 1, rightText: 'Hello' }
    ]);

    const diff2 = diffText('Hello', '');
    // Non-empty to empty: just a removal
    expect(diff2).toEqual([
      { type: 'removed', leftLine: 1, leftText: 'Hello' }
    ]);

    const diff3 = diffText('', '');
    expect(diff3).toEqual([]);
  });

  it('should handle multiline texts', () => {
    const text1 = 'Line 1\nLine 2\nLine 3';
    const text2 = 'Line 1\nModified Line 2\nLine 3';
    const diff = diffText(text1, text2);
    
    // The diff library returns separate removed and added segments
    expect(diff).toEqual([
      { type: 'removed', leftLine: 2, leftText: 'Line 2' },
      { type: 'added', rightLine: 2, rightText: 'Modified Line 2' }
    ]);
  });

  it('should handle complex Bible verse comparisons', () => {
    const kjv = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
    const niv = 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.';
    const diff = diffText(kjv, niv);
    
    // Should have at least one change (removed and/or added segments)
    expect(diff.length).toBeGreaterThan(0);
    // The diff library returns removed/added, not modified
    expect(diff.some(segment => segment.type === 'removed' || segment.type === 'added')).toBe(true);
  });
});

describe('Edge Cases', () => {
  it('should handle special characters in diff queries', () => {
    const result = parseDiffQuery('diff::article-with-special-chars_123 | another-article');
    expect(result).toEqual({
      type: 'wiki',
      left: 'article-with-special-chars_123',
      right: 'another-article'
    });
  });

  it('should handle whitespace in diff queries', () => {
    const result = parseDiffQuery('diff::  article1  |  article2  ');
    expect(result).toEqual({
      type: 'wiki',
      left: 'article1',
      right: 'article2'
    });
  });

  it('should handle multiple semicolons in diff queries', () => {
    const result = parseDiffQuery('diff::article1; ; article2; article3');
    expect(result).toEqual({
      type: 'wiki',
      left: 'article1',
      right: 'article2',
      items: ['article3']
    });
  });

  it('should handle very long texts in diff generation', () => {
    const longText1 = 'A'.repeat(1000);
    const longText2 = 'B'.repeat(1000);
    const diff = diffText(longText1, longText2);
    
    // The diff library returns separate removed and added segments
    expect(diff).toEqual([
      { type: 'removed', leftLine: 1, leftText: longText1 },
      { type: 'added', rightLine: 1, rightText: longText2 }
    ]);
  });

  it('should handle unicode characters in diff generation', () => {
    const text1 = 'Hello 世界';
    const text2 = 'Hello 🌍';
    const diff = diffText(text1, text2);
    
    // The diff library returns separate removed and added segments
    expect(diff).toEqual([
      { type: 'removed', leftLine: 1, leftText: 'Hello 世界' },
      { type: 'added', rightLine: 1, rightText: 'Hello 🌍' }
    ]);
  });
});
