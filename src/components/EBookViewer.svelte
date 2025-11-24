<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import { Book } from 'epubjs';
  import hljs from 'highlight.js';

  interface Props {
    blob: Blob;
    filename: string;
    format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc' | 'json' | 'jsonl';
    onClose: () => void;
    validationMessages?: { errors?: string[]; warnings?: string[] };
    originalLaTeXBlob?: Blob; // For LaTeX: store original .tex file for download
  }

  let { blob, filename, format, onClose, validationMessages, originalLaTeXBlob }: Props = $props();

  // PDF state
  let currentPage = $state(1);
  let totalPages = $state(0);
  let pdfDoc: any = $state(null);
  let isRendering = $state(false);
  let viewerContainer = $state<HTMLElement | null>(null);
  let contentContainer = $state<HTMLElement | null>(null);
  let scale = $state(1.0);
  let twoPageSpread = $state(false);
  let isFullscreen = $state(false);
  let isMobile = $state(false);
  let isHorizontal = $state(true); // Default to horizontal on desktop

  // EPUB state
  let epubBook: any = $state(null);
  let epubRendition: any = $state(null);
  let epubContainer = $state<HTMLElement | null>(null);
  let epubLocation: any = $state(null);

  // HTML/Text state
  let htmlContent = $state<string>('');
  let codeContainer = $state<HTMLElement | null>(null);
  let isMaximized = $state(false);
  
  // Search state
  let showSearch = $state(false);
  let searchQuery = $state('');
  let searchResults: any[] = $state([]);
  let currentSearchIndex = $state(-1);
  let searchContainer = $state<HTMLElement | null>(null);

  onMount(() => {
    // Detect mobile vs desktop
    const checkMobile = () => {
      isMobile = window.innerWidth < 768; // Tailwind's md breakpoint
      // Desktop defaults to horizontal, mobile to vertical
      if (format === 'pdf') {
        isHorizontal = !isMobile;
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Set up PDF.js worker - use a more reliable CDN or local fallback
    // Try to use jsdelivr which is more reliable than cdnjs
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

    // Load content
    (async () => {
      if (format === 'pdf') {
        await loadPDF();
      } else if (format === 'epub') {
        await loadEPUB();
      } else if (format === 'html') {
        await loadHTML();
      } else if (format === 'markdown' || format === 'asciidoc' || format === 'json' || format === 'jsonl') {
        await loadTextFile();
      }
    })();

    // Keyboard navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (format === 'pdf') {
          if (e.key === 'ArrowLeft') {
            previousPage();
          } else {
            nextPage();
          }
        } else if (format === 'epub' && epubRendition) {
          if (e.key === 'ArrowLeft') {
            epubRendition.prev();
          } else {
            epubRendition.next();
          }
        }
      } else if (e.key === 'Escape') {
        if (showSearch) {
          showSearch = false;
          searchQuery = '';
          clearSearchHighlights();
        } else {
          onClose();
        }
      } else if ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        showSearch = !showSearch;
        if (showSearch) {
          setTimeout(() => {
            const searchInput = document.querySelector('.search-input') as HTMLInputElement;
            searchInput?.focus();
          }, 0);
        } else {
          clearSearchHighlights();
        }
      } else if (e.key === 'Enter' && showSearch && searchQuery) {
        e.preventDefault();
        findNext();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        toggleTwoPageSpread();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (epubRendition) {
        epubRendition.destroy();
      }
    };
  });

  async function loadPDF() {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      totalPages = pdfDoc.numPages;
      await renderPages();
    } catch (error) {
      console.error('Failed to load PDF:', error);
      htmlContent = `<div style="padding: 2rem; text-align: center; color: var(--text-primary);">
        <h2>Failed to load PDF</h2>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>`;
    }
  }

  async function renderPages() {
    if (!pdfDoc || isRendering || !contentContainer) return;
    
    isRendering = true;
    try {
      contentContainer.innerHTML = '';
      
      if (isHorizontal) {
        // Horizontal layout
        contentContainer.style.display = 'flex';
        contentContainer.style.flexDirection = 'row';
        contentContainer.style.gap = '1rem';
        contentContainer.style.justifyContent = 'center';
        contentContainer.style.alignItems = 'center';
        contentContainer.style.minWidth = '100%';
        contentContainer.style.scrollSnapAlign = 'center';
      } else {
        // Vertical layout
        contentContainer.style.display = 'flex';
        contentContainer.style.flexDirection = 'column';
        contentContainer.style.gap = '1rem';
        contentContainer.style.justifyContent = 'flex-start';
        contentContainer.style.alignItems = 'center';
        contentContainer.style.minHeight = '100%';
        contentContainer.style.scrollSnapAlign = 'start';
      }
      
      if (twoPageSpread && currentPage < totalPages && isHorizontal) {
        // Render two pages side-by-side (only in horizontal mode)
        await renderPagePair(currentPage, currentPage + 1);
      } else {
        // Render single page
        await renderSinglePage(currentPage);
      }
    } catch (error) {
      console.error('Failed to render pages:', error);
    } finally {
      isRendering = false;
    }
  }

  async function renderSinglePage(pageNum: number) {
    if (!pdfDoc || !contentContainer) return;
    
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    canvas.style.borderRadius = '0.25rem';
    canvas.style.scrollSnapAlign = 'center';

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    contentContainer.appendChild(canvas);
  }

  async function renderPagePair(pageNum1: number, pageNum2: number) {
    if (!pdfDoc || !contentContainer) return;
    
    const pageContainer = document.createElement('div');
    pageContainer.style.display = 'flex';
    pageContainer.style.gap = '1rem';
    pageContainer.style.justifyContent = 'center';
    pageContainer.style.alignItems = 'center';
    pageContainer.style.scrollSnapAlign = 'center';
    
    // Render first page
    const page1 = await pdfDoc.getPage(pageNum1);
    const viewport1 = page1.getViewport({ scale });
    const canvas1 = document.createElement('canvas');
    const context1 = canvas1.getContext('2d');
    if (context1) {
      canvas1.height = viewport1.height;
      canvas1.width = viewport1.width;
      canvas1.style.maxWidth = '50%';
      canvas1.style.height = 'auto';
      canvas1.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
      canvas1.style.borderRadius = '0.25rem';
      await page1.render({
        canvasContext: context1,
        viewport: viewport1
      }).promise;
      pageContainer.appendChild(canvas1);
    }
    
    // Render second page if it exists
    if (pageNum2 <= totalPages) {
      const page2 = await pdfDoc.getPage(pageNum2);
      const viewport2 = page2.getViewport({ scale });
      const canvas2 = document.createElement('canvas');
      const context2 = canvas2.getContext('2d');
      if (context2) {
        canvas2.height = viewport2.height;
        canvas2.width = viewport2.width;
        canvas2.style.maxWidth = '50%';
        canvas2.style.height = 'auto';
        canvas2.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        canvas2.style.borderRadius = '0.25rem';
        await page2.render({
          canvasContext: context2,
          viewport: viewport2
        }).promise;
        pageContainer.appendChild(canvas2);
      }
    }
    
    contentContainer.appendChild(pageContainer);
  }

  async function loadEPUB() {
    try {
      // Create a blob URL for epubjs
      const blobUrl = URL.createObjectURL(blob);
      epubBook = new Book(blobUrl);
      
      await epubBook.ready;
      
      // Wait for container to be available, then initialize
      const checkContainer = setInterval(() => {
        if (epubContainer) {
          clearInterval(checkContainer);
          initializeEPUBRendition();
        }
      }, 50);
      
      // Timeout after 2 seconds
      setTimeout(() => clearInterval(checkContainer), 2000);
    } catch (error) {
      console.error('Failed to load EPUB:', error);
      htmlContent = `<div style="padding: 2rem; text-align: center; color: var(--text-primary);">
        <h2>Failed to load EPUB</h2>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>`;
    }
  }

  function initializeEPUBRendition() {
    if (!epubBook || !epubContainer) return;
    
    try {
      epubRendition = epubBook.renderTo(epubContainer, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });
      
      epubRendition.display();
      
      epubRendition.on('relocated', (location: any) => {
        epubLocation = location;
      });
    } catch (error) {
      console.error('Failed to initialize EPUB rendition:', error);
    }
  }

  // Watch for epubContainer changes
  $effect(() => {
    if (epubContainer && epubBook && !epubRendition) {
      initializeEPUBRendition();
    }
  });

  async function loadHTML() {
    try {
      const text = await blob.text();
      htmlContent = text;
    } catch (error) {
      console.error('Failed to load HTML:', error);
      htmlContent = `<div style="padding: 2rem; text-align: center; color: var(--text-primary);">
        <h2>Failed to load content</h2>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>`;
    }
  }

  async function loadTextFile() {
    try {
      let text = await blob.text();
      
      // For JSONL files, format each line as a separate JSON object for better readability
      if (format === 'jsonl') {
        const lines = text.split('\n').filter(line => line.trim());
        const formattedLines: string[] = [];
        for (const line of lines) {
          try {
            // Try to parse and pretty-print each JSON line
            const parsed = JSON.parse(line.trim());
            formattedLines.push(JSON.stringify(parsed, null, 2));
          } catch {
            // If parsing fails, keep the original line
            formattedLines.push(line);
          }
        }
        text = formattedLines.join('\n\n');
      } else if (format === 'json') {
        // Try to pretty-print JSON for better readability
        try {
          const parsed = JSON.parse(text);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          // If parsing fails, keep original text
        }
      }
      
      // Escape HTML to prevent XSS
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // Use highlight.js to syntax highlight with correct language
      let language: string;
      if (format === 'markdown') {
        language = 'markdown';
      } else if (format === 'asciidoc') {
        // AsciiDoc is not directly supported by highlight.js
        // Fallback to markdown since they share many tags
        try {
          const asciidocLang = hljs.getLanguage('asciidoc');
          if (asciidocLang) {
            language = 'asciidoc';
          } else {
            // Try adoc as alternative name
            const adocLang = hljs.getLanguage('adoc');
            if (adocLang) {
              language = 'adoc';
            } else {
              // Fallback to markdown (they share many tags like #, ==, etc.)
              language = 'markdown';
            }
          }
        } catch {
          // Fallback to markdown
          language = 'markdown';
        }
      } else if (format === 'json' || format === 'jsonl') {
        language = 'json';
      } else {
        language = 'plaintext';
      }
      
      let highlighted;
      try {
        // Check if language is supported
        const lang = hljs.getLanguage(language);
        if (lang) {
          highlighted = hljs.highlight(escaped, { language });
        } else {
          // Fallback to auto-detect
          highlighted = hljs.highlightAuto(escaped);
        }
      } catch {
        // Fallback if language not supported - try plaintext
        try {
          highlighted = hljs.highlight(escaped, { language: 'plaintext' });
        } catch {
          // Last resort: just escape and use plain text
          highlighted = { value: escaped };
        }
      }
      
      // Create a pre element with highlighted content
      htmlContent = `<pre class="hljs"><code>${highlighted.value}</code></pre>`;
      
      // Re-highlight after DOM update
      setTimeout(() => {
        if (codeContainer) {
          hljs.highlightAll();
        }
      }, 0);
    } catch (error) {
      console.error('Failed to load text file:', error);
      htmlContent = `<div style="padding: 2rem; text-align: center; color: var(--text-primary);">
        <h2>Failed to load content</h2>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>`;
    }
  }

  function nextPage() {
    if (format === 'pdf') {
      if (twoPageSpread) {
        currentPage = Math.min(currentPage + 2, totalPages);
      } else {
        currentPage = Math.min(currentPage + 1, totalPages);
      }
      renderPages();
    }
  }

  function previousPage() {
    if (format === 'pdf') {
      if (twoPageSpread) {
        currentPage = Math.max(currentPage - 2, 1);
      } else {
        currentPage = Math.max(currentPage - 1, 1);
      }
      renderPages();
    }
  }

  function toggleLayout() {
    if (format === 'pdf') {
      isHorizontal = !isHorizontal;
      renderPages();
    }
  }

  function zoomIn() {
    if (format === 'pdf') {
      scale = Math.min(scale + 0.25, 3.0);
      renderPages();
    } else if (format === 'epub' && epubRendition) {
      epubRendition.zoom(epubRendition.settings.zoom + 0.25);
    }
  }

  function zoomOut() {
    if (format === 'pdf') {
      scale = Math.max(scale - 0.25, 0.5);
      renderPages();
    } else if (format === 'epub' && epubRendition) {
      epubRendition.zoom(epubRendition.settings.zoom - 0.25);
    }
  }

  function toggleTwoPageSpread() {
    if (format === 'pdf') {
      twoPageSpread = !twoPageSpread;
      // Adjust current page if needed for two-page spread
      if (twoPageSpread && currentPage % 2 === 0) {
        currentPage = Math.max(currentPage - 1, 1);
      }
      renderPages();
    }
  }

  function toggleFullscreen() {
    if (!viewerContainer) return;
    if (!isFullscreen) {
      viewerContainer.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  function toggleMaximize() {
    if (!viewerContainer) return;
    isMaximized = !isMaximized;
    // The container is already fullscreen, so we just toggle a class for styling
    // The actual maximize is handled by CSS
    // For PDF/EPUB, we can also use fullscreen API as fallback
    if (format === 'pdf' || format === 'epub') {
      if (isMaximized) {
        viewerContainer.requestFullscreen?.();
      } else {
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        }
      }
    }
  }

  function toggleSearch() {
    showSearch = !showSearch;
    if (!showSearch) {
      searchQuery = '';
      clearSearchHighlights();
    } else {
      setTimeout(() => {
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        searchInput?.focus();
      }, 0);
    }
  }

  function clearSearchHighlights() {
    if (format === 'pdf') {
      // Clear PDF search highlights - PDF.js doesn't have built-in highlighting
      // We just clear the results
      searchResults = [];
      currentSearchIndex = -1;
    } else if (format === 'epub') {
      // EPUB search is handled by epubjs
      if (epubRendition) {
        epubRendition.annotations.clear();
      }
      searchResults = [];
      currentSearchIndex = -1;
    } else {
      // Clear text/HTML highlights by replacing highlight spans with text nodes
      const containers = [codeContainer, searchContainer].filter(Boolean) as HTMLElement[];
      for (const container of containers) {
        if (!container) continue;
        
        container.querySelectorAll('.search-highlight').forEach(el => {
          const span = el as HTMLElement;
          const parent = span.parentNode;
          if (parent) {
            // Replace highlight span with text node
            const textNode = document.createTextNode(span.textContent || '');
            parent.replaceChild(textNode, span);
            // Normalize to merge adjacent text nodes
            parent.normalize();
          }
        });
      }
      searchResults = [];
      currentSearchIndex = -1;
    }
  }

  async function performSearch() {
    if (!searchQuery.trim()) {
      clearSearchHighlights();
      return;
    }

    const query = searchQuery.trim();
    
    if (format === 'pdf') {
      await searchPDF(query);
    } else if (format === 'epub') {
      await searchEPUB(query);
    } else {
      searchText(query);
    }
  }

  async function searchPDF(query: string) {
    if (!pdfDoc || !contentContainer) return;
    
    try {
      searchResults = [];
      currentSearchIndex = -1;
      
      // Search through all pages
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const textItems = textContent.items as any[];
        const fullText = textItems.map((item: any) => item.str).join(' ');
        
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        let match;
        while ((match = regex.exec(fullText)) !== null) {
          searchResults.push({
            page: pageNum,
            index: match.index,
            text: match[0]
          });
        }
      }
      
      if (searchResults.length > 0) {
        currentSearchIndex = 0;
        await highlightPDFSearch();
      }
    } catch (error) {
      console.error('PDF search error:', error);
    }
  }

  async function highlightPDFSearch() {
    if (!pdfDoc || !contentContainer || searchResults.length === 0) return;
    
    const result = searchResults[currentSearchIndex];
    if (result.page !== currentPage) {
      currentPage = result.page;
      await renderPages();
    }
    
    // Scroll to the result (PDF.js doesn't have built-in highlighting, so we'll just navigate)
    setTimeout(() => {
      contentContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  async function searchEPUB(query: string) {
    if (!epubRendition) return;
    
    try {
      const results = await epubRendition.search(query);
      searchResults = results || [];
      currentSearchIndex = 0;
      
      if (searchResults.length > 0) {
        epubRendition.display(searchResults[currentSearchIndex].cfi);
      }
    } catch (error) {
      console.error('EPUB search error:', error);
    }
  }

  function searchText(query: string) {
    const container = codeContainer || searchContainer;
    if (!container) return;
    
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = -1;
    
    // Get all text content
    const text = container.innerText || container.textContent || '';
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = [...text.matchAll(regex)];
    
    if (matches.length === 0) return;
    
    // Store matches with their positions
    searchResults = matches.map(match => ({
      index: match.index || 0,
      text: match[0]
    }));
    
    currentSearchIndex = 0;
    highlightTextSearch();
  }

  function highlightTextSearch() {
    const container = codeContainer || searchContainer;
    if (!container || searchResults.length === 0 || !searchQuery) return;
    
    const result = searchResults[currentSearchIndex];
    
    // Get all text nodes and find the one containing our match
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    const textNodes: Array<{ node: Text; start: number; end: number }> = [];
    let charIndex = 0;
    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.textContent || '';
      const nodeStart = charIndex;
      const nodeEnd = charIndex + nodeText.length;
      textNodes.push({ node: node as Text, start: nodeStart, end: nodeEnd });
      charIndex = nodeEnd;
    }
    
    // Find the text node containing the match
    for (const { node: textNode, start, end } of textNodes) {
      if (result.index >= start && result.index < end) {
        const offset = result.index - start;
        const nodeText = textNode.textContent || '';
        const beforeText = nodeText.substring(0, offset);
        const matchText = nodeText.substring(offset, offset + result.text.length);
        const afterText = nodeText.substring(offset + result.text.length);
        
        // Create highlight span
        const highlight = document.createElement('span');
        highlight.className = 'search-highlight';
        highlight.style.cssText = 'background-color: rgba(255, 255, 0, 0.5); color: inherit; padding: 2px 0; border-radius: 2px;';
        highlight.textContent = matchText;
        
        // Replace the text node with highlighted version
        const parent = textNode.parentNode;
        if (parent) {
          if (beforeText) {
            parent.insertBefore(document.createTextNode(beforeText), textNode);
          }
          parent.insertBefore(highlight, textNode);
          if (afterText) {
            parent.insertBefore(document.createTextNode(afterText), textNode);
          }
          parent.removeChild(textNode);
        }
        
        // Scroll to highlight
        setTimeout(() => {
          highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        break;
      }
    }
  }

  function findNext() {
    if (searchResults.length === 0) {
      performSearch();
      return;
    }
    
    currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
    
    if (format === 'pdf') {
      highlightPDFSearch();
    } else if (format === 'epub') {
      if (epubRendition && searchResults[currentSearchIndex]) {
        epubRendition.display(searchResults[currentSearchIndex].cfi);
      }
    } else {
      clearSearchHighlights();
      highlightTextSearch();
    }
  }

  function findPrevious() {
    if (searchResults.length === 0) return;
    
    currentSearchIndex = currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
    
    if (format === 'pdf') {
      highlightPDFSearch();
    } else if (format === 'epub') {
      if (epubRendition && searchResults[currentSearchIndex]) {
        epubRendition.display(searchResults[currentSearchIndex].cfi);
      }
    } else {
      clearSearchHighlights();
      highlightTextSearch();
    }
  }

  // Watch for search query changes
  $effect(() => {
    if (searchQuery && showSearch) {
      const timeoutId = setTimeout(() => {
        performSearch();
      }, 300); // Debounce search
      return () => clearTimeout(timeoutId);
    }
  });

  async function downloadFile() {
    // For LaTeX (shown as PDF), ask user if they want PDF or .tex
    if (format === 'pdf' && originalLaTeXBlob) {
      const choice = confirm('Download as PDF or LaTeX (.tex) file?\n\nOK = PDF\nCancel = LaTeX (.tex)');
      if (choice) {
        // Download PDF
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Download .tex
        const texFilename = filename.replace(/\.pdf$/i, '.tex');
        const url = URL.createObjectURL(originalLaTeXBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = texFilename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else {
      // Normal download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // Watch for fullscreen changes and sync with maximize state
  $effect(() => {
    const handleFullscreenChange = () => {
      isFullscreen = !!document.fullscreenElement;
      // Sync maximize state with fullscreen for PDF/EPUB
      if (format === 'pdf' || format === 'epub') {
        isMaximized = isFullscreen;
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  });
</script>

<div
  bind:this={viewerContainer}
  class="ebook-viewer"
  class:maximized={isMaximized}
  style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: var(--bg-primary); display: flex; flex-direction: column;"
>
  <!-- Toolbar -->
  <div
    class="viewer-toolbar"
    style="background: var(--bg-secondary); border-bottom: 1px solid var(--border); padding: 0.75rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-shrink: 0;"
  >
    <div style="display: flex; align-items: center; gap: 1rem;">
      <button
        type="button"
        onclick={onClose}
        style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
      >
        ✕ Close
      </button>
      {#if format === 'pdf'}
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button
            type="button"
            onclick={previousPage}
            disabled={currentPage <= 1}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer; disabled:opacity-0.5;"
            title="Previous page (←)"
          >
            ←
          </button>
          <span style="color: var(--text-primary); min-width: 6rem; text-align: center;">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onclick={nextPage}
            disabled={currentPage >= totalPages}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer; disabled:opacity-0.5;"
            title="Next page (→)"
          >
            →
          </button>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button
            type="button"
            onclick={zoomOut}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
            title="Zoom out (-)"
          >
            −
          </button>
          <span style="color: var(--text-primary); min-width: 3rem; text-align: center;">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onclick={zoomIn}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
            title="Zoom in (+)"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onclick={toggleTwoPageSpread}
          style="background: {twoPageSpread ? 'var(--accent)' : 'var(--bg-tertiary)'}; border: 1px solid var(--border); color: {twoPageSpread ? 'white' : 'var(--text-primary)'}; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
          title="Toggle two-page spread (S)"
        >
          {twoPageSpread ? '📖' : '📄'} Spread
        </button>
        <button
          type="button"
          onclick={toggleLayout}
          style="background: {isHorizontal ? 'var(--accent)' : 'var(--bg-tertiary)'}; border: 1px solid var(--border); color: {isHorizontal ? 'white' : 'var(--text-primary)'}; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
          title="Toggle layout (horizontal/vertical)"
        >
          {isHorizontal ? '↔' : '↕'} Layout
        </button>
      {:else if format === 'epub'}
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button
            type="button"
            onclick={() => epubRendition?.prev()}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
            title="Previous page (←)"
          >
            ←
          </button>
          <button
            type="button"
            onclick={() => epubRendition?.next()}
            style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
            title="Next page (→)"
          >
            →
          </button>
        </div>
      {/if}
    </div>
    <div style="display: flex; align-items: center; gap: 1rem;">
      <span style="color: var(--text-secondary); font-size: 0.9em;">{filename}</span>
      <button
        type="button"
        onclick={toggleSearch}
        style="background: {showSearch ? 'var(--accent)' : 'var(--bg-tertiary)'}; border: 1px solid var(--border); color: {showSearch ? 'white' : 'var(--text-primary)'}; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
        title="Find in document (Ctrl+F / Cmd+F)"
      >
        🔍 Find
      </button>
      <button
        type="button"
        onclick={toggleMaximize}
        style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
        title={isMaximized ? "Minimize" : "Maximize"}
      >
        {isMaximized ? '⊟ Minimize' : '⊞ Maximize'}
      </button>
      <button
        type="button"
        onclick={downloadFile}
        style="background: var(--accent); border: none; color: white; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
        title="Download file"
      >
        ⬇ Download
      </button>
    </div>
  </div>

  <!-- Search Bar -->
  {#if showSearch}
    <div
      class="search-bar"
      style="background: var(--bg-secondary); border-bottom: 1px solid var(--border); padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;"
    >
      <input
        type="text"
        class="search-input"
        bind:value={searchQuery}
        placeholder="Search..."
        style="flex: 1; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.25rem; background: var(--bg-primary); color: var(--text-primary);"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            findNext();
          } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            findPrevious();
          }
        }}
      />
      {#if searchResults.length > 0}
        <span style="color: var(--text-secondary); font-size: 0.9em; min-width: 5rem; text-align: center;">
          {currentSearchIndex + 1} / {searchResults.length}
        </span>
        <button
          type="button"
          onclick={findPrevious}
          style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
          title="Previous (Shift+Enter)"
        >
          ↑
        </button>
        <button
          type="button"
          onclick={findNext}
          style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem; border-radius: 0.25rem; cursor: pointer;"
          title="Next (Enter)"
        >
          ↓
        </button>
      {:else if searchQuery}
        <span style="color: var(--text-secondary); font-size: 0.9em;">No results</span>
      {/if}
      <button
        type="button"
        onclick={toggleSearch}
        style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
        title="Close search (Esc)"
      >
        ✕
      </button>
    </div>
  {/if}

  <!-- Validation Messages -->
  {#if validationMessages && (validationMessages.errors?.length || validationMessages.warnings?.length)}
    <div
      class="validation-messages"
      style="background: var(--bg-secondary); border-bottom: 1px solid var(--border); padding: 1rem; max-height: 200px; overflow-y: auto; flex-shrink: 0;"
    >
      {#if validationMessages.errors && validationMessages.errors.length > 0}
        <div style="margin-bottom: 0.5rem;">
          <strong style="color: #ef4444;">Errors:</strong>
          <ul style="margin: 0.5rem 0 0 1.5rem; padding: 0; color: var(--text-primary);">
            {#each validationMessages.errors as error}
              <li style="margin-bottom: 0.25rem;">{error}</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if validationMessages.warnings && validationMessages.warnings.length > 0}
        <div>
          <strong style="color: #f59e0b;">Warnings:</strong>
          <ul style="margin: 0.5rem 0 0 1.5rem; padding: 0; color: var(--text-primary);">
            {#each validationMessages.warnings as warning}
              <li style="margin-bottom: 0.25rem;">{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Content Area with responsive layout -->
  <div
    class="viewer-content"
    class:horizontal={isHorizontal && format === 'pdf'}
    class:vertical={!isHorizontal && format === 'pdf'}
    style="flex: 1; display: flex; align-items: center; padding: 2rem; background: var(--page-bg); scroll-behavior: smooth; overflow: auto; min-height: 0;"
  >
    {#if format === 'pdf'}
      <div
        bind:this={contentContainer}
        style="display: flex; justify-content: center; align-items: center; min-height: 100%; min-width: 100%;"
      >
        {#if isRendering}
          <div style="color: var(--text-secondary);">Loading page{twoPageSpread ? 's' : ''} {currentPage}{twoPageSpread && currentPage < totalPages ? `-${currentPage + 1}` : ''}...</div>
        {/if}
      </div>
    {:else if format === 'epub'}
      <div
        bind:this={epubContainer}
        style="width: 100%; height: 100%; overflow: auto;"
      >
        <!-- EPUB will be rendered here by epubjs -->
      </div>
    {:else if format === 'markdown' || format === 'asciidoc' || format === 'json' || format === 'jsonl'}
      <div
        bind:this={codeContainer}
        class="code-viewer"
        style="max-width: 100%; width: 100%; height: 100%; overflow: auto; padding: 1rem; box-sizing: border-box;"
      >
        {@html htmlContent}
      </div>
    {:else}
      <div
        bind:this={searchContainer}
        style="max-width: 100%; width: 100%; height: 100%; overflow: auto;"
      >
        {@html htmlContent}
      </div>
    {/if}
  </div>
</div>

<style>
  .ebook-viewer {
    font-family: inherit;
  }

  .viewer-content {
    /* Smooth scrolling */
    scroll-behavior: smooth;
    /* Ensure proper scrolling on all screen sizes */
    overflow: auto;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .viewer-content {
      padding: 1rem;
    }
    
    .code-viewer {
      font-size: 0.85rem;
      padding: 0.75rem;
    }
    
    .code-viewer :global(pre) {
      padding: 0.75rem;
    }
  }

  @media (min-width: 769px) {
    .viewer-content {
      padding: 2rem;
    }
  }

  /* Horizontal layout for PDFs (desktop default) */
  :global(.viewer-content.horizontal) {
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
  }

  /* Vertical layout for PDFs (mobile default) */
  :global(.viewer-content.vertical) {
    overflow-x: hidden;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
  }

  /* Code viewer styling */
  .code-viewer {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
    font-size: 0.9rem;
    line-height: 1.6;
    overflow-x: auto;
    overflow-y: auto;
  }

  .code-viewer :global(pre) {
    margin: 0;
    padding: 1rem;
    background: var(--code-bg, #1e1e1e);
    color: var(--code-text, #d4d4d4);
    border-radius: 0.25rem;
    overflow-x: auto;
    overflow-y: visible;
    min-width: fit-content;
  }

  .code-viewer :global(pre code) {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-family: inherit;
    font-size: inherit;
  }

  .code-viewer :global(.hljs) {
    background: var(--code-bg, #1e1e1e);
    color: var(--code-text, #d4d4d4);
  }

  /* EPUB styling */
  :global(.epub-container) {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  :global(.epub-container section) {
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 2rem;
  }

  /* Style HTML content */
  .viewer-content :global(h1),
  .viewer-content :global(h2),
  .viewer-content :global(h3) {
    color: var(--text-primary);
  }

  .viewer-content :global(p) {
    color: var(--text-primary);
    line-height: 1.6;
  }

  .viewer-content :global(code) {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.125rem 0.25rem;
    border-radius: 0.125rem;
  }

  /* Smooth page transitions */
  .viewer-content :global(canvas) {
    transition: opacity 0.3s ease-in-out;
  }

  /* Maximized state for plaintext viewer */
  .ebook-viewer.maximized {
    z-index: 10000;
  }

  /* JSON/JSONL specific styling */
  .code-viewer :global(pre code.json),
  .code-viewer :global(pre code.jsonl) {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* Ensure viewer fits screen properly */
  .ebook-viewer {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    overflow: hidden;
  }

  /* Responsive adjustments for mobile */
  @media (max-width: 768px) {
    .viewer-toolbar {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    
    .viewer-toolbar > div {
      flex-wrap: wrap;
    }
  }
</style>
