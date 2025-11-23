/**
 * Tests for EBookViewer utilities
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the EBookViewer component to avoid browser API dependencies
vi.mock('../src/components/EBookViewer.svelte', () => {
  return {
    default: class MockEBookViewer {
      $destroy() {}
    }
  };
});

// Mock pdfjs-dist to avoid browser API dependencies
vi.mock('pdfjs-dist', () => ({
  default: {
    GlobalWorkerOptions: { workerSrc: '' },
    version: '5.4.394',
    getDocument: vi.fn()
  },
  GlobalWorkerOptions: { workerSrc: '' },
  version: '5.4.394',
  getDocument: vi.fn()
}));

// Mock epubjs
vi.mock('epubjs', () => ({
  Book: vi.fn()
}));

// Mock highlight.js
vi.mock('highlight.js', () => ({
  default: {
    highlight: vi.fn(),
    highlightAuto: vi.fn(),
    highlightAll: vi.fn()
  }
}));

import { openViewer, closeViewer, isViewerOpen } from '../src/lib/viewer';

describe('EBookViewer Utilities', () => {
  const createBlob = (content: string, type: string = 'text/plain') => {
    return new Blob([content], { type });
  };

  beforeEach(() => {
    // Clean up any existing viewer
    closeViewer();
    // Clear DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    closeViewer();
  });

  describe('openViewer', () => {
    it('should create viewer container in DOM', () => {
      const blob = createBlob('Test content', 'text/plain');
      
      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });

      const container = document.getElementById('ebook-viewer-container');
      expect(container).toBeTruthy();
      expect(container?.parentElement).toBe(document.body);
    });

    it('should close existing viewer before opening new one', () => {
      const blob1 = createBlob('Content 1', 'text/plain');
      const blob2 = createBlob('Content 2', 'text/plain');

      openViewer({
        blob: blob1,
        filename: 'test1.txt',
        format: 'html'
      });

      const firstContainer = document.getElementById('ebook-viewer-container');
      expect(firstContainer).toBeTruthy();

      openViewer({
        blob: blob2,
        filename: 'test2.txt',
        format: 'html'
      });

      const containers = document.querySelectorAll('#ebook-viewer-container');
      expect(containers.length).toBe(1);
    });

    it('should accept PDF format', () => {
      const blob = createBlob('PDF content', 'application/pdf');
      
      openViewer({
        blob,
        filename: 'test.pdf',
        format: 'pdf'
      });

      expect(isViewerOpen()).toBe(true);
    });

    it('should accept EPUB format', () => {
      const blob = createBlob('EPUB content', 'application/epub+zip');
      
      openViewer({
        blob,
        filename: 'test.epub',
        format: 'epub'
      });

      expect(isViewerOpen()).toBe(true);
    });

    it('should accept HTML format', () => {
      const blob = createBlob('<html><body>Test</body></html>', 'text/html');
      
      openViewer({
        blob,
        filename: 'test.html',
        format: 'html'
      });

      expect(isViewerOpen()).toBe(true);
    });

    it('should accept Markdown format', () => {
      const blob = createBlob('# Test', 'text/markdown');
      
      openViewer({
        blob,
        filename: 'test.md',
        format: 'markdown'
      });

      expect(isViewerOpen()).toBe(true);
    });

    it('should accept AsciiDoc format', () => {
      const blob = createBlob('= Test', 'text/asciidoc');
      
      openViewer({
        blob,
        filename: 'test.adoc',
        format: 'asciidoc'
      });

      expect(isViewerOpen()).toBe(true);
    });
  });

  describe('closeViewer', () => {
    it('should remove viewer container from DOM', () => {
      const blob = createBlob('Test content', 'text/plain');
      
      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });

      expect(isViewerOpen()).toBe(true);
      expect(document.getElementById('ebook-viewer-container')).toBeTruthy();

      closeViewer();

      expect(isViewerOpen()).toBe(false);
      expect(document.getElementById('ebook-viewer-container')).toBeFalsy();
    });

    it('should handle closing when no viewer is open', () => {
      expect(isViewerOpen()).toBe(false);
      
      // Should not throw
      closeViewer();
      
      expect(isViewerOpen()).toBe(false);
    });
  });

  describe('isViewerOpen', () => {
    it('should return false when no viewer is open', () => {
      expect(isViewerOpen()).toBe(false);
    });

    it('should return true when viewer is open', () => {
      const blob = createBlob('Test content', 'text/plain');
      
      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });

      expect(isViewerOpen()).toBe(true);
    });

    it('should return false after closing viewer', () => {
      const blob = createBlob('Test content', 'text/plain');
      
      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });

      expect(isViewerOpen()).toBe(true);

      closeViewer();

      expect(isViewerOpen()).toBe(false);
    });
  });

  describe('Viewer format support', () => {
    const formats: Array<'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc'> = [
      'pdf',
      'epub',
      'html',
      'markdown',
      'asciidoc'
    ];

    formats.forEach(format => {
      it(`should support ${format} format`, () => {
        const blob = createBlob('Test content', 'text/plain');
        
        openViewer({
          blob,
          filename: `test.${format === 'pdf' ? 'pdf' : format === 'epub' ? 'epub' : format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'adoc'}`,
          format
        });

        expect(isViewerOpen()).toBe(true);
        
        closeViewer();
      });
    });
  });

  describe('Multiple viewer operations', () => {
    it('should handle opening and closing multiple times', () => {
      const blob = createBlob('Test content', 'text/plain');

      // Open and close multiple times
      for (let i = 0; i < 3; i++) {
        openViewer({
          blob,
          filename: 'test.txt',
          format: 'html'
        });

        expect(isViewerOpen()).toBe(true);

        closeViewer();

        expect(isViewerOpen()).toBe(false);
      }
    });

    it('should handle rapid open/close operations', () => {
      const blob = createBlob('Test content', 'text/plain');

      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });

      closeViewer();
      openViewer({
        blob,
        filename: 'test.txt',
        format: 'html'
      });
      closeViewer();

      expect(isViewerOpen()).toBe(false);
      expect(document.getElementById('ebook-viewer-container')).toBeFalsy();
    });
  });
});
