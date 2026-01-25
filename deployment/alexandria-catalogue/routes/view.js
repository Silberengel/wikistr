/**
 * View routes (HTML and EPUB viewers)
 */

import { parseRelayUrls, setCacheHeaders } from '../utils.js';
import { fetchBookEvent } from '../nostr.js';
import { buildBookEventHierarchy } from '../book.js';
import { combineBookEvents } from '../book.js';
import { generateHTML, generateEPUB } from '../files.js';
import { wrapHTMLWithNavigation, generateEPUBViewerHTML, generateErrorPage } from '../html.js';

/**
 * Handle view routes (/view and /view-epub)
 */
export async function handleView(req, res, url) {
  const naddr = url.searchParams.get('naddr');
  const relayInput = url.searchParams.get('relays') || '';
  const customRelays = parseRelayUrls(relayInput);
  const isEPUB = url.pathname === '/view-epub';
  
  if (!naddr) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Missing Parameter', 'Missing naddr parameter. Please provide a book naddr.', null, '/', relayInput));
    return;
  }

  try {
    console.log(`[${isEPUB ? 'EPUB' : 'HTML'} View] Request received for naddr: ${naddr}`);
    
    const indexEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
    console.log(`[${isEPUB ? 'EPUB' : 'HTML'} View] Found book event: ${indexEvent.id}`);

    const hierarchy = await buildBookEventHierarchy(indexEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
    console.log(`[${isEPUB ? 'EPUB' : 'HTML'} View] Built hierarchy with ${hierarchy.length} top-level nodes`);

    const { content, title, author, embeddedCoverImage } = await combineBookEvents(indexEvent, hierarchy);
    console.log(`[${isEPUB ? 'EPUB' : 'HTML'} View] Combined content: ${content.length} chars`);

    if (isEPUB) {
      const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
      const epubBlob = await generateEPUB(content, title, author, image);
      
      if (!epubBlob || !epubBlob.size) {
        throw new Error('Failed to generate EPUB: invalid blob returned');
      }
      
      console.log(`[EPUB Viewer] EPUB generated: ${epubBlob.size} bytes`);

      // Use buffer directly if available, otherwise get from arrayBuffer
      let buffer;
      if (epubBlob.buffer) {
        buffer = epubBlob.buffer;
      } else {
        const arrayBuffer = await epubBlob.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
      const base64 = buffer.toString('base64');
      
      if (!base64 || base64.length === 0) {
        throw new Error('Failed to encode EPUB to base64');
      }
      
      const epubDataUri = `data:application/epub+zip;base64,${base64}`;
      
      if (!epubDataUri || !epubDataUri.startsWith('data:')) {
        throw new Error('Failed to create EPUB data URI');
      }

      const viewerHTML = generateEPUBViewerHTML(title, author, epubDataUri, naddr);
      
      // Set cache headers for EPUB viewer (can cache for a few minutes)
      const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        ...setCacheHeaders(res, 'html', 300) // 5 minutes
      };
      res.writeHead(200, headers);
      res.end(viewerHTML);
    } else {
      const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
      // Use embedded cover image if available, otherwise use original image URL
      const coverImage = embeddedCoverImage || image;
      const htmlContent = await generateHTML(content, title, author, image);
      console.log(`[HTML View] HTML generated: ${htmlContent.length} chars`);

      const htmlWithNavigation = wrapHTMLWithNavigation(htmlContent, title, author, naddr, coverImage);
      
      // Set cache headers for HTML view (can cache for a few minutes)
      const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        ...setCacheHeaders(res, 'html', 300) // 5 minutes
      };
      res.writeHead(200, headers);
      res.end(htmlWithNavigation);
    }
    
    console.log(`[${isEPUB ? 'EPUB' : 'HTML'} View] View sent successfully`);
  } catch (error) {
    console.error(`[${isEPUB ? 'EPUB' : 'HTML'} View] Error:`, error);
    const errorMsg = error?.message || String(error);
    const errorDetails = error?.stack || null;
    const backUrl = relayInput ? `/?relays=${encodeURIComponent(relayInput)}` : '/';
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage(`${isEPUB ? 'EPUB' : 'HTML'} View Error`, errorMsg, errorDetails, backUrl, relayInput));
  }
}
