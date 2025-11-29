/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate EPUB, HTML5, and PDF files
 */

// Use relative path if not set (works with Apache proxy), otherwise use full URL
// In test environment, always use absolute URL
const getAsciiDoctorServerUrl = () => {
  if (import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL) {
    const url = import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL;
    // Ensure trailing slash for relative paths
    if (url.startsWith('/') && !url.endsWith('/')) {
      return url + '/';
    }
    return url;
  }
  // In test environment (vitest), use absolute URL
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return 'http://localhost:8091';
  }
  // In browser, check if we're in development (localhost) and use direct port, otherwise use proxy path
  if (typeof window !== 'undefined') {
    // In development (localhost), use direct connection to port 8091
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8091/';
    }
    // In production, use relative path (works with Apache proxy)
    return '/asciidoctor/';
  }
  // Default fallback
  return 'http://localhost:8091';
};

const ASCIIDOCTOR_SERVER_URL = getAsciiDoctorServerUrl();

export interface ExportOptions {
  content: string;
  title: string;
  author?: string;
}


/**
 * Get a user-friendly error message for HTML5 export failures
 * Checks server health and provides specific guidance
 */
async function getHTML5ErrorMessage(error: unknown, url: string): Promise<string> {
  const isNetworkError = error instanceof TypeError && error.message.includes('fetch');
  const isConnectionError = error instanceof Error && (
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError') ||
    error.message.includes('Network request failed')
  );
  
  // Check if server is reachable
  const serverHealthy = await checkServerHealth();
  const serverUrl = ASCIIDOCTOR_SERVER_URL;
  
  if (isNetworkError || isConnectionError || !serverHealthy) {
    // Server is not running or not reachable
    let errorMsg = 'Failed to connect to AsciiDoctor server.\n\n';
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += `Status: ${serverHealthy ? 'Reachable but error occurred' : 'Not reachable'}\n\n`;
    
    if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
      errorMsg += 'The AsciiDoctor server appears to be running on localhost (port 8091).\n';
      errorMsg += 'Please check:\n';
      errorMsg += '1. The server is running: `docker ps` or check the process\n';
      errorMsg += '2. The server is accessible at http://localhost:8091\n';
      errorMsg += '3. There are no firewall or network issues blocking the connection\n';
    } else if (serverUrl.startsWith('/')) {
      errorMsg += 'The AsciiDoctor server is configured to use a proxy path.\n';
      errorMsg += 'Please check:\n';
      errorMsg += '1. The server is running on port 8091\n';
      errorMsg += '2. The Apache/web server proxy is configured correctly\n';
      errorMsg += '3. The proxy path /asciidoctor/ is working\n';
    } else {
      errorMsg += `The server is configured at: ${serverUrl}\n`;
      errorMsg += 'Please verify the server is running and accessible at this address.\n';
    }
    
    return errorMsg;
  } else {
    // Server is reachable, so this is likely a content/syntax error
    const originalError = error instanceof Error ? error.message : String(error);
    let errorMsg = `HTML5 generation failed: ${originalError}\n\n`;
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += 'The AsciiDoctor server is running, but encountered an error processing your content.\n\n';
    errorMsg += 'This is likely due to:\n';
    errorMsg += '1. AsciiDoc syntax errors in the content\n';
    errorMsg += '2. Invalid or malformed AsciiDoc markup\n';
    errorMsg += '3. Server-side processing error\n\n';
    errorMsg += 'Please check the AsciiDoc syntax and try again.';
    
    return errorMsg;
  }
}

/**
 * Convert AsciiDoc content to HTML5
 */
