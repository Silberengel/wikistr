/**
 * OpenGraph metadata fetching utilities
 */

const OG_PROXY_URL = (import.meta.env.VITE_OG_PROXY_URL as string | undefined)?.trim() || '/sites/';

export interface OGMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
  urlFromOG?: boolean; // True if URL came from og:url meta tag, false if it was a fallback
}

/**
 * Build proxy URL for OG fetching
 */
function buildProxyUrl(url: string): string {
  // Use query parameter instead of encoding in path
  const encoded = encodeURIComponent(url);
  
  // If OG_PROXY_URL is a full URL, use it directly
  if (OG_PROXY_URL.startsWith('http://') || OG_PROXY_URL.startsWith('https://')) {
    const sanitizedProxy = OG_PROXY_URL.replace(/\/$/, '');
    return `${sanitizedProxy}?url=${encoded}`;
  }
  
  // Otherwise, treat as relative path - remove trailing slash for query param usage
  const basePath = OG_PROXY_URL.replace(/\/$/, '') || '/sites';
  return `${basePath}?url=${encoded}`;
}

/**
 * Fetch OpenGraph metadata from a URL via proxy
 */
export async function fetchOGMetadata(url: string): Promise<OGMetadata | null> {
  try {
    const proxied = buildProxyUrl(url);
    
    // Add timeout to prevent hanging when proxy is down
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(proxied, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      // Don't log warnings for proxy failures - they're expected when proxy is down
      if (response.status !== 404 && response.status !== 502 && response.status !== 503) {
        console.warn('OG fetch failed:', response.status, response.statusText, 'for', url);
      }
      return null;
    }
    
    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      console.warn('OG fetch: unexpected content type', contentType, 'for', url);
    }
    
    let html = await response.text();
    
    if (!html || html.trim().length === 0) {
      console.warn('OG fetch: empty response for', url);
      return null;
    }
    
    // Remove script tags to prevent them from being executed
    // This prevents module loading errors when parsing HTML with DOMParser
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Also remove script tags without closing tags (self-closing or malformed)
    html = html.replace(/<script\b[^>]*>/gi, '');
    
    if (typeof DOMParser === 'undefined') {
      console.warn('OG fetch: DOMParser not available');
      return null;
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Check for parse errors (XML parser errors)
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('OG fetch: HTML parse error for', url, parseError.textContent?.slice(0, 100));
      // Continue anyway - partial HTML might still have metadata
    }
    
    // Extract OG metadata
    const getMetaContent = (property: string): string | undefined => {
      const meta = doc.querySelector(`meta[property="${property}"]`) || 
                   doc.querySelector(`meta[name="${property}"]`);
      return meta?.getAttribute('content')?.trim() || undefined;
    };
    
    const title = getMetaContent('og:title') || 
                  doc.querySelector('title')?.textContent?.trim() || 
                  undefined;
    
    const description = getMetaContent('og:description') || 
                       getMetaContent('description') || 
                       undefined;
    
    const image = getMetaContent('og:image') || undefined;
    
    const urlFromOG = !!getMetaContent('og:url');
    const urlMeta = getMetaContent('og:url') || url;
    
    const siteName = getMetaContent('og:site_name') || undefined;
    
    // Only return if we have at least a title
    if (!title) {
      console.warn('OG fetch: no title found for', url);
      return null;
    }
    
    return {
      title,
      description,
      image,
      url: urlMeta,
      siteName,
      urlFromOG
    };
  } catch (error) {
    // Don't log errors for network failures or timeouts - proxy might be down
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // Network error - proxy likely down, fail silently
      return null;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      // Timeout - proxy likely down or slow, fail silently
      return null;
    }
    // Only log unexpected errors
    console.error('Failed to fetch OG metadata for', url, ':', error);
    return null;
  }
}

/**
 * Check if a URL contains a Nostr identifier
 */
export function extractNostrIdentifier(url: string): {
  type: 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr' | null;
  value: string;
} | null {
  // Try to extract bech32 identifiers from URL
  const bech32Pattern = /(npub1|nprofile1|nevent1|note1|naddr1)[a-zA-Z0-9]{58,}/;
  const match = url.match(bech32Pattern);
  
  if (match) {
    const bech32 = match[0];
    const type = bech32.substring(0, bech32.indexOf('1')) as 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr';
    return { type, value: bech32 };
  }
  
  // Try to extract hex IDs (64 char hex strings)
  const hexPattern = /[0-9a-fA-F]{64}/;
  const hexMatch = url.match(hexPattern);
  
  if (hexMatch) {
    return { type: 'note', value: hexMatch[0] };
  }
  
  return null;
}

/**
 * Check if a link is standalone (in its own <p> tag or block-level element)
 */
export function isStandaloneLink(element: HTMLElement): boolean {
  // Check if the link is the only content in its parent paragraph
  const parent = element.parentElement;
  if (!parent) return false;
  
  // If parent is a <p> tag
  if (parent.tagName === 'P') {
    const textContent = parent.textContent?.trim() || '';
    const linkText = element.textContent?.trim() || '';
    // If link text is most of the paragraph content (80%+), consider it standalone
    if (linkText.length > 0 && linkText.length / textContent.length > 0.8) {
      return true;
    }
  }
  
  // Check if link is in a list item (don't render OG for links in lists)
  let current: HTMLElement | null = parent;
  while (current) {
    if (current.tagName === 'LI' || current.tagName === 'UL' || current.tagName === 'OL') {
      return false;
    }
    current = current.parentElement;
  }
  
  // Check if link is in a blockquote (could be standalone)
  current = parent;
  while (current) {
    if (current.tagName === 'BLOCKQUOTE') {
      // In blockquote, check if it's the main content
      const textContent = current.textContent?.trim() || '';
      const linkText = element.textContent?.trim() || '';
      if (linkText.length > 0 && linkText.length / textContent.length > 0.8) {
        return true;
      }
    }
    current = current.parentElement;
  }
  
  return false;
}

