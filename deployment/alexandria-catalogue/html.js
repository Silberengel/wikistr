/**
 * HTML generation functions
 */

import { escapeHtml } from './utils.js';
import { getCommonStyles, getEPUBViewerStyles } from './styles.js';

/**
 * Get responsive CSS for all HTML formats
 */
export function getResponsiveMediaCSS() {
  return `
    /* Prevent horizontal overflow */
    html, body {
      overflow-x: hidden !important;
      max-width: 100vw !important;
    }
    /* Constrain all media elements to be narrower than display space */
    img, video, iframe, embed, object, canvas, svg {
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important; /* Account for padding */
      height: auto !important;
      display: block;
    }
    /* Ensure images are responsive: never exceed 1000px OR viewport width, whichever is smaller */
    img {
      width: auto !important;
      height: auto !important;
      max-width: 100% !important; /* Responsive: scale with container */
      max-width: min(1000px, calc(100vw - 2em)) !important; /* Never exceed 1000px or viewport width minus padding */
      max-height: 1000px !important;
      object-fit: contain !important; /* Maintain aspect ratio */
    }
    /* Maintain aspect ratio for videos and iframes */
    video {
      aspect-ratio: 16 / 9;
      width: 100% !important;
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
    }
    iframe, embed, object {
      width: 100% !important;
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
    }
    iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="youtu.be"] {
      aspect-ratio: 16 / 9;
    }
    /* Constrain tables to prevent overflow - AsciiDoctor wraps tables in .tableblock */
    .tableblock {
      overflow-x: auto !important;
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      -webkit-overflow-scrolling: touch !important;
      margin: 1em 0 !important;
      display: block !important; /* Container is block, but table inside should be table */
    }
    /* Ensure table inside tableblock displays as table */
    .tableblock > table {
      display: table !important;
      width: 100% !important;
    }
    /* Tables should be full width like other content */
    table {
      width: 100% !important;
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      table-layout: auto !important;
      border-collapse: collapse !important;
      margin: 1em 0 !important;
      display: table !important; /* Ensure table displays as table */
    }
    /* Tables inside tableblock should also be full width */
    .tableblock > table, 
    .table-container > table,
    div[class*="table"] > table {
      width: 100% !important;
    }
    /* Ensure table cells wrap text properly and distribute width evenly */
    table td, table th {
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      hyphens: auto !important;
      padding: 0.5em !important;
      white-space: normal !important;
    }
    /* Regular table cells should distribute width properly */
    table:not(.admonitionblock) td, table:not(.admonitionblock) th {
      width: auto !important;
      min-width: 0 !important; /* Allow flexible sizing */
      max-width: none !important;
      display: table-cell !important; /* Ensure cells display as table cells */
      vertical-align: top !important;
    }
    /* Ensure table rows display properly */
    table tr {
      display: table-row !important;
    }
    /* Admonition table cells should have normal width */
    .admonitionblock table td, .admonitionblock table th,
    .admonition table td, .admonition table th {
      max-width: none !important;
      white-space: normal !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
    }
    /* Make any table container scrollable */
    .table-container, div[class*="table"], div[class*="Table"] {
      overflow-x: auto !important;
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      -webkit-overflow-scrolling: touch !important;
    }
    /* Constrain all verbatim/code blocks - AsciiDoctor generates several types */
    .listingblock, .literalblock, .sourceblock {
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      overflow-x: auto !important;
      -webkit-overflow-scrolling: touch !important;
      margin: 1em 0 !important;
      display: block !important;
    }
    /* Pre elements - preserve formatting, allow horizontal scroll */
    .listingblock pre, .literalblock pre, .sourceblock pre,
    pre {
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      overflow-x: auto !important;
      -webkit-overflow-scrolling: touch !important;
      white-space: pre !important;
      display: block !important;
      margin: 1em 0 !important;
      min-width: 0 !important; /* Allow shrinking */
      box-sizing: border-box !important;
      padding-bottom: 1em !important; /* Space for scrollbar */
    }
    /* Code elements inside pre - preserve formatting, inherit width from parent */
    pre code {
      white-space: pre !important;
      overflow-x: auto !important;
      display: block !important;
      box-sizing: border-box !important;
      min-width: 0 !important;
    }
    /* Inline code elements - allow normal wrapping */
    code:not(pre code) {
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
    }
    /* Code inside verbatim blocks - preserve formatting, allow scroll */
    .listingblock code, .literalblock code, .sourceblock code {
      white-space: pre !important;
      overflow-x: auto !important;
      display: block !important;
      box-sizing: border-box !important;
      min-width: 0 !important;
    }
    /* Constrain quote blocks and verse blocks */
    .quoteblock, .verseblock, .exampleblock {
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      overflow-x: auto !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
    }
    /* Content inside quote blocks should wrap normally */
    .quoteblock p, .verseblock p, .exampleblock p,
    .quoteblock div, .verseblock div, .exampleblock div {
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
    }
    /* Admonition blocks (NOTE, TIP, WARNING, CAUTION, IMPORTANT) */
    .admonitionblock, .admonition {
      max-width: 100% !important;
      max-width: calc(100vw - 2em) !important;
      overflow-x: auto !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      margin: 1em 0 !important;
      display: block !important;
    }
    /* Admonition tables should display normally */
    .admonitionblock table, .admonition table {
      width: 100% !important;
      table-layout: auto !important;
      border-collapse: collapse !important;
    }
    /* Admonition table cells - icon/title cell and content cell */
    .admonitionblock table td, .admonition table td,
    .admonitionblock table th, .admonition table th {
      max-width: none !important;
      width: auto !important;
      white-space: normal !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      vertical-align: top !important;
    }
    /* Admonition icon/title cell should not be too narrow */
    .admonitionblock .icon, .admonition .icon,
    .admonitionblock .title, .admonition .title {
      white-space: normal !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      min-width: fit-content !important;
      width: auto !important;
    }
    /* Content inside admonition blocks should wrap normally */
    .admonitionblock p, .admonition p,
    .admonitionblock div, .admonition div,
    .admonitionblock .content, .admonition .content,
    .admonitionblock .paragraph, .admonition .paragraph {
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
      max-width: 100% !important;
    }
    /* Ensure container doesn't exceed viewport */
    div[style*="max-width"] {
      max-width: min(1200px, calc(100vw - 2em)) !important;
    }
  `;
}

