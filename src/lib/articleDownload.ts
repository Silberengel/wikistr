/**
 * Article and Book download utilities
 * Handles downloading articles and books in various formats
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';
import { relayService } from '$lib/relayService';
import { exportToPDF, exportToEPUB, exportToHTML5, exportToRevealJS, exportToLaTeX, downloadBlob } from './asciidoctorExport';

/**
 * Download article as markdown (with YAML frontmatter metadata)
 */
export async function downloadAsMarkdown(event: NostrEvent, filename?: string): Promise<void> {
  // Get title - prefer title tag, then d tag (identifier), then a descriptive fallback
  const titleTag = event.tags.find(([k]) => k === 'title')?.[1];
  const dTag = event.tags.find(([k]) => k === 'd')?.[1];
  const title = titleTag || dTag || `Untitled Document (${event.kind})`;
  
  const author = await getAuthorName(event);
  const description = event.tags.find(([k]) => k === 'description')?.[1];
  const summary = event.tags.find(([k]) => k === 'summary')?.[1];
  const image = event.tags.find(([k]) => k === 'image')?.[1];
  const version = event.tags.find(([k]) => k === 'version')?.[1];
  const source = event.tags.find(([k]) => k === 'source')?.[1];
  const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
  const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  // Encode pubkey to npub
  let npub: string;
  try {
    npub = nip19.npubEncode(event.pubkey);
  } catch (e) {
    // Fallback to hex if encoding fails
    npub = event.pubkey;
  }
  
  // Build YAML frontmatter
  let frontmatter = '---\n';
  frontmatter += `title: ${JSON.stringify(title)}\n`;
  frontmatter += `author: ${JSON.stringify(author)}\n`;
  frontmatter += `pubkey: ${JSON.stringify(npub)}\n`;
  
  if (description) frontmatter += `description: ${JSON.stringify(description)}\n`;
  if (summary) frontmatter += `summary: ${JSON.stringify(summary)}\n`;
  if (image) frontmatter += `image: ${JSON.stringify(image)}\n`;
  if (version) frontmatter += `version: ${JSON.stringify(version)}\n`;
  if (source) frontmatter += `source: ${JSON.stringify(source)}\n`;
  if (publishedOn) frontmatter += `published_on: ${JSON.stringify(publishedOn)}\n`;
  if (topicTags.length > 0) frontmatter += `tags: ${JSON.stringify(topicTags)}\n`;
  
  frontmatter += `event_id: ${event.id}\n`;
  frontmatter += `event_kind: ${event.kind}\n`;
  frontmatter += `---\n\n`;
  
  const content = frontmatter + event.content;
  const blob = new Blob([content], { type: 'text/markdown' });
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.md`;
  downloadBlob(blob, name);
}

/**
 * Download article as AsciiDoc
 */
export async function downloadAsAsciiDoc(event: NostrEvent, filename?: string): Promise<void> {
  const contentWithMetadata = await prepareAsciiDocContent(event, true, 'classic');
  const blob = new Blob([contentWithMetadata], { type: 'text/asciidoc' });
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.adoc`;
  downloadBlob(blob, name);
}

/**
 * Get author name from event (tag or user handle)
 */
async function getAuthorName(event: NostrEvent): Promise<string> {
  const authorTag = event.tags.find(([k]) => k === 'author')?.[1];
  if (authorTag) {
    return authorTag;
  }
  
  // Try to get user handle from metadata
  try {
    const handle = await getUserHandle(event.pubkey);
    if (handle && handle !== event.pubkey.slice(0, 8) + '...') {
      return handle;
    }
  } catch (e) {
    // Fallback to truncated pubkey
  }
  
  return event.pubkey.slice(0, 8) + '...';
}

/**
 * Build AsciiDoc document with metadata header
 */
