/**
 * Article and Book download utilities
 * Handles downloading articles and books in various formats
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';
import { relayService } from '$lib/relayService';
import { exportToEPUB, exportToHTML5, downloadBlob } from './asciidoctorExport';
import {
  processContentQuality,
  processContentQualityAsync,
  processWikilinks,
  processNostrAddresses,
  getTitleFromEvent,
  fixHeaderSpacing,
  fixMissingHeadingLevels,
  fixEmptyHeadings,
  ensureDocumentHeader,
  validateAsciiDoc
} from './contentQualityControl';

/**
 * Generate table of contents from markdown headings
 * Supports ATX headers (#), Setext with = (level 1), and Setext with - (level 2)
 */
function generateMarkdownTOC(content: string): string {
  const lines = content.split('\n');
  const headings: Array<{ level: number; text: string; anchor: string }> = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (trimmed.length === 0) {
      continue;
    }
    
    // Check for Setext headers FIRST (before ATX) - they span two lines
    if (i < lines.length - 1) {
      const nextLine = lines[i + 1].trim();
      
      // Level 1: text followed by === (must be at least 3 = signs)
      if (/^=+$/.test(nextLine) && nextLine.length >= 3) {
        // Make sure current line is not already a header
        if (!trimmed.match(/^#+\s+/) && !trimmed.match(/^=+\s+/)) {
          const text = trimmed;
          const anchor = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          headings.push({ level: 1, text, anchor });
          i++; // Skip the underline line
          continue;
        }
      }
      
      // Level 2: text followed by --- (must be at least 3 - signs)
      if (/^-+$/.test(nextLine) && nextLine.length >= 3) {
        // Make sure current line is not already a header
        if (!trimmed.match(/^#+\s+/) && !trimmed.match(/^=+\s+/)) {
          const text = trimmed;
          const anchor = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          headings.push({ level: 2, text, anchor });
          i++; // Skip the underline line
          continue;
        }
      }
    }
    
    // Match ATX markdown headings: #, ##, ###, etc.
    const atxMatch = trimmed.match(/^(#+)\s+(.+)$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      const text = atxMatch[2].trim();
      // Generate anchor from heading text
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      headings.push({ level, text, anchor });
      continue;
    }
  }
  
  if (headings.length === 0) {
    return '';
  }
  
  // Generate TOC with proper indentation
  let toc = '## Table of Contents\n\n';
  for (const heading of headings) {
    const indent = '  '.repeat(heading.level - 1);
    toc += `${indent}- [${heading.text}](#${heading.anchor})\n`;
  }
  toc += '\n';
  
  return toc;
}

/**
 * Download article as markdown (with YAML frontmatter metadata)
 */
export async function downloadAsMarkdown(event: NostrEvent, filename?: string): Promise<void> {
  // Get title using QC service
  const title = getTitleFromEvent(event, true);
  
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
  
  // Detect format and convert if needed
  let content = event.content;
  if (isAsciiDoc(content)) {
    // Content is AsciiDoc, convert to Markdown
    content = convertAsciiDocToMarkdown(content);
  } else if (!isMarkdown(content) && content.trim().length > 0) {
    // Content is neither, assume it's plain text or markdown-compatible
    // Keep as is - markdown is forgiving
  }
  
  // Apply quality control for markdown events (30023, 30817)
  // Use async version to process Nostr addresses with user metadata
  if (event.kind === 30023 || event.kind === 30817) {
    content = await processContentQualityAsync(content, event, false, getUserHandle); // false = markdown, not asciidoc
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
  
  // Generate table of contents from headings
  const toc = generateMarkdownTOC(content);
  
  const finalContent = frontmatter + toc + content;
  const blob = new Blob([finalContent], { type: 'text/markdown' });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.md`;
  downloadBlob(blob, name);
}


/**
 * Download article as AsciiDoc
 */
export async function downloadAsAsciiDoc(event: NostrEvent, filename?: string): Promise<void> {
  // Prepare content - this already handles format detection and conversion
  let content = event.content;
  
  // If content is Markdown, convert it
  if (isMarkdown(content) && !isAsciiDoc(content)) {
    content = convertMarkdownToAsciiDoc(content);
  }
  
  // Apply quality control with async Nostr address processing
  content = await processContentQualityAsync(content, event, true, getUserHandle); // true = asciidoc
  
  // Create a temporary event with processed content for prepareAsciiDocContent
  const tempEvent = { ...event, content };
  const contentWithMetadata = await prepareAsciiDocContent(tempEvent, true);
  
  // Get title for filename
  const title = getTitleFromEvent(event, true);
  
  const blob = new Blob([contentWithMetadata], { type: 'text/asciidoc' });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.adoc`;
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
 * Get uploaded theme files as a map
 */

/**
 * Build AsciiDoc document with metadata header
 */
async function buildAsciiDocWithMetadata(event: NostrEvent, content: string, providedImage?: string): Promise<string> {
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
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:toc:\n`; // Enable table of contents
  doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
  doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
  
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
  if (image) {
    doc += `\n`;
    doc += `[.poster-image,float=left,width=40%]\n`;
    doc += `image::${image}[]\n\n`;
  } else if (image) {
    // Other themes: set as cover image for title page
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc += `\n`;
  
  // Add description as abstract if available (only if not empty)
  if (description && description.trim()) {
    // CRITICAL: Block attribute must be directly followed by heading with NO blank line
    doc = doc.trimEnd() + '\n';
    doc += `[abstract]\n== Abstract\n\n`;
    doc += `${description}\n\n`;
  } else if (summary && summary.trim()) {
    // CRITICAL: Block attribute must be directly followed by heading with NO blank line
    doc = doc.trimEnd() + '\n';
    doc += `[abstract]\n== Abstract\n\n`;
    doc += `${summary}\n\n`;
  }
  
  // Add content
  doc += content;
  
  return doc;
}

/**
 * Detect if content is AsciiDoc format
 */
function isAsciiDoc(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  
  const trimmed = content.trim();
  
  // Check for AsciiDoc-specific patterns
  // AsciiDoc headers: =, ==, ===, etc. (but not markdown #)
  if (/^=+\s+.+/.test(trimmed) && !/^#+\s+.+/.test(trimmed)) return true;
  
  // AsciiDoc image syntax: image::path[] or image:path[]
  if (/image::?\[/.test(content)) return true;
  
  // AsciiDoc block syntax: [source], [NOTE], [WARNING], etc.
  if (/^\[(source|NOTE|TIP|WARNING|IMPORTANT|CAUTION|INFO|QUOTE|EXAMPLE|SIDEBAR|LITERAL|LISTING|PASSTHROUGH|abstract)\]/i.test(content)) return true;
  
  // AsciiDoc attribute references: {attribute}
  if (/\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(content)) return true;
  
  // AsciiDoc cross-references: <<id,text>> or xref:id[text]
  if (/<<[^>]+>>|xref:[^\[]+\[/.test(content)) return true;
  
  // AsciiDoc attribute definitions: :attribute: value
  if (/^:[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(content)) return true;
  
  return false;
}

/**
 * Detect if content is Markdown format
 */
function isMarkdown(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  
  // Check for Markdown-specific patterns
  // Markdown headers: #, ##, ###, etc. (but not AsciiDoc =)
  if (/^#+\s+.+/.test(content.trim()) && !/^=+\s+.+/.test(content.trim())) return true;
  
  // Markdown image syntax: ![alt](url)
  if (/!\[[^\]]*\]\([^)]+\)/.test(content)) return true;
  
  // Markdown link syntax: [text](url) (but not AsciiDoc link:url[])
  if (/\[[^\]]+\]\([^)]+\)/.test(content) && !/link:[^\[]+\[/.test(content)) return true;
  
  // Markdown code blocks: ```language
  if (/^```/.test(content.trim())) return true;
  
  // Markdown horizontal rule: --- or ***
  if (/^[-*]{3,}$/.test(content.trim())) return true;
  
  return false;
}

/**
 * Convert Markdown to AsciiDoc
 */
function convertMarkdownToAsciiDoc(markdown: string): string {
  if (!markdown || markdown.trim().length === 0) {
    return '= Empty Document\n\nNo content available.';
  }
  
  let asciidoc = markdown;
  
  // Convert setext-style headers FIRST (before ATX headers)
  // Setext headers use underlines: === for h1, --- for h2
  // Pattern: text on one line, followed by === or --- on the next line
  const headerLines = asciidoc.split('\n');
  const processedHeaderLines: string[] = [];
  
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    const nextLine = i + 1 < headerLines.length ? headerLines[i + 1] : '';
    
    // Check if next line is a setext underline
    if (nextLine && /^={3,}$/.test(nextLine.trim())) {
      // Level 1 header (===)
      processedHeaderLines.push(`= ${line.trim()}`);
      i++; // Skip the underline line
    } else if (nextLine && /^-{3,}$/.test(nextLine.trim())) {
      // Level 2 header (---)
      processedHeaderLines.push(`== ${line.trim()}`);
      i++; // Skip the underline line
    } else {
      processedHeaderLines.push(line);
    }
  }
  
  asciidoc = processedHeaderLines.join('\n');
  
  // Convert ATX headers: # Title -> = Title, ## Subtitle -> == Subtitle
  // Only convert if not already converted by setext processing
  asciidoc = asciidoc.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, text) => {
    const level = hashes.length;
    return '='.repeat(level) + ' ' + text;
  });
  
  // Convert images: ![alt](url) -> image::url[alt]
  asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    return `image::${url}[${alt || ''}]`;
  });
  
  // Convert markdown links: [text](url) -> link:url[text]
  // Must be done after images to avoid matching image syntax
  asciidoc = asciidoc.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Escape special characters in text for AsciiDoc
    const escapedText = text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    return `link:${url}[${escapedText}]`;
  });
  
  // Convert LaTeX inline math: $...$ -> stem:[...] (AsciiDoc inline math)
  // Handle both inline $...$ and display $$...$$
  asciidoc = asciidoc.replace(/\$\$([^$]+)\$\$/g, (match, math) => {
    return `[stem]\n++++\n${math}\n++++`;
  });
  asciidoc = asciidoc.replace(/\$([^$\n]+)\$/g, (match, math) => {
    // Only convert if it's not already in a code block or stem block
    return `stem:[${math}]`;
  });
  
  // Convert code blocks: ```language -> [source,language] or [stem] for math
  asciidoc = asciidoc.replace(/^```(\w*)\n([\s\S]*?)```$/gm, (match, lang, code) => {
    // Check if it's a math/stem block
    if (lang && (lang.toLowerCase() === 'math' || lang.toLowerCase() === 'latex' || lang.toLowerCase() === 'stem')) {
      return `[stem]\n----\n${code}\n----`;
    }
    if (lang) {
      return `[source,${lang}]\n----\n${code}\n----`;
    }
    return `[source]\n----\n${code}\n----`;
  });
  
  // Convert inline code: `code` -> `code` (same in both)
  // Already compatible
  
  // Convert horizontal rules: --- -> ''' (or keep as is, both work)
  // Already compatible
  
  return asciidoc;
}

/**
 * Convert AsciiDoc to Markdown
 */
function convertAsciiDocToMarkdown(asciidoc: string): string {
  if (!asciidoc || asciidoc.trim().length === 0) {
    return '# Empty Document\n\nNo content available.';
  }
  
  let markdown = asciidoc;
  
  // Convert headers: = Title -> # Title, == Subtitle -> ## Subtitle
  markdown = markdown.replace(/^(=+)\s+(.+)$/gm, (match, equals, text) => {
    const level = equals.length;
    return '#'.repeat(level) + ' ' + text;
  });
  
  // Convert images: image::url[alt] -> ![alt](url) or image:url[alt] -> ![alt](url)
  markdown = markdown.replace(/image::?([^\[]+)\[([^\]]*)\]/g, (match, url, alt) => {
    return `![${alt || ''}](${url.trim()})`;
  });
  
  // Convert source blocks: [source,language]...---- -> ```language...```
  markdown = markdown.replace(/\[source(?:,(\w+))?\]\n----\n([\s\S]*?)----/g, (match, lang, code) => {
    if (lang) {
      return `\`\`\`${lang}\n${code}\`\`\``;
    }
    return `\`\`\`\n${code}\`\`\``;
  });
  
  // Convert attribute references: {attribute} -> (keep as is or remove)
  // Markdown doesn't have attributes, so we'll just remove the braces
  markdown = markdown.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '$1');
  
  // Convert cross-references: <<id,text>> -> [text](#id) or xref:id[text] -> [text](#id)
  markdown = markdown.replace(/<<([^,>]+),([^>]+)>>/g, (match, id, text) => {
    return `[${text}](#${id})`;
  });
  markdown = markdown.replace(/xref:([^\[]+)\[([^\]]+)\]/g, (match, id, text) => {
    return `[${text}](#${id})`;
  });
  
  return markdown;
}

/**
 * Prepare content for AsciiDoc conversion (with metadata)
 */
export async function prepareAsciiDocContent(event: NostrEvent, includeMetadata: boolean = true): Promise<string> {
  if (!event.content || event.content.trim().length === 0) {
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    if (includeMetadata) {
      return await buildAsciiDocWithMetadata(event, 'No content available.');
    }
    return `= ${title}\n\nNo content available.`;
  }
  
  let content = event.content;
  
  // Detect and convert Markdown to AsciiDoc format
  // Check both by event kind and by content detection
  const isMarkdownEvent = event.kind === 30817 || event.kind === 30023;
  const hasMarkdownContent = isMarkdown(content);
  
  // Convert to AsciiDoc if it's a markdown event OR if content is detected as markdown
  if (isMarkdownEvent || (hasMarkdownContent && !isAsciiDoc(content))) {
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
        doc += `:toc:\n`; // Enable table of contents
        doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
        doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
        doc += `:pdf-page-break-mode: auto\n`; // Allow content to flow naturally
        
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
        // Only add abstract section if description or summary actually exists and is not empty
        if (description && description.trim()) {
          // CRITICAL: Block attribute must be directly followed by heading with NO blank line
          doc = doc.trimEnd() + '\n';
          doc += `[abstract]\n== Abstract\n\n`;
          doc += `${description}\n\n`;
        } else if (summary && summary.trim()) {
          // CRITICAL: Block attribute must be directly followed by heading with NO blank line
          doc = doc.trimEnd() + '\n';
          doc += `[abstract]\n== Abstract\n\n`;
          doc += `${summary}\n\n`;
        }
        
        // Add the rest of the content after metadata
        if (restContent.trim()) {
          doc += restContent;
        }
        
        // Process wikilinks and nostr addresses in the content
        doc = processWikilinks(doc, true); // true = asciidoc
        doc = await processNostrAddresses(doc, true, getUserHandle); // true = asciidoc
        
        return doc;
      }
    }
    
    // No existing title, build with metadata
    const eventImage = event.tags.find(([k]) => k === 'image')?.[1];
    let doc = await buildAsciiDocWithMetadata(event, content, eventImage);
    
    // Process wikilinks and nostr addresses in the content
    doc = processWikilinks(doc, true); // true = asciidoc
    doc = await processNostrAddresses(doc, true, getUserHandle); // true = asciidoc
    
    return doc;
  }
  
  // Process wikilinks and nostr addresses even when not including metadata
  content = processWikilinks(content, true); // true = asciidoc
  content = await processNostrAddresses(content, true, getUserHandle); // true = asciidoc
  
  return content;
}

/**
 * Helper: Get book content (for 30040 events) or single event content
 */
async function getEventContent(event: NostrEvent): Promise<{ content: string; title: string; author: string }> {
  if (event.kind === 30040) {
    // For books, fetch all branches and leaves
    const contentEvents = await fetchBookContentEvents(event);
    const combined = await combineBookEvents(event, contentEvents);
    
    if (!combined || combined.trim().length === 0) {
      throw new Error('Book content is empty');
    }
    
    const title = event.tags.find(([k]) => k === 'title')?.[1] || 
                  event.tags.find(([k]) => k === 'T')?.[1] ||
                  event.id.slice(0, 8);
    
    let author = event.tags.find(([k]) => k === 'author')?.[1];
    if (!author) {
      author = await getUserHandle(event.pubkey);
    }
    
    return { content: combined, title, author };
  } else {
    // For regular events, prepare AsciiDoc content
    const content = await prepareAsciiDocContent(event, true);
    const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
    const author = await getAuthorName(event);
    return { content, title, author };
  }
}

/**
 * Extract line number from error message
 * Looks for patterns like "found at line X" or "line X"
 */
function extractLineNumber(errorMessage: string): number | null {
  const match = errorMessage.match(/found at line (\d+)|line (\d+)/i);
  if (match) {
    return parseInt(match[1] || match[2], 10);
  }
  return null;
}

/**
 * Format error message with context lines
 * Shows 10 lines above and below the problematic line, with highlighting
 * Handles multiple errors separated by ';'
 */
function formatErrorWithContext(content: string, errorMessage: string): string {
  const lines = content.split('\n');
  
  // Split errors if multiple are present (separated by ';')
  const errorParts = errorMessage.split(';').map(e => e.trim()).filter(e => e.length > 0);
  
  if (errorParts.length === 0) {
    return errorMessage;
  }
  
  let formattedMessage = '';
  const processedLineNumbers = new Set<number>();
  
  // Process each error
  for (let errorIndex = 0; errorIndex < errorParts.length; errorIndex++) {
    const errorPart = errorParts[errorIndex];
    const lineNumber = extractLineNumber(errorPart);
    
    if (errorIndex > 0) {
      formattedMessage += '\n\n';
    }
    
    formattedMessage += errorPart;
    
    if (lineNumber && !processedLineNumbers.has(lineNumber)) {
      processedLineNumbers.add(lineNumber);
      const errorLineIndex = lineNumber - 1; // Convert to 0-based index
      
      // Calculate context range (10 lines above and below)
      const startLine = Math.max(0, errorLineIndex - 10);
      const endLine = Math.min(lines.length - 1, errorLineIndex + 10);
      
      // Build context display
      formattedMessage += '\n\n--- Context (10 lines above and below) ---\n';
      
      for (let i = startLine; i <= endLine; i++) {
        const lineNum = i + 1; // 1-based line number for display
        const line = lines[i] || ''; // Handle undefined lines
        const isErrorLine = i === errorLineIndex;
        
        // Highlight the error line
        if (isErrorLine) {
          formattedMessage += `>>> ${lineNum.toString().padStart(4, ' ')} | ${line}\n`;
        } else {
          formattedMessage += `    ${lineNum.toString().padStart(4, ' ')} | ${line}\n`;
        }
      }
      
      formattedMessage += '---\n';
      formattedMessage += `(Line ${lineNumber} is marked with >>>)`;
    }
  }
  
  return formattedMessage;
}

/**
 * Helper: Validate AsciiDoc content and return validation messages
 */
function validateAsciiDocContent(content: string, throwOnError: boolean = false): { errors?: string[]; warnings?: string[] } {
  const validation = validateAsciiDoc(content);
  const validationMessages: { errors?: string[]; warnings?: string[] } = {};
  
  if (!validation.valid) {
    // Format error with context
    const formattedError = formatErrorWithContext(content, validation.error || 'Unknown error');
    const errorMsg = `Invalid AsciiDoc syntax: ${formattedError}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    
    if (validation.error) {
      validationMessages.errors = [validation.error];
    }
    console.error('AsciiDoc validation error:', validation.error);
    if (throwOnError) {
      throw new Error(errorMsg);
    }
  }
  
  if (validation.warnings && validation.warnings.length > 0) {
    validationMessages.warnings = validation.warnings;
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  return validationMessages;
}


/**
 * Helper: Generate filename with timestamp
 */
function generateFilename(title: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15);
  return `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.${extension}`;
}


/**
 * Download article as EPUB
 */
/**
 * Get EPUB blob (for viewing)
 */
export async function getEPUBBlob(event: NostrEvent): Promise<{ blob: Blob; filename: string }> {
  let { content, title, author } = await getEventContent(event);
  
  // Apply full QC processing to fix empty headings, missing heading levels, and other issues
  content = await processContentQualityAsync(content, event, true);
  
  validateAsciiDocContent(content, true);
  
  const blob = await exportToEPUB({ content, title, author });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
  }
  
  const filename = generateFilename(title, 'epub');
  return { blob, filename };
}

/**
 * Download EPUB (renamed from viewAsEPUB - viewer removed)
 */
export async function downloadAsEPUB(event: NostrEvent, filename?: string): Promise<void> {
  const { blob, filename: defaultFilename } = await getEPUBBlob(event);
  const name = filename || defaultFilename;
  downloadBlob(blob, name);
}

/**
 * Download article as HTML5
 */
/**
 * Get HTML5 blob (for viewing)
 */
export async function getHTML5Blob(event: NostrEvent): Promise<{ blob: Blob; filename: string }> {
  let { content, title, author } = await getEventContent(event);
  
  if (!content || content.trim().length === 0) {
    throw new Error('Failed to prepare content');
  }
  
  // Apply full QC processing to fix empty headings, missing heading levels, and other issues
  content = await processContentQualityAsync(content, event, true);
  
  validateAsciiDocContent(content, true);
  
  const blob = await exportToHTML5({ content, title, author });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  const filename = generateFilename(title, 'html');
  return { blob, filename };
}

/**
 * Download HTML5 (renamed from viewAsHTML5 - viewer removed)
 */
export async function downloadAsHTML5(event: NostrEvent, filename?: string): Promise<void> {
  const { blob, filename: defaultFilename } = await getHTML5Blob(event);
  const name = filename || defaultFilename;
  downloadBlob(blob, name);
}





/**
 * Fetch all 30040 (branches) and 30041 (leaves) events referenced by a 30040 index event
 * 30041 events can be referenced via 'a' tags (usually) or 'e' tags
 * 30040 events are referenced via 'a' tags
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

  // Extract all 'e' tags which might reference 30041 events (leaves)
  const eventIds = indexEvent.tags
    .filter(([tag]) => tag === 'e')
    .map(([, eventId]) => eventId)
    .filter(Boolean)
    .filter(id => id !== indexEvent.id) // Prevent self-reference
    .filter(id => !visitedIds.has(id)); // Prevent circular references

  // Extract all 'a' tags which can reference 30040 (branches) or 30041 (leaves, usually)
  const aTags = indexEvent.tags
    .filter(([tag]) => tag === 'a')
    .map(([, aTag]) => aTag)
    .filter(Boolean);

  const allEvents: NostrEvent[] = [];

  // Fetch events referenced by 'a' tags (30040 branches and 30041 leaves, usually)
  if (aTags.length > 0) {
    try {
      // Build filters for each a-tag - can be 30040 or 30041
      const aTagFilters: any[] = [];
      for (const aTag of aTags) {
        const [kindStr, pubkey, dTag] = aTag.split(':');
        if (kindStr && pubkey && dTag) {
          const kind = parseInt(kindStr, 10);
          // Fetch both 30040 (branches) and 30041 (leaves) via a-tags
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

        // Process branches (30040) - recursively fetch their content
        for (const branchEvent of result.events.filter(e => e.kind === 30040)) {
          if (!currentVisited.has(branchEvent.id)) {
            // Add branch event itself
            allEvents.push(branchEvent);
            // Recursively fetch its content (branches and leaves)
            const nestedContent = await fetchBookContentEvents(branchEvent, currentVisited);
            allEvents.push(...nestedContent);
          }
        }

        // Process leaves (30041) - just add them
        allEvents.push(...result.events.filter(e => e.kind === 30041));
      }
    } catch (error) {
      console.error('Failed to fetch book content events (a-tags):', error);
    }
  }

  // Fetch events referenced by 'e' tags (30041 leaves, fallback)
  if (eventIds.length > 0) {
    try {
      // Query events by IDs - use a single filter with all IDs
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
            
            result.events.push(...individualResult.events.filter(e => e.kind === 30041));
          } catch (e) {
            console.warn(`Failed to fetch event ${id}:`, e);
          }
        }
      }

      // Only add events that weren't already added via a-tags
      const existingIds = new Set(allEvents.map(e => e.id));
      allEvents.push(...result.events.filter(e => e.kind === 30041 && !existingIds.has(e.id)));
    } catch (error) {
      console.error('Failed to fetch book content events (e-tags):', error);
    }
  }

  if (allEvents.length === 0) {
    return [];
  }

  // Sort by the order in the index event's tags
  // First process a-tags (usually), then e-tags (fallback)
  const orderMap = new Map<string, number>();
  let orderIndex = 0;
  
  // Add a-tag order (for both branches and leaves)
  aTags.forEach((aTag) => {
    const [kindStr, pubkey, dTag] = aTag.split(':');
    if (kindStr && pubkey && dTag) {
      const kind = parseInt(kindStr, 10);
      // We'll match events by their a-tag representation
      const aTagKey = `${kind}:${pubkey}:${dTag}`;
      // Find matching events and assign order
      for (const event of allEvents) {
        if (event.kind === kind && event.pubkey === pubkey) {
          const eventDTag = event.tags.find(([k]) => k === 'd')?.[1];
          if (eventDTag === dTag && !orderMap.has(event.id)) {
            orderMap.set(event.id, orderIndex++);
          }
        }
      }
    }
  });
  
  // Add e-tag order (for leaves not found via a-tags)
  eventIds.forEach((id) => {
    if (!orderMap.has(id)) {
      orderMap.set(id, orderIndex++);
    }
  });

  // Remove duplicates (in case of nested fetching)
  const uniqueEvents = new Map<string, NostrEvent>();
  for (const event of allEvents) {
    if (!uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  return Array.from(uniqueEvents.values()).sort((a, b) => {
    const orderA = orderMap.get(a.id) ?? 999;
    const orderB = orderMap.get(b.id) ?? 999;
    return orderA - orderB;
  });
}

/**
 * Fetch user metadata to get display name/handle
 */
async function getUserHandle(pubkey: string): Promise<string> {
  try {
    // In test environment, skip cache access (indexedDB not available)
    if (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST)) {
      return pubkey.slice(0, 8) + '...';
    }
    
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
 * @param isTopLevel - If true, add book-metadata section. Only true for the root 30040 event.
 */
export async function combineBookEvents(indexEvent: NostrEvent, contentEvents: NostrEvent[], isTopLevel: boolean = true): Promise<string> {
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
  // Following Asciidoctor PDF standard format: https://docs.asciidoctor.org/pdf-converter/latest/title-page/
  const displayTitle = title || 'Untitled';
  let doc = `= ${displayTitle}\n`;
  doc += `:author: ${author}\n`;
  doc += `:doctype: ${type}\n`;
  doc += `:toc: macro\n`; // Use macro TOC so we can control placement (appears after cover)
  doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
  doc += `:imagesdir: .\n`; // Set images directory to current (for relative image paths)
  
  // Use standard Asciidoctor revision attributes for title page
  // https://docs.asciidoctor.org/pdf-converter/latest/title-page/
  if (version || versionTag) {
    doc += `:revnumber: ${version || versionTag}\n`;
  }
  if (publishedOn) {
    doc += `:revdate: ${publishedOn}\n`;
  }
  if (publishedBy) {
    // Use revremark for publisher or other revision notes
    doc += `:revremark: Published by ${publishedBy}\n`;
  }
  
  // Additional metadata attributes
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
  
  doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
  
  // Use standard Asciidoctor cover image attribute for PDF
  // https://docs.asciidoctor.org/pdf-converter/latest/theme/covers/
  if (image) {
    doc += `:front-cover-image: ${image}\n`;
  }
  
  // Title page is automatically created by Asciidoctor when doctype: book is set
  // It will automatically display: doctitle, author, revnumber, revdate, revremark
  // However, for HTML and EPUB, we need to create an explicit cover page with title and image
  
  // Add cover page with title and cover image (for HTML and EPUB)
  // This MUST be the first section after the document header to avoid being moved to preamble
  // Use discrete section with cover-page class for clean, centered layout
  doc += `\n[discrete]\n[.cover-page]\n== ${displayTitle}\n\n`;
  
  // Add cover image if available
  if (image) {
    // Ensure image URL is absolute (required for EPUB to work properly)
    // The Asciidoctor server will automatically download remote images and embed them in the EPUB
    // For absolute URLs (http:// or https://), the server downloads the image and includes it in EPUB assets
    const imageUrl = image.startsWith('http://') || image.startsWith('https://') 
      ? image 
      : image; // Keep original URL - Asciidoctor server should handle it
    
    // For HTML: maxwidth=500px (max-width constraint, won't enlarge small images)
    // For EPUB: scaledwidth=50% to fit on one page, prevent splitting
    // The 'cover' role helps identify this as the cover image for EPUB metadata
    // Using maxwidth instead of width ensures small images stay small
    doc += `image::${imageUrl}[cover,maxwidth=500px,scaledwidth=50%,align=center]\n\n`;
  }
  
  // Add author below image on cover page (centered, compact)
  if (author) {
    doc += `[.cover-author]\n${author}\n\n`;
  }
  
  // Place TOC after the cover page
  // The toc::[] macro must be on its own line with proper spacing
  doc += `\ntoc::[]\n\n`;
  
  // Add metadata page (only show fields that have content)
  // IMPORTANT: This appears ONCE for the entire book, right after the document header
  const metadataFields: Array<{ label: string; value: string }> = [];
  
  // Add the document title from the 'title' tag (NKBIP-01)
  if (title && title.trim()) {
    metadataFields.push({ label: 'Title', value: title });
  }
  
  // Collect bookstr tags (only if they exist and have content)
  // Note: 't' (lowercase) is NOT a bookstr tag - it's an NKBIP-01 topic tag, handled separately
  const bookstrTagNames: Record<string, string> = {
    'C': 'Collection',
    'T': 'Book Title', // NKBIP-08 book title (different from document title)
    'c': 'chapter',
    's': 'section',
    'v': 'version'
  };

  const bookstrTagTypes = ['C', 'T', 'c', 's', 'v'];
  for (const tagType of bookstrTagTypes) {
    const tagValues = indexEvent.tags
      .filter(([k]) => k === tagType)
      .map(([, v]) => v)
      .filter(Boolean);
    
    if (tagValues.length > 0) {
      const tagName = bookstrTagNames[tagType] || tagType;
      // Format values nicely
      const formattedValues = tagValues.map(v => {
        // Title case for display
        return v.split(/[-_\s]+/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }).join(', ');
      metadataFields.push({ label: tagName, value: formattedValues });
    }
  }
  
  // Add other metadata fields only if they exist and have content
  if (version || versionTag) {
    metadataFields.push({ label: 'Version', value: version || versionTag || '' });
  }
  if (publishedOn) {
    metadataFields.push({ label: 'Published On', value: publishedOn });
  }
  if (publishedBy) {
    metadataFields.push({ label: 'Publisher', value: publishedBy });
  }
  if (isbn) {
    metadataFields.push({ label: 'ISBN', value: isbn });
  }
  if (source) {
    metadataFields.push({ label: 'Source', value: source });
  }
  // Add "Original author:" field with display name, falling back to name, falling back to npub
  if (originalAuthorTag) {
    try {
      // Check cache first
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = contentCache.getEvents('metadata');
      const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === originalAuthorTag && cached.event.kind === 0);
      
      let originalAuthorValue: string;
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
          originalAuthorValue = content.display_name || content.name || nip19.npubEncode(originalAuthorTag);
        } catch (e) {
          // If parsing fails, fallback to npub
          originalAuthorValue = nip19.npubEncode(originalAuthorTag);
        }
      } else {
        // If not in cache, fetch from relays
        const result = await relayService.queryEvents(
          'anonymous',
          'metadata-read',
          [{ kinds: [0], authors: [originalAuthorTag], limit: 1 }],
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
            originalAuthorValue = content.display_name || content.name || nip19.npubEncode(originalAuthorTag);
          } catch (e) {
            // If parsing fails, fallback to npub
            originalAuthorValue = nip19.npubEncode(originalAuthorTag);
          }
        } else {
          // No metadata found, use npub
          originalAuthorValue = nip19.npubEncode(originalAuthorTag);
        }
      }
      metadataFields.push({ label: 'Original author:', value: originalAuthorValue });
    } catch (e) {
      // If everything fails, fallback to npub
      const npub = nip19.npubEncode(originalAuthorTag);
      metadataFields.push({ label: 'Original author:', value: npub });
    }
  }
  if (originalEventTag) {
    metadataFields.push({ label: 'Original Event', value: originalEventTag });
  }
  if (topicTags.length > 0) {
    // Topics from 't' tags are genres/subjects, not keywords
    metadataFields.push({ label: 'Genre', value: topicTags.join(', ') });
  }
  if (bookReference) {
    metadataFields.push({ label: 'Book Reference', value: bookReference });
  }
  
  // Add "Issued by" field with display name, falling back to name, falling back to npub
  try {
    // Check cache first
    const { contentCache } = await import('$lib/contentCache');
    const cachedEvents = contentCache.getEvents('metadata');
    const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === indexEvent.pubkey && cached.event.kind === 0);
    
    let issuedByValue: string;
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
        issuedByValue = content.display_name || content.name || nip19.npubEncode(indexEvent.pubkey);
      } catch (e) {
        // If parsing fails, fallback to npub
        issuedByValue = nip19.npubEncode(indexEvent.pubkey);
      }
    } else {
      // If not in cache, fetch from relays
      const result = await relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [indexEvent.pubkey], limit: 1 }],
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
          issuedByValue = content.display_name || content.name || nip19.npubEncode(indexEvent.pubkey);
        } catch (e) {
          // If parsing fails, fallback to npub
          issuedByValue = nip19.npubEncode(indexEvent.pubkey);
        }
      } else {
        // No metadata found, use npub
        issuedByValue = nip19.npubEncode(indexEvent.pubkey);
      }
    }
    metadataFields.push({ label: 'Issued by:', value: issuedByValue });
  } catch (e) {
    // If everything fails, fallback to npub
    const npub = nip19.npubEncode(indexEvent.pubkey);
    metadataFields.push({ label: 'Issued by:', value: npub });
  }

  // Add metadata page only if there are fields to display
  // IMPORTANT: This section should appear ONLY ONCE for the entire book, before any content
  // Only add for the top-level 30040 event, not for nested branches
  if (metadataFields.length > 0 && isTopLevel) {
    // CRITICAL: Block attribute must be directly followed by heading with NO blank line
    // Remove ALL trailing whitespace/newlines from doc completely
    doc = doc.replace(/\s+$/, '');
    // Add exactly one newline to separate from header attributes, then attribute and heading on CONSECUTIVE lines
    // Format: \n[.book-metadata]\n== Book Metadata\n\n
    // IMPORTANT: The \n after [.book-metadata] must go DIRECTLY to the heading line with NO blank line
    // Build the string explicitly to ensure no extra whitespace
    doc += '\n';
    doc += '[.book-metadata]';
    doc += '\n';
    doc += '== Book Metadata';
    doc += '\n\n';
    for (const field of metadataFields) {
      if (field.value && field.value.trim()) {
        doc += `*${field.label}:* ${field.value}\n\n`;
      }
    }
    doc += `\n`;
  }

  // Add abstract/description after metadata page
  if (description && description.trim()) {
    // CRITICAL: Block attribute must be directly followed by heading with NO blank line
    doc = doc.trimEnd() + '\n';
    doc += `[abstract]\n== Abstract\n\n`;
    doc += `${description}\n\n`;
  } else if (summary && summary.trim()) {
    // CRITICAL: Block attribute must be directly followed by heading with NO blank line
    doc = doc.trimEnd() + '\n';
    doc += `[abstract]\n== Abstract\n\n`;
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
    
    doc += adjustedContent;
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
 * Download book (30040) as EPUB with all branches and leaves
 */
export async function downloadBookAsEPUB(indexEvent: NostrEvent, filename?: string): Promise<void> {
  let { content, title, author } = await getEventContent(indexEvent);
  
  // Apply full QC processing to fix empty headings, missing heading levels, and other issues
  content = await processContentQualityAsync(content, indexEvent, true);
  
  validateAsciiDocContent(content, true);
  
  const blob = await exportToEPUB({ content, title, author });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
  }
  
  const name = filename || generateFilename(title, 'epub');
  downloadBlob(blob, name);
}

/**
 * Combine multiple book search results into a single document
 */
async function combineBookSearchResults(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null
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
  let doc = `= ${title}\n`;
  doc += `:author: ${author}\n`;
  doc += `:doctype: book\n`;
  doc += `:toc:\n`; // Enable table of contents
  doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
  doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
  doc += `\n`;
  
  // Create styled title page
  // CRITICAL: Block attribute must be directly followed by heading with NO blank line
  doc = doc.trimEnd() + '\n';
  doc += `[.title-page]\n== ${title}\n\n`;
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
      
      doc += adjustedContent;
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
 * Download book search results as EPUB
 */
export async function downloadBookSearchResultsAsEPUB(
  results: NostrEvent[],
  parsedQuery: { references: any[]; version?: string; versions?: string[] } | null,
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
  const title = `${queryTitle}${versionStr}`;
  
  const firstEvent = results[0];
  let author = firstEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = await getUserHandle(firstEvent.pubkey);
  }
  
  try {
    // Apply full QC processing to fix empty headings, missing heading levels, and other issues
    const fixedContent = await processContentQualityAsync(combined, firstEvent, true);
    
    const blob = await exportToEPUB({
      content: fixedContent,
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
 * Fetch all nested 30040 and 30041 events for a 30040 index event
 * Returns a tree structure with the index event and all nested events
 */
async function fetchBookTree(
  indexEvent: NostrEvent,
  visitedIds: Set<string> = new Set()
): Promise<{ index: NostrEvent; branches: Array<{ index: NostrEvent; leaves: NostrEvent[]; branches?: Array<{ index: NostrEvent; leaves: NostrEvent[] }> }>; leaves: NostrEvent[] }> {
  // Prevent circular references
  if (visitedIds.has(indexEvent.id)) {
    return { index: indexEvent, branches: [], leaves: [] };
  }

  const currentVisited = new Set(visitedIds);
  currentVisited.add(indexEvent.id);

  // Extract all 'e' tags
  const eventIds = indexEvent.tags
    .filter(([tag]) => tag === 'e')
    .map(([, eventId]) => eventId)
    .filter(Boolean)
    .filter(id => id !== indexEvent.id)
    .filter(id => !visitedIds.has(id));

  if (eventIds.length === 0) {
    return { index: indexEvent, branches: [], leaves: [] };
  }

  // Fetch all referenced events
  const result = await relayService.queryEvents(
    'anonymous',
    'wiki-read',
    [{ kinds: [30040, 30041], ids: eventIds }],
    { excludeUserContent: false, currentUserPubkey: undefined }
  );

  // Separate 30040 (branches) and 30041 (leaves)
  const branches: Array<{ index: NostrEvent; leaves: NostrEvent[]; branches?: Array<{ index: NostrEvent; leaves: NostrEvent[]; branches?: Array<{ index: NostrEvent; leaves: NostrEvent[] }> }> }> = [];
  const leaves: NostrEvent[] = [];

  for (const event of result.events) {
    if (event.kind === 30040) {
      // Recursively fetch nested content (including nested branches)
      const nested = await fetchBookTree(event, currentVisited);
      branches.push({ 
        index: event, 
        leaves: nested.leaves,
        branches: nested.branches 
      });
    } else if (event.kind === 30041) {
      leaves.push(event);
    }
  }

  // Sort by order in index event's 'e' tags
  const orderMap = new Map<string, number>();
  eventIds.forEach((id, index) => {
    orderMap.set(id, index);
  });

  branches.sort((a, b) => {
    const orderA = orderMap.get(a.index.id) ?? 999;
    const orderB = orderMap.get(b.index.id) ?? 999;
    return orderA - orderB;
  });

  leaves.sort((a, b) => {
    const orderA = orderMap.get(a.id) ?? 999;
    const orderB = orderMap.get(b.id) ?? 999;
    return orderA - orderB;
  });

  return { index: indexEvent, branches, leaves };
}

/**
 * Convert event metadata to YAML object
 */
function eventToYaml(event: NostrEvent, isTopLevel: boolean = false): any {
  const obj: any = {};

  // Title (priority: title tag, T tag, d tag, id)
  const title = event.tags.find(([k]) => k === 'title')?.[1] ||
                event.tags.find(([k]) => k === 'T')?.[1] ||
                event.tags.find(([k]) => k === 'd')?.[1] ||
                event.id.slice(0, 8);
  obj.title = title;

  // Author (pubkey)
  obj.author = event.pubkey;

  // Summary
  const summary = event.tags.find(([k]) => k === 'summary')?.[1];
  if (summary) obj.summary = summary;

  // For top-level 30040, include C and v and type tags
  if (isTopLevel) {
    const collection = event.tags.find(([k]) => k === 'C')?.[1];
    if (collection) obj.collection = collection;

    const version = event.tags.find(([k]) => k === 'v')?.[1];
    if (version) obj.version = version;

    const type = event.tags.find(([k]) => k === 'type')?.[1];
    if (type) obj.type = type;
  }

  // For all events, include T, c, s tags
  const titleTag = event.tags.find(([k]) => k === 'T')?.[1];
  if (titleTag) obj.T = titleTag;

  const chapter = event.tags.find(([k]) => k === 'c')?.[1];
  if (chapter) obj.c = chapter;

  const sections = event.tags.filter(([k]) => k === 's').map(([, v]) => v);
  if (sections.length > 0) obj.s = sections;

  return obj;
}

/**
 * Convert book tree to YAML structure
 */
function treeToYaml(
  tree: { 
    index: NostrEvent; 
    branches: Array<{ 
      index: NostrEvent; 
      leaves: NostrEvent[]; 
      branches?: Array<{ 
        index: NostrEvent; 
        leaves: NostrEvent[]; 
        branches?: Array<{ index: NostrEvent; leaves: NostrEvent[] }> 
      }> 
    }>; 
    leaves: NostrEvent[] 
  }, 
  isTopLevel: boolean = false
): any {
  const obj = eventToYaml(tree.index, isTopLevel);

  // Add branches (nested 30040s) - recursively process nested branches
  if (tree.branches.length > 0) {
    obj.branches = tree.branches.map(branch => {
      // Recursively process nested branches if they exist
      const nestedBranches = branch.branches || [];
      return treeToYaml({ 
        index: branch.index, 
        branches: nestedBranches, 
        leaves: branch.leaves 
      }, false);
    });
  }

  // Add leaves (30041s)
  if (tree.leaves.length > 0) {
    obj.leaves = tree.leaves.map(leaf => eventToYaml(leaf, false));
  }

  return obj;
}

/**
 * Download book overview as YAML (30040 events only)
 * Exports metadata for the index event and all nested 30040 branches and 30041 leaves
 */
export async function downloadBookOverview(indexEvent: NostrEvent, filename?: string): Promise<void> {
  if (indexEvent.kind !== 30040) {
    throw new Error('downloadBookOverview can only be used with 30040 index events');
  }

  // Fetch the entire tree structure
  const tree = await fetchBookTree(indexEvent);

  // Convert to YAML structure
  const yamlObj = treeToYaml(tree, true);

  // Convert to YAML string (simple implementation)
  function objToYaml(obj: any, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    let yaml = '';

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        yaml += `${spaces}${key}:\n`;
        for (const item of value) {
          if (typeof item === 'object') {
            yaml += `${spaces}  -\n`;
            yaml += objToYaml(item, indent + 2).replace(/^/gm, spaces + '    ');
          } else {
            yaml += `${spaces}  - ${formatYamlValue(item)}\n`;
          }
        }
      } else if (typeof value === 'object') {
        yaml += `${spaces}${key}:\n`;
        yaml += objToYaml(value, indent + 1);
      } else {
        yaml += `${spaces}${key}: ${formatYamlValue(value)}\n`;
      }
    }

    return yaml;
  }

  function formatYamlValue(value: any): string {
    if (typeof value === 'string') {
      // Escape special characters and wrap in quotes if needed
      if (value.includes(':') || value.includes('#') || value.includes('|') || value.includes('&') || value.includes('*') || value.includes('!') || value.includes('%') || value.includes('@') || value.includes('`')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }

  const yamlContent = objToYaml(yamlObj);

  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] ||
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  const name = filename || `${title.replace(/[^a-z0-9]/gi, '_')}_overview.yaml`;
  const blob = new Blob([yamlContent], { type: 'text/yaml' });
  downloadBlob(blob, name);
}