/**
 * Add responsive CSS to HTML content (for HTML5 downloads)
 */
export function addResponsiveCSSToHTML(htmlContent) {
  const responsiveCSS = `<style>${getResponsiveMediaCSS()}</style>`;
  
  // Try to insert in head first
  if (htmlContent.match(/<\/head>/i)) {
    return htmlContent.replace(/<\/head>/i, `${responsiveCSS}</head>`);
  }
  // Otherwise insert before body
  if (htmlContent.match(/<body[^>]*>/i)) {
    return htmlContent.replace(/(<body[^>]*>)/i, `${responsiveCSS}$1`);
  }
  // If no body tag, prepend to content
  return `${responsiveCSS}${htmlContent}`;
}

/**
 * Generate message box component
 */
export function generateMessageBox(type, message, details = null) {
  const typeClass = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
  const icon = type === 'error' ? '⚠️' : type === 'warning' ? 'ℹ️' : 'ℹ️';
  
  let html = `
  <div class="message-box ${typeClass}">
    <div class="message-box-header">
      <span class="message-box-icon">${icon}</span>
      <strong class="message-box-title">${escapeHtml(type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Information')}</strong>
    </div>
    <div class="message-box-content">
      <p>${escapeHtml(message)}</p>`;
  
  if (details) {
    html += `
      <details class="message-box-details">
        <summary>Details</summary>
        <pre>${escapeHtml(typeof details === 'string' ? details : JSON.stringify(details, null, 2))}</pre>
      </details>`;
  }
  
  html += `
    </div>
  </div>`;
  
  return html;
}

/**
 * Generate navigation menu component
 * @param {string} relayInput - Custom relay input string (empty string for default relays)
 * @returns {string} HTML for navigation menu
 */
export function generateNavigation(relayInput = '') {
  const hasCustomRelays = relayInput && relayInput.trim().length > 0;
  const relayParam = hasCustomRelays ? `?relays=${encodeURIComponent(relayInput)}` : '';
  
  return `
  <nav>
    <a href="/${relayParam}">Alexandria Catalogue</a>
    <a href="/books${relayParam}">Browse Library</a>
    <a href="/articles${relayParam}">Browse Articles</a>
    <a href="/highlights${relayParam}">Browse Highlights</a>
    <a href="/status${relayParam}">Status</a>
  </nav>`;
}