export async function exportToHTML5(options: ExportOptions, abortSignal?: AbortSignal): Promise<Blob> {
  const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
  const url = `${baseUrl}convert/html5`;
  
  // Verify we have AsciiDoc content
  if (!options.content || options.content.trim().length === 0) {
    throw new Error('Cannot export to HTML5: AsciiDoc content is empty');
  }
  
  console.log('AsciiDoctor Export: Sending request to', url);
  console.log('AsciiDoctor Export: Content preview (first 200 chars):', options.content.substring(0, 200));
  
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: options.content, // AsciiDoc content
        title: options.title,
        author: options.author || '',
      }),
      signal: abortSignal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Download cancelled');
    }
    // Network/connection error - check server health and provide helpful message
    const errorMsg = await getHTML5ErrorMessage(error, url);
    throw new Error(errorMsg);
  }

  if (!response.ok) {
    // Try to read error message
    const contentType = response.headers.get('content-type') || '';
    let serverError: Error | null = null;
    
    try {
      if (contentType.includes('application/json')) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        serverError = new Error(error.error || error.message || `Failed to generate HTML5: ${response.statusText}`);
      } else {
        serverError = new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
      }
    } catch {
      serverError = new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
    }
    
    // Get user-friendly error message
    const errorMsg = await getHTML5ErrorMessage(serverError, url);
    throw new Error(errorMsg);
  }

  // Verify we got an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      const serverHealthy = await checkServerHealth();
      const serverUrl = ASCIIDOCTOR_SERVER_URL;
      let errorMsg = 'Server returned SvelteKit app shell instead of HTML.\n\n';
      errorMsg += `Server URL: ${serverUrl}\n`;
      errorMsg += `Server health check: ${serverHealthy ? 'Reachable' : 'Not reachable'}\n\n`;
      
      if (!serverHealthy) {
        errorMsg += 'The AsciiDoctor server is not reachable. ';
        if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
          errorMsg += 'Please check if the server is running on port 8091.';
        } else if (serverUrl.startsWith('/')) {
          errorMsg += 'Please check if the proxy configuration is correct.';
        }
      } else {
        errorMsg += 'The server is reachable, but the proxy may not be configured correctly. ';
        errorMsg += 'The request is being handled by the SvelteKit app instead of the AsciiDoctor server.';
      }
      
      throw new Error(errorMsg);
    }
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-HTML response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  // Verify the blob content is actually HTML from AsciiDoctor, not the SvelteKit app
  let blobText = await blob.text();
  
  // Post-process HTML to convert wikilink: protocol links to proper HTML links
  // AsciiDoctor doesn't recognize wikilink: protocol, so we convert them after conversion
  blobText = blobText.replace(/<a[^>]*href=["']wikilink:([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (match, href, text) => {
    // Convert wikilink: protocol to a clickable link
    // For now, we'll use javascript:void(0) with onclick, or we could use a data attribute
    const cleanHref = href.replace(/^wikilink:/, '');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${text}</a>`;
  });
  
  // Also handle cases where AsciiDoctor didn't convert them to links (plain text)
  blobText = blobText.replace(/link:wikilink:([^\[]+)\[([^\]]+)\]/g, (match, href, text) => {
    const cleanHref = href.replace(/^wikilink:/, '');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${text}</a>`;
  });
  
  // Check if it's the SvelteKit app shell (common error when proxy fails)
  if (blobText.includes('__sveltekit') || blobText.includes('sveltekit-preload-data') || blobText.includes('_app/immutable')) {
    console.error('AsciiDoctor Export: Received SvelteKit app shell instead of HTML');
    console.error('AsciiDoctor Export: URL was:', url);
    console.error('AsciiDoctor Export: Response preview:', blobText.substring(0, 500));
    
    const serverHealthy = await checkServerHealth();
    const serverUrl = ASCIIDOCTOR_SERVER_URL;
    let errorMsg = 'Server returned SvelteKit app shell instead of HTML.\n\n';
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += `Server health check: ${serverHealthy ? 'Reachable' : 'Not reachable'}\n\n`;
    
    if (!serverHealthy) {
      errorMsg += 'The AsciiDoctor server is not reachable. ';
      if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
        errorMsg += 'Please check if the server is running on port 8091.';
      } else if (serverUrl.startsWith('/')) {
        errorMsg += 'Please check if the proxy configuration is correct.';
      }
    } else {
      errorMsg += 'The server is reachable, but the proxy may not be configured correctly. ';
      errorMsg += 'The request is being handled by the SvelteKit app instead of the AsciiDoctor server.';
      if (serverUrl.startsWith('/')) {
        errorMsg += '\n\nCheck your Apache/web server configuration:';
        errorMsg += '\nProxyPass /asciidoctor/ http://127.0.0.1:8091/';
      }
    }
    
    throw new Error(errorMsg);
  }
  
  // Verify it's actually HTML from AsciiDoctor (should contain asciidoc classes or structure)
  if (!blobText.includes('<html') && !blobText.includes('<!DOCTYPE') && !blobText.includes('<!doctype')) {
    console.error('AsciiDoctor Export: Response does not appear to be HTML');
    console.error('AsciiDoctor Export: Response preview:', blobText.substring(0, 500));
    throw new Error('Server returned invalid HTML. Response preview: ' + blobText.substring(0, 200));
  }
  
  // Post-process HTML to convert wikilink: protocol links to proper HTML links
  // AsciiDoctor doesn't recognize wikilink: protocol, so we convert them after conversion
  // Handle both link:wikilink:...[...] format (not converted by AsciiDoctor) and <a href="wikilink:..."> format
  blobText = blobText.replace(/link:wikilink:([^\[]+)\[([^\]]+)\]/g, (match, href, text) => {
    // Escape HTML in text
    const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cleanHref = href.replace(/^wikilink:/, '').replace(/&/g, '&amp;');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${escapedText}</a>`;
  });
  
  // Also handle cases where AsciiDoctor converted them to <a> tags but with wikilink: protocol
  blobText = blobText.replace(/<a[^>]*href=["']wikilink:([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (match, href, text) => {
    const cleanHref = href.replace(/^wikilink:/, '').replace(/&/g, '&amp;');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${text}</a>`;
  });
  
  // Post-process HTML to limit cover image width to 400px max (max-width, not fixed width)
  // Find images with role="cover" or in cover-page sections and add max-width style
  // This ensures small images stay small, and large images are constrained to 400px
  blobText = blobText.replace(
    /(<img[^>]*class="[^"]*cover[^"]*"[^>]*>)/gi,
    (match) => {
      // Add or update style attribute to limit width (max-width, not width)
      if (match.includes('style=')) {
        return match.replace(/style="([^"]*)"/i, (_, existingStyle) => {
          // Remove any existing width constraint and add max-width
          const cleanedStyle = existingStyle.replace(/width:\s*\d+px;?/gi, '').replace(/max-width:\s*\d+px;?/gi, '');
          const hasMaxWidth = cleanedStyle.includes('max-width');
          if (hasMaxWidth) {
            return `style="${existingStyle}"`;
          }
          // Add max-width (not width) so small images stay small
          return `style="${cleanedStyle.trim()}; max-width: 400px;"`.replace(/;\s*;/g, ';');
        });
      } else {
        return match.replace(/>$/, ' style="max-width: 400px;">');
      }
    }
  );
  
  // Also handle images in title-page divs
  blobText = blobText.replace(
    /(<div[^>]*class="[^"]*title-page[^"]*"[^>]*>[\s\S]*?<img[^>]*>)/gi,
    (match) => {
      return match.replace(/(<img[^>]*>)/i, (imgTag) => {
        if (imgTag.includes('style=')) {
          return imgTag.replace(/style="([^"]*)"/i, (_, existingStyle) => {
            const hasMaxWidth = existingStyle.includes('max-width');
            if (hasMaxWidth) {
              return `style="${existingStyle}"`;
            }
            return `style="${existingStyle}; max-width: 400px;"`;
          });
        } else {
          return imgTag.replace(/>$/, ' style="max-width: 400px;">');
        }
      });
    }
  );
  
  // Ensure all images in content have proper attributes and styling
  // This handles images that aren't cover images or in title pages
  blobText = blobText.replace(
    /<img([^>]*?)>/gi,
    (match, attributes) => {
      // Skip if this is a cover or title-page image (already processed)
      if (attributes.includes('class="') && (attributes.includes('cover') || attributes.includes('title-page'))) {
        return match;
      }
      
      // Ensure src attribute exists and is valid
      if (!attributes.includes('src=')) {
        return match; // Skip images without src
      }
      
      // Add loading="lazy" for performance if not present
      if (!attributes.includes('loading=')) {
        attributes += ' loading="lazy"';
      }
      
      // Ensure alt attribute exists for accessibility (even if empty)
      if (!attributes.includes('alt=')) {
        attributes += ' alt=""';
      }
      
      // Add responsive styling if not already present
      if (!attributes.includes('style=')) {
        attributes += ' style="max-width: 100%; height: auto;"';
      } else if (!attributes.includes('max-width')) {
        // Add max-width to existing style
        attributes = attributes.replace(/style="([^"]*)"/i, (_match: string, existingStyle: string) => {
          return `style="${existingStyle}; max-width: 100%; height: auto;"`.replace(/;\s*;/g, ';');
        });
      }
      
      return `<img${attributes}>`;
    }
  );
  
  // Add CSS styling for cover page and book metadata section
  // Cover page: image, title, and "by author" line
  // Book metadata: classic title/copyright page style with large title
  const titlePageStyles = `
    <style>
      /* General image styling - ensure all images are properly sized and displayed */
      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 1em auto;
        border: none;
        box-shadow: none;
      }
      
      /* Inline images in paragraphs should stay inline */
      p img,
      .paragraph img {
        display: inline-block;
        margin: 0.25em 0.5em;
        vertical-align: middle;
        max-width: 100%;
      }
      
      /* Block images - AsciiDoctor image blocks */
      .imageblock {
        text-align: center;
        margin: 1.5em 0;
        page-break-inside: avoid;
      }
      .imageblock img {
        display: block;
        margin: 0 auto;
        max-width: 100%;
        height: auto;
      }
      .imageblock .title {
        font-style: italic;
        margin-top: 0.5em;
        font-size: 0.9em;
        color: #666;
      }
      
      /* Ensure images don't overflow containers in all sections */
      .content img,
      .sect1 img,
      .sect2 img,
      .sect3 img,
      .sect4 img,
      .sect5 img,
      article img,
      section img {
        max-width: 100%;
        height: auto;
      }
      
      /* Images in lists */
      li img {
        max-width: 100%;
        height: auto;
        margin: 0.5em 0;
      }
      
      /* Images in tables */
      table img {
        max-width: 100%;
        height: auto;
        margin: 0.25em;
      }
      
      /* Responsive images for mobile */
      @media (max-width: 600px) {
        img {
          max-width: 100%;
          height: auto;
        }
        .imageblock {
          margin: 1em 0;
        }
      }
      
      /* Cover page styling - appears after TOC */
      .cover-page {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      /* Hide section heading if present */
      .cover-page h2,
      .cover-page .sect2 > h2 {
        display: none !important;
      }
      .cover-page img {
        margin: 0 auto 0.5em auto;
        display: block;
        max-width: 500px;
        width: 100%;
        height: auto;
      }
      /* Style title and author paragraphs - reduce spacing */
      .cover-page p {
        margin: 0.5em 0 0 0;
        font-size: 1.5em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #555;
      }
      /* Make first paragraph (title) larger and uppercase */
      .cover-page p:first-of-type {
        font-size: 3em;
        font-weight: 700;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #333;
        margin-top: 0.3em;
        margin-bottom: 0.2em;
      }
      /* Style the "by author" line (second paragraph or line break) */
      .cover-page p:nth-of-type(2),
      .cover-page br + p {
        margin-top: 0.2em;
        font-size: 1.5em;
      }
      
      /* Book metadata section - classic title/copyright page style */
      .book-metadata {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .book-metadata h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 1em 0 !important;
        font-size: 3.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #000;
      }
      .book-metadata p {
        margin: 0.8em 0;
        font-size: 1em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #333;
        line-height: 1.6;
      }
      .book-metadata strong {
        font-weight: 600;
        color: #000;
      }
      .book-metadata img {
        margin: 2em auto;
        display: block;
        max-width: 500px;
        height: auto;
      }
      
      /* Article metadata section - classic title/copyright page style */
      .article-metadata {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .article-metadata h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 1em 0 !important;
        font-size: 3.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #000;
      }
      .article-metadata p {
        margin: 0.8em 0;
        font-size: 1em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #333;
        line-height: 1.6;
      }
      .article-metadata strong {
        font-weight: 600;
        color: #000;
      }
      .article-metadata img {
        margin: 2em auto;
        display: block;
        max-width: 500px;
        height: auto;
      }
      
      /* Title page styling (for automatic Asciidoctor title page if it appears) */
      .title-page {
        text-align: center;
        margin: 0;
        padding: 6em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 85vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .title-page h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 2em 0 !important;
        font-size: 2.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.3;
      }
      .title-page img {
        margin: 2em auto 3em auto;
        display: block;
        max-width: 100%;
        height: auto;
      }
      .title-page .author {
        font-size: 1.3em;
        margin-top: 1em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
      }
      .title-page .revnumber,
      .title-page .revdate,
      .title-page .revremark {
        font-size: 1em;
        margin-top: 0.5em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
      }
    </style>
    `;
  if (blobText.includes('</head>')) {
    blobText = blobText.replace('</head>', titlePageStyles + '</head>');
  } else if (blobText.includes('<html')) {
    // If no head tag, add styles right after html tag
    blobText = blobText.replace('<html', titlePageStyles + '<html');
  }
  
  // Return a new blob with the verified and processed content
  // Create a Blob that supports .text() method in test environments
  const verifiedBlob = new Blob([blobText], { type: 'text/html; charset=utf-8' });
  
  // In test environments, ensure the blob has a .text() method by adding it if missing
  if (typeof verifiedBlob.text !== 'function') {
    (verifiedBlob as any).text = async function() {
      return blobText;
    };
  }
  
  return verifiedBlob;
}


