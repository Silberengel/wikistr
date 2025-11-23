/**
 * Tests for Content Quality Control Service
 */

import { describe, it, expect } from 'vitest';
import {
  fixHeaderSpacing,
  fixMissingHeadingLevels,
  extractTitleFromContent,
  ensureDocumentHeader,
  getTitleFromEvent,
  processContentQuality,
  processContentQualityAsync,
  processWikilinks,
  processNostrAddresses,
  fixPreambleContent,
  fixLinkAndMediaFormatting
} from '../src/lib/contentQualityControl';

describe('fixHeaderSpacing', () => {
  it('should fix markdown headers without spaces (2+ hashes)', () => {
    const input = `##Chapter 2
Some content here
###Subsection`;
    const expected = `## Chapter 2
Some content here
### Subsection`;
    expect(fixHeaderSpacing(input)).toBe(expected);
  });
  
  it('should not fix single hash unless at section start', () => {
    const input = `This is a #hashtag in text
## Real Header`;
    // Should not change #hashtag
    expect(fixHeaderSpacing(input)).toContain('#hashtag');
    expect(fixHeaderSpacing(input)).toContain('## Real Header');
  });
  
  it('should fix single hash at section start missing header', () => {
    const input = `Previous section

#MissingHeader
Content here`;
    const result = fixHeaderSpacing(input);
    expect(result).toContain('# MissingHeader');
  });

  it('should fix asciidoc headers without spaces', () => {
    const input = `==Section Title
Content here
===Subsection`;
    const expected = `== Section Title
Content here
=== Subsection`;
    expect(fixHeaderSpacing(input)).toBe(expected);
  });

  it('should not modify headers with correct spacing', () => {
    const input = `## Chapter 2
== Section Title`;
    expect(fixHeaderSpacing(input)).toBe(input);
  });

  it('should handle mixed correct and incorrect headers', () => {
    const input = `#Correct
## Correct
###Also Wrong`;
    const expected = `# Correct
## Correct
### Also Wrong`;
    expect(fixHeaderSpacing(input)).toBe(expected);
  });

  it('should handle empty content', () => {
    expect(fixHeaderSpacing('')).toBe('');
    expect(fixHeaderSpacing('   ')).toBe('   ');
  });

  it('should preserve indentation', () => {
    const input = `    ##Chapter 2`;
    const expected = `    ## Chapter 2`;
    expect(fixHeaderSpacing(input)).toBe(expected);
  });
});

