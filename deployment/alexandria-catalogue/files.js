/**
 * File generation using AsciiDoctor server
 */

import { ASCIIDOCTOR_SERVER_URL } from './config.js';
import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Make HTTP request using Node.js http/https modules
 */
async function makeHttpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = httpModule.request(requestOptions, (res) => {
      const chunks = [];
      
      // Handle response errors early
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // Still read the response body for error details
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const errorText = buffer.toString('utf-8');
          const error = new Error(`HTTP ${res.statusCode}: ${res.statusMessage}${errorText ? ' - ' + errorText.substring(0, 200) : ''}`);
          error.statusCode = res.statusCode;
          reject(error);
        });
        return;
      }
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: true,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          arrayBuffer: async () => {
            // Convert Buffer to ArrayBuffer
            const ab = new ArrayBuffer(buffer.length);
            const view = new Uint8Array(ab);
            for (let i = 0; i < buffer.length; i++) {
              view[i] = buffer[i];
            }
            return ab;
          },
          buffer: buffer,
          text: async () => buffer.toString('utf-8')
        });
      });
    });
    
    req.on('error', (error) => {
      console.error(`[HTTP Request] Connection error to ${url}:`, error);
      reject(error);
    });
    
    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    }
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

/**
 * Generate file in specified format using AsciiDoctor server
 */
export async function generateFile(content, title, author, format, image) {
  // Handle AsciiDoc separately
  if (format.toLowerCase() === 'asciidoc' || format.toLowerCase() === 'adoc') {
    // Return a Buffer-like object for Node.js compatibility
    const buffer = Buffer.from(content, 'utf-8');
    return {
      blob: {
        size: buffer.length,
        arrayBuffer: async () => {
          // Convert Buffer to ArrayBuffer
          const ab = new ArrayBuffer(buffer.length);
          const view = new Uint8Array(ab);
          for (let i = 0; i < buffer.length; i++) {
            view[i] = buffer[i];
          }
          return ab;
        },
        buffer: buffer,
        text: async () => buffer.toString('utf-8')
      },
      mimeType: 'text/asciidoc',
      extension: 'adoc'
    };
  }

  const formatMap = {
    'epub3': { endpoint: 'epub', mimeType: 'application/epub+zip', extension: 'epub' },
    'pdf': { endpoint: 'pdf', mimeType: 'application/pdf', extension: 'pdf' },
    'html5': { endpoint: 'html5', mimeType: 'text/html', extension: 'html' },
    'docbook5': { endpoint: 'docbook5', mimeType: 'application/xml', extension: 'xml' },
    'mobi': { endpoint: 'mobi', mimeType: 'application/x-mobipocket-ebook', extension: 'mobi' },
    'azw3': { endpoint: 'azw3', mimeType: 'application/vnd.amazon.ebook', extension: 'azw3' }
  };

  const formatInfo = formatMap[format.toLowerCase()];
  if (!formatInfo) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/${formatInfo.endpoint}`;
  
  console.log(`[File Generation] Generating ${format} via ${url}`);
  console.log(`[File Generation] Content length: ${content.length} chars`);
  console.log(`[File Generation] AsciiDoctor server URL from config: ${ASCIIDOCTOR_SERVER_URL}`);

  const requestBody = {
    content,
    title,
    author: author || ''
  };
  
  if (image) {
    requestBody.image = image;
  }

  // AZW3 and MOBI conversions can take longer, so use a longer timeout
  const isKindleFormat = format.toLowerCase() === 'azw3' || format.toLowerCase() === 'mobi';
  const timeoutMs = isKindleFormat ? 120000 : 60000; // 2 minutes for Kindle formats, 1 minute for others
  
  try {
    console.log(`[File Generation] Making HTTP request to: ${url}`);
    const response = await makeHttpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      timeout: timeoutMs
    });
    
    console.log(`[File Generation] Received response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
    }

    // Get the buffer from response
    const buffer = response.buffer;
    
    // Verify buffer is not empty
    if (buffer.length === 0) {
      throw new Error(`AsciiDoctor server returned empty ${format} file. The conversion may have failed.`);
    }
    
    // Check content type from headers
    const contentType = response.headers['content-type'] || '';
    if (contentType && contentType !== 'application/octet-stream' && !contentType.includes(formatInfo.mimeType.split('/')[1])) {
      console.warn(`[File Generation] Content type (${contentType}) doesn't match expected (${formatInfo.mimeType}), but proceeding anyway`);
    }
    
    // Return a Blob-like object for compatibility
    return {
      blob: {
        size: buffer.length,
        arrayBuffer: async () => {
          // Convert Buffer to ArrayBuffer
          const ab = new ArrayBuffer(buffer.length);
          const view = new Uint8Array(ab);
          for (let i = 0; i < buffer.length; i++) {
            view[i] = buffer[i];
          }
          return ab;
        },
        buffer: buffer,
        text: async () => buffer.toString('utf-8')
      },
      mimeType: formatInfo.mimeType,
      extension: formatInfo.extension
    };
  } catch (error) {
    if (error.message === 'Request timeout') {
      throw new Error(`Request timeout after ${timeoutMs / 1000} seconds. ${format} conversion may take longer for large books.`);
    }
    // Improve error message for connection errors
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Failed to connect to AsciiDoctor server at ${url}. Connection refused. Please check: 1. The server is running (check with 'docker ps' or process list), 2. The server is listening on port 8091, 3. There are no firewall issues.`);
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error(`Failed to connect to AsciiDoctor server at ${url}. Host not found. Please check the server URL is correct.`);
    }
    if (error.code === 'ETIMEDOUT') {
      throw new Error(`Failed to connect to AsciiDoctor server at ${url}. Connection timeout. Please check: 1. The server is running, 2. The server is accessible, 3. There are no network issues.`);
    }
    // Re-throw with more context
    throw new Error(`AsciiDoctor server request failed: ${error.message} (code: ${error.code || 'unknown'})`);
  }
}

/**
 * Generate EPUB using AsciiDoctor server
 */
export async function generateEPUB(content, title, author, image = null) {
  const { blob } = await generateFile(content, title, author, 'epub3', image);
  return blob;
}

/**
 * Generate HTML using AsciiDoctor server
 */
export async function generateHTML(content, title, author, image = null) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/html5`;
  
  console.log(`[HTML View] Generating HTML via ${url}`);
  console.log(`[HTML View] Content length: ${content.length} chars`);

  const requestBody = {
    content,
    title,
    author: author || ''
  };
  
  if (image) {
    requestBody.image = image;
  }

  const response = await makeHttpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    timeout: 60000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const html = await response.text();
  return html;
}
