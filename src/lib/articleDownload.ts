/**
 * Article and Book download utilities
 * Handles downloading articles and books in various formats
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { relayService } from '$lib/relayService';
import { exportToPDF, exportToEPUB, downloadBlob } from './asciidoctorExport';

/**
 * Download article as markdown
 */
export function downloadAsMarkdown(event: NostrEvent, filename?: string): void {
  const content = event.content;
  const blob = new Blob([content], { type: 'text/markdown' });
  const name = filename || `${event.id.slice(0, 8)}.md`;
  downloadBlob(blob, name);
}

/**
 * Download article as AsciiDoc
 */
export function downloadAsAsciiDoc(event: NostrEvent, filename?: string): void {
  const content = event.content;
  const blob = new Blob([content], { type: 'text/asciidoc' });
  const name = filename || `${event.id.slice(0, 8)}.adoc`;
  downloadBlob(blob, name);
}

/**
 * Download article as PDF
 */
export async function downloadAsPDF(event: NostrEvent, filename?: string): Promise<void> {
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = event.pubkey.slice(0, 8) + '...';
  
  try {
    const blob = await exportToPDF({
      content: event.content,
      title,
      author
    });
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download PDF:', error);
    throw error;
  }
}

/**
 * Download article as EPUB
 */
export async function downloadAsEPUB(event: NostrEvent, filename?: string): Promise<void> {
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = event.pubkey.slice(0, 8) + '...';
  
  try {
    const blob = await exportToEPUB({
      content: event.content,
      title,
      author
    });
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download EPUB:', error);
    throw error;
  }
}

/**
 * Fetch all 30041 events referenced by a 30040 index event
 */
export async function fetchBookContentEvents(indexEvent: NostrEvent): Promise<NostrEvent[]> {
  // Extract all 'e' tags which reference 30041 events
  const eventIds = indexEvent.tags
    .filter(([tag]) => tag === 'e')
    .map(([, eventId]) => eventId)
    .filter(Boolean);

  if (eventIds.length === 0) {
    return [];
  }

  // Fetch all referenced events
  try {
    // Query events by IDs - use a single filter with all IDs
    // If relay doesn't support multiple IDs, we'll need to query separately
    const result = await relayService.queryEvents(
      'anonymous',
      'wiki-read',
      [{ kinds: [30041], ids: eventIds }],
      { excludeUserContent: false, currentUserPubkey: undefined }
    );
    
    // If we didn't get all events, try querying individually
    const foundIds = new Set(result.events.map(e => e.id));
    const missingIds = eventIds.filter(id => !foundIds.has(id));
    
    if (missingIds.length > 0) {
      // Query missing events individually
      for (const id of missingIds) {
        try {
          const individualResult = await relayService.queryEvents(
            'anonymous',
            'wiki-read',
            [{ kinds: [30041], ids: [id] }],
            { excludeUserContent: false, currentUserPubkey: undefined }
          );
          result.events.push(...individualResult.events);
        } catch (e) {
          console.warn(`Failed to fetch event ${id}:`, e);
        }
      }
    }

    // Sort by the order in the index event's 'e' tags
    const orderMap = new Map<string, number>();
    eventIds.forEach((id, index) => {
      orderMap.set(id, index);
    });

    return result.events.sort((a, b) => {
      const orderA = orderMap.get(a.id) ?? 999;
      const orderB = orderMap.get(b.id) ?? 999;
      return orderA - orderB;
    });
  } catch (error) {
    console.error('Failed to fetch book content events:', error);
    return [];
  }
}

/**
 * Combine book events into a single AsciiDoc document
 */
export function combineBookEvents(indexEvent: NostrEvent, contentEvents: NostrEvent[]): string {
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const author = indexEvent.pubkey.slice(0, 8) + '...';

  // Build the document
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:doctype: book\n`;
  doc += `\n`;

  // Add each content event as a section
  for (const event of contentEvents) {
    // Extract metadata from event tags
    const bookTag = event.tags.find(([k]) => k === 'T')?.[1];
    const chapterTag = event.tags.find(([k]) => k === 'c')?.[1];
    const sectionTags = event.tags.filter(([k]) => k === 's').map(([, v]) => v);
    
    // Create section header
    if (bookTag && chapterTag) {
      const sectionLabel = sectionTags.length > 0 ? sectionTags.join(', ') : '';
      doc += `== ${bookTag} ${chapterTag}${sectionLabel ? ':' + sectionLabel : ''}\n\n`;
    } else if (bookTag) {
      doc += `== ${bookTag}\n\n`;
    } else {
      doc += `== Section\n\n`;
    }

    // Add content
    doc += event.content;
    doc += `\n\n`;
  }

  return doc;
}

/**
 * Download book (30040) as AsciiDoc with all branches and leaves
 */
export async function downloadBookAsAsciiDoc(indexEvent: NostrEvent, filename?: string): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = combineBookEvents(indexEvent, contentEvents);
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.adoc`;
  const blob = new Blob([combined], { type: 'text/asciidoc' });
  downloadBlob(blob, name);
}

/**
 * Download book (30040) as PDF with all branches and leaves
 */
export async function downloadBookAsPDF(indexEvent: NostrEvent, filename?: string): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = combineBookEvents(indexEvent, contentEvents);
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const author = indexEvent.pubkey.slice(0, 8) + '...';

  try {
    const blob = await exportToPDF({
      content: combined,
      title,
      author
    });
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book PDF:', error);
    throw error;
  }
}

/**
 * Download book (30040) as EPUB with all branches and leaves
 */
export async function downloadBookAsEPUB(indexEvent: NostrEvent, filename?: string): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = combineBookEvents(indexEvent, contentEvents);
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const author = indexEvent.pubkey.slice(0, 8) + '...';

  try {
    const blob = await exportToEPUB({
      content: combined,
      title,
      author
    });
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book EPUB:', error);
    throw error;
  }
}

