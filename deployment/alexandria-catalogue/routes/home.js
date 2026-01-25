/**
 * Homepage and search route handler
 */

import { parseRelayUrls, isNaddr } from '../utils.js';
import { DEFAULT_RELAYS } from '../config.js';
import { searchBooks } from '../search.js';
import { fetchBookEvent } from '../nostr.js';
import { buildBookEventHierarchy } from '../book.js';
import { fetchComments } from '../comments.js';
import { buildThreadedComments } from '../comments.js';
import { fetchUserHandle } from '../nostr.js';
import { getCache, getCached, CACHE_TTL } from '../cache.js';
import { getCommonStyles } from '../styles.js';
import { escapeHtml, formatDate, getBookTitle, getBookAuthor, getBookIdentifier, setCacheHeaders } from '../utils.js';
import { generateMessageBox, generateErrorPage, generateSearchBar, generateNavigation } from '../html.js';
import { generateBookDetailPage } from '../templates.js';
import { nip19 } from '../nostr.js';

/**
 * Handle homepage route
 */
export async function handleHome(req, res, url) {
  const query = url.searchParams.get('naddr') || url.searchParams.get('q') || url.searchParams.get('d');
  const searchType = url.searchParams.get('type');
  const relayInput = url.searchParams.get('relays') || '';
  const customRelays = parseRelayUrls(relayInput);
  
  // If query provided, process it
  if (query) {
    let isNaddrQuery = false;
    if (searchType === 'naddr') {
      isNaddrQuery = true;
    } else if (searchType === 'd') {
      isNaddrQuery = false;
    } else {
      isNaddrQuery = isNaddr(query);
    }
    
    // If it's a d tag search, show multiple results
    if (!isNaddrQuery) {
      return await handleSearchResults(req, res, url, query, customRelays);
    }
    
    // It's a naddr, show single book
    return await handleBookDetail(req, res, url, query, customRelays);
  }
  
  // No query - show search form
  return await handleHomePage(req, res, url);
}

/**
 * Handle search results page
 */
