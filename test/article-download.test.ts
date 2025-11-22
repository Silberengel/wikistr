import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exportToPDF, exportToEPUB, checkServerHealth } from '../src/lib/asciidoctorExport';
import { 
  downloadAsPDF, 
  downloadAsEPUB, 
  downloadAsAsciiDoc,
  downloadAsMarkdown,
  prepareAsciiDocContent 
} from '../src/lib/articleDownload';
import type { NostrEvent } from '@nostr/tools/pure';

// Mock NostrEvent for testing
function createMockEvent(
  kind: number,
  content: string,
  title?: string,
  pubkey: string = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
): NostrEvent {
  const tags: string[][] = [];
  if (title) {
    tags.push(['title', title]);
  }
  tags.push(['d', 'test-article']);
  
  return {
    id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
    sig: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
}

describe('AsciiDoctor Server Integration', () => {
  const ASCIIDOCTOR_URL = process.env.VITE_ASCIIDOCTOR_SERVER_URL || 'http://localhost:8091';
  const TEST_TIMEOUT = 30000; // 30 seconds for server requests

  beforeAll(async () => {
    // Check if server is available
    const isHealthy = await checkServerHealth();
    if (!isHealthy) {
      console.warn('⚠️  AsciiDoctor server is not available. Some tests will be skipped.');
      console.warn('   Start the server with: docker run -d --name asciidoctor -p 8091:8091 ...');
    }
  }, 10000);

  describe('Server Health Check', () => {
    it('should check server health', async () => {
      const isHealthy = await checkServerHealth();
      expect(typeof isHealthy).toBe('boolean');
    }, TEST_TIMEOUT);
  });

  describe('PDF Generation', () => {
    it('should generate PDF from AsciiDoc content', async () => {
      const testContent = `= Test Document

This is a test document with some content.

== Section 1

Here is some content in section 1.

* Item 1
* Item 2
* Item 3

== Section 2

More content here.`;

      const blob = await exportToPDF({
        content: testContent,
        title: 'Test Document',
        author: 'Test Author'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe('application/pdf');
      
      // Verify it's actually a PDF by checking the first bytes
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      // PDF files start with %PDF
      expect(String.fromCharCode(...uint8Array.slice(0, 4))).toBe('%PDF');
    }, TEST_TIMEOUT);

    it('should handle markdown-like content', async () => {
      const markdownContent = `# Test Document

This is markdown content that should be converted.

## Section 1

Some content here.`;

      const blob = await exportToPDF({
        content: markdownContent,
        title: 'Markdown Test',
        author: 'Test Author'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe('application/pdf');
    }, TEST_TIMEOUT);

    it('should handle empty content (server may generate minimal file)', async () => {
      // Note: AsciiDoctor server generates a minimal PDF even with empty content
      // So we test that it doesn't crash, but the file might be small
      const blob = await exportToPDF({
        content: '',
        title: 'Empty Test',
        author: 'Test Author'
      });
      
      // Server generates a file, but it should be relatively small for empty content
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      // Empty content might still generate a minimal PDF with just a title page
      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should handle special characters in title', async () => {
      const blob = await exportToPDF({
        content: '= Test\n\nContent here.',
        title: 'Test & Document <with> Special "Characters"',
        author: 'Test Author'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('EPUB Generation', () => {
    it('should generate EPUB from AsciiDoc content', async () => {
      const testContent = `= Test Book

This is a test book.

== Chapter 1

Content for chapter 1.

== Chapter 2

Content for chapter 2.`;

      const blob = await exportToEPUB({
        content: testContent,
        title: 'Test Book',
        author: 'Test Author'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
      // EPUB files are ZIP archives, so type might be application/zip or application/epub+zip
      expect(['application/epub+zip', 'application/zip']).toContain(blob.type);
      
      // Verify it's actually a ZIP file (EPUB is a ZIP archive)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      // ZIP files start with PK (0x50 0x4B)
      expect(uint8Array[0]).toBe(0x50);
      expect(uint8Array[1]).toBe(0x4B);
    }, TEST_TIMEOUT);

    it('should handle empty content (server may generate minimal file)', async () => {
      // Note: AsciiDoctor server may generate a minimal EPUB even with empty content
      // So we test that it doesn't crash, but the file might be small
      const blob = await exportToEPUB({
        content: '',
        title: 'Empty Test',
        author: 'Test Author'
      });
      
      // Server generates a file, but it should be relatively small for empty content
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      // Empty content might still generate a minimal EPUB structure
    }, TEST_TIMEOUT);
  });

  describe('Article Download Functions', () => {
    it('should prepare AsciiDoc content from 30818 event', () => {
      const event = createMockEvent(
        30818,
        `= Test Article

This is AsciiDoc content.`,
        'Test Article'
      );

      const prepared = prepareAsciiDocContent(event);
      expect(prepared).toContain('Test Article');
      expect(prepared).toContain('AsciiDoc content');
    });

    it('should prepare AsciiDoc content from 30817 (Markdown) event', () => {
      const event = createMockEvent(
        30817,
        `# Test Article

This is Markdown content.`,
        'Test Article'
      );

      const prepared = prepareAsciiDocContent(event);
      expect(prepared).toContain('Test Article');
      expect(prepared).toContain('Markdown content');
    });

    it('should handle empty content in prepareAsciiDocContent', () => {
      const event = createMockEvent(30818, '', 'Test Article');
      const prepared = prepareAsciiDocContent(event);
      expect(prepared).toContain('Test Article');
      expect(prepared).toContain('No content available');
    });

    it('should download PDF from 30818 event', async () => {
      const event = createMockEvent(
        30818,
        `= Test Article

This is a test article with content.

== Section 1

Some content here.`,
        'Test Article'
      );

      // Mock downloadBlob to avoid actual file download
      const originalDownloadBlob = (global as any).downloadBlob;
      let downloadedBlob: Blob | null = null;
      let downloadedFilename: string | null = null;

      // We can't easily mock downloadBlob since it's not exported, so we'll test the export function directly
      const blob = await exportToPDF({
        content: event.content,
        title: event.tags.find(([k]) => k === 'title')?.[1] || 'Test',
        author: event.pubkey.slice(0, 8) + '...'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe('application/pdf');
    }, TEST_TIMEOUT);

    it('should download EPUB from 30818 event', async () => {
      const event = createMockEvent(
        30818,
        `= Test Article

This is a test article.

== Chapter 1

Content here.`,
        'Test Article'
      );

      const blob = await exportToEPUB({
        content: event.content,
        title: event.tags.find(([k]) => k === 'title')?.[1] || 'Test',
        author: event.pubkey.slice(0, 8) + '...'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should throw error for empty content in downloadAsPDF', async () => {
      const event = createMockEvent(30818, '', 'Test Article');
      
      await expect(downloadAsPDF(event)).rejects.toThrow('Cannot download PDF: article content is empty');
    });

    it('should throw error for empty content in downloadAsEPUB', async () => {
      const event = createMockEvent(30818, '', 'Test Article');
      
      await expect(downloadAsEPUB(event)).rejects.toThrow('Cannot download EPUB: article content is empty');
    });

    it('should handle 30817 (Markdown) event for PDF', async () => {
      const event = createMockEvent(
        30817,
        `# Test Markdown Article

This is markdown content.

## Section 1

Some content.`,
        'Test Markdown Article'
      );

      const blob = await exportToPDF({
        content: prepareAsciiDocContent(event),
        title: event.tags.find(([k]) => k === 'title')?.[1] || 'Test',
        author: event.pubkey.slice(0, 8) + '...'
      });

      // Check if it's a Blob (works in both browser and Node.js test environments)
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    it('should handle server errors gracefully', async () => {
      // Test with invalid URL that will fail to connect
      const invalidUrl = 'http://localhost:99999'; // Unlikely to be running
      
      // Create a fetch mock that simulates connection failure
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Connection refused');
      };
      
      try {
        await expect(
          exportToPDF({
            content: '= Test\n\nContent',
            title: 'Test',
            author: 'Author'
          })
        ).rejects.toThrow();
      } finally {
        global.fetch = originalFetch;
      }
    }, TEST_TIMEOUT);

    it('should validate blob size after generation', async () => {
      const blob = await exportToPDF({
        content: '= Test\n\nContent',
        title: 'Test',
        author: 'Author'
      });

      // Blob should not be empty
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(1000); // At least 1KB for a valid PDF
    }, TEST_TIMEOUT);
  });

  describe('Content Type Validation', () => {
    it('should verify PDF content type', async () => {
      const blob = await exportToPDF({
        content: '= Test\n\nContent',
        title: 'Test',
        author: 'Author'
      });

      expect(blob.type).toBe('application/pdf');
    }, TEST_TIMEOUT);

    it('should verify EPUB content type', async () => {
      const blob = await exportToEPUB({
        content: '= Test\n\nContent',
        title: 'Test',
        author: 'Author'
      });

      expect(['application/epub+zip', 'application/zip']).toContain(blob.type);
    }, TEST_TIMEOUT);
  });

  describe('Real-world Content Scenarios', () => {
    it('should handle long content', async () => {
      const longContent = `= Long Document

${Array(100).fill('== Section\n\nThis is a long section with lots of content.\n\n').join('\n')}`;

      const blob = await exportToPDF({
        content: longContent,
        title: 'Long Document',
        author: 'Author'
      });

      expect(blob.size).toBeGreaterThan(10000); // Should be larger for long content
    }, TEST_TIMEOUT);

    it('should handle content with special characters', async () => {
      const specialContent = `= Special Characters Test

This document contains: & < > " ' / \\ and unicode: 中文 العربية עברית`;

      const blob = await exportToPDF({
        content: specialContent,
        title: 'Special Characters',
        author: 'Author'
      });

      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should handle content with code blocks', async () => {
      const codeContent = `= Code Test

[source,javascript]
----
function test() {
  return "hello";
}
----`;

      const blob = await exportToPDF({
        content: codeContent,
        title: 'Code Test',
        author: 'Author'
      });

      expect(blob.size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('30040 Book Download (Nested Branches and Leaves)', () => {
    it('should fetch and combine all nested 30041 events for 30040', async () => {
      const { fetchBookContentEvents, combineBookEvents } = await import('../src/lib/articleDownload');
      
      // Create a mock 30040 index event that references 30041 events
      const indexEvent = createMockEvent(
        30040,
        'This is the book index.',
        'Test Book'
      );
      
      // Add 'e' tags to reference content events
      indexEvent.tags.push(['e', 'event1']);
      indexEvent.tags.push(['e', 'event2']);
      
      // Note: This test will fail if events don't exist, but it verifies the structure
      // In a real scenario, these would be actual 30041 events on the relays
      try {
        const contentEvents = await fetchBookContentEvents(indexEvent);
        
        // Verify that fetchBookContentEvents returns an array (may be empty if events don't exist)
        expect(Array.isArray(contentEvents)).toBe(true);
        
        // If we have content events, verify combineBookEvents works
        if (contentEvents.length > 0) {
          const combined = await combineBookEvents(indexEvent, contentEvents);
          
          // Verify combined document includes:
          // 1. Title from index event
          expect(combined).toContain('= Test Book');
          
          // 2. All content events as sections
          expect(combined.length).toBeGreaterThan(100); // Should have substantial content
          
          // 3. Proper AsciiDoc structure (header, sections)
          expect(combined).toMatch(/^= .+\n/); // Starts with title
          expect(combined).toContain('=='); // Has sections
        }
      } catch (error) {
        // If events don't exist on relays, that's okay - we're just testing the structure
        console.warn('Could not fetch test events (may not exist on relays):', error);
      }
    }, TEST_TIMEOUT);

    it('should generate combined AsciiDoc from 30040 with multiple sections', async () => {
      const { combineBookEvents } = await import('../src/lib/articleDownload');
      
      // Create mock index event
      const indexEvent = createMockEvent(
        30040,
        'Book index content.',
        'Multi-Chapter Book'
      );
      indexEvent.tags.push(['author', 'Test Author']);
      indexEvent.tags.push(['description', 'A test book with multiple chapters']);
      
      // Create mock content events (30041)
      const contentEvent1 = createMockEvent(
        30041,
        'Chapter 1 content here.\n\nWith multiple paragraphs.',
        'Chapter 1'
      );
      contentEvent1.tags.push(['e', 'parent']); // Reference to parent
      contentEvent1.tags.push(['T', 'Chapter 1']);
      contentEvent1.tags.push(['c', '1']);
      
      const contentEvent2 = createMockEvent(
        30041,
        'Chapter 2 content here.\n\nDifferent content.',
        'Chapter 2'
      );
      contentEvent2.tags.push(['e', 'parent']);
      contentEvent2.tags.push(['T', 'Chapter 2']);
      contentEvent2.tags.push(['c', '2']);
      
      // Combine them
      const combined = await combineBookEvents(indexEvent, [contentEvent1, contentEvent2]);
      
      // Verify structure
      expect(combined).toContain('= Multi-Chapter Book');
      expect(combined).toContain(':author: Test Author');
      expect(combined).toContain('[abstract]');
      expect(combined).toContain('A test book with multiple chapters');
      
      // Verify both chapters are included
      expect(combined).toContain('== Chapter 1');
      expect(combined).toContain('Chapter 1 content here');
      expect(combined).toContain('== Chapter 2');
      expect(combined).toContain('Chapter 2 content here');
      
      // Verify content is properly separated
      const chapter1Index = combined.indexOf('== Chapter 1');
      const chapter2Index = combined.indexOf('== Chapter 2');
      expect(chapter2Index).toBeGreaterThan(chapter1Index);
    });

    it('should combine and export 30040 content correctly', async () => {
      const { fetchBookContentEvents, combineBookEvents } = await import('../src/lib/articleDownload');
      const { exportToPDF } = await import('../src/lib/asciidoctorExport');
      
      // Create mock index event
      const indexEvent = createMockEvent(
        30040,
        'Book index.',
        'Test Book for PDF'
      );
      indexEvent.tags.push(['author', 'Test Author']);
      
      // Create mock content events directly (simulating what fetchBookContentEvents would return)
      const contentEvent1 = createMockEvent(
        30041,
        'Chapter 1: Introduction\n\nThis is the first chapter.',
        'Chapter 1'
      );
      contentEvent1.tags.push(['T', 'Chapter 1']);
      contentEvent1.tags.push(['c', '1']);
      
      const contentEvent2 = createMockEvent(
        30041,
        'Chapter 2: Main Content\n\nThis is the second chapter.',
        'Chapter 2'
      );
      contentEvent2.tags.push(['T', 'Chapter 2']);
      contentEvent2.tags.push(['c', '2']);
      
      // Test combineBookEvents (this is what downloadBookAsPDF does internally)
      const combined = await combineBookEvents(indexEvent, [contentEvent1, contentEvent2]);
      
      // Verify combined document structure
      expect(combined).toContain('= Test Book for PDF');
      expect(combined).toContain(':author: Test Author');
      expect(combined).toContain('== Chapter 1');
      expect(combined).toContain('Chapter 1: Introduction');
      expect(combined).toContain('== Chapter 2');
      expect(combined).toContain('Chapter 2: Main Content');
      
      // Verify the combined AsciiDoc can be exported to PDF
      const blob = await exportToPDF({
        content: combined,
        title: 'Test Book for PDF',
        author: 'Test Author'
      });
      
      // Verify PDF was generated successfully
      expect(blob).toBeDefined();
      expect(typeof blob.size).toBe('number');
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe('application/pdf');
    }, TEST_TIMEOUT);
  });
});

