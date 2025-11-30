/**
 * Article Download Utilities
 * Handles conversion, metadata addition, and export of articles and books
 * Content quality control runs AFTER all conversions and metadata additions
 * Refactored to use shared utilities for reduced redundancy
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';
import { neventEncode } from '@nostr/tools/nip19';
import { relayService } from '$lib/relayService';
import { exportToEPUB, exportToHTML5, exportToPDF, downloadBlob } from './asciidoctorExport';
import {
  processContentQualityAsync,
  getTitleFromEvent,
  formatBookWikilinkDisplayTextForGUI
} from './contentQualityControl';
import {
  formatDateForTitlePage,
  getTitleFromEventTags as getTitleFromEventTagsUtil,
  getRevdateValue,
  getRevdateDisplayValue,
  buildBaseAsciiDocAttributes,
  buildArticleMetadataSection,
  buildBookMetadataSection,
  addAbstractSection,
  dTagToTitleCase
} from './asciidocUtils';

/**
 * Detect if content is AsciiDoc format
 */
function isAsciiDoc(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  const trimmed = content.trim();
  // Check for AsciiDoc document header
  return /^=\s+/.test(trimmed);
}

/**
 * Detect if content is Markdown format
 */
function isMarkdown(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  const trimmed = content.trim();
  // Check for ATX-style Markdown headers (# Header)
  if (/^#\s+/.test(trimmed) || /^##+\s+/.test(trimmed)) {
    return true;
  }
  // Check for setext-style Markdown headers (text followed by === or ---)
  const lines = trimmed.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1].trim();
    // Setext header: non-empty line followed by === (h1) or --- (h2)
    if (line && (nextLine.match(/^={3,}$/) || nextLine.match(/^-{3,}$/))) {
      return true;
    }
  }
  return false;
}

// Import shared markdown conversion utility
import { convertMarkdownToAsciiDoc as convertMarkdownToAsciiDocShared } from '$lib/markdownToAsciiDoc';

/**
 * Convert Markdown to AsciiDoc format (for exports)
 * Uses the shared conversion utility with export-specific options
 */
function convertMarkdownToAsciiDoc(content: string): string {
  return convertMarkdownToAsciiDocShared(content, {
    convertLevel1ToLevel2: true, // Convert level 1 to level 2 for exports (prevents extraction as document title)
    convertTables: false, // Tables not needed for exports (handled separately if needed)
    convertCodeBlocks: false, // Code blocks handled by AsciiDoctor
    convertStrikethrough: false, // Strikethrough not needed for exports
    convertBlockquotes: true, // Convert blockquotes for exports
    convertATXHeaders: true // Convert ATX headers for exports
  });
}

/**
 * Process wikilinks in content
 */
function processWikilinks(content: string, isAsciiDoc: boolean, exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'): string {
  if (!content) return content;
  
  // First, process book:: wikilinks and convert them to formatted display text with links
  content = content.replace(/\[\[book::([^\]]+)\]\]/g, (match, bookContent) => {
    // Format the book reference for display
    const displayText = formatBookWikilinkDisplayTextForGUI(bookContent);
    
    if (isAsciiDoc) {
      if (exportFormat === 'html') {
        // HTML will be post-processed to convert wikilink: protocol to proper HTML links
        return `link:wikilink:book::${bookContent}[${displayText}]`;
      } else if (exportFormat === 'epub') {
        // For EPUB, use a standard link format that AsciiDoctor will recognize
        // EPUB supports links, so use a hash link that will render as clickable
        const encodedContent = encodeURIComponent(`book::${bookContent}`);
        return `link:#${encodedContent}[${displayText}]`;
      } else if (exportFormat === 'pdf') {
        // For PDF, just use plain text (links show garbled encoded URLs in PDF)
        // PDF links won't be functional anyway in a static PDF file
        return displayText;
      } else {
        // For AsciiDoc export, use wikilink: protocol (will be plain text in .adoc file)
        return `link:wikilink:book::${bookContent}[${displayText}]`;
      }
    } else {
      return `[${displayText}](wikilink:book::${bookContent})`;
    }
  });
  
  // Then convert regular wikilinks [[identifier]] or [[identifier | display]] to AsciiDoc links
  return content.replace(/\[\[([^\]]+)\]\]/g, (match, content) => {
    const pipeIndex = content.indexOf(' | ');
    let identifier: string;
    let displayText: string;
    
    if (pipeIndex !== -1) {
      identifier = content.substring(0, pipeIndex).trim();
      displayText = content.substring(pipeIndex + 3).trim();
    } else {
      identifier = content.trim();
      displayText = identifier;
    }
    
    if (isAsciiDoc) {
      if (exportFormat === 'html') {
        // HTML will be post-processed to convert wikilink: protocol to proper HTML links
        return `link:wikilink:${identifier}[${displayText}]`;
      } else if (exportFormat === 'epub') {
        // For EPUB, use a standard link format that AsciiDoctor will recognize
        const encodedIdentifier = encodeURIComponent(identifier);
        return `link:#${encodedIdentifier}[${displayText}]`;
      } else if (exportFormat === 'pdf') {
        // For PDF, just use plain text (links show garbled encoded URLs in PDF)
        // PDF links won't be functional anyway in a static PDF file
        return displayText;
      } else {
        // For AsciiDoc export, use wikilink: protocol
        return `link:wikilink:${identifier}[${displayText}]`;
      }
    } else {
      return `[${displayText}](wikilink:${identifier})`;
    }
  });
}

