/**
 * Convert route handler - accepts content and converts via AsciiDoctor server
 */

import { generateFile } from '../files.js';

/**
 * Handle convert routes - POST /convert/{format}
 */
export async function handleConvert(req, res, url) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    return;
  }

  // Parse format from pathname: /convert/epub, /convert/pdf, /convert/html5
  const pathParts = url.pathname.split('/').filter(p => p);
  if (pathParts.length !== 2 || pathParts[0] !== 'convert') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid path. Use /convert/{format} where format is epub, pdf, or html5' }));
    return;
  }

  const format = pathParts[1];
  const supportedFormats = ['epub', 'epub3', 'pdf', 'html5', 'docbook5', 'mobi', 'azw3'];
  
  if (!supportedFormats.includes(format.toLowerCase())) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unsupported format: ${format}. Supported: ${supportedFormats.join(', ')}` }));
    return;
  }

  try {
    // Read request body
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
    }

    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body is required' }));
      return;
    }

    const requestData = JSON.parse(body);
    const { content, title, author, image } = requestData;

    if (!content) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Content field is required' }));
      return;
    }

    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Title field is required' }));
      return;
    }

    console.log(`[Convert] Request received: format=${format}, contentLength=${content.length}, title=${title}`);

    // Map 'epub' to 'epub3' for generateFile compatibility
    let formatForGeneration = format.toLowerCase();
    if (formatForGeneration === 'epub') {
      formatForGeneration = 'epub3';
    }

    // Generate file using alexandria-catalogue's file generation (which calls asciidoctor)
    const { blob, mimeType, extension } = await generateFile(
      content,
      title,
      author || '',
      formatForGeneration,
      image || ''
    );

    // Convert blob to buffer
    let buffer;
    if (format.toLowerCase() === 'html5') {
      const htmlText = await blob.text();
      buffer = Buffer.from(htmlText, 'utf-8');
    } else {
      const arrayBuffer = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    // Set response headers
    const filename = `${(title || 'document').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.${extension}`;
    const headers = {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length
    };

    res.writeHead(200, headers);
    res.end(buffer);

    console.log(`[Convert] ${format} sent successfully: ${buffer.length} bytes`);
  } catch (error) {
    console.error('[Convert] Error:', error);
    const errorMsg = error?.message || String(error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: errorMsg }));
  }
}
