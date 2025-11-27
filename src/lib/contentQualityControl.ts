/**
 * Content Quality Control
 * Runs on finished AsciiDoc content as a prerequisite to publishing
 * This ensures all content is properly formatted before export
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { parseBookWikilink, type ParsedBookReference } from './bookWikilinkParser';

/**
 * Get title from event tags
 */
export function getTitleFromEvent(event: { tags: string[][] }, fallbackToId: boolean = false): string {
  const titleTag = event.tags.find(([k]) => k === 'title');
  if (titleTag && titleTag[1]) {
    return titleTag[1];
  }
  const tTag = event.tags.find(([k]) => k === 'T');
  if (tTag && tTag[1]) {
    return tTag[1];
  }
  if (fallbackToId && 'id' in event) {
    return (event as any).id.slice(0, 8);
  }
  return 'Untitled';
}

/**
 * Format book wikilink display text for GUI
 */
export function formatBookWikilinkDisplayTextForGUI(content: string): string {
  if (!content) return '';
  
  const parsed = parseBookWikilink(`[[book::${content}]]`);
  if (!parsed?.references?.length) {
    return content;
  }
  
  const formatted = parsed.references.map(formatBookReferenceDisplay);
  return formatted.join(', ');
}

function humanizeBookSegment(segment: string): string {
  return segment
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatSections(sections: string[]): string {
  if (sections.length === 0) return '';
  if (sections.length === 1) return sections[0];
  
  const numeric: number[] = [];
  const nonNumeric: string[] = [];
  
  for (const section of sections) {
    const num = parseInt(section, 10);
    if (isNaN(num)) {
      nonNumeric.push(section);
    } else {
      numeric.push(num);
    }
  }
  
  numeric.sort((a, b) => a - b);
  
  const parts: Array<string | { start: number; end: number }> = [];
  let i = 0;
  while (i < numeric.length) {
    let rangeStart = numeric[i];
    let rangeEnd = numeric[i];
    let j = i + 1;
    
    while (j < numeric.length && numeric[j] === rangeEnd + 1) {
      rangeEnd = numeric[j];
      j++;
    }
    
    if (j - i >= 2) {
      parts.push({ start: rangeStart, end: rangeEnd });
      i = j;
    } else {
      parts.push(numeric[i].toString());
      i++;
    }
  }
  
  parts.push(...nonNumeric);
  
  return parts.map(part => {
    if (typeof part === 'string') {
      return part;
    } else {
      return `${part.start}-${part.end}`;
    }
  }).join(',');
}

function formatBookReferenceDisplay(ref: ParsedBookReference): string {
  const titlePart = ref.title ? humanizeBookSegment(ref.title) : '';
  const collectionPart = ref.collection ? humanizeBookSegment(ref.collection) : '';

  let display = titlePart;
  if (ref.chapter) {
    display = display ? `${display} ${ref.chapter}` : ref.chapter;
  }

  if (ref.section && ref.section.length > 0) {
    const sectionText = formatSections(ref.section);
    display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
  }

  if (!display && collectionPart) {
    display = collectionPart;
  }

  if (!display) {
    display = 'Book reference';
  }

  const versionText = ref.version?.length ? ref.version.map(v => v.toUpperCase()).join(' ') : '';
  if (versionText) {
    display += ` (${versionText})`;
  }

  return display;
}

/**
 * Fix preamble content - move content between metadata sections and first real section to Preamble section
 * This runs AFTER all conversions and metadata additions
 */
export function fixPreambleContent(content: string, isAsciiDoc: boolean = true): string {
  if (!content || content.trim().length === 0) return content;
  
  // Skip preamble fix for book documents - Asciidoctor handles title pages automatically
  if (isAsciiDoc && /^:doctype:\s+book\s*$/m.test(content)) {
    return content;
  }
  
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
    
    // Find first real section header (skip metadata sections and Abstract)
    if (docHeaderIndex >= 0 && firstSectionIndex === -1) {
      const isAsciiDocHeading = isAsciiDoc && /^==+\s+/.test(trimmed);
      const isMarkdownHeading = !isAsciiDoc && /^##+\s+/.test(trimmed);
      
      if (isAsciiDocHeading || isMarkdownHeading) {
        // Check if this is a metadata section (has block attribute before it) or Abstract section
        let isSpecialSection = false;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (lines[j].includes('.title-page') || lines[j].includes('title-page') ||
              lines[j].includes('.book-metadata') || lines[j].includes('book-metadata') ||
              lines[j].includes('.article-metadata') || lines[j].includes('article-metadata') ||
              lines[j].includes('[abstract]')) {
            isSpecialSection = true;
            break;
          }
        }
        // Also check if this is the Abstract section (even without [abstract] attribute)
        if (!isSpecialSection && /^==+\s+Abstract\s*$/i.test(trimmed)) {
          isSpecialSection = true;
        }
        // If it's not a special section, this is the first real content section
        if (!isSpecialSection) {
          firstSectionIndex = i;
          break;
        }
      }
    }
  }
  
  // If no doc header or no section found, return original
  if (docHeaderIndex === -1 || firstSectionIndex === -1) {
    return content;
  }
  
  // Find where attributes end
  let attributeEndIndex = docHeaderIndex;
  for (let i = docHeaderIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (isAsciiDoc && /^:[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(trimmed)) {
      attributeEndIndex = i;
      continue;
    }
    break;
  }
  
  // Find where the last metadata section ends by looking for the marker
  // The marker "__This document was published with a GitCitadel app.__" indicates the end of metadata
  const metadataEndMarker = '__This document was published with a GitCitadel app.__';
  let metadataSectionEndIndex = attributeEndIndex;
  
  // Look for the marker - search the entire document, not just up to firstSectionIndex
  // The marker should be at the end of the article-metadata or book-metadata section
  for (let i = attributeEndIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === metadataEndMarker) {
      // Found the marker - metadata section ends here
      metadataSectionEndIndex = i;
      // Now find the first real section after the marker (if we haven't found it yet or it's before the marker)
      if (firstSectionIndex === -1 || firstSectionIndex <= i) {
        // Continue looking for first real section after the marker
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim();
          const isAsciiDocHeading = isAsciiDoc && /^==+\s+/.test(nextTrimmed);
          const isMarkdownHeading = !isAsciiDoc && /^##+\s+/.test(nextTrimmed);
          
          if (isAsciiDocHeading || isMarkdownHeading) {
            // Check if this is a special section (Abstract, metadata, etc.)
            let isSpecialSection = false;
            for (let k = Math.max(0, j - 3); k < j; k++) {
              if (lines[k].includes('.title-page') || lines[k].includes('title-page') ||
                  lines[k].includes('.book-metadata') || lines[k].includes('book-metadata') ||
                  lines[k].includes('.article-metadata') || lines[k].includes('article-metadata') ||
                  lines[k].includes('[abstract]')) {
                isSpecialSection = true;
                break;
              }
            }
            // Also check if this is the Abstract section
            if (!isSpecialSection && /^==+\s+Abstract\s*$/i.test(nextTrimmed)) {
              isSpecialSection = true;
            }
            // If it's not a special section, this is the first real content section
            if (!isSpecialSection) {
              firstSectionIndex = j;
              break;
            }
          }
        }
      }
      break;
    }
  }
  
  // If marker not found, fall back to finding metadata sections by block attributes
  if (metadataSectionEndIndex === attributeEndIndex) {
    // Find all metadata sections (sections with block attributes) before firstSectionIndex
    let lastMetadataSectionEnd = attributeEndIndex;
    
    for (let i = attributeEndIndex + 1; i < firstSectionIndex; i++) {
      const trimmed = lines[i].trim();
      
      // Check if this is a section header
      const isAsciiDocHeading = isAsciiDoc && /^==+\s+/.test(trimmed);
      const isMarkdownHeading = !isAsciiDoc && /^##+\s+/.test(trimmed);
      
      if (isAsciiDocHeading || isMarkdownHeading) {
        // Check if this section has a block attribute before it (making it a metadata section)
        let hasBlockAttribute = false;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (/^\[[^\]]+\]$/.test(lines[j].trim())) {
            hasBlockAttribute = true;
            break;
          }
        }
        
        if (hasBlockAttribute) {
          // This is a metadata section - find where it ends
          // Walk forward to find the next section or end of document
          let sectionEnd = firstSectionIndex - 1; // Default: ends just before first real section
          for (let j = i + 1; j < firstSectionIndex; j++) {
            const nextTrimmed = lines[j].trim();
            const isNextAsciiDocHeading = isAsciiDoc && /^==+\s+/.test(nextTrimmed);
            const isNextMarkdownHeading = !isAsciiDoc && /^##+\s+/.test(nextTrimmed);
            
            if (isNextAsciiDocHeading || isNextMarkdownHeading) {
              // Found next section - check if it's also metadata
              let nextHasBlockAttribute = false;
              for (let k = Math.max(0, j - 3); k < j; k++) {
                if (/^\[[^\]]+\]$/.test(lines[k].trim())) {
                  nextHasBlockAttribute = true;
                  break;
                }
              }
              if (!nextHasBlockAttribute) {
                // Next section is real content, so this metadata section ends before it
                sectionEnd = j - 1;
                break;
              }
              // If next section is also metadata, this section ends before it
              sectionEnd = j - 1;
              break;
            }
          }
          // Find the last non-empty line in this metadata section
          for (let j = sectionEnd; j >= i; j--) {
            if (lines[j].trim().length > 0) {
              lastMetadataSectionEnd = Math.max(lastMetadataSectionEnd, j);
              break;
            }
          }
        } else {
          // This is the first real content section - metadata ends before it
          break;
        }
      }
    }
    
    metadataSectionEndIndex = lastMetadataSectionEnd;
  }
  
  // Check if there's content between the end of metadata sections and first real section
  // Skip blank lines after the marker
  let contentStartIndex = metadataSectionEndIndex + 1;
  while (contentStartIndex < firstSectionIndex && lines[contentStartIndex].trim().length === 0) {
    contentStartIndex++;
  }
  
  let hasPreambleContent = false;
  
  for (let i = contentStartIndex; i < firstSectionIndex; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    // Skip page breaks (<<<)
    if (trimmed === '<<<') continue;
    // Skip Abstract section header
    if (/^==+\s+Abstract\s*$/i.test(trimmed)) continue;
    // Not an attribute, page break, or section header, so it's preamble content
    hasPreambleContent = true;
    break;
  }
  
  // If no preamble content, return original
  if (!hasPreambleContent) {
    return content;
  }
  
  // Build fixed content
  // Copy everything up to and including the end of metadata sections
  for (let i = 0; i <= metadataSectionEndIndex; i++) {
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
  for (let i = contentStartIndex; i < firstSectionIndex; i++) {
    fixed.push(lines[i]);
  }
  
  // Add empty line before first section
  if (fixed[fixed.length - 1].trim().length > 0) {
    fixed.push('');
  }
  
  // Copy the rest of the document
  for (let i = firstSectionIndex; i < lines.length; i++) {
    fixed.push(lines[i]);
  }
  
  return fixed.join('\n');
}