/**
 * Process Nostr addresses in content
 */
async function processNostrAddresses(
  content: string,
  isAsciiDoc: boolean,
  getUserHandle?: (pubkey: string) => Promise<string>
): Promise<string> {
  if (!content) return content;
  
  // Process nostr: links - convert to display names if getUserHandle is provided
  const nostrLinkRegex = /nostr:([a-z0-9]+)/gi;
  
  if (getUserHandle) {
    const matches = Array.from(content.matchAll(nostrLinkRegex));
    for (const match of matches) {
      const bech32 = match[0];
      try {
        const decoded = nip19.decode(bech32.replace('nostr:', ''));
        if (decoded.type === 'npub' && decoded.data) {
          const pubkey = decoded.data;
          const handle = await getUserHandle(pubkey);
          if (handle) {
            if (isAsciiDoc) {
              content = content.replace(bech32, `link:${bech32}[${handle}]`);
            } else {
              content = content.replace(bech32, `[${handle}](${bech32})`);
            }
          }
        }
      } catch (e) {
        // Invalid nostr address, skip
      }
    }
  }
  
  return content;
}

/**
 * Get author name from event
 */
async function getAuthorName(event: NostrEvent): Promise<string> {
  const authorTag = event.tags.find(([k]) => k === 'author');
  if (authorTag && authorTag[1]) {
    return authorTag[1];
  }
  
  // Try to get from user metadata
  try {
    const result = await relayService.queryEvents(
      'anonymous',
      'metadata-read',
      [{ kinds: [0], authors: [event.pubkey], limit: 1 }],
      { excludeUserContent: false, currentUserPubkey: undefined }
    );
    
    if (result.events.length > 0) {
      const metadata = JSON.parse(result.events[0].content);
      return metadata.display_name || metadata.name || `npub1${event.pubkey.slice(0, 8)}...`;
    }
  } catch (e) {
    // Fallback
  }
  
  return `npub1${event.pubkey.slice(0, 8)}...`;
}

// Use shared utility for title extraction
const getTitleFromEventTags = getTitleFromEventTagsUtil;

/**
 * Get user handle (for Nostr address processing)
 */
async function getUserHandle(pubkey: string): Promise<string> {
  try {
    const result = await relayService.queryEvents(
      'anonymous',
      'metadata-read',
      [{ kinds: [0], authors: [pubkey], limit: 1 }],
      { excludeUserContent: false, currentUserPubkey: undefined }
    );
    
    if (result.events.length > 0) {
      const metadata = JSON.parse(result.events[0].content);
      return metadata.display_name || metadata.name || `npub1${pubkey.slice(0, 8)}...`;
    }
  } catch (e) {
    // Fallback
  }
  
  return `npub1${pubkey.slice(0, 8)}...`;
}