async function buildAsciiDocWithMetadata(event: NostrEvent, content: string, theme: PDFTheme = 'classic', providedImage?: string): Promise<string> {
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = await getAuthorName(event);
  const description = event.tags.find(([k]) => k === 'description')?.[1];
  const summary = event.tags.find(([k]) => k === 'summary')?.[1];
  const image = providedImage || event.tags.find(([k]) => k === 'image')?.[1];
  const version = event.tags.find(([k]) => k === 'version')?.[1];
  const source = event.tags.find(([k]) => k === 'source')?.[1];
  const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
  const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
  
  // Build AsciiDoc document with metadata
  const themeMap: Record<PDFTheme, string> = {
    'classic': 'classic-novel',
    'antique': 'antique-novel',
    'modern': 'modern-book',
    'documentation': 'documentation',
    'scientific': 'scientific',
    'pop': 'pop-book',
    'bible-paragraph': 'bible-paragraph',
    'bible-versed': 'bible-versed',
    'poster': 'poster'
  };
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:pdf-theme: ${themeMap[theme]}\n`;
  doc += `:pdf-themesdir: /app/deployment\n`;
  
  if (version) {
    doc += `:version: ${version}\n`;
  }
  if (publishedOn) {
    doc += `:pubdate: ${publishedOn}\n`;
  }
  if (source) {
    doc += `:source: ${source}\n`;
  }
  if (topicTags.length > 0) {
    doc += `:keywords: ${topicTags.join(', ')}\n`;
  }
  
  // Add summary as custom field if both description and summary exist
  if (summary && description) {
    doc += `:summary: ${summary}\n`;
  }
  
  // For poster theme, display image prominently with text wrapping
  if (theme === 'poster' && image) {
    doc += `\n`;
    doc += `[.poster-image,float=left,width=40%]\n`;
    doc += `image::${image}[]\n\n`;
  } else if (image) {
    // Other themes: set as cover image for title page
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc += `\n`;
  
  // Add description as abstract if available
  if (description) {
    doc += `[abstract]\n`;
    doc += `${description}\n\n`;
  } else if (summary) {
    doc += `[abstract]\n`;
    doc += `${summary}\n\n`;
  }
  
  // Add content
  doc += content;
  
  return doc;
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
 * Prepare content for AsciiDoc conversion (with metadata)
 */
export async function prepareAsciiDocContent(event: NostrEvent, includeMetadata: boolean = true, theme: PDFTheme = 'classic'): Promise<string> {
  if (!event.content || event.content.trim().length === 0) {
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    if (includeMetadata) {
      return await buildAsciiDocWithMetadata(event, 'No content available.', theme);
    }
    return `= ${title}\n\nNo content available.`;
  }
  
  let content = event.content;
  
  // For 30817 (Markdown) and 30023 (Long-form Markdown), convert to AsciiDoc format
  if (event.kind === 30817 || event.kind === 30023) {
    // Markdown is mostly compatible with AsciiDoc, but ensure it's valid
    content = convertMarkdownToAsciiDoc(event.content);
  }
  
  // For 30818 (AsciiDoc), use directly - it's already AsciiDoc format
  // For 30040 (Index) and 30041 (Content), they should already be AsciiDoc
  // If content already has a title, we might want to preserve it
  // But if includeMetadata is true, we'll wrap it with metadata
  
  if (includeMetadata) {
    // Check if content already starts with a title
    const hasTitle = /^=+\s+.+/.test(content.trim());
    if (hasTitle) {
      // Content already has AsciiDoc structure, add metadata before it
      const lines = content.split('\n');
      const titleLineIndex = lines.findIndex(line => /^=+\s+/.test(line));
      if (titleLineIndex >= 0) {
        // Extract existing title and content
        const existingTitle = lines[titleLineIndex].replace(/^=+\s+/, '');
        const restContent = lines.slice(titleLineIndex + 1).join('\n');
        
        // Build with metadata, using existing title
        const title = existingTitle || event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
        const author = await getAuthorName(event);
        const description = event.tags.find(([k]) => k === 'description')?.[1];
        const summary = event.tags.find(([k]) => k === 'summary')?.[1];
        const image = event.tags.find(([k]) => k === 'image')?.[1];
        const version = event.tags.find(([k]) => k === 'version')?.[1];
        const source = event.tags.find(([k]) => k === 'source')?.[1];
        const publishedOn = event.tags.find(([k]) => k === 'published_on')?.[1];
        const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
        
        let doc = `= ${title}\n`;
        doc += `:author: ${author}\n`;
        doc += `:pdf-theme: ${theme}\n`;
        doc += `:pdf-themesdir: /app/deployment\n`;
        
        if (version) doc += `:version: ${version}\n`;
        if (publishedOn) doc += `:pubdate: ${publishedOn}\n`;
        if (source) doc += `:source: ${source}\n`;
        if (topicTags.length > 0) doc += `:keywords: ${topicTags.join(', ')}\n`;
        if (summary && description) doc += `:summary: ${summary}\n`;
        
        doc += `\n`;
        if (image) {
          doc += `:front-cover-image: ${image}\n`;
        }
        doc += `\n`;
        if (description) {
          doc += `[abstract]\n${description}\n\n`;
        } else if (summary) {
          doc += `[abstract]\n${summary}\n\n`;
        }
        
        doc += restContent;
        return doc;
      }
    }
    
    // No existing title, build with metadata
    const eventImage = event.tags.find(([k]) => k === 'image')?.[1];
    return await buildAsciiDocWithMetadata(event, content, theme, eventImage);
  }
  
  return content;
}

/**
 * Download article as PDF
 */
export type PDFTheme = 'classic' | 'antique' | 'modern' | 'documentation' | 'scientific' | 'pop' | 'bible-paragraph' | 'bible-versed' | 'poster';

export async function downloadAsPDF(event: NostrEvent, filename?: string, theme: PDFTheme = 'classic'): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download PDF: article content is empty');
  }
  
  try {
    // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
    const asciiDocContent = await prepareAsciiDocContent(event, true, theme);
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    
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
export async function downloadAsEPUB(event: NostrEvent, filename?: string, theme: PDFTheme = 'classic'): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download EPUB: article content is empty');
  }
  
  try {
    // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
    const asciiDocContent = await prepareAsciiDocContent(event, true, theme);
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    
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
 * Download article as HTML5
 */
export async function downloadAsHTML5(event: NostrEvent, filename?: string): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download HTML5: article content is empty');
  }
  
  try {
    // Prepare AsciiDoc content with metadata
    // This converts Markdown (30817, 30023) to AsciiDoc and wraps with metadata
    const asciiDocContent = await prepareAsciiDocContent(event, true, 'classic');
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    
    // Verify AsciiDoc content was created
    if (!asciiDocContent || asciiDocContent.trim().length === 0) {
      throw new Error('Failed to prepare AsciiDoc content');
    }
    
    // Log for debugging (first 200 chars)
    console.log('HTML5 Download: Sending AsciiDoc to server (preview):', asciiDocContent.substring(0, 200));
    
    // Send AsciiDoc content to AsciiDoctor server and request HTML
    const blob = await exportToHTML5({
      content: asciiDocContent,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty HTML file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.html`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download HTML5:', error);
    throw error;
  }
}

