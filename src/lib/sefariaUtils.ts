import type { BookReference } from './books';

// Get proxy URL from environment variable, default to relative path
const OG_PROXY_URL = (import.meta.env.VITE_OG_PROXY_URL as string | undefined)?.trim() || '/sites/';

/**
 * Get the first verse number from a verse string (handles ranges and lists)
 * Since Sefaria doesn't support ranges, we always use the first verse requested
 */
function getFirstVerse(verse: string): number | null {
  if (!verse) return null;
  
  // Split by comma to handle lists like "6,8,10"
  const firstPart = verse.split(',')[0].trim();
  
  // Handle ranges like "6-8" - take the first number
  if (firstPart.includes('-')) {
    const start = parseInt(firstPart.split('-')[0].trim(), 10);
    return isNaN(start) ? null : start;
  }
  
  // Single verse number
  const verseNum = parseInt(firstPart, 10);
  return isNaN(verseNum) ? null : verseNum;
}

/**
 * Normalize book name to Sefaria format (capitalize first letter of each word)
 * Handles case-insensitive input: "genesis" -> "Genesis", "EXODUS" -> "Exodus"
 */
function normalizeSefariaBookName(bookName: string): string {
  return bookName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generate Sefaria URL for a single reference
 * Format:
 * - Book only: https://www.sefaria.org/{BookName}?tab=contents
 * - Chapter: https://www.sefaria.org/{BookName}.{Chapter}?lang=bi
 * - Verse: https://www.sefaria.org/{BookName}.{Chapter}.{Verse}?lang=bi&with=all&lang2=en
 */
function generateSingleReferenceUrl(ref: BookReference): string | null {
  if (!ref.book) return null;
  
  // Sefaria uses exact book names: Genesis, Exodus, Leviticus, Numbers, Deuteronomy
  // Normalize to proper case (capitalize first letter of each word)
  const bookName = normalizeSefariaBookName(ref.book);
  
  if (!ref.chapter) {
    // Book only
    return `https://www.sefaria.org/${bookName}?tab=contents`;
  }
  
  if (!ref.verse) {
    // Chapter only
    return `https://www.sefaria.org/${bookName}.${ref.chapter}?lang=bi`;
  }
  
  // Verse - get first verse from range/list
  const firstVerse = getFirstVerse(ref.verse);
  if (firstVerse === null) {
    // Invalid verse, fall back to chapter
    return `https://www.sefaria.org/${bookName}.${ref.chapter}?lang=bi`;
  }
  
  // Verse with chapter
  return `https://www.sefaria.org/${bookName}.${ref.chapter}.${firstVerse}?lang=bi&with=all&lang2=en`;
}

/**
 * Generate Sefaria URL from parsed query
 * For multiple references, we generate a URL for the first reference
 * (Sefaria doesn't support multiple references in one URL)
 */
export function generateSefariaUrl(
  parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null
): string | null {
  if (!parsedQuery || parsedQuery.references.length === 0) return null;
  
  // Sefaria doesn't support multiple references, so use the first one
  return generateSingleReferenceUrl(parsedQuery.references[0]);
}

/**
 * Generate Sefaria URL for a single book reference (for individual cards)
 */
export function generateSefariaUrlForReference(
  ref: BookReference
): string | null {
  return generateSingleReferenceUrl(ref);
}

function buildProxyUrl(target: string): string {
  // Use query parameter instead of encoding in path
  const encoded = encodeURIComponent(target);
  
  // Always ensure trailing slash before query parameter
  let baseUrl: string;
  if (OG_PROXY_URL.startsWith('http://') || OG_PROXY_URL.startsWith('https://')) {
    // Full URL - ensure trailing slash
    baseUrl = OG_PROXY_URL.endsWith('/') ? OG_PROXY_URL : `${OG_PROXY_URL}/`;
  } else {
    // Relative path - ensure trailing slash
    baseUrl = OG_PROXY_URL.endsWith('/') ? OG_PROXY_URL : (OG_PROXY_URL || '/sites/');
    if (!baseUrl.endsWith('/')) {
      baseUrl = `${baseUrl}/`;
    }
  }
  
  return `${baseUrl}?url=${encoded}`;
}

/**
 * Fetch OG metadata from Sefaria via proxy
 */
export async function fetchSefariaOg(url: string): Promise<{ title?: string; description?: string; image?: string }> {
  const proxied = buildProxyUrl(url);
  
  let response: Response;
  try {
    response = await fetch(proxied, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      // Add timeout to prevent hanging (5 seconds - should be quick, fallback to link if slow)
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      // For 502/504 errors, provide more context
      if (response.status === 502 || response.status === 504) {
        console.warn('Sefaria OG fetch failed: Proxy server error', response.status, response.statusText, 'for', url);
        throw new Error('Proxy server error - Sefaria may be temporarily unavailable');
      }
      console.warn('Sefaria OG fetch failed:', response.status, response.statusText, 'for', url);
      throw new Error('Preview unavailable');
    }
  } catch (error: any) {
    // Handle timeout and network errors
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.warn('Sefaria OG fetch timeout for', url);
      throw new Error('Request timeout - Sefaria took too long to respond');
    }
    if (error.message?.includes('Proxy server error')) {
      throw error; // Re-throw our custom error
    }
    console.warn('Sefaria OG fetch error:', error.message || error, 'for', url);
    throw new Error('Preview unavailable');
  }
  
  // Check content type
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    console.warn('Sefaria OG fetch: unexpected content type', contentType, 'for', url);
  }
  
  const html = await response.text();
  
  if (!html || html.trim().length === 0) {
    console.warn('Sefaria OG fetch: empty response for', url);
    throw new Error('Preview unavailable');
  }
  
  if (typeof DOMParser === 'undefined') {
    throw new Error('Preview unavailable');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.querySelector('title')?.textContent || '';
  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
    '';
  const image = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined;

  return {
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
    image
  };
}