/**
 * Build AsciiDoc document with metadata header
 * Refactored to use shared utilities for metadata building
 */
async function buildAsciiDocWithMetadata(
  event: NostrEvent,
  content: string,
  providedImage?: string,
  exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'
): Promise<string> {
  const title = getTitleFromEventTags(event);
  const displayTitle = title || 'Untitled';
  const author = await getAuthorName(event);
  const description = event.tags.find(([k]) => k === 'description')?.[1];
  const summary = event.tags.find(([k]) => k === 'summary')?.[1];
  const image = providedImage || event.tags.find(([k]) => k === 'image')?.[1];
  const version = event.tags.find(([k]) => k === 'version')?.[1];
  let source = event.tags.find(([k]) => k === 'source')?.[1];
  
  // If source is empty, default to nevent of the event
  if (!source) {
    try {
      source = neventEncode({
        id: event.id
      });
    } catch (e) {
      console.warn('[Article Export] Failed to generate nevent for source:', e);
    }
  }
  
  const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
  const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  // Build base AsciiDoc attributes using shared utility
  let doc = buildBaseAsciiDocAttributes(displayTitle, author, {
    version,
    publishedOn,
    source,
    topicTags,
    summary: summary && description ? summary : undefined,
    image,
    exportFormat,
    event
  });
  
  // Calculate formatted dates for metadata display (for PDF/EPUB)
  let publishedOnFormatted: string | undefined;
  let revdateISO: string | undefined;
  if (exportFormat === 'pdf' || exportFormat === 'epub') {
    revdateISO = getRevdateValue(event, publishedOn);
    publishedOnFormatted = getRevdateDisplayValue(event, publishedOn);
  }
  
  // Add abstract section using shared utility
  doc += addAbstractSection(description, summary);
  
  // Add article metadata section using shared utility
  // Pass both formatted publishedOn and ISO revdate for display
  doc += buildArticleMetadataSection(event, displayTitle, author, image, exportFormat, publishedOnFormatted, revdateISO);
  
  // Add content
  doc += content;
  
  return doc;
}

/**
 * Prepare content for AsciiDoc conversion (with metadata)
 */
export async function prepareAsciiDocContent(
  event: NostrEvent,
  includeMetadata: boolean = true,
  exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'
): Promise<string> {
  if (!event.content || event.content.trim().length === 0) {
    const title = getTitleFromEventTags(event);
    if (includeMetadata) {
      return await buildAsciiDocWithMetadata(event, 'No content available.', undefined, exportFormat);
    }
    return `= ${title}\n\nNo content available.`;
  }
  
  let content = event.content;
  
  // Detect and convert Markdown to AsciiDoc format
  const isMarkdownEvent = event.kind === 30817 || event.kind === 30023;
  const hasMarkdownContent = isMarkdown(content);
  
  // Convert to AsciiDoc if it's a markdown event OR if content is detected as markdown
  if (isMarkdownEvent || (hasMarkdownContent && !isAsciiDoc(content))) {
    content = convertMarkdownToAsciiDoc(event.content);
  }
  
  if (includeMetadata) {
    // Check if content already starts with a title
    const hasTitle = /^=+\s+.+/.test(content.trim());
    if (hasTitle) {
      // Content already has AsciiDoc structure, extract title and rest of content
      const lines = content.split('\n');
      const titleLineIndex = lines.findIndex(line => /^=+\s+/.test(line));
      if (titleLineIndex >= 0) {
        const existingTitle = lines[titleLineIndex].replace(/^=+\s+/, '');
        const restContent = lines.slice(titleLineIndex + 1).join('\n');
        
        // Use existing title or fallback to event title
        const title = existingTitle || getTitleFromEventTags(event);
        const eventImage = event.tags.find(([k]) => k === 'image')?.[1];
        
        // Build metadata with the extracted title, then append rest of content
        let doc = await buildAsciiDocWithMetadata(event, '', eventImage, exportFormat);
        
        // Replace title in metadata with the extracted title from content
        doc = doc.replace(/^=\s+[^\n]+/m, `= ${title}`);
        
        // Add PDF-specific attributes if needed
        if (exportFormat === 'pdf') {
          doc = doc.replace(':page-break-mode: auto\n', ':page-break-mode: auto\n:pdf-page-break-mode: auto\n:media: prepress\n:pdf-page-size: A4\n:pdf-page-margin: [54, 72, 54, 72]\n:pdf-style: default\n');
        }
        
        // Add the rest of the content after metadata
        if (restContent.trim()) {
          doc += restContent;
        }
        
        // Process wikilinks and nostr addresses
        doc = processWikilinks(doc, true, exportFormat);
        doc = await processNostrAddresses(doc, true, getUserHandle);
        
        return doc;
      }
    }
    
    // No existing title, build with metadata
    const eventImage = event.tags.find(([k]) => k === 'image')?.[1];
    let doc = await buildAsciiDocWithMetadata(event, content, eventImage, exportFormat);
    
    // Process wikilinks and nostr addresses
    doc = processWikilinks(doc, true, exportFormat);
    doc = await processNostrAddresses(doc, true, getUserHandle);
    
    return doc;
  }
  
  // Process wikilinks and nostr addresses even when not including metadata
  content = processWikilinks(content, true, exportFormat);
  content = await processNostrAddresses(content, true, getUserHandle);
  
  return content;
}