/**
 * Convert AsciiDoc content to EPUB
 */
export async function exportToEPUB(
  options: ExportOptions, 
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  // Normalize baseUrl - remove trailing slash, then add it back to ensure clean URL construction
  const normalizedBase = ASCIIDOCTOR_SERVER_URL.replace(/\/+$/, '');
  const baseUrl = `${normalizedBase}/`;
  const url = `${baseUrl}convert/epub`;
  
  console.log('[EPUB Export] Sending request to:', url);
  console.log('[EPUB Export] Content length:', options.content.length);
  console.log('[EPUB Export] Title:', options.title);
  
  onProgress?.(45, 'Sending request to server...');
  let response: Response;
  
  // Create a timeout controller - longer timeout for large EPUBs
  // Base timeout: 10 minutes, add 1 minute per 100KB of content (minimum 10 minutes)
  const contentSizeKB = options.content.length / 1024;
  const timeoutMs = Math.max(10 * 60 * 1000, 10 * 60 * 1000 + Math.ceil(contentSizeKB / 100) * 60 * 1000);
  console.log('[EPUB Export] Content size:', Math.round(contentSizeKB), 'KB, timeout:', Math.round(timeoutMs / 1000), 'seconds');
  
  const timeoutController = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  
  // Set up timeout
  timeoutId = setTimeout(() => {
    console.error('[EPUB Export] Request timeout after', timeoutMs, 'ms - aborting fetch');
    timeoutController.abort();
  }, timeoutMs);
  
  // Combine abort signals: if user cancels OR timeout occurs, abort the fetch
  const combinedController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      if (timeoutId) clearTimeout(timeoutId);
      combinedController.abort();
    });
  }
  timeoutController.signal.addEventListener('abort', () => {
    combinedController.abort();
  });
  
  try {
    console.log('[EPUB Export] Starting fetch request...');
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: options.content,
        title: options.title,
        author: options.author || '',
      }),
      signal: combinedController.signal,
    });
    
    response = await fetchPromise;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    console.log('[EPUB Export] Fetch completed, status:', response.status, response.statusText);
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      if (timeoutController.signal.aborted) {
        const timeoutMinutes = Math.round(timeoutMs / 60000);
        throw new Error(`EPUB generation timed out after ${timeoutMinutes} minutes. The server took too long to respond. Please try again or check server logs.`);
      }
      if (abortSignal?.aborted) {
        throw new Error('Download cancelled');
      }
      throw new Error('Request was aborted');
    }
    const errorMessage = err instanceof Error ? err.message : 'Network error';
    console.error('[EPUB Export] Network error:', errorMessage);
    throw new Error(`Failed to connect to EPUB conversion server: ${errorMessage}. Make sure the AsciiDoctor server is running.`);
  }
  
  onProgress?.(60, 'Waiting for server response...');
  console.log('[EPUB Export] Response received, checking status...');

  if (!response.ok) {
    console.error('[EPUB Export] Server returned error status:', response.status, response.statusText);
    
    // Try to read error message from response body
    let errorMessage = `EPUB conversion failed: ${response.status} ${response.statusText}`;
    let errorDetails: any = null;
    
    try {
      const contentType = response.headers.get('content-type') || '';
      console.log('[EPUB Export] Error response content-type:', contentType);
      
      if (contentType.includes('application/json')) {
        errorDetails = await response.json();
        console.error('[EPUB Export] Server error (JSON):', errorDetails);
        
        errorMessage = errorDetails.error || errorDetails.message || errorMessage;
        
        // Add hint if available
        if (errorDetails.hint) {
          errorMessage += `\n\nHint: ${errorDetails.hint}`;
        }
        
        // Add line number if available
        if (errorDetails.line) {
          errorMessage += `\n\nError detected at line ${errorDetails.line}`;
        }
        
        // Add stack trace if available (for debugging)
        if (errorDetails.stack) {
          console.error('[EPUB Export] Server error stack:', errorDetails.stack);
        }
      } else {
        // Try to read as text even if not JSON
        const text = await response.text();
        console.log('[EPUB Export] Error response text (first 500 chars):', text.substring(0, 500));
        
        // Check for fatal server error: "Could not locate Gemfile or .bundle/ directory"
        if (text.includes('Could not locate Gemfile') || text.includes('.bundle/ directory')) {
          const fatalError = 'FATAL: AsciiDoctor server is in a broken state and needs to be restarted.\n\n' +
            'The server is repeatedly reporting "Could not locate Gemfile or .bundle/ directory" errors.\n\n' +
            'Please restart the AsciiDoctor server container:\n' +
            '  docker restart asciidoctor\n\n' +
            'Or if using docker-compose:\n' +
            '  docker-compose restart asciidoctor';
          console.error('[EPUB Export]', fatalError);
          throw new Error(fatalError);
        }
        
        // Check for revdate parsing error (caused by CSS block placement issue)
        if (text.includes('failed to parse revdate') || text.includes('no time information')) {
          const errorMsg = 'AsciiDoc parsing error: revdate attribute parsing failed. This may be caused by document structure issues.\n\n' +
            'The server reported: "failed to parse revdate: no time information".\n\n' +
            'This error has been logged for debugging.';
          console.error('[EPUB Export]', errorMsg);
          console.error('[EPUB Export] Server error text:', text.substring(0, 1000));
        }
        
        // Check for stylesheet file not found error
        if (text.includes('epub3.css') || text.includes('epub-classic.css') || (text.includes('No such file or directory') && text.includes('.css'))) {
          const errorMsg = 'Stylesheet file not found on server. The server tried to load a CSS file that doesn\'t exist.\n\n' +
            'This is a non-fatal error - the server should retry without the custom stylesheet.\n\n' +
            'If EPUB generation fails, check server logs for details.';
          console.warn('[EPUB Export]', errorMsg);
          console.warn('[EPUB Export] Server error text:', text.substring(0, 1000));
        }
        
        if (text) {
          // Try to parse as JSON in case content-type is wrong
          try {
            errorDetails = JSON.parse(text);
            console.error('[EPUB Export] Server error (parsed as JSON):', errorDetails);
            
            errorMessage = errorDetails.error || errorDetails.message || errorMessage;
            if (errorDetails.hint) {
              errorMessage += `\n\nHint: ${errorDetails.hint}`;
            }
            if (errorDetails.line) {
              errorMessage += `\n\nError detected at line ${errorDetails.line}`;
            }
          } catch {
            // Not JSON, use text as error message (limit length)
            const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;
            errorMessage = `${errorMessage}\n\nServer response:\n${preview}`;
          }
        }
      }
    } catch (err) {
      // Re-throw fatal errors
      if (err instanceof Error && err.message.includes('FATAL:')) {
        throw err;
      }
      console.error('[EPUB Export] Failed to read error response:', err);
      // Use default error message
    }
    
    console.error('[EPUB Export] Conversion error summary:', {
      status: response.status,
      statusText: response.statusText,
      url,
      errorMessage,
      errorDetails
    });
    
    // Log the full error details to console for debugging
    if (errorDetails) {
      console.error('[EPUB Export] Full error details:', JSON.stringify(errorDetails, null, 2));
    }
    
    throw new Error(errorMessage);
  }

  // Verify we got an EPUB response
  const contentType = response.headers.get('content-type') || '';
  console.log('[EPUB Export] Response content-type:', contentType);
  
  if (!contentType.includes('application/epub') && !contentType.includes('application/zip')) {
    console.warn('[EPUB Export] Unexpected content type, reading response as text...');
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    console.log('[EPUB Export] Response text preview (first 500 chars):', text.substring(0, 500));
    
    // Check if it's the SvelteKit app shell (common error when proxy fails)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      const errorMsg = 'Server returned SvelteKit app shell instead of EPUB. Check AsciiDoctor server is running at /asciidoctor/ and proxy is configured correctly.';
      console.error('[EPUB Export]', errorMsg);
      throw new Error(errorMsg);
    }
    // Check if it's a JSON error response
    if (text.trim().startsWith('{')) {
      try {
        const error = JSON.parse(text);
        const errorMsg = error.error || error.message || 'Server returned error instead of EPUB';
        console.error('[EPUB Export] Server error response:', error);
        throw new Error(errorMsg);
      } catch (parseErr) {
        // Not valid JSON, continue with generic error
        console.error('[EPUB Export] Failed to parse error response as JSON:', parseErr);
      }
    }
    const errorMsg = `Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`;
    console.error('[EPUB Export]', errorMsg);
    throw new Error(errorMsg);
  }

  onProgress?.(75, 'Receiving EPUB file from server...');
  console.log('[EPUB Export] Starting to read response as blob...');
  
  // For large files, optimize the download process
  // Read as blob (binary) - this is necessary for validation
  // Add timeout for blob reading - longer for large files (2 minutes per MB, minimum 2 minutes)
  const estimatedSizeMB = contentSizeKB / 1024;
  const blobReadTimeoutMs = Math.max(2 * 60 * 1000, Math.ceil(estimatedSizeMB) * 2 * 60 * 1000);
  console.log('[EPUB Export] Estimated size:', Math.round(estimatedSizeMB * 100) / 100, 'MB, blob read timeout:', Math.round(blobReadTimeoutMs / 1000), 'seconds');
  
  const blobReadTimeout = setTimeout(() => {
    console.error('[EPUB Export] Blob read timeout after', blobReadTimeoutMs, 'ms - server may not have sent the file');
  }, blobReadTimeoutMs);
  
  let blob: Blob;
  try {
    // Check for abort before reading blob
    if (abortSignal?.aborted || combinedController.signal.aborted) {
      clearTimeout(blobReadTimeout);
      throw new Error('Download cancelled');
    }
    
    blob = await response.blob();
    clearTimeout(blobReadTimeout);
    
    // Check for abort after reading blob
    if (abortSignal?.aborted || combinedController.signal.aborted) {
      throw new Error('Download cancelled');
    }
  } catch (err) {
    clearTimeout(blobReadTimeout);
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('cancelled'))) {
      throw new Error('Download cancelled');
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EPUB Export] Error reading blob:', errorMessage);
    throw new Error(`Failed to read EPUB file from server: ${errorMessage}`);
  }
  
  if (!blob || blob.size === 0) {
    console.error('[EPUB Export] Server returned empty blob');
    throw new Error('Server returned empty EPUB file');
  }
  
  console.log('[EPUB Export] Received blob:', blob.size, 'bytes');
  onProgress?.(85, 'Validating EPUB file...');
  
  // Verify it's actually a ZIP file (EPUB is a ZIP archive)
  // Check ZIP magic bytes (first 4 bytes should be "PK\x03\x04")
  // Only check magic bytes for validation, don't read the entire file
  const arrayBuffer = await blob.slice(0, 4).arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const magicBytes = String.fromCharCode(...uint8Array);
  if (magicBytes !== 'PK\x03\x04') {
    console.error('[EPUB Export] Invalid EPUB file - not a ZIP archive. Magic bytes:', magicBytes);
    // Not a ZIP file, try to read as text to get error message
    // For large files, only read a portion to avoid memory issues
    const text = blob.size > 10000 
      ? await blob.slice(0, 10000).text() 
      : await blob.text();
    
    console.log('[EPUB Export] Attempting to parse error response from blob (first 500 chars):', text.substring(0, 500));
    
    // Check for fatal server error: "Could not locate Gemfile or .bundle/ directory"
    if (text.includes('Could not locate Gemfile') || text.includes('.bundle/ directory')) {
      const fatalError = 'FATAL: AsciiDoctor server is in a broken state and needs to be restarted.\n\n' +
        'The server is repeatedly reporting "Could not locate Gemfile or .bundle/ directory" errors.\n\n' +
        'Please restart the AsciiDoctor server container:\n' +
        '  docker restart asciidoctor\n\n' +
        'Or if using docker-compose:\n' +
        '  docker-compose restart asciidoctor';
      console.error('[EPUB Export]', fatalError);
      throw new Error(fatalError);
    }
    
    // Check for revdate parsing error (caused by CSS block placement issue)
    if (text.includes('failed to parse revdate') || text.includes('no time information')) {
      const errorMsg = 'AsciiDoc parsing error: revdate attribute parsing failed. This may be caused by document structure issues.\n\n' +
        'The server reported: "failed to parse revdate: no time information".\n\n' +
        'This error has been logged for debugging.';
      console.error('[EPUB Export]', errorMsg);
      console.error('[EPUB Export] Server error text:', text.substring(0, 1000));
    }
    
    // Check for stylesheet file not found error
    if (text.includes('epub3.css') || text.includes('epub-classic.css') || text.includes('No such file or directory') && text.includes('.css')) {
      const errorMsg = 'Stylesheet file not found on server. The server tried to load a CSS file that doesn\'t exist.\n\n' +
        'This is a non-fatal error - the server should retry without the custom stylesheet.\n\n' +
        'If EPUB generation fails, check server logs for details.';
      console.warn('[EPUB Export]', errorMsg);
      console.warn('[EPUB Export] Server error text:', text.substring(0, 1000));
    }
    
    try {
      const error = JSON.parse(text);
      const errorMsg = error.error || error.message || 'Server returned invalid EPUB (not a ZIP file)';
      console.error('[EPUB Export] Server conversion error:', error);
      
      // Build detailed error message
      let detailedError = errorMsg;
      if (error.hint) {
        detailedError += `\n\nHint: ${error.hint}`;
      }
      if (error.line) {
        detailedError += `\n\nError detected at line ${error.line}`;
      }
      if (error.stack) {
        console.error('[EPUB Export] Server error stack:', error.stack);
      }
      
      throw new Error(detailedError);
    } catch (parseErr) {
      // Not JSON, check if it's an HTML error page or plain text error
      if (text.includes('<html>') || text.includes('<!DOCTYPE')) {
        // Extract text from HTML if possible
        const textMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyText = textMatch ? textMatch[1].replace(/<[^>]+>/g, ' ').trim() : text.substring(0, 200);
        throw new Error(`Server returned HTML error page instead of EPUB:\n\n${bodyText}`);
      }
      // Plain text error
      const errorText = text.length > 500 ? text.substring(0, 500) + '...' : text;
      throw new Error(`Server returned invalid EPUB file (not a valid ZIP archive). Server response:\n\n${errorText}`);
    }
  }
  
  onProgress?.(95, 'EPUB file ready');
  console.log('[EPUB Export] Successfully generated EPUB file, ready for download');
  return blob;
}

