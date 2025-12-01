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
  
  let mainContent = content;
  let versions = currentVersions || [];
  let collection = currentCollection;
  
  // Parse using pipe-based format: collection | title
  if (!collection) {
    // Split by pipes to analyze structure
    const pipeParts = content.split(/\s+\|\s+/);
  
    if (pipeParts.length === 1) {
      // No pipes, just parse normally
      mainContent = content;
    } else if (pipeParts.length === 2) {
      // Single pipe: could be "collection | title" or "title chapter | version"
      const beforePipe = pipeParts[0].trim();
      const afterPipe = pipeParts[1].trim();
      
      // Check if beforePipe has a chapter number (pattern: word(s) followed by number)
      const hasChapter = beforePipe.match(/\s+\d+(\s|$|:)/) || beforePipe.match(/^[a-zA-Z0-9_-]+\s+\d+/);
      
      if (hasChapter) {
        // This is "title chapter | version" or "title chapter:section | version"
        mainContent = beforePipe;
        versions = afterPipe.split(/\s+/).map(v => normalizeNip54(v.trim())).filter(v => v);
      } else {
        // Check if beforePipe is a simple identifier (collection)
        const collectionMatch = beforePipe.match(/^([a-zA-Z0-9_-]+)$/);
        if (collectionMatch) {
          // This is "collection | title"
          collection = normalizeNip54(collectionMatch[1]);
          mainContent = afterPipe;
        } else {
          // Ambiguous - treat as no pipe, parse normally
          mainContent = content;
        }
      }
    } else {
      // Multiple pipes: "collection | title | version" or "collection | title chapter | version"
      const firstPart = pipeParts[0].trim();
      const lastPart = pipeParts[pipeParts.length - 1].trim();
      const middleParts = pipeParts.slice(1, -1).join(' | ');
      
      // Last part is versions (split by spaces for multiple versions)
      versions = lastPart.split(/\s+/).map(v => normalizeNip54(v.trim())).filter(v => v);
      
      // First part might be collection
      const collectionMatch = firstPart.match(/^([a-zA-Z0-9_-]+)$/);
      if (collectionMatch && !firstPart.match(/\s/)) {
        collection = normalizeNip54(collectionMatch[1]);
        mainContent = middleParts || pipeParts[1].trim();
      } else {
        // No collection, first part is part of title
        mainContent = pipeParts.slice(0, -1).join(' | ');
      }
    }
  }
  
  // Now parse the main content (title, chapter, section)
  // Pattern: "title chapter:section" or "title chapter" or just "title"
  const chapterSectionMatch = mainContent.match(/^(.+?)\s+(\d+|[a-zA-Z0-9_-]+)(?::(.+))?$/);
  
  let title: string;
  let chapter: string | undefined;
  let sections: string[] | undefined;
  
  // Use collection from pipe parsing, or keep currentCollection if not set
  if (!collection) {
    collection = currentCollection;
  }
  
  if (chapterSectionMatch) {
    const titlePart = chapterSectionMatch[1].trim();
    const chapterPart = chapterSectionMatch[2];
    const sectionPart = chapterSectionMatch[3];
    
    // Check if titlePart contains a collection separator (only if we don't already have a collection)
    const titleCollectionMatch = titlePart.match(/^([a-zA-Z0-9_-]+)\s+\|\s+(.+)$/);
    if (titleCollectionMatch && !collection) {
      collection = normalizeNip54(titleCollectionMatch[1]);
      const titleInput = titleCollectionMatch[2].trim();
      // For Quran: if title is a number (1-114), don't use recognizeBookName (Bible book map)
      if (collection === 'quran') {
        const titleAsNumber = parseInt(titleInput, 10);
        if (!isNaN(titleAsNumber) && titleAsNumber >= 1 && titleAsNumber <= 114) {
          title = titleInput; // Keep as number for Quran surahs
        } else {
          title = recognizeBookName(titleInput);
        }
      } else {
        title = recognizeBookName(titleInput);
      }
    } else {
      // For Quran: if title is a number (1-114), don't use recognizeBookName (Bible book map)
      if (collection === 'quran') {
        const titleAsNumber = parseInt(titlePart, 10);
        if (!isNaN(titleAsNumber) && titleAsNumber >= 1 && titleAsNumber <= 114) {
          title = titlePart; // Keep as number for Quran surahs
        } else {
          title = recognizeBookName(titlePart);
        }
      } else {
        title = recognizeBookName(titlePart);
      }
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
    if (titleCollectionMatch && !collection) {
      collection = normalizeNip54(titleCollectionMatch[1]);
      const titleInput = titleCollectionMatch[2].trim();
      // For Quran: if title is a number (1-114), don't use recognizeBookName (Bible book map)
      if (collection === 'quran') {
        const titleAsNumber = parseInt(titleInput, 10);
        if (!isNaN(titleAsNumber) && titleAsNumber >= 1 && titleAsNumber <= 114) {
          title = titleInput; // Keep as number for Quran surahs
        } else {
          title = recognizeBookName(titleInput);
        }
      } else {
        title = recognizeBookName(titleInput);
      }
    } else {
      // For Quran: if title is a number (1-114), don't use recognizeBookName (Bible book map)
      if (collection === 'quran') {
        const titleAsNumber = parseInt(mainContent, 10);
        if (!isNaN(titleAsNumber) && titleAsNumber >= 1 && titleAsNumber <= 114) {
          title = mainContent; // Keep as number for Quran surahs
        } else {
          title = recognizeBookName(mainContent);
        }
      } else {
        title = recognizeBookName(mainContent);
      }
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
  
  // Check for global version at the end: "ref1, ref2 | global-version"
  // Pattern: if there's a pipe at the end (not part of a reference), it's a global version
  let globalVersions: string[] | undefined;
  let contentWithoutGlobalVersion = content;
  
  // Find the last pipe that's not inside quotes
  let lastPipeIndex = -1;
  let inQuotes = false;
  for (let i = content.length - 1; i >= 0; i--) {
    const char = content[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === '|' && !inQuotes) {
      lastPipeIndex = i;
      break;
    }
  }
  
  // If we found a pipe, check if it's a global version (after the last comma+space)
  // Exception: if the part before the pipe doesn't have chapter:section, it might be a title continuation
  if (lastPipeIndex >= 0) {
    const beforePipe = content.substring(0, lastPipeIndex).trim();
    const afterPipe = content.substring(lastPipeIndex + 1).trim();
    
    // Check if afterPipe looks like a version
    // Versions can contain numbers (e.g., "YLT98", "WEB"), but should not have chapter:section patterns
    // Exclude patterns that look like chapter:section (e.g., "3:16", "1:2-4")
    const looksLikeVersion = /^[a-zA-Z0-9_-]+(\s+[a-zA-Z0-9_-]+)*$/.test(afterPipe) && 
                             !afterPipe.match(/:\d+/) && // No :number patterns (chapter:section)
                             !afterPipe.match(/\d+\s*:\s*\d+/) && // No number:number patterns
                             !afterPipe.match(/^\d+\s*:/); // No leading number: pattern
    
    if (looksLikeVersion) {
      // Check if the part before the pipe has a chapter:section pattern
      // If it doesn't, the part after the pipe might be a title continuation, not a global version
      const hasChapterSection = beforePipe.match(/:\d+/) || // Has :number pattern
                                 beforePipe.match(/\d+\s*:/) || // Has number: pattern
                                 beforePipe.match(/\s+\d+(\s|$)/); // Has space+number (chapter)
      
      // Also check if there's a comma+space before the pipe (indicating multiple references)
      // If there's no comma+space, it's likely a single reference with version, not a global version
      const hasCommaSpace = beforePipe.match(/,\s+[^,]+$/);
      
      // Only treat as global version if:
      // 1. The part before pipe has chapter:section pattern (complete reference), OR
      // 2. There's a comma+space before the pipe (multiple references)
      if (hasChapterSection || hasCommaSpace) {
        // This is a global version - extract it
        globalVersions = afterPipe.split(/\s+/).map(v => normalizeNip54(v.trim())).filter(v => v);
        contentWithoutGlobalVersion = beforePipe;
      }
    }
  }
  
  // Handle multiple book references (comma + space indicates new book)
  // Pattern: "book1 ref1, book2 ref2" where comma+space = new book
  const bookRefs: string[] = [];
  let currentRef = '';
  inQuotes = false;
  
  for (let i = 0; i < contentWithoutGlobalVersion.length; i++) {
    const char = contentWithoutGlobalVersion[i];
    const nextChar = contentWithoutGlobalVersion[i + 1];
    
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
    bookRefs.push(contentWithoutGlobalVersion);
  }
  
  // Parse each book reference
  let currentCollection: string | undefined;
  let currentVersions: string[] | undefined = globalVersions;
  
  for (const ref of bookRefs) {
    const parsed = parseSingleBookReference(ref, currentCollection, currentVersions);
    if (parsed) {
      references.push(parsed);
      // Update current collection/versions for next reference if not specified
      if (parsed.collection) currentCollection = parsed.collection;
      // If this reference has its own version, use it; otherwise keep global version
      if (parsed.version && parsed.version.length > 0) {
        currentVersions = parsed.version;
      } else if (globalVersions) {
        // Apply global version to this reference
        parsed.version = globalVersions;
        currentVersions = globalVersions;
      }
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

