import type { BookReference } from './books';

// Map version codes (e.g., "drb" -> "DRA" for Bible Gateway)
const versionMap: Record<string, string> = {
  'drb': 'DRA',
  'kjv': 'KJV',
  'niv': 'NIV',
  'esv': 'ESV',
  'nasb': 'NASB',
  'nlt': 'NLT',
  'rsv': 'RSV',
  'asv': 'ASV',
  'web': 'WEB'
};

// Get proxy URL from environment variable, default to relative path
const OG_PROXY_URL = (import.meta.env.VITE_OG_PROXY_URL as string | undefined)?.trim() || '/sites/';

function capitalizeWords(text: string): string {
  return text.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

function buildProxyUrl(target: string): string {
  // Use query parameter instead of encoding in path
  const encoded = encodeURIComponent(target);
  
  // If OG_PROXY_URL is a full URL, use it directly
  if (OG_PROXY_URL.startsWith('http://') || OG_PROXY_URL.startsWith('https://')) {
    const sanitizedProxy = OG_PROXY_URL.replace(/\/$/, '');
    return `${sanitizedProxy}?url=${encoded}`;
  }
  
  // Otherwise, treat it as a relative path - remove trailing slash for query param usage
  const basePath = OG_PROXY_URL.replace(/\/$/, '') || '/sites';
  return `${basePath}?url=${encoded}`;
}

/**
 * Generate Bible Gateway URL for a single reference
 */
function generateSingleReferenceUrl(ref: BookReference, version?: string): string | null {
  if (!ref.book || !ref.chapter) return null;
  
  // Capitalize book name
  const bookTitle = capitalizeWords(ref.book);
  let part = `${bookTitle} ${ref.chapter}`;
  
  if (ref.verse) {
    // Format verses: handle ranges and lists
    const verses = ref.verse.split(',').map(v => v.trim());
    const verseNumbers: number[] = [];
    const ranges: string[] = [];
    
    // Parse all verse numbers
    for (const verse of verses) {
      if (verse.includes('-')) {
        ranges.push(verse);
      } else {
        const num = parseInt(verse, 10);
        if (!isNaN(num)) {
          verseNumbers.push(num);
        } else {
          ranges.push(verse);
        }
      }
    }
    
    // Sort verse numbers
    verseNumbers.sort((a, b) => a - b);
    
    // Group consecutive numbers into ranges
    if (verseNumbers.length > 0) {
      let currentRange: number[] = [verseNumbers[0]];
      
      for (let i = 1; i < verseNumbers.length; i++) {
        if (verseNumbers[i] === verseNumbers[i - 1] + 1) {
          currentRange.push(verseNumbers[i]);
        } else {
          if (currentRange.length === 1) {
            ranges.push(currentRange[0].toString());
          } else {
            ranges.push(`${currentRange[0]}-${currentRange[currentRange.length - 1]}`);
          }
          currentRange = [verseNumbers[i]];
        }
      }
      
      // Finalize last range
      if (currentRange.length === 1) {
        ranges.push(currentRange[0].toString());
      } else {
        ranges.push(`${currentRange[0]}-${currentRange[currentRange.length - 1]}`);
      }
    }
    
    if (ranges.length > 0) {
      part += `:${ranges.join(',')}`;
    }
  }
  
  const versionLower = version?.toLowerCase() || 'drb';
  const bgVersion = versionMap[versionLower] || versionLower.toUpperCase();
  
  // Format like Bible Gateway: " romans 3:16-18 " (with spaces before and after)
  const searchString = ` ${part} `;
  const encodedSearch = encodeURIComponent(searchString);
  
  return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${bgVersion}`;
}

/**
 * Generate Bible Gateway URL from parsed query (same logic as Book.svelte's generateCompositeBibleGatewayUrl)
 */
export function generateBibleGatewayUrl(
  parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null,
  specificVersion?: string
): string | null {
  if (!parsedQuery || parsedQuery.references.length === 0) return null;
  
  // If only one reference, use the single reference function
  if (parsedQuery.references.length === 1) {
    return generateSingleReferenceUrl(parsedQuery.references[0], specificVersion || parsedQuery.versions?.[0] || parsedQuery.version);
  }
  
  // Build search string from all references
  const searchParts: string[] = [];
  
  for (const ref of parsedQuery.references) {
    if (!ref.book || !ref.chapter) continue;
    
    // Capitalize book name
    const bookTitle = capitalizeWords(ref.book);
    let part = `${bookTitle} ${ref.chapter}`;
    
    if (ref.verse) {
      // Format verses: handle ranges and lists
      // Bible Gateway format: "3:16-18" for ranges, "3:16,17,20" for non-consecutive
      const verses = ref.verse.split(',').map(v => v.trim());
      const verseNumbers: number[] = [];
      const ranges: string[] = [];
      
      // Parse all verse numbers
      for (const verse of verses) {
        if (verse.includes('-')) {
          // It's a range, keep as-is
          ranges.push(verse);
        } else {
          const num = parseInt(verse, 10);
          if (!isNaN(num)) {
            verseNumbers.push(num);
          } else {
            // Non-numeric, keep as-is
            ranges.push(verse);
          }
        }
      }
      
      // Sort verse numbers
      verseNumbers.sort((a, b) => a - b);
      
      // Group consecutive numbers into ranges
      if (verseNumbers.length > 0) {
        let currentRange: number[] = [verseNumbers[0]];
        
        for (let i = 1; i < verseNumbers.length; i++) {
          if (verseNumbers[i] === verseNumbers[i - 1] + 1) {
            // Consecutive, add to current range
            currentRange.push(verseNumbers[i]);
          } else {
            // Not consecutive, finalize current range and start new one
            if (currentRange.length === 1) {
              ranges.push(currentRange[0].toString());
            } else {
              ranges.push(`${currentRange[0]}-${currentRange[currentRange.length - 1]}`);
            }
            currentRange = [verseNumbers[i]];
          }
        }
        
        // Finalize last range
        if (currentRange.length === 1) {
          ranges.push(currentRange[0].toString());
        } else {
          ranges.push(`${currentRange[0]}-${currentRange[currentRange.length - 1]}`);
        }
      }
      
      if (ranges.length > 0) {
        part += `:${ranges.join(',')}`;
      }
    }
    
    searchParts.push(part);
  }
  
  if (searchParts.length === 0) return null;
  
  // Get version: use specificVersion if provided, otherwise from query or default to DRB
  const version = specificVersion?.toLowerCase() ||
                 parsedQuery.versions?.[0]?.toLowerCase() || 
                 parsedQuery.version?.toLowerCase() || 
                 'drb';
  const bgVersion = versionMap[version] || version.toUpperCase();
  
  // Format like Bible Gateway: " romans 3:16-18 " (with spaces before and after)
  const searchString = ` ${searchParts.join(', ')} `;
  const encodedSearch = encodeURIComponent(searchString);
  
  return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${bgVersion}`;
}

/**
 * Generate Bible Gateway URL for a single book reference (for individual BG cards)
 */
export function generateBibleGatewayUrlForReference(
  ref: BookReference,
  version?: string
): string | null {
  return generateSingleReferenceUrl(ref, version);
}

/**
 * Fetch OG metadata from BibleGateway via proxy
 */
export async function fetchBibleGatewayOg(url: string): Promise<{ title?: string; description?: string; image?: string }> {
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
        console.warn('BibleGateway OG fetch failed: Proxy server error', response.status, response.statusText, 'for', url);
        throw new Error('Proxy server error - Bible Gateway may be temporarily unavailable');
      }
      console.warn('BibleGateway OG fetch failed:', response.status, response.statusText, 'for', url);
      throw new Error('Preview unavailable');
    }
  } catch (error: any) {
    // Handle timeout and network errors
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.warn('BibleGateway OG fetch timeout for', url);
      throw new Error('Request timeout - Bible Gateway took too long to respond');
    }
    if (error.message?.includes('Proxy server error')) {
      throw error; // Re-throw our custom error
    }
    console.warn('BibleGateway OG fetch error:', error.message || error, 'for', url);
    throw new Error('Preview unavailable');
  }
  
  // Check content type
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    console.warn('BibleGateway OG fetch: unexpected content type', contentType, 'for', url);
  }
  
  const html = await response.text();
  
  if (!html || html.trim().length === 0) {
    console.warn('BibleGateway OG fetch: empty response for', url);
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

