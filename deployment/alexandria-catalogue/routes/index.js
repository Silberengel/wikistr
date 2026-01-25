/**
 * Main router - dispatches requests to appropriate route handlers
 */

import { URL } from 'url';
import { handleFavicon } from './favicon.js';
import { handleStatus, handleClearCache } from './status.js';
import { handleHome } from './home.js';
import { handleView } from './view.js';
import { handleDownload } from './download.js';
import { handleBooks } from './books.js';
import { handleConvert } from './convert.js';
import { handleArticlesList, handleArticleDetail } from './articles.js';
import { handleImageProxy } from './image-proxy.js';
import { handleHighlightsList } from './highlights.js';

/**
 * Main request handler
 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle POST requests for cache clearing
  if (req.method === 'POST' && url.pathname === '/clear-cache') {
    handleClearCache(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  // Route dispatch
  try {
    if (url.pathname === '/favicon_alex-catalogue.png' || url.pathname === '/favicon.ico') {
      handleFavicon(req, res);
    } else if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else if (url.pathname === '/status') {
      await handleStatus(req, res, url);
    } else if (url.pathname === '/' || url.pathname === '') {
      await handleHome(req, res, url);
    } else if (url.pathname === '/view' || url.pathname === '/view-epub') {
      await handleView(req, res, url);
    } else if (url.pathname === '/download' || url.pathname === '/download-epub' || url.pathname === '/download-pdf') {
      await handleDownload(req, res, url);
    } else if (url.pathname.startsWith('/convert/')) {
      await handleConvert(req, res, url);
    } else if (url.pathname === '/books') {
      await handleBooks(req, res, url);
    } else if (url.pathname.startsWith('/articles/') && url.pathname.split('/').filter(p => p).length === 3) {
      // Article detail: /articles/{pubkey}/{d-tag}
      await handleArticleDetail(req, res, url);
    } else if (url.pathname === '/articles' || url.pathname.startsWith('/articles?')) {
      // Articles list
      await handleArticlesList(req, res, url);
    } else if (url.pathname === '/highlights' || url.pathname.startsWith('/highlights?')) {
      // Highlights list
      await handleHighlightsList(req, res, url);
    } else if (url.pathname === '/image-proxy') {
      // Image proxy for compression
      await handleImageProxy(req, res, url);
    } else if (url.pathname.startsWith('/images/')) {
      // Handle image requests - return 404 gracefully (images should be absolute URLs or embedded)
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Image not found. Images should use absolute URLs (http:// or https://) or be embedded as data URIs.');
    } else {
      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (error) {
    console.error('[Router] Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
}
