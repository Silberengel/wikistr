/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate PDF and EPUB files
 */

// Use relative path if not set (works with Apache proxy), otherwise use full URL
const ASCIIDOCTOR_SERVER_URL = import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL || 
  (typeof window !== 'undefined' ? '/asciidoctor' : 'http://localhost:8091');

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
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to generate PDF: ${response.statusText}`);
  }

  return await response.blob();
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
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to generate EPUB: ${response.statusText}`);
  }

  return await response.blob();
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