/**
 * Download article as LaTeX
 */
export async function downloadAsLaTeX(event: NostrEvent, filename?: string): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download LaTeX: article content is empty');
  }
  
  try {
    // Prepare AsciiDoc content with metadata
    const asciiDocContent = await prepareAsciiDocContent(event, true, 'classic');
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    
    const blob = await exportToLaTeX({
      content: asciiDocContent,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty LaTeX file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.tex`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download LaTeX:', error);
    throw error;
  }
}

/**
 * Download article as Reveal.js presentation (AsciiDoc events only)
 */
export async function downloadAsRevealJS(event: NostrEvent, filename?: string): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot download Reveal.js: article content is empty');
  }
  
  try {
    // Prepare AsciiDoc content with metadata
    const asciiDocContent = await prepareAsciiDocContent(event, true, 'classic');
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    
    const blob = await exportToRevealJS({
      content: asciiDocContent,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty HTML file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.html`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download Reveal.js:', error);
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
 * Determine heading level from event structure
 * Hierarchy:
 * - Level 1: Book (main 30040 index)
 * - Level 2: Chapter (if chapter tag exists in main index)
 * - Level 3: Subchapter (30040 nested) or Section (30041 with chapter but no sections)
 * - Level 4: Sub-section (30041 with section tags)
 * - Level 5+: Deeper nesting
 */
function getHeadingLevel(event: NostrEvent): number {
  // 30040 and 30041 events should be minimum level 3
  const is30040 = event.kind === 30040;
  const is30041 = event.kind === 30041;
  
  if (!is30040 && !is30041) {
    return 3; // Default for other content
  }
  
  // Extract tags
  const chapterTag = event.tags.find(([k]) => k === 'c')?.[1];
  const sectionTags = event.tags.filter(([k]) => k === 's');
  
  // If it's a 30040 subchapter, it's level 3
  if (is30040) {
    return 3;
  }
  
  // For 30041 events, determine level based on structure
  if (is30041) {
    // If it has section tags, it's a sub-section (level 4)
    if (sectionTags.length > 0) {
      return 4;
    }
    // If it has a chapter tag but no sections, it's a section (level 3)
    if (chapterTag) {
      return 3;
    }
    // Default: level 3
    return 3;
  }
  
  return 3; // Fallback
}

/**
 * Adjust heading levels in AsciiDoc content to ensure proper nesting
 * Increments all headings by at least 1 level, ensuring minimum level matches the section level
 */
function adjustHeadingLevels(content: string, sectionLevel: number): string {
  // Match AsciiDoc headings: lines starting with = followed by optional spaces and text
  // Captures: the equals signs, optional spaces, and the heading text
  return content.replace(/^(={1,6})\s+(.+)$/gm, (match, equals, text) => {
    const currentLevel = equals.length;
    // Increment by 1, but ensure minimum level is sectionLevel + 1
    const minLevel = sectionLevel + 1;
    const newLevel = Math.max(currentLevel + 1, minLevel);
    // AsciiDoc supports up to 6 levels, so cap at 6
    const finalLevel = Math.min(newLevel, 6);
    return '='.repeat(finalLevel) + ' ' + text;
  });
}

/**
 * Combine book events into a single AsciiDoc document
 * Uses metadata from NKBIP-01 and NKBIP-08
 */
export async function combineBookEvents(indexEvent: NostrEvent, contentEvents: NostrEvent[], theme: PDFTheme = 'classic'): Promise<string> {
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
  
  // PDF theme configuration
  const themeMap: Record<PDFTheme, string> = {
    'classic': 'classic-novel',
    'antique': 'antique-novel',
    'modern': 'modern-book',
    'documentation': 'documentation',
    'scientific': 'scientific',
    'pop': 'pop-book',
    'bible-paragraph': 'bible-paragraph',
    'bible-versed': 'bible-versed',
    'poster': 'poster'
  };
  doc += `:pdf-theme: ${themeMap[theme]}\n`;
  doc += `:pdf-themesdir: /app/deployment\n`;
  
  // For poster theme, display image prominently with text wrapping
  if (theme === 'poster' && image) {
    doc += `\n`;
    doc += `[.poster-image,float=left,width=40%]\n`;
    doc += `image::${image}[]\n\n`;
  } else if (image) {
    // Other themes: set as cover image for title page
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc += `\n`;
  
  // Add abstract/description after title page
  if (description) {
    doc += `[abstract]\n`;
    doc += `${description}\n\n`;
  } else if (summary) {
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
    
    // Determine heading level from event structure
    const headingLevel = getHeadingLevel(event);
    const headingMarkup = '='.repeat(headingLevel);
    
    // Create section header
    // Prefer section title from NKBIP-01 'title' tag, fallback to NKBIP-08 structure
    if (sectionTitle) {
      let header = sectionTitle;
      // Add version if different from index version
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `${headingMarkup} ${header}\n\n`;
    } else if (bookTag && chapterTag) {
      // Use NKBIP-08 structure
      const sectionLabel = sectionTags.length > 0 ? sectionTags.join(', ') : '';
      let header = `${bookTag} ${chapterTag}${sectionLabel ? ':' + sectionLabel : ''}`;
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `${headingMarkup} ${header}\n\n`;
    } else if (bookTag) {
      let header = bookTag;
      if (eventVersionTag && eventVersionTag !== (version || versionTag)) {
        header += ` (${eventVersionTag})`;
      }
      doc += `${headingMarkup} ${header}\n\n`;
    } else {
      // Fallback: use event ID or content preview
      const contentPreview = event.content.slice(0, 50).replace(/\n/g, ' ');
      doc += `${headingMarkup} ${contentPreview}...\n\n`;
    }

    // Add content, adjusting heading levels to ensure proper nesting
    // Content headings need to be at least one level deeper than the section header
    let adjustedContent = adjustHeadingLevels(event.content, headingLevel);
    
    // For bible themes, format verse numbers
    if ((theme === 'bible-paragraph' || theme === 'bible-versed') && sectionTags.length > 0) {
      // Format verses: Add verse numbers at the start of each verse
      // Filter for numeric verse numbers (verses are typically numbers)
      const verseNumbers = sectionTags.filter(s => /^\d+$/.test(s)); // Only numeric verse numbers
      if (verseNumbers.length > 0) {
        // For single verse, add verse number as superscript
        // For multiple verses, show all verse numbers
        const versePrefix = verseNumbers.length === 1 
          ? `[verse]#${verseNumbers[0]}# `
          : `[verse]#${verseNumbers.join(',')}# `;
        adjustedContent = versePrefix + adjustedContent.trim();
      }
    }
    
    if (theme !== 'bible-versed') {
      doc += adjustedContent;
    }
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
export async function downloadBookAsPDF(indexEvent: NostrEvent, filename?: string, theme: PDFTheme = 'classic'): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = await combineBookEvents(indexEvent, contentEvents, theme);
  
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
export async function downloadBookAsEPUB(indexEvent: NostrEvent, filename?: string, theme: PDFTheme = 'classic'): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = await combineBookEvents(indexEvent, contentEvents, theme);
  
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

/**
 * Combine multiple book search results into a single document
 */
async function combineBookSearchResults(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null,
  theme: PDFTheme = 'classic'
): Promise<string> {
  // Build title from query
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const title = `${queryTitle}${versionStr}`;
  
  // Get author from first result or use anonymous
  let author = 'Anonymous';
  if (results.length > 0) {
    const firstEvent = results[0];
    const authorTag = firstEvent.tags.find(([k]) => k === 'author')?.[1];
    if (authorTag) {
      author = authorTag;
    } else {
      try {
        author = await getUserHandle(firstEvent.pubkey);
      } catch (e) {
        // Keep default
      }
    }
  }
  
  // Build AsciiDoc document with theme styling
  const themeMap: Record<PDFTheme, string> = {
    'classic': 'classic-novel',
    'antique': 'antique-novel',
    'modern': 'modern-book',
    'documentation': 'documentation',
    'scientific': 'scientific',
    'pop': 'pop-book',
    'bible-paragraph': 'bible-paragraph',
    'bible-versed': 'bible-versed',
    'poster': 'poster'
  };
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:doctype: book\n`;
  doc += `:pdf-theme: ${themeMap[theme]}\n`;
  doc += `:pdf-themesdir: /app/deployment\n`;
  doc += `\n`;
  
  // Create styled title page
  doc += `[.title-page]\n`;
  doc += `== ${title}\n\n`;
  doc += `[.author]\n`;
  doc += `${author}\n\n`;
  doc += `\n`;
  
  // Group results by version for better organization
  const resultsByVersion = new Map<string, NostrEvent[]>();
  for (const event of results) {
    const versionTags = event.tags.filter(([tag]) => tag === 'v').map(([, value]) => value);
    const version = versionTags.length > 0 ? versionTags[0] : 'default';
    if (!resultsByVersion.has(version)) {
      resultsByVersion.set(version, []);
    }
    resultsByVersion.get(version)!.push(event);
  }
  
  // Add each result as a section
  for (const [version, versionResults] of resultsByVersion.entries()) {
    if (version !== 'default' || resultsByVersion.size > 1) {
      doc += `== ${version.toUpperCase()}\n\n`;
    }
    
    for (const event of versionResults) {
      // Extract metadata from event tags
      const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1];
      const bookTag = event.tags.find(([k]) => k === 'T')?.[1];
      const chapterTag = event.tags.find(([k]) => k === 'c')?.[1];
      const sectionTags = event.tags.filter(([k]) => k === 's').map(([, v]) => v);
      
      // Determine heading level from event structure
      const headingLevel = getHeadingLevel(event);
      const headingMarkup = '='.repeat(headingLevel);
      
      // Create section header
      if (sectionTitle) {
        doc += `${headingMarkup} ${sectionTitle}\n\n`;
      } else if (bookTag && chapterTag) {
        const sectionLabel = sectionTags.length > 0 ? sectionTags.join(', ') : '';
        let header = `${bookTag} ${chapterTag}${sectionLabel ? ':' + sectionLabel : ''}`;
        doc += `${headingMarkup} ${header}\n\n`;
      } else {
        const contentPreview = event.content.slice(0, 50).replace(/\n/g, ' ');
        doc += `${headingMarkup} ${contentPreview}...\n\n`;
      }
      
      // Add content, adjusting heading levels to ensure proper nesting
      // Content headings need to be at least one level deeper than the section header
      let adjustedContent = adjustHeadingLevels(event.content, headingLevel);
      
      // For bible themes, format verse numbers
      if ((theme === 'bible-paragraph' || theme === 'bible-versed') && sectionTags.length > 0) {
        // Filter for numeric verse numbers (verses are typically numbers)
        const verseNumbers = sectionTags.filter(s => /^\d+$/.test(s)); // Only numeric verse numbers
        if (verseNumbers.length > 0) {
          if (theme === 'bible-paragraph') {
            // Paragraph style: verse numbers inline as superscript in prose
            const versePrefix = verseNumbers.length === 1 
              ? `[verse]#${verseNumbers[0]}# `
              : `[verse]#${verseNumbers.join(',')}# `;
            adjustedContent = versePrefix + adjustedContent.trim();
          } else if (theme === 'bible-versed') {
            // Versed style: each verse on its own line with verse number
            // Split content by sentences/periods to create verse-per-line format
            const versePrefix = verseNumbers.length === 1 
              ? `[verse]#${verseNumbers[0]}# `
              : `[verse]#${verseNumbers.join(',')}# `;
            // In versed style, each verse should be on its own line
            // Replace periods with period + newline (but be careful not to break abbreviations)
            const versedContent = adjustedContent.trim().replace(/([.!?])\s+/g, '$1 +\n');
            adjustedContent = versePrefix + versedContent;
          }
        }
      }
      
      doc += adjustedContent;
      // For versed style, add extra spacing after each verse
      if (theme === 'bible-versed') {
        doc += `\n`;
      }
      doc += `\n\n`;
    }
  }
  
  return doc;
}

/**
 * Download book search results as Markdown
 */
export async function downloadBookSearchResultsAsMarkdown(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null
): Promise<void> {
  if (results.length === 0) {
    throw new Error('No results to download');
  }
  
  // Build title from query
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const title = `${queryTitle}${versionStr}`;
  
  // Get author from first result
  const firstEvent = results[0];
  const author = await getAuthorName(firstEvent);
  
  // Build YAML frontmatter
  let frontmatter = '---\n';
  frontmatter += `title: ${JSON.stringify(title)}\n`;
  frontmatter += `author: ${JSON.stringify(author)}\n`;
  frontmatter += `event_count: ${results.length}\n`;
  frontmatter += `---\n\n`;
  
  // Build content
  let content = frontmatter;
  
  // Group results by version
  const resultsByVersion = new Map<string, NostrEvent[]>();
  for (const event of results) {
    const versionTags = event.tags.filter(([tag]) => tag === 'v').map(([, value]) => value);
    const version = versionTags.length > 0 ? versionTags[0] : 'default';
    if (!resultsByVersion.has(version)) {
      resultsByVersion.set(version, []);
    }
    resultsByVersion.get(version)!.push(event);
  }
  
  // Add each result
  for (const [version, versionResults] of resultsByVersion.entries()) {
    if (version !== 'default' || resultsByVersion.size > 1) {
      content += `# ${version.toUpperCase()}\n\n`;
    }
    
    for (const event of versionResults) {
      const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1];
      const bookTag = event.tags.find(([k]) => k === 'T')?.[1];
      const chapterTag = event.tags.find(([k]) => k === 'c')?.[1];
      
      if (sectionTitle) {
        content += `## ${sectionTitle}\n\n`;
      } else if (bookTag && chapterTag) {
        content += `## ${bookTag} ${chapterTag}\n\n`;
      }
      
      content += event.content;
      content += `\n\n`;
    }
  }
  
  const blob = new Blob([content], { type: 'text/markdown' });
  const name = `${title.replace(/[^a-z0-9]/gi, '_')}.md`;
  downloadBlob(blob, name);
}

