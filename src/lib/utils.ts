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
  
  // Check if event already exists
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
  
  // Basic preprocessing for AsciiDoc
  return content
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .replace(/\r\n/g, '\n') // Normalize line endings
    .trim();
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

