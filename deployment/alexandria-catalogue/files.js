/**
 * File generation using AsciiDoctor server
 */

import { ASCIIDOCTOR_SERVER_URL } from './config.js';

/**
 * Generate file in specified format using AsciiDoctor server
 */
export async function generateFile(content, title, author, format, image) {
  // Handle AsciiDoc separately
  if (format.toLowerCase() === 'asciidoc' || format.toLowerCase() === 'adoc') {
    return {
      blob: new Blob([content], { type: 'text/asciidoc' }),
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
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
    }

    // For Kindle formats, check if response is actually a blob
    const blob = await response.blob();
    
    // Verify blob is not empty and has correct type
    if (blob.size === 0) {
      throw new Error(`AsciiDoctor server returned empty ${format} file. The conversion may have failed.`);
    }
    
    // Check if blob type matches expected mime type (or is application/octet-stream which is acceptable)
    const blobType = blob.type;
    if (blobType && blobType !== 'application/octet-stream' && blobType !== formatInfo.mimeType) {
      console.warn(`[File Generation] Blob type (${blobType}) doesn't match expected (${formatInfo.mimeType}), but proceeding anyway`);
    }
    
    return { blob, mimeType: formatInfo.mimeType, extension: formatInfo.extension };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs / 1000} seconds. ${format} conversion may take longer for large books.`);
    }
    throw error;
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const html = await response.text();
  return html;
}
