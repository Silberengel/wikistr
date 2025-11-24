/**
 * E-book viewer utilities
 * Functions to open downloaded files in an elegant viewer
 */

import EBookViewer from '$components/EBookViewer.svelte';
import { mount } from 'svelte';

let viewerInstance: ReturnType<typeof mount> | null = null;
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
  viewerContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; background: rgba(0, 0, 0, 0.9);';
  document.body.appendChild(viewerContainer);

  // Create viewer instance using Svelte 5 mount API
  try {
    viewerInstance = mount(EBookViewer, {
      target: viewerContainer,
      props: {
        blob: options.blob,
        filename: options.filename,
        format: options.format,
        onClose: closeViewer
      }
    });
  } catch (error) {
    console.error('Failed to mount viewer:', error);
    // Fallback: try using the component constructor (Svelte 4 style)
    if (viewerContainer) {
      viewerContainer.remove();
      viewerContainer = null;
    }
    throw error;
  }
}

/**
 * Close the e-book viewer
 */
export function closeViewer(): void {
  if (viewerInstance) {
    // In Svelte 5, mount returns an object with a destroy method
    if (typeof viewerInstance === 'object' && 'destroy' in viewerInstance) {
      (viewerInstance as any).destroy();
    }
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

