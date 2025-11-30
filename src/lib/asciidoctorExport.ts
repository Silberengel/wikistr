/**
 * AsciiDoctor export utilities
 * Connects to the AsciiDoctor server to generate EPUB, HTML5, and PDF files
 * Refactored to use shared utilities for reduced redundancy
 */

import {
  makeExportRequest,
  handleErrorResponse,
  validateResponseContentType,
  readExportBlob,
  type ExportOptions as BaseExportOptions,
  type ExportFormat
} from './exportRequestHandler';
import { validateEPUBBlob, checkServerHealth, validateBlob, isSvelteKitShell } from './exportUtils';
import { processHTML } from './htmlPostProcessing';
import { getAsciiDoctorServerUrl } from './exportUtils';

// Re-export interface for backward compatibility
export interface ExportOptions extends BaseExportOptions {}

/**
 * Convert AsciiDoc content to HTML5
 */
export async function exportToHTML5(options: ExportOptions, abortSignal?: AbortSignal): Promise<Blob> {
  const format: ExportFormat = 'html5';
  
  console.log('[HTML5 Export] Sending request');
  console.log('[HTML5 Export] Content preview (first 200 chars):', options.content.substring(0, 200));
  
  // Make export request using shared handler
  let response: Response;
  try {
    response = await makeExportRequest(format, options, abortSignal);
  } catch (error) {
    // Error handling is done in makeExportRequest
    throw error;
  }
  
  // Handle non-OK responses
  if (!response.ok) {
    const url = `${getAsciiDoctorServerUrl()}convert/html5`;
    await handleErrorResponse(response, format, url);
    throw new Error('Should not reach here'); // handleErrorResponse always throws
  }
  
  // Validate content type
  await validateResponseContentType(response, format);
  
  // Read blob
  const contentSizeKB = options.content.length / 1024;
  let blob = await readExportBlob(response, format, contentSizeKB, abortSignal);
  
  // Post-process HTML: convert wikilinks, style images, inject CSS
  let blobText = await blob.text();
  
  // Check if it's the SvelteKit app shell (double-check after reading blob)
  if (isSvelteKitShell(blobText)) {
    console.error('[HTML5 Export] Received SvelteKit app shell instead of HTML');
    const serverHealthy = await checkServerHealth();
    const serverUrl = getAsciiDoctorServerUrl();
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
  
  // Verify it's actually HTML from AsciiDoctor
  if (!blobText.includes('<html') && !blobText.includes('<!DOCTYPE') && !blobText.includes('<!doctype')) {
    console.error('[HTML5 Export] Response does not appear to be HTML');
    console.error('[HTML5 Export] Response preview:', blobText.substring(0, 500));
    throw new Error('Server returned invalid HTML. Response preview: ' + blobText.substring(0, 200));
  }
  
  // Process HTML: wikilinks, images, CSS injection
  blobText = processHTML(blobText);
  
  // Return processed blob
  const verifiedBlob = new Blob([blobText], { type: 'text/html; charset=utf-8' });
  
  // In test environments, ensure the blob has a .text() method
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
export async function exportToEPUB(
  options: ExportOptions,
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  const format: ExportFormat = 'epub';
  
  console.log('[EPUB Export] Sending request');
  console.log('[EPUB Export] Content length:', options.content.length);
  console.log('[EPUB Export] Title:', options.title);
  
  // Make export request using shared handler
  let response: Response;
  try {
    response = await makeExportRequest(format, options, abortSignal, onProgress);
  } catch (error) {
    throw error;
  }
  
  // Handle non-OK responses
  if (!response.ok) {
    const url = `${getAsciiDoctorServerUrl()}convert/epub`;
    await handleErrorResponse(response, format, url);
    throw new Error('Should not reach here');
  }
  
  // Validate content type
  await validateResponseContentType(response, format);
  
  onProgress?.(75, 'Receiving EPUB file from server...');
  
  // Read blob
  const contentSizeKB = options.content.length / 1024;
  let blob = await readExportBlob(response, format, contentSizeKB, abortSignal);
  
  onProgress?.(85, 'Validating EPUB file...');
  
  // Validate EPUB blob (check ZIP magic bytes)
  await validateEPUBBlob(blob);
  
  onProgress?.(95, 'EPUB file ready');
  console.log('[EPUB Export] Successfully generated EPUB file, ready for download');
  return blob;
}

/**
 * Convert AsciiDoc content to PDF
 */
export async function exportToPDF(
  options: ExportOptions,
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  const format: ExportFormat = 'pdf';
  
  console.log('[PDF Export] Sending request');
  console.log('[PDF Export] Content length:', options.content.length);
  console.log('[PDF Export] Title:', options.title);
  
  // Make export request using shared handler
  let response: Response;
  try {
    response = await makeExportRequest(format, options, abortSignal, onProgress);
  } catch (error) {
    throw error;
  }
  
  // Handle non-OK responses
  if (!response.ok) {
    const url = `${getAsciiDoctorServerUrl()}convert/pdf`;
    await handleErrorResponse(response, format, url);
    throw new Error('Should not reach here');
  }
  
  // Validate content type
  await validateResponseContentType(response, format);
  
  onProgress?.(75, 'Receiving PDF file from server...');
  
  // Read blob
  const contentSizeKB = options.content.length / 1024;
  const blob = await readExportBlob(response, format, contentSizeKB, abortSignal);
  
  onProgress?.(95, 'PDF file ready');
  console.log('[PDF Export] Successfully generated PDF file, ready for download');
  return blob;
}

/**
 * Download a blob as a file
 * Optimized for large files by using requestIdleCallback when available
 * Includes timeout fallback to retry download if it doesn't start
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  validateBlob(blob, 'file');
  
  console.log('[Download] Starting download:', filename, 'Size:', blob.size, 'bytes');
  
  let downloadTriggered = false;
  
  const triggerDownload = (attempt: number = 1): void => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      a.click();
      downloadTriggered = true;
      
      console.log(`[Download] Download triggered (attempt ${attempt}):`, filename);
      
      // Clean up after a delay
      setTimeout(() => {
        try {
          if (document.body.contains(a)) {
            document.body.removeChild(a);
          }
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[Download] Error during cleanup:', e);
        }
      }, attempt === 1 ? 100 : 500);
    } catch (error) {
      console.error(`[Download] Error triggering download (attempt ${attempt}):`, error);
      downloadTriggered = false;
    }
  };
  
  // For large files, use a more efficient approach
  const isLargeFile = blob.size > 10 * 1024 * 1024; // > 10MB
  
  if (isLargeFile) {
    // Use requestIdleCallback if available to avoid blocking the UI
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => triggerDownload(1), { timeout: 1000 });
    } else {
      // Fallback: use setTimeout with minimal delay
      setTimeout(() => triggerDownload(1), 0);
    }
  } else {
    // For smaller files, trigger immediately
    triggerDownload(1);
  }
  
  // Set up timeout fallback: if download doesn't start within 15 seconds, retry
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!downloadTriggered) {
        console.warn('[Download] Download did not start within 15 seconds, retrying...');
        triggerDownload(2);
        
        // Give it another 5 seconds, then resolve anyway
        setTimeout(() => {
          console.log('[Download] Download retry completed');
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    }, 15000);
    
    // Check if download was triggered quickly
    const checkInterval = setInterval(() => {
      if (downloadTriggered) {
        clearTimeout(timeoutId);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    
    // Also resolve after a reasonable time even if we can't detect it
    setTimeout(() => {
      clearTimeout(timeoutId);
      clearInterval(checkInterval);
      resolve();
    }, 20000);
  });
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
  await downloadBlob(blob, filename);
}

/**
 * Check if the AsciiDoctor server is available
 * Re-exported from exportUtils for backward compatibility
 */
export { checkServerHealth };
