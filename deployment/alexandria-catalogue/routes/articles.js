/**
 * Articles route handler - displays kind 30023 (Markdown) and 30041 (AsciiDoc) articles
 */

import { parseRelayUrls } from '../utils.js';
import { DEFAULT_ARTICLE_RELAYS, DEFAULT_RELAYS, ITEMS_PER_PAGE, DEFAULT_FETCH_LIMIT, ASCIIDOCTOR_SERVER_URL } from '../config.js';
import { fetchArticles, fetchArticleEvent, fetchUserHandle, nip19, fetchEventsByFilters, fetchEventByNaddr } from '../nostr.js';
import { getCache, setCached, getCached, CACHE_TTL } from '../cache.js';
import { escapeHtml, formatDate, normalizeForSearch, setCacheHeaders, truncate } from '../utils.js';
import { getCommonStyles, getTableStyles } from '../styles.js';
import { generateSearchBar, generateNavigation, generateErrorPage } from '../html.js';
import { buildThreadedComments } from '../comments.js';
import { marked } from 'marked';

// Configure marked for safe HTML rendering
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

/**
 * Get article title from event tags or content
 */
function getArticleTitle(event) {
  return event.tags.find(([k]) => k === 'title')?.[1] || 
         event.tags.find(([k]) => k === 'T')?.[1] ||
         'Untitled Article';
}

/**
 * Get article summary from event tags
 */
function getArticleSummary(event) {
  return event.tags.find(([k]) => k === 'summary')?.[1] || 
         event.tags.find(([k]) => k === 'S')?.[1] ||
         '';
}

/**
 * Get article image from event tags
 */
function getArticleImage(event) {
  return event.tags.find(([k]) => k === 'image')?.[1] || '';
}

/**
 * Get article d-tag
 */
function getArticleDTag(event) {
  return event.tags.find(([k]) => k === 'd')?.[1] || event.id;
}

/**
 * Replace image URLs with proxy URLs for compression
 */
function replaceImageUrlsWithProxy(html, baseUrl = '') {
  // Match img tags and replace src with proxy URL
  const imgRegex = /<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi;
  
  return html.replace(imgRegex, (match, beforeSrc, src, afterSrc) => {
    // Only proxy HTTP/HTTPS URLs
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const proxyUrl = `${baseUrl}/image-proxy?url=${encodeURIComponent(src)}`;
      return `<img${beforeSrc}src="${escapeHtml(proxyUrl)}"${afterSrc} loading="lazy">`;
    }
    // Keep data URIs and relative URLs as-is
    return match;
  });
}

/**
 * Replace media (video/audio) in HTML with placeholders and links
 */
function replaceMediaWithPlaceholders(html) {
  // Match video tags
  const videoRegex = /<video([^>]*?)src=["']([^"']+)["']([^>]*?)>(.*?)<\/video>/gi;
  html = html.replace(videoRegex, (match, beforeSrc, src, afterSrc, content) => {
    // Extract poster or title if present
    const posterMatch = match.match(/poster=["']([^"']*)["']/i);
    const titleMatch = match.match(/title=["']([^"']*)["']/i);
    const altText = titleMatch ? titleMatch[1] : (posterMatch ? 'Video' : 'Video');
    
    return `<div class="media-placeholder">
      <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" class="media-link">
        <div class="media-placeholder-box">
          <span class="media-placeholder-icon">🎥</span>
          <span class="media-placeholder-text">${escapeHtml(altText || 'View Video')}</span>
          <span class="media-placeholder-url">${escapeHtml(src)}</span>
        </div>
      </a>
    </div>`;
  });
  
  // Match audio tags
  const audioRegex = /<audio([^>]*?)src=["']([^"']+)["']([^>]*?)>(.*?)<\/audio>/gi;
  html = html.replace(audioRegex, (match, beforeSrc, src, afterSrc, content) => {
    // Extract title if present
    const titleMatch = match.match(/title=["']([^"']*)["']/i);
    const altText = titleMatch ? titleMatch[1] : 'Audio';
    
    return `<div class="media-placeholder">
      <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" class="media-link">
        <div class="media-placeholder-box">
          <span class="media-placeholder-icon">🎵</span>
          <span class="media-placeholder-text">${escapeHtml(altText || 'View Audio')}</span>
          <span class="media-placeholder-url">${escapeHtml(src)}</span>
        </div>
      </a>
    </div>`;
  });
  
  // Also handle video/audio tags with source elements
  const sourceVideoRegex = /<video([^>]*?)>(.*?)<\/video>/gi;
  html = html.replace(sourceVideoRegex, (match, attrs, content) => {
    const sourceMatch = content.match(/<source[^>]*src=["']([^"']+)["']/i);
    if (sourceMatch) {
      const src = sourceMatch[1];
      const titleMatch = attrs.match(/title=["']([^"']*)["']/i);
      const altText = titleMatch ? titleMatch[1] : 'Video';
      
      return `<div class="media-placeholder">
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" class="media-link">
          <div class="media-placeholder-box">
            <span class="media-placeholder-icon">🎥</span>
            <span class="media-placeholder-text">${escapeHtml(altText || 'View Video')}</span>
            <span class="media-placeholder-url">${escapeHtml(src)}</span>
          </div>
        </a>
      </div>`;
    }
    return match;
  });
  
  const sourceAudioRegex = /<audio([^>]*?)>(.*?)<\/audio>/gi;
  html = html.replace(sourceAudioRegex, (match, attrs, content) => {
    const sourceMatch = content.match(/<source[^>]*src=["']([^"']+)["']/i);
    if (sourceMatch) {
      const src = sourceMatch[1];
      const titleMatch = attrs.match(/title=["']([^"']*)["']/i);
      const altText = titleMatch ? titleMatch[1] : 'Audio';
      
      return `<div class="media-placeholder">
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" class="media-link">
          <div class="media-placeholder-box">
            <span class="media-placeholder-icon">🎵</span>
            <span class="media-placeholder-text">${escapeHtml(altText || 'View Audio')}</span>
            <span class="media-placeholder-url">${escapeHtml(src)}</span>
          </div>
        </a>
      </div>`;
    }
    return match;
  });
  
  return html;
}