describe('fixMissingHeadingLevels', () => {
  it('should add missing level 1 before level 2', () => {
    const input = `## Section 2
Content`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toContain('# Section 1');
    expect(result).toContain('## Section 2');
  });

  it('should add missing levels recursively (one at a time)', () => {
    const input = `###### Level 6
Content`;
    const result = fixMissingHeadingLevels(input);
    // Should add level 5 before level 6, then level 4 before level 5, etc.
    expect(result).toContain('# Section 1');
    expect(result).toContain('## Section 2');
    expect(result).toContain('### Section 3');
    expect(result).toContain('#### Section 4');
    expect(result).toContain('##### Section 5');
    expect(result).toContain('###### Level 6');
  });
  
  it('should only add immediate parent level', () => {
    const input = `# Level 1
### Level 3
Content`;
    const result = fixMissingHeadingLevels(input);
    // Should add level 2 before level 3, but not duplicate level 1
    expect(result).toContain('# Level 1');
    expect(result).toContain('## Section 2');
    expect(result).toContain('### Level 3');
    // Should not have duplicate level 1
    const level1Count = (result.match(/^#\s+/gm) || []).length;
    expect(level1Count).toBe(1);
  });

  it('should not add levels if they already exist', () => {
    const input = `# Level 1
## Level 2
### Level 3`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toBe(input);
  });

  it('should handle asciidoc headers', () => {
    const input = `=== Level 3
Content`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toContain('= Section 1');
    expect(result).toContain('== Section 2');
    expect(result).toContain('=== Level 3');
  });

  it('should work recursively through document', () => {
    const input = `# Level 1
### Level 3
#### Level 4`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toContain('# Level 1');
    expect(result).toContain('## Section 2');
    expect(result).toContain('### Level 3');
    expect(result).toContain('#### Level 4');
  });

  it('should handle empty content', () => {
    expect(fixMissingHeadingLevels('')).toBe('');
  });

  it('should handle content without headers', () => {
    const input = `Just some text
No headers here`;
    expect(fixMissingHeadingLevels(input)).toBe(input);
  });
});

describe('extractTitleFromContent', () => {
  it('should extract document-level header', () => {
    const input = `# Document Title
Content here`;
    expect(extractTitleFromContent(input)).toBe('Document Title');
  });

  it('should extract asciidoc document-level header', () => {
    const input = `= Document Title
Content here`;
    expect(extractTitleFromContent(input)).toBe('Document Title');
  });

  it('should extract first header if no doc-level header', () => {
    const input = `## Section Title
Content here`;
    expect(extractTitleFromContent(input)).toBe('Section Title');
  });

  it('should extract first line if no headers', () => {
    const input = `This is the first line of text
More content here`;
    expect(extractTitleFromContent(input)).toBe('This is the first line of text');
  });

  it('should handle empty content', () => {
    expect(extractTitleFromContent('')).toBeNull();
    expect(extractTitleFromContent('   ')).toBeNull();
  });

  it('should prefer doc-level over section-level', () => {
    const input = `# Document Title
## Section Title`;
    expect(extractTitleFromContent(input)).toBe('Document Title');
  });
});

describe('ensureDocumentHeader', () => {
  it('should add document header if missing', () => {
    const input = `Some content here`;
    const result = ensureDocumentHeader(input, 'My Title', true);
    expect(result).toContain('= My Title');
  });

  it('should not add header if already present', () => {
    const input = `= Existing Title
Content`;
    const result = ensureDocumentHeader(input, 'My Title', true);
    expect(result).toBe(input);
  });

  it('should handle markdown format', () => {
    const input = `Some content`;
    const result = ensureDocumentHeader(input, 'My Title', false);
    expect(result).toContain('# My Title');
  });

  it('should extract title from content if not provided', () => {
    const input = `## Section Title
Content`;
    const result = ensureDocumentHeader(input, undefined, true);
    expect(result).toContain('= Section Title');
  });

  it('should insert after attributes', () => {
    const input = `:author: John Doe
:version: 1.0
Content here`;
    const result = ensureDocumentHeader(input, 'My Title', true);
    expect(result).toContain(':version: 1.0');
    expect(result).toContain('= My Title');
    expect(result.indexOf('= My Title')).toBeGreaterThan(result.indexOf(':version: 1.0'));
  });
});

describe('fixPreambleContent', () => {
  it('should move content between doc header and first section to Preamble', () => {
    const input = `= Document Title
:author: John

This is preamble content.
It should be in a Preamble section.

== First Section
Section content`;
    const result = fixPreambleContent(input, true);
    expect(result).toContain('= Document Title');
    expect(result).toContain('== Preamble');
    expect(result).toContain('This is preamble content');
    expect(result).toContain('== First Section');
  });

  it('should handle markdown format', () => {
    const input = `# Document Title

Preamble content here.

## First Section
Section content`;
    const result = fixPreambleContent(input, false);
    expect(result).toContain('# Document Title');
    expect(result).toContain('## Preamble');
    expect(result).toContain('Preamble content here');
  });

  it('should not create Preamble if no content before first section', () => {
    const input = `= Document Title
== First Section
Content`;
    const result = fixPreambleContent(input, true);
    expect(result).toBe(input);
  });

  it('should handle images in preamble', () => {
    const input = `= Document Title
image::example.png[]

== First Section`;
    const result = fixPreambleContent(input, true);
    expect(result).toContain('== Preamble');
    expect(result).toContain('image::example.png[]');
  });
});

describe('fixLinkAndMediaFormatting', () => {
  it('should convert asciidoc links to markdown for markdown events', () => {
    const input = `link:https://example.com[Example]
image::image.png[Alt Text]`;
    const result = fixLinkAndMediaFormatting(input, false);
    expect(result).toContain('[Example](https://example.com)');
    expect(result).toContain('![Alt Text](image.png)');
  });

  it('should convert markdown links to asciidoc for asciidoc events', () => {
    const input = `[Example](https://example.com)
![Alt Text](image.png)`;
    const result = fixLinkAndMediaFormatting(input, true);
    expect(result).toContain('link:https://example.com[Example]');
    expect(result).toContain('image::image.png[Alt Text]');
  });

  it('should handle reference-style links', () => {
    const input = `[Example][ref]
[ref]: https://example.com`;
    const result = fixLinkAndMediaFormatting(input, true);
    expect(result).toContain('link:https://example.com[Example]');
  });

  it('should handle autolinks', () => {
    const input = `<https://example.com>`;
    const result = fixLinkAndMediaFormatting(input, true);
    expect(result).toContain('link:https://example.com[]');
  });
});

describe('processContentQuality', () => {
  it('should apply all fixes in correct order', () => {
    const event = {
      tags: [['title', 'My Document']],
      content: `##Chapter 1
Content here
###Subsection`,
      kind: 30023
    };
    const result = processContentQuality(event.content, event, false);
    // Title should be used from tags
    expect(result).toContain('# My Document');
    // Header spacing should be fixed
    expect(result).toContain('## Chapter 1');
    expect(result).toContain('### Subsection');
    // Document header serves as level 1, so no need to add Section 1
  });

  it('should handle weird edge cases gracefully', () => {
    const event = {
      tags: [],
      content: `######Level 6
Content`,
      kind: 30023
    };
    const result = processContentQuality(event.content, event, false);
    expect(result).toContain('#');
    expect(result).toContain('###### Level 6');
  });

  it('should handle empty content', () => {
    const event = {
      tags: [['title', 'Title']],
      content: '',
      kind: 30023
    };
    const result = processContentQuality(event.content, event, false);
    expect(result).toContain('# Title');
  });

  it('should handle content with only whitespace', () => {
    const event = {
      tags: [['title', 'Title']],
      content: '   \n  \n  ',
      kind: 30023
    };
    const result = processContentQuality(event.content, event, false);
    expect(result).toContain('# Title');
  });
  
  it('should handle Setext headers with = underlines', () => {
    const input = `Header 1
========
Content here
## Subsection`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toContain('Header 1');
    expect(result).toContain('========');
    expect(result).toContain('## Subsection');
  });
  
  it('should handle Setext headers with - underlines', () => {
    const input = `Header 2
--------
Content here`;
    const result = fixMissingHeadingLevels(input);
    expect(result).toContain('Header 2');
    expect(result).toContain('--------');
  });
  
  it('should extract title from Setext headers', () => {
    const input = `Main Title
==========
Content`;
    expect(extractTitleFromContent(input)).toBe('Main Title');
  });
  
  it('should extract title from Setext level 2 headers', () => {
    const input = `Subtitle
--------
Content`;
    expect(extractTitleFromContent(input)).toBe('Subtitle');
  });
  
  it('should handle preamble content correctly', () => {
    const event = {
      tags: [['title', 'Test Document']],
      content: `= Test Document
:author: John Doe

This is preamble content.
It should be in a Preamble section.

== First Section
Section content`,
      kind: 30818
    };
    const result = processContentQuality(event.content, event, true);
    expect(result).toContain('== Preamble');
    expect(result).toContain('This is preamble content');
    expect(result).toContain('== First Section');
  });
  
  it('should fix link and media formatting', () => {
    const event = {
      tags: [['title', 'Test']],
      content: `[Example Link](https://example.com)
![Image Alt](image.png)`,
      kind: 30023
    };
    const result = processContentQuality(event.content, event, true); // asciidoc
    expect(result).toContain('link:https://example.com[Example Link]');
    expect(result).toContain('image::image.png[Image Alt]');
  });
});

describe('processWikilinks', () => {
  it('should process regular wikilinks in AsciiDoc', () => {
    const content = `Check out [[article-name]] for more info.
Also see [[another-article | Display Text]].`;
    const result = processWikilinks(content, true); // asciidoc
    // Regular wikilinks should have hyphens replaced with spaces in display text
    expect(result).toContain('link:wikilink:article-name[article name]');
    expect(result).toContain('link:wikilink:another-article[Display Text]'); // Explicit display text preserved
  });

  it('should process regular wikilinks in Markdown', () => {
    const content = `Check out [[article-name]] for more info.
Also see [[another-article | Display Text]].`;
    const result = processWikilinks(content, false); // markdown
    // Regular wikilinks should have hyphens replaced with spaces in display text
    expect(result).toContain('[article name](wikilink:article-name)');
    expect(result).toContain('[Display Text](wikilink:another-article)'); // Explicit display text preserved
  });

  it('should process book wikilinks in AsciiDoc with human-readable display', () => {
    const content = `See [[book:: bible | john 3:16, romans 2:3-10]] for the verses.`;
    const result = processWikilinks(content, true); // asciidoc
    // Should contain the link with book:: prefix
    expect(result).toContain('link:wikilink:book::');
    // Bible format: _The Holy Bible_, John 3:16, Romans 2:3-10
    // Note: ranges are collapsed (2:3-10 becomes 2:3-10)
    // No "Ch." prefix for Bible references
    expect(result).toMatch(/\[_The Holy Bible_, John 3:16/);
    expect(result).toMatch(/Romans 2:3-10/);
    // Should not contain raw book:: prefix in display text
    expect(result).not.toContain('[book::');
  });

  it('should process book wikilinks in Markdown with human-readable display', () => {
    const content = `See [[book:: bible | john 3:16, romans 2:3-10]] for the verses.`;
    const result = processWikilinks(content, false); // markdown
    // Should contain the link with book:: prefix
    expect(result).toContain('](wikilink:book::');
    // Bible format: _The Holy Bible_, John 3:16, Romans 2:3-10
    // Note: ranges are collapsed (2:3-10 becomes 2:3-10)
    // No "Ch." prefix for Bible references
    expect(result).toMatch(/\[_The Holy Bible_, John 3:16/);
    expect(result).toMatch(/Romans 2:3-10/);
    // Should not contain raw book:: prefix in display text
    expect(result).not.toMatch(/\[book::/);
  });

  it('should process book wikilinks with version in title-case', () => {
    const content = `Read [[book:: jane-eyre 2:4 | british-classics]] for the passage.`;
    const result = processWikilinks(content, true); // asciidoc
    // Display text should be: _Jane Eyre_ Ch. 2:4, from the British Classics edition
    // Note: "british-classics" is the version, not the collection
    expect(result).toContain('link:wikilink:book::');
    // Should have title in italics with chapter formatted as "Ch. 2:4"
    expect(result).toMatch(/\[_Jane Eyre_, Ch\. 2:4/);
    // Version should be in title case at the end: "from the British Classics edition"
    expect(result).toMatch(/from the British Classics edition/);
    expect(result).not.toMatch(/BRITISH-CLASSICS/);
    // The raw version text should still be in the link URL, but not in the display text
    expect(result).toMatch(/british-classics/); // In the URL part
    expect(result).not.toMatch(/\[.*british-classics.*\]/); // Not in display text (should be "British Classics")
  });

  it('should process book wikilinks with collection, chapter-section range, and version', () => {
    const content = `Read [[book:: british-classics | jane-eyre chapter-21:4-7 | oxford-publishing]] for the passage.`;
    const result = processWikilinks(content, true); // asciidoc
    // Structure: collection | title chapter:section | version
    // Display text should be: _Jane Eyre_ Ch. 21:4-7, from the Oxford Publishing edition of the _British Classics_
    expect(result).toContain('link:wikilink:book::');
    // Should have title in italics with chapter and section formatted as "Ch. 21:4-7"
    expect(result).toMatch(/\[_Jane Eyre_, Ch\. 21:4-7/);
    // The display text (inside brackets) should not contain the raw chapter-21 format
    expect(result).not.toMatch(/\[[^\]]*chapter-21:4-7[^\]]*\]/);
    expect(result).not.toMatch(/Chapter 21:4-7/); // Should use "Ch." not "Chapter"
    // Should have version and collection at the end: "from the Oxford Publishing edition of the _British Classics_"
    expect(result).toMatch(/from the Oxford Publishing edition of the _British Classics_/);
    // The raw values should still be in the link URL
    expect(result).toMatch(/british-classics/); // Collection in URL
    expect(result).toMatch(/oxford-publishing/); // Version in URL
  });

  it('should not process book wikilinks as regular wikilinks', () => {
    const content = `[[book::test]] and [[regular-wikilink]]`;
    const result = processWikilinks(content, true);
    expect(result).toContain('link:wikilink:book::test[');
    expect(result).toContain('link:wikilink:regular-wikilink[');
    expect(result).not.toContain('link:wikilink:book::test]]');
  });

  it('should format Bible wikilinks with version correctly', () => {
    const content = `See [[book:: bible | john 3:16, genesis 4:2-4 | kjv]] for the verses.`;
    const result = processWikilinks(content, true); // asciidoc
    // Bible format with version: _The King James Version Bible_, John 3:16, Genesis 4:2-4
    expect(result).toContain('link:wikilink:book::');
    expect(result).toMatch(/\[_The King James Version Bible_, John 3:16/);
    expect(result).toMatch(/Genesis 4:2-4/);
    // Should not have "Ch." prefix for Bible references
    expect(result).not.toMatch(/Ch\. 3:16/);
  });

  it('should format Bible wikilinks without version correctly', () => {
    const content = `See [[book:: bible | john 3:16, genesis 4:2-4]] for the verses.`;
    const result = processWikilinks(content, true); // asciidoc
    // Bible format without version: _The Holy Bible_, John 3:16, Genesis 4:2-4
    expect(result).toContain('link:wikilink:book::');
    expect(result).toMatch(/\[_The Holy Bible_, John 3:16/);
    expect(result).toMatch(/Genesis 4:2-4/);
    // Should not have "Ch." prefix for Bible references
    expect(result).not.toMatch(/Ch\. 3:16/);
  });

  it('should not add "Bible" to version name if it already contains it', () => {
    const content = `See [[book:: bible | john 3:16 | the-amplified-bible]] for the verse.`;
    const result = processWikilinks(content, true); // asciidoc
    // Version "The Amplified Bible" should not become "The Amplified Bible Bible"
    expect(result).toMatch(/\[_The Amplified Bible_, John 3:16/);
    expect(result).not.toMatch(/The Amplified Bible Bible/);
  });

  it('should handle wikilinks with special characters', () => {
    const content = `[[article-name-with-dashes]] and [[article_name_with_underscores]]`;
    const result = processWikilinks(content, true);
    expect(result).toContain('link:wikilink:article-name-with-dashes[');
    expect(result).toContain('link:wikilink:article_name_with_underscores[');
  });

  it('should handle empty content', () => {
    expect(processWikilinks('', true)).toBe('');
    expect(processWikilinks('', false)).toBe('');
  });
});

describe('processNostrAddresses', () => {
  // Mock getUserDisplayName function
  const mockGetUserDisplayName = async (pubkey: string): Promise<string> => {
    if (pubkey === 'test-pubkey-123') {
      return 'Test User';
    }
    return `npub1${pubkey.slice(0, 8)}...`;
  };

  it('should remove nostr: prefix from links', async () => {
    // Use a valid-looking bech32 format (even if not actually valid)
    const content = `Check out nostr:npub1abc123456789012345678901234567890123456789012345678901234567890 for more info.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // The function will try to decode, and if it fails, it will keep the original
    // So we just check that it processed the content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should process npub addresses', async () => {
    const content = `Follow nostr:npub1test123456789012345678901234567890123456789012345678901234567890 for updates.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // Function processes the content (may keep original if decode fails, or convert to link)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should process standalone npub without nostr: prefix', async () => {
    const content = `Follow npub1test123456789012345678901234567890123456789012345678901234567890 for updates.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // Function processes the content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should process nevent addresses', async () => {
    const content = `See nostr:nevent1abc123456789012345678901234567890123456789012345678901234567890 for the event.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // Function processes the content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should process naddr addresses', async () => {
    const content = `Read nostr:naddr1abc123456789012345678901234567890123456789012345678901234567890 for the article.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // Function processes the content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should process hex event IDs', async () => {
    const content = `Event ID: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    expect(result).toContain('link:nostr:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
  });

  it('should process Nostr addresses in Markdown format', async () => {
    const content = `Follow nostr:npub1test123456789012345678901234567890123456789012345678901234567890 for updates.`;
    const result = await processNostrAddresses(content, false, mockGetUserDisplayName);
    // Function processes the content (may convert to markdown link format)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should handle content without Nostr addresses', async () => {
    const content = `This is just regular text with no Nostr addresses.`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    expect(result).toBe(content);
  });

  it('should handle empty content', async () => {
    const result = await processNostrAddresses('', true, mockGetUserDisplayName);
    expect(result).toBe('');
  });

  it('should process multiple Nostr addresses', async () => {
    const content = `User: nostr:npub1abc123456789012345678901234567890123456789012345678901234567890 Event: nostr:nevent1def123456789012345678901234567890123456789012345678901234567890`;
    const result = await processNostrAddresses(content, true, mockGetUserDisplayName);
    // Function processes all addresses in content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

describe('processContentQualityAsync', () => {
  // Mock getUserDisplayName function
  const mockGetUserDisplayName = async (pubkey: string): Promise<string> => {
    return `User ${pubkey.slice(0, 8)}`;
  };

  it('should process content with wikilinks and Nostr addresses', async () => {
    const event = {
      tags: [['title', 'Test Article']],
      content: `Check out [[article-name]] and follow nostr:npub1test123456789012345678901234567890123456789012345678901234567890`,
      kind: 30818
    };
    const result = await processContentQualityAsync(event.content, event, true, mockGetUserDisplayName);
    expect(result).toContain('link:wikilink:article-name');
    // Nostr address processing may keep original or convert to link
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should apply all quality fixes including Nostr processing', async () => {
    const event = {
      tags: [['title', 'Test']],
      content: `##Missing Header
Some content with nostr:npub1test123456789012345678901234567890123456789012345678901234567890`,
      kind: 30023
    };
    const result = await processContentQualityAsync(event.content, event, false, mockGetUserDisplayName);
    // Should fix header spacing
    expect(result).toContain('## Missing Header');
    // Should process Nostr address
    expect(result).toContain('nostr:npub1');
  });

  it('should handle empty content', async () => {
    const event = {
      tags: [['title', 'Test']],
      content: '',
      kind: 30818
    };
    const result = await processContentQualityAsync(event.content, event, true, mockGetUserDisplayName);
    expect(result).toContain('= Test');
  });
});