/**
 * Download a blob as a file
 * Optimized for large files by using requestIdleCallback when available
 * Includes timeout fallback to retry download if it doesn't start
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (!blob || blob.size === 0) {
    console.error('[Download] Attempted to download empty blob');
    throw new Error('Cannot download empty file');
  }
  
  console.log('[Download] Starting download:', filename, 'Size:', blob.size, 'bytes');
  
  let downloadTriggered = false;
  
  const triggerDownload = (attempt: number = 1): void => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // Trigger download
      a.click();
      downloadTriggered = true;
      
      console.log(`[Download] Download triggered (attempt ${attempt}):`, filename);
      
      // Clean up after a delay
      setTimeout(() => {
        try {
          if (document.body.contains(a)) {
            document.body.removeChild(a);
          }
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[Download] Error during cleanup:', e);
        }
      }, attempt === 1 ? 100 : 500);
    } catch (error) {
      console.error(`[Download] Error triggering download (attempt ${attempt}):`, error);
      downloadTriggered = false;
    }
  };
  
  // For large files, use a more efficient approach
  const isLargeFile = blob.size > 10 * 1024 * 1024; // > 10MB
  
  if (isLargeFile) {
    // Use requestIdleCallback if available to avoid blocking the UI
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => triggerDownload(1), { timeout: 1000 });
    } else {
      // Fallback: use setTimeout with minimal delay
      setTimeout(() => triggerDownload(1), 0);
    }
  } else {
    // For smaller files, trigger immediately
    triggerDownload(1);
  }
  
  // Set up timeout fallback: if download doesn't start within 15 seconds, retry
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!downloadTriggered) {
        console.warn('[Download] Download did not start within 15 seconds, retrying...');
        // Retry with a more aggressive approach
        triggerDownload(2);
        
        // Give it another 5 seconds, then resolve anyway (download may have started)
        setTimeout(() => {
          console.log('[Download] Download retry completed');
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    }, 15000);
    
    // Check if download was triggered quickly
    const checkInterval = setInterval(() => {
      if (downloadTriggered) {
        clearTimeout(timeoutId);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    
    // Also resolve after a reasonable time even if we can't detect it
    setTimeout(() => {
      clearTimeout(timeoutId);
      clearInterval(checkInterval);
      resolve();
    }, 20000);
  });
}

/**
 * openInViewer removed - all files are now downloaded directly
 * This function is kept for backwards compatibility but just downloads the file
 */
