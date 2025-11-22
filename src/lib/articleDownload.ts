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
 * Convert markdown to AsciiDoc format
 */
function convertMarkdownToAsciiDoc(markdown: string): string {
  if (!markdown || markdown.trim().length === 0) {
    return '= Empty Document\n\nNo content available.';
  }
  
  // Simple conversion: wrap markdown in AsciiDoc format
  // Most markdown is compatible with AsciiDoc, but we ensure it's valid
  return markdown;
}

/**
 * Prepare content for AsciiDoc conversion
 */
export function prepareAsciiDocContent(event: NostrEvent): string {
  if (!event.content || event.content.trim().length === 0) {
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    return `= ${title}\n\nNo content available.`;
  }
  
  // For 30817 (Markdown), convert to AsciiDoc format
  if (event.kind === 30817 || event.kind === 30023) {
    return convertMarkdownToAsciiDoc(event.content);
  }
  
  // For 30818 (AsciiDoc), use directly
  return event.content;
}

/**
 * Download article as PDF
 */
export async function downloadAsPDF(event: NostrEvent, filename?: string): Promise<void> {
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = event.pubkey.slice(0, 8) + '...';
  
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download PDF: article content is empty');
  }
  
  try {
    const asciiDocContent = prepareAsciiDocContent(event);
    const blob = await exportToPDF({
      content: asciiDocContent,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty PDF file');
    }
    
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
  
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download EPUB: article content is empty');
  }
  
  try {
    const asciiDocContent = prepareAsciiDocContent(event);
    const blob = await exportToEPUB({
      content: asciiDocContent,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty EPUB file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download EPUB:', error);
    throw error;
  }
}

/**
 * Fetch all 30041 events referenced by a 30040 index event
 * Prevents circular references and self-references
 */
export async function fetchBookContentEvents(
  indexEvent: NostrEvent,
  visitedIds: Set<string> = new Set()
): Promise<NostrEvent[]> {
  // Prevent self-reference
  if (visitedIds.has(indexEvent.id)) {
    console.warn(`Circular reference detected: Event ${indexEvent.id} references itself or creates a loop`);
    return [];
  }

  // Add current event to visited set to prevent circular references
  const currentVisited = new Set(visitedIds);
  currentVisited.add(indexEvent.id);

  // Extract all 'e' tags which reference 30041 events
  // Filter out the current event's ID to prevent self-reference
  const eventIds = indexEvent.tags
    .filter(([tag]) => tag === 'e')
    .map(([, eventId]) => eventId)
    .filter(Boolean)
    .filter(id => id !== indexEvent.id) // Prevent self-reference
    .filter(id => !visitedIds.has(id)); // Prevent circular references

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
        // Skip if already visited (circular reference prevention)
        if (currentVisited.has(id)) {
          console.warn(`Skipping circular reference to event ${id}`);
          continue;
        }

        try {
          const individualResult = await relayService.queryEvents(
            'anonymous',
            'wiki-read',
            [{ kinds: [30041], ids: [id] }],
            { excludeUserContent: false, currentUserPubkey: undefined }
          );
          
          // Process any 30040 events recursively (for nested book structures)
          // but prevent circular references
          for (const event of individualResult.events) {
            if (event.kind === 30040 && !currentVisited.has(event.id)) {
              // Recursively fetch nested content, but pass visited set
              const nestedContent = await fetchBookContentEvents(event, currentVisited);
              result.events.push(...nestedContent);
            }
          }
          
          result.events.push(...individualResult.events.filter(e => e.kind === 30041));
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

    // Remove duplicates (in case of nested fetching)
    const uniqueEvents = new Map<string, NostrEvent>();
    for (const event of result.events) {
      if (!uniqueEvents.has(event.id)) {
        uniqueEvents.set(event.id, event);
      }
    }

    return Array.from(uniqueEvents.values()).sort((a, b) => {
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
 * Fetch user metadata to get display name/handle
 */
async function getUserHandle(pubkey: string): Promise<string> {
  try {
    // Check cache first
    const { contentCache } = await import('$lib/contentCache');
    const cachedEvents = await contentCache.getEvents('metadata');
    const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === pubkey && cached.event.kind === 0);
    
    if (cachedUserEvent) {
      try {
        // Try to parse from tags first, then content
        let content: any = {};
        if (cachedUserEvent.event.tags && Array.isArray(cachedUserEvent.event.tags)) {
          for (const tag of cachedUserEvent.event.tags) {
            if (Array.isArray(tag) && tag.length >= 2) {
              const key = tag[0].toLowerCase();
              const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
              if (value && typeof value === 'string') {
                if (key === 'display_name' || key === 'displayname') content.display_name = value;
                else if (key === 'name') content.name = value;
              }
            }
          }
        }
        // Fallback to content if tags didn't provide values
        if (!content.display_name && !content.name) {
          content = JSON.parse(cachedUserEvent.event.content);
        }
        return content.display_name || content.name || pubkey.slice(0, 8) + '...';
      } catch (e) {
        console.warn('Failed to parse cached user metadata:', e);
      }
    }
    
    // If not in cache, fetch from relays
    const result = await relayService.queryEvents(
      'anonymous',
      'metadata-read',
      [{ kinds: [0], authors: [pubkey], limit: 1 }],
      { excludeUserContent: false, currentUserPubkey: undefined }
    );
    
    if (result.events.length > 0) {
      const event = result.events[0];
      try {
        // Try to parse from tags first, then content
        let content: any = {};
        if (event.tags && Array.isArray(event.tags)) {
          for (const tag of event.tags) {
            if (Array.isArray(tag) && tag.length >= 2) {
              const key = tag[0].toLowerCase();
              const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
              if (value && typeof value === 'string') {
                if (key === 'display_name' || key === 'displayname') content.display_name = value;
                else if (key === 'name') content.name = value;
              }
            }
          }
        }
        // Fallback to content if tags didn't provide values
        if (!content.display_name && !content.name) {
          content = JSON.parse(event.content);
        }
        return content.display_name || content.name || pubkey.slice(0, 8) + '...';
      } catch (e) {
        console.warn('Failed to parse user metadata:', e);
      }
    }
  } catch (error) {
    console.warn('Failed to fetch user metadata:', error);
  }
  
  // Fallback to truncated pubkey
  return pubkey.slice(0, 8) + '...';
}

/**
 * Combine book events into a single AsciiDoc document
 * Uses metadata from NKBIP-01 and NKBIP-08
 */
export async function combineBookEvents(indexEvent: NostrEvent, contentEvents: NostrEvent[]): Promise<string> {
  // Extract metadata from NKBIP-01 (Publication Index - kind 30040)
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  // Get author: use author tag if present, otherwise fetch user handle from metadata
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(indexEvent.pubkey);
  }
  const description = indexEvent.tags.find(([k]) => k === 'description')?.[1];
  const summary = indexEvent.tags.find(([k]) => k === 'summary')?.[1];
  const source = indexEvent.tags.find(([k]) => k === 'source')?.[1];
  const version = indexEvent.tags.find(([k]) => k === 'version')?.[1];
  const type = indexEvent.tags.find(([k]) => k === 'type')?.[1] || 'book';
  const publishedOn = indexEvent.tags.find(([k]) => k === 'published_on')?.[1];
  const publishedBy = indexEvent.tags.find(([k]) => k === 'published_by')?.[1];
  const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
  
  // Extract metadata from NKBIP-08 tags
  const collectionTag = indexEvent.tags.find(([k]) => k === 'C')?.[1];
  const titleTag = indexEvent.tags.find(([k]) => k === 'T')?.[1];
  const chapterTag = indexEvent.tags.find(([k]) => k === 'c')?.[1];
  const versionTag = indexEvent.tags.find(([k]) => k === 'v')?.[1];
  
  // Build human-readable book reference from NKBIP-08 tags
  // Format matches bookstr: "Collection | Title, Chapter | Version"
  // Examples: "Bible | Genesis, 2 | KJV" or "Genesis, 2 | KJV" or "Genesis, Preface"
  function toTitleCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  const bookParts: string[] = [];
  
  // Build title and chapter part (comma-separated)
  if (titleTag) {
    const titleFormatted = toTitleCase(titleTag);
    if (chapterTag) {
      // For chapter, preserve numeric values but title case words
      const chapterValue = chapterTag.match(/^\d+$/) 
        ? chapterTag  // Keep numbers as-is
        : toTitleCase(chapterTag);  // Title case words like "preface", "introduction"
      bookParts.push(`${titleFormatted}, ${chapterValue}`);
    } else {
      bookParts.push(titleFormatted);
    }
  } else if (chapterTag) {
    // If no title but has chapter (unlikely but handle it)
    const chapterValue = chapterTag.match(/^\d+$/) 
      ? chapterTag
      : toTitleCase(chapterTag);
    bookParts.push(chapterValue);
  }
  
  // Add version after pipe if present
  if (versionTag) {
    bookParts.push(toTitleCase(versionTag));
  }
  
  // Build final reference: collection (if present) | title,chapter | version
  let bookReference: string | null = null;
  if (bookParts.length > 0) {
    const mainPart = bookParts[0]; // title,chapter or just title
    const versionPart = bookParts.length > 1 ? bookParts[1] : null; // version if present
    
    if (collectionTag) {
      const collectionFormatted = toTitleCase(collectionTag);
      if (versionPart) {
        bookReference = `${collectionFormatted} | ${mainPart} | ${versionPart}`;
      } else {
        bookReference = `${collectionFormatted} | ${mainPart}`;
      }
    } else {
      if (versionPart) {
        bookReference = `${mainPart} | ${versionPart}`;
      } else {
        bookReference = mainPart;
      }
    }
  }
  
  // Extract ISBN/identifier (NKBIP-01: 'i' tag)
  const identifierTag = indexEvent.tags.find(([k]) => k === 'i')?.[1];
  const isbn = identifierTag?.startsWith('isbn:') ? identifierTag.replace('isbn:', '') : identifierTag;
  
  // Extract tags/topics (NKBIP-01: 't' tags)
  const topicTags = indexEvent.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  // Extract original author for derivative works (NKBIP-01)
  const originalAuthorTag = indexEvent.tags.find(([k]) => k === 'p')?.[1];
  const originalEventTag = indexEvent.tags.find(([k]) => k === 'E')?.[1];

  // Build the document with metadata (AsciiDoc header attributes)
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:doctype: ${type}\n`;
  
  if (version || versionTag) {
    doc += `:version: ${version || versionTag}\n`;
  }
  if (publishedOn) {
    doc += `:pubdate: ${publishedOn}\n`;
  }
  if (publishedBy) {
    doc += `:publisher: ${publishedBy}\n`;
  }
  if (isbn) {
    doc += `:isbn: ${isbn}\n`;
  }
  if (bookReference) {
    doc += `:book-reference: ${bookReference}\n`;
  }
  if (source) {
    doc += `:source: ${source}\n`;
  }
  if (originalAuthorTag) {
    doc += `:original-author: ${originalAuthorTag}\n`;
  }
  if (originalEventTag) {
    doc += `:original-event: ${originalEventTag}\n`;
  }
  
  // Add topics as keywords
  if (topicTags.length > 0) {
    doc += `:keywords: ${topicTags.join(', ')}\n`;
  }
  
  // Add summary as custom field if both description and summary exist
  if (summary && description) {
    doc += `:summary: ${summary}\n`;
  }
  
  doc += `\n`;
  
  // Add cover image if available
  if (image) {
    doc += `[cover]\n`;
    doc += `image::${image}[]\n\n`;
  }
  
  // Add description as abstract if available (preferred over summary)
  // If both description and summary exist, use description for abstract
  if (description) {
    doc += `[abstract]\n`;
    doc += `${description}\n\n`;
  } else if (summary) {
    // Fallback to summary if no description
    doc += `[abstract]\n`;
    doc += `${summary}\n\n`;
  }

  // Add each content event as a section
  for (const event of contentEvents) {
    // Extract metadata from event tags (NKBIP-08 format for 30041)
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1];
    const bookTag = event.tags.find(([k]) => k === 'T')?.[1];
    const chapterTag = event.tags.find(([k]) => k === 'c')?.[1];
    const sectionTags = event.tags.filter(([k]) => k === 's').map(([, v]) => v);
    const eventVersionTag = event.tags.find(([k]) => k === 'v')?.[1];
    
    // Create section header
    // Prefer section title from NKBIP-01 'title' tag, fallback to NKBIP-08 structure
    if (sectionTitle) {
      let header = sectionTitle;
      // Add version if different from index version
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `== ${header}\n\n`;
    } else if (bookTag && chapterTag) {
      // Use NKBIP-08 structure
      const sectionLabel = sectionTags.length > 0 ? sectionTags.join(', ') : '';
      let header = `${bookTag} ${chapterTag}${sectionLabel ? ':' + sectionLabel : ''}`;
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `== ${header}\n\n`;
    } else if (bookTag) {
      let header = bookTag;
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `== ${header}\n\n`;
    } else {
      // Fallback: use event ID or content preview
      const contentPreview = event.content.slice(0, 50).replace(/\n/g, ' ');
      doc += `== ${contentPreview}...\n\n`;
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
  const combined = await combineBookEvents(indexEvent, contentEvents);
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
  const combined = await combineBookEvents(indexEvent, contentEvents);
  
  if (!combined || combined.trim().length === 0) {
    throw new Error('Cannot download PDF: book content is empty');
  }
  
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  // Get author from the combined document or fetch it
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(indexEvent.pubkey);
  }

  try {
    const blob = await exportToPDF({
      content: combined,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty PDF file');
    }
    
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
  const combined = await combineBookEvents(indexEvent, contentEvents);
  
  if (!combined || combined.trim().length === 0) {
    throw new Error('Cannot download EPUB: book content is empty');
  }
  
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  // Get author from the combined document or fetch it
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(indexEvent.pubkey);
  }

  try {
    const blob = await exportToEPUB({
      content: combined,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty EPUB file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book EPUB:', error);
    throw error;
  }
}

