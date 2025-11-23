/**
 * Content Quality Control Service
 * Provides functions to ensure content quality for Markdown and AsciiDoc formats
 */

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
  
  // 1. Fix link and media formatting first (before other processing)
  processed = fixLinkAndMediaFormatting(processed, isAsciiDoc);
  
  // 2. Fix header spacing
  processed = fixHeaderSpacing(processed);
  
  // 3. Ensure document header exists (before fixing missing levels)
  const title = getTitleFromEvent(event, true);
  processed = ensureDocumentHeader(processed, title, isAsciiDoc);
  
  // 4. Fix missing heading levels (after doc header is in place)
  processed = fixMissingHeadingLevels(processed);
  
  // 5. Fix preamble content (move content before first section to Preamble)
  processed = fixPreambleContent(processed, isAsciiDoc);
  
  return processed;
}