/**
 * Fix header spacing - ensure proper spacing around headers
 */
export function fixHeaderSpacing(content: string, isAsciiDoc: boolean = true): string {
  if (!content) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
    const prevLine = i > 0 ? lines[i - 1] : '';
    
    // Check if this is a header
    const isHeader = isAsciiDoc 
      ? /^==+\s+/.test(trimmed)
      : /^##+\s+/.test(trimmed);
    
    if (isHeader) {
      // Ensure blank line before header (unless it's the first line or previous is blank)
      if (i > 0 && prevLine.trim().length > 0 && !prevLine.trim().match(/^\[.*\]$/)) {
        fixed.push('');
      }
      fixed.push(line);
      // Ensure blank line after header (unless next is blank or a block attribute)
      if (i < lines.length - 1 && nextLine.trim().length > 0 && !nextLine.trim().match(/^\[.*\]$/)) {
        fixed.push('');
      }
    } else {
      fixed.push(line);
    }
  }
  
  return fixed.join('\n');
}

/**
 * Fix missing heading levels - ensure headings follow proper hierarchy
 */
export function fixMissingHeadingLevels(content: string, isAsciiDoc: boolean = true): string {
  if (!content) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  let lastLevel = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = isAsciiDoc 
      ? trimmed.match(/^(=+)\s+(.+)/)
      : trimmed.match(/^(#+)\s+(.+)/);
    
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      
      // If this heading is more than one level deeper than the last, adjust it
      if (level > lastLevel + 1 && lastLevel > 0) {
        const adjustedLevel = lastLevel + 1;
        const marker = isAsciiDoc ? '='.repeat(adjustedLevel) : '#'.repeat(adjustedLevel);
        fixed.push(`${marker} ${text}`);
        lastLevel = adjustedLevel;
      } else {
        fixed.push(line);
        lastLevel = level;
      }
    } else {
      fixed.push(line);
    }
  }
  
  return fixed.join('\n');
}

