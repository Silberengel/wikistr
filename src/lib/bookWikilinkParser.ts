/**
 * Parser for bookstr macro wikilinks according to NKBIP-08
 * Handles [[book::...]] syntax with collection, title, chapter, section, version fields
 */

// Initialize book title map on module load
import { bookTitleMapData } from './bookTitleMap';

export interface ParsedBookReference {
  collection?: string;
  title: string;
  chapter?: string;
  section?: string[];
  version?: string[];
}

export interface ParsedBookWikilink {
  references: ParsedBookReference[];
}

/**
 * Normalize string according to NIP-54 rules:
 * - Remove quotes
 * - Convert any non-letter character to hyphen
 * - Convert all letters to lowercase
 * - Preserve numbers (don't convert to hyphens)
 */
function normalizeNip54(text: string): string {
  return text
    .replace(/['"]/g, '') // Remove quotes
    .replace(/[^a-zA-Z0-9]/g, (char) => {
      // If it's a letter, convert to lowercase
      if (/[a-zA-Z]/.test(char)) {
        return char.toLowerCase();
      }
      // If it's a number, preserve it
      if (/[0-9]/.test(char)) {
        return char;
      }
      // Otherwise, convert to hyphen
      return '-';
    })
    .toLowerCase()
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Expand section range (e.g., "4-9" -> ["4", "5", "6", "7", "8", "9"])
 */
function expandRange(range: string): string[] {
  const parts = range.split('-').map(p => p.trim());
  if (parts.length !== 2) return [range];
  
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  
  if (isNaN(start) || isNaN(end) || start > end) return [range];
  
  const result: string[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i.toString());
  }
  return result;
}

/**
 * Expand section ranges in a comma-separated list
 * (e.g., "4-9,11-12,22" -> ["4", "5", "6", "7", "8", "9", "11", "12", "22"])
 */
function expandSectionRanges(sections: string): string[] {
  const parts = sections.split(',').map(p => p.trim());
  const result: string[] = [];
  
  for (const part of parts) {
    if (part.includes('-')) {
      result.push(...expandRange(part));
    } else {
      result.push(part);
    }
  }
  
  return result;
}

/**
 * Load book title mappings from YAML file
 * This will be loaded at runtime or imported as a constant
 */
let bookTitleMap: Map<string, { canonicalLong: string; canonicalShort: string }> | null = null;

/**
 * Initialize book title map (should be called with data from book_title_map.yml)
 */
function initBookTitleMap(mapData: Array<{
  display: string;
  'canonical-long': string;
  'canonical-short': string;
}>): void {
  bookTitleMap = new Map();
  
  for (const entry of mapData) {
    const normalized = normalizeNip54(entry['canonical-long']);
    bookTitleMap.set(normalized, {
      canonicalLong: entry['canonical-long'],
      canonicalShort: entry['canonical-short']
    });
    
    // Also map the short name
    const normalizedShort = normalizeNip54(entry['canonical-short']);
    bookTitleMap.set(normalizedShort, {
      canonicalLong: entry['canonical-long'],
      canonicalShort: entry['canonical-short']
    });
    
    // Map display name variations
    const normalizedDisplay = normalizeNip54(entry.display);
    if (!bookTitleMap.has(normalizedDisplay)) {
      bookTitleMap.set(normalizedDisplay, {
        canonicalLong: entry['canonical-long'],
        canonicalShort: entry['canonical-short']
      });
    }
  }
}

// Initialize on module load
initBookTitleMap(bookTitleMapData);

/**
 * Recognize and normalize Bible book names using the title map
 */
function recognizeBookName(input: string): string {
  if (!bookTitleMap) {
    // If map not initialized, return normalized input
    return normalizeNip54(input);
  }
  
  const normalized = normalizeNip54(input);
  const mapped = bookTitleMap.get(normalized);
  
  if (mapped) {
    return normalizeNip54(mapped.canonicalLong);
  }
  
  // Try partial matches (e.g., "song" matches "song-of-solomon")
  for (const [key, value] of bookTitleMap.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return normalizeNip54(value.canonicalLong);
    }
  }
  
  return normalized;
}

/**
 * Parse a single book reference from the wikilink content
 * Handles: collection | title chapter:section | version
 * According to NKBIP-08 disambiguation rules:
 * - Single pipe after identifier = collection | title
 * - Pipe after chapter/section = version separator
 */
function parseSingleBookReference(
  content: string,
  currentCollection?: string,
  currentVersions?: string[]
): ParsedBookReference | null {
  // Remove leading/trailing whitespace
  content = content.trim();
  if (!content) return null;
  
  // First, check if there's a version pipe (after chapter/section)
  // Pattern: "... | version" where ... contains a colon (chapter:section)
  let mainContent = content;
  let versions = currentVersions || [];
  
  // Check for version pipe (must come after chapter/section, not collection)
  const versionPipeMatch = content.match(/^(.+?)\s+\|\s+(.+)$/);
  if (versionPipeMatch) {
    const beforePipe = versionPipeMatch[1];
    const afterPipe = versionPipeMatch[2];
    
    // If beforePipe contains a colon, it's chapter:section | version
    // Otherwise, check if it's collection | title
    if (beforePipe.includes(':')) {
      // This is chapter:section | version
      mainContent = beforePipe;
      versions = afterPipe.split(/\s+/).map(v => normalizeNip54(v.trim())).filter(v => v);
    } else {
      // Check if this is collection | title (single pipe after identifier)
      // Pattern: "identifier | title" where identifier has no spaces before the pipe
      const collectionMatch = beforePipe.match(/^([a-zA-Z0-9_-]+)\s*$/);
      if (collectionMatch) {
        // This is collection | title
        const collection = normalizeNip54(collectionMatch[1]);
        mainContent = afterPipe;
        return parseSingleBookReference(mainContent, collection, versions);
      } else {
        // Might be title | version, but this is ambiguous per spec
        // Only allow if there's a chapter before the pipe
        mainContent = content; // Keep original, parse normally
      }
    }
  }
  
  // Now parse the main content (title, chapter, section)
  // Pattern: "title chapter:section" or "title chapter" or just "title"
  const chapterSectionMatch = mainContent.match(/^(.+?)\s+(\d+|[a-zA-Z0-9_-]+)(?::(.+))?$/);
  
  let title: string;
  let chapter: string | undefined;
  let sections: string[] | undefined;
  let collection = currentCollection;
  
  if (chapterSectionMatch) {
    const titlePart = chapterSectionMatch[1].trim();
    const chapterPart = chapterSectionMatch[2];
    const sectionPart = chapterSectionMatch[3];
    
    // Check if titlePart contains a collection separator
    const titleCollectionMatch = titlePart.match(/^([a-zA-Z0-9_-]+)\s+\|\s+(.+)$/);
    if (titleCollectionMatch) {
      collection = normalizeNip54(titleCollectionMatch[1]);
      title = recognizeBookName(titleCollectionMatch[2].trim());
    } else {
      title = recognizeBookName(titlePart);
    }
    
    chapter = normalizeNip54(chapterPart);
    
    if (sectionPart) {
      // Has section - may contain ranges and hierarchical paths
      let sectionStr = sectionPart;
      
      // Handle hierarchical paths with colons (e.g., "section-2:1846-1849")
      // Normalize colons to hyphens, then expand ranges
      sectionStr = sectionStr.replace(/:/g, '-');
      
      // Expand ranges
      sections = expandSectionRanges(sectionStr);
    }
  } else {
    // Just title (or collection | title)
    const titleCollectionMatch = mainContent.match(/^([a-zA-Z0-9_-]+)\s+\|\s+(.+)$/);
    if (titleCollectionMatch) {
      collection = normalizeNip54(titleCollectionMatch[1]);
      title = recognizeBookName(titleCollectionMatch[2].trim());
    } else {
      title = recognizeBookName(mainContent);
    }
  }
  
  return {
    collection,
    title,
    chapter,
    section: sections,
    version: versions.length > 0 ? versions : undefined
  };
}

/**
 * Parse bookstr wikilink: [[book::...]]
 * Returns parsed references with normalized tag values
 */
export function parseBookWikilink(wikilink: string): ParsedBookWikilink | null {
  // Remove brackets
  const content = wikilink.replace(/^\[\[book::|\]\]$/g, '').trim();
  if (!content) return null;
  
  const references: ParsedBookReference[] = [];
  
  // Handle multiple book references (comma + space indicates new book)
  // Pattern: "book1 ref1, book2 ref2" where comma+space = new book
  const bookRefs: string[] = [];
  let currentRef = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
      currentRef += char;
    } else if (char === ',' && nextChar === ' ' && !inQuotes) {
      // Comma followed by space = new book reference
      if (currentRef.trim()) {
        bookRefs.push(currentRef.trim());
        currentRef = '';
      }
      i++; // Skip the space
    } else {
      currentRef += char;
    }
  }
  
  if (currentRef.trim()) {
    bookRefs.push(currentRef.trim());
  }
  
  // If no comma+space found, treat entire content as single reference
  if (bookRefs.length === 0) {
    bookRefs.push(content);
  }
  
  // Parse each book reference
  let currentCollection: string | undefined;
  let currentVersions: string[] | undefined;
  
  for (const ref of bookRefs) {
    const parsed = parseSingleBookReference(ref, currentCollection, currentVersions);
    if (parsed) {
      references.push(parsed);
      // Update current collection/versions for next reference if not specified
      if (parsed.collection) currentCollection = parsed.collection;
      if (parsed.version) currentVersions = parsed.version;
    }
  }
  
  return references.length > 0 ? { references } : null;
}

/**
 * Convert parsed book reference to search tags format
 * Returns array of [tag, value] pairs for Nostr event search
 */
export function bookReferenceToTags(ref: ParsedBookReference): string[][] {
  const tags: string[][] = [];
  
  if (ref.collection) {
    tags.push(['C', ref.collection]);
  }
  
  tags.push(['T', ref.title]);
  
  if (ref.chapter) {
    tags.push(['c', ref.chapter]);
  }
  
  if (ref.section && ref.section.length > 0) {
    for (const section of ref.section) {
      tags.push(['s', section]);
    }
  }
  
  if (ref.version && ref.version.length > 0) {
    for (const version of ref.version) {
      tags.push(['v', version]);
    }
  }
  
  return tags;
}

