/**
 * Article and Book download utilities
 * Handles downloading articles and books in various formats
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';
import { relayService } from '$lib/relayService';
import { exportToPDF, exportToEPUB, exportToHTML5, exportToLaTeX, downloadBlob, openInViewer } from './asciidoctorExport';
import {
  processContentQuality,
  processContentQualityAsync,
  processWikilinks,
  processNostrAddresses,
  getTitleFromEvent,
  fixHeaderSpacing,
  fixMissingHeadingLevels,
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
  doc += `:pdf-page-break-mode: auto\n`; // Allow content to flow naturally
  
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
  
  // Add description as abstract if available
  if (description) {
    doc += `[abstract]\n`;
    doc += `== Abstract\n\n`;
    doc += `${description}\n\n`;
  } else if (summary) {
    doc += `[abstract]\n`;
    doc += `== Abstract\n\n`;
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
        if (description) {
          doc += `[abstract]\n`;
          doc += `== Abstract\n\n`;
          doc += `${description}\n\n`;
        } else if (summary) {
          doc += `[abstract]\n`;
          doc += `== Abstract\n\n`;
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
 * Get PDF blob (for viewing)
 */
export async function getPDFBlob(event: NostrEvent): Promise<{ blob: Blob; filename: string }> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot generate PDF: article content is empty');
  }
  
  // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  // Always log to console
  if (!validation.valid) {
    const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    console.error('AsciiDoc validation error:', validation.error);
    if (validation.warnings && validation.warnings.length > 0) {
      console.warn('AsciiDoc warnings:', validation.warnings);
    }
    throw new Error(errorMsg);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    // Always log to console
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = await getAuthorName(event);
  
  const blob = await exportToPDF({
    content: asciiDocContent,
    title,
    author,
  });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty PDF file');
  }
  
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.pdf`;
  return { blob, filename };
}

export async function downloadAsPDF(event: NostrEvent, filename?: string): Promise<void> {
  const { blob, filename: defaultFilename } = await getPDFBlob(event);
  const name = filename || defaultFilename;
  downloadBlob(blob, name);
}

/**
 * View PDF in browser tab
 */
export async function viewAsPDF(event: NostrEvent): Promise<void> {
  // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  
  // Always log to console
  if (!validation.valid && validation.error) {
    console.error('AsciiDoc validation error:', validation.error);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const { blob, filename } = await getPDFBlob(event);
  
  // Open PDF in new browser tab
  const url = URL.createObjectURL(blob);
  const newWindow = window.open(url, '_blank');
  if (!newWindow) {
    // If popup blocked, fall back to download
    downloadBlob(blob, filename);
    URL.revokeObjectURL(url);
  } else {
    // Clean up URL when window closes (best effort)
    newWindow.addEventListener('beforeunload', () => {
      URL.revokeObjectURL(url);
    });
  }
}

/**
 * Download article as EPUB
 */
/**
 * Get EPUB blob (for viewing)
 */
export async function getEPUBBlob(event: NostrEvent): Promise<{ blob: Blob; filename: string }> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot generate EPUB: article content is empty');
  }
  
  // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  if (!validation.valid) {
    const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    throw new Error(errorMsg);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = await getAuthorName(event);
  
  const blob = await exportToEPUB({
    content: asciiDocContent,
    title,
    author,
  });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty EPUB file');
  }
  
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.epub`;
  return { blob, filename };
}

export async function downloadAsEPUB(event: NostrEvent, filename?: string): Promise<void> {
  const { blob, filename: defaultFilename } = await getEPUBBlob(event);
  const name = filename || defaultFilename;
  downloadBlob(blob, name);
}

/**
 * View EPUB in e-book viewer
 */