/**
 * Download book search results as AsciiDoc
 */
export async function downloadBookSearchResultsAsAsciiDoc(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null
): Promise<void> {
  if (results.length === 0) {
    throw new Error('No results to download');
  }
  
  const combined = await combineBookSearchResults(results, parsedQuery);
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const name = `${queryTitle.replace(/[^a-z0-9]/gi, '_')}${versionStr.replace(/[^a-z0-9]/gi, '_')}.adoc`;
  const blob = new Blob([combined], { type: 'text/asciidoc' });
  downloadBlob(blob, name);
}

/**
 * Download book search results as PDF
 */
export async function downloadBookSearchResultsAsPDF(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null,
  theme: PDFTheme = 'classic'
): Promise<void> {
  if (results.length === 0) {
    throw new Error('No results to download');
  }
  
  const combined = await combineBookSearchResults(results, parsedQuery, theme);
  
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const title = `${queryTitle}${versionStr}`;
  
  const firstEvent = results[0];
  let author = firstEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(firstEvent.pubkey);
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
    
    const name = `${title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book search results PDF:', error);
    throw error;
  }
}

/**
 * Download book search results as EPUB
 */
export async function downloadBookSearchResultsAsEPUB(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null,
  theme: PDFTheme = 'classic'
): Promise<void> {
  if (results.length === 0) {
    throw new Error('No results to download');
  }
  
  const combined = await combineBookSearchResults(results, parsedQuery, theme);
  
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const title = `${queryTitle}${versionStr}`;
  
  const firstEvent = results[0];
  let author = firstEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(firstEvent.pubkey);
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
    
    const name = `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book search results EPUB:', error);
    throw error;
  }
}

