/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate EPUB, HTML5, and LaTeX files
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
 * Get a user-friendly error message for HTML5 export failures
 * Checks server health and provides specific guidance
 */
async function getHTML5ErrorMessage(error: unknown, url: string): Promise<string> {
  const isNetworkError = error instanceof TypeError && error.message.includes('fetch');
  const isConnectionError = error instanceof Error && (
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError') ||
    error.message.includes('Network request failed')
  );
  
  // Check if server is reachable
  const serverHealthy = await checkServerHealth();
  const serverUrl = ASCIIDOCTOR_SERVER_URL;
  
  if (isNetworkError || isConnectionError || !serverHealthy) {
    // Server is not running or not reachable
    let errorMsg = 'Failed to connect to AsciiDoctor server.\n\n';
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += `Status: ${serverHealthy ? 'Reachable but error occurred' : 'Not reachable'}\n\n`;
    
    if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
      errorMsg += 'The AsciiDoctor server appears to be running on localhost (port 8091).\n';
      errorMsg += 'Please check:\n';
      errorMsg += '1. The server is running: `docker ps` or check the process\n';
      errorMsg += '2. The server is accessible at http://localhost:8091\n';
      errorMsg += '3. There are no firewall or network issues blocking the connection\n';
    } else if (serverUrl.startsWith('/')) {
      errorMsg += 'The AsciiDoctor server is configured to use a proxy path.\n';
      errorMsg += 'Please check:\n';
      errorMsg += '1. The server is running on port 8091\n';
      errorMsg += '2. The Apache/web server proxy is configured correctly\n';
      errorMsg += '3. The proxy path /asciidoctor/ is working\n';
    } else {
      errorMsg += `The server is configured at: ${serverUrl}\n`;
      errorMsg += 'Please verify the server is running and accessible at this address.\n';
    }
    
    return errorMsg;
  } else {
    // Server is reachable, so this is likely a content/syntax error
    const originalError = error instanceof Error ? error.message : String(error);
    let errorMsg = `HTML5 generation failed: ${originalError}\n\n`;
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += 'The AsciiDoctor server is running, but encountered an error processing your content.\n\n';
    errorMsg += 'This is likely due to:\n';
    errorMsg += '1. AsciiDoc syntax errors in the content\n';
    errorMsg += '2. Invalid or malformed AsciiDoc markup\n';
    errorMsg += '3. Server-side processing error\n\n';
    errorMsg += 'Please check the AsciiDoc syntax and try again.';
    
    return errorMsg;
  }
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
  
  let response: Response;
  try {
    response = await fetch(url, {
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
  } catch (error) {
    // Network/connection error - check server health and provide helpful message
    const errorMsg = await getHTML5ErrorMessage(error, url);
    throw new Error(errorMsg);
  }

  if (!response.ok) {
    // Try to read error message
    const contentType = response.headers.get('content-type') || '';
    let serverError: Error | null = null;
    
    try {
      if (contentType.includes('application/json')) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        serverError = new Error(error.error || error.message || `Failed to generate HTML5: ${response.statusText}`);
      } else {
        serverError = new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
      }
    } catch {
      serverError = new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
    }
    
    // Get user-friendly error message
    const errorMsg = await getHTML5ErrorMessage(serverError, url);
    throw new Error(errorMsg);
  }

  // Verify we got an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      const serverHealthy = await checkServerHealth();
      const serverUrl = ASCIIDOCTOR_SERVER_URL;
      let errorMsg = 'Server returned SvelteKit app shell instead of HTML.\n\n';
      errorMsg += `Server URL: ${serverUrl}\n`;
      errorMsg += `Server health check: ${serverHealthy ? 'Reachable' : 'Not reachable'}\n\n`;
      
      if (!serverHealthy) {
        errorMsg += 'The AsciiDoctor server is not reachable. ';
        if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
          errorMsg += 'Please check if the server is running on port 8091.';
        } else if (serverUrl.startsWith('/')) {
          errorMsg += 'Please check if the proxy configuration is correct.';
        }
      } else {
        errorMsg += 'The server is reachable, but the proxy may not be configured correctly. ';
        errorMsg += 'The request is being handled by the SvelteKit app instead of the AsciiDoctor server.';
      }
      
      throw new Error(errorMsg);
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
    
    const serverHealthy = await checkServerHealth();
    const serverUrl = ASCIIDOCTOR_SERVER_URL;
    let errorMsg = 'Server returned SvelteKit app shell instead of HTML.\n\n';
    errorMsg += `Server URL: ${serverUrl}\n`;
    errorMsg += `Server health check: ${serverHealthy ? 'Reachable' : 'Not reachable'}\n\n`;
    
    if (!serverHealthy) {
      errorMsg += 'The AsciiDoctor server is not reachable. ';
      if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
        errorMsg += 'Please check if the server is running on port 8091.';
      } else if (serverUrl.startsWith('/')) {
        errorMsg += 'Please check if the proxy configuration is correct.';
      }
    } else {
      errorMsg += 'The server is reachable, but the proxy may not be configured correctly. ';
      errorMsg += 'The request is being handled by the SvelteKit app instead of the AsciiDoctor server.';
      if (serverUrl.startsWith('/')) {
        errorMsg += '\n\nCheck your Apache/web server configuration:';
        errorMsg += '\nProxyPass /asciidoctor/ http://127.0.0.1:8091/';
      }
    }
    
    throw new Error(errorMsg);
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
  validationMessages?: { errors?: string[]; warnings?: string[] }
): Promise<void> {
  // All files are downloaded instead of viewed (viewer removed)
  downloadBlob(blob, filename);
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