export async function viewAsEPUB(event: NostrEvent): Promise<void> {
  // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  const validationMessages: { errors?: string[]; warnings?: string[] } = {};
  
  // Always log to console AND pass to viewer
  if (!validation.valid && validation.error) {
    validationMessages.errors = [validation.error];
    console.error('AsciiDoc validation error:', validation.error);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    validationMessages.warnings = validation.warnings;
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const { blob, filename } = await getEPUBBlob(event);
  await openInViewer(blob, filename, 'epub', validationMessages);
}

/**
 * Download article as HTML5
 */
/**
 * Get HTML5 blob (for viewing)
 */
export async function getHTML5Blob(event: NostrEvent): Promise<{ blob: Blob; filename: string }> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot generate HTML5: article content is empty');
  }
  
  // Prepare AsciiDoc content with metadata
  // This converts Markdown (30817, 30023) to AsciiDoc and wraps with metadata
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Verify AsciiDoc content was created
  if (!asciiDocContent || asciiDocContent.trim().length === 0) {
    throw new Error('Failed to prepare AsciiDoc content');
  }
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  if (!validation.valid) {
    const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    throw new Error(errorMsg);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = await getAuthorName(event);
  
  // Send AsciiDoc content to AsciiDoctor server and request HTML
  const blob = await exportToHTML5({
    content: asciiDocContent,
    title,
    author
  });
  
  if (!blob || blob.size === 0) {
    throw new Error('Server returned empty HTML file');
  }
  
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.html`;
  return { blob, filename };
}

export async function downloadAsHTML5(event: NostrEvent, filename?: string): Promise<void> {
  const { blob, filename: defaultFilename } = await getHTML5Blob(event);
  const name = filename || defaultFilename;
  downloadBlob(blob, name);
}

/**
 * View HTML5 in browser tab
 */
export async function viewAsHTML5(event: NostrEvent): Promise<void> {
  const { blob, filename } = await getHTML5Blob(event);
  
  // Open HTML in new browser tab
  const url = URL.createObjectURL(blob);
  const newWindow = window.open(url, '_blank');
  if (!newWindow) {
    // If popup blocked, fall back to download
    downloadBlob(blob, filename);
    URL.revokeObjectURL(url);
  } else {
    // Clean up URL when window closes (best effort)
    newWindow.addEventListener('beforeunload', () => {
      URL.revokeObjectURL(url);
    });
  }
}

/**
 * View Markdown in e-book viewer
 */
export async function viewAsMarkdown(event: NostrEvent): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot view Markdown: article content is empty');
  }
  
  // Get the processed markdown content
  let content: string;
  if (event.kind === 30023 || event.kind === 30817) {
    // Markdown events - process quality control
    content = await processContentQualityAsync(event.content, event, false);
  } else {
    // Convert from AsciiDoc to Markdown (using existing function)
    content = convertAsciiDocToMarkdown(event.content);
    // Apply basic quality control
    content = processContentQuality(content, event, false);
  }
  
  // Validate content (convert to AsciiDoc for validation if needed)
  let validationMessages: { errors?: string[]; warnings?: string[] } = {};
  try {
    // Convert markdown to AsciiDoc for validation
    const asciiDocForValidation = convertMarkdownToAsciiDoc(content);
    const validation = validateAsciiDoc(asciiDocForValidation);
    // Always log to console AND pass to viewer
    if (!validation.valid && validation.error) {
      validationMessages.errors = [validation.error];
      console.error('Markdown validation error:', validation.error);
    }
    if (validation.warnings && validation.warnings.length > 0) {
      validationMessages.warnings = validation.warnings;
      console.warn('Markdown warnings:', validation.warnings);
    }
  } catch (error) {
    // If validation fails, just log it
    console.warn('Failed to validate markdown content:', error);
  }
  
  const title = getTitleFromEvent(event);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.md`;
  const blob = new Blob([content], { type: 'text/markdown' });
  await openInViewer(blob, filename, 'markdown', validationMessages);
}

/**
 * View AsciiDoc in e-book viewer
 */