/**
 * Helper: Get book content (for 30040 events) or single event content
 */
async function getEventContent(
  event: NostrEvent,
  exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'
): Promise<{ content: string; title: string; author: string }> {
  if (event.kind === 30040) {
    // For books, fetch all branches and leaves
    const contentEvents = await fetchBookContentEvents(event);
    console.log(`[Book Export] Fetched ${contentEvents.length} content events for book`);
    
    // Count and log top-level sections
    const { total, found } = countTopLevelSections(event, contentEvents);
    console.log(`[Book Export] ${found} of ${total} top-level sections published.`);
    
    if (contentEvents.length === 0) {
      throw new Error('No content events found for this book');
    }
    
    const combined = await combineBookEvents(event, contentEvents, true, exportFormat);
    
    if (!combined || combined.trim().length === 0) {
      throw new Error('Book content is empty after combining');
    }
    
    console.log(`[Book Export] Combined book content: ${combined.length} characters`);
    
    const title = getTitleFromEventTags(event);
    
    let author = event.tags.find(([k]) => k === 'author')?.[1];
    if (!author) {
      author = await getAuthorName(event);
    }
    
    return { content: combined, title, author };
  } else {
    // For regular events, prepare AsciiDoc content
    const content = await prepareAsciiDocContent(event, true, exportFormat);
    const title = getTitleFromEventTags(event);
    const author = await getAuthorName(event);
    return { content, title, author };
  }
}

/**
 * Count top-level 30040 sections (direct children of root, not nested)
 * Returns { total: number of top-level 30040 sections in root, found: number actually found in contentEvents }
 */
function countTopLevelSections(indexEvent: NostrEvent, contentEvents: NostrEvent[]): { total: number; found: number } {
  const rootATags = indexEvent.tags
    .filter(([tag]) => tag === 'a')
    .map(([, aTag]) => aTag)
    .filter(Boolean);
  
  const topLevel30040Count = rootATags.filter(aTag => {
    const [kindStr] = aTag.split(':');
    return kindStr === '30040';
  }).length;
  
  // Count how many top-level 30040 sections were actually found
  const foundTopLevel30040s = contentEvents.filter(e => {
    // Check if this event is referenced by a root 'a' tag
    return rootATags.some(aTag => {
      const [kindStr, pubkey, dTag] = aTag.split(':');
      return kindStr === '30040' && e.kind === 30040 && e.pubkey === pubkey && 
             (e.tags.find(([k]) => k === 'd')?.[1] === dTag);
    });
  }).length;
  
  return { total: topLevel30040Count, found: foundTopLevel30040s };
}

/**
 * Fetch all 30040 (branches) and 30041 (leaves) events referenced by a 30040 index event
 */
async function fetchBookContentEvents(indexEvent: NostrEvent): Promise<NostrEvent[]> {
  const visitedIds = new Set<string>();
  return await fetchBookContentEventsRecursive(indexEvent, visitedIds);
}

