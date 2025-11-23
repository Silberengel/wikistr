<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import { Book } from 'epubjs';
  import hljs from 'highlight.js';

  interface Props {
    blob: Blob;
    filename: string;
    format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc';
    onClose: () => void;
  }

  let { blob, filename, format, onClose }: Props = $props();

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

    // Set up PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    // Load content
    (async () => {
      if (format === 'pdf') {
        await loadPDF();
      } else if (format === 'epub') {
        await loadEPUB();
      } else if (format === 'html') {
        await loadHTML();
      } else if (format === 'markdown' || format === 'asciidoc') {
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
        onClose();
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
      const text = await blob.text();
      // Escape HTML to prevent XSS
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // Use highlight.js to syntax highlight
      const language = format === 'markdown' ? 'markdown' : 'asciidoc';
      let highlighted;
      try {
        highlighted = hljs.highlight(escaped, { language });
      } catch {
        // Fallback if language not supported
        highlighted = hljs.highlightAuto(escaped);
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

  function downloadFile() {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Watch for fullscreen changes
  $effect(() => {
    const handleFullscreenChange = () => {
      isFullscreen = !!document.fullscreenElement;
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
        onclick={toggleFullscreen}
        style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;"
        title="Toggle fullscreen"
      >
        ⛶ Fullscreen
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

  <!-- Content Area with responsive layout -->
  <div
    class="viewer-content"
    class:horizontal={isHorizontal && format === 'pdf'}
    class:vertical={!isHorizontal && format === 'pdf'}
    style="flex: 1; display: flex; align-items: center; padding: 2rem; background: var(--page-bg); scroll-behavior: smooth;"
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
    {:else if format === 'markdown' || format === 'asciidoc'}
      <div
        bind:this={codeContainer}
        class="code-viewer"
        style="max-width: 100%; width: 100%; height: 100%; overflow: auto; padding: 1rem;"
      >
        {@html htmlContent}
      </div>
    {:else}
      <div
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
  }

  .code-viewer :global(pre) {
    margin: 0;
    padding: 1rem;
    background: var(--code-bg, #1e1e1e);
    color: var(--code-text, #d4d4d4);
    border-radius: 0.25rem;
    overflow-x: auto;
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
</style>
