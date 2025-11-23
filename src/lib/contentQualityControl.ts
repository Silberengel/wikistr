/**
 * Content Quality Control Service
 * Provides functions to ensure content quality for Markdown and AsciiDoc formats
 */

import { parseBookWikilink } from './bookWikilinkParser';
import type { ParsedBookReference } from './bookWikilinkParser';
import { formatSections } from './utils';

/**
 * Fix missing spaces after hash/equals signs in headers
 * Handles cases like "##Chapter 2" -> "## Chapter 2"
 * 
 * Note: Single hash/equals (# or =) are NOT fixed unless they're at the beginning
 * of a section that's missing a heading, as they might be normal text like hashtags.
 */
export function fixHeaderSpacing(content: string): string {
  if (!content || content.trim().length === 0) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    
    // Check for markdown headers without space: ##Text, ###Text, etc. (but NOT #Text)
    if (/^##+\w/.test(trimmed)) {
      // Has 2+ hash signs followed immediately by a word character
      const match = trimmed.match(/^(#+)(\w)/);
      if (match) {
        const hashes = match[1];
        // Only fix if it's 2 or more hashes (single # might be a hashtag)
        if (hashes.length >= 2) {
          const rest = trimmed.substring(hashes.length);
          const indent = line.substring(0, line.length - trimmed.length);
          line = indent + hashes + ' ' + rest;
        }
      }
    }
    
    // Check for AsciiDoc headers without space: ==Text, ===Text, etc. (but NOT =Text)
    if (/^==+\w/.test(trimmed)) {
      // Has 2+ equals signs followed immediately by a word character
      const match = trimmed.match(/^(=+)(\w)/);
      if (match) {
        const equals = match[1];
        // Only fix if it's 2 or more equals (single = might be normal text)
        if (equals.length >= 2) {
          const rest = trimmed.substring(equals.length);
          const indent = line.substring(0, line.length - trimmed.length);
          line = indent + equals + ' ' + rest;
        }
      }
    }
    
    // Special case: Single # or = at the beginning of a line that looks like it should be a header
    // Only fix if it's at the start of a section (after blank line or at document start)
    // and the next non-empty line is not a header
    if (/^[#=]\w/.test(trimmed)) {
      const isAtSectionStart = i === 0 || (i > 0 && lines[i - 1].trim().length === 0);
      const hasNextHeader = i < lines.length - 1 && /^[#=]+\s+/.test(lines[i + 1].trim());
      
      // Only fix if it's at section start and there's no next header (likely a missing header)
      if (isAtSectionStart && !hasNextHeader) {
        const match = trimmed.match(/^([#=])(\w)/);
        if (match) {
          const prefix = match[1];
          const rest = trimmed.substring(1);
          const indent = line.substring(0, line.length - trimmed.length);
          line = indent + prefix + ' ' + rest;
        }
      }
    }
    
    fixed.push(line);
  }
  
  return fixed.join('\n');
}

/**
 * Extract heading level from a line (and optionally the next line for Setext headers)
 * Returns 0 if not a heading, 1-6 for markdown (#), 1-6 for asciidoc (=)
 * For Setext headers, returns { level: number, isSetext: boolean, textLine: number }
 */
function getHeadingLevel(line: string, nextLine?: string): number | { level: number; isSetext: boolean; textLine: number } {
  const trimmed = line.trim();
  
  // Markdown ATX header: #, ##, ###, etc.
  const markdownMatch = trimmed.match(/^#+\s+/);
  if (markdownMatch) {
    return markdownMatch[0].trim().length;
  }
  
  // AsciiDoc header: =, ==, ===, etc.
  const asciidocMatch = trimmed.match(/^=+\s+/);
  if (asciidocMatch) {
    return asciidocMatch[0].trim().length;
  }
  
  // Markdown Setext headers: text followed by === (level 1) or --- (level 2)
  if (nextLine !== undefined) {
    const nextTrimmed = nextLine.trim();
    // Level 1: text followed by ===
    if (/^=+$/.test(nextTrimmed) && nextTrimmed.length >= 3) {
      return { level: 1, isSetext: true, textLine: 0 };
    }
    // Level 2: text followed by ---
    if (/^-+$/.test(nextTrimmed) && nextTrimmed.length >= 3) {
      return { level: 2, isSetext: true, textLine: 0 };
    }
  }
  
  return 0;
}

/**
 * Ensure no missing heading levels
 * If a level-N heading exists, ensure level (N-1) exists before it
 * Works recursively - only adds the immediate parent level, higher levels get fixed in next iteration
 * Note: Document-level header (level 1) counts as level 1, so we don't add another
 */
export function fixMissingHeadingLevels(content: string): string {
  if (!content || content.trim().length === 0) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  const headingHistory: number[] = []; // Track heading levels we've seen (in order)
  let hasDocLevelHeader = false; // Track if we've seen a document-level header (level 1)
  
  for (let i = 0; i < lines.length; i++) {
    const nextLine = i < lines.length - 1 ? lines[i + 1] : undefined;
    const headingInfo = getHeadingLevel(lines[i], nextLine);
    
    // Handle Setext headers (they span two lines)
    if (typeof headingInfo === 'object' && headingInfo.isSetext) {
      const level = headingInfo.level;
      const isMarkdown = true; // Setext is always markdown
      const prefix = '#';
      
      // Check if this is a document-level header
      if (level === 1) {
        hasDocLevelHeader = true;
      }
      
      // Only check for the immediate parent level (level - 1)
      const parentLevel = level - 1;
      
      if (parentLevel >= 1) {
        // Skip if parent level is 1 and we have a doc-level header
        const needsParent = !(parentLevel === 1 && hasDocLevelHeader);
        
        if (needsParent) {
          // Check if parent level exists in history before this point
          let parentExists = false;
          for (let j = 0; j < headingHistory.length; j++) {
            if (headingHistory[j] === parentLevel) {
              parentExists = true;
              break;
            }
          }
          
          // If parent doesn't exist, add it (only the immediate parent, one level up)
          if (!parentExists) {
            const parentPrefix = prefix.repeat(parentLevel);
            const genericTitle = `Section ${parentLevel}`;
            fixed.push(`${parentPrefix} ${genericTitle}`);
            headingHistory.push(parentLevel);
          }
        }
      }
      
      // Add the Setext header (both lines)
      fixed.push(lines[i]);
      if (nextLine !== undefined) {
        fixed.push(nextLine);
        i++; // Skip the next line as we've already processed it
      }
      
      // Update history
      for (let j = headingHistory.length - 1; j >= 0; j--) {
        if (headingHistory[j] >= level) {
          headingHistory.splice(j, 1);
        }
      }
      headingHistory.push(level);
      continue;
    }
    
    // Handle ATX headers (single line)
    const level = typeof headingInfo === 'number' ? headingInfo : 0;
    
    if (level > 0) {
      // This is a heading
      const isMarkdown = lines[i].trim().startsWith('#');
      const prefix = isMarkdown ? '#' : '=';
      
      // Check if this is a document-level header
      if (level === 1) {
        hasDocLevelHeader = true;
      }
      
      // Only check for the immediate parent level (level - 1)
      const parentLevel = level - 1;
      
      if (parentLevel >= 1) {
        // Skip if parent level is 1 and we have a doc-level header
        const needsParent = !(parentLevel === 1 && hasDocLevelHeader);
        
        if (needsParent) {
          // Check if parent level exists in history before this point
          let parentExists = false;
          for (let j = 0; j < headingHistory.length; j++) {
            if (headingHistory[j] === parentLevel) {
              parentExists = true;
              break;
            }
          }
          
          // If parent doesn't exist, add it (only the immediate parent, one level up)
          if (!parentExists) {
            const parentPrefix = prefix.repeat(parentLevel);
            const genericTitle = `Section ${parentLevel}`;
            fixed.push(`${parentPrefix} ${genericTitle}`);
            headingHistory.push(parentLevel);
          }
        }
      }
      
      // Add the current heading
      fixed.push(lines[i]);
      
      // Update history: remove any levels >= current level (they're no longer in scope)
      // Then add current level
      for (let j = headingHistory.length - 1; j >= 0; j--) {
        if (headingHistory[j] >= level) {
          headingHistory.splice(j, 1);
        }
      }
      headingHistory.push(level);
    } else {
      // Not a heading, just add the line
      fixed.push(lines[i]);
    }
  }
  
  return fixed.join('\n');
}

/**
 * Extract title from content with priority:
 * 1. First document-level header (= or #)
 * 2. First header of any level (==, ##, etc.)
 * 3. First non-empty line
 */
export function extractTitleFromContent(content: string): string | null {
  if (!content || content.trim().length === 0) return null;
  
  const lines = content.split('\n');
  let firstDocHeader: string | null = null;
  let firstAnyHeader: string | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for document-level header (= or #)
    if (/^[=#]\s+/.test(trimmed)) {
      const match = trimmed.match(/^[=#]\s+(.+)$/);
      if (match && !firstDocHeader) {
        firstDocHeader = match[1].trim();
      }
    }
    
    // Check for any header (==, ##, etc.)
    if (/^[=#]+\s+/.test(trimmed)) {
      const match = trimmed.match(/^[=#]+\s+(.+)$/);
      if (match && !firstAnyHeader) {
        firstAnyHeader = match[1].trim();
      }
    }
    
    // If we found a doc-level header, use it
    if (firstDocHeader) {
      return firstDocHeader;
    }
  }
  
  // Use first any-level header if found
  if (firstAnyHeader) {
    return firstAnyHeader;
  }
  
  // If no header found, use first non-empty line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.match(/^[=#\-\*]/)) {
      // Not a header, list item, or horizontal rule
      // Take first 100 chars as title
      return trimmed.substring(0, 100).trim();
    }
  }
  
  return null;
}

/**
 * Ensure document has a document-level header
 * Adds one if missing, using provided title or extracting from content
 */
export function ensureDocumentHeader(
  content: string,
  title?: string,
  isAsciiDoc: boolean = true
): string {
  if (!content || content.trim().length === 0) {
    const headerPrefix = isAsciiDoc ? '=' : '#';
    return `${headerPrefix} ${title || 'Untitled Document'}\n\nNo content available.`;
  }
  
  const trimmed = content.trim();
  
  // Check if it already has a document-level header
  if (isAsciiDoc && /^=\s+/.test(trimmed)) {
    return content; // Already has AsciiDoc doc header
  }
  if (!isAsciiDoc && /^#\s+/.test(trimmed)) {
    return content; // Already has Markdown doc header
  }
  
  // No document-level header, add one
  const headerPrefix = isAsciiDoc ? '=' : '#';
  const finalTitle = title || extractTitleFromContent(content) || 'Untitled Document';
  
  // Find where to insert (after metadata attributes if present)
  const lines = content.split('\n');
  let insertIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip empty lines and attribute definitions (:key: value) for AsciiDoc
    if (line.length === 0 || (isAsciiDoc && /^:[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(line))) {
      insertIndex = i + 1;
      continue;
    }
    // Stop at first non-attribute, non-empty line
    break;
  }
  
  lines.splice(insertIndex, 0, `${headerPrefix} ${finalTitle}`);
  return lines.join('\n');
}

/**
 * Get title with priority: title tag -> T tag -> d tag -> extracted from content -> fallback
 */
export function getTitleFromEvent(
  event: { tags: string[][]; content?: string; kind?: number },
  extractFromContent: boolean = true
): string {
  const titleTag = event.tags.find(([k]) => k === 'title')?.[1];
  const TTag = event.tags.find(([k]) => k === 'T')?.[1];
  const dTag = event.tags.find(([k]) => k === 'd')?.[1];
  
  if (titleTag) return titleTag;
  if (TTag) return TTag;
  if (dTag) return dTag;
  
  if (extractFromContent && event.content) {
    const extracted = extractTitleFromContent(event.content);
    if (extracted) return extracted;
  }
  
  return `Untitled Document (${event.kind || 'unknown'})`;
}

/**
 * Fix preamble content - move content between doc header and first section to Preamble section
 */
export function fixPreambleContent(content: string, isAsciiDoc: boolean = true): string {
  if (!content || content.trim().length === 0) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  
  // Find the document-level header
  let docHeaderIndex = -1;
  let firstSectionIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    
    // Find document-level header
    if (docHeaderIndex === -1) {
      if (isAsciiDoc && /^=\s+/.test(trimmed)) {
        docHeaderIndex = i;
      } else if (!isAsciiDoc && /^#\s+/.test(trimmed)) {
        docHeaderIndex = i;
      }
    }
    
    // Find first section header (level 2 or higher)
    if (docHeaderIndex >= 0 && firstSectionIndex === -1) {
      if (isAsciiDoc && /^==+\s+/.test(trimmed)) {
        firstSectionIndex = i;
        break;
      } else if (!isAsciiDoc && /^##+\s+/.test(trimmed)) {
        firstSectionIndex = i;
        break;
      }
    }
  }
  
  // If no doc header or no section found, return original
  if (docHeaderIndex === -1 || firstSectionIndex === -1) {
    return content;
  }
  
  // Check if there's content between doc header/attributes and first section
  let hasPreambleContent = false;
  let attributeEndIndex = docHeaderIndex;
  
  // Find where attributes end
  for (let i = docHeaderIndex + 1; i < firstSectionIndex; i++) {
    const trimmed = lines[i].trim();
    
    // Skip empty lines
    if (trimmed.length === 0) continue;
    
    // Check if it's an attribute definition
    if (isAsciiDoc && /^:[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(trimmed)) {
      attributeEndIndex = i;
      continue;
    }
    
    // Not an attribute, so it's preamble content
    hasPreambleContent = true;
    break;
  }
  
  // If no preamble content, return original
  if (!hasPreambleContent) {
    return content;
  }
  
  // Build fixed content
  // Copy everything up to and including attributes
  for (let i = 0; i <= attributeEndIndex; i++) {
    fixed.push(lines[i]);
  }
  
  // Add empty line if needed
  if (fixed[fixed.length - 1].trim().length > 0) {
    fixed.push('');
  }
  
  // Add Preamble section header
  const preambleHeader = isAsciiDoc ? '== Preamble' : '## Preamble';
  fixed.push(preambleHeader);
  fixed.push('');
  
  // Copy preamble content
  for (let i = attributeEndIndex + 1; i < firstSectionIndex; i++) {
    const trimmed = lines[i].trim();
    // Skip empty lines at the start
    if (fixed.length === 0 || fixed[fixed.length - 1].trim().length > 0 || trimmed.length > 0) {
      fixed.push(lines[i]);
    }
  }
  
  // Add empty line before first section
  if (fixed[fixed.length - 1].trim().length > 0) {
    fixed.push('');
  }
  
  // Copy rest of content
  for (let i = firstSectionIndex; i < lines.length; i++) {
    fixed.push(lines[i]);
  }
  
  return fixed.join('\n');
}

/**
 * Fix link and media formatting to match target format
 */
export function fixLinkAndMediaFormatting(content: string, isAsciiDoc: boolean): string {
  if (!content || content.trim().length === 0) return content;
  
  let processed = content;
  
  if (isAsciiDoc) {
    // Convert markdown to asciidoc
    
    // Convert markdown images first (before links, to avoid conflicts)
    // ![alt](url) -> image::url[alt]
    processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
      return `image::${url}[${alt || ''}]`;
    });
    
    // Convert markdown links: [text](url) -> link:url[text]
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      return `link:${url}[${text}]`;
    });
    
    // Convert autolinks: <url> -> link:url[]
    processed = processed.replace(/<([^>]+)>/g, (match, url) => {
      if (/^https?:\/\//.test(url) || /^mailto:/.test(url)) {
        return `link:${url}[]`;
      }
      return match;
    });
    
    // Convert reference-style links: [text][ref] and [ref]: url
    const refLinks: Map<string, string> = new Map();
    processed = processed.replace(/^\[([^\]]+)\]:\s*(.+)$/gm, (match, ref, url) => {
      refLinks.set(ref.toLowerCase(), url.trim());
      return ''; // Remove the reference definition
    });
    
    processed = processed.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (match, text, ref) => {
      const url = refLinks.get(ref.toLowerCase());
      if (url) {
        return `link:${url}[${text}]`;
      }
      return match;
    });
    
  } else {
    // Convert asciidoc to markdown
    
    // Convert asciidoc images first (before links, to avoid conflicts)
    // image::url[alt] -> ![alt](url) or image:url[alt] -> ![alt](url)
    processed = processed.replace(/image::?([^\[]+)\[([^\]]*)\]/g, (match, url, alt) => {
      return `![${alt || ''}](${url.trim()})`;
    });
    
    // Convert asciidoc links: link:url[text] -> [text](url)
    processed = processed.replace(/link:([^\[]+)\[([^\]]*)\]/g, (match, url, text) => {
      return `[${text || url}](${url.trim()})`;
    });
  }
  
  return processed;
}

/**
 * Format book wikilink display text for GUI rendering
 * This is the same formatting used in downloads, extracted for reuse
 */
export function formatBookWikilinkDisplayText(bookContent: string): string {
  try {
    const parsed = parseBookWikilink(`[[book::${bookContent}]]`);
    
    if (!parsed?.references?.length) {
      // Fallback: make it human-readable
      return bookContent
        .split(' | ')
        .map((part: string, index: number) => {
          if (index === 0 && part.includes('::')) {
            return ''; // Skip collection part
          }
          return part
            .replace(/[-_]/g, ' ')
            .split(' ')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        })
        .filter(Boolean)
        .join(' | ');
    }
    
    // Check if this is a Bible collection for special formatting
    const isBible = parsed.references.some(ref => 
      ref.collection && ref.collection.toLowerCase() === 'bible'
    );
    
    if (isBible) {
      // Special Bible citation format: _[Version/Collection]_, Title Chapter:Section, Title Chapter:Section, ...
      // Get version from first reference (all should have same version)
      const firstRef = parsed.references[0];
      let bibleName = '';
      
      if (firstRef.version && firstRef.version.length > 0) {
        // Format version in title case
        let versionText = firstRef.version
          .map((v: string) => {
            // Handle common Bible version abbreviations
            const versionMap: Record<string, string> = {
              'kjv': 'King James Version',
              'niv': 'New International Version',
              'esv': 'English Standard Version',
              'nasb': 'New American Standard Bible',
              'nlt': 'New Living Translation',
              'amp': 'Amplified',
              'nrsv': 'New Revised Standard Version',
              'rsv': 'Revised Standard Version',
              'drb': 'Douay-Rheims',
              'dra': 'Douay-Rheims (Ammerican)',
            };
            
            const normalized = v.toLowerCase().trim();
            if (versionMap[normalized]) {
              return versionMap[normalized];
            }
            
            // Otherwise, humanize normally
            return v.replace(/[-_]/g, ' ')
              .split(' ')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
          })
          .join(' ');
        
        // Check if "bible" is already in the version name (case-insensitive)
        const hasBible = /\bbible\b/i.test(versionText);
        const baseName = hasBible ? versionText : `${versionText} Bible`;
        
        // Add "The" at the beginning if not already present
        bibleName = /^the\s+/i.test(baseName) ? baseName : `The ${baseName}`;
      } else {
        // No version, use default
        bibleName = 'The Holy Bible';
      }
      
      // Format all references: Title Chapter:Section, Title Chapter:Section, ...
      const referenceParts = parsed.references.map((ref: ParsedBookReference) => {
        const titlePart = ref.title 
          ? ref.title
              .replace(/[-_]/g, ' ')
              .split(' ')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ')
          : '';
        
        let display = titlePart || '';
        if (ref.chapter) {
          display = display ? `${display} ${ref.chapter}` : ref.chapter;
        }
        
        if (ref.section && ref.section.length > 0) {
          const sectionText = formatSections(ref.section);
          display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
        }
        
        return display;
      });
      
      // Return Bible format: _Bible Name_, Title Chapter:Section, Title Chapter:Section, ...
      return `_${bibleName}_, ${referenceParts.join(', ')}`;
    }
    
    // Regular book format: _Title_ Ch. X:Y, from the [Version] edition of the _[Collection]_
    // Format each reference nicely
    const formatted = parsed.references.map((ref: ParsedBookReference) => {
      // Humanize title (replace hyphens/underscores, title case)
      const titlePart = ref.title 
        ? ref.title
            .replace(/[-_]/g, ' ')
            .split(' ')
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ')
        : '';
      
      // Format title with italics
      let display = titlePart ? `_${titlePart}_` : '';
      if (ref.chapter) {
        // Humanize chapter: replace hyphens/underscores with spaces, title case
        const chapterText = ref.chapter
          .replace(/[-_]/g, ' ')
          .split(' ')
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        
        // If chapter starts with "chapter" or is just a number, format as "Ch. X"
        // Otherwise, use the humanized text as-is
        let formattedChapter: string;
        if (/^chapter\s+\d+/i.test(chapterText)) {
          // Already has "chapter" prefix, format as "Ch. X"
          formattedChapter = chapterText.replace(/^chapter\s+(\d+)/i, 'Ch. $1');
        } else if (/^\d+$/.test(ref.chapter)) {
          // Just a number, add "Ch." prefix
          formattedChapter = `Ch. ${ref.chapter}`;
        } else {
          // Has other text, use humanized version
          formattedChapter = chapterText;
        }
        
        display = display ? `${display}, ${formattedChapter}` : formattedChapter;
      }
      
      if (ref.section && ref.section.length > 0) {
        // Use formatSections to collapse ranges (e.g., [3, 4, 5, 6] -> "3-6")
        // This preserves ranges in compact format when publishing
        const sectionText = formatSections(ref.section);
        display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
      }
      
      // Format collection and version at the end: ", from the [Version] edition of the _[Collection]_"
      const parts: string[] = [];
      
      // Format version in title case
      if (ref.version && ref.version.length > 0) {
        const versionText = ref.version
          .map((v: string) => 
            v.replace(/[-_]/g, ' ')
             .split(' ')
             .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
             .join(' ')
          )
          .join(' ');
        parts.push(versionText);
      }
      
      // Format collection in title case with italics
      if (ref.collection) {
        const collectionText = ref.collection
          .replace(/[-_]/g, ' ')
          .split(' ')
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        parts.push(`_${collectionText}_`);
      }
      
      // Build the suffix
      if (parts.length > 0) {
        let suffix = '';
        if (ref.version && ref.version.length > 0 && ref.collection) {
          // Both version and collection: "from the [Version] edition of the _[Collection]_"
          suffix = `, from the ${parts[0]} edition of the ${parts[1]}`;
        } else if (ref.version && ref.version.length > 0) {
          // Only version: "from the [Version] edition"
          suffix = `, from the ${parts[0]} edition`;
        } else if (ref.collection) {
          // Only collection: "from the _[Collection]_"
          suffix = `, from the ${parts[0]}`;
        }
        display += suffix;
      }
      
      return display || 'Book reference';
    });
    
    return formatted.join(', ');
  } catch (e) {
    // Fallback on error
    return bookContent;
  }
}

/**
 * Process wikilinks to ensure proper formatting
 * Handles both [[wikilink]] and [[book::...]] formats
 * Note: This is a synchronous function, so book wikilink formatting will use a simple approach
 */
export function processWikilinks(content: string, isAsciiDoc: boolean): string {
  if (!content || content.trim().length === 0) return content;
  
  let processed = content;
  
  // Helper to format book wikilink display text (synchronous version)
  // This creates human-readable, title-case display text
  function formatBookDisplayText(bookContent: string): string {
    try {
      const parsed = parseBookWikilink(`[[book::${bookContent}]]`);
      
      if (!parsed?.references?.length) {
        // Fallback: make it human-readable
        return bookContent
          .split(' | ')
          .map((part: string, index: number) => {
            if (index === 0 && part.includes('::')) {
              return ''; // Skip collection part
            }
            return part
              .replace(/[-_]/g, ' ')
              .split(' ')
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
          })
          .filter(Boolean)
          .join(' | ');
      }
      
      // Check if this is a Bible collection for special formatting
      const isBible = parsed.references.some(ref => 
        ref.collection && ref.collection.toLowerCase() === 'bible'
      );
      
      if (isBible) {
        // Special Bible citation format: _[Version/Collection]_, Title Chapter:Section, Title Chapter:Section, ...
        // Get version from first reference (all should have same version)
        const firstRef = parsed.references[0];
        let bibleName = '';
        
        if (firstRef.version && firstRef.version.length > 0) {
          // Format version in title case
          let versionText = firstRef.version
            .map((v: string) => {
              // Handle common Bible version abbreviations
              const versionMap: Record<string, string> = {
                'kjv': 'King James Version',
                'niv': 'New International Version',
                'esv': 'English Standard Version',
                'nasb': 'New American Standard Bible',
                'nlt': 'New Living Translation',
                'amp': 'Amplified',
                'nrsv': 'New Revised Standard Version',
                'rsv': 'Revised Standard Version',
                'drb': 'Douay-Rheims',
                'dra': 'Douay-Rheims (Ammerican)',
              };
              
              const normalized = v.toLowerCase().trim();
              if (versionMap[normalized]) {
                return versionMap[normalized];
              }
              
              // Otherwise, humanize normally
              return v.replace(/[-_]/g, ' ')
                .split(' ')
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');
            })
            .join(' ');
          
          // Check if "bible" is already in the version name (case-insensitive)
          const hasBible = /\bbible\b/i.test(versionText);
          const baseName = hasBible ? versionText : `${versionText} Bible`;
          
          // Add "The" at the beginning if not already present
          bibleName = /^the\s+/i.test(baseName) ? baseName : `The ${baseName}`;
        } else {
          // No version, use default
          bibleName = 'The Holy Bible';
        }
        
        // Format all references: Title Chapter:Section, Title Chapter:Section, ...
        const referenceParts = parsed.references.map((ref: ParsedBookReference) => {
          const titlePart = ref.title 
            ? ref.title
                .replace(/[-_]/g, ' ')
                .split(' ')
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ')
            : '';
          
          let display = titlePart || '';
          if (ref.chapter) {
            display = display ? `${display} ${ref.chapter}` : ref.chapter;
          }
          
          if (ref.section && ref.section.length > 0) {
            const sectionText = formatSections(ref.section);
            display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
          }
          
          return display;
        });
        
        // Return Bible format: _Bible Name_, Title Chapter:Section, Title Chapter:Section, ...
        return `_${bibleName}_, ${referenceParts.join(', ')}`;
      }
      
      // Format each reference nicely (non-Bible)
      const formatted = parsed.references.map((ref: ParsedBookReference) => {
        // Humanize title (replace hyphens/underscores, title case)
        const titlePart = ref.title 
          ? ref.title
              .replace(/[-_]/g, ' ')
              .split(' ')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ')
          : '';
        
        // Regular book format: _Title_ Ch. X:Y, from the [Version] edition of the _[Collection]_
        // Format title with italics (not quotation marks)
        let display = titlePart ? `_${titlePart}_` : '';
        if (ref.chapter) {
          // Regular book format: "Title" Ch. X:Y, from the [Version] edition of the "[Collection]"
          // Format title with italics (not quotation marks)
          let display = titlePart ? `_${titlePart}_` : '';
          if (ref.chapter) {
            // Humanize chapter: replace hyphens/underscores with spaces, title case
            const chapterText = ref.chapter
              .replace(/[-_]/g, ' ')
              .split(' ')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
            
            // If chapter starts with "chapter" or is just a number, format as "Ch. X"
            // Otherwise, use the humanized text as-is
            let formattedChapter: string;
            if (/^chapter\s+\d+/i.test(chapterText)) {
              // Already has "chapter" prefix, format as "Ch. X"
              formattedChapter = chapterText.replace(/^chapter\s+(\d+)/i, 'Ch. $1');
            } else if (/^\d+$/.test(ref.chapter)) {
              // Just a number, add "Ch." prefix
              formattedChapter = `Ch. ${ref.chapter}`;
            } else {
              // Has other text, use humanized version
              formattedChapter = chapterText;
            }
            
            display = display ? `${display}, ${formattedChapter}` : formattedChapter;
          }
          
          if (ref.section && ref.section.length > 0) {
            // Use formatSections to collapse ranges (e.g., [3, 4, 5, 6] -> "3-6")
            // This preserves ranges in compact format when publishing
            const sectionText = formatSections(ref.section);
            display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
          }
          
          // Format collection and version at the end: ", from the [Version] edition of the _[Collection]_"
          const parts: string[] = [];
          
          // Format version in title case
          if (ref.version && ref.version.length > 0) {
            const versionText = ref.version
              .map((v: string) => 
                v.replace(/[-_]/g, ' ')
                 .split(' ')
                 .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                 .join(' ')
              )
              .join(' ');
            parts.push(versionText);
          }
          
          // Format collection in title case with italics
          if (ref.collection) {
            const collectionText = ref.collection
              .replace(/[-_]/g, ' ')
              .split(' ')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
            parts.push(`_${collectionText}_`);
          }
          
          // Build the suffix
          if (parts.length > 0) {
            let suffix = '';
            if (ref.version && ref.version.length > 0 && ref.collection) {
              // Both version and collection: "from the [Version] edition of the _[Collection]_"
              suffix = `, from the ${parts[0]} edition of the ${parts[1]}`;
            } else if (ref.version && ref.version.length > 0) {
              // Only version: "from the [Version] edition"
              suffix = `, from the ${parts[0]} edition`;
            } else if (ref.collection) {
              // Only collection: "from the _[Collection]_"
              suffix = `, from the ${parts[0]}`;
            }
            display += suffix;
          }
          
          return display || 'Book reference';
        }
      });
      
      return formatted.join(', ');
    } catch (e) {
      // Fallback: make it human-readable
      return bookContent
        .split(' | ')
        .map((part: string, index: number) => {
          if (index === 0 && part.includes('::')) {
            return ''; // Skip collection part
          }
          return part
            .replace(/[-_]/g, ' ')
            .split(' ')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        })
        .filter(Boolean)
        .join(' | ');
    }
  }
  
  // Helper to format regular wikilink display text (replace hyphens with spaces)
  function formatWikilinkDisplayText(identifier: string): string {
    return identifier.replace(/-/g, ' ');
  }
  
  // Process book wikilinks [[book::...]]
  processed = processed.replace(/\[\[book::([^\]]+)\]\]/g, (match, bookContent) => {
    // Format display text to be human-readable and title-case
    const displayText = formatBookDisplayText(bookContent);
    
    if (isAsciiDoc) {
      return `link:wikilink:book::${bookContent}[${displayText}]`;
    } else {
      return `[${displayText}](wikilink:book::${bookContent})`;
    }
  });
  
  // Process regular wikilinks [[identifier]] or [[identifier | display text]]
  // Must come after book wikilinks to avoid conflicts
  processed = processed.replace(/\[\[(?!book::)([^\]]+)\]\]/g, (match, content) => {
    const pipeIndex = content.indexOf(' | ');
    let identifier: string;
    let displayText: string;
    
    if (pipeIndex !== -1) {
      // Has explicit display text
      identifier = content.substring(0, pipeIndex).trim();
      displayText = content.substring(pipeIndex + 3).trim();
    } else {
      // No display text - use identifier with hyphens replaced by spaces
      identifier = content.trim();
      displayText = formatWikilinkDisplayText(identifier);
    }
    
    if (isAsciiDoc) {
      return `link:wikilink:${identifier}[${displayText}]`;
    } else {
      return `[${displayText}](wikilink:${identifier})`;
    }
  });
  
  return processed;
}

/**
 * Process Nostr addresses to render them neatly
 * - Removes "nostr:" prefix
 * - npub/nprofile: renders as display_name (fallback chain)
 * - note1, nevent, naddr, hex ID: renders as fallback cards
 */
export async function processNostrAddresses(
  content: string,
  isAsciiDoc: boolean,
  getUserDisplayName?: (pubkey: string) => Promise<string>
): Promise<string> {
  if (!content || content.trim().length === 0) return content;
  
  let processed = content;
  
  // Import nip19 for decoding
  const { nip19 } = await import('@nostr/tools');
  
  // Helper to decode bech32
  function decodeBech32(bech32: string): { type: string; data: any } | null {
    try {
      const decoded = nip19.decode(bech32);
      return decoded;
    } catch {
      return null;
    }
  }
  
  // Helper to get display name for npub/nprofile
  async function getDisplayNameForNpub(pubkey: string, bech32: string): Promise<string> {
    if (getUserDisplayName) {
      try {
        const displayName = await getUserDisplayName(pubkey);
        // Check if we got a meaningful name (not just shortened npub)
        if (displayName && !displayName.startsWith('npub1') && displayName.length > 8) {
          return displayName;
        }
      } catch (e) {
        // Fall through to fallbacks
      }
    }
    
    // Fallback: try to get from cache or return shortened
    try {
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = await contentCache.getEvents('metadata');
      const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === pubkey && cached.event.kind === 0);
      
      if (cachedUserEvent) {
        try {
          const userContent = JSON.parse(cachedUserEvent.event.content);
          // Priority: display_name -> name -> nip05 -> shortened npub
          if (userContent.display_name) return userContent.display_name;
          if (userContent.name) return userContent.name;
          if (userContent.nip05) return userContent.nip05;
        } catch (e) {
          // Fall through
        }
      }
    } catch (e) {
      // Fall through
    }
    
    // Final fallback: shortened npub
    return bech32.length > 20 ? bech32.slice(0, 20) + '...' : bech32;
  }
  
  // Process nostr: links (remove prefix and format)
  processed = processed.replace(/nostr:([a-zA-Z0-9]+)/g, (match, bech32) => {
    const decoded = decodeBech32(bech32);
    if (!decoded) return match; // Keep original if can't decode
    
    const { type, data } = decoded;
    
    if (type === 'npub' || type === 'nprofile') {
      const pubkey = type === 'npub' ? data : data.pubkey;
      // For async processing, we'll use a placeholder that gets replaced
      return `__NOSTR_NPUB_${bech32}__`;
    } else if (type === 'nevent' || type === 'note') {
      // Render as fallback card format
      const displayText = bech32.length > 20 ? bech32.slice(0, 20) + '...' : bech32;
      if (isAsciiDoc) {
        return `link:nostr:${bech32}[${displayText}]`;
      } else {
        return `[${displayText}](nostr:${bech32})`;
      }
    } else if (type === 'naddr') {
      const identifier = data.identifier || (bech32.length > 20 ? bech32.slice(0, 20) + '...' : bech32);
      if (isAsciiDoc) {
        return `link:nostr:${bech32}[${identifier}]`;
      } else {
        return `[${identifier}](nostr:${bech32})`;
      }
    }
    
    return match;
  });
  
  // Process standalone npub/nprofile (without nostr: prefix)
  const npubMatches = processed.match(/(?:^|\s)(npub1[a-zA-Z0-9]+|nprofile1[a-zA-Z0-9]+)(?:\s|$)/g);
  if (npubMatches) {
    for (const match of npubMatches) {
      const bech32 = match.trim();
      const decoded = decodeBech32(bech32);
      if (decoded && (decoded.type === 'npub' || decoded.type === 'nprofile')) {
        processed = processed.replace(bech32, `__NOSTR_NPUB_${bech32}__`);
      }
    }
  }
  
  // Process hex IDs (64 char hex strings) as event IDs
  processed = processed.replace(/\b([0-9a-f]{64})\b/gi, (match, hexId) => {
    // Only replace if it looks like an event ID (not part of a larger hex string)
    if (match.length === 64) {
      const displayText = hexId.slice(0, 20) + '...';
      if (isAsciiDoc) {
        return `link:nostr:${hexId}[${displayText}]`;
      } else {
        return `[${displayText}](nostr:${hexId})`;
      }
    }
    return match;
  });
  
  // Now replace npub placeholders with actual display names (async)
  const npubPlaceholders = processed.match(/__NOSTR_NPUB_([a-zA-Z0-9]+)__/g);
  if (npubPlaceholders) {
    for (const placeholder of npubPlaceholders) {
      const bech32 = placeholder.replace(/__NOSTR_NPUB_|__/g, '');
      const decoded = decodeBech32(bech32);
      if (decoded && (decoded.type === 'npub' || decoded.type === 'nprofile')) {
        const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
        const displayName = await getDisplayNameForNpub(pubkey, bech32);
        const linkUrl = `nostr:${bech32}`;
        
        if (isAsciiDoc) {
          processed = processed.replace(placeholder, `link:${linkUrl}[${displayName}]`);
        } else {
          processed = processed.replace(placeholder, `[${displayName}](${linkUrl})`);
        }
      }
    }
  }
  
  return processed;
}

/**
 * Process content for quality control
 * Applies all QC fixes: spacing, missing levels, document header, preamble, links/media
 */
export function processContentQuality(
  content: string,
  event: { tags: string[][]; content?: string; kind?: number },
  isAsciiDoc: boolean = true
): string {
  if (!content || content.trim().length === 0) {
    const title = getTitleFromEvent(event, false);
    return ensureDocumentHeader('', title, isAsciiDoc);
  }
  
  // Apply fixes in order
  let processed = content;
  
  // 1. Process wikilinks first (before link formatting)
  processed = processWikilinks(processed, isAsciiDoc);
  
  // 2. Fix link and media formatting (after wikilinks)
  processed = fixLinkAndMediaFormatting(processed, isAsciiDoc);
  
  // 3. Fix header spacing
  processed = fixHeaderSpacing(processed);
  
  // 4. Ensure document header exists (before fixing missing levels)
  const title = getTitleFromEvent(event, true);
  processed = ensureDocumentHeader(processed, title, isAsciiDoc);
  
  // 5. Fix missing heading levels (after doc header is in place)
  processed = fixMissingHeadingLevels(processed);
  
  // 6. Fix preamble content (move content before first section to Preamble)
  processed = fixPreambleContent(processed, isAsciiDoc);
  
  return processed;
}

/**
 * Process content for quality control with async Nostr address processing
 * This version includes Nostr address formatting with user metadata
 */
export async function processContentQualityAsync(
  content: string,
  event: { tags: string[][]; content?: string; kind?: number },
  isAsciiDoc: boolean = true,
  getUserDisplayName?: (pubkey: string) => Promise<string>
): Promise<string> {
  if (!content || content.trim().length === 0) {
    const title = getTitleFromEvent(event, false);
    return ensureDocumentHeader('', title, isAsciiDoc);
  }
  
  // Apply synchronous fixes first
  let processed = processContentQuality(content, event, isAsciiDoc);
  
  // Then process Nostr addresses (async)
  processed = await processNostrAddresses(processed, isAsciiDoc, getUserDisplayName);
  
  return processed;
}