export async function openInViewer(
  blob: Blob, 
  filename: string, 
  format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc' | 'json' | 'jsonl',
  validationMessages?: { errors?: string[]; warnings?: string[] }
): Promise<void> {
  // All files are downloaded instead of viewed (viewer removed)
  await downloadBlob(blob, filename);
}


/**
 * Convert AsciiDoc content to PDF
 */
export async function exportToPDF(
  options: ExportOptions,
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
  const url = `${baseUrl}convert/pdf`;
  
  // Verify we have AsciiDoc content
  if (!options.content || options.content.trim().length === 0) {
    throw new Error('Cannot export to PDF: AsciiDoc content is empty');
  }
  
  console.log('[PDF Export] Sending request to:', url);
  console.log('[PDF Export] Content length:', options.content.length);
  console.log('[PDF Export] Title:', options.title);
  
  onProgress?.(45, 'Sending request to server...');
  let response: Response;
  
  // Create a timeout controller - longer timeout for large PDFs
  // Base timeout: 10 minutes, add 1 minute per 100KB of content (minimum 10 minutes)
  const contentSizeKB = options.content.length / 1024;
  const timeoutMs = Math.max(10 * 60 * 1000, 10 * 60 * 1000 + Math.ceil(contentSizeKB / 100) * 60 * 1000);
  console.log('[PDF Export] Content size:', Math.round(contentSizeKB), 'KB, timeout:', Math.round(timeoutMs / 1000), 'seconds');
  
  const timeoutController = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  
  // Set up timeout
  timeoutId = setTimeout(() => {
    console.error('[PDF Export] Request timeout after', timeoutMs, 'ms - aborting fetch');
    timeoutController.abort();
  }, timeoutMs);
  
  // Combine abort signals: if user cancels OR timeout occurs, abort the fetch
  const combinedController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      if (timeoutId) clearTimeout(timeoutId);
      combinedController.abort();
    });
  }
  timeoutController.signal.addEventListener('abort', () => {
    combinedController.abort();
  });
  
  try {
    console.log('[PDF Export] Starting fetch request...');
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: options.content,
        title: options.title,
        author: options.author || '',
      }),
      signal: combinedController.signal,
    });
    
    response = await fetchPromise;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    console.log('[PDF Export] Fetch completed, status:', response.status, response.statusText);
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      if (timeoutController.signal.aborted) {
        const timeoutMinutes = Math.round(timeoutMs / 60000);
        throw new Error(`PDF generation timed out after ${timeoutMinutes} minutes. The server took too long to respond. Please try again or check server logs.`);
      }
      if (abortSignal?.aborted) {
        throw new Error('Download cancelled');
      }
      throw new Error('Request was aborted');
    }
    const errorMessage = err instanceof Error ? err.message : 'Network error';
    console.error('[PDF Export] Network error:', errorMessage);
    throw new Error(`Failed to connect to PDF conversion server: ${errorMessage}. Make sure the AsciiDoctor server is running.`);
  }

  onProgress?.(60, 'Waiting for server response...');
  console.log('[PDF Export] Response received, checking status...');

  if (!response.ok) {
    console.error('[PDF Export] Server returned error status:', response.status, response.statusText);
    
    let errorMessage = `PDF conversion failed: ${response.status} ${response.statusText}`;
    let errorDetails: any = null;
    
    try {
      const contentType = response.headers.get('content-type') || '';
      console.log('[PDF Export] Error response content-type:', contentType);
      
      if (contentType.includes('application/json')) {
        errorDetails = await response.json();
        console.error('[PDF Export] Server error (JSON):', errorDetails);
        
        errorMessage = errorDetails.error || errorDetails.message || errorMessage;
        if (errorDetails.hint) {
          errorMessage += `\n\nHint: ${errorDetails.hint}`;
        }
        if (errorDetails.line) {
          errorMessage += `\n\nError detected at line ${errorDetails.line}`;
        }
      } else {
        // Try to read as text even if not JSON
        const text = await response.text();
        console.log('[PDF Export] Error response text (first 500 chars):', text.substring(0, 500));
        
        // Check for fatal server error: "Could not locate Gemfile or .bundle/ directory"
        if (text.includes('Could not locate Gemfile') || text.includes('.bundle/ directory')) {
          const fatalError = 'FATAL: AsciiDoctor server is in a broken state and needs to be restarted.\n\n' +
            'The server is repeatedly reporting "Could not locate Gemfile or .bundle/ directory" errors.\n\n' +
            'Please restart the AsciiDoctor server container:\n' +
            '  docker restart asciidoctor\n\n' +
            'Or if using docker-compose:\n' +
            '  docker-compose restart asciidoctor';
          console.error('[PDF Export]', fatalError);
          throw new Error(fatalError);
        }
        
        if (text) {
          // Try to parse as JSON in case content-type is wrong
          try {
            errorDetails = JSON.parse(text);
            console.error('[PDF Export] Server error (parsed as JSON):', errorDetails);
            
            errorMessage = errorDetails.error || errorDetails.message || errorMessage;
            if (errorDetails.hint) {
              errorMessage += `\n\nHint: ${errorDetails.hint}`;
            }
            if (errorDetails.line) {
              errorMessage += `\n\nError detected at line ${errorDetails.line}`;
            }
          } catch {
            // Not JSON, use text as error message (limit length)
            const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;
            errorMessage = `${errorMessage}\n\nServer response:\n${preview}`;
          }
        }
      }
    } catch (err) {
      // Re-throw fatal errors
      if (err instanceof Error && err.message.includes('FATAL:')) {
        throw err;
      }
      console.error('[PDF Export] Failed to read error response:', err);
      // Use default error message
    }
    
    console.error('[PDF Export] Conversion error summary:', {
      status: response.status,
      statusText: response.statusText,
      url,
      errorMessage,
      errorDetails
    });
    
    // Log the full error details to console for debugging
    if (errorDetails) {
      console.error('[PDF Export] Full error details:', JSON.stringify(errorDetails, null, 2));
    }
    
    throw new Error(errorMessage);
  }

  // Verify we got a PDF response
  const contentType = response.headers.get('content-type') || '';
  console.log('[PDF Export] Response content-type:', contentType);
  
  if (!contentType.includes('application/pdf')) {
    console.warn('[PDF Export] Unexpected content type, reading response as text...');
    const text = await response.text();
    console.log('[PDF Export] Response text preview (first 500 chars):', text.substring(0, 500));
    
    // Check for fatal server error: "Could not locate Gemfile or .bundle/ directory"
    if (text.includes('Could not locate Gemfile') || text.includes('.bundle/ directory')) {
      const fatalError = 'FATAL: AsciiDoctor server is in a broken state and needs to be restarted.\n\n' +
        'The server is repeatedly reporting "Could not locate Gemfile or .bundle/ directory" errors.\n\n' +
        'Please restart the AsciiDoctor server container:\n' +
        '  docker restart asciidoctor\n\n' +
        'Or if using docker-compose:\n' +
        '  docker-compose restart asciidoctor';
      console.error('[PDF Export]', fatalError);
      throw new Error(fatalError);
    }
    
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      const errorMsg = 'Server returned SvelteKit app shell instead of PDF. Check AsciiDoctor server is running at /asciidoctor/ and proxy is configured correctly.';
      console.error('[PDF Export]', errorMsg);
      throw new Error(errorMsg);
    }
    if (text.trim().startsWith('{')) {
      try {
        const error = JSON.parse(text);
        const errorMsg = error.error || error.message || 'Server returned error instead of PDF';
        console.error('[PDF Export] Server error response:', error);
        throw new Error(errorMsg);
      } catch (parseErr) {
        // Not valid JSON, continue with generic error
        console.error('[PDF Export] Failed to parse error response as JSON:', parseErr);
      }
    }
    const errorMsg = `Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`;
    console.error('[PDF Export]', errorMsg);
    throw new Error(errorMsg);
  }

  onProgress?.(75, 'Receiving PDF file from server...');
  console.log('[PDF Export] Starting to read response as blob...');
  
  // For large files, optimize the download process
  // Read as blob (binary) - this is necessary for validation
  // Add timeout for blob reading - longer for large files (2 minutes per MB, minimum 2 minutes)
  const estimatedSizeMB = contentSizeKB / 1024;
  const blobReadTimeoutMs = Math.max(2 * 60 * 1000, Math.ceil(estimatedSizeMB) * 2 * 60 * 1000);
  console.log('[PDF Export] Estimated size:', Math.round(estimatedSizeMB * 100) / 100, 'MB, blob read timeout:', Math.round(blobReadTimeoutMs / 1000), 'seconds');
  
  const blobReadTimeout = setTimeout(() => {
    console.error('[PDF Export] Blob read timeout after', blobReadTimeoutMs, 'ms - server may not have sent the file');
  }, blobReadTimeoutMs);
  
  let blob: Blob;
  try {
    // Check for abort before reading blob
    if (abortSignal?.aborted || combinedController.signal.aborted) {
      clearTimeout(blobReadTimeout);
      throw new Error('Download cancelled');
    }
    
    blob = await response.blob();
    clearTimeout(blobReadTimeout);
    
    // Check for abort after reading blob
    if (abortSignal?.aborted || combinedController.signal.aborted) {
      throw new Error('Download cancelled');
    }
  } catch (err) {
    clearTimeout(blobReadTimeout);
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('cancelled'))) {
      throw new Error('Download cancelled');
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PDF Export] Error reading blob:', errorMessage);
    throw new Error(`Failed to read PDF file from server: ${errorMessage}`);
  }
  
  if (!blob || blob.size === 0) {
    console.error('[PDF Export] Server returned empty blob');
    throw new Error('Server returned empty PDF file');
  }
  
  console.log('[PDF Export] Received blob:', blob.size, 'bytes');
  onProgress?.(95, 'PDF file ready');
  console.log('[PDF Export] Successfully generated PDF file, ready for download');
  return blob;
}

/**
 * Check if the AsciiDoctor server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
    const url = `${baseUrl}healthz`;
    const response = await fetch(url, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

