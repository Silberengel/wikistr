/**
 * Article Download Utilities
 * Handles conversion, metadata addition, and export of articles and books
 * Content quality control runs AFTER all conversions and metadata additions
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';
import { relayService } from '$lib/relayService';
import { exportToEPUB, exportToHTML5, exportToPDF, downloadBlob } from './asciidoctorExport';
import {
  processContentQualityAsync,
  getTitleFromEvent,
  formatBookWikilinkDisplayTextForGUI
} from './contentQualityControl';

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
  // Check for Markdown headers
  return /^#\s+/.test(trimmed) || /^##+\s+/.test(trimmed);
}

/**
 * Convert Markdown to AsciiDoc format
 */
function convertMarkdownToAsciiDoc(content: string): string {
  if (!content) return content;
  
  let converted = content;
  
  // Convert headers: # Title -> = Title, ## Section -> == Section, etc.
  converted = converted.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, text) => {
    const level = hashes.length;
    const equals = '='.repeat(level);
    return `${equals} ${text}`;
  });
  
  // Convert blockquotes: group consecutive lines starting with >
  // First, identify blockquote blocks
  const lines = converted.split('\n');
  const processed: string[] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('>')) {
      // Extract the quote text (remove > and optional space)
      const quoteText = trimmed.replace(/^>\s*/, '');
      if (!inBlockquote) {
        // Start new blockquote
        inBlockquote = true;
        blockquoteLines = [quoteText];
      } else {
        // Continue blockquote
        blockquoteLines.push(quoteText);
      }
    } else {
      // Not a blockquote line
      if (inBlockquote) {
        // End current blockquote
        if (blockquoteLines.length > 0) {
          processed.push('[quote]');
          processed.push('____');
          processed.push(...blockquoteLines);
          processed.push('____');
        }
        inBlockquote = false;
        blockquoteLines = [];
      }
      processed.push(line);
    }
  }
  
  // Handle blockquote at end of content
  if (inBlockquote && blockquoteLines.length > 0) {
    processed.push('[quote]');
    processed.push('____');
    processed.push(...blockquoteLines);
    processed.push('____');
  }
  
  converted = processed.join('\n');
  
  // Convert images: ![alt](url) -> image::url[alt]
  // Handle both regular and reference-style images
  converted = converted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    // Preserve the URL as-is, but ensure it's properly formatted
    const cleanUrl = url.trim();
    return `image::${cleanUrl}[${alt || ''}]`;
  });
  
  // Also handle reference-style images: ![alt][ref] -> convert to image::url[alt] if we can find the ref
  // This is a simple implementation - full reference resolution would require more parsing
  converted = converted.replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (match, alt, ref) => {
    // Try to find the reference definition [ref]: url
    const refPattern = new RegExp(`^\\[${ref}\\]:\\s*(.+)$`, 'm');
    const refMatch = converted.match(refPattern);
    if (refMatch && refMatch[1]) {
      const url = refMatch[1].trim();
      return `image::${url}[${alt || ''}]`;
    }
    // If reference not found, keep the original (will be handled by AsciiDoctor)
    return match;
  });
  
  // Convert links: [text](url) -> link:url[text]
  converted = converted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    return `link:${url}[${text}]`;
  });
  
  // Convert bold: **text** -> *text*
  converted = converted.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  
  // Convert italic: *text* -> _text_ (but be careful not to convert bold markers)
  converted = converted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '_$1_');
  
  return converted;
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

/**
 * Convert d-tag to title case
 * Example: "bitcoin-is-time" -> "Bitcoin Is Time"
 */
