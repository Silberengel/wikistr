/**
 * Image proxy route - downloads, compresses, and serves images
 * Optimized for e-paper readers and low bandwidth
 */

import { compressImage } from '../book.js';
import { getCache, setCached, getCached, CACHE_TTL } from '../cache.js';
import { escapeHtml, setCacheHeaders } from '../utils.js';
import crypto from 'crypto';

/**
 * Generate cache key for image URL
 */
function getImageCacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * Download image from URL
 */
async function downloadImage(url) {
  // Use Node.js built-in https/http modules for better compatibility
  const https = await import('https');
  const http = await import('http');
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('Download timeout'));
    }, 10000); // 10 second timeout
    
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Alexandria-Catalogue/1.0'
      }
    }, (res) => {
      clearTimeout(timeout);
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || 'image/jpeg';
        resolve({ buffer, contentType });
      });
      res.on('error', reject);
    });
    
    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Handle image proxy requests
 * URL format: /image-proxy?url=https://example.com/image.jpg
 */
export async function handleImageProxy(req, res, url) {
  try {
    const imageUrl = url.searchParams.get('url');
    
    if (!imageUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return;
    }
    
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid URL');
      return;
    }
    
    // Check cache
    const cacheKey = `image_${getImageCacheKey(imageUrl)}`;
    const cached = getCached(cacheKey, CACHE_TTL.GENERATED_FILES); // Cache for 1 hour
    
    let buffer, contentType;
    
    if (cached) {
      console.log(`[Image Proxy] Cache hit for: ${imageUrl.substring(0, 50)}...`);
      buffer = cached.buffer;
      contentType = cached.contentType;
    } else {
      console.log(`[Image Proxy] Downloading and compressing: ${imageUrl.substring(0, 50)}...`);
      
      // Download image
      const { buffer: originalBuffer, contentType: originalContentType } = await downloadImage(imageUrl);
      
      // Compress image
      contentType = originalContentType;
      buffer = await compressImage(originalBuffer, contentType);
      
      // Cache the compressed image
      setCached(cacheKey, { buffer, contentType });
      console.log(`[Image Proxy] Cached compressed image: ${buffer.length} bytes`);
    }
    
    // Set response headers
    const headers = {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      ...setCacheHeaders(res, 'image', 3600) // Cache for 1 hour
    };
    
    res.writeHead(200, headers);
    res.end(buffer);
  } catch (error) {
    console.error('[Image Proxy] Error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error processing image: ${escapeHtml(error.message)}`);
  }
}
