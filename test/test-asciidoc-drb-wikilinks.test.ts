import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { NostrEvent } from '@nostr/tools/pure';
import { parseBookWikilink } from '../src/lib/bookWikilinkParser';

function loadTestEvent(filename: string): NostrEvent {
  const filePath = join(__dirname, filename);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as NostrEvent;
}

describe('AsciiDoc Content with DRB Bible Wikilinks (30818)', () => {
  it('should load test article with DRB wikilinks', () => {
    const event = loadTestEvent('test_article_30818.json');
    expect(event.kind).toBe(30818);
    expect(event.content).toBeDefined();
    expect(event.content).toContain('[[book::');
  });

  it('should contain single verse DRB reference', () => {
    const event = loadTestEvent('test_article_30818.json');
    const singleVerseMatch = event.content.match(/\[\[book::bible \| john 3:16 \| drb\]\]/);
    expect(singleVerseMatch).not.toBeNull();
  });

  it('should contain verse range DRB reference', () => {
    const event = loadTestEvent('test_article_30818.json');
    const rangeMatch = event.content.match(/\[\[book::bible \| romans 3:16-18 \| drb\]\]/);
    expect(rangeMatch).not.toBeNull();
  });

  it('should contain multiple versions reference', () => {
    const event = loadTestEvent('test_article_30818.json');
    const multiVersionMatch = event.content.match(/\[\[book::bible \| john 3:16 \| drb kjv\]\]/);
    expect(multiVersionMatch).not.toBeNull();
  });

  it('should contain multiple references with global version', () => {
    const event = loadTestEvent('test_article_30818.json');
    const multiRefMatch = event.content.match(/\[\[book::bible \| romans 1:16-17, psalms 23:1 \| drb\]\]/);
    expect(multiRefMatch).not.toBeNull();
  });

  it('should contain reference without collection', () => {
    const event = loadTestEvent('test_article_30818.json');
    const noCollectionMatch = event.content.match(/\[\[book::john 3:16 \| drb\]\]/);
    expect(noCollectionMatch).not.toBeNull();
  });

  describe('Parsing DRB Wikilinks', () => {
    it('should parse single verse DRB reference', () => {
      const wikilink = '[[book::bible | john 3:16 | drb]]';
      const parsed = parseBookWikilink(wikilink);
      expect(parsed).not.toBeNull();
      expect(parsed!.references).toHaveLength(1);
      expect(parsed!.references[0].collection).toBe('bible');
      expect(parsed!.references[0].title).toBe('john');
      expect(parsed!.references[0].chapter).toBe('3');
      expect(parsed!.references[0].section).toEqual(['16']);
      expect(parsed!.references[0].version).toEqual(['drb']);
    });

    it('should parse verse range DRB reference', () => {
      const wikilink = '[[book::bible | romans 3:16-18 | drb]]';
      const parsed = parseBookWikilink(wikilink);
      expect(parsed).not.toBeNull();
      expect(parsed!.references[0].section).toEqual(['16', '17', '18']);
      expect(parsed!.references[0].version).toEqual(['drb']);
    });

    it('should parse multiple versions (DRB and KJV)', () => {
      const wikilink = '[[book::bible | john 3:16 | drb kjv]]';
      const parsed = parseBookWikilink(wikilink);
      expect(parsed).not.toBeNull();
      expect(parsed!.references[0].version).toEqual(['drb', 'kjv']);
    });

    it('should parse multiple references with global DRB version', () => {
      const wikilink = '[[book::bible | romans 1:16-17, psalms 23:1 | drb]]';
      const parsed = parseBookWikilink(wikilink);
      expect(parsed).not.toBeNull();
      expect(parsed!.references).toHaveLength(2);
      expect(parsed!.references[0].title).toBe('romans');
      expect(parsed!.references[1].title).toBe('psalms');
      // Both should have the global DRB version
      expect(parsed!.references[0].version).toEqual(['drb']);
      expect(parsed!.references[1].version).toEqual(['drb']);
    });

    it('should parse reference without collection using DRB', () => {
      const wikilink = '[[book::john 3:16 | drb]]';
      const parsed = parseBookWikilink(wikilink);
      expect(parsed).not.toBeNull();
      expect(parsed!.references[0].title).toBe('john');
      expect(parsed!.references[0].version).toEqual(['drb']);
    });
  });

  describe('Extracting Wikilinks from Content', () => {
    it('should extract all bookstr wikilinks from content', () => {
      const event = loadTestEvent('test_article_30818.json');
      const wikilinkRegex = /\[\[book::([^\]]+)\]\]/g;
      const matches = Array.from(event.content.matchAll(wikilinkRegex));
      expect(matches.length).toBeGreaterThan(0);
      
      // Verify all matches are valid
      matches.forEach(match => {
        const fullWikilink = `[[book::${match[1]}]]`;
        const parsed = parseBookWikilink(fullWikilink);
        expect(parsed).not.toBeNull();
      });
    });

    it('should find at least 5 DRB references in the test article', () => {
      const event = loadTestEvent('test_article_30818.json');
      const drbMatches = event.content.match(/drb/g);
      expect(drbMatches).not.toBeNull();
      expect(drbMatches!.length).toBeGreaterThanOrEqual(5);
    });
  });
});