/**
 * Generate search bar component
 * @param {Object} options - Search bar configuration
 * @param {string} options.action - Form action URL (e.g., '/articles' or '/')
 * @param {string} options.searchQuery - Current search query value
 * @param {string} options.kinds - Content kinds ('books' or 'articles') - used to customize placeholder and label
 * @param {boolean} options.hasCustomRelays - Whether custom relays are set
 * @param {string} options.relayInput - Custom relay input string
 * @param {number} options.limit - Items per page limit
 * @param {string} options.inputName - Input field name (default: 'q' for articles, 'naddr' for books)
 * @param {boolean} options.showClearButton - Whether to show clear button (default: true if searchQuery exists)
 * @param {string} options.clearUrl - URL to navigate to when clearing (default: action URL with page/limit)
 * @returns {string} HTML for search bar
 */
export function generateSearchBar(options) {
  const {
    action,
    searchQuery = '',
    kinds = 'books', // 'books' or 'articles'
    hasCustomRelays = false,
    relayInput = '',
    limit = 50,
    inputName = kinds === 'articles' ? 'q' : 'naddr',
    showClearButton = searchQuery ? true : false,
    clearUrl = null
  } = options;
  
  // Determine placeholder and label based on kinds
  let placeholder, label;
  if (kinds === 'articles') {
    placeholder = 'Search by title, summary, pubkey (npub1...), NIP05 (user@domain.com), or d-tag...';
    label = 'Search articles';
  } else {
    placeholder = 'naddr1... or d tag...';
    label = 'Search books';
  }
  
  // Build clear URL if not provided
  // For articles, include page/limit; for books, just the action URL
  const defaultClearUrl = clearUrl || (kinds === 'articles' 
    ? `${action}?page=1&limit=${limit}${hasCustomRelays ? '&relays=' + encodeURIComponent(relayInput) : ''}`
    : `${action}${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}`);
  
  let html = `
  <div class="search-form">
    <form method="get" action="${escapeHtml(action)}" role="search" aria-label="${escapeHtml(label)}">
      ${label ? `<label for="search-query-${kinds}">${escapeHtml(label)}</label>` : ''}
      <div style="display: flex; gap: 0.5em; align-items: stretch; max-width: 100%; flex-wrap: wrap;">
        <input type="text" id="search-query-${kinds}" name="${escapeHtml(inputName)}" value="${escapeHtml(searchQuery)}" placeholder="${escapeHtml(placeholder)}" ${inputName === 'naddr' ? 'required' : ''} aria-label="Search query" style="flex: 1 1 auto; min-width: 200px; max-width: 100%; word-break: break-all; overflow-wrap: break-word; ${inputName === 'naddr' ? 'font-family: monospace; font-size: 0.9em;' : ''} box-sizing: border-box;">
        <button type="submit" aria-label="Submit search" style="flex-shrink: 0;">Search</button>
        ${showClearButton ? `<a href="${escapeHtml(defaultClearUrl)}" aria-label="Clear search" style="display: inline-block; padding: 0.75em 1em; font-size: 1em; background: #000000; color: #ffffff; border: 2px solid #000000; min-height: 44px; font-weight: bold; cursor: pointer; text-decoration: none; box-sizing: border-box; line-height: 1.5; flex-shrink: 0;">Clear</a>` : ''}
      </div>
      ${inputName === 'q' ? `<input type="hidden" name="page" value="1">
      <input type="hidden" name="limit" value="${limit}">` : ''}
      ${hasCustomRelays ? `<input type="hidden" name="relays" value="${escapeHtml(relayInput)}">` : ''}
    </form>
  </div>`;
  
  return html;
}

/**
 * Generate error page
 */
export function generateErrorPage(title, errorMessage, details = null, backUrl = '/', relayInput = '') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)}</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  ${generateNavigation(relayInput)}
  <h1>${escapeHtml(title)}</h1>
  ${generateMessageBox('error', errorMessage, details)}
  <p style="margin-top: 2em;"><a href="${escapeHtml(backUrl)}">← Go back</a></p>
