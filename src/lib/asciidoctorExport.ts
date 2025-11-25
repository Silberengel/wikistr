/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate PDF and EPUB files
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
 * Convert AsciiDoc content to PDF
 * With retry logic and better error handling
 */
export async function exportToPDF(options: ExportOptions): Promise<Blob> {
  // Normalize baseUrl - ensure it ends with exactly one slash
  const normalizedBase = ASCIIDOCTOR_SERVER_URL.replace(/\/+$/, '');
  const baseUrl = `${normalizedBase}/`;
  const url = `${baseUrl}convert/pdf`;
  
  console.log('[PDF Export] Request URL:', url);
  console.log('[PDF Export] Content length:', options.content.length);
  console.log('[PDF Export] Title:', options.title);
  
  // Retry logic - try up to 3 times
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[PDF Export] Retry attempt ${attempt}/3`);
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: options.content,
          title: options.title,
          author: options.author || '',
        }),
      });

      console.log('[PDF Export] Response status:', response.status);
      console.log('[PDF Export] Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        // Try to read error message
        let errorMessage = `Failed to generate PDF: ${response.status} ${response.statusText}`;
        const contentType = response.headers.get('content-type') || '';
        
        try {
          if (contentType.includes('application/json')) {
            const error = await response.json().catch(() => null);
            if (error) {
              errorMessage = error.error || error.message || errorMessage;
              if (error.hint) {
                errorMessage += `\n\nHint: ${error.hint}`;
              }
              if (error.line) {
                errorMessage += `\n\nError detected at line ${error.line}`;
              }
            }
          } else {
            // Try to read as text even if not JSON
            const text = await response.text();
            if (text) {
              // Check if it's the SvelteKit app shell
              if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data') || text.includes('_app/immutable')) {
                errorMessage = `Server returned SvelteKit app shell instead of PDF (attempt ${attempt}/3). This usually means:\n1. AsciiDoctor server is not running on port 8091\n2. Apache proxy is not configured correctly\n3. The /asciidoctor/ path is being rewritten to index.html\n\nCheck: docker ps | grep asciidoctor\nCheck: Apache proxy config for /asciidoctor/\nURL attempted: ${url}`;
              } else {
                // Try to parse as JSON in case content-type is wrong
                try {
                  const error = JSON.parse(text);
                  errorMessage = error.error || error.message || errorMessage;
                  if (error.hint) {
                    errorMessage += `\n\nHint: ${error.hint}`;
                  }
                  if (error.line) {
                    errorMessage += `\n\nError detected at line ${error.line}`;
                  }
                } catch {
                  // Not JSON, use text as error message (limit length)
                  const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
                  errorMessage = `${errorMessage}\n\nServer response: ${preview}`;
                }
              }
            }
          }
        } catch (err) {
          // If we can't read the error response, use the default message
          console.error('[PDF Export] Failed to read error response:', err);
        }
        
        lastError = new Error(errorMessage);
        
        // Don't retry on 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw lastError;
        }
        
        // Retry on 5xx errors or network errors
        if (attempt < 3) {
          continue;
        } else {
          throw lastError;
        }
      }

      // Verify we got a PDF response
      const contentType = response.headers.get('content-type') || '';
      console.log('[PDF Export] Content-Type:', contentType);
      
      if (!contentType.includes('application/pdf')) {
        // Might be an error response, try to read as JSON or text
        const text = await response.text();
        console.error('[PDF Export] Non-PDF response received:', text.substring(0, 500));
        
        // Check if it's the SvelteKit app shell (common error when proxy fails)
        if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data') || text.includes('_app/immutable')) {
          const errorMsg = `Server returned SvelteKit app shell instead of PDF (attempt ${attempt}/3). The /asciidoctor/ proxy is not working.\n\nURL attempted: ${url}\n\nCheck:\n1. AsciiDoctor server is running: docker ps | grep asciidoctor\n2. Apache proxy config has: ProxyPass /asciidoctor http://...\n3. The proxy path is excluded from rewrite rules`;
          lastError = new Error(errorMsg);
          if (attempt < 3) {
            continue;
          } else {
            throw lastError;
          }
        }
        try {
          const error = JSON.parse(text);
          throw new Error(error.error || error.message || 'Server returned non-PDF response');
        } catch {
          throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
        }
      }

      const blob = await response.blob();
      console.log('[PDF Export] Blob size:', blob.size, 'bytes');
      
      if (!blob || blob.size === 0) {
        lastError = new Error('Server returned empty PDF file');
        if (attempt < 3) {
          continue;
        } else {
          throw lastError;
        }
      }
      
      // Validate it's actually a PDF (check for PDF magic bytes)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer.slice(0, 4));
      const pdfMagic = String.fromCharCode(...uint8Array);
      if (pdfMagic !== '%PDF') {
        console.error('[PDF Export] Invalid PDF magic bytes:', pdfMagic);
        lastError = new Error('Server returned invalid PDF file (missing PDF magic bytes). The file may be corrupted or not a PDF.');
        if (attempt < 3) {
          continue;
        } else {
          throw lastError;
        }
      }
      
      console.log('[PDF Export] Successfully generated PDF');
      return blob;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[PDF Export] Attempt ${attempt} failed:`, lastError.message);
      
      // If this is the last attempt, throw the error
      if (attempt === 3) {
        throw lastError;
      }
      // Otherwise, continue to retry
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('PDF generation failed after 3 attempts');
}

/**
 * Convert AsciiDoc content to HTML5
 */
export async function exportToHTML5(options: ExportOptions): Promise<Blob> {
  const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
  const url = `${baseUrl}convert/html5`;
  
  // Verify we have AsciiDoc content
  if (!options.content || options.content.trim().length === 0) {
    throw new Error('Cannot export to HTML5: AsciiDoc content is empty');
  }
  
  console.log('AsciiDoctor Export: Sending request to', url);
  console.log('AsciiDoctor Export: Content preview (first 200 chars):', options.content.substring(0, 200));
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: options.content, // AsciiDoc content
      title: options.title,
      author: options.author || '',
    }),
  });

  if (!response.ok) {
    // Try to read error message
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || error.message || `Failed to generate HTML5: ${response.statusText}`);
    }
    throw new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
  }

  // Verify we got an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      throw new Error('Server returned SvelteKit app shell instead of HTML. Check AsciiDoctor server configuration and proxy settings.');
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
  const blobText = await blob.text();
  
  // Check if it's the SvelteKit app shell (common error when proxy fails)
  if (blobText.includes('__sveltekit') || blobText.includes('sveltekit-preload-data') || blobText.includes('_app/immutable')) {
    console.error('AsciiDoctor Export: Received SvelteKit app shell instead of HTML');
    console.error('AsciiDoctor Export: URL was:', url);
    console.error('AsciiDoctor Export: Response preview:', blobText.substring(0, 500));
    throw new Error('Server returned SvelteKit app shell instead of HTML. The AsciiDoctor server may not be running, or the proxy at /asciidoctor/ is not configured correctly. Check: 1) AsciiDoctor server is running on port 8091, 2) Apache proxy is configured: ProxyPass /asciidoctor/ http://127.0.0.1:8091/');
  }
  
  // Verify it's actually HTML from AsciiDoctor (should contain asciidoc classes or structure)
  if (!blobText.includes('<html') && !blobText.includes('<!DOCTYPE') && !blobText.includes('<!doctype')) {
    console.error('AsciiDoctor Export: Response does not appear to be HTML');
    console.error('AsciiDoctor Export: Response preview:', blobText.substring(0, 500));
    throw new Error('Server returned invalid HTML. Response preview: ' + blobText.substring(0, 200));
  }
  
  // Return a new blob with the verified content
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
export async function exportToEPUB(options: ExportOptions): Promise<Blob> {
  // Normalize baseUrl - remove trailing slash, then add it back to ensure clean URL construction
  const normalizedBase = ASCIIDOCTOR_SERVER_URL.replace(/\/+$/, '');
  const baseUrl = `${normalizedBase}/`;
  const url = `${baseUrl}convert/epub`;
  
  console.log('[EPUB Export] Sending request to:', url);
  console.log('[EPUB Export] Content length:', options.content.length);
  console.log('[EPUB Export] Title:', options.title);
  
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
      content: options.content,
      title: options.title,
      author: options.author || '',
    }),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Network error';
    console.error('[EPUB Export] Network error:', errorMessage);
    throw new Error(`Failed to connect to EPUB conversion server: ${errorMessage}. Make sure the AsciiDoctor server is running.`);
  }

  if (!response.ok) {
    // Try to read error message from response body
    let errorMessage = `EPUB conversion failed: ${response.status} ${response.statusText}`;
    let errorDetails: any = null;
    
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        errorDetails = await response.json();
        errorMessage = errorDetails.error || errorDetails.message || errorMessage;
        
        // Add hint if available
        if (errorDetails.hint) {
          errorMessage += `\n\nHint: ${errorDetails.hint}`;
        }
        
        // Add line number if available
        if (errorDetails.line) {
          errorMessage += `\n\nError detected at line ${errorDetails.line}`;
        }
      } else {
        // Try to read as text even if not JSON
        const text = await response.text();
        if (text) {
          // Try to parse as JSON in case content-type is wrong
          try {
            errorDetails = JSON.parse(text);
            errorMessage = errorDetails.error || errorDetails.message || errorMessage;
            if (errorDetails.hint) {
              errorMessage += `\n\nHint: ${errorDetails.hint}`;
            }
          } catch {
            // Not JSON, use text as error message (limit length)
            const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
            errorMessage = `${errorMessage}\n\nServer response: ${preview}`;
          }
        }
      }
    } catch (err) {
      console.error('[EPUB Export] Failed to read error response:', err);
      // Use default error message
    }
    
    console.error('[EPUB Export] Conversion failed:', {
      status: response.status,
      statusText: response.statusText,
      url,
      errorMessage,
      errorDetails
    });
    
    throw new Error(errorMessage);
  }

  // Verify we got an EPUB response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/epub') && !contentType.includes('application/zip')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error when proxy fails)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      throw new Error('Server returned SvelteKit app shell instead of EPUB. Check AsciiDoctor server is running at /asciidoctor/ and proxy is configured correctly.');
    }
    // Check if it's a JSON error response
    if (text.trim().startsWith('{')) {
      try {
        const error = JSON.parse(text);
        throw new Error(error.error || error.message || 'Server returned error instead of EPUB');
      } catch {
        // Not valid JSON, continue with generic error
      }
    }
    throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
  }

  // Read as blob (binary)
  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
  }
  
  console.log('[EPUB Export] Received blob:', blob.size, 'bytes');
  
  // Verify it's actually a ZIP file (EPUB is a ZIP archive)
  // Check ZIP magic bytes (first 4 bytes should be "PK\x03\x04")
  const arrayBuffer = await blob.slice(0, 4).arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const magicBytes = String.fromCharCode(...uint8Array);
  if (magicBytes !== 'PK\x03\x04') {
    // Not a ZIP file, try to read as text to get error message
    const text = await blob.text();
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned invalid EPUB (not a ZIP file)');
    } catch {
      throw new Error('Server returned invalid EPUB file (not a valid ZIP archive). File may be corrupted or an error response.');
    }
  }
  
  console.log('[EPUB Export] Successfully generated EPUB file');
  return blob;
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * openInViewer removed - all files are now downloaded directly
 * This function is kept for backwards compatibility but just downloads the file
 */
export async function openInViewer(
  blob: Blob, 
  filename: string, 
  format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc' | 'json' | 'jsonl',
  validationMessages?: { errors?: string[]; warnings?: string[] },
  originalLaTeXBlob?: Blob
): Promise<void> {
  // All files are downloaded instead of viewed (viewer removed)
  downloadBlob(blob, filename);
}

/**
 * Convert AsciiDoc content to LaTeX
 */
export async function exportToLaTeX(options: ExportOptions): Promise<Blob> {
  const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
  const url = `${baseUrl}convert/latex`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: options.content,
      title: options.title,
      author: options.author || '',
    }),
  });

  if (!response.ok) {
    // Try to read error message
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || error.message || `Failed to generate LaTeX: ${response.statusText}`);
    }
    throw new Error(`Failed to generate LaTeX: ${response.status} ${response.statusText}`);
  }

  // Verify we got a LaTeX response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/x-latex') && !contentType.includes('text/plain')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error when proxy fails)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      throw new Error('Server returned SvelteKit app shell instead of LaTeX. Check AsciiDoctor server is running at /asciidoctor/ and proxy is configured correctly.');
    }
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-LaTeX response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty LaTeX file');
  }
  
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

