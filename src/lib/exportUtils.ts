/**
 * Shared utilities for export functionality
 * Consolidates common patterns for error handling, request handling, and validation
 */

const ASCIIDOCTOR_SERVER_URL = (() => {
  if (import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL) {
    const url = import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL;
    if (url.startsWith('/') && !url.endsWith('/')) {
      return url + '/';
    }
    return url;
  }
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return 'http://localhost:8092';
  }
  if (typeof window !== 'undefined') {
    // Use alexandria-catalogue proxy path - it proxies to asciidoctor
    return '/alexandria-catalogue/';
  }
  return 'http://localhost:8092';
})();

export const getAsciiDoctorServerUrl = () => ASCIIDOCTOR_SERVER_URL;

/**
 * Check if error is a network/connection error
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Failed to fetch') ||
         error.message.includes('NetworkError') ||
         error.message.includes('Network request failed') ||
         (error instanceof TypeError && error.message.includes('fetch'));
}

/**
 * Check if response is SvelteKit app shell (proxy error indicator)
 */
export function isSvelteKitShell(text: string): boolean {
  return text.includes('__sveltekit') || 
         text.includes('sveltekit-preload-data') || 
         text.includes('_app/immutable');
}

/**
 * Check if error indicates fatal server state
 */
export function isFatalServerError(text: string): boolean {
  return text.includes('Could not locate Gemfile') || 
         text.includes('.bundle/ directory');
}

/**
 * Get fatal server error message
 */
export function getFatalServerErrorMessage(): string {
  return 'FATAL: Alexandria Catalogue server is in a broken state and needs to be restarted.\n\n' +
         'The server is repeatedly reporting errors.\n\n' +
         'Please restart the Alexandria Catalogue server container:\n' +
         '  docker restart alexandria-catalogue\n\n' +
         'Or if using docker-compose:\n' +
         '  docker-compose restart alexandria-catalogue';
}

/**
 * Check if the Alexandria Catalogue server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const baseUrl = ASCIIDOCTOR_SERVER_URL.endsWith('/') ? ASCIIDOCTOR_SERVER_URL : `${ASCIIDOCTOR_SERVER_URL}/`;
    const url = `${baseUrl}healthz`;
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Build connection error message with server health check
 */
export async function buildConnectionErrorMessage(
  error: unknown,
  format: 'html5' | 'epub' | 'pdf'
): Promise<string> {
  const serverHealthy = await checkServerHealth();
  const serverUrl = ASCIIDOCTOR_SERVER_URL;
  
  let errorMsg = `Failed to connect to Alexandria Catalogue server.\n\n`;
  errorMsg += `Server URL: ${serverUrl}\n`;
  errorMsg += `Status: ${serverHealthy ? 'Reachable but error occurred' : 'Not reachable'}\n\n`;
  
  if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
    errorMsg += 'The Alexandria Catalogue server appears to be running on localhost (port 8092).\n';
    errorMsg += 'Please check:\n';
    errorMsg += '1. The server is running: `docker ps` or check the process\n';
    errorMsg += '2. The server is accessible at http://localhost:8092\n';
    errorMsg += '3. There are no firewall or network issues blocking the connection\n';
  } else if (serverUrl.startsWith('/')) {
    errorMsg += 'The Alexandria Catalogue server is configured to use a proxy path.\n';
    errorMsg += 'Please check:\n';
    errorMsg += '1. The server is running on port 8092\n';
    errorMsg += '2. The Apache/web server proxy is configured correctly\n';
    errorMsg += '3. The proxy path /alexandria-catalogue/ is working\n';
  } else {
    errorMsg += `The server is configured at: ${serverUrl}\n`;
    errorMsg += 'Please verify the server is running and accessible at this address.\n';
  }
  
  return errorMsg;
}

/**
 * Build content/syntax error message
 */
export function buildContentErrorMessage(
  error: unknown,
  format: 'html5' | 'epub' | 'pdf'
): string {
  const originalError = error instanceof Error ? error.message : String(error);
  const formatName = format.toUpperCase();
  const serverUrl = ASCIIDOCTOR_SERVER_URL;
  
  let errorMsg = `${formatName} generation failed: ${originalError}\n\n`;
  errorMsg += `Server URL: ${serverUrl}\n`;
  errorMsg += 'The Alexandria Catalogue server is running, but encountered an error processing your content.\n\n';
  errorMsg += 'This is likely due to:\n';
  errorMsg += '1. AsciiDoc syntax errors in the content\n';
  errorMsg += '2. Invalid or malformed AsciiDoc markup\n';
  errorMsg += '3. Server-side processing error\n\n';
  errorMsg += 'Please check the AsciiDoc syntax and try again.';
  
  return errorMsg;
}

/**
 * Extract error details from response
 */