</body>
</html>`;
}

/**
 * Wrap HTML content with navigation header
 */
export function wrapHTMLWithNavigation(htmlContent, title, author, naddr, coverImage = null) {
  let bodyContent = htmlContent;
  
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    bodyContent = bodyMatch[1];
  } else {
    const headMatch = htmlContent.match(/<\/head>([\s\S]*)/i);
    if (headMatch) {
      bodyContent = headMatch[1];
    }
  }
  
  // Add cover image at the beginning if provided (for HTML view only)
  let coverImageHtml = '';
  if (coverImage) {
    coverImageHtml = `
    <div style="text-align: center !important; margin: 2em auto !important; max-width: min(1200px, calc(100vw - 2em)) !important; padding: 0 1em !important; width: 100% !important; box-sizing: border-box !important;">
      <img src="${escapeHtml(coverImage)}" alt="Cover" style="max-width: min(1000px, calc(100vw - 2em)) !important; max-height: 1000px !important; width: auto !important; height: auto !important; border: 1px solid #ddd !important; border-radius: 4px !important; display: block !important; margin: 0 auto !important;">
    </div>
    `;
  }
  
  const navHeader = `
    <div style="background: white; border-bottom: 1px solid #ddd; padding: 1em; margin-bottom: 1em;">
      <div style="display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto;">
        <div>
          <h1 style="font-size: 1.2em; font-weight: 600; color: #000000; margin: 0;">${escapeHtml(title)}</h1>
          <div style="color: #1a1a1a; font-size: 0.9em; margin-top: 0.25em;">${escapeHtml(author || 'Unknown Author')}</div>
        </div>
        <div style="display: flex; gap: 0.5em;">
          <a href="/?naddr=${encodeURIComponent(naddr)}" style="padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000;">Back to Book</a>
          <a href="/view-epub?naddr=${encodeURIComponent(naddr)}" style="padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000;">View as EPUB</a>
        </div>
      </div>
    </div>
  `;
  
  // Add responsive video/iframe CSS to existing HTML
  const responsiveCSS = `<style>${getResponsiveMediaCSS()}</style>`;
  
  if (htmlContent.match(/<body[^>]*>/i)) {
    // Insert CSS in head if it exists, otherwise before body
    let modifiedHTML = htmlContent;
    if (htmlContent.match(/<\/head>/i)) {
      modifiedHTML = htmlContent.replace(/<\/head>/i, `${responsiveCSS}</head>`);
    } else {
      modifiedHTML = htmlContent.replace(/(<body[^>]*>)/i, `${responsiveCSS}$1`);
    }
    // Insert nav header and cover image after body tag
    // The cover image div already has proper centering styles (margin: 2em auto, max-width, etc.)
    return modifiedHTML.replace(/(<body[^>]*>)/i, `$1${navHeader}${coverImageHtml}`);
  }
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)} - HTML View</title>
  <style>${getResponsiveMediaCSS()}</style>
</head>
<body>
${navHeader}
<div style="max-width: min(1200px, calc(100vw - 2em)); margin: 0 auto; padding: 1em;">
${coverImageHtml}
${bodyContent}
</div>
</body>
</html>`;
}

/**
 * Generate EPUB viewer HTML with EPUB.js
 */