function dTagToTitleCase(dTag: string): string {
  if (!dTag || dTag.trim().length === 0) return '';
  
  return dTag
    .split(/[-_\s]+/)
    .map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Get title from event, with fallback to d-tag in title case
 */
function getTitleFromEventTags(event: NostrEvent): string {
  const titleTag = event.tags.find(([k]) => k === 'title')?.[1];
  if (titleTag) return titleTag;
  
  const tTag = event.tags.find(([k]) => k === 'T')?.[1];
  if (tTag) return tTag;
  
  // Fallback to d-tag in title case
  const dTag = event.tags.find(([k]) => k === 'd')?.[1];
  if (dTag) return dTagToTitleCase(dTag);
  
  // Final fallback to first 8 chars of ID (should rarely happen)
  return event.id.slice(0, 8);
}

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
  const source = event.tags.find(([k]) => k === 'source')?.[1];
  const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
  const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  // Build AsciiDoc document with metadata
  let doc = `= ${displayTitle}\n`;
  doc += `:author: ${author}\n`;
  doc += `:toc:\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  
  // Add CSS styling for images in EPUB/HTML exports
  if (exportFormat === 'epub' || exportFormat === 'html') {
    doc += `:stylesheet: epub-classic.css\n`; // Reference custom stylesheet if available
  }
  
  if (version) {
    doc += `:version: ${version}\n`;
    // For EPUB/PDF, also set revnumber (title page expects revision info)
    if (exportFormat === 'pdf' || exportFormat === 'epub') {
      doc += `:revnumber: ${version}\n`;
    }
  }
  if (publishedOn) {
    doc += `:pubdate: ${publishedOn}\n`;
    // For EPUB/PDF, also set revdate (title page expects revision info)
    if (exportFormat === 'pdf' || exportFormat === 'epub') {
      doc += `:revdate: ${publishedOn}\n`;
    }
  }
  if (source) {
    doc += `:source: ${source}\n`;
  }
  if (topicTags.length > 0) {
    doc += `:keywords: ${topicTags.join(', ')}\n`;
  }
  
  if (summary && description) {
    doc += `:summary: ${summary}\n`;
  }
  
  // Add cover image for PDF/EPUB exports (via attribute, not in content)
  if (image && (exportFormat === 'pdf' || exportFormat === 'epub' || !exportFormat)) {
    doc += `:front-cover-image: ${image}\n`;
  }
  
  // CRITICAL: Must have a blank line after all attributes before content begins
  doc = doc.trimEnd() + '\n\n';
  
  // Add description as abstract if available
  if (description && description.trim()) {
    doc += `\n== Abstract\n\n`;
    doc += `${description}\n\n`;
  } else if (summary && summary.trim()) {
    doc += `\n== Abstract\n\n`;
    doc += `${summary}\n\n`;
  }
  
  // Add article metadata section for article kinds (30023, 30041, 30817, 30818)
  // IMPORTANT: Always check for 30040 first and skip article-metadata if it's a book
  if (event.kind === 30040) {
    // Skip article-metadata for 30040 - they get book-metadata instead
  } else {
    const isArticleKind = event.kind === 30023 || event.kind === 30041 || event.kind === 30817 || event.kind === 30818;
    if (isArticleKind) {
      const metadataFields: Array<{ label: string; value: string }> = [];
      
      // Add Title field to metadata section
      if (displayTitle) metadataFields.push({ label: 'Title', value: displayTitle });
      
      // Add pubkey (as npub)
      if (event.pubkey) {
        const npub = nip19.npubEncode(event.pubkey);
        metadataFields.push({ label: 'Author Pubkey', value: npub });
      }
      
      // Add author
      if (author && author.trim()) {
        metadataFields.push({ label: 'Author', value: author });
      }
      
      // Add topics
      if (topicTags.length > 0) {
        metadataFields.push({ label: 'Topics', value: topicTags.join(', ') });
      }
      
      // Add published_at
      const publishedAt = event.tags.find(([k]) => k === 'published_at')?.[1] || 
                          event.tags.find(([k]) => k === 'published_on')?.[1];
      if (publishedAt) {
        try {
          const publishedDate = new Date(parseInt(publishedAt) * 1000);
          metadataFields.push({ label: 'Published', value: publishedDate.toLocaleDateString() });
        } catch (e) {
          metadataFields.push({ label: 'Published', value: publishedAt });
        }
      }
      
      // Add created_at
      if (event.created_at) {
        try {
          const createdDate = new Date(event.created_at * 1000);
          metadataFields.push({ label: 'Created', value: createdDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) });
        } catch (e) {
          // Ignore if date parsing fails
        }
      }
      
      // Add metadata section if we have any fields
      if (metadataFields.length > 0) {
        doc += '\n';
        doc += '[.article-metadata]\n';
        doc += `== ${displayTitle}\n\n`;
        
        // Add cover image at the top of metadata section (for HTML/AsciiDoc only)
        if ((exportFormat === 'html' || exportFormat === 'asciidoc' || !exportFormat) && image) {
          doc += `image::${image}[Cover Image]\n\n`;
        }
        
        for (const field of metadataFields) {
          if (field.value && field.value.trim()) {
            doc += `*${field.label}:* ${field.value}\n\n`;
          }
        }
        // Add marker to indicate end of metadata section
        doc += '__This document was published with a GitCitadel app.__\n\n';
      }
    }
  }
  
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
      // Content already has AsciiDoc structure, add metadata before it
      const lines = content.split('\n');
      const titleLineIndex = lines.findIndex(line => /^=+\s+/.test(line));
      if (titleLineIndex >= 0) {
        const existingTitle = lines[titleLineIndex].replace(/^=+\s+/, '');
        const restContent = lines.slice(titleLineIndex + 1).join('\n');
        
        const title = existingTitle || getTitleFromEventTags(event);
        const displayTitle = title || 'Untitled';
        const author = await getAuthorName(event);
        const description = event.tags.find(([k]) => k === 'description')?.[1];
        const summary = event.tags.find(([k]) => k === 'summary')?.[1];
        const image = event.tags.find(([k]) => k === 'image')?.[1];
        const version = event.tags.find(([k]) => k === 'version')?.[1];
        const source = event.tags.find(([k]) => k === 'source')?.[1];
        const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
        const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
        
        let doc = `= ${displayTitle}\n`;
        doc += `:author: ${author}\n`;
        doc += `:toc:\n`;
        doc += `:stem:\n`;
        doc += `:page-break-mode: auto\n`;
        doc += `:pdf-page-break-mode: auto\n`;
        
        if (exportFormat === 'pdf') {
          doc += `:media: prepress\n`;
          doc += `:pdf-page-size: A4\n`;
          doc += `:pdf-page-margin: [54, 72, 54, 72]\n`;
          doc += `:pdf-style: default\n`;
        }
        
        if (version) {
          doc += `:version: ${version}\n`;
          // For EPUB/PDF, also set revnumber (title page expects revision info)
          if (exportFormat === 'pdf' || exportFormat === 'epub') {
            doc += `:revnumber: ${version}\n`;
          }
        }
        if (publishedOn) {
          doc += `:pubdate: ${publishedOn}\n`;
          // For EPUB/PDF, also set revdate (title page expects revision info)
          if (exportFormat === 'pdf' || exportFormat === 'epub') {
            doc += `:revdate: ${publishedOn}\n`;
          }
        }
        if (source) doc += `:source: ${source}\n`;
        if (topicTags.length > 0) doc += `:keywords: ${topicTags.join(', ')}\n`;
        if (summary && description) doc += `:summary: ${summary}\n`;
        if (image && (exportFormat === 'pdf' || exportFormat === 'epub' || !exportFormat)) {
          doc += `:front-cover-image: ${image}\n`;
        }
        
        doc = doc.trimEnd() + '\n\n';
        
        // Add abstract section
        if (description && description.trim()) {
          doc += `\n== Abstract\n\n`;
          doc += `${description}\n\n`;
        } else if (summary && summary.trim()) {
          doc += `\n== Abstract\n\n`;
          doc += `${summary}\n\n`;
        }
        
        // Add article metadata section
        if (event.kind === 30040) {
          // Skip article-metadata for 30040
        } else {
          const isArticleKind = event.kind === 30023 || event.kind === 30041 || event.kind === 30817 || event.kind === 30818;
          if (isArticleKind) {
            const metadataFields: Array<{ label: string; value: string }> = [];
            
            // Add Title field to metadata section
            if (displayTitle) metadataFields.push({ label: 'Title', value: displayTitle });
            
            if (event.pubkey) {
              const npub = nip19.npubEncode(event.pubkey);
              metadataFields.push({ label: 'Author Pubkey', value: npub });
            }
            
            if (author && author.trim()) {
              metadataFields.push({ label: 'Author', value: author });
            }
            
            if (topicTags.length > 0) {
              metadataFields.push({ label: 'Topics', value: topicTags.join(', ') });
            }
            
            const publishedAt = event.tags.find(([k]) => k === 'published_at')?.[1] || 
                                event.tags.find(([k]) => k === 'published_on')?.[1];
            if (publishedAt) {
              try {
                const publishedDate = new Date(parseInt(publishedAt) * 1000);
                metadataFields.push({ label: 'Published', value: publishedDate.toLocaleDateString() });
              } catch (e) {
                metadataFields.push({ label: 'Published', value: publishedAt });
              }
            }
            
            if (event.created_at) {
              try {
                const createdDate = new Date(event.created_at * 1000);
                metadataFields.push({ label: 'Created', value: createdDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) });
              } catch (e) {
                // Ignore
              }
            }
            
            if (metadataFields.length > 0) {
              doc += '\n';
              doc += '[.article-metadata]\n';
              doc += `== ${displayTitle}\n\n`;
              
              if ((exportFormat === 'html' || exportFormat === 'asciidoc' || !exportFormat) && image) {
                doc += `image::${image}[Cover Image]\n\n`;
              }
              
              for (const field of metadataFields) {
                if (field.value && field.value.trim()) {
                  doc += `*${field.label}:* ${field.value}\n\n`;
                }
              }
              // Add marker to indicate end of metadata section
              doc += '__This document was published with a GitCitadel app.__\n\n';
            }
          }
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
    const combined = await combineBookEvents(event, contentEvents, true, exportFormat);
    
    if (!combined || combined.trim().length === 0) {
      throw new Error('Book content is empty');
    }
    
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
  const source = indexEvent.tags.find(([k]) => k === 'source')?.[1];
  let publishedOn = indexEvent.tags.find(([k]) => k === 'published_on')?.[1];
  // If no published_on tag, use created_at timestamp converted to ISO date
  if (!publishedOn && indexEvent.created_at) {
    publishedOn = new Date(indexEvent.created_at * 1000).toISOString().split('T')[0];
  }
  const topicTags = indexEvent.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  const displayTitle = title || 'Untitled';
  let doc = `= ${displayTitle}\n`;
  if (author && author.trim()) {
    doc += `${author}\n`;
  }
  doc += `:doctype: book\n`;
  doc += `:toc:\n`; // Enable table of contents for books
  doc += `:stem:\n`; // Enable STEM (math) support
  
  // Add CSS styling for images in EPUB/HTML exports
  if (exportFormat === 'epub' || exportFormat === 'html') {
    doc += `:stylesheet: epub-classic.css\n`; // Reference custom stylesheet if available
    // Add inline styles for image handling via AsciiDoc attributes
    doc += `[role="image-styles"]\n++++\n<style>\nimg { max-width: 100%; height: auto; display: block; margin: 1em auto; }\n.imageblock { text-align: center; margin: 1.5em 0; }\n.imageblock img { display: block; margin: 0 auto; max-width: 100%; height: auto; }\n.content img, .sect1 img, .sect2 img, .sect3 img { max-width: 100%; height: auto; }\n</style>\n++++\n\n`;
  }
  
  // Set author attribute for AsciiDoctor PDF title page (only if available)
  // Note: Missing :author: is okay, but :revnumber: and :revdate: are critical for layout
  if (author && author.trim()) {
    doc += `:author: ${author}\n`;
  }
  
  // For books, use revnumber and revdate for title page (title page expects revision info)
  // Always set these to ensure consistent title page layout - missing values cause layout issues
  // Also keep version and pubdate for backward compatibility
  const versionValue = version || '1.0';
  doc += `:version: ${versionValue}\n`;
  doc += `:revnumber: ${versionValue}\n`; // Title page uses revnumber (required for layout)
  
  // Use publishedOn if available, otherwise use current date to ensure layout consistency
  const revdateValue = publishedOn || new Date().toISOString().split('T')[0];
  doc += `:pubdate: ${revdateValue}\n`;
  doc += `:revdate: ${revdateValue}\n`; // Title page uses revdate (required for layout)
  if (source) doc += `:source: ${source}\n`;
  if (topicTags.length > 0) doc += `:keywords: ${topicTags.join(', ')}\n`;
  
  if (image && (exportFormat === 'pdf' || exportFormat === 'epub' || !exportFormat)) {
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc = doc.trimEnd() + '\n\n';
  
  // Add book metadata section for top-level 30040 events
  if (isTopLevel && indexEvent.kind === 30040) {
    const metadataFields: Array<{ label: string; value: string }> = [];
    
    // Add Title field to metadata section
    if (title) metadataFields.push({ label: 'Title', value: title });
    if (author) metadataFields.push({ label: 'Author', value: author });
    if (version) metadataFields.push({ label: 'Version', value: version });
    if (source) metadataFields.push({ label: 'Source', value: source });
    if (publishedOn) metadataFields.push({ label: 'Published On', value: publishedOn });
    if (topicTags.length > 0) metadataFields.push({ label: 'Topics', value: topicTags.join(', ') });
    
    if (metadataFields.length > 0) {
      doc += '\n';
      doc += `[.book-metadata]\n== ${displayTitle}\n\n`;
      
      // Add cover image for HTML/AsciiDoc exports (in metadata section)
      // For PDF/EPUB, the cover image is handled via :front-cover-image: attribute
      if ((exportFormat === 'html' || exportFormat === 'asciidoc' || !exportFormat) && image) {
        doc += `image::${image}[Cover Image]\n\n`;
      }
      
      for (const field of metadataFields) {
        if (field.value && field.value.trim()) {
          doc += `*${field.label}:* ${field.value}\n\n`;
        }
      }
      // Add marker to indicate end of metadata section
      doc += '__This document was published with a GitCitadel app.__\n\n';
    }
  }
  
  // Add each content event as a section (chapters)
  for (const event of contentEvents) {
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1];
    if (sectionTitle) {
      doc += `== ${sectionTitle}\n\n`;
    }
    
    let eventContent = event.content;
    if (event.kind === 30023 || event.kind === 30817) {
      eventContent = convertMarkdownToAsciiDoc(eventContent);
    }
    
    doc += eventContent;
    doc += `\n\n`;
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
  const blob = await exportToPDF({ content, title, author }, abortSignal);
  
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