async function handleSearchResults(req, res, url, query, customRelays) {
  try {
    const relayInput = url.searchParams.get('relays') || '';
    console.log(`[Search] Searching for books with query: ${query}`);
    
    const books = await searchBooks(query, 10000, customRelays && customRelays.length > 0 ? customRelays : undefined);
    books.sort((a, b) => b.created_at - a.created_at);
    
    const relaysUsed = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
    const isCustomRelays = customRelays && customRelays.length > 0;
    
    // Set cache headers for search results (dynamic content, short cache)
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'dynamic')
    };
    res.writeHead(200, headers);
    
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Search Results - Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  ${generateNavigation(relayInput)}
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  ${generateSearchBar({
    action: '/',
    searchQuery: query,
    kinds: 'books',
    hasCustomRelays: isCustomRelays,
    relayInput: relayInput,
    inputName: 'naddr'
  })}
  <div style="margin-top: 0.5em;">
    <a href="/books${isCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
  </div>
  
  <div class="results-header">
    <h2>Search Results for: "${escapeHtml(query)}"</h2>
    <p>Found ${books.length} book${books.length !== 1 ? 's' : ''} matching your search:</p>
    <div style="margin-top: 0.5em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;">
      <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
      <br><span style="color: #1a1a1a; font-size: 0.85em;">(${isCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
      ${isCustomRelays ? `<div style="margin-top: 0.5em;"><a href="/status?relays=${encodeURIComponent(relayInput)}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; display: inline-block;">View relay status</a></div>` : ''}
    </div>
  </div>
`;

    if (books.length === 0) {
      html += '<p class="no-results">No books found with this query.</p>';
    } else {
      for (const book of books) {
        const title = getBookTitle(book);
        const author = getBookAuthor(book);
        const identifier = getBookIdentifier(book);
        const date = formatDate(book.created_at);
        
        const version = book.tags.find(([k]) => k === 'version')?.[1];
        const description = book.tags.find(([k]) => k === 'description')?.[1];
        const summary = book.tags.find(([k]) => k === 'summary')?.[1];
        const published_on = book.tags.find(([k]) => k === 'published_on')?.[1];
        
        let naddr = '';
        try {
          naddr = nip19.naddrEncode({
            kind: book.kind,
            pubkey: book.pubkey,
            identifier: identifier
          });
        } catch (e) {
          console.error('[Search] Error encoding naddr:', e);
          continue;
        }
        
        html += `
  <div class="book-result">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      ${author ? `Author: ${escapeHtml(author)}<br>` : ''}
      ${version ? `Version: ${escapeHtml(version)}<br>` : ''}
      ${published_on ? `Published: ${escapeHtml(published_on)}<br>` : ''}
      Created: ${date}<br>
      ${description ? `<div style="margin-top: 0.5em; font-style: italic; font-size: 0.9em;">${escapeHtml(description)}</div>` : ''}
      ${summary ? `<div style="margin-top: 0.5em; font-size: 0.9em;">${escapeHtml(summary)}</div>` : ''}
    </div>
    <div class="book-actions">
      <div class="view-buttons">
        <a href="/?naddr=${encodeURIComponent(naddr)}${isCustomRelays ? '&relays=' + encodeURIComponent(relayInput) : ''}">View Details</a>
      </div>
    </div>
  </div>
`;
      }
    }
    
    html += `</body>
</html>
`;
    
    res.end(html);
  } catch (error) {
    console.error('[Search] Error:', error);
    const errorMsg = error?.message || String(error);
    const relayInput = url.searchParams.get('relays') || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Error', errorMsg, null, '/', relayInput));
  }
}

/**
 * Handle book detail page (when naddr is provided)
 */
async function handleBookDetail(req, res, url, naddr, customRelays) {
  try {
    console.log(`[Book View] Request received for naddr: ${naddr}`);
    
    let bookEvent;
    try {
      bookEvent = await fetchBookEvent(naddr, customRelays && customRelays.length > 0 ? customRelays : undefined);
    } catch (fetchError) {
      // If fetch fails, try to find it in cached book list
      console.log(`[Book View] Book not found on relays, checking cached list...`);
      const cache = getCache();
      
      // Try multiple possible cache keys (different limits might have been used)
      const possibleLimits = [100, 500, 1000, 5000, 10000];
      let cachedBooks = null;
      
      for (const limit of possibleLimits) {
        const cacheKey = `bookList_${limit}_${customRelays && customRelays.length > 0 ? customRelays.join(',') : 'default'}`;
        const cached = getCached(cacheKey, CACHE_TTL.BOOK_LIST);
        if (cached && Array.isArray(cached)) {
          cachedBooks = cached;
          console.log(`[Book View] Found cached book list with limit ${limit}`);
          break;
        }
      }
      
      if (cachedBooks && Array.isArray(cachedBooks)) {
        // Decode naddr to get pubkey and identifier
        try {
          const decoded = nip19.decode(naddr);
          if (decoded.type === 'naddr') {
            const { pubkey, identifier } = decoded.data;
            // Try to find the book in the cached list
            const foundBook = cachedBooks.find(b => {
              const bookPubkey = b.pubkey.toLowerCase();
              const bookIdentifier = getBookIdentifier(b).toLowerCase();
              return bookPubkey === pubkey.toLowerCase() && bookIdentifier === identifier.toLowerCase();
            });
            
            if (foundBook) {
              console.log(`[Book View] Found book in cached list, using cached data`);
              bookEvent = foundBook;
            } else {
              throw fetchError; // Re-throw original error if not in cache
            }
          } else {
            throw fetchError; // Re-throw original error if not naddr
          }
        } catch (decodeError) {
          throw fetchError; // Re-throw original error if decode fails
        }
      } else {
        console.log(`[Book View] No cached book list available`);
        throw fetchError; // Re-throw original error if no cache
      }
    }
    
    console.log(`[Book View] Found book event: ${bookEvent.id}`);

    const relayKey = (customRelays && customRelays.length > 0) ? customRelays.sort().join(',') : 'default';
    const hierarchyCacheKey = `${naddr}:${relayKey}`;
    const cache = getCache();
    let hierarchy;
    const cachedHierarchy = cache.bookHierarchy.get(hierarchyCacheKey);
    if (cachedHierarchy && (Date.now() - cachedHierarchy.timestamp) < CACHE_TTL.BOOK_DETAIL) {
      console.log(`[Book View] Using cached hierarchy for: ${naddr}`);
      hierarchy = cachedHierarchy.data;
    } else {
      console.log(`[Book View] Building book hierarchy...`);
      hierarchy = await buildBookEventHierarchy(bookEvent, new Set(), customRelays && customRelays.length > 0 ? customRelays : undefined);
      cache.bookHierarchy.set(hierarchyCacheKey, {
        data: hierarchy,
        timestamp: Date.now()
      });
      if (cache.bookHierarchy.size > 100) {
        const firstKey = cache.bookHierarchy.keys().next().value;
        cache.bookHierarchy.delete(firstKey);
      }
    }
    const hasContent = hierarchy.length > 0;
    console.log(`[Book View] Book has content: ${hasContent} (${hierarchy.length} top-level nodes)`);

    const commentsCacheKey = hierarchyCacheKey;
    let allItems;
    const cachedComments = cache.bookComments.get(commentsCacheKey);
    if (cachedComments && (Date.now() - cachedComments.timestamp) < CACHE_TTL.BOOK_DETAIL) {
      console.log(`[Book View] Using cached comments/highlights for: ${naddr}`);
      allItems = cachedComments.data;
    } else {
      console.log(`[Book View] Fetching comments and highlights...`);
      allItems = await fetchComments(bookEvent, hierarchy, customRelays && customRelays.length > 0 ? customRelays : null);
      cache.bookComments.set(commentsCacheKey, {
        data: allItems,
        timestamp: Date.now()
      });
      if (cache.bookComments.size > 100) {
        const firstKey = cache.bookComments.keys().next().value;
        cache.bookComments.delete(firstKey);
      }
    }
    console.log(`[Book View] Found ${allItems.length} comments and highlights`);

    const commentsRaw = allItems.filter(e => e.kind === 1111);
    
    const threadedComments = buildThreadedComments(commentsRaw);

    const title = getBookTitle(bookEvent);
    const date = formatDate(bookEvent.created_at);
    
    const userHandle = await fetchUserHandle(bookEvent.pubkey, customRelays && customRelays.length > 0 ? customRelays : null);
    
    const npub = nip19.npubEncode(bookEvent.pubkey);
    const npubDisplay = npub.substring(0, 20) + '...';
    const pubkeyDisplay = userHandle ? `${npubDisplay} (${escapeHtml(userHandle)})` : npubDisplay;
    
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
      const handle = await fetchUserHandle(pubkey, customRelays && customRelays.length > 0 ? customRelays : null);
      handleMap.set(pubkey, handle);
    });
    await Promise.all(handlePromises);
    
    const metadata = {
      title: getBookTitle(bookEvent),
      author: bookEvent.tags.find(([k]) => k === 'author')?.[1] || null,
      version: bookEvent.tags.find(([k]) => k === 'version')?.[1] || null,
      description: bookEvent.tags.find(([k]) => k === 'description')?.[1] || null,
      summary: bookEvent.tags.find(([k]) => k === 'summary')?.[1] || null,
      published_on: bookEvent.tags.find(([k]) => k === 'published_on')?.[1] || null,
      image: bookEvent.tags.find(([k]) => k === 'image')?.[1] || null,
      d: bookEvent.tags.find(([k]) => k === 'd')?.[1] || null,
      created_at: date,
      pubkey: pubkeyDisplay,
      event_id: bookEvent.id,
      handleMap: handleMap
    };
    
    // Set cache headers for book detail pages (can cache for a few minutes)
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      ...setCacheHeaders(res, 'html', 300) // 5 minutes
    };
    res.writeHead(200, headers);
    
    // Generate HTML using template
    const html = generateBookDetailPage(naddr, bookEvent, hierarchy, threadedComments, [], metadata, hasContent, customRelays);
    res.end(html);
  } catch (error) {
    console.error('[Book View] Error:', error);
    const errorMsg = error?.message || String(error);
    // Build back URL to landing page, preserving custom relays if present
    const relayInput = url.searchParams.get('relays') || '';
    const backUrl = relayInput ? `/?relays=${encodeURIComponent(relayInput)}` : '/';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Error', errorMsg, null, backUrl, relayInput));
  }
}

/**
 * Handle homepage (no query)
 */
async function handleHomePage(req, res, url) {
  const relayInput = url.searchParams.get('relays') || '';
  const customRelays = parseRelayUrls(relayInput);
  const hasCustomRelays = customRelays && customRelays.length > 0;
  const relaysUsed = hasCustomRelays ? customRelays : DEFAULT_RELAYS;
  
  // Set cache headers for homepage (static content, can cache longer)
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    ...setCacheHeaders(res, 'static', 600) // 10 minutes
  };
  res.writeHead(200, headers);
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>Alexandria Catalogue</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  ${generateNavigation(relayInput)}
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
    
  ${generateSearchBar({
    action: '/',
    searchQuery: '',
    kinds: 'books',
    hasCustomRelays: hasCustomRelays,
    relayInput: relayInput,
    inputName: 'naddr',
    showClearButton: false
  })}
  <div style="margin-top: 0.5em;">
    <a href="/books${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
  </div>
  <div style="margin-top: 1em; padding: 0.75em; background: #e7f3ff; border-left: 3px solid #007bff; border-radius: 4px; font-size: 0.9em;" id="relay-info-box">
    <strong>Relays used:</strong> ${relaysUsed.map(r => escapeHtml(r)).join(', ')}
    <br><span style="color: #1a1a1a; font-size: 0.85em;">(${hasCustomRelays ? 'Custom relays specified' : 'Default relays'})</span>
    ${hasCustomRelays ? `<div style="margin-top: 0.5em;"><a href="/status?relays=${encodeURIComponent(relayInput)}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em; display: inline-block;">View relay status</a></div>` : ''}
  </div>
  
  <details style="max-width: 800px; margin: 2em auto;">
    <summary style="cursor: pointer; padding: 1em; background: #ffffff; border-radius: 8px; border-left: 4px solid #0066cc; border: 2px solid #000000; font-weight: bold; color: #000000; user-select: none;">
      How It Works
    </summary>
    <div class="info" style="padding: 1.5em; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff; margin-top: 0.5em;">
     <p style="margin-bottom: 1em; line-height: 1.6;">The Alexandria Catalogue is an e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>, a Nostr-based publishing platform. It allows you to browse, search, and download books (kind 30040 events) in various formats optimized for e-paper readers.</p>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Searching for Books</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">You can search for books using several methods:</p>
    <ul style="line-height: 1.8; margin-left: 1.5em;">
      <li><strong>Event Identifiers:</strong> Enter any Nostr event identifier to find a specific book:
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>naddr</strong> (e.g., <code>naddr1qq...</code>): Nostr address - the most precise identifier for a book, includes kind, author, and d tag</li>
          <li><strong>nevent</strong> (e.g., <code>nevent1qq...</code>): Event reference with optional author hint</li>
          <li><strong>note</strong> (e.g., <code>note1qq...</code>): Simple event ID reference</li>
          <li><strong>Hex Event ID:</strong> A 64-character hexadecimal event ID</li>
        </ul>
      </li>
      <li><strong>Book Metadata:</strong> Search by book information:
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>Title:</strong> Search by book title (searches in both "title" and "T" tags)</li>
          <li><strong>d tag identifier:</strong> Enter a d tag (book identifier) to find all books with that identifier. If multiple authors have published books with the same d tag, all will be shown</li>
          <li><strong>Collection:</strong> Search within publication/book collections (searches in "C" tags)</li>
        </ul>
      </li>
      <li><strong>Author search:</strong> Search by author name (e.g., "Charlotte Bronte" or "Charlotte Brontë" - both will match). The search handles accented characters and matches both exact and normalized versions.</li>
      <li><strong>Pubkey search:</strong> Enter an npub (e.g., <code>npub1...</code>) or hex pubkey to find all books by that author or that reference that pubkey in "p" tags.</li>
    </ul>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Viewing and Downloading</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">Once you find a book, you can:</p>
    <ul style="line-height: 1.8; margin-left: 1.5em;">
      <li><strong>View as HTML:</strong> Read the book directly in your browser.</li>
      <li><strong>View as EPUB:</strong> Use the built-in EPUB.js viewer to read the book in your browser.</li>
      <li><strong>Download formats:</strong>
        <ul style="margin-top: 0.5em; margin-left: 1.5em;">
          <li><strong>EPUB3:</strong> Standard EPUB format for most e-readers</li>
          <li><strong>PDF:</strong> Portable Document Format</li>
          <li><strong>HTML5:</strong> Standalone HTML file with embedded images</li>
          <li><strong>DocBook5:</strong> XML-based documentation format</li>
          <li><strong>MOBI/AZW3:</strong> Recommended for Kindle devices</li>
          <li><strong>AsciiDoc:</strong> Source format (.adoc file)</li>
          <li><strong>JSONL:</strong> Export all events in the book hierarchy as JSON Lines format</li>
        </ul>
      </li>
    </ul>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Browse Library</h3>
    <p style="margin-bottom: 1em; line-height: 1.6;">Visit the <a href="/books${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" style="color: #007bff; text-decoration: none;">Browse Library</a> page to see all available books. The library shows top-level books (not nested within other books) and supports pagination. You can expand to view up to 10,000 books.</p>
    
    <h3 style="color: #555; margin-top: 1.5em; margin-bottom: 0.5em;">Custom Relays</h3>
    <p style="margin-bottom: 0; line-height: 1.6;">By default, the catalogue searches public Nostr relays. You can specify custom relays (ws:// or wss:// format) to search your local or private relays. Visit the <a href="/status${hasCustomRelays ? '?relays=' + encodeURIComponent(relayInput) : ''}" style="color: #007bff; text-decoration: none;">Status page</a> to configure custom relays.</p>
    </div>
  </details>
</body>
</html>
  `);
}
