/**
 * Shared export request handler
 * Consolidates common patterns for making export requests with timeout, error handling, and validation
 */

import {
  getAsciiDoctorServerUrl,
  isNetworkError,
  isSvelteKitShell,
  isValidContentType,
  buildConnectionErrorMessage,
  buildContentErrorMessage,
  extractErrorDetails,
  buildDetailedErrorMessage,
  createTimeoutController,
  calculateTimeout,
  calculateBlobReadTimeout,
  validateBlob,
  handleAbortError,
  validateEPUBBlob,
  checkServerHealth
} from './exportUtils';

export interface ExportOptions {
  content: string;
  title: string;
  author?: string;
}

export type ExportFormat = 'html5' | 'epub' | 'pdf';

/**
 * Make an export request with common error handling and timeout management
 */
export async function makeExportRequest(
  format: ExportFormat,
  options: ExportOptions,
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<Response> {
  const serverUrl = getAsciiDoctorServerUrl();
  const baseUrl = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
  const url = `${baseUrl}convert/${format}`;
  
  if (!options.content || options.content.trim().length === 0) {
    throw new Error(`Cannot export to ${format.toUpperCase()}: AsciiDoc content is empty`);
  }
  
  const formatName = format.toUpperCase();
  console.log(`[${formatName} Export] Sending request to:`, url);
  console.log(`[${formatName} Export] Content length:`, options.content.length);
  console.log(`[${formatName} Export] Title:`, options.title);
  
  onProgress?.(45, 'Sending request to server...');
  
  // Calculate timeout based on content size
  const contentSizeKB = options.content.length / 1024;
  const timeoutMs = calculateTimeout(contentSizeKB);
  console.log(`[${formatName} Export] Content size:`, Math.round(contentSizeKB), 'KB, timeout:', Math.round(timeoutMs / 1000), 'seconds');
  
  // Create timeout controller
  const { controller: combinedController, cleanup } = createTimeoutController(timeoutMs, abortSignal);
  
  let response: Response;
  try {
    console.log(`[${formatName} Export] Starting fetch request...`);
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: options.content,
        title: options.title,
        author: options.author || '',
      }),
      signal: combinedController.signal,
    });
    cleanup();
    console.log(`[${formatName} Export] Fetch completed, status:`, response.status, response.statusText);
  } catch (err) {
    cleanup();
    
    // Check for abort errors first
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      if (abortSignal?.aborted) {
        throw new Error('Download cancelled');
      }
      const timeoutMinutes = Math.round(timeoutMs / 60000);
      throw new Error(`${formatName} generation timed out after ${timeoutMinutes} minutes. The server took too long to respond. Please try again or check server logs.`);
    }
    
    // Network/connection error
    if (err instanceof Error && isNetworkError(err)) {
      const errorMsg = await buildConnectionErrorMessage(err, format);
      throw new Error(errorMsg);
    }
    
    const errorMessage = err instanceof Error ? err.message : 'Network error';
    console.error(`[${formatName} Export] Network error:`, errorMessage);
    throw new Error(`Failed to connect to ${formatName} conversion server: ${errorMessage}. Make sure the AsciiDoctor server is running.`);
  }
  
  onProgress?.(60, 'Waiting for server response...');
  console.log(`[${formatName} Export] Response received, checking status...`);
  
  return response;
}

/**
 * Handle non-OK response with detailed error extraction
 */
export async function handleErrorResponse(
  response: Response,
  format: ExportFormat,
  url: string
): Promise<never> {
  const formatName = format.toUpperCase();
  console.error(`[${formatName} Export] Server returned error status:`, response.status, response.statusText);
  
  try {
    const errorDetails = await extractErrorDetails(response);
    const baseError = errorDetails.error || `${formatName} conversion failed: ${response.status} ${response.statusText}`;
    const errorMsg = buildDetailedErrorMessage(baseError, errorDetails);
    
    // Log full error details for debugging
    if (errorDetails.stack) {
      console.error(`[${formatName} Export] Server error stack:`, errorDetails.stack);
    }
    console.error(`[${formatName} Export] Conversion error summary:`, {
      status: response.status,
      statusText: response.statusText,
      url,
      errorMessage: errorMsg,
      errorDetails
    });
    
    throw new Error(errorMsg);
  } catch (err) {
    // Re-throw fatal errors
    if (err instanceof Error && err.message.includes('FATAL:')) {
      throw err;
    }
    
    // If error extraction failed, create generic error message
    const serverHealthy = await checkServerHealth();
    if (!serverHealthy || (err instanceof Error && isNetworkError(err))) {
      const errorMsg = await buildConnectionErrorMessage(err, format);
      throw new Error(errorMsg);
    }
    
    const errorMsg = buildContentErrorMessage(err instanceof Error ? err : new Error(String(err)), format);
    throw new Error(errorMsg);
  }
}