export function generateEPUBViewerHTML(title, author, epubDataUri, naddr) {
  // Validate epubDataUri
  if (!epubDataUri || typeof epubDataUri !== 'string' || !epubDataUri.startsWith('data:')) {
    console.error('[EPUB Viewer] Invalid epubDataUri:', epubDataUri);
    throw new Error('Invalid EPUB data URI');
  }
  
  // Use JSON.stringify to properly escape the string for JavaScript
  // This ensures all special characters are properly escaped
  const escapedEpubDataUri = JSON.stringify(epubDataUri);
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)} - EPUB Reader</title>
  <style>${getEPUBViewerStyles()}</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="book-info">${escapeHtml(author || 'Unknown Author')}</div>
    </div>
    <div class="actions">
      <a href="/?naddr=${encodeURIComponent(naddr)}">Back to Book</a>
      <a href="/view?naddr=${encodeURIComponent(naddr)}">View as HTML</a>
      <a href="/download?naddr=${encodeURIComponent(naddr)}&format=epub3">Download EPUB</a>
    </div>
  </div>
  
  <div class="navigation-controls" style="background: #ffffff; border-bottom: 2px solid #000000; padding: 0.5em 1em; display: flex; justify-content: space-between; align-items: center; gap: 1em;">
    <button id="prev-btn" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-weight: bold;">← Previous</button>
    <button id="toc-btn" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em;">📑 ToC</button>
    <div style="flex: 1; text-align: center; color: #1a1a1a; font-size: 0.9em;">
      <span id="page-info">Page 1</span>
    </div>
    <button id="next-btn" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-weight: bold;">Next →</button>
  </div>
  
  <div class="viewer-container">
    <noscript>
      <div class="error" style="position: relative; transform: none; top: auto; left: auto; margin: 2em auto; max-width: 600px; padding: 2em; background: #ffffff; border: 2px solid #000000; border-radius: 4px;">
        <h2 style="margin-top: 0; color: #000000;">JavaScript Required for EPUB Viewer</h2>
        <p style="color: #1a1a1a; line-height: 1.6;">The EPUB viewer requires JavaScript to function. For e-readers and browsers with JavaScript disabled, please use one of these alternatives:</p>
        <div style="margin-top: 1.5em; display: flex; flex-direction: column; gap: 0.75em;">
          <a href="/view?naddr=${encodeURIComponent(naddr)}" style="display: inline-block; padding: 0.75em 1.5em; background: #007bff; color: #ffffff; text-decoration: none; border-radius: 4px; border: 2px solid #007bff; text-align: center; font-weight: bold;">View as HTML (Recommended for E-readers)</a>
          <a href="/download?naddr=${encodeURIComponent(naddr)}&format=epub3" style="display: inline-block; padding: 0.75em 1.5em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; border: 2px solid #000000; text-align: center; font-weight: bold;">Download EPUB File</a>
          <a href="/?naddr=${encodeURIComponent(naddr)}" style="display: inline-block; padding: 0.5em 1em; color: #0066cc; text-decoration: underline; text-align: center;">← Back to Book Details</a>
        </div>
        <p style="margin-top: 1.5em; font-size: 0.9em; color: #4a4a4a; line-height: 1.5;">
          <strong>Note:</strong> The HTML view works without JavaScript and is optimized for e-paper readers. You can also download the EPUB file and open it with your e-reader's native EPUB reader.
        </p>
      </div>
    </noscript>
    <div id="loading" class="loading">
      <div class="loading-spinner"></div>
      <div>Loading EPUB...</div>
    </div>
    <div id="error" class="error" style="display: none;">
      <h2>Error Loading EPUB</h2>
      <p id="error-message"></p>
      <a href="/?naddr=${encodeURIComponent(naddr)}">Go back</a>
    </div>
    <div id="viewer"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js"></script>
  <script>
    (function() {
      const viewer = document.getElementById('viewer');
      const loading = document.getElementById('loading');
      const errorDiv = document.getElementById('error');
      const errorMessage = document.getElementById('error-message');
      
      const epubDataUri = ${escapedEpubDataUri};
      
      // Convert data URI to Blob URL for EPUB.js compatibility
      function dataURItoBlob(dataURI) {
        const byteString = atob(dataURI.split(',')[1]);
        const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ab], { type: mimeString });
      }
      
      const blob = dataURItoBlob(epubDataUri);
      
      // Pass the Blob directly to EPUB.js - it can handle Blobs and extract ZIP internally
      const book = ePub(blob);
      
      // Suppress console errors for external resources, cover image, and font files
      const originalError = console.error;
      const originalWarn = console.warn;
      console.error = function(...args) {
        const message = args[0]?.message || String(args[0] || '');
        const fullMessage = String(args[0] || '');
        // Suppress "File not found" errors for external URLs
        if (message.includes('File not found in the epub') && 
            (message.includes('http://') || message.includes('https://'))) {
          return; // Suppress this error
        }
        // Suppress cover image errors (AsciiDoctor generates /jacket/front-cover.jpg internally)
        if (message.includes('File not found in the epub') && 
            (message.includes('/jacket/') || message.includes('front-cover'))) {
          return; // Suppress cover image error
        }
        // Suppress font file errors (EPUB.js tries to load fonts as stylesheets)
        if (fullMessage.includes('application/x-font-ttf') || 
            fullMessage.includes('application/x-font-otf') ||
            fullMessage.includes('font/ttf') ||
            fullMessage.includes('font/otf') ||
            fullMessage.includes('.ttf') ||
            fullMessage.includes('.otf')) {
          return; // Suppress font file errors
        }
        originalError.apply(console, args);
      };
      console.warn = function(...args) {
        const fullMessage = String(args[0] || '');
        // Suppress font file warnings
        if (fullMessage.includes('application/x-font-ttf') || 
            fullMessage.includes('application/x-font-otf') ||
            fullMessage.includes('font/ttf') ||
            fullMessage.includes('font/otf') ||
            fullMessage.includes('MIME-Typ') ||
            fullMessage.includes('MIME type')) {
          return; // Suppress font file warnings
        }
        originalWarn.apply(console, args);
      };
      
      const rendition = book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });
      
      book.ready.catch(function(err) {
        originalError('EPUB loading error:', err);
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
        errorMessage.textContent = err.message || 'Failed to load EPUB file';
        console.error = originalError;
      });
      
      book.ready.then(function() {
        console.log('EPUB loaded successfully');
        return rendition.display();
      }).then(function() {
        console.log('EPUB rendered successfully');
        loading.style.display = 'none';
        console.error = originalError; // Restore console.error
        setupNavigation(rendition, book);
      }).catch(function(err) {
        originalError('EPUB rendering error:', err);
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
        errorMessage.textContent = err.message || 'Failed to render EPUB';
        console.error = originalError;
      });
      
      function setupNavigation(rendition, book) {
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        const tocBtn = document.getElementById('toc-btn');
        const pageInfo = document.getElementById('page-info');
        
        // Update page info
        function updatePageInfo() {
          if (book && book.navigation) {
            const currentLocation = rendition.currentLocation();
            if (currentLocation) {
              const current = currentLocation.start.displayed.page;
              const total = currentLocation.start.displayed.total;
              pageInfo.textContent = \`Page \${current} of \${total}\`;
            }
          }
        }
        
        // Navigation buttons
        prevBtn.addEventListener('click', function() {
          rendition.prev();
        });
        
        nextBtn.addEventListener('click', function() {
          rendition.next();
        });
        
        // Table of Contents button - navigate to ToC or beginning of book
        tocBtn.addEventListener('click', function() {
          book.ready.then(function() {
            // Try to find the Table of Contents
            if (book.navigation && book.navigation.toc && book.navigation.toc.length > 0) {
              // Navigate to the first ToC item (usually the cover or first chapter)
              const firstTocItem = book.navigation.toc[0];
              if (firstTocItem && firstTocItem.href) {
                return rendition.display(firstTocItem.href);
              }
            }
            // If no ToC, navigate to the beginning of the book (first spine item)
            if (book.spine && book.spine.length > 0) {
              const firstSpineItem = book.spine.get(0);
              if (firstSpineItem) {
                return rendition.display(firstSpineItem.href);
              }
            }
            // Fallback: try to display the first page
            return rendition.display();
          }).catch(function(err) {
            console.error('ToC navigation error:', err);
          });
        });
        
        // Update page info on navigation
        rendition.on('relocated', function(location) {
          updatePageInfo();
        });
        
        // Handle ToC and internal links, convert broken images/videos to links, and fix admonition icons
        rendition.on('displayed', function() {
          // Get the iframe content document (EPUB.js renders in an iframe)
          const iframe = viewer.querySelector('iframe');
          if (!iframe || !iframe.contentDocument) {
            return; // Iframe not ready yet
          }
          const contentDoc = iframe.contentDocument;
          
          // Fix admonition icons
          const admonitions = contentDoc.querySelectorAll('.admonitionblock, .admonition, aside[class*="admonition"]');
          const iconMap = {
            'note': 'ℹ',
            'tip': '💡',
            'warning': '⚠',
            'caution': '⚡',
            'important': '⚠',
            'information': 'ℹ',
            'info': 'ℹ'
          };
          
          admonitions.forEach(function(admonition) {
            // Determine admonition type from class names
            let type = 'note';
            for (const key in iconMap) {
              if (admonition.classList.contains(key) || admonition.className.includes(key)) {
                type = key;
                break;
              }
            }
            
            const icon = iconMap[type] || 'ℹ';
            
            // Find or create title element
            let title = admonition.querySelector('.title');
            if (!title) {
              // Try to find content cell and create title
              const contentCell = admonition.querySelector('.content, td.content');
              if (contentCell) {
                title = contentDoc.createElement('div');
                title.className = 'title';
                contentCell.insertBefore(title, contentCell.firstChild);
              }
            }
            
            if (title) {
              // Check if icon already exists
              let iconEl = title.querySelector('.icon, i.icon');
              if (!iconEl) {
                iconEl = contentDoc.createElement('i');
                iconEl.className = 'icon';
                title.insertBefore(iconEl, title.firstChild);
              }
              iconEl.textContent = icon;
              iconEl.style.display = 'inline';
              iconEl.style.marginRight = '0.5rem';
              iconEl.style.fontSize = '1.2em';
            }
          });
          
          // Find all links in the rendered content
          const links = contentDoc.querySelectorAll('a[href]');
          links.forEach(function(link) {
            link.addEventListener('click', function(e) {
              const href = link.getAttribute('href');
              if (href && (href.startsWith('#') || (!href.startsWith('http') && !href.startsWith('mailto:')))) {
                e.preventDefault();
                // Internal EPUB link - navigate to it
                book.ready.then(function() {
                  return rendition.display(href);
                }).catch(function(err) {
                  console.error('Navigation error:', err);
                });
              }
            });
          });
          
          // Convert broken images to hyperlinks
          const images = contentDoc.querySelectorAll('img');
          images.forEach(function(img) {
            const src = img.getAttribute('src');
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
              // External image - convert to link if it fails to load
              img.addEventListener('error', function() {
                const link = contentDoc.createElement('a');
                link.href = src;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'View Image: ' + src;
                link.style.display = 'inline-block';
                link.style.padding = '0.5em';
                link.style.background = '#e7f3ff';
                link.style.border = '1px solid #007bff';
                link.style.borderRadius = '4px';
                link.style.color = '#0066cc';
                link.style.textDecoration = 'underline';
                link.style.margin = '0.5em 0';
                img.parentNode.replaceChild(link, img);
              });
            }
          });
          
          // Convert video elements with external URLs to links
          const videos = contentDoc.querySelectorAll('video');
          videos.forEach(function(video) {
            const src = video.getAttribute('src');
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
              // External video - convert to link
              const link = contentDoc.createElement('a');
              link.href = src;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.textContent = 'View Video: ' + src;
              link.style.display = 'inline-block';
              link.style.padding = '0.5em';
              link.style.background = '#e7f3ff';
              link.style.border = '1px solid #007bff';
              link.style.borderRadius = '4px';
              link.style.color = '#0066cc';
              link.style.textDecoration = 'underline';
              link.style.margin = '0.5em 0';
              video.parentNode.replaceChild(link, video);
            }
          });
          
          // Convert audio elements with external URLs to links
          const audios = contentDoc.querySelectorAll('audio');
          audios.forEach(function(audio) {
            const src = audio.getAttribute('src');
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
              // External audio - convert to link
              const link = contentDoc.createElement('a');
              link.href = src;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.textContent = 'Play Audio: ' + src;
              link.style.display = 'inline-block';
              link.style.padding = '0.5em';
              link.style.background = '#e7f3ff';
              link.style.border = '1px solid #007bff';
              link.style.borderRadius = '4px';
              link.style.color = '#0066cc';
              link.style.textDecoration = 'underline';
              link.style.margin = '0.5em 0';
              audio.parentNode.replaceChild(link, audio);
            }
          });
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (e.key === 'ArrowLeft') {
              rendition.prev();
            } else {
              rendition.next();
            }
          }
        });
        
        // Touch/swipe navigation
        let touchStartX = 0;
        let touchEndX = 0;
        
        viewer.addEventListener('touchstart', function(e) {
          touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        viewer.addEventListener('touchend', function(e) {
          touchEndX = e.changedTouches[0].screenX;
          handleSwipe();
        }, { passive: true });
        
        function handleSwipe() {
          const swipeThreshold = 50;
          const diff = touchStartX - touchEndX;
          
          if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
              rendition.next();
            } else {
              rendition.prev();
            }
          }
        }
        
        // Initial page info
        updatePageInfo();
      }
    })();
  </script>
</body>
</html>`;
}
