/**
 * Utility functions for Wikistr
 * Clean, simple utilities without circular dependencies
 */

import {
  parseBookWikilink as parseBookWikilinkNkbip,
  type ParsedBookReference
} from './bookWikilinkParser';

let nextId = 0;

/**
 * Generate next unique ID
 */
export function next(): number {
  return ++nextId;
}

/**
 * Check if element is in viewport
 */
export function isElementInViewport(element: HTMLElement | string): boolean {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (!el) return false;
  
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Scroll element into view
 */
export function scrollIntoView(elementId: string, smooth = true): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }
}

/**
 * Get parent card element
 */
export function getParentCard(element: HTMLElement): HTMLElement | null {
  let current = element;
  while (current && current !== document.body) {
    if (current.id && current.id.startsWith('wikicard-')) {
      return current;
    }
    current = current.parentElement!;
  }
  return null;
}

/**
 * Add unique tagged replaceable event to array
 * Prevents duplicates and maintains order
 */
/**
 * Validate d-tag - much less restrictive:
 * - Allows Unicode letters (including Æ, ö, ß, etc.), numbers, and hyphens
 * - Blocks spaces and punctuation (except hyphens)
 * - Blocks URL patterns for safety
 * Returns true if d-tag is valid, false otherwise
 */
export function isValidDTag(dTag: string): boolean {
  if (!dTag || typeof dTag !== 'string') return false;
  
  // Block URL patterns for safety
  if (/https?:\/\//i.test(dTag) || /wss?:\/\//i.test(dTag)) {
    return false;
  }
  
  // Block spaces
  if (/\s/.test(dTag)) {
    return false;
  }
  
  // Allow Unicode letters (including Æ, ö, ß, etc.), numbers, and hyphens
  // Block all other punctuation except hyphens
  // This regex allows: Unicode letters (\p{L}), numbers (\p{N}), and hyphens (-)
  return /^[\p{L}\p{N}-]+$/u.test(dTag);
}

/**
 * Validate event's d-tag and filter out corrupt events
 * Returns true if event is valid, false if it should be suppressed
 */
export function isValidEvent(event: any): boolean {
  if (!event || !event.tags) return true; // Non-replaceable events don't need d-tag validation
  
  // Only validate replaceable/addressable events that require d-tags
  const requiresDTag = event.kind === 30818 || event.kind === 30817 || event.kind === 30041 || 
                       event.kind === 30040 || event.kind === 30023 || 
                       (event.kind >= 30000 && event.kind < 40000);
  
  if (requiresDTag) {
    const dTag = event.tags?.find(([t]: any[]) => t === 'd')?.[1];
    if (dTag) {
      // Validate d-tag - allows Unicode letters, numbers, and hyphens; blocks spaces and punctuation
      if (!isValidDTag(dTag)) {
        return false;
      }
    }
  }
  
  return true;
}

export function addUniqueTaggedReplaceable(events: any[], newEvent: any): boolean {
  if (!newEvent || !newEvent.id) return false;
  
  // For replaceable events (wiki, kind30041, etc.), deduplicate by a-tag and keep newest
  const isReplaceable = newEvent.kind === 30818 || newEvent.kind === 30817 || newEvent.kind === 30041 || newEvent.kind === 1111;
  
  if (isReplaceable) {
    const dTag = newEvent.tags?.find(([t]: any[]) => t === 'd')?.[1];
    if (dTag) {
      // Normalize d-tag for comparison
      const normalizedDTag = normalizeDTag(dTag);
      const aTag = `${newEvent.kind}:${newEvent.pubkey}:${normalizedDTag}`;
      
      // Find existing event with same a-tag
      const existingIndex = events.findIndex((evt: any) => {
        const evtDTag = evt.tags?.find(([t]: any[]) => t === 'd')?.[1];
        if (!evtDTag) return false;
        // Normalize for comparison
        const normalizedEvtDTag = normalizeDTag(evtDTag);
        const evtATag = `${evt.kind}:${evt.pubkey}:${normalizedEvtDTag}`;
        return evtATag === aTag;
      });
      
      if (existingIndex !== -1) {
        const existing = events[existingIndex];
        // Keep only the newest version
        if (newEvent.created_at > existing.created_at) {
          events[existingIndex] = newEvent;
          return true;
        } else {
          // Older version, don't add
          return false;
        }
      }
    }
  }
  
  // Check if event already exists by ID
  const exists = events.some(evt => evt.id === newEvent.id);
  if (exists) return false;
  
  // Add event
  events.push(newEvent);
  return true;
}

/**
 * Normalize a d-tag according to NIP-54 rules
 * Always returns lowercase, normalized form
 */
export function normalizeDTag(dTag: string): string {
  if (!dTag || typeof dTag !== 'string') return dTag;
  
  try {
    const { normalizeIdentifier } = require('@nostr/tools/nip54');
    return normalizeIdentifier(dTag);
  } catch (e) {
    // Fallback: just lowercase if normalization fails
    return dTag.toLowerCase();
  }
}

/**
 * Get tag value or return default
 * Automatically normalizes d-tags to ensure consistency
 */