/**
 * Resolve NIP05 identifier to pubkey
 */
async function resolveNip05(nip05) {
  try {
    const [localPart, domain] = nip05.split('@');
    if (!domain) return null;
    
    const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${localPart}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(wellKnownUrl, {
      signal: controller.signal,
      mode: 'cors'
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const names = data.names || {};
      return names[localPart] || null;
    }
  } catch (e) {
    console.error('[Articles] Failed to resolve NIP05:', e);
  }
  return null;
}

/**
 * Resolve npub to hex pubkey
 */
function resolveNpub(npub) {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return decoded.data;
    }
  } catch (e) {
    console.error('[Articles] Failed to decode npub:', e);
  }
  return null;
}

/**
 * Search articles by query (title, summary, pubkey, d-tag, NIP05, npub, naddr)
 */
async function searchArticles(articles, query) {
  if (!query || query.trim() === '') {
    return articles;
  }
  
  const trimmedQuery = query.trim();
  let searchPubkeys = [];
  let isPubkeySearch = false;
  
  // Check if query is naddr (for articles)
  if (trimmedQuery.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(trimmedQuery);
      if (decoded.type === 'naddr' && decoded.data.kind === 30023) {
        // It's an article naddr - filter to match this specific article
        const pubkey = decoded.data.pubkey;
        const identifier = decoded.data.identifier;
        return articles.filter(article => 
          article.pubkey.toLowerCase() === pubkey.toLowerCase() &&
          getArticleDTag(article).toLowerCase() === identifier.toLowerCase()
        );
      }
    } catch (e) {
      console.log(`[Articles] Failed to decode naddr: ${e?.message || String(e)}`);
    }
  }
  
  // Check if query is NIP05 (user@domain.com)
  if (trimmedQuery.includes('@') && trimmedQuery.split('@').length === 2) {
    const pubkey = await resolveNip05(trimmedQuery);
    if (pubkey) {
      searchPubkeys.push(pubkey.toLowerCase());
      isPubkeySearch = true;
    }
  }
  
  // Check if query is npub
  if (trimmedQuery.startsWith('npub1')) {
    const pubkey = resolveNpub(trimmedQuery);
    if (pubkey) {
      searchPubkeys.push(pubkey.toLowerCase());
      isPubkeySearch = true;
      console.log(`[Articles] Resolved npub ${trimmedQuery.substring(0, 16)}... to hex pubkey: ${pubkey.substring(0, 16)}...`);
    } else {
      console.log(`[Articles] Failed to resolve npub: ${trimmedQuery.substring(0, 16)}...`);
    }
  }
  
  // If we have resolved pubkeys, search only by pubkey
  if (isPubkeySearch && searchPubkeys.length > 0) {
    return articles.filter(article => {
      const pubkey = article.pubkey.toLowerCase();
      return searchPubkeys.includes(pubkey);
    });
  }
  
  // Otherwise, do text search
  const normalizedQuery = normalizeForSearch(trimmedQuery.toLowerCase());
  
  return articles.filter(article => {
    const title = normalizeForSearch(getArticleTitle(article));
    const summary = normalizeForSearch(getArticleSummary(article));
    const pubkey = article.pubkey.toLowerCase();
    const dTag = getArticleDTag(article).toLowerCase();
    
    return title.includes(normalizedQuery) ||
           summary.includes(normalizedQuery) ||
           pubkey.includes(normalizedQuery) ||
           dTag.includes(normalizedQuery);
  });
}

/**
 * Get article-specific styles (for article detail pages)
 */
