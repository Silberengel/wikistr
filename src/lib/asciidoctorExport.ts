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
  theme?: string;
  themeFiles?: Record<string, string>; // filename -> content mapping for custom theme files
}

/**
 * Convert AsciiDoc content to PDF
 */
export async function exportToPDF(options: ExportOptions): Promise<Blob> {
  // Normalize baseUrl - remove trailing slash, then add it back to ensure clean URL construction
  const normalizedBase = ASCIIDOCTOR_SERVER_URL.replace(/\/+$/, '');
  const baseUrl = `${normalizedBase}/`;
  const url = `${baseUrl}convert/pdf`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: options.content,
      title: options.title,
      author: options.author || '',
      theme: options.theme,
      theme_files: options.themeFiles || {},
    }),
  });

  if (!response.ok) {
    // Try to read error message
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || error.message || `Failed to generate PDF: ${response.statusText}`);
    }
    throw new Error(`Failed to generate PDF: ${response.status} ${response.statusText}`);
  }

  // Verify we got a PDF response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    // Might be an error response, try to read as JSON or text
    const text = await response.text();
    // Check if it's the SvelteKit app shell (common error when proxy fails)
    if (text.includes('__sveltekit') || text.includes('sveltekit-preload-data')) {
      throw new Error('Server returned SvelteKit app shell instead of PDF. Check AsciiDoctor server is running at /asciidoctor/ and proxy is configured correctly.');
    }
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-PDF response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty PDF file');
  }
  
  return blob;
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
      theme: options.theme,
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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: options.content,
      title: options.title,
      author: options.author || '',
      theme: options.theme,
    }),
  });

  if (!response.ok) {
    // Try to read error message from response body
    let errorMessage = `Failed to generate EPUB: ${response.status} ${response.statusText}`;
    
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const error = await response.json();
        errorMessage = error.error || error.message || errorMessage;
      } else {
        // Try to read as text even if not JSON
        const text = await response.text();
        if (text) {
          // Try to parse as JSON in case content-type is wrong
          try {
            const error = JSON.parse(text);
            errorMessage = error.error || error.message || errorMessage;
          } catch {
            // Not JSON, use text as error message (limit length)
            const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
            errorMessage = `${errorMessage}\nServer response: ${preview}`;
          }
        }
      }
    } catch (err) {
      console.error('Failed to read error response:', err);
      // Use default error message
    }
    
    console.error('EPUB conversion failed:', {
      status: response.status,
      statusText: response.statusText,
      url,
      errorMessage
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
 * Open a file in the e-book viewer instead of downloading
 */
export async function openInViewer(
  blob: Blob, 
  filename: string, 
  format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc' | 'json' | 'jsonl',
  validationMessages?: { errors?: string[]; warnings?: string[] }
): Promise<void> {
  const { openViewer } = await import('./viewer');
  openViewer({ blob, filename, format, validationMessages });
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
      theme: options.theme,
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