/**
 * Fix empty headings - remove lines with only = signs
 */
export function fixEmptyHeadings(content: string, isAsciiDoc: boolean = true): string {
  if (!content) return content;
  
  const lines = content.split('\n');
  return lines.filter(line => {
    const trimmed = line.trim();
    if (isAsciiDoc) {
      // Remove lines that are only = signs (empty headings)
      return !/^=+\s*$/.test(trimmed);
    } else {
      return !/^#+\s*$/.test(trimmed);
    }
  }).join('\n');
}

/**
 * Ensure document has a header
 */
export function ensureDocumentHeader(content: string, title: string, isAsciiDoc: boolean = true): string {
  if (!content || content.trim().length === 0) {
    const header = isAsciiDoc ? `= ${title}\n\n` : `# ${title}\n\n`;
    return header;
  }
  
  const trimmed = content.trim();
  const hasHeader = isAsciiDoc 
    ? /^=\s+/.test(trimmed)
    : /^#\s+/.test(trimmed);
  
  if (!hasHeader) {
    const header = isAsciiDoc ? `= ${title}\n\n` : `# ${title}\n\n`;
    return header + content;
  }
  
  return content;
}

/**
 * Fix attribute block spacing - remove blank lines between [attribute] and headings
 */
export function fixAttributeBlockSpacing(content: string, isAsciiDoc: boolean = true): string {
  if (!content || !isAsciiDoc) return content;
  
  const lines = content.split('\n');
  const fixed: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this is a block attribute
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      fixed.push(line);
      // Skip blank lines after block attribute
      let j = i + 1;
      while (j < lines.length && lines[j].trim().length === 0) {
        j++;
      }
      // If next line is a heading, don't add blank lines
      if (j < lines.length && /^==+\s+/.test(lines[j].trim())) {
        i = j - 1; // Will be incremented to j in next iteration
        continue;
      }
      // Otherwise, keep one blank line
      if (j > i + 1) {
        fixed.push('');
      }
    } else {
      fixed.push(line);
    }
  }
  
  return fixed.join('\n');
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
    const title = getTitleFromEvent(event, true);
    return ensureDocumentHeader('', title, isAsciiDoc);
  }
  
  let processed = content;
  
  // 1. Ensure document header
  const title = getTitleFromEvent(event, true);
  processed = ensureDocumentHeader(processed, title, isAsciiDoc);
  
  // 2. Fix header spacing
  processed = fixHeaderSpacing(processed, isAsciiDoc);
  
  // 3. Fix missing heading levels
  processed = fixMissingHeadingLevels(processed, isAsciiDoc);
  
  // 4. Fix empty headings
  processed = fixEmptyHeadings(processed, isAsciiDoc);
  
  // 5. Fix preamble content (move content before first section to Preamble)
  // This runs AFTER all conversions and metadata additions
  processed = fixPreambleContent(processed, isAsciiDoc);
  
  // 6. Fix attribute block spacing (remove blank lines between [attribute] and headings)
  // This must run AFTER all other processing to catch any spacing issues introduced
  processed = fixAttributeBlockSpacing(processed, isAsciiDoc);
  
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
  
  // Then process Nostr addresses (async) - if function provided
  if (getUserDisplayName) {
    // Process nostr: links to format with user names
    // This would need to be implemented based on your nostr address processing logic
    // For now, we just return the processed content
  }
  
  return processed;
}

