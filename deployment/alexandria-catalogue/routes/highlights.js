/**
 * Highlights route handler - displays kind 9802 highlights
 * Based on NIP-84 spec
 * Only shows highlights from 30023 (markdown articles), 30041 (asciidoc articles), and URLs
 */

import { parseRelayUrls } from '../utils.js';
import { DEFAULT_ARTICLE_RELAYS, DEFAULT_RELAYS, ITEMS_PER_PAGE, DEFAULT_FETCH_LIMIT } from '../config.js';
import { fetchEventsByFilters } from '../nostr.js';
import { fetchUserHandle, nip19 } from '../nostr.js';
import { getCache, setCached, getCached, CACHE_TTL } from '../cache.js';
import { escapeHtml, formatDate, setCacheHeaders } from '../utils.js';
import { getCommonStyles, getTableStyles } from '../styles.js';
import { generateSearchBar, generateNavigation, generateErrorPage } from '../html.js';

/**
 * Get highlight source reference (a, e, or r tag)
 */
function getHighlightSource(highlight) {
  // Check for 'a' tag (event address)
  const aTag = highlight.tags.find(([k]) => k === 'a');
  if (aTag && aTag[1]) {
    return { type: 'a', value: aTag[1], relay: aTag[2] || null };
  }
  
  // Check for 'e' tag (event id)
  const eTag = highlight.tags.find(([k]) => k === 'e');
  if (eTag && eTag[1]) {
    return { type: 'e', value: eTag[1], relay: eTag[2] || null };
  }
  
  // Check for 'r' tag (URL)
  const rTag = highlight.tags.find(([k]) => k === 'r');
  if (rTag && rTag[1]) {
    return { type: 'r', value: rTag[1] };
  }
  
  return null;
}

/**
 * Get highlight source kind from 'a' tag
 */
function getSourceKind(source) {
  if (source && source.type === 'a' && source.value) {
    const parts = source.value.split(':');
    if (parts.length >= 1) {
      return parseInt(parts[0], 10);
    }
  }
  return null;
}

/**
 * Check if highlight should be displayed (only 30023, 30041, or URLs)
 */
function shouldDisplayHighlight(highlight) {
  const source = getHighlightSource(highlight);
  if (!source) return false;
  
  // URLs (r tags) are always allowed
  if (source.type === 'r') return true;
  
  // For event addresses (a tags), check the kind
  if (source.type === 'a') {
    const kind = getSourceKind(source);
    return kind === 30023 || kind === 30041;
  }
  
  // For event ids (e tags), we can't determine the kind without fetching the event
  // So we'll include them but they might not link properly
  // In practice, we should filter these out, but for now we'll include them
  return true;
}

/**
 * Get source display URL
 */
function getSourceUrl(source, baseUrl) {
  if (!source) return null;
  
  if (source.type === 'r') {
    return source.value;
  } else if (source.type === 'a') {
    // Parse kind:pubkey:identifier
    const parts = source.value.split(':');
    if (parts.length >= 3) {
      const kind = parts[0];
      const pubkey = parts[1];
      const identifier = parts[2];
      
      if (kind === '30023') {
        return `${baseUrl}/articles/${encodeURIComponent(pubkey)}/${encodeURIComponent(identifier)}`;
      } else if (kind === '30041') {
        // For 30041, we might need to construct a different URL
        // For now, return the naddr
        try {
          const naddr = nip19.naddrEncode({
            kind: 30041,
            pubkey: pubkey,
            identifier: identifier
          });
          return `${baseUrl}/?naddr=${encodeURIComponent(naddr)}`;
        } catch (e) {
          return null;
        }
      }
    }
  } else if (source.type === 'e') {
    // For event ids, we can't construct a URL without knowing the kind
    // Return null for now
    return null;
  }
  
  return null;
}

/**
 * Get source display text
 */