/**
 * Validate response content type and check for SvelteKit shell
 */
export async function validateResponseContentType(
  response: Response,
  format: ExportFormat
): Promise<void> {
  const formatName = format.toUpperCase();
  const contentType = response.headers.get('content-type') || '';
  console.log(`[${formatName} Export] Response content-type:`, contentType);
  
  if (isValidContentType(contentType, format)) {
    return;
  }
  
  console.warn(`[${formatName} Export] Unexpected content type, reading response as text...`);
  const text = await response.text();
  console.log(`[${formatName} Export] Response text preview (first 500 chars):`, text.substring(0, 500));
  
  // Check for SvelteKit shell
  if (isSvelteKitShell(text)) {
    const serverHealthy = await checkServerHealth();
    const serverUrl = getAsciiDoctorServerUrl();
    let errorMsg = `Server returned SvelteKit app shell instead of ${formatName}.\n\n`;
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
      errorMsg += `The request is being handled by the SvelteKit app instead of the AsciiDoctor server.`;
      if (serverUrl.startsWith('/')) {
        errorMsg += '\n\nCheck your Apache/web server configuration:';
        errorMsg += '\nProxyPass /asciidoctor/ http://127.0.0.1:8091/';
      }
    }
    
    throw new Error(errorMsg);
  }
  
  // Try to parse as JSON error
  if (text.trim().startsWith('{')) {
    try {
      const error = JSON.parse(text);
      const errorMsg = error.error || error.message || `Server returned error instead of ${formatName}`;
      throw new Error(errorMsg);
    } catch (parseErr) {
      // Not valid JSON, continue with generic error
    }
  }
  
  throw new Error(`Server returned unexpected content type: ${contentType}. Response preview: ${text.substring(0, 200)}`);
}

/**
 * Read blob from response with timeout and validation
 */
export async function readExportBlob(
  response: Response,
  format: ExportFormat,
  contentSizeKB: number,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const formatName = format.toUpperCase();
  console.log(`[${formatName} Export] Starting to read response as blob...`);
  
  const estimatedSizeMB = contentSizeKB / 1024;
  const blobReadTimeoutMs = calculateBlobReadTimeout(estimatedSizeMB);
  console.log(`[${formatName} Export] Estimated size:`, Math.round(estimatedSizeMB * 100) / 100, 'MB, blob read timeout:', Math.round(blobReadTimeoutMs / 1000), 'seconds');
  
  const blobReadTimeout = setTimeout(() => {
    console.error(`[${formatName} Export] Blob read timeout after`, blobReadTimeoutMs, 'ms - server may not have sent the file');
  }, blobReadTimeoutMs);
  
  let blob: Blob;
  try {
    if (abortSignal?.aborted) {
      clearTimeout(blobReadTimeout);
      throw new Error('Download cancelled');
    }
    
    blob = await response.blob();
    clearTimeout(blobReadTimeout);
    
    if (abortSignal?.aborted) {
      throw new Error('Download cancelled');
    }
  } catch (err) {
    clearTimeout(blobReadTimeout);
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('cancelled'))) {
      throw new Error('Download cancelled');
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[${formatName} Export] Error reading blob:`, errorMessage);
    throw new Error(`Failed to read ${formatName} file from server: ${errorMessage}`);
  }
  
  validateBlob(blob, formatName);
  console.log(`[${formatName} Export] Received blob:`, blob.size, 'bytes');
  
  return blob;
}