async function fetchBookContentEventsRecursive(
  indexEvent: NostrEvent,
  visitedIds: Set<string>
): Promise<NostrEvent[]> {
  const currentVisited = new Set(visitedIds);
  currentVisited.add(indexEvent.id);
  
  const eventIds = indexEvent.tags
    .filter(([tag]) => tag === 'e')
    .map(([, eventId]) => eventId)
    .filter(Boolean)
    .filter(id => id !== indexEvent.id)
    .filter(id => !visitedIds.has(id));
  
  const aTags = indexEvent.tags
    .filter(([tag]) => tag === 'a')
    .map(([, aTag]) => aTag)
    .filter(Boolean);
  
  const allEvents: NostrEvent[] = [];
  
  // Fetch events referenced by 'a' tags
  if (aTags.length > 0) {
    try {
      const aTagFilters: any[] = [];
      for (const aTag of aTags) {
        const [kindStr, pubkey, dTag] = aTag.split(':');
        if (kindStr && pubkey && dTag) {
          const kind = parseInt(kindStr, 10);
          if (kind === 30040 || kind === 30041) {
            aTagFilters.push({
              kinds: [kind],
              authors: [pubkey],
              '#d': [dTag]
            });
          }
        }
      }
      
      if (aTagFilters.length > 0) {
        const result = await relayService.queryEvents(
          'anonymous',
          'wiki-read',
          aTagFilters,
          { excludeUserContent: false, currentUserPubkey: undefined }
        );
        
        allEvents.push(...result.events.filter(e => e.kind === 30040 || e.kind === 30041));
      }
    } catch (error) {
      console.error('Failed to fetch book content events (a-tags):', error);
    }
  }
  
  // Fetch events referenced by 'e' tags
  if (eventIds.length > 0) {
    try {
      const result = await relayService.queryEvents(
        'anonymous',
        'wiki-read',
        [{ kinds: [30041], ids: eventIds }],
        { excludeUserContent: false, currentUserPubkey: undefined }
      );
      
      const existingIds = new Set(allEvents.map(e => e.id));
      allEvents.push(...result.events.filter(e => e.kind === 30041 && !existingIds.has(e.id)));
    } catch (error) {
      console.error('Failed to fetch book content events (e-tags):', error);
    }
  }
  
  // Recursively fetch nested 30040 events
  const nested30040s = allEvents.filter(e => e.kind === 30040);
  for (const nested of nested30040s) {
    if (!currentVisited.has(nested.id)) {
      const nestedEvents = await fetchBookContentEventsRecursive(nested, currentVisited);
      allEvents.push(...nestedEvents);
    }
  }
  
  return allEvents;
}

/**
 * Combine book events into a single AsciiDoc document
 */
