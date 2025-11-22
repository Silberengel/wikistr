/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate PDF and EPUB files
 */

// Use relative path if not set (works with Apache proxy), otherwise use full URL
// In test environment, always use absolute URL
const getAsciiDoctorServerUrl = () => {
  if (import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL) {
    return import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL;
  }
  // In test environment (vitest), use absolute URL
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return 'http://localhost:8091';
  }
  // In browser, use relative path (works with Apache proxy)
  if (typeof window !== 'undefined') {
    return '/asciidoctor';
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
 */
export async function exportToPDF(options: ExportOptions): Promise<Blob> {
  const response = await fetch(`${ASCIIDOCTOR_SERVER_URL}/convert/pdf`, {
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
      throw new Error(error.error || error.message || `Failed to generate PDF: ${response.statusText}`);
    }
    throw new Error(`Failed to generate PDF: ${response.status} ${response.statusText}`);
  }

  // Verify we got a PDF response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    // Might be an error response, try to read as JSON
    const text = await response.text();
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-PDF response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}`);
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
  const response = await fetch(`${ASCIIDOCTOR_SERVER_URL}/convert/html5`, {
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
      throw new Error(error.error || error.message || `Failed to generate HTML5: ${response.statusText}`);
    }
    throw new Error(`Failed to generate HTML5: ${response.status} ${response.statusText}`);
  }

  // Verify we got an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Might be an error response, try to read as JSON
    const text = await response.text();
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-HTML response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  return blob;
}

/**
 * Convert AsciiDoc content to Reveal.js presentation
 */
export async function exportToRevealJS(options: ExportOptions): Promise<Blob> {
  const response = await fetch(`${ASCIIDOCTOR_SERVER_URL}/convert/revealjs`, {
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
      throw new Error(error.error || error.message || `Failed to generate Reveal.js: ${response.statusText}`);
    }
    throw new Error(`Failed to generate Reveal.js: ${response.status} ${response.statusText}`);
  }

  // Verify we got an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Might be an error response, try to read as JSON
    const text = await response.text();
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-HTML response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  return blob;
}

/**
 * Convert AsciiDoc content to EPUB
 */
export async function exportToEPUB(options: ExportOptions): Promise<Blob> {
  const response = await fetch(`${ASCIIDOCTOR_SERVER_URL}/convert/epub`, {
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
      throw new Error(error.error || error.message || `Failed to generate EPUB: ${response.statusText}`);
    }
    throw new Error(`Failed to generate EPUB: ${response.status} ${response.statusText}`);
  }

  // Verify we got an EPUB response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/epub') && !contentType.includes('application/zip')) {
    // Might be an error response, try to read as JSON
    const text = await response.text();
    try {
      const error = JSON.parse(text);
      throw new Error(error.error || error.message || 'Server returned non-EPUB response');
    } catch {
      throw new Error(`Server returned unexpected content type: ${contentType}`);
    }
  }

  const blob = await response.blob();
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
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
 * Check if the AsciiDoctor server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${ASCIIDOCTOR_SERVER_URL}/healthz`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

