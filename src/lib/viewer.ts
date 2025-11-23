/**
 * E-book viewer utilities
 * Functions to open downloaded files in an elegant viewer
 */

import type { ComponentProps } from 'svelte';
import EBookViewer from '$components/EBookViewer.svelte';

let viewerInstance: EBookViewer | null = null;
let viewerContainer: HTMLElement | null = null;

export interface ViewerOptions {
  blob: Blob;
  filename: string;
  format: 'pdf' | 'epub' | 'html' | 'markdown' | 'asciidoc';
}

/**
 * Open a file in the e-book viewer
 */
export function openViewer(options: ViewerOptions): void {
  // Close existing viewer if open
  closeViewer();

  // Create container for viewer
  viewerContainer = document.createElement('div');
  viewerContainer.id = 'ebook-viewer-container';
  document.body.appendChild(viewerContainer);

  // Create viewer instance
  const props: ComponentProps<EBookViewer> = {
    blob: options.blob,
    filename: options.filename,
    format: options.format,
    onClose: closeViewer
  };

  viewerInstance = new EBookViewer({
    target: viewerContainer,
    props
  });
}

/**
 * Close the e-book viewer
 */
export function closeViewer(): void {
  if (viewerInstance) {
    viewerInstance.$destroy();
    viewerInstance = null;
  }
  if (viewerContainer) {
    viewerContainer.remove();
    viewerContainer = null;
  }
}

/**
 * Check if viewer is currently open
 */
export function isViewerOpen(): boolean {
  return viewerInstance !== null;
}