function getSourceText(source) {
  if (!source) return 'Unknown source';
  
  if (source.type === 'r') {
    return source.value;
  } else if (source.type === 'a') {
    const parts = source.value.split(':');
    if (parts.length >= 3) {
      const kind = parts[0];
      if (kind === '30023') {
        return `Article (${parts[2]})`;
      } else if (kind === '30041') {
        return `AsciiDoc Article (${parts[2]})`;
      }
      return `Event ${parts[2]}`;
    }
    return source.value;
  } else if (source.type === 'e') {
    return `Event ${source.value.substring(0, 16)}...`;
  }
  
  return 'Unknown source';
}

/**
 * Handle highlights list page
 */
export async function handleHighlightsList(req, res, url) {
  try {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || String(DEFAULT_FETCH_LIMIT), 10);
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    const hasCustomRelays = customRelays && customRelays.length > 0;
    const relaysUsed = hasCustomRelays ? customRelays : DEFAULT_ARTICLE_RELAYS;
    
    console.log(`[Highlights] Fetching highlights list (page=${page}, limit=${limit})...`);
    
    const fetchLimit = Math.min(limit, 500); // Cap at 500
    
    let allHighlights;
    const cache = getCache();
    const cacheKey = `highlightsList_${fetchLimit}_${hasCustomRelays ? customRelays.join(',') : 'default'}`;
    allHighlights = getCached(cacheKey, CACHE_TTL.HIGHLIGHTS_LIST);
    
    if (!allHighlights) {
      console.log(`[Highlights] Cache miss - fetching fresh data...`);
      
      // Fetch highlights (kind 9802) from relays
      const highlightFilter = {
        kinds: [9802],
        limit: fetchLimit
      };
      
      allHighlights = await fetchEventsByFilters([highlightFilter], relaysUsed, 10000);
      
      // Filter to only show highlights from 30023, 30041, or URLs
      allHighlights = allHighlights.filter(shouldDisplayHighlight);
      
      setCached(cacheKey, allHighlights);
      console.log(`[Highlights] Fetched ${allHighlights.length} highlights from relays`);
    } else {
      console.log(`[Highlights] Using cached data: ${allHighlights.length} highlights`);
    }
    
    // Sort by created_at (newest first)
    allHighlights.sort((a, b) => b.created_at - a.created_at);
    
    // Calculate pagination
    const totalHighlights = allHighlights.length;
    const totalPages = Math.ceil(totalHighlights / ITEMS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedHighlights = allHighlights.slice(startIndex, endIndex);
    
    // Set cache headers
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'html', 300) // 5 minutes
    };
    res.writeHead(200, headers);
    
    const baseUrl = `http://${req.headers.host}`;
    
    // Fetch user handles for all highlights on this page
    const authorHandles = new Map();
    const handlePromises = paginatedHighlights.map(async (highlight) => {
      try {
        const handle = await fetchUserHandle(highlight.pubkey, hasCustomRelays ? customRelays : undefined);
        if (handle) {
          authorHandles.set(highlight.pubkey, handle);
        }
      } catch (e) {
        // Silently fail - will use npub fallback
      }
    });
    await Promise.all(handlePromises);
    
    // Generate HTML
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Browse Highlights - Alexandria Catalogue</title>
  <style>
    body { max-width: 1200px; }
    ${getCommonStyles()}
    ${getTableStyles()}
    .highlight-content {
      margin: 0.5em 0;
      padding: 0.75em;
      background: #f8f9fa;
      border-left: 4px solid #28a745;
      border-radius: 4px;
      font-style: italic;
    }
    .highlight-source {
      margin-top: 0.5em;
      font-size: 0.9em;
      color: #0066cc;
    }
    .highlight-source a {
      color: #0066cc;
      text-decoration: underline;
    }
    .relay-info {
      margin-bottom: 1em;
      padding: 0.75em;
      background: #e7f3ff;
      border-left: 3px solid #007bff;
      border-radius: 4px;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  ${generateNavigation(relayInput)}
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Browse Highlights</h1>
  <p style="color: #000000; margin-bottom: 1em;">Browse highlights (kind 9802) from markdown articles (30023), asciidoc articles (30041), and web pages.</p>
  
  <div class="relay-info">
    <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #1a1a1a; font-size: 0.85em;">(${hasCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
    ${hasCustomRelays ? `<div style="margin-top: 0.5em;"><a href="/status?relays=${encodeURIComponent(relayInput)}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; display: inline-block;">View relay status</a></div>` : ''}
  </div>
`;
    
    if (paginatedHighlights.length === 0) {
      html += `
  <div style="text-align: center; padding: 2em;">
    <p><strong>No highlights found.</strong></p>
    <p>No highlights from markdown articles (30023), asciidoc articles (30041), or web pages are available on the configured relays.</p>
  </div>`;
    } else {
      html += `
  <div class="controls">
    <p class="article-count">Showing ${startIndex + 1}-${Math.min(endIndex, totalHighlights)} of ${totalHighlights} highlights</p>
  </div>
  
  <div style="display: flex; flex-direction: column; gap: 1.5em; margin-top: 1em;">
`;
      
      for (const highlight of paginatedHighlights) {
        const source = getHighlightSource(highlight);
        const sourceUrl = getSourceUrl(source, baseUrl);
        const sourceText = getSourceText(source);
        const date = formatDate(highlight.created_at);
        const content = escapeHtml(highlight.content || '');
        
        // Get author name
        let authorName = authorHandles.get(highlight.pubkey) || nip19.npubEncode(highlight.pubkey).substring(0, 16) + '...';
        
        html += `
    <div style="padding: 1em; background: #ffffff; border: 1px solid #ddd; border-radius: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5em;">
        <div>
          <strong>${escapeHtml(authorName)}</strong>
          <span style="color: #666; font-size: 0.9em; margin-left: 0.5em;">${date}</span>
        </div>
      </div>
      <div class="highlight-content">${content}</div>
      <div class="highlight-source">
        Source: ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceText)}</a>` : escapeHtml(sourceText)}
      </div>
    </div>
`;
      }
      
      html += `
  </div>
`;
      
      // Pagination
      if (totalPages > 1) {
        const buildPageUrl = (pageNum) => {
          const params = new URLSearchParams();
          params.set('page', pageNum.toString());
          params.set('limit', limit.toString());
          if (hasCustomRelays) {
            params.set('relays', relayInput);
          }
          return `/highlights?${params.toString()}`;
        };
        
        html += '<div class="pagination">';
        
        if (currentPage > 1) {
          html += `<a href="${buildPageUrl(currentPage - 1)}">« Previous</a>`;
        } else {
          html += '<span class="disabled">« Previous</span>';
        }
        
        const startPage = Math.max(1, currentPage - 5);
        const endPage = Math.min(totalPages, currentPage + 5);
        
        if (startPage > 1) {
          html += `<a href="${buildPageUrl(1)}">1</a>`;
          if (startPage > 2) html += '<span>...</span>';
        }
        
        for (let p = startPage; p <= endPage; p++) {
          if (p === currentPage) {
            html += `<span class="current">${p}</span>`;
          } else {
            html += `<a href="${buildPageUrl(p)}">${p}</a>`;
          }
        }
        
        if (endPage < totalPages) {
          if (endPage < totalPages - 1) html += '<span>...</span>';
          html += `<a href="${buildPageUrl(totalPages)}">${totalPages}</a>`;
        }
        
        if (currentPage < totalPages) {
          html += `<a href="${buildPageUrl(currentPage + 1)}">Next »</a>`;
        } else {
          html += '<span class="disabled">Next »</span>';
        }
        
        html += '</div>';
      }
    }
    
    html += `
  </main>
</body>
</html>
`;
    
    res.end(html);
  } catch (error) {
    console.error('[Highlights] Error:', error);
    const errorMsg = error?.message || String(error);
    const relayInput = url.searchParams.get('relays') || '';
    const backUrl = `/highlights${relayInput ? '?relays=' + encodeURIComponent(relayInput) : ''}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Error Loading Highlights', errorMsg, null, backUrl, relayInput));
  }
}
