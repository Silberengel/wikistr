/**
 * Utility functions for Wikistr
 * Clean, simple utilities without circular dependencies
 */

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
export function addUniqueTaggedReplaceable(events: any[], newEvent: any): boolean {
  if (!newEvent || !newEvent.id) return false;
  
  // For replaceable events (wiki, kind30041, etc.), deduplicate by a-tag and keep newest
  const isReplaceable = newEvent.kind === 30818 || newEvent.kind === 30817 || newEvent.kind === 30041 || newEvent.kind === 1111;
  
  if (isReplaceable) {
    const dTag = newEvent.tags?.find(([t]: any[]) => t === 'd')?.[1];
    if (dTag) {
      const aTag = `${newEvent.kind}:${newEvent.pubkey}:${dTag}`;
      
      // Find existing event with same a-tag
      const existingIndex = events.findIndex((evt: any) => {
        const evtDTag = evt.tags?.find(([t]: any[]) => t === 'd')?.[1];
        if (!evtDTag) return false;
        const evtATag = `${evt.kind}:${evt.pubkey}:${evtDTag}`;
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
 * Get tag value or return default
 */
export function getTagOr(event: any, tagName: string, defaultValue = ''): string {
  if (!event || !event.tags) return defaultValue;
  
  const tag = event.tags.find((t: any[]) => t[0] === tagName);
  return tag ? tag[1] || defaultValue : defaultValue;
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
  
  // Protect [source] code blocks
  processed = processed.replace(/^\[source[^\]]*\]\n----\n([\s\S]*?)\n----$/gm, (match) => {
    const placeholder = `__SOURCE_BLOCK_${placeholderIndex}__`;
    codePlaceholders[placeholderIndex] = match;
    placeholderIndex++;
    return placeholder;
  });
  
  // Convert bookstr wikilinks [[book::...]] to HTML placeholder divs wrapped in AsciiDoc inline passthrough
  // Inline passthrough pass:[...] allows raw HTML to pass through AsciiDoc processing
  // Only process outside of code blocks
  const bookstrMatches = processed.match(/\[\[book::([^\]]+)\]\]/g);
  if (bookstrMatches) {
    console.log(`preprocessContentForAsciidoc: Found ${bookstrMatches.length} bookstr wikilinks:`, bookstrMatches);
  }
  processed = processed.replace(/\[\[book::([^\]]+)\]\]/g, (match, content) => {
    // Create a unique ID for this bookstr link
    const id = `bookstr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // Store the original content in a data attribute
    // Use AsciiDoc inline passthrough syntax to preserve HTML
    const htmlDiv = `<div class="bookstr-placeholder" data-bookstr-id="${id}" data-bookstr-content="${content.replace(/"/g, '&quot;')}"></div>`;
    const placeholder = `pass:[${htmlDiv}]`;
    console.log(`preprocessContentForAsciidoc: Replacing ${match} with inline passthrough`);
    return placeholder;
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
  codePlaceholders.forEach((code, index) => {
    const placeholder = processed.includes(`__CODE_BLOCK_${index}__`) 
      ? `__CODE_BLOCK_${index}__`
      : processed.includes(`__INLINE_CODE_${index}__`)
      ? `__INLINE_CODE_${index}__`
      : `__SOURCE_BLOCK_${index}__`;
    processed = processed.replace(placeholder, code);
  });
  
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