export async function viewAsAsciiDoc(event: NostrEvent): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot view AsciiDoc: article content is empty');
  }
  
  // Get the processed asciidoc content
  let content: string;
  if (event.kind === 30023 || event.kind === 30817) {
    // Markdown events - convert to AsciiDoc (using existing function)
    content = convertMarkdownToAsciiDoc(event.content);
    // Apply basic quality control
    content = processContentQuality(content, event, true);
  } else {
    // AsciiDoc events - process quality control
    content = await processContentQualityAsync(event.content, event, true);
  }
  
  // Validate AsciiDoc content
  const validation = validateAsciiDoc(content);
  const validationMessages: { errors?: string[]; warnings?: string[] } = {};
  // Always log to console AND pass to viewer
  if (!validation.valid && validation.error) {
    validationMessages.errors = [validation.error];
    console.error('AsciiDoc validation error:', validation.error);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    validationMessages.warnings = validation.warnings;
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  const title = getTitleFromEvent(event);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2, 15); // yymmddHHmmss
  const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.adoc`;
  const blob = new Blob([content], { type: 'text/asciidoc' });
  await openInViewer(blob, filename, 'asciidoc', validationMessages);
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
    const asciiDocContent = await prepareAsciiDocContent(event, true);
    
    // Validate AsciiDoc content before exporting
    const validation = validateAsciiDoc(asciiDocContent);
    if (!validation.valid) {
      const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
      throw new Error(errorMsg);
    }
    if (validation.warnings && validation.warnings.length > 0) {
      console.warn('AsciiDoc warnings:', validation.warnings);
    }
    
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
 * View LaTeX in e-book viewer (converts to PDF first)
 */
export async function viewAsLaTeX(event: NostrEvent): Promise<void> {
  if (!event.content || event.content.trim().length === 0) {
    throw new Error('Cannot view LaTeX: article content is empty');
  }
  
  // Prepare AsciiDoc content with metadata (includes cover image, abstract, etc.)
  const asciiDocContent = await prepareAsciiDocContent(event, true);
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(asciiDocContent);
  const validationMessages: { errors?: string[]; warnings?: string[] } = {};
  
  // Always log to console AND pass to viewer
  if (!validation.valid && validation.error) {
    validationMessages.errors = [validation.error];
    console.error('AsciiDoc validation error:', validation.error);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    validationMessages.warnings = validation.warnings;
    console.warn('AsciiDoc warnings:', validation.warnings);
  }
  
  // Get PDF blob
  const { blob, filename } = await getPDFBlob(event);
  
  // Also get LaTeX blob for download option
  const title = event.tags.find(([k]) => k === 'title')?.[1] || event.id.slice(0, 8);
  const author = await getAuthorName(event);
  const latexBlob = await exportToLaTeX({
    content: asciiDocContent,
    title,
    author
  });
  
  await openInViewer(blob, filename, 'pdf', validationMessages, latexBlob);
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
  doc += `:toc:\n`; // Enable table of contents
  doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
  
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
  
  doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
  doc += `:pdf-page-break-mode: auto\n`; // Allow content to flow naturally
  
  if (image) {
    // Set as cover image for title page
    doc += `:front-cover-image: ${image}\n`;
  }
  
  doc += `\n`;
  
  // Add abstract/description after title page
  if (description) {
    doc += `[abstract]\n`;
    doc += `== Abstract\n\n`;
    doc += `${description}\n\n`;
  } else if (summary) {
    doc += `[abstract]\n`;
    doc += `== Abstract\n\n`;
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
 * Download book (30040) as PDF with all branches and leaves
 */
export async function downloadBookAsPDF(indexEvent: NostrEvent, filename?: string): Promise<void> {
  const contentEvents = await fetchBookContentEvents(indexEvent);
  const combined = await combineBookEvents(indexEvent, contentEvents);
  
  if (!combined || combined.trim().length === 0) {
    throw new Error('Cannot download PDF: book content is empty');
  }
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(combined);
  if (!validation.valid) {
    const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    throw new Error(errorMsg);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('AsciiDoc warnings:', validation.warnings);
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
  
  // Validate AsciiDoc content before exporting
  const validation = validateAsciiDoc(combined);
  if (!validation.valid) {
    const errorMsg = `Invalid AsciiDoc syntax: ${validation.error}${validation.warnings ? '\nWarnings: ' + validation.warnings.join('; ') : ''}\n\nPlease fix the AsciiDoc syntax errors and try again.`;
    throw new Error(errorMsg);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('AsciiDoc warnings:', validation.warnings);
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
  doc += `:pdf-themesdir: /app/deployment\n`;
  doc += `:toc:\n`; // Enable table of contents
  doc += `:stem:\n`; // Enable STEM (math) support for LaTeX rendering
  doc += `:page-break-mode: auto\n`; // Reduce unnecessary page breaks
  doc += `:pdf-page-break-mode: auto\n`; // Allow content to flow naturally
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
 * Download book search results as PDF
 */
export async function downloadBookSearchResultsAsPDF(
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
  const combined = await combineBookEvents(indexEvent, contentEvents);
  
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

