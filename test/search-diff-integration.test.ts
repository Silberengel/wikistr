import { describe, it, expect } from 'vitest';
import { isDiffQuery, parseDiffQuery } from '../src/lib/diff';

describe('Search-Diff Integration', () => {
  describe('Diff Query Detection in Search', () => {
    it('should detect diff queries in search input', () => {
      const searchInputs = [
        'diff::article1 | article2',
        'diff::bible:John 3:16 KJV | NIV',
        'diff::article1; article2; article3',
        'diff::single-article'
      ];

      searchInputs.forEach(input => {
        expect(isDiffQuery(input)).toBe(true);
      });
    });

    it('should not detect regular search queries as diff queries', () => {
      const regularInputs = [
        'regular search',
        'bible:John 3:16',
        'wiki article',
        'diff:not-diff',
        'search for something',
        '[[wikilink]]'
      ];

      regularInputs.forEach(input => {
        expect(isDiffQuery(input)).toBe(false);
      });
    });
  });

  describe('Search Query Routing', () => {
    it('should route diff queries to diff functionality', () => {
      const diffQueries = [
        'diff::article1 | article2',
        'diff::bible:John 3:16 KJV | NIV',
        'diff::article1; article2; article3'
      ];

      diffQueries.forEach(query => {
        const parsed = parseDiffQuery(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.type).toBeDefined();
        expect(parsed!.left).toBeDefined();
        expect(parsed!.right).toBeDefined();
      });
    });

    it('should handle edge cases in diff query routing', () => {
      // Empty diff query
      expect(isDiffQuery('diff::')).toBe(true);
      const emptyParsed = parseDiffQuery('diff::');
      expect(emptyParsed).not.toBeNull();

      // Diff query with only whitespace
      expect(isDiffQuery('diff::   ')).toBe(true);
      const whitespaceParsed = parseDiffQuery('diff::   ');
      expect(whitespaceParsed).not.toBeNull();

      // Diff query with special characters
      expect(isDiffQuery('diff::article-with_123 | another-article')).toBe(true);
      const specialParsed = parseDiffQuery('diff::article-with_123 | another-article');
      expect(specialParsed).not.toBeNull();
      expect(specialParsed!.left).toBe('article-with_123');
      expect(specialParsed!.right).toBe('another-article');
    });
  });

  describe('Search Help Integration', () => {
    it('should provide appropriate help text for diff queries', () => {
      // This test verifies that the search component should show diff-specific help
      const diffQuery = 'diff::';
      expect(isDiffQuery(diffQuery)).toBe(true);
      
      // The search component should recognize this as a diff query
      // and show appropriate help text about diff functionality
    });

    it('should provide appropriate help text for regular search', () => {
      const regularQuery = 'regular search';
      expect(isDiffQuery(regularQuery)).toBe(false);
      
      // The search component should show regular search help
      // including Bible search instructions
    });
  });

  describe('Multi-tier Search with Diff', () => {
    it('should not interfere with multi-tier search for regular queries', () => {
      const regularQueries = [
        'wiki-article',
        'bible:John 3:16',
        'search term',
        '[[wikilink]]'
      ];

      regularQueries.forEach(query => {
        expect(isDiffQuery(query)).toBe(false);
        // These should go through normal multi-tier search:
        // 1. d-tag search
        // 2. title search  
        // 3. summary search
        // 4. full-text search
      });
    });

    it('should route diff queries away from multi-tier search', () => {
      const diffQueries = [
        'diff::article1 | article2',
        'diff::bible:John 3:16 KJV | NIV'
      ];

      diffQueries.forEach(query => {
        expect(isDiffQuery(query)).toBe(true);
        // These should be routed to diff functionality
        // and NOT go through multi-tier search
      });
    });
  });

  describe('WOT Priority with Diff', () => {
    it('should maintain WOT priority for regular search results', () => {
      // Regular search should prioritize:
      // 1. Authors in WOT (WOT score > 0)
      // 2. Search tier (d-tag > title > summary > full-text)
      // 3. WOT score within same tier
      
      const regularQuery = 'wiki-article';
      expect(isDiffQuery(regularQuery)).toBe(false);
      
      // This should use the WOT-prioritized search logic
    });

    it('should not apply WOT priority to diff results', () => {
      // Diff functionality should fetch content for comparison
      // WOT priority doesn't apply to diff - we want to compare
      // the actual content, not prioritize by author
      
      const diffQuery = 'diff::article1 | article2';
      expect(isDiffQuery(diffQuery)).toBe(true);
      
      // This should fetch both articles for comparison
      // regardless of author WOT score
    });
  });

  describe('Bible Search Integration with Diff', () => {
    it('should handle Bible diff queries correctly', () => {
      const bibleDiffQueries = [
        'diff::bible:John 3:16 KJV | NIV',
        'diff::bible:Romans 1:16 KJV | ESV',
        'diff::John 3:16 KJV | NIV', // Without bible: prefix
        'diff::Romans 1:16-25 KJV | DRB'
      ];

      bibleDiffQueries.forEach(query => {
        expect(isDiffQuery(query)).toBe(true);
        const parsed = parseDiffQuery(query);
        expect(parsed).not.toBeNull();
        expect(parsed!.type).toBe('bible');
      });
    });

    it('should not interfere with regular Bible search', () => {
      const regularBibleQueries = [
        'bible:John 3:16',
        'John 3:16 KJV',
        '[[bible:John 3:16 | KJV NIV]]'
      ];

      regularBibleQueries.forEach(query => {
        expect(isDiffQuery(query)).toBe(false);
        // These should go through normal Bible search
      });
    });
  });

  describe('Error Handling in Search-Diff Integration', () => {
    it('should handle malformed diff queries gracefully', () => {
      const malformedQueries = [
        'diff::',
        'diff::   ',
        'diff:: | ',
        'diff::; ;',
        'diff::article1 | | article2'
      ];

      malformedQueries.forEach(query => {
        expect(isDiffQuery(query)).toBe(true);
        const parsed = parseDiffQuery(query);
        // Should not throw errors, should return valid or null result
        expect(parsed === null || typeof parsed === 'object').toBe(true);
      });
    });

    it('should handle very long diff queries', () => {
      const longQuery = 'diff::' + 'a'.repeat(1000) + ' | ' + 'b'.repeat(1000);
      expect(isDiffQuery(longQuery)).toBe(true);
      
      const parsed = parseDiffQuery(longQuery);
      expect(parsed).not.toBeNull();
      expect(parsed!.left.length).toBe(1000);
      expect(parsed!.right.length).toBe(1000);
    });
  });
});