export async function combineBookEvents(
  indexEvent: NostrEvent,
  contentEvents: NostrEvent[],
  isTopLevel: boolean = true,
  exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'
): Promise<string> {
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getAuthorName(indexEvent);
  }
  // If still no author, use the pubkey as npub
  if (!author || !author.trim()) {
    author = nip19.npubEncode(indexEvent.pubkey);
  }
  
  const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
  const version = indexEvent.tags.find(([k]) => k === 'version')?.[1];
  let source = indexEvent.tags.find(([k]) => k === 'source')?.[1];
  
  // If source is empty, default to nevent of the book event
  if (!source) {
    try {
      source = neventEncode({
        id: indexEvent.id
      });
    } catch (e) {
      console.warn('[Book Export] Failed to generate nevent for source:', e);
    }
  }
  
  let publishedOn = indexEvent.tags.find(([k]) => k === 'published_on')?.[1];
  // If no published_on tag, use created_at timestamp converted to ISO date
  if (!publishedOn && indexEvent.created_at) {
    publishedOn = new Date(indexEvent.created_at * 1000).toISOString().split('T')[0];
  }
  const topicTags = indexEvent.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  const displayTitle = title || 'Untitled';
  
  // Build book document header with attributes
  let doc = `= ${displayTitle}\n`;
  if (author && author.trim()) {
    doc += `${author}\n`;
  }
  doc += `:doctype: book\n`;
  doc += `:toc:\n`;
  doc += `:toclevels: 2\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  
  if (author && author.trim()) {
    doc += `:author: ${author}\n`;
  }
  
  // For books, always set revnumber and revdate using shared utility
  const versionValue = version || 'first edition';
  doc += `:version: ${versionValue}\n`;
  doc += `:revnumber: ${versionValue}\n`;
  
  // Use formatted display value for pubdate (what user sees on title page)
  // Keep revdate in ISO format (YYYY-MM-DD) so AsciiDoctor can parse it
  const revdateISO = getRevdateValue(indexEvent, publishedOn);
  const pubdateDisplay = getRevdateDisplayValue(indexEvent, publishedOn);
  doc += `:pubdate: ${pubdateDisplay}\n`;
  doc += `:revdate: ${revdateISO}\n`;
  
  if (source) doc += `:source: ${source}\n`;
  if (topicTags.length > 0) doc += `:keywords: ${topicTags.join(', ')}\n`;
  
  if (image && (exportFormat === 'pdf' || exportFormat === 'epub' || !exportFormat)) {
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc = doc.trimEnd() + '\n\n';
  
  // Add inline CSS for HTML exports only (EPUB needs separate stylesheet)
  if (exportFormat === 'html') {
    doc += `++++\n<style>\nimg { max-width: 100%; height: auto; display: block; margin: 1em auto; }\n.imageblock { text-align: center; margin: 1.5em 0; }\n.imageblock img { display: block; margin: 0 auto; max-width: 100%; height: auto; }\n.content img, .sect1 img, .sect2 img, .sect3 img { max-width: 100%; height: auto; }\n</style>\n++++\n\n`;
  }
  
  // Add book metadata section using shared utility
  // Pass both formatted publishedOn and ISO revdate for display
  doc += buildBookMetadataSection(displayTitle, author, {
    version,
    source,
    publishedOn,
    publishedOnFormatted: pubdateDisplay,  // Formatted display value
    revdateISO: revdateISO,  // ISO format revision date
    topicTags,
    image,
    exportFormat
  }, isTopLevel && indexEvent.kind === 30040);
  
  // Add each content event as a section (chapters)
  for (let i = 0; i < contentEvents.length; i++) {
    const event = contentEvents[i];
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1];
    
    console.log(`[Book Export] Processing chapter ${i + 1}/${contentEvents.length}: ${sectionTitle || 'Untitled'}`);
    
    if (sectionTitle) {
      // For PDF, add page break before each chapter (except the first one)
      if (exportFormat === 'pdf' && i > 0) {
        doc += `[page-break]\n`;
      }
      doc += `== ${sectionTitle}\n\n`;
    }
    
    let eventContent = event.content;
    if (event.kind === 30023 || event.kind === 30817) {
      eventContent = convertMarkdownToAsciiDoc(eventContent);
    }
    
    // Log content length for debugging
    const contentLength = eventContent.length;
    console.log(`[Book Export] Chapter ${i + 1} content length: ${contentLength} characters`);
    
    if (!eventContent || eventContent.trim().length === 0) {
      console.warn(`[Book Export] Warning: Chapter ${i + 1} (${sectionTitle || 'Untitled'}) has empty content`);
      doc += `_This chapter has no content._\n\n`;
    } else {
      doc += eventContent;
      doc += `\n\n`;
    }
  }
  
  console.log(`[Book Export] Combined document length: ${doc.length} characters`);
  console.log(`[Book Export] Total chapters processed: ${contentEvents.length}`);
  
  // Verify all chapters were included by checking the document
  const chapterHeaders = doc.match(/^== /gm) || [];
  const chapterCount = chapterHeaders.length;
  console.log(`[Book Export] Chapter headers found in document: ${chapterCount}`);
  
  // Note: chapterCount may be greater than contentEvents.length due to metadata sections (expected)
  if (chapterCount < contentEvents.length) {
    console.error(`[Book Export] ERROR: Document has fewer chapter headers (${chapterCount}) than content events (${contentEvents.length}). Some chapters may be missing!`);
    console.error(`[Book Export] Missing chapters: ${contentEvents.length - chapterCount}`);
  }
  
  return doc;
}

/**
 * Generate filename with timestamp
 */
function generateFilename(title: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15);
  return `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.${extension}`;
}

/**
 * Validate AsciiDoc content
 */
function validateAsciiDocContent(content: string, isAsciiDoc: boolean): void {
  if (!content || content.trim().length === 0) {
    throw new Error('Content is empty');
  }
  
  if (isAsciiDoc && !/^=\s+/.test(content.trim())) {
    throw new Error('AsciiDoc content must start with a document header (= Title)');
  }
}

/**
 * Get EPUB blob (for viewing)
 */
export async function getEPUBBlob(
  event: NostrEvent, 
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<{ blob: Blob; filename: string }> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(5, 'Fetching content...');
  let { content, title, author } = await getEventContent(event, 'epub');
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(20, 'Processing content quality...');
  // Apply quality control AFTER all conversions and metadata additions
  content = await processContentQualityAsync(content, event, true, getUserHandle);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(30, 'Validating content...');
  validateAsciiDocContent(content, true);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(40, 'Generating EPUB file...');
  const blob = await exportToEPUB({ content, title, author }, abortSignal, onProgress);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
  }
  
  const filename = generateFilename(title, 'epub');
  return { blob, filename };
}

/**
 * Download EPUB
 */
export async function downloadAsEPUB(
  event: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  const { blob, filename: defaultFilename } = await getEPUBBlob(event, abortSignal, onProgress);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(95, 'Preparing download...');
  const name = filename || defaultFilename;
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Get HTML5 blob (for viewing)
 */
export async function getHTML5Blob(event: NostrEvent, abortSignal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  let { content, title, author } = await getEventContent(event, 'html');
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  // Apply quality control AFTER all conversions and metadata additions
  content = await processContentQualityAsync(content, event, true, getUserHandle);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  validateAsciiDocContent(content, true);
  
  const blob = await exportToHTML5({ content, title, author }, abortSignal);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  const filename = generateFilename(title, 'html');
  return { blob, filename };
}

/**
 * Download HTML5
 */
export async function downloadAsHTML5(
  event: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(10, 'Preparing content...');
  const { blob, filename: defaultFilename } = await getHTML5Blob(event, abortSignal);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(90, 'Preparing download...');
  const name = filename || defaultFilename;
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Get PDF blob (for viewing)
 */
export async function getPDFBlob(
  event: NostrEvent, 
  abortSignal?: AbortSignal,
  onProgress?: (progress: number, status: string) => void
): Promise<{ blob: Blob; filename: string }> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(5, 'Fetching content...');
  let { content, title, author } = await getEventContent(event, 'pdf');
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(20, 'Processing content quality...');
  // Apply quality control AFTER all conversions and metadata additions
  content = await processContentQualityAsync(content, event, true, getUserHandle);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(30, 'Validating content...');
  validateAsciiDocContent(content, true);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(40, 'Generating PDF file...');
  // Pass onProgress to exportToPDF for granular progress updates during PDF generation
  const blob = await exportToPDF({ content, title, author }, abortSignal, onProgress);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty PDF file');
  }
  
  const filename = generateFilename(title, 'pdf');
  return { blob, filename };
}

/**
 * Download PDF
 */
export async function downloadAsPDF(
  event: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  const { blob, filename: defaultFilename } = await getPDFBlob(event, abortSignal, onProgress);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(95, 'Preparing download...');
  const name = filename || defaultFilename;
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Download article as AsciiDoc
 */
export async function downloadAsAsciiDoc(
  event: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(20, 'Preparing content...');
  let { content, title } = await getEventContent(event, 'asciidoc');
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(60, 'Processing content...');
  // Apply quality control AFTER all conversions and metadata additions
  content = await processContentQualityAsync(content, event, true, getUserHandle);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(90, 'Preparing download...');
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.adoc`;
  const blob = new Blob([content], { type: 'text/asciidoc' });
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Download article as Markdown
 */
