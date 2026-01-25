/**
 * Status page route handler
 */

import { getCacheStats, calculateCacheSize, clearAllCaches, CACHE_TTL, getCache } from '../cache.js';
import { getCommonStyles } from '../styles.js';
import { generateMessageBox, generateNavigation } from '../html.js';
import { formatBytes, escapeHtml, setCacheHeaders, parseRelayUrls } from '../utils.js';
import { testRelayConnectivity } from '../nostr.js';
import { DEFAULT_RELAYS } from '../config.js';
import { getWarmingStatus, refreshAllCaches } from '../cache-warming.js';

/**
 * Generate HTML for a single relay status item
 */
function generateRelayStatusItem(status) {
  let icon = '❌';
  let color = '#dc3545';
  let statusText = 'Error';
  if (status.status === 'connected') {
    icon = '✓';
    color = '#28a745';
    statusText = 'Connected';
  } else if (status.status === 'timeout') {
    icon = '⏱';
    color = '#ffc107';
    statusText = 'Timeout';
  }
  
  let html = `<li style="color: ${color}; margin: 0.5em 0; padding: 0.5em; background: #f8f9fa; border-left: 4px solid ${color}; border-radius: 4px;">`;
  html += `<strong>${icon} ${escapeHtml(status.url)}</strong> - ${statusText}`;
  if (status.error && status.status !== 'connected') {
    html += `<br><span style="font-size: 0.9em; color: #1a1a1a;">${escapeHtml(status.error)}</span>`;
  }
  html += '</li>';
  return html;
}

/**
 * Handle status page route
 */