export async function extractErrorDetails(response: Response): Promise<{
  error: string;
  hint?: string;
  line?: number;
  stack?: string;
}> {
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
    try {
      const errorData = await response.json();
      return {
        error: errorData.error || errorData.message || `Failed: ${response.statusText}`,
        hint: errorData.hint,
        line: errorData.line,
        stack: errorData.stack
      };
    } catch {
      // Fall through to text parsing
    }
  }
  
  const text = await response.text();
  
  // Check for fatal errors
  if (isFatalServerError(text)) {
    throw new Error(getFatalServerErrorMessage());
  }
  
  // Try to parse as JSON
  if (text.trim().startsWith('{')) {
    try {
      const errorData = JSON.parse(text);
      return {
        error: errorData.error || errorData.message || `Failed: ${response.statusText}`,
        hint: errorData.hint,
        line: errorData.line,
        stack: errorData.stack
      };
    } catch {
      // Not valid JSON
    }
  }
  
  return {
    error: text.length > 500 ? text.substring(0, 500) + '...' : text || response.statusText
  };
}

/**
 * Build detailed error message from error details
 */
export function buildDetailedErrorMessage(
  baseError: string,
  details?: { hint?: string; line?: number }
): string {
  let errorMsg = baseError;
  if (details?.hint) {
    errorMsg += `\n\nHint: ${details.hint}`;
  }
  if (details?.line) {
    errorMsg += `\n\nError detected at line ${details.line}`;
  }
  return errorMsg;
}

/**
 * Create timeout controller with combined abort signals
 */
export function createTimeoutController(
  timeoutMs: number,
  userAbortSignal?: AbortSignal
): {
  controller: AbortController;
  cleanup: () => void;
} {
  const timeoutController = new AbortController();
  const combinedController = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  
  timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);
  
  if (userAbortSignal) {
    userAbortSignal.addEventListener('abort', () => {
      if (timeoutId) clearTimeout(timeoutId);
      combinedController.abort();
    });
  }
  
  timeoutController.signal.addEventListener('abort', () => {
    combinedController.abort();
  });
  
  return {
    controller: combinedController,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };
}

/**
 * Calculate timeout based on content size
 */
export function calculateTimeout(contentSizeKB: number): number {
  // Base timeout: 10 minutes, add 1 minute per 100KB of content (minimum 10 minutes)
  return Math.max(10 * 60 * 1000, 10 * 60 * 1000 + Math.ceil(contentSizeKB / 100) * 60 * 1000);
}

/**
 * Calculate blob read timeout based on estimated file size
 */
export function calculateBlobReadTimeout(estimatedSizeMB: number): number {
  // 2 minutes per MB, minimum 2 minutes
  return Math.max(2 * 60 * 1000, Math.ceil(estimatedSizeMB) * 2 * 60 * 1000);
}

/**
 * Validate blob is not empty
 */
export function validateBlob(blob: Blob | null, format: string): void {
  if (!blob || blob.size === 0) {
    throw new Error(`Server returned empty ${format} file`);
  }
}

/**
 * Validate EPUB blob (check ZIP magic bytes)
 */
export async function validateEPUBBlob(blob: Blob): Promise<void> {
  const arrayBuffer = await blob.slice(0, 4).arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const magicBytes = String.fromCharCode(...uint8Array);
  
  if (magicBytes !== 'PK\x03\x04') {
    // Not a ZIP file, try to read error message
    const text = blob.size > 10000 
      ? await blob.slice(0, 10000).text() 
      : await blob.text();
    
    if (isFatalServerError(text)) {
      throw new Error(getFatalServerErrorMessage());
    }
    
    // Try to parse as JSON error
    try {
      const error = JSON.parse(text);
      throw new Error(buildDetailedErrorMessage(
        error.error || error.message || 'Server returned invalid EPUB (not a ZIP file)',
        { hint: error.hint, line: error.line }
      ));
    } catch (parseErr) {
      // Not JSON, check if HTML error page
      if (text.includes('<html>') || text.includes('<!DOCTYPE')) {
        const textMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyText = textMatch ? textMatch[1].replace(/<[^>]+>/g, ' ').trim() : text.substring(0, 200);
        throw new Error(`Server returned HTML error page instead of EPUB:\n\n${bodyText}`);
      }
      const errorText = text.length > 500 ? text.substring(0, 500) + '...' : text;
      throw new Error(`Server returned invalid EPUB file (not a valid ZIP archive). Server response:\n\n${errorText}`);
    }
  }
}

/**
 * Check if response content type is valid for format
 */
export function isValidContentType(contentType: string, format: 'html5' | 'epub' | 'pdf'): boolean {
  switch (format) {
    case 'html5':
      return contentType.includes('text/html');
    case 'epub':
      return contentType.includes('application/epub') || contentType.includes('application/zip');
    case 'pdf':
      return contentType.includes('application/pdf');
    default:
      return false;
  }
}

/**
 * Handle abort errors with appropriate messages
 */
export function handleAbortError(
  error: unknown,
  timeoutMs: number,
  userAbortSignal?: AbortSignal
): never {
  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
    // Check if it was a timeout or user cancellation
    if (userAbortSignal?.aborted) {
      throw new Error('Download cancelled');
    }
    const timeoutMinutes = Math.round(timeoutMs / 60000);
    throw new Error(`Generation timed out after ${timeoutMinutes} minutes. The server took too long to respond. Please try again or check server logs.`);
  }
  throw error;
}