export async function downloadAsMarkdown(
  event: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(20, 'Preparing content...');
  const title = getTitleFromEventTags(event);
  let content = event.content;
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(60, 'Processing content...');
  // Convert AsciiDoc to Markdown if needed
  if (isAsciiDoc(content)) {
    // Convert headers: = Title -> # Title, == Section -> ## Section, etc.
    content = content.replace(/^(=+)\s+(.+)$/gm, (match, equals, text) => {
      const level = equals.length;
      const hashes = '#'.repeat(level);
      return `${hashes} ${text}`;
    });
    
    // Convert images: image::url[alt] -> ![alt](url)
    content = content.replace(/image::([^\[]+)\[([^\]]*)\]/g, (match, url, alt) => {
      return `![${alt || ''}](${url})`;
    });
    
    // Convert inline images: image:url[alt] -> ![alt](url)
    content = content.replace(/image:([^\[]+)\[([^\]]*)\]/g, (match, url, alt) => {
      return `![${alt || ''}](${url})`;
    });
  }
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(90, 'Preparing download...');
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.md`;
  const blob = new Blob([content], { type: 'text/markdown' });
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Download book (30040) as AsciiDoc
 */
export async function downloadBookAsAsciiDoc(
  indexEvent: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void
): Promise<void> {
  onProgress?.(5, 'Fetching book content...');
  const contentEvents = await fetchBookContentEvents(indexEvent);
  console.log(`[Book Export] Fetched ${contentEvents.length} content events for book`);
  
  // Count and log top-level sections
  const { total, found } = countTopLevelSections(indexEvent, contentEvents);
  console.log(`[Book Export] ${found} of ${total} top-level sections published.`);
  
  onProgress?.(25, 'Combining chapters...');
  let combined = await combineBookEvents(indexEvent, contentEvents, true, 'asciidoc');
  
  onProgress?.(50, 'Processing content...');
  // Apply quality control AFTER all conversions and metadata additions
  combined = await processContentQualityAsync(combined, indexEvent, true, getUserHandle);
  
  onProgress?.(90, 'Preparing download...');
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.adoc`;
  const blob = new Blob([combined], { type: 'text/asciidoc' });
  await downloadBlob(blob, name);
  
  onProgress?.(100, 'Download started!');
}

