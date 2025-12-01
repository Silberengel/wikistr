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
  
  // Otherwise, treat as relative path - ensure it ends with / for query param usage
  const basePath = OG_PROXY_URL.endsWith('/') ? OG_PROXY_URL : (OG_PROXY_URL || '/sites/');
  return `${basePath}?url=${encoded}`;
}

/**
 * Fetch OpenGraph metadata from a URL via proxy
 */
export async function fetchOGMetadata(url: string): Promise<OGMetadata | null> {
  try {
    const proxied = buildProxyUrl(url);
    
    // Add timeout to prevent hanging when proxy is down (35 seconds - proxy has 30s, add buffer for network latency)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 second timeout
    
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
    
    let image = getMetaContent('og:image') || undefined;
    
    // Filter out empty strings - if og:image is empty, treat it as no image
    if (image === '' || !image) {
      image = undefined;
    }
    
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
  type: 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr' | 'hex' | 'nip05' | 'pubkey-dtag' | 'npub-dtag' | 'dtag-only' | null;
  value: string;
  pubkey?: string;
  dTag?: string;
} | null {
  // First, try to extract pubkey + d-tag patterns (these should be checked before bech32)
  // Pattern 1: d-tag*pubkey (e.g., editable-short-notes*460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c)
  // D-tags only contain alphanumeric and hyphens, no underscores
  const dtagPubkeyPattern = /([a-zA-Z0-9-]+)\*([0-9a-fA-F]{64})/;
  const dtagPubkeyMatch = url.match(dtagPubkeyPattern);
  
  if (dtagPubkeyMatch) {
    const dTag = dtagPubkeyMatch[1];
    const pubkey = dtagPubkeyMatch[2];
    return { type: 'pubkey-dtag', value: `${pubkey}:${dTag}`, pubkey, dTag };
  }
  
  // Pattern 2: pubkey*d-tag (with asterisk, reverse order)
  const pubkeyDtagPattern = /([0-9a-fA-F]{64})\*([a-zA-Z0-9-]+)/;
  const pubkeyDtagMatch = url.match(pubkeyDtagPattern);
  
  if (pubkeyDtagMatch) {
    const pubkey = pubkeyDtagMatch[1];
    const dTag = pubkeyDtagMatch[2];
    return { type: 'pubkey-dtag', value: `${pubkey}:${dTag}`, pubkey, dTag };
  }
  
  // Try to extract bech32 identifiers from URL
  const bech32Pattern = /(npub1|nprofile1|nevent1|note1|naddr1)[a-zA-Z0-9]{58,}/;
  const match = url.match(bech32Pattern);
  
  if (match) {
    const bech32 = match[0];
    const type = bech32.substring(0, bech32.indexOf('1')) as 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr';
    
    const urlParts = url.split('/');
    const bech32Index = urlParts.findIndex(part => part.includes(bech32));
    
    if (bech32Index >= 0) {
      // Check if there's a d-tag before the npub (e.g., /d-tag/npub...)
      if (bech32Index > 0) {
        // Look backwards through path segments to find a non-hex, non-empty segment
        for (let i = bech32Index - 1; i >= 0; i--) {
          const segment = urlParts[i];
          if (!segment || segment.trim() === '') continue;
          
          // Skip common URL path segments that aren't d-tags
          if (segment.match(/^(https?:|www\.|http|https)$/i)) continue;
          
          // Skip hex strings (64 char hex) - those are likely pubkeys/event IDs, not d-tags
          if (segment.match(/^[0-9a-fA-F]{64}$/)) continue;
          
          // Skip segments that are just domains or common paths
          if (segment.includes('.') && !segment.includes('*')) continue;
          
          // This looks like a d-tag (alphanumeric with hyphens only, possibly with asterisk)
          // D-tags only contain alphanumeric characters and hyphens, no underscores
          const dTagCandidate = segment.split('*')[0]; // Take part before asterisk if present
          if (dTagCandidate && dTagCandidate.length > 0 && 
              !dTagCandidate.match(/^[0-9a-fA-F]{64}$/) &&
              dTagCandidate.match(/^[a-zA-Z0-9-]+$/)) { // Only alphanumeric and hyphens
            // This looks like d-tag/npub pattern
            if (type === 'npub') {
              return { type: 'npub-dtag', value: bech32, dTag: dTagCandidate };
            }
            break; // Found a candidate, stop looking
          }
        }
      }
      
      // Check if there's a d-tag after the npub (e.g., /npub.../d-tag)
      if (bech32Index < urlParts.length - 1) {
        const nextSegment = urlParts[bech32Index + 1];
        if (nextSegment && nextSegment.trim() !== '') {
          // Skip hex strings and common URL parts
          if (!nextSegment.match(/^[0-9a-fA-F]{64}$/) && 
              !nextSegment.match(/^(https?:|www\.|http|https)$/i) &&
              !nextSegment.includes('.')) {
            const dTagCandidate = nextSegment.split('*')[0];
            if (dTagCandidate && dTagCandidate.length > 0 && 
                !dTagCandidate.match(/^[0-9a-fA-F]{64}$/) &&
                dTagCandidate.match(/^[a-zA-Z0-9-]+$/)) { // Only alphanumeric and hyphens
              // This looks like npub/d-tag pattern
              if (type === 'npub') {
                return { type: 'npub-dtag', value: bech32, dTag: dTagCandidate };
              }
            }
          }
        }
      }
    }
    
    return { type, value: bech32 };
  }
  
  // Pattern 3: pubkey/d-tag or d-tag/pubkey (in URL path)
  // First check if we have a hex pubkey in the URL
  const hexPattern = /[0-9a-fA-F]{64}/;
  const hexMatch = url.match(hexPattern);
  
  if (hexMatch) {
    const pubkey = hexMatch[0];
    const urlParts = url.split('/');
    const pubkeyIndex = urlParts.findIndex(part => part.includes(pubkey));
    
    if (pubkeyIndex >= 0) {
      // Check if there's a d-tag after the pubkey (e.g., /pubkey/d-tag)
      if (pubkeyIndex < urlParts.length - 1) {
        const nextSegment = urlParts[pubkeyIndex + 1];
        if (nextSegment && nextSegment.trim() !== '') {
          // Skip hex strings and common URL parts
          if (!nextSegment.match(/^[0-9a-fA-F]{64}$/) && 
              !nextSegment.match(/^(https?:|www\.|http|https)$/i) &&
              !nextSegment.includes('.')) {
            const dTagCandidate = nextSegment.split('*')[0];
            if (dTagCandidate && dTagCandidate.length > 0 && 
                !dTagCandidate.match(/^[0-9a-fA-F]{64}$/) &&
                dTagCandidate.match(/^[a-zA-Z0-9-]+$/)) { // Only alphanumeric and hyphens
              // This looks like pubkey/d-tag pattern
              return { type: 'pubkey-dtag', value: `${pubkey}:${dTagCandidate}`, pubkey, dTag: dTagCandidate };
            }
          }
        }
      }
      
      // Check if there's a d-tag before the pubkey (e.g., /d-tag/pubkey)
      if (pubkeyIndex > 0) {
        for (let i = pubkeyIndex - 1; i >= 0; i--) {
          const segment = urlParts[i];
          if (!segment || segment.trim() === '') continue;
          
          // Skip common URL path segments that aren't d-tags
          if (segment.match(/^(https?:|www\.|http|https)$/i)) continue;
          
          // Skip hex strings
          if (segment.match(/^[0-9a-fA-F]{64}$/)) continue;
          
          // Skip segments that are just domains
          if (segment.includes('.') && !segment.includes('*')) continue;
          
          const dTagCandidate = segment.split('*')[0];
          if (dTagCandidate && dTagCandidate.length > 0 && 
              !dTagCandidate.match(/^[0-9a-fA-F]{64}$/) &&
              dTagCandidate.match(/^[a-zA-Z0-9-]+$/)) { // Only alphanumeric and hyphens
            // This looks like d-tag/pubkey pattern
            return { type: 'pubkey-dtag', value: `${pubkey}:${dTagCandidate}`, pubkey, dTag: dTagCandidate };
          }
        }
      }
    }
    
    // If no d-tag found, return as plain hex (event ID or pubkey)
    return { type: 'hex', value: hexMatch[0] };
  }
  
  // Try to extract nip-05 identifiers (user@domain.com format)
  const nip05Pattern = /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const nip05Match = url.match(nip05Pattern);

  if (nip05Match) {
    return { type: 'nip05', value: nip05Match[1] };
  }
  
  // Try to extract d-tag only patterns (e.g., /article/d/Paradox-Of-Tolerance-4owm05 or /d/Paradox-Of-Tolerance-4owm05)
  // Look for URL patterns like /d/... or /article/d/... where the last segment is a d-tag
  const urlParts = url.split('/');
  // Check if URL contains /d/ or /article/d/ pattern
  const dIndex = urlParts.findIndex((part, idx) => 
    (part === 'd' || part === 'article') && 
    idx < urlParts.length - 1 && 
    urlParts[idx + 1] === 'd'
  );
  
  if (dIndex >= 0) {
    // The d-tag should be the segment after /d/
    const dTagIndex = dIndex + (urlParts[dIndex] === 'article' ? 2 : 1);
    if (dTagIndex < urlParts.length) {
      const dTagCandidate = urlParts[dTagIndex].split('?')[0].split('#')[0]; // Remove query params and hash
      // Validate it looks like a d-tag (alphanumeric and hyphens only)
      if (dTagCandidate && dTagCandidate.length > 0 && dTagCandidate.match(/^[a-zA-Z0-9-]+$/)) {
        return { type: 'dtag-only', value: dTagCandidate, dTag: dTagCandidate };
      }
    }
  }
  
  // Also check for patterns where d-tag might be in the last path segment after a known prefix
  // This handles cases like /article/Paradox-Of-Tolerance-4owm05 where the last segment is the d-tag
  if (urlParts.length > 0) {
    const lastSegment = urlParts[urlParts.length - 1].split('?')[0].split('#')[0];
    // If the last segment looks like a d-tag and the URL structure suggests it might be one
    // (e.g., contains /article/ or similar patterns)
    if (lastSegment && lastSegment.match(/^[a-zA-Z0-9-]+$/) && lastSegment.length > 3) {
      const hasArticlePath = urlParts.some(part => part === 'article' || part === 'd');
      if (hasArticlePath) {
        return { type: 'dtag-only', value: lastSegment, dTag: lastSegment };
      }
    }
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

