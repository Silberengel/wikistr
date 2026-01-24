/**
 * Browse library route handler
 */

import { parseRelayUrls } from '../utils.js';
import { DEFAULT_RELAYS, ITEMS_PER_PAGE, DEFAULT_FETCH_LIMIT, MAX_FETCH_LIMIT } from '../config.js';
import { fetchBooks } from '../nostr.js';
import { filterTopLevelBooks } from '../book.js';
import { testRelayConnectivity } from '../nostr.js';
import { getCache, setCached, getCached, CACHE_TTL } from '../cache.js';
import { getCommonStyles, getTableStyles } from '../styles.js';
import { escapeHtml, formatDate, getBookTitle, getBookAuthor, getBookIdentifier, setCacheHeaders } from '../utils.js';
import { nip19 } from '../nostr.js';

/**
 * Handle books browse page
 */
export async function handleBooks(req, res, url) {
  try {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || String(DEFAULT_FETCH_LIMIT), 10);
    const showCustomRelays = url.searchParams.get('show_custom_relays') === '1';
    const relayInput = url.searchParams.get('relays') || '';
    const customRelays = parseRelayUrls(relayInput);
    const sortBy = url.searchParams.get('sort') || 'created';
    const sortOrder = url.searchParams.get('order') || 'desc';
    
    console.log(`[Books] Fetching books list (page=${page}, limit=${limit})...`);
    
    const fetchLimit = limit;
    
    let allBooks;
    const cache = getCache();
    const cacheKey = `bookList_${fetchLimit}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
    allBooks = getCached(cacheKey, CACHE_TTL.BOOK_LIST);
    
    if (!allBooks) {
      console.log(`[Books] Cache miss - fetching fresh data...`);
      allBooks = await fetchBooks(fetchLimit, customRelays && customRelays.length > 0 ? customRelays : undefined);
      setCached(cacheKey, allBooks);
      console.log(`[Books] Fetched ${allBooks.length} total books from relays`);
    } else {
      console.log(`[Books] Using cached data: ${allBooks.length} books`);
    }
    
    const topLevelBooks = filterTopLevelBooks(allBooks);
    console.log(`[Books] Filtered to ${topLevelBooks.length} top-level books`);
    
    // Sort based on sortBy parameter
    if (sortBy === 'title') {
      topLevelBooks.sort((a, b) => {
        const aTitle = getBookTitle(a).toLowerCase();
        const bTitle = getBookTitle(b).toLowerCase();
        return sortOrder === 'asc' ? aTitle.localeCompare(bTitle) : bTitle.localeCompare(aTitle);
      });
    } else if (sortBy === 'author') {
      topLevelBooks.sort((a, b) => {
        const aAuthor = getBookAuthor(a).toLowerCase();
        const bAuthor = getBookAuthor(b).toLowerCase();
        return sortOrder === 'asc' ? aAuthor.localeCompare(bAuthor) : bAuthor.localeCompare(aAuthor);
      });
    } else {
      // Default: sort by created_at
      topLevelBooks.sort((a, b) => sortOrder === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at);
    }
    
    // Calculate pagination
    const totalBooks = topLevelBooks.length;
    const totalPages = Math.ceil(totalBooks / ITEMS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedBooks = topLevelBooks.slice(startIndex, endIndex);
    
    // Set cache headers for book list (can cache for a few minutes)
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'html', 300) // 5 minutes
    };
    res.writeHead(200, headers);
    
    // Generate HTML
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Alexandria Catalogue - Browse Library</title>
  <style>
    body { max-width: 1200px; }
    ${getCommonStyles()}
    ${getTableStyles()}
  </style>
</head>
<body>
  <nav>
    <a href="/${customRelays && customRelays.length > 0 ? '?relays=' + encodeURIComponent(customRelays.join(',')) : ''}">Alexandria Catalogue</a>
    <a href="/books${customRelays && customRelays.length > 0 ? '?relays=' + encodeURIComponent(customRelays.join(',')) : ''}">Browse Library</a>
    <a href="/status${customRelays && customRelays.length > 0 ? '?relays=' + encodeURIComponent(customRelays.join(',')) : ''}">Status</a>
  </nav>
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue - Browse Library</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  <div style="margin-bottom: 1em; padding: 0.75em; background: #ffffff; border: 2px solid #0066cc; border-radius: 4px; font-size: 0.9em; color: #000000;">
    <strong>Relays used:</strong> ${(customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS).map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #1a1a1a; font-size: 0.85em;">(${customRelays && customRelays.length > 0 ? 'Custom relays' : 'Default relays'})</span>
    ${!showCustomRelays && !(customRelays && customRelays.length > 0) ? `<br><a href="/books?page=${page}&limit=${limit}&show_custom_relays=1" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; margin-top: 0.5em; display: inline-block;">Use custom relays</a>` : ''}
  </div>
`;

    if (paginatedBooks.length === 0) {
      if (allBooks.length === 0) {
        const relaysToTest = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
        console.log(`[Books] No books found, testing relay connectivity...`);
        const relayStatus = await testRelayConnectivity(relaysToTest);
        
        let relayStatusHtml = '<div style="margin-top: 1em; padding: 1em; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">';
        relayStatusHtml += '<p style="margin-top: 0; font-weight: bold;">Relay Connection Status:</p>';
        relayStatusHtml += '<ul style="text-align: left; margin: 0.5em 0; padding-left: 1.5em;">';
        
        for (const status of relayStatus) {
          let icon = '❌';
          let color = '#dc3545';
          if (status.status === 'connected') {
            icon = '✓';
            color = '#28a745';
          } else if (status.status === 'timeout') {
            icon = '⏱';
            color = '#ffc107';
          }
          
          relayStatusHtml += `<li style="color: ${color}; margin: 0.3em 0;">
            ${icon} <strong>${escapeHtml(status.url)}</strong>
            ${status.status === 'connected' ? '(Connected)' : status.status === 'timeout' ? '(Timeout - no response)' : `(Error: ${escapeHtml(status.error || 'Unknown error')})`}
          </li>`;
        }
        
        relayStatusHtml += '</ul>';
        relayStatusHtml += '</div>';
        
        const retryParams = new URLSearchParams();
        retryParams.set('page', page.toString());
        retryParams.set('limit', limit.toString());
        if (customRelays && customRelays.length > 0) {
          retryParams.set('relays', customRelays.join(','));
        }
        const retryUrl = `/books?${retryParams.toString()}`;
        
        html += `<div class="loading" style="text-align: left; max-width: 600px; margin: 2em auto;">
          <p><strong>No books found on any relay.</strong></p>
          <p>This could mean:</p>
          <ul style="text-align: left;">
            <li>The relays are not responding</li>
            <li>The relays don't have any books (kind 30040)</li>
            <li>There was a connection error</li>
          </ul>
          ${relayStatusHtml}
          <div style="margin-top: 1.5em; text-align: center;">
            <a href="${retryUrl}" style="display: inline-block; padding: 0.75em 1.5em; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 1em;">Retry</a>
            <p style="margin-top: 1em; font-size: 0.9em; color: #1a1a1a;">Try using custom relays or check the server logs for errors.</p>
          </div>
        </div>`;
      } else {
        html += `<div class="loading">
          <p>Found ${allBooks.length} books, but none are top-level (all are nested within other books).</p>
          <p style="font-size: 0.9em; color: #1a1a1a; margin-top: 0.5em;">Try searching for a specific book using its naddr or d tag.</p>
        </div>`;
      }
    } else {
      html += `<div class="controls" style="margin: 1em 0; padding: 1em; background: #f5f5f5; border-radius: 4px;">
        <p class="book-count" style="margin: 0 0 0.5em 0;">Showing ${startIndex + 1}-${Math.min(endIndex, totalBooks)} of ${totalBooks} top-level books</p>
      </div>`;
      
      // Build sort URLs for table headers
        const buildSortUrl = (column) => {
        const params = new URLSearchParams();
        params.set('page', '1'); // Reset to page 1 when sorting
        params.set('limit', limit.toString());
        if (customRelays && customRelays.length > 0) {
          params.set('relays', customRelays.join(','));
        }
        // Toggle sort order if clicking the same column, otherwise default to asc
        if (sortBy === column) {
          params.set('sort', column);
          params.set('order', sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
          params.set('sort', column);
          params.set('order', 'asc');
        }
        return `/books?${params.toString()}`;
      };
      
      // Get sort indicator for headers
      const getSortIndicator = (column) => {
        if (sortBy !== column) return '';
        return sortOrder === 'asc' ? ' ↑' : ' ↓';
      };
      
      html += `
  <table>
    <thead>
      <tr>
        <th><a href="${buildSortUrl('title')}" style="color: inherit; text-decoration: none; font-weight: bold;">Title${getSortIndicator('title')}</a></th>
        <th><a href="${buildSortUrl('author')}" style="color: inherit; text-decoration: none; font-weight: bold;">Author${getSortIndicator('author')}</a></th>
        <th><a href="${buildSortUrl('created')}" style="color: inherit; text-decoration: none; font-weight: bold;">Created${getSortIndicator('created')}</a></th>
      </tr>
    </thead>
    <tbody>
`;
      
      for (const book of paginatedBooks) {
        const title = getBookTitle(book);
        const author = getBookAuthor(book);
        const identifier = getBookIdentifier(book);
        
        let naddr = '';
        try {
          naddr = nip19.naddrEncode({
            kind: book.kind,
            pubkey: book.pubkey,
            identifier: identifier
          });
        } catch (e) {
          console.error('[Books] Error encoding naddr:', e);
          continue;
        }
        
        const date = formatDate(book.created_at);
        
        html += `
      <tr>
        <td class="book-title">
          <a href="/?naddr=${encodeURIComponent(naddr)}" class="book-link">${escapeHtml(title)}</a>
        </td>
        <td class="book-author">${escapeHtml(author)}</td>
        <td class="book-date">${date}</td>
      </tr>
`;
      }
      
      html += `
    </tbody>
  </table>
`;
      
      // Pagination with all parameters preserved
      if (totalPages > 1) {
        const buildPageUrl = (pageNum) => {
          const params = new URLSearchParams();
          params.set('page', pageNum.toString());
          params.set('limit', limit.toString());
          if (sortBy && sortBy !== 'created') params.set('sort', sortBy);
          if (sortOrder && sortOrder !== 'desc') params.set('order', sortOrder);
          if (customRelays && customRelays.length > 0) {
            params.set('relays', customRelays.join(','));
          }
          return `/books?${params.toString()}`;
        };
        
        html += '<div class="pagination">';
        
        // Previous button
        if (currentPage > 1) {
          html += `<a href="${buildPageUrl(currentPage - 1)}">« Previous</a>`;
        } else {
          html += '<span class="disabled">« Previous</span>';
        }
        
        // Page numbers (show up to 10 pages around current)
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
        
        // Next button
        if (currentPage < totalPages) {
          html += `<a href="${buildPageUrl(currentPage + 1)}">Next »</a>`;
        } else {
          html += '<span class="disabled">Next »</span>';
        }
        
        html += '</div>';
      }
    }
    
    html += `
  <div style="margin-top: 2em; text-align: center;">
    <a href="/" style="color: #007bff; text-decoration: none; font-size: 1em;">← Back to Search</a>
  </div>
</body>
</html>
`;
    
    res.end(html);
  } catch (error) {
    console.error('[Books] Error:', error);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    const errorMsg = error?.message || String(error);
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>${escapeHtml(errorMsg)}</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
    `);
  }
}