export async function handleStatus(req, res, url) {
  const cacheStats = getCacheStats();
  const cacheSizes = calculateCacheSize();
  const warmingStatus = getWarmingStatus();
  const cacheCleared = url.searchParams.get('cleared') === '1';
  const cacheRefreshed = url.searchParams.get('refreshed') === '1';
  
  let successMessage = '';
  if (cacheCleared) {
    successMessage = generateMessageBox('info', 'Cache cleared successfully! All cached data has been removed.', null);
  } else if (cacheRefreshed) {
    const booksAdded = url.searchParams.get('books_added') || '0';
    const articlesAdded = url.searchParams.get('articles_added') || '0';
    const highlightsAdded = url.searchParams.get('highlights_added') || '0';
    successMessage = generateMessageBox('info', 
      `Cache refreshed successfully! Added ${booksAdded} books, ${articlesAdded} articles, ${highlightsAdded} highlights. All items have been deduplicated.`, 
      null);
  }
  
  // Get custom relays from URL if provided
  const relayInput = url.searchParams.get('relays') || '';
  const customRelays = parseRelayUrls(relayInput);
  const hasCustomRelays = customRelays && customRelays.length > 0;
  const relaysToTest = hasCustomRelays ? customRelays : DEFAULT_RELAYS;
  const isRetest = url.searchParams.get('retest') === '1';
  
  // Test relay connectivity (always test to get fresh status)
  if (isRetest) {
    console.log('[Status] Retesting relay connectivity...');
  } else {
    console.log('[Status] Testing relay connectivity...');
  }
  const relayStatus = await testRelayConnectivity(relaysToTest);
  
  // Generate relay status HTML with retest button (JavaScript-free)
  let relayStatusHtml = '<div class="status-section">';
  relayStatusHtml += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em;">';
  relayStatusHtml += '<h2 style="margin: 0;">Relay Status</h2>';
  relayStatusHtml += '<form method="GET" action="/status" style="margin: 0; display: inline;">';
  if (hasCustomRelays) {
    relayStatusHtml += `<input type="hidden" name="relays" value="${escapeHtml(relayInput)}">`;
  }
  relayStatusHtml += '<input type="hidden" name="retest" value="1">';
  relayStatusHtml += '<button type="submit" style="padding: 0.5em 1em; background: #007bff; color: #ffffff; border: 2px solid #007bff; border-radius: 4px; cursor: pointer; font-size: 0.9em; font-weight: bold;">Retest Relays</button>';
  relayStatusHtml += '</form>';
  relayStatusHtml += '</div>';
  relayStatusHtml += `<p style="color: #1a1a1a; margin-bottom: 0.5em;">Connection status for ${hasCustomRelays ? 'custom' : 'default'} relays:</p>`;
  if (hasCustomRelays) {
    relayStatusHtml += `<div style="margin-bottom: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">`;
    relayStatusHtml += `<strong>Custom relays:</strong> ${relaysToTest.map(r => escapeHtml(r)).join(', ')}`;
    relayStatusHtml += `</div>`;
  } else {
    relayStatusHtml += `<div style="margin-bottom: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">`;
    relayStatusHtml += `<strong>Default relays:</strong> ${DEFAULT_RELAYS.map(r => escapeHtml(r)).join(', ')}`;
    relayStatusHtml += `</div>`;
  }
  relayStatusHtml += '<ul style="text-align: left; margin: 0.5em 0; padding-left: 1.5em; list-style: none;">';
  
  relayStatus.forEach(status => {
    relayStatusHtml += generateRelayStatusItem(status);
  });
  
  relayStatusHtml += '</ul>';
  if (hasCustomRelays) {
    relayStatusHtml += `<p style="margin-top: 1em;"><a href="/status" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← View default relays</a></p>`;
  }
  relayStatusHtml += '</div>';
  
  // Add custom relay configuration form
  relayStatusHtml += '<div class="status-section" style="margin-top: 2em;">';
  relayStatusHtml += '<h2>Configure Custom Relays</h2>';
  relayStatusHtml += '<p style="color: #1a1a1a; margin-bottom: 1em;">Enter one or more relay URLs (ws:// or wss:// format). Separate multiple relays with commas or newlines. Example: wss://relay.example.com, ws://localhost:8080</p>';
  relayStatusHtml += '<form method="GET" action="/status" style="margin: 0;">';
  relayStatusHtml += '<textarea name="relays" placeholder="wss://relay.example.com, ws://localhost:8080" rows="3" style="width: 100%; padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; box-sizing: border-box; background: #ffffff; color: #000000;">' + escapeHtml(relayInput) + '</textarea>';
  relayStatusHtml += '<div style="margin-top: 0.5em;">';
  relayStatusHtml += '<button type="submit" style="padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-size: 0.9em; font-weight: bold;">Test Custom Relays</button>';
  if (hasCustomRelays) {
    relayStatusHtml += '<a href="/status" style="color: #1a1a1a; text-decoration: underline; font-size: 0.9em; margin-left: 1em;">Use Default Relays</a>';
  }
  relayStatusHtml += '</div>';
  relayStatusHtml += '</form>';
  relayStatusHtml += '</div>';
  
  // Set cache headers for status page (dynamic content, short cache)
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    ...setCacheHeaders(res, 'dynamic')
  };
  res.writeHead(200, headers);
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Server Status - Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  ${generateNavigation(relayInput)}
  <h1>Server Status</h1>
  ${successMessage}
  ${generateMessageBox('info', 'Server is running. System status information below.', null)}
  ${relayStatusHtml}
  <div class="status-section">
    <h2>Cache Statistics</h2>
    <div class="status-item"><span class="status-label">Cached Book Details:</span> ${cacheStats.bookDetails} entries (${formatBytes(cacheSizes.sizes.bookDetails || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Book Hierarchies:</span> ${cacheStats.bookHierarchy} entries (${formatBytes(cacheSizes.sizes.bookHierarchy || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Comments/Highlights:</span> ${cacheStats.bookComments} entries (${formatBytes(cacheSizes.sizes.bookComments || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Search Results:</span> ${cacheStats.searchResults} entries (${formatBytes(cacheSizes.sizes.searchResults || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Generated Files:</span> ${cacheStats.generatedFiles} entries (${formatBytes(cacheSizes.sizes.generatedFiles || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Article Lists:</span> ${cacheStats.articleList} entries (${formatBytes(cacheSizes.sizes.articleList || 0)})</div>
    <div class="status-item"><span class="status-label">Cached Highlights Lists:</span> ${cacheStats.highlightsList} entries (${formatBytes(cacheSizes.sizes.highlightsList || 0)})</div>
    <div class="status-item"><span class="status-label">Cached User Profiles:</span> ${cacheStats.userProfiles || 0} entries (${formatBytes(cacheSizes.sizes.userProfiles || 0)})</div>
    <div class="status-item"><span class="status-label">Top-Level Books Cached:</span> ${cacheStats.topLevelBooks} entries (${formatBytes(cacheSizes.sizes.topLevelBooks || 0)})</div>
    <div class="status-item"><span class="status-label">Book List Cache:</span> ${getCache().bookList.data ? getCache().bookList.data.length + ' entries' : 'empty'} (${formatBytes(cacheSizes.sizes.bookList || 0)})</div>
    ${cacheStats.topLevelBooksTimestamp ? `<div class="status-item"><span class="status-label">Last Updated:</span> ${cacheStats.topLevelBooksTimestamp}</div>` : ''}
    <div class="status-item" style="margin-top: 1em; padding-top: 1em; border-top: 2px solid #000000; font-weight: bold;"><span class="status-label">Total Cache Size:</span> ${formatBytes(cacheSizes.total)}</div>
  </div>
  <div class="status-section">
    <h2>Cache Configuration</h2>
    <div class="status-item"><span class="status-label">Book List Cache:</span> ${CACHE_TTL.BOOK_LIST / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Book Detail Cache:</span> ${CACHE_TTL.BOOK_DETAIL / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Article List Cache:</span> ${CACHE_TTL.ARTICLE_LIST / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Highlights List Cache:</span> ${CACHE_TTL.HIGHLIGHTS_LIST / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Search Results Cache:</span> ${CACHE_TTL.SEARCH_RESULTS / 60000} minutes</div>
    <div class="status-item"><span class="status-label">Generated Files Cache:</span> ${CACHE_TTL.GENERATED_FILES / 60000} minutes</div>
  </div>
  <div class="status-section">
    <h2>Background Cache Warming</h2>
    <div class="status-item"><span class="status-label">Book Cache Warming:</span> ${warmingStatus.books.inProgress ? '🔄 In Progress' : warmingStatus.books.lastWarmed ? '✓ Last warmed: ' + warmingStatus.books.lastWarmed : '⏸ Not warmed yet'}</div>
    <div class="status-item"><span class="status-label">Article Cache Warming:</span> ${warmingStatus.articles.inProgress ? '🔄 In Progress' : warmingStatus.articles.lastWarmed ? '✓ Last warmed: ' + warmingStatus.articles.lastWarmed : '⏸ Not warmed yet'}</div>
    <div class="status-item"><span class="status-label">Highlights Cache Warming:</span> ${warmingStatus.highlights.inProgress ? '🔄 In Progress' : warmingStatus.highlights.lastWarmed ? '✓ Last warmed: ' + warmingStatus.highlights.lastWarmed : '⏸ Not warmed yet'}</div>
    <div class="status-item"><span class="status-label">Book Comments Warming:</span> ${warmingStatus.comments.inProgress ? '🔄 In Progress' : warmingStatus.comments.lastWarmed ? '✓ Last warmed: ' + warmingStatus.comments.lastWarmed : '⏸ Not warmed yet'}</div>
    <div class="status-item"><span class="status-label">Article Comments Warming:</span> ${warmingStatus.articleComments.inProgress ? '🔄 In Progress' : warmingStatus.articleComments.lastWarmed ? '✓ Last warmed: ' + warmingStatus.articleComments.lastWarmed : '⏸ Not warmed yet'}</div>
    <p style="color: #1a1a1a; margin-top: 0.5em; font-size: 0.9em;">Cache warming runs automatically when the homepage is accessed. This pre-fetches popular data in the background for faster subsequent requests.</p>
  </div>
  <div class="status-section" style="margin-top: 2em; padding: 1em; background: #ffffff; border: 2px solid #0066cc; border-radius: 4px;">
    <h2 style="margin-top: 0; color: #000000;">Cache Management</h2>
    <p style="color: #000000; margin-bottom: 1em;">Refresh cache to fetch new items from relays and append them to existing cache (with deduplication). This will add new items without clearing existing data.</p>
    <form method="POST" action="${hasCustomRelays ? `/refresh-cache?relays=${encodeURIComponent(relayInput)}` : '/refresh-cache'}" style="margin: 0; display: inline-block;" target="_self">
      <button type="submit" style="padding: 0.75em 1.5em; background: #0066cc; color: #ffffff; border: 2px solid #0066cc; border-radius: 4px; cursor: pointer; font-size: 1em; font-weight: bold; margin-right: 1em;">Refresh Cache</button>
    </form>
    <p style="color: #000000; margin-top: 1em; margin-bottom: 1em;">Clear all cached data. This will force the server to fetch fresh data from relays on the next request.</p>
    <form method="POST" action="${hasCustomRelays ? `/clear-cache?relays=${encodeURIComponent(relayInput)}` : '/clear-cache'}" style="margin: 0; display: inline-block;" target="_self">
      <button type="submit" style="padding: 0.75em 1.5em; background: #cc0000; color: #ffffff; border: 2px solid #cc0000; border-radius: 4px; cursor: pointer; font-size: 1em; font-weight: bold;">Clear All Cache</button>
    </form>
  </div>
  <p style="margin-top: 2em;"><a href="${hasCustomRelays ? `/?relays=${encodeURIComponent(relayInput)}` : '/'}">← Go back</a></p>
</body>
</html>
  `);
}

/**
 * Handle cache clearing POST request
 */
export function handleClearCache(req, res, url) {
  clearAllCaches();
  console.log('[Cache] All caches cleared');
  
  // Preserve custom relays in redirect if present
  const relayInput = url.searchParams.get('relays') || '';
  let redirectUrl = '/status?cleared=1';
  if (relayInput) {
    redirectUrl += `&relays=${encodeURIComponent(relayInput)}`;
  }
  
  res.writeHead(302, { 'Location': redirectUrl });
  res.end();
}

/**
 * Handle cache refresh POST request
 */
export async function handleRefreshCache(req, res, url) {
  // Parse custom relays from URL query string (form data is sent as query params in POST)
  const relayInput = url.searchParams.get('relays') || '';
  const customRelays = parseRelayUrls(relayInput);
  
  console.log('[Cache Refresh] Starting cache refresh...');
  const results = await refreshAllCaches(customRelays && customRelays.length > 0 ? customRelays : null);
  
  // Build redirect URL with results
  const booksAdded = results.books?.added || 0;
  const articlesAdded = results.articles?.added || 0;
  const highlightsAdded = results.highlights?.added || 0;
  
  let redirectUrl = '/status?refreshed=1';
  redirectUrl += `&books_added=${booksAdded}`;
  redirectUrl += `&articles_added=${articlesAdded}`;
  redirectUrl += `&highlights_added=${highlightsAdded}`;
  if (relayInput) {
    redirectUrl += `&relays=${encodeURIComponent(relayInput)}`;
  }
  
  console.log(`[Cache Refresh] Cache refresh completed: ${booksAdded} books, ${articlesAdded} articles, ${highlightsAdded} highlights added`);
  res.writeHead(302, { 'Location': redirectUrl });
  res.end();
}