/**
 * Download book search results as LaTeX
 */
export async function downloadBookSearchResultsAsLaTeX(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null
): Promise<void> {
  if (results.length === 0) {
    throw new Error('No results to download');
  }
  
  const combined = await combineBookSearchResults(results, parsedQuery, 'classic');
  
  const queryTitle = parsedQuery 
    ? parsedQuery.references.map(ref => {
        const parts: string[] = [];
        if (ref.book) parts.push(ref.book);
        if (ref.chapter) parts.push(String(ref.chapter));
        if (ref.verse) parts.push(ref.verse);
        return parts.join(' ');
      }).join('; ')
    : 'Book Search Results';
  
  const versions = parsedQuery?.versions || (parsedQuery?.version ? [parsedQuery.version] : []);
  const versionStr = versions.length > 0 ? ` (${versions.join(', ')})` : '';
  const title = `${queryTitle}${versionStr}`;
  
  const firstEvent = results[0];
  let author = firstEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(firstEvent.pubkey);
  }
  
  try {
    const blob = await exportToLaTeX({
      content: combined,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty LaTeX file');
    }
    
    const name = `${title.replace(/[^a-z0-9]/gi, '_')}.tex`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book search results LaTeX:', error);
    throw error;
  }
}

/**
 * Download book (30040) as LaTeX with all branches and leaves
 */
export async function downloadBookAsLaTeX(indexEvent: NostrEvent, filename?: string): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = await combineBookEvents(indexEvent, contentEvents, 'classic');
  
  if (!combined || combined.trim().length === 0) {
    throw new Error('Cannot download LaTeX: book content is empty');
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
    const blob = await exportToLaTeX({
      content: combined,
      title,
      author
    });
    
    if (!blob || blob.size === 0) {
      throw new Error('Server returned empty LaTeX file');
    }
    
    const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}.tex`;
    downloadBlob(blob, name);
  } catch (error) {
    console.error('Failed to download book LaTeX:', error);
    throw error;
  }
}

