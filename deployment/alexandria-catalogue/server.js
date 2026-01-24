#!/usr/bin/env node

/**
 * Alexandria Catalogue
 * Simple HTTP server for browsing and downloading books (kind 30040) as EPUB files
 * Designed for e-paper readers that can't use websockets
 * 
 * Usage: node server.js [port]
 * Default port: 8092
 */

import http from 'http';
import { URL } from 'url';
import { PORT } from './config.js';
import { closePool } from './nostr.js';
import { handleRequest } from './routes/index.js';

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`[Alexandria Catalogue] Listening on port ${PORT}`);
  console.log(`[Alexandria Catalogue] Access at http://localhost:${PORT}`);
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
