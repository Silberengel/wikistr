#!/usr/bin/env node

/**
 * Alexandria Catalogue
 * Simple HTTP server for browsing and downloading books (kind 30040) as EPUB files
 * Designed for e-paper readers that can't use websockets
 * OPTIMIZED for fast e-reader performance
 * 
 * Usage: node server.js [port]
 * Default port: 8092
 */

import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import { PORT, ASCIIDOCTOR_SERVER_URL } from './config.js';
import { closePool } from './nostr.js';
import { handleRequest } from './routes/index.js';
import { warmAllCaches } from './cache-warming.js';

// Optimized request handler with compression and keep-alive
// REFACTORED: Simplified compression logic, only buffer when needed
async function optimizedHandleRequest(req, res) {
  // Set keep-alive for connection reuse
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=65, max=100');
  
  // Check if compression is supported
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const useGzip = acceptEncoding.includes('gzip');
  
  // Only buffer if compression is needed
  let responseBuffer = null;
  let headersWritten = false;
  let contentType = '';
  
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  const originalSetHeader = res.setHeader.bind(res);
  
  // Override setHeader to capture content type early
  res.setHeader = function(name, value) {
    if (name.toLowerCase() === 'content-type') {
      contentType = value;
    }
    return originalSetHeader.call(this, name, value);
  };
  
  // Override writeHead
  res.writeHead = function(statusCode, statusMessage, headers) {
    if (headersWritten) return originalWriteHead.call(this, statusCode, statusMessage, headers);
    headersWritten = true;
    
    const finalHeaders = headers || {};
    const finalContentType = finalHeaders['Content-Type'] || contentType || '';
    
    // Apply compression for text content
    if (useGzip && statusCode === 200 && (
      finalContentType.includes('text/html') || 
      finalContentType.includes('text/css') || 
      finalContentType.includes('application/json') ||
      finalContentType.includes('text/javascript') ||
      finalContentType.includes('text/plain')
    )) {
      finalHeaders['Content-Encoding'] = 'gzip';
      finalHeaders['Vary'] = 'Accept-Encoding';
    }
    
    return originalWriteHead.call(this, statusCode, statusMessage, finalHeaders);
  };
  
  // Override write to buffer if compression needed
  res.write = function(chunk, encoding) {
    if (!headersWritten && useGzip) {
      if (!responseBuffer) responseBuffer = [];
      responseBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
      return true;
    }
    return originalWrite.call(this, chunk, encoding);
  };
  
  // Override end to compress and send
  res.end = function(chunk, encoding) {
    if (chunk && !headersWritten && useGzip) {
      if (!responseBuffer) responseBuffer = [];
      responseBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
    }
    
    if (responseBuffer && responseBuffer.length > 0 && !headersWritten) {
      const finalContentType = contentType || res.getHeader('Content-Type') || 'text/html; charset=utf-8';
      const shouldCompress = useGzip && (
        finalContentType.includes('text/') || finalContentType.includes('application/json')
      );
      
      const allData = Buffer.concat(responseBuffer);
      let finalData = allData;
      
      if (shouldCompress) {
        finalData = zlib.gzipSync(allData, { level: 6 });
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
      }
      
      res.setHeader('Content-Length', finalData.length);
      if (!headersWritten) {
        res.writeHead(res.statusCode || 200, { 'Content-Type': finalContentType });
      }
      originalWrite(finalData);
      originalEnd();
    } else {
      originalEnd(chunk, encoding);
    }
  };
  
  // Call original handler
  await handleRequest(req, res);
}

// Create and start server with optimizations
const server = http.createServer(optimizedHandleRequest);

// Optimize server settings for performance
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds
server.maxHeadersCount = 2000;
server.timeout = 120000; // 2 minutes

server.listen(PORT, () => {
  console.log(`[Alexandria Catalogue] Listening on port ${PORT}`);
  console.log(`[Alexandria Catalogue] Access at http://localhost:${PORT}`);
  console.log(`[Alexandria Catalogue] AsciiDoctor server URL: ${ASCIIDOCTOR_SERVER_URL}`);
  console.log(`[Alexandria Catalogue] Environment ASCIIDOCTOR_SERVER_URL: ${process.env.ASCIIDOCTOR_SERVER_URL || 'not set'}`);
  
  // OPTIMIZED: Start initial cache warming in background (non-blocking)
  // This pre-fetches popular data so first user gets fast responses
  console.log('[Alexandria Catalogue] Starting initial cache warming...');
  warmAllCaches().catch(err => {
    console.error('[Alexandria Catalogue] Initial cache warming failed:', err);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  closePool();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  closePool();
  server.close(() => {
    process.exit(0);
  });
});