/**
 * Download book (30040) as EPUB
 */
export async function downloadBookAsEPUB(
  indexEvent: NostrEvent, 
  filename?: string,
  onProgress?: (progress: number, status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(5, 'Fetching book content...');
  const contentEvents = await fetchBookContentEvents(indexEvent);
  console.log(`[Book Export] Fetched ${contentEvents.length} content events for book`);
  
  // Count and log top-level sections
  const { total, found } = countTopLevelSections(indexEvent, contentEvents);
  console.log(`[Book Export] ${found} of ${total} top-level sections published.`);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(25, 'Combining chapters...');
  let combined = await combineBookEvents(indexEvent, contentEvents, true, 'epub');
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(50, 'Processing content quality...');
  // Apply quality control AFTER all conversions and metadata additions
  combined = await processContentQualityAsync(combined, indexEvent, true, getUserHandle);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(55, 'Validating content...');
  validateAsciiDocContent(combined, true);
  
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getAuthorName(indexEvent);
  }
  // If still no author, use the pubkey as npub
  if (!author || !author.trim()) {
    author = nip19.npubEncode(indexEvent.pubkey);
  }
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(60, 'Generating EPUB file...');
  const blob = await exportToEPUB({ content: combined, title, author }, abortSignal, onProgress);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(95, 'Preparing download...');
  const name = filename || generateFilename(title, 'epub');
  await downloadBlob(blob, name);
  
  if (abortSignal?.aborted) throw new Error('Download cancelled');
  onProgress?.(100, 'Download started!');
}

/**
 * Download book overview as YAML
 */
export async function downloadBookOverview(indexEvent: NostrEvent, filename?: string): Promise<void> {
  if (indexEvent.kind !== 30040) {
    throw new Error('Event is not a book index (30040)');
  }
  
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}_overview.yaml`;
  
  // Simple YAML export of book structure
  const yaml = `title: ${title}\nkind: ${indexEvent.kind}\nid: ${indexEvent.id}\n`;
  const blob = new Blob([yaml], { type: 'text/yaml' });
  await downloadBlob(blob, name);
}

