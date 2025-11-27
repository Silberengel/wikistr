import { describe, it, expect, beforeEach, vi } from 'vitest';
import { combineBookEvents } from '../src/lib/articleDownload';
import type { NostrEvent } from '@nostr/tools/pure';

// Mock relayService to avoid actual network calls
vi.mock('../src/lib/relayService', () => ({
  relayService: {
    queryEvents: vi.fn().mockResolvedValue({
      events: [],
      relays: []
    })
  }
}));

// Helper to create mock 30040 (book index) event
function createMockBookEvent(
  title: string,
  author?: string,
  image?: string,
  description?: string,
  summary?: string
): NostrEvent {
  const tags: string[][] = [['d', 'test-book']];
  if (title) {
    tags.push(['title', title]);
  }
  if (author) {
    tags.push(['author', author]);
  }
  if (image) {
    tags.push(['image', image]);
  }
  if (description) {
    tags.push(['description', description]);
  }
  if (summary) {
    tags.push(['summary', summary]);
  }
  tags.push(['version', '1.0']);
  tags.push(['published', '2024-01-01']);
  tags.push(['publisher', 'Test Publisher']);
  
  return {
    id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    pubkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    created_at: Math.floor(Date.now() / 1000),
    kind: 30040,
    tags,
    content: '',
    sig: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
}

// Helper to create mock 30041 (book content) event
function createMockContentEvent(
  title: string,
  content: string,
  kind: number = 30041
): NostrEvent {
  const tags: string[][] = [['d', 'test-content']];
  if (title) {
    tags.push(['title', title]);
  }
  
  return {
    id: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    pubkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
    sig: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
}

describe('Book Structure (HTML/EPUB)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate correct structure: Cover page -> TOC -> Book Metadata -> Abstract -> Preface', async () => {
    const bookEvent = createMockBookEvent(
      'Test Book Title',
      'Test Author',
      'https://example.com/cover.jpg',
      'This is a test book description',
      'This is a test book summary'
    );

    const prefaceEvent = createMockContentEvent('Preface', 'This is the preface content.');
    const contentEvents = [prefaceEvent];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);

    // Split into lines for easier analysis
    const lines = asciidoc.split('\n');

    // Find positions of key sections
    const coverPageIndex = lines.findIndex(line => line.trim() === '== Test Book Title');
    const tocIndex = lines.findIndex(line => line.trim() === 'toc::[]');
    const bookMetadataIndex = lines.findIndex(line => line.trim() === '== Book Metadata');
    const abstractIndex = lines.findIndex(line => line.trim() === '== Abstract');
    const prefaceIndex = lines.findIndex(line => line.includes('Preface') && line.startsWith('=='));
    const preambleIndex = lines.findIndex(line => line.trim() === '== Preamble');

    // Verify cover page exists and is first section (after header attributes)
    expect(coverPageIndex).toBeGreaterThan(-1);
    expect(coverPageIndex).toBeLessThan(tocIndex);

    // Verify cover image is present with correct attributes
    const coverImageLine = lines.find(line => line.includes('image::') && line.includes('cover'));
    expect(coverImageLine).toBeDefined();
    expect(coverImageLine).toContain('width=400px');
    expect(coverImageLine).toContain('scaledwidth=50%');
    expect(coverImageLine).toContain('https://example.com/cover.jpg');

    // Verify TOC comes after cover page
    expect(tocIndex).toBeGreaterThan(-1);
    expect(tocIndex).toBeGreaterThan(coverPageIndex);
    expect(tocIndex).toBeLessThan(bookMetadataIndex);

    // Verify Book Metadata comes after TOC
    expect(bookMetadataIndex).toBeGreaterThan(-1);
    expect(bookMetadataIndex).toBeGreaterThan(tocIndex);

    // Verify Abstract comes after Book Metadata
    expect(abstractIndex).toBeGreaterThan(-1);
    expect(abstractIndex).toBeGreaterThan(bookMetadataIndex);

    // Verify Preface comes after Abstract
    expect(prefaceIndex).toBeGreaterThan(-1);
    expect(prefaceIndex).toBeGreaterThan(abstractIndex);

    // Verify NO Preamble section exists
    expect(preambleIndex).toBe(-1);
  });

  it('should have cover page as first section after document header', async () => {
    const bookEvent = createMockBookEvent('Test Book', 'Test Author', 'https://example.com/cover.jpg');
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);
    const lines = asciidoc.split('\n');

    // Find document header end (last attribute line)
    let headerEndIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith(':') && !lines[i].trim().startsWith('::')) {
        headerEndIndex = i;
      } else if (lines[i].trim().startsWith('==') && headerEndIndex >= 0) {
        // Found first section
        const firstSectionIndex = i;
        const firstSectionTitle = lines[i].trim();
        
        // First section should be the cover page (book title)
        expect(firstSectionTitle).toBe('== Test Book');
        expect(firstSectionIndex).toBeGreaterThan(headerEndIndex);
        expect(firstSectionIndex - headerEndIndex).toBeLessThan(5); // Should be close to header
        break;
      }
    }
  });

  it('should include cover image with max 400px width constraint for HTML', async () => {
    const bookEvent = createMockBookEvent('Test Book', 'Test Author', 'https://example.com/cover.jpg');
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);

    // Verify cover image has maxwidth=400px (max-width constraint, won't enlarge small images)
    expect(asciidoc).toContain('image::https://example.com/cover.jpg[cover,maxwidth=400px');
    expect(asciidoc).toContain('scaledwidth=50%'); // For EPUB to fit on one page
  });

  it('should not include preamble section', async () => {
    const bookEvent = createMockBookEvent('Test Book', 'Test Author');
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);

    // Should not contain preamble section
    expect(asciidoc).not.toContain('== Preamble');
    expect(asciidoc).not.toContain('[preface]');
    expect(asciidoc).not.toContain('[dedication]');
  });

  it('should have correct order: Cover -> TOC -> Metadata -> Abstract -> Content', async () => {
    const bookEvent = createMockBookEvent(
      'Test Book',
      'Test Author',
      'https://example.com/cover.jpg',
      'Book description'
    );
    const chapterEvent = createMockContentEvent('Chapter 1', 'Chapter content');
    const contentEvents = [chapterEvent];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);
    const lines = asciidoc.split('\n');

    // Extract section order
    const sections: Array<{ name: string; index: number }> = [];
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('== ')) {
        sections.push({ name: trimmed, index });
      } else if (trimmed === 'toc::[]') {
        sections.push({ name: 'TOC', index });
      }
    });

    // Verify order
    const coverIndex = sections.findIndex(s => s.name === '== Test Book');
    const tocIndex = sections.findIndex(s => s.name === 'TOC');
    const metadataIndex = sections.findIndex(s => s.name === '== Book Metadata');
    const abstractIndex = sections.findIndex(s => s.name === '== Abstract');
    const chapterIndex = sections.findIndex(s => s.name.includes('Chapter'));

    expect(coverIndex).toBeGreaterThan(-1);
    expect(tocIndex).toBeGreaterThan(coverIndex);
    expect(metadataIndex).toBeGreaterThan(tocIndex);
    expect(abstractIndex).toBeGreaterThan(metadataIndex);
    if (chapterIndex > -1) {
      expect(chapterIndex).toBeGreaterThan(abstractIndex);
    }
  });

  it('should have cover page content on single page (compact layout)', async () => {
    const bookEvent = createMockBookEvent('Test Book', 'Test Author', 'https://example.com/cover.jpg');
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);
    const lines = asciidoc.split('\n');

    // Find cover page section
    const coverIndex = lines.findIndex(line => line.trim() === '== Test Book');
    expect(coverIndex).toBeGreaterThan(-1);

    // Find where cover page ends (TOC or next section)
    const tocIndex = lines.findIndex(line => line.trim() === 'toc::[]');
    expect(tocIndex).toBeGreaterThan(coverIndex);

    // Count lines in cover page section
    const coverPageLines = lines.slice(coverIndex, tocIndex);
    const nonEmptyLines = coverPageLines.filter(line => line.trim().length > 0);

    // Cover page should be compact (title, image, author, spacing)
    // Should have relatively few lines to fit on one page
    expect(nonEmptyLines.length).toBeLessThan(10);
  });

  it('should include cover image with absolute URL for EPUB embedding', async () => {
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Jane_Eyre.jpg';
    const bookEvent = createMockBookEvent('Test Book', 'Test Author', imageUrl);
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);

    // Verify the image is included with the correct URL
    expect(asciidoc).toContain(`image::${imageUrl}[cover`);
    
    // Verify image has proper attributes for EPUB
    expect(asciidoc).toContain('maxwidth=400px'); // Max width, not fixed width
    expect(asciidoc).toContain('scaledwidth=50%');
    expect(asciidoc).toContain('align=center');
    
    // Verify the image URL is absolute (starts with http:// or https://)
    const imageLine = asciidoc.split('\n').find(line => line.includes('image::') && line.includes('cover'));
    expect(imageLine).toBeDefined();
    if (imageLine) {
      expect(imageLine).toMatch(/^image::https?:\/\//);
    }
  });

  it('should include front-cover-image attribute for PDF compatibility', async () => {
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Jane_Eyre.jpg';
    const bookEvent = createMockBookEvent('Test Book', 'Test Author', imageUrl);
    const contentEvents: NostrEvent[] = [];

    const asciidoc = await combineBookEvents(bookEvent, contentEvents, true);

    // Verify front-cover-image attribute is set (for PDF, but also helps EPUB)
    expect(asciidoc).toContain(`:front-cover-image: ${imageUrl}`);
  });
});