export function getTagOr(event: any, tagName: string, defaultValue = ''): string {
  if (!event || !event.tags) return defaultValue;
  
  const tag = event.tags.find((t: any[]) => t[0] === tagName);
  const value = tag ? tag[1] || defaultValue : defaultValue;
  
  // Normalize d-tags to ensure they're always in lowercase, normalized form
  if (tagName === 'd' && value && value !== defaultValue) {
    return normalizeDTag(value);
  }
  
  return value;
}

/**
 * Get 'a' tag value or return default
 */
export function getA(event: any, defaultValue = ''): string {
  return getTagOr(event, 'a', defaultValue);
}

/**
 * Remove URL scheme
 */
export function urlWithoutScheme(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
}

/**
 * Generate hashbow color from string
 */
export function hashbow(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Format date relative to now
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Check if string is valid hex
 */
export function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Check if string looks like a pubkey
 */
export function looksLikePubkey(str: string): boolean {
  return str.length === 64 && isValidHex(str);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

/**
 * Remove duplicates from array
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Deduplicate relay URLs by normalizing them
 */
export function deduplicateRelays(relays: string[]): string[] {
  const normalized = relays.map(url => {
    if (!url) return '';
    
    let normalized = url.replace(/\/$/, '');
    
    if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
      normalized = 'wss://' + normalized;
    }
    
    return normalized;
  }).filter(url => url);
  
  return [...new Set(normalized)];
}

function cleanBookWikilinkContent(raw: string): string {
  if (!raw) return '';

  // Remove any HTML tags that snuck in before parsing
  let cleaned = raw.replace(/<\/?[^>]+>/g, ' ');

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

function humanizeBookSegment(segment: string): string {
  if (!segment) return '';

  return segment
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

/**
 * Format section array, preserving ranges
 * Converts [16, 17, 18] to "16-18" instead of "16,17,18"
 */
export function formatSections(sections: string[]): string {
  if (sections.length === 0) return '';
  if (sections.length === 1) return sections[0];
  
  // Separate numeric and non-numeric sections, sort numeric ones
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
  
  // Sort numeric sections
  numeric.sort((a, b) => a - b);
  
  // Group consecutive numbers into ranges
  const parts: Array<string | { start: number; end: number }> = [];
  
  // Process numeric sections
  let i = 0;
  while (i < numeric.length) {
    let rangeStart = numeric[i];
    let rangeEnd = numeric[i];
    let j = i + 1;
    
    while (j < numeric.length && numeric[j] === rangeEnd + 1) {
      rangeEnd = numeric[j];
      j++;
    }
    
    // If we have a range (at least 2 consecutive numbers), store as range
    if (j - i >= 2) {
      parts.push({ start: rangeStart, end: rangeEnd });
      i = j;
    } else {
      // Single number
      parts.push(numeric[i].toString());
      i++;
    }
  }
  
  // Add non-numeric sections at the end
  parts.push(...nonNumeric);
  
  // Format parts
  return parts.map(part => {
    if (typeof part === 'string') {
      return part;
    } else {
      return `${part.start}-${part.end}`;
    }
  }).join(',');
}

function formatBookReferenceDisplay(ref: ParsedBookReference): string {
  const collection = ref.collection?.toLowerCase();
  const isQuran = collection === 'quran';
  const isTorah = collection === 'torah';
  const isBible = collection === 'bible' || !collection; // Default to bible if no collection
  
  // For Quran: handle numbered surahs (1-114) vs named surahs
  let titlePart = '';
  if (ref.title) {
    if (isQuran) {
      // Check if title is a number (1-114) - surah number
      const titleAsNumber = parseInt(ref.title.trim(), 10);
      if (!isNaN(titleAsNumber) && titleAsNumber >= 1 && titleAsNumber <= 114) {
        // It's a numbered surah - display as "Surah 1" or just the number
        titlePart = `Surah ${titleAsNumber}`;
      } else {
        // It's a named surah - humanize it
        titlePart = humanizeBookSegment(ref.title);
      }
    } else {
      // For Bible/Torah, humanize normally
      titlePart = humanizeBookSegment(ref.title);
    }
  }
  
  const collectionPart = ref.collection ? humanizeBookSegment(ref.collection) : '';

  let display = titlePart;
  if (ref.chapter) {
    // For Quran: if title is a surah number and chapter is provided, format as "Surah 1:1" (surah:ayah)
    // For Bible/Torah: format as "Book 1" or "Book 1:1"
    if (isQuran && titlePart.startsWith('Surah ')) {
      // Title is already "Surah X", chapter is the ayah number
      display = `${titlePart}:${ref.chapter}`;
    } else {
      display = display ? `${display} ${ref.chapter}` : ref.chapter;
    }
  }

  if (ref.section && ref.section.length > 0) {
    const sectionText = formatSections(ref.section);
    // For Quran with numbered surahs, we already have the colon from chapter, so check
    if (isQuran && titlePart.startsWith('Surah ') && ref.chapter) {
      // Already formatted as "Surah 1:1", sections are additional ayahs
      display += `,${sectionText}`;
    } else {
      display += `${display && !display.endsWith(':') ? ':' : ''}${sectionText}`;
    }
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

function formatBookWikilinkDisplayText(content: string): string {
  if (!content) return '';

  const parsed = parseBookWikilinkNkbip(`[[book::${content}]]`);
  if (!parsed?.references?.length) {
    return content;
  }

  const formatted = parsed.references.map(formatBookReferenceDisplay);
  return formatted.join(', ');
}

function escapeAsciiDocDisplay(text: string): string {
  return text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/**
 * Preprocess content for AsciiDoc rendering
 */
export function preprocessContentForAsciidoc(content: string): string {
  if (!content) return '';
  
  let processed = content
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .replace(/\r\n/g, '\n') // Normalize line endings
    .trim();
  
  // Protect code blocks and inline code from wikilink processing
  const codePlaceholders: string[] = [];
  let placeholderIndex = 0;
  
  // Protect code blocks (---- blocks)
  processed = processed.replace(/^----\n([\s\S]*?)\n----$/gm, (match) => {
    const placeholder = `__CODE_BLOCK_${placeholderIndex}__`;
    codePlaceholders[placeholderIndex] = match;
    placeholderIndex++;
    return placeholder;
  });
  
  // Protect inline code with backticks (single backtick)
  processed = processed.replace(/`([^`]+)`/g, (match) => {
    const placeholder = `__INLINE_CODE_${placeholderIndex}__`;
    codePlaceholders[placeholderIndex] = match;
    placeholderIndex++;
    return placeholder;
  });
  
  // Protect [source] code blocks - match more flexibly
  // Pattern: [source,lang] followed by ---- block
  processed = processed.replace(/\[source[^\]]*\]\n----\n([\s\S]*?)\n----/gm, (match) => {
    const placeholder = `__SOURCE_BLOCK_${placeholderIndex}__`;
    codePlaceholders[placeholderIndex] = match;
    placeholderIndex++;
    return placeholder;
  });
  
            // Convert bookstr wikilinks [[book::...]] to AsciiDoc link format (like regular wikilinks)
            // This creates clickable links that will open BookCard components
            // Only process outside of code blocks
            // For exports, we'll convert these to formatted text in contentQualityControl
            // Here we keep them as links for browser rendering
            processed = processed.replace(/\[\[book::([^\]]+)\]\]/g, (match, content) => {
              const cleanedContent = cleanBookWikilinkContent(content);
              if (!cleanedContent) {
                return match;
              }

              const displayText = formatBookWikilinkDisplayText(cleanedContent);
              const escapedDisplay = escapeAsciiDocDisplay(displayText);

              return `link:wikilink:book::${cleanedContent}[${escapedDisplay}]`;
            });
  
  // Convert regular wikilinks [[identifier]] or [[identifier | display text]] to AsciiDoc link format
  // This handles the case where wikilinks aren't being rendered
  // Patterns:
  //   [[identifier]] -> link:wikilink:identifier[identifier]
  //   [[identifier | display text]] -> link:wikilink:identifier[display text]
  // We need to be careful not to match bookstr links [[book::...]]
  processed = processed.replace(/\[\[(?!book::)([^\]]+)\]\]/g, (match, content) => {
    // Check if there's a pipe separator for display text
    const pipeIndex = content.indexOf(' | ');
    let identifier: string;
    let displayText: string;
    
    if (pipeIndex !== -1) {
      // Has display text: [[identifier | display text]]
      identifier = content.substring(0, pipeIndex).trim();
      displayText = content.substring(pipeIndex + 3).trim(); // +3 to skip " | "
    } else {
      // No display text: [[identifier]]
      identifier = content.trim();
      displayText = identifier;
    }
    
    // Escape any special AsciiDoc characters in the identifier for the URL
    const escaped = identifier.replace(/[<>]/g, '');
    return `link:wikilink:${escaped}[${displayText}]`;
  });
  
  // Restore protected code blocks and inline code
  // Process in reverse order to handle all placeholders correctly
  for (let index = codePlaceholders.length - 1; index >= 0; index--) {
    const code = codePlaceholders[index];
    if (!code) continue;
    
    // Try to find which placeholder type this is
    let placeholder: string | null = null;
    if (processed.includes(`__SOURCE_BLOCK_${index}__`)) {
      placeholder = `__SOURCE_BLOCK_${index}__`;
    } else if (processed.includes(`__CODE_BLOCK_${index}__`)) {
      placeholder = `__CODE_BLOCK_${index}__`;
    } else if (processed.includes(`__INLINE_CODE_${index}__`)) {
      placeholder = `__INLINE_CODE_${index}__`;
    }
    
    if (placeholder) {
      processed = processed.replace(placeholder, code);
    }
  }
  
  return processed;
}

/**
 * Scroll card into view
 */
export function scrollCardIntoView(cardId: string | HTMLElement, smooth = true): void {
  const element = typeof cardId === 'string' ? document.getElementById(cardId) : cardId;
  if (element) {
    element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  }
}