function getArticleDetailStyles() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body { 
      font-family: serif; 
      max-width: 900px; 
      margin: 0 auto; 
      padding: 1em; 
      background: #ffffff; 
      color: #000000; 
      line-height: 1.8; 
      font-size: 18px;
    }
    .skip-link {
      position: absolute;
      top: -40px;
      left: 0;
      background: #000000;
      color: #ffffff;
      padding: 0.5em 1em;
      text-decoration: underline;
      z-index: 100;
    }
    .skip-link:focus {
      top: 0;
      outline: 3px solid #0000ff;
      outline-offset: 2px;
    }
    nav { 
      margin-bottom: 1em; 
      padding-bottom: 0.5em; 
      border-bottom: 2px solid #000000; 
    }
    nav a { 
      color: #0000ff; 
      text-decoration: underline; 
      margin-right: 1em;
      font-weight: bold;
    }
    nav a:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 3px;
      background: #ffff00;
    }
    h1 { 
      color: #000000; 
      border-bottom: 3px solid #000000; 
      padding-bottom: 0.5em; 
      margin-bottom: 1em; 
      font-size: 1.75em;
      font-weight: bold;
      word-wrap: break-word;
    }
    h2 { 
      color: #000000; 
      margin-top: 1em; 
      font-size: 1.5em; 
      font-weight: bold;
      border-bottom: 2px solid #000000;
      padding-bottom: 0.25em;
    }
    h3 {
      color: #000000;
      font-weight: bold;
      margin-top: 1em;
    }
    .search-form { 
      margin-bottom: 1em; 
      padding: 0.5em; 
      background: #ffffff; 
      border: 1px solid #000000; 
    }
    .search-form form { display: block; }
    .search-form label {
      display: block;
      font-weight: bold;
      margin-bottom: 0.5em;
      color: #000000;
    }
    .search-form input[type="text"] { 
      width: 100%;
      max-width: 100%;
      padding: 0.75em; 
      font-size: 0.9em; 
      font-family: monospace;
      border: 2px solid #000000; 
      margin-bottom: 0.5em;
      background: #ffffff;
      color: #000000;
      word-break: break-all;
      overflow-wrap: break-word;
      box-sizing: border-box;
    }
    .search-form input[type="text"]:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 2px;
      background: #ffff00;
    }
    .search-form button { 
      padding: 0.75em 1em; 
      font-size: 1em; 
      background: #000000; 
      color: #ffffff; 
      border: 2px solid #000000; 
      min-height: 44px;
      width: 100%;
      font-weight: bold;
      cursor: pointer;
    }
    .search-form button:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 2px;
      background: #0000ff;
    }
    .search-form button:hover {
      background: #0000ff;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 1em; 
      background: #ffffff; 
      border: 2px solid #000000; 
      font-size: 0.95em;
    }
    th, td { 
      padding: 0.75em; 
      text-align: left; 
      border: 2px solid #000000; 
      word-wrap: break-word;
    }
    th { 
      background: #000000; 
      color: #ffffff; 
      font-weight: bold; 
      font-size: 1em;
    }
    th a { 
      color: #ffffff; 
      text-decoration: underline; 
      font-weight: bold;
    }
    th a:focus { 
      outline: 3px solid #ffff00; 
      outline-offset: 2px;
      background: #0000ff;
    }
    td { 
      background: #ffffff; 
      color: #000000; 
    }
    .article-link { 
      color: #0000ff; 
      text-decoration: underline; 
      font-weight: bold;
    }
    .article-link:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 2px;
      background: #ffff00;
    }
    .article-summary { color: #000000; font-size: 0.9em; font-style: italic; margin-top: 0.25em; }
    .article-date { color: #000000; font-size: 0.85em; }
    .article-author { color: #000000; font-size: 0.9em; }
    .pagination { 
      margin-top: 1em; 
      text-align: center; 
    }
    .pagination a, .pagination span { 
      display: inline-block;
      padding: 0.75em; 
      text-decoration: underline; 
      border: 2px solid #000000; 
      color: #0000ff; 
      background: #ffffff; 
      min-height: 44px;
      min-width: 44px;
      margin: 0.25em;
      font-weight: bold;
    }
    .pagination a:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 2px;
      background: #ffff00;
    }
    .pagination .current { 
      background: #000000; 
      color: #ffffff; 
      border-color: #000000; 
      font-weight: bold;
    }
    .pagination .disabled { 
      color: #000000; 
      background: #cccccc;
      border-color: #666666;
      opacity: 0.6;
    }
    .controls { 
      margin: 1em 0; 
      padding: 0.5em; 
      background: #ffffff; 
      border: 1px solid #000000; 
    }
    .article-count { color: #000000; margin-bottom: 0.5em; }
    .article-header { 
      margin-bottom: 1em; 
      padding: 1em; 
      background: #ffffff; 
      border: 1px solid #000000; 
    }
    .article-header-image { max-width: 100%; max-height: 1000px; width: auto; height: auto; margin-bottom: 1em; }
    .article-header-meta { color: #000000; font-size: 0.9em; margin-top: 1em; }
    .article-content { 
      margin-top: 1em; 
      padding: 1em; 
      background: #ffffff; 
      border: 1px solid #000000; 
    }
    .article-content h1, .article-content h2, .article-content h3 { color: #000000; }
    .article-content h1 { font-size: 1.75em; }
    .article-content h2 { font-size: 1.5em; }
    .article-content h3 { font-size: 1.25em; }
    .article-content p { margin-bottom: 1em; word-wrap: break-word; }
    .article-content ul, .article-content ol { 
      margin: 1em 0; 
      padding-left: 2em; 
      word-wrap: break-word; 
    }
    .article-content li { 
      margin: 0.5em 0; 
      word-wrap: break-word; 
    }
    .article-content img { 
      max-width: 100%; 
      max-height: 1000px; 
      width: auto; 
      height: auto; 
      margin: 1em 0; 
      border: 2px solid #000000;
    }
    .media-placeholder { margin: 1em 0; }
    .media-link { 
      text-decoration: underline; 
      color: #0000ff; 
      display: block; 
      font-weight: bold;
    }
    .media-placeholder-box { 
      border: 2px solid #000000; 
      padding: 1em; 
      text-align: center; 
      background: #ffffff; 
      min-height: 44px;
    }
    .media-link:focus { 
      outline: 3px solid #0000ff; 
      outline-offset: 2px;
      background: #ffff00;
    }
    .media-placeholder-icon { font-size: 1.5em; display: block; margin-bottom: 0.5em; }
    .media-placeholder-text { display: block; font-weight: bold; color: #000000; margin-bottom: 0.5em; word-wrap: break-word; }
    .media-placeholder-url { display: block; font-size: 0.85em; color: #000000; word-break: break-all; }
    .article-content code { 
      background: #f0f0f0; 
      padding: 0.2em 0.4em; 
      font-family: monospace; 
      font-size: 0.9em;
      word-break: break-word;
      border: 1px solid #000000;
    }
    .article-content pre { 
      background: #f0f0f0; 
      padding: 1em; 
      overflow-x: auto; 
      font-size: 0.9em;
      border: 2px solid #000000;
      line-height: 1.6;
    }
    .article-content blockquote { 
      border-left: 4px solid #000000; 
      padding-left: 1em; 
      margin: 1em 0; 
      color: #000000; 
      font-style: italic;
    }
    .relay-info { 
      margin-bottom: 1em; 
      padding: 0.5em; 
      background: #ffffff; 
      border: 1px solid #000000; 
      font-size: 0.9em; 
      color: #000000; 
      word-wrap: break-word;
    }
    
    @media (max-width: 768px) {
      body { padding: 0.5em; font-size: 15px; }
      h1 { font-size: 1.5em; }
      h2 { font-size: 1.25em; }
      .article-content h1 { font-size: 1.5em; }
      .article-content h2 { font-size: 1.25em; }
      .article-content h3 { font-size: 1.1em; }
      nav a { display: block; margin-bottom: 0.5em; }
      .search-form { padding: 0.5em; }
      table { font-size: 0.9em; display: block; overflow-x: auto; }
      th, td { padding: 0.4em; }
      .article-header { padding: 0.75em; }
      .article-content { padding: 0.75em; }
      .pagination a, .pagination span { padding: 0.4em 0.5em; font-size: 0.9em; }
    }
    
    @media (max-width: 600px) {
      body { padding: 0.25em; font-size: 14px; line-height: 1.7; }
      h1 { font-size: 1.4em; }
      h2 { font-size: 1.2em; }
      .article-content { padding: 0.5em; }
      .article-header { padding: 0.5em; }
      .search-form { padding: 0.25em; }
      th, td { padding: 0.3em; font-size: 0.85em; }
      .pagination a, .pagination span { padding: 0.3em 0.4em; min-width: 36px; min-height: 36px; }
    }
    
    @media print {
      body { background: white; color: black; max-width: 100%; padding: 0; }
      nav { display: none; }
      .search-form { display: none; }
      .pagination { display: none; }
      .relay-info { display: none; }
    }
    
    /* High contrast mode support */
    @media (prefers-contrast: high) {
      body { 
        background: #ffffff; 
        color: #000000; 
      }
      nav a, .article-link, .media-link, .pagination a { 
        color: #0000ff; 
        text-decoration: underline; 
        font-weight: bold;
      }
      th { 
        background: #000000; 
        color: #ffffff; 
        border: 3px solid #000000;
      }
      .search-form input[type="text"], .search-form button {
        border: 3px solid #000000;
      }
      .article-content img {
        border: 3px solid #000000;
      }
    }
    
    /* Reduced motion support */
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
}

/**
 * Handle articles list page
 */
export async function handleArticlesList(req, res, url) {
  try {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || String(DEFAULT_FETCH_LIMIT), 10);
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    const hasCustomRelays = customRelays && customRelays.length > 0;
    const relaysUsed = hasCustomRelays ? customRelays : DEFAULT_ARTICLE_RELAYS;
    const sortBy = url.searchParams.get('sort') || 'created';
    const sortOrder = url.searchParams.get('order') || 'desc';
    const searchQuery = url.searchParams.get('q') || '';
    
    console.log(`[Articles] Fetching articles list (page=${page}, limit=${limit}, search="${searchQuery}")...`);
    
    const fetchLimit = Math.min(limit, 500); // Cap at 500
    
    let allArticles;
    const cache = getCache();
    const cacheKey = `articleList_${fetchLimit}_${hasCustomRelays ? customRelays.join(',') : 'default'}`;
    allArticles = getCached(cacheKey, CACHE_TTL.ARTICLE_LIST);
    
    if (!allArticles) {
      console.log(`[Articles] Cache miss - fetching fresh data...`);
      allArticles = await fetchArticles(fetchLimit, hasCustomRelays ? customRelays : undefined);
      setCached(cacheKey, allArticles);
      console.log(`[Articles] Fetched ${allArticles.length} total articles from relays`);
    } else {
      console.log(`[Articles] Using cached data: ${allArticles.length} articles`);
    }
    
    // Apply search filter
    let filteredArticles = allArticles;
    if (searchQuery) {
      filteredArticles = await searchArticles(allArticles, searchQuery);
      console.log(`[Articles] Filtered to ${filteredArticles.length} articles matching "${searchQuery}"`);
    }
    
    // Sort articles
    if (sortBy === 'title') {
      filteredArticles.sort((a, b) => {
        const aTitle = getArticleTitle(a).toLowerCase();
        const bTitle = getArticleTitle(b).toLowerCase();
        return sortOrder === 'asc' ? aTitle.localeCompare(bTitle) : bTitle.localeCompare(aTitle);
      });
    } else if (sortBy === 'author') {
      filteredArticles.sort((a, b) => {
        const aPubkey = a.pubkey.toLowerCase();
        const bPubkey = b.pubkey.toLowerCase();
        return sortOrder === 'asc' ? aPubkey.localeCompare(bPubkey) : bPubkey.localeCompare(aPubkey);
      });
    } else {
      // Default: sort by created_at
      filteredArticles.sort((a, b) => sortOrder === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at);
    }
    
    // Calculate pagination
    const totalArticles = filteredArticles.length;
    const totalPages = Math.ceil(totalArticles / ITEMS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedArticles = filteredArticles.slice(startIndex, endIndex);
    
    // Set cache headers
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'html', 300) // 5 minutes
    };
    res.writeHead(200, headers);
    
    // Build sort URLs
    const buildSortUrl = (column) => {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', limit.toString());
      if (searchQuery) params.set('q', searchQuery);
      if (hasCustomRelays) {
        params.set('relays', relayInput);
      }
      if (sortBy === column) {
        params.set('sort', column);
        params.set('order', sortOrder === 'asc' ? 'desc' : 'asc');
      } else {
        params.set('sort', column);
        params.set('order', 'asc');
      }
      return `/articles?${params.toString()}`;
    };
    
    const getSortIndicator = (column) => {
      if (sortBy !== column) return '';
      return sortOrder === 'asc' ? ' ↑' : ' ↓';
    };
    
    // Generate HTML
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Alexandria Articles - Browse Markdown Articles</title>
  <style>
    body { max-width: 1200px; }
    ${getCommonStyles()}
    ${getTableStyles()}
    .relay-info {
      margin-bottom: 1em;
      padding: 0.75em;
      background: #e7f3ff;
      border-left: 3px solid #007bff;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .article-link { 
      color: #0066cc; 
      text-decoration: underline; 
      font-weight: bold;
    }
    .article-link:focus { 
      outline: 3px solid #0066cc; 
      outline-offset: 2px;
      background: #ffff00;
    }
    .article-summary { color: #1a1a1a; font-size: 0.9em; font-style: italic; margin-top: 0.25em; }
    .article-date { color: #1a1a1a; font-size: 0.85em; }
    .article-author { color: #1a1a1a; font-size: 0.9em; }
    .search-form button[type="button"] {
      padding: 0.75em 1em;
      font-size: 1em;
      background: #000000;
      color: #ffffff;
      border: 2px solid #000000;
      min-height: 44px;
      font-weight: bold;
      cursor: pointer;
      margin-left: 0.5em;
    }
    .search-form button[type="button"]:focus {
      outline: 3px solid #0000ff;
      outline-offset: 2px;
      background: #0000ff;
    }
    .search-form button[type="button"]:hover {
      background: #0000ff;
    }
  </style>
</head>
<body>
  ${generateNavigation(relayInput)}
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Articles</h1>
  <p style="color: #000000; margin-bottom: 1em;">Browse and read Markdown articles (kind 30023) from Nostr relays.</p>
  
  <div class="relay-info">
    <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #1a1a1a; font-size: 0.85em;">(${hasCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
    ${hasCustomRelays ? `<div style="margin-top: 0.5em;"><a href="/status?relays=${encodeURIComponent(relayInput)}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; display: inline-block;">View relay status</a></div>` : ''}
  </div>
  
  ${generateSearchBar({
    action: '/articles',
    searchQuery: searchQuery,
    kinds: 'articles',
    hasCustomRelays: hasCustomRelays,
    relayInput: relayInput,
    limit: limit
  })}
`;
    
    if (paginatedArticles.length === 0) {
      html += `
  <div style="text-align: center; padding: 2em;">
    <p><strong>No articles found.</strong></p>
    ${searchQuery ? `<p>Try a different search query or <a href="/articles">clear the search</a>.</p>` : '<p>No articles available on the configured relays.</p>'}
  </div>`;
    } else {
      html += `
  <div class="controls">
    <p class="article-count">Showing ${startIndex + 1}-${Math.min(endIndex, totalArticles)} of ${totalArticles} articles${searchQuery ? ` matching "${escapeHtml(searchQuery)}"` : ''}</p>
  </div>
  
  <table role="table" aria-label="Articles list">
    <thead>
      <tr>
        <th scope="col"><a href="${buildSortUrl('title')}" aria-label="Sort by title">Title${getSortIndicator('title')}</a></th>
        <th scope="col"><a href="${buildSortUrl('author')}" aria-label="Sort by author">Author${getSortIndicator('author')}</a></th>
        <th scope="col"><a href="${buildSortUrl('created')}" aria-label="Sort by creation date">Created${getSortIndicator('created')}</a></th>
      </tr>
    </thead>
    <tbody>
`;
      
      // Fetch user handles and comment counts for all articles on this page (in parallel for performance)
      const authorHandles = new Map();
      const commentCounts = new Map();
      const handlePromises = paginatedArticles.map(async (article) => {
        try {
          const handle = await fetchUserHandle(article.pubkey, hasCustomRelays ? customRelays : undefined);
          if (handle) {
            authorHandles.set(article.pubkey, handle);
          }
        } catch (e) {
          // Silently fail - will use npub fallback
        }
      });
      
      // Fetch comment counts for all articles
      const commentPromises = paginatedArticles.map(async (article) => {
        try {
          const dTag = getArticleDTag(article);
          const articleCoordinate = `${article.kind}:${article.pubkey}:${dTag}`;
          const commentFilter = {
            kinds: [1111],
            '#A': [articleCoordinate],
            limit: 500
          };
          const comments = await fetchEventsByFilters([commentFilter], relaysUsed, 5000);
          commentCounts.set(`${article.pubkey}:${dTag}`, comments.length);
        } catch (e) {
          // Silently fail - will show 0 comments
          commentCounts.set(`${article.pubkey}:${getArticleDTag(article)}`, 0);
        }
      });
      
      await Promise.all([...handlePromises, ...commentPromises]);
      
      for (const article of paginatedArticles) {
        const title = getArticleTitle(article);
        const summary = getArticleSummary(article);
        const dTag = getArticleDTag(article);
        const date = formatDate(article.created_at);
        const commentCount = commentCounts.get(`${article.pubkey}:${dTag}`) || 0;
        
        // Get author name (use handle if available, otherwise npub)
        let authorName = authorHandles.get(article.pubkey) || nip19.npubEncode(article.pubkey).substring(0, 16) + '...';
        
        html += `
      <tr>
        <td>
          <a href="/articles/${encodeURIComponent(article.pubkey)}/${encodeURIComponent(dTag)}${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" class="article-link" aria-label="Read article: ${escapeHtml(title)}">${escapeHtml(title)}</a>
          ${summary ? `<div class="article-summary" aria-label="Article summary">${escapeHtml(summary)}</div>` : ''}
          ${commentCount > 0 ? `<div style="font-size: 0.85em; color: #666; margin-top: 0.25em;">${commentCount} comment${commentCount !== 1 ? 's' : ''}</div>` : ''}
        </td>
        <td class="article-author">${escapeHtml(authorName)}</td>
        <td class="article-date"><time datetime="${new Date(article.created_at * 1000).toISOString()}">${date}</time></td>
      </tr>
      `;
      }
      
      html += `
    </tbody>
  </table>
  </main>
`;
      
      // Pagination
      if (totalPages > 1) {
        const buildPageUrl = (pageNum) => {
          const params = new URLSearchParams();
          params.set('page', pageNum.toString());
          params.set('limit', limit.toString());
          if (searchQuery) params.set('q', searchQuery);
          if (sortBy && sortBy !== 'created') params.set('sort', sortBy);
          if (sortOrder && sortOrder !== 'desc') params.set('order', sortOrder);
          if (hasCustomRelays) {
            params.set('relays', relayInput);
          }
          return `/articles?${params.toString()}`;
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
    console.error('[Articles] Error:', error);
    const errorMsg = error?.message || String(error);
    const relayInput = url.searchParams.get('relays') || '';
    const backUrl = `/articles${relayInput ? '?relays=' + encodeURIComponent(relayInput) : ''}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Article Not Found', errorMsg, null, backUrl, relayInput));
  }
}

/**
 * Handle article detail page
 */
export async function handleArticleDetail(req, res, url) {
  try {
    const pathParts = url.pathname.split('/').filter(p => p);
    if (pathParts.length !== 3 || pathParts[0] !== 'articles') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateErrorPage('Invalid Article Path', 'Invalid article path format', null, '/articles', ''));
      return;
    }
    
    const pubkey = decodeURIComponent(pathParts[1]);
    const dTag = decodeURIComponent(pathParts[2]);
    
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    const hasCustomRelays = customRelays && customRelays.length > 0;
    
    // Check if dTag is actually an naddr (for direct naddr access)
    let article;
    if (dTag.startsWith('naddr1')) {
      try {
        console.log(`[Articles] Detected naddr in path, fetching by naddr: ${dTag}`);
        article = await fetchEventByNaddr(dTag, hasCustomRelays ? customRelays : undefined);
        if (article.kind !== 30023 && article.kind !== 30041) {
          throw new Error(`Invalid article kind: ${article.kind}. Expected 30023 or 30041.`);
        }
      } catch (error) {
        console.error('[Articles] Error fetching article by naddr:', error);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(generateErrorPage('Invalid Article', error?.message || 'Failed to fetch article by naddr', null, '/articles', relayInput));
        return;
      }
    } else {
      console.log(`[Articles] Fetching article: pubkey=${pubkey.substring(0, 16)}..., d-tag=${dTag}`);
      try {
        article = await fetchArticleEvent(pubkey, dTag, hasCustomRelays ? customRelays : undefined);
      } catch (fetchError) {
      // If fetch fails, try to find it in cached article list
      console.log(`[Articles] Article not found on relays, checking cached list...`);
      const cache = getCache();
      
      // Try multiple possible cache keys (different limits might have been used)
      const possibleLimits = [500, 1000, 5000, 10000];
      let cachedArticles = null;
      
      for (const limit of possibleLimits) {
        const cacheKey = `articleList_${limit}_${hasCustomRelays ? customRelays.join(',') : 'default'}`;
        const cached = getCached(cacheKey, CACHE_TTL.ARTICLE_LIST);
        if (cached && Array.isArray(cached)) {
          cachedArticles = cached;
          console.log(`[Articles] Found cached article list with limit ${limit}`);
          break;
        }
      }
      
      if (cachedArticles && Array.isArray(cachedArticles)) {
        // Try to find the article in the cached list
        const foundArticle = cachedArticles.find(a => 
          a.pubkey.toLowerCase() === pubkey.toLowerCase() && 
          getArticleDTag(a).toLowerCase() === dTag.toLowerCase()
        );
        
        if (foundArticle) {
          console.log(`[Articles] Found article in cached list, using cached data`);
          article = foundArticle;
        } else {
          console.log(`[Articles] Article not found in cached list either`);
          throw fetchError; // Re-throw original error if not in cache
        }
      } else {
        console.log(`[Articles] No cached article list available`);
        throw fetchError; // Re-throw original error if no cache
      }
      }
    }
    
    const title = getArticleTitle(article);
    const summary = getArticleSummary(article);
    const image = getArticleImage(article);
    const date = formatDate(article.created_at);
    
    // Get author name
    let authorName = nip19.npubEncode(article.pubkey).substring(0, 16) + '...';
    try {
      const handle = await fetchUserHandle(article.pubkey, hasCustomRelays ? customRelays : undefined);
      if (handle) {
        authorName = handle;
      }
    } catch (e) {
      console.log('[Articles] Could not fetch user handle:', e);
    }
    
    // Render content based on article kind
    const baseUrl = `http://${req.headers.host}`;
    let htmlContent = '';
    
    if (article.kind === 30023) {
      // Render markdown to HTML
      const markdownContent = article.content || '';
      htmlContent = marked.parse(markdownContent);
      
      // Replace image URLs with proxy URLs for compression
      htmlContent = replaceImageUrlsWithProxy(htmlContent, baseUrl);
      
      // Replace media (video/audio) with placeholders
      htmlContent = replaceMediaWithPlaceholders(htmlContent);
    } else if (article.kind === 30041) {
      // Render AsciiDoc to HTML using AsciiDoctor server
      try {
        const asciidocContent = article.content || '';
        const asciidoctorUrl = `${ASCIIDOCTOR_SERVER_URL}/convert/html5`;
        
        // Use the same format as files.js for consistency
        const requestBody = {
          content: asciidocContent,
          title: getArticleTitle(article),
          author: authorName || ''
        };
        
        const image = getArticleImage(article);
        if (image) {
          requestBody.image = image;
        }
        
        const response = await fetch(asciidoctorUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`AsciiDoctor server returned ${response.status}: ${errorText}`);
        }
        
        htmlContent = await response.text();
        
        // Replace image URLs with proxy URLs for compression
        htmlContent = replaceImageUrlsWithProxy(htmlContent, baseUrl);
        
        // Replace media (video/audio) with placeholders
        htmlContent = replaceMediaWithPlaceholders(htmlContent);
      } catch (error) {
        console.error('[Articles] Error converting AsciiDoc:', error);
        // Fallback: display as plain text with line breaks
        htmlContent = `<pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(article.content || '')}</pre>`;
      }
    } else {
      // Unknown kind, display as plain text
      htmlContent = `<pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(article.content || '')}</pre>`;
    }
    
    // Fetch comments (kind 1111) for this article (NIP-22)
    const articleCoordinate = `${article.kind}:${article.pubkey}:${dTag}`;
    const commentFilter = {
      kinds: [1111],
      '#A': [articleCoordinate],
      limit: 500
    };
    
    const relaysUsed = hasCustomRelays ? customRelays : DEFAULT_ARTICLE_RELAYS;
    const allComments = await fetchEventsByFilters([commentFilter], relaysUsed, 10000);
    const threadedComments = buildThreadedComments(allComments);
    
    // Collect all unique pubkeys for handle fetching
    const uniquePubkeys = new Set();
    const collectPubkeys = (items) => {
      for (const item of items) {
        uniquePubkeys.add(item.pubkey);
        if (item.children && item.children.length > 0) {
          collectPubkeys(item.children);
        }
      }
    };
    collectPubkeys(threadedComments);
    
    const handleMap = new Map();
    const handlePromises = Array.from(uniquePubkeys).map(async (pubkey) => {
      const handle = await fetchUserHandle(pubkey, hasCustomRelays ? customRelays : undefined);
      handleMap.set(pubkey, handle);
    });
    await Promise.all(handlePromises);
    
    // Render comment function
    const renderComment = (comment, depth = 0) => {
      const npub = nip19.npubEncode(comment.pubkey);
      const npubDisplay = npub.substring(0, 20) + '...';
      const handle = handleMap.get(comment.pubkey);
      const authorDisplay = handle ? `${npubDisplay} (${escapeHtml(handle)})` : npubDisplay;
      
      const date = formatDate(comment.created_at);
      const content = escapeHtml(truncate(comment.content || '', 1000));
      
      let commentHtml = `
    <div class="comment"${depth > 0 ? ' style="margin-left: ' + (depth * 2) + 'em; margin-top: 0.5em;"' : ' style="margin-top: 1em;"'}>
      <div class="comment-author" style="font-weight: 600; color: #000000; margin-bottom: 0.25em;">
        ${escapeHtml(authorDisplay)}
      </div>
      <div class="comment-date" style="font-size: 0.85em; color: #666; margin-bottom: 0.5em;">${date}</div>
      <div class="comment-content" style="color: #000000; line-height: 1.6;">${content}</div>`;
      
      if (comment.children && comment.children.length > 0) {
        commentHtml += '      <div class="thread-replies" style="margin-top: 0.5em;">\n';
        for (const child of comment.children) {
          commentHtml += renderComment(child, depth + 1);
        }
        commentHtml += '      </div>\n';
      }
      
      commentHtml += '    </div>\n';
      return commentHtml;
    };
    
    const commentCount = threadedComments.reduce((sum, c) => sum + 1 + (c.children?.length || 0), 0);
    
    // Set cache headers
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'html', 600) // 10 minutes
    };
    res.writeHead(200, headers);
    
    // Generate HTML
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)} - Alexandria Articles</title>
  <style>
    body { max-width: 1200px; }
    ${getCommonStyles()}
    ${getArticleDetailStyles()}
  </style>
</head>
<body>
  ${generateNavigation(relayInput)}
  
  <main id="main-content" role="main">
  <article>
  <header class="article-header">
    <h1>${escapeHtml(title)}</h1>
    ${image ? `<img src="/image-proxy?url=${encodeURIComponent(image)}" alt="Article header image for ${escapeHtml(title)}" class="article-header-image" loading="lazy">` : ''}
    ${summary ? `<p style="font-size: 1.1em; font-style: italic; margin-top: 1em;">${escapeHtml(summary)}</p>` : ''}
    <div class="article-header-meta">
      <strong>Author:</strong> ${escapeHtml(authorName)}<br>
      <strong>Published:</strong> <time datetime="${new Date(article.created_at * 1000).toISOString()}">${date}</time><br>
      <strong>Format:</strong> ${article.kind === 30041 ? 'AsciiDoc' : 'Markdown'} (kind ${article.kind})
    </div>
  </header>
  
  <div class="article-content">
    ${htmlContent}
  </div>
  </article>
  
  <div class="comments-section" style="margin-top: 3em; padding-top: 2em; border-top: 2px solid #000000;">
    <h2 style="font-size: 1.5em; font-weight: bold; margin-bottom: 1em; color: #000000;">Comments (${commentCount})</h2>
`;
    
    if (threadedComments.length > 0) {
      html += '<div class="comments-group" style="margin-bottom: 2em;">';
      for (const comment of threadedComments) {
        html += renderComment(comment, 0);
      }
      html += '</div>';
    } else {
      html += '<p style="color: #666; font-style: italic;">No comments yet.</p>';
    }
    
    html += `
  </div>
  </main>
  
  <nav role="navigation" aria-label="Article navigation" style="margin-top: 2em; text-align: center;">
    <a href="/articles${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" aria-label="Back to articles list">← Back to Articles</a>
  </nav>
</body>
</html>
`;
    
    res.end(html);
  } catch (error) {
    console.error('[Articles] Error:', error);
    const errorMsg = error?.message || String(error);
    const relayInput = url.searchParams.get('relays') || '';
    const backUrl = `/articles${relayInput ? '?relays=' + encodeURIComponent(relayInput) : ''}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Article Not Found', errorMsg, null, backUrl, relayInput));
  }
}
