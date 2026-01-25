/**
 * Download route handler
 */

import { parseRelayUrls, setCacheHeaders } from '../utils.js';
import { fetchBookEvent } from '../nostr.js';
import { buildBookEventHierarchy, combineBookEvents, collectAllEventsFromHierarchy } from '../book.js';
import { generateFile } from '../files.js';
import { getCache, CACHE_TTL } from '../cache.js';
import { generateErrorPage, addResponsiveCSSToHTML } from '../html.js';
import { getBookTitle } from '../utils.js';

/**
 * Handle download routes
 */
export async function handleDownload(req, res, url) {
  const relayInput = url.searchParams.get('relays') || '';
  
  // Handle legacy redirects
  if (url.pathname === '/download-epub' || url.pathname === '/download-pdf') {
    const naddr = url.searchParams.get('naddr');
    if (naddr) {
      const format = url.pathname === '/download-epub' ? 'epub3' : 'pdf';
      const relayParam = relayInput ? `&relays=${encodeURIComponent(relayInput)}` : '';
      res.writeHead(302, { 'Location': `/download?naddr=${encodeURIComponent(naddr)}&format=${format}${relayParam}` });
      res.end();
      return;
    }
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Missing Parameter', 'Missing naddr parameter.', null, '/', relayInput));
    return;
  }

  const naddr = url.searchParams.get('naddr');
  const format = url.searchParams.get('format') || 'epub3';
  const customRelays = parseRelayUrls(relayInput);
  
  if (!naddr) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Missing Parameter', 'Missing naddr parameter. Please provide a book naddr.', null, '/', relayInput));
    return;
  }

  try {
    console.log(`[Download] Request received for naddr: ${naddr}, format: ${format}`);
    
    const indexEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
    console.log(`[Download] Found book event: ${indexEvent.id}`);

    const hierarchy = await buildBookEventHierarchy(indexEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
    console.log(`[Download] Built hierarchy with ${hierarchy.length} top-level nodes`);

    // Handle JSONL format separately
    if (format === 'jsonl') {
      const allEvents = collectAllEventsFromHierarchy(indexEvent, hierarchy);
      console.log(`[Download] Collected ${allEvents.length} events for JSONL`);
      
      const jsonlLines = allEvents.map(e => JSON.stringify(e));
      const jsonlContent = jsonlLines.join('\n');
      
      const title = getBookTitle(indexEvent);
      const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `${safeTitle}.jsonl`;
      const buffer = Buffer.from(jsonlContent, 'utf-8');
      
      // Set cache headers for JSONL downloads
      const headers = {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
        ...setCacheHeaders(res, 'download')
      };
      res.writeHead(200, headers);
      res.end(buffer);
      
      console.log(`[Download] JSONL sent successfully`);
      return;
    }

    // Combine into AsciiDoc
    const { content, title, author } = await combineBookEvents(indexEvent, hierarchy);
    console.log(`[Download] Combined content: ${content.length} chars`);
    
    const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];

    // Handle AsciiDoc format separately
    if (format === 'asciidoc' || format === 'adoc') {
      const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `${safeTitle}.adoc`;
      const buffer = Buffer.from(content, 'utf-8');
      
      // Set cache headers for AsciiDoc downloads
      const headers = {
        'Content-Type': 'text/asciidoc',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
        ...setCacheHeaders(res, 'download')
      };
      res.writeHead(200, headers);
      res.end(buffer);
      
      console.log(`[Download] AsciiDoc sent successfully`);
      return;
    }

    // Check cache for generated file
    const cache = getCache();
    const cacheKey = `${naddr}:${format}`;
    let buffer, mimeType, extension;
    
    const cachedFile = cache.generatedFiles.get(cacheKey);
    if (cachedFile && (Date.now() - cachedFile.timestamp) < CACHE_TTL.GENERATED_FILES) {
      console.log(`[Download] Using cached ${format} file for: ${naddr}`);
      buffer = cachedFile.buffer;
      mimeType = cachedFile.mimeType;
      extension = cachedFile.extension;
    } else {
      console.log(`[Download] Generating ${format}...`);
      try {
        const { blob, mimeType: mt, extension: ext } = await generateFile(content, title, author, format, image);
        console.log(`[Download] ${format} generated: ${blob.size} bytes`);
        
        if (blob.size === 0) {
          throw new Error(`Generated ${format} file is empty. The conversion may have failed on the server.`);
        }

      // For HTML5 format, add responsive CSS to ensure media stays within viewport
      if (format.toLowerCase() === 'html5') {
        const htmlText = await blob.text();
        const htmlWithCSS = addResponsiveCSSToHTML(htmlText);
        buffer = Buffer.from(htmlWithCSS, 'utf-8');
      } else {
        // Use the buffer directly if available, otherwise get from arrayBuffer
        if (blob.buffer) {
          buffer = blob.buffer;
        } else {
          const arrayBuffer = await blob.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
        }
      }
        mimeType = mt;
        extension = ext;
        
        cache.generatedFiles.set(cacheKey, {
          buffer,
          mimeType,
          extension,
          timestamp: Date.now()
        });
        
        if (cache.generatedFiles.size > 50) {
          const firstKey = cache.generatedFiles.keys().next().value;
          cache.generatedFiles.delete(firstKey);
        }
      } catch (fileError) {
        // If it's a Kindle format and the error mentions reading the output file,
        // provide a more helpful error message
        if ((format.toLowerCase() === 'azw3' || format.toLowerCase() === 'mobi') && 
            fileError.message && fileError.message.includes('read output')) {
          throw new Error(`Failed to generate ${format.toUpperCase()} file. The AsciiDoctor server converted the file but couldn't read it back. This may be due to:\n- File size limits on the server\n- Server-side file permissions\n- Temporary server issues\n\nPlease try again, or use EPUB format instead (which can be converted to ${format.toUpperCase()} using Calibre).`);
        }
        throw fileError;
      }
    }

      const safeTitle = (title || 'book').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `${safeTitle}.${extension}`;

    // Set cache headers for downloads (cache for 1 hour)
    const headers = {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
      ...setCacheHeaders(res, 'download')
    };
    res.writeHead(200, headers);
    res.end(buffer);
    
    console.log(`[Download] ${format} sent successfully`);
  } catch (error) {
    console.error('[Download] Error:', error);
    const errorMsg = error?.message || String(error);
    const errorDetails = error?.stack || null;
    const backUrl = relayInput ? `/?relays=${encodeURIComponent(relayInput)}` : '/';
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Download Error', errorMsg, errorDetails, backUrl, relayInput));
  }
}
