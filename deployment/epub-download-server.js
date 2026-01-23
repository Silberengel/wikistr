#!/usr/bin/env node

/**
 * Alexandria Catalogue
 * Simple HTTP server for browsing and downloading books (kind 30040) as EPUB files
 * Designed for e-paper readers that can't use websockets
 * 
 * Usage: node epub-download-server.js [port]
 * Default port: 8092
 */

import http from 'http';
import { URL } from 'url';
import { SimplePool, nip19 } from '@nostr/tools';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default relays (same as src/lib/defaults.ts)
const DEFAULT_SEARCH_RELAYS = [
  'wss://thecitadel.nostr1.com'
];

const PORT = process.env.EPUB_DOWNLOAD_PORT || process.argv[2] || 8092;
const ASCIIDOCTOR_SERVER_URL = process.env.ASCIIDOCTOR_SERVER_URL || 'http://localhost:8091';

// Create a simple pool for fetching events
// Use WebSocket implementation for Node.js
const pool = new SimplePool({
  websocketImplementation: WebSocket
});

// Default relays to use for fetching book events
const DEFAULT_RELAYS = [
  ...DEFAULT_SEARCH_RELAYS,
  'wss://thecitadel.nostr1.com'
];

/**
 * Fetch a book event by naddr
 */
async function fetchBookEvent(naddr) {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== 'naddr') {
      throw new Error('Invalid naddr format');
    }

    const { kind, pubkey, identifier } = decoded.data;
    
    // Only support book kinds (30040 = book index, 30041 = book content)
    if (kind !== 30040 && kind !== 30041) {
      throw new Error(`Unsupported kind: ${kind}. Only book kinds (30040, 30041) are supported.`);
    }

    // Use relay hints from naddr if available, otherwise use defaults
    const relays = decoded.data.relays && decoded.data.relays.length > 0
      ? decoded.data.relays
      : DEFAULT_RELAYS;

    console.log(`[EPUB Download] Fetching book event: kind=${kind}, pubkey=${pubkey}, identifier=${identifier}`);
    console.log(`[EPUB Download] Using relays: ${relays.join(', ')}`);

    // Query for the event using individual relay subscriptions
    const foundEvents = [];
    const eoseRelays = new Set();
    const totalRelays = relays.length;
    const subscriptions = [];
    
    const filter = {
      kinds: [kind],
      authors: [pubkey],
      '#d': [identifier],
      limit: 1
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of relays) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            foundEvents.push(event);
          },
          oneose: () => {
            eoseRelays.add(relayUrl);
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
        eoseRelays.add(relayUrl);
      }
    }
    
    // Wait for event or all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (foundEvents.length > 0 || eoseRelays.size >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    const events = foundEvents;

    if (events.length === 0) {
      throw new Error('Book event not found on any relay');
    }

    return events[0];
  } catch (error) {
    console.error('[EPUB Download] Error fetching book event:', error);
    throw error;
  }
}

/**
 * Fetch books by d tag (identifier)
 * Returns all books with the given d tag (from any author)
 */
async function fetchBooksByDTag(dTag) {
  try {
    console.log(`[Books] Fetching books by d tag: ${dTag}`);
    
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    let eoseCount = 0;
    const totalRelays = DEFAULT_RELAYS.length;
    const subscriptions = [];
    
    const filter = {
      kinds: [30040],
      '#d': [dTag],
      limit: 100
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of DEFAULT_RELAYS) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Books] Error subscribing to ${relayUrl}:`, error);
        eoseCount++;
      }
    }
    
    // Wait for all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseCount >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 15000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    console.log(`[Books] Found ${foundEvents.length} books with d tag: ${dTag}`);
    return foundEvents;
  } catch (error) {
    console.error('[Books] Error fetching books by d tag:', error);
    throw error;
  }
}

/**
 * Normalize text for fuzzy matching (lowercase, remove punctuation/hyphens, normalize whitespace)
 */
function normalizeForSearch(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if a book matches a search query (fuzzy matching)
 */
function matchesSearch(book, query) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return false;
  
  // Get d-tag (identifier)
  const dTag = book.tags.find(([k]) => k === 'd')?.[1] || '';
  const normalizedDTag = normalizeForSearch(dTag);
  
  // Get title
  const title = book.tags.find(([k]) => k === 'title')?.[1] || 
               book.tags.find(([k]) => k === 'T')?.[1] || '';
  const normalizedTitle = normalizeForSearch(title);
  
  // Check if query matches d-tag or title (partial match)
  return normalizedDTag.includes(normalizedQuery) || 
         normalizedTitle.includes(normalizedQuery);
}

/**
 * Search books by fuzzy matching on d-tag and title
 */
async function searchBooks(query, limit = 200) {
  try {
    console.log(`[Search] Searching books with query: ${query}`);
    
    // Fetch all books (or a large set)
    const allBooks = await fetchBooks(limit);
    
    // Filter by fuzzy matching
    const matchingBooks = allBooks.filter(book => matchesSearch(book, query));
    
    console.log(`[Search] Found ${matchingBooks.length} matching books out of ${allBooks.length} total`);
    return matchingBooks;
  } catch (error) {
    console.error('[Search] Error searching books:', error);
    throw error;
  }
}

/**
 * Check if input is a naddr or just a d tag
 */
function isNaddr(input) {
  return input && input.startsWith('naddr1');
}

/**
 * Build book event hierarchy (tree structure)
 */
async function buildBookEventHierarchy(indexEvent, visitedIds = new Set()) {
  if (visitedIds.has(indexEvent.id)) {
    return [];
  }
  visitedIds.add(indexEvent.id);

  const nodes = [];
  
  // Collect all 'a' and 'e' tags in their original order
  const aTags = [];
  const eTags = [];
  const tagOrder = [];
  
  indexEvent.tags.forEach((tag, index) => {
    if (tag[0] === 'a' && tag[1]) {
      aTags.push(tag[1]);
      tagOrder.push({ type: 'a', value: tag[1], index });
    } else if (tag[0] === 'e' && tag[1] && tag[1] !== indexEvent.id && !visitedIds.has(tag[1])) {
      eTags.push(tag[1]);
      tagOrder.push({ type: 'e', value: tag[1], index });
    }
  });

  // Fetch all events in parallel
  const aTagEvents = new Map();
  const eTagEvents = new Map();

  // Fetch events by 'a' tags - batch all filters into a single query
  if (aTags.length > 0) {
    try {
      const aTagFilters = [];
      for (const aTag of aTags) {
        const [kindStr, pubkey, dTag] = aTag.split(':');
        if (kindStr && pubkey && dTag) {
          const kind = parseInt(kindStr, 10);
          if (kind === 30040 || kind === 30041) {
            aTagFilters.push({
              kinds: [kind],
              authors: [pubkey],
              '#d': [dTag]
            });
          }
        }
      }

      if (aTagFilters.length > 0) {
        // Batch all filters into a single subscription for much better performance
        const foundEvents = [];
        const eventMap = new Map(); // Deduplicate by event ID
        const eoseRelays = new Set();
        const totalRelays = DEFAULT_RELAYS.length;
        
        // Subscribe to all relays with all filters at once
        const subscriptions = [];
        for (const relayUrl of DEFAULT_RELAYS) {
          try {
            const relay = await pool.ensureRelay(relayUrl);
            // Subscribe with all filters at once - relay will return events matching any filter
            const sub = relay.subscribe(aTagFilters, {
              onevent: (event) => {
                // Deduplicate events by ID
                if (!eventMap.has(event.id)) {
                  eventMap.set(event.id, event);
                  foundEvents.push(event);
                }
              },
              oneose: () => {
                eoseRelays.add(relayUrl);
              }
            });
            subscriptions.push(sub);
          } catch (error) {
            console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
            eoseRelays.add(relayUrl);
          }
        }
        
        // Wait for all relays to respond or timeout (reduced to 5 seconds)
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (eoseRelays.size >= totalRelays) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50); // Check more frequently
          
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 5000); // Reduced timeout from 10s to 5s
        });
        
        // Close all subscriptions
        subscriptions.forEach(s => s.close());
        
        // Map events by their a-tag identifier
        for (const event of foundEvents) {
          if (event.kind === 30040 || event.kind === 30041) {
            const dTag = event.tags.find(([k]) => k === 'd')?.[1];
            if (dTag) {
              const aTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
              aTagEvents.set(aTagKey, event);
            }
          }
        }
      }
    } catch (error) {
      console.error('[EPUB Download] Error processing a-tags:', error);
    }
  }

  // Fetch events by 'e' tags
  if (eTags.length > 0) {
    try {
      const relays = DEFAULT_RELAYS;
      const foundEvents = [];
      const eventMap = new Map(); // Deduplicate by event ID
      const subscriptions = [];
      const eoseRelays = new Set();
      const totalRelays = relays.length;
      
      const filter = { ids: eTags };
      
      // Subscribe to each relay individually
      for (const relayUrl of relays) {
        try {
          const relay = await pool.ensureRelay(relayUrl);
          const sub = relay.subscribe([filter], {
            onevent: (event) => {
              // Deduplicate events by ID
              if (!eventMap.has(event.id)) {
                eventMap.set(event.id, event);
                foundEvents.push(event);
              }
            },
            oneose: () => {
              eoseRelays.add(relayUrl);
            }
          });
          subscriptions.push(sub);
        } catch (error) {
          console.error(`[EPUB Download] Error subscribing to ${relayUrl}:`, error);
          eoseRelays.add(relayUrl);
        }
      }
      
      // Wait for all relays to respond or timeout (reduced to 5 seconds)
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (eoseRelays.size >= totalRelays) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50); // Check more frequently
        
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000); // Reduced timeout from 10s to 5s
      });
      
      // Close all subscriptions
      subscriptions.forEach(s => s.close());
      
      for (const event of foundEvents) {
        eTagEvents.set(event.id, event);
      }
    } catch (error) {
      console.error('[EPUB Download] Error fetching events by e-tags:', error);
    }
  }

  // Build nodes in original tag order - parallelize recursive calls for better performance
  const nodePromises = [];
  const branchNodes = []; // Track branch nodes that need children loaded
  
  // First pass: create all nodes and collect promises for branch nodes
  for (const tagInfo of tagOrder) {
    if (tagInfo.type === 'a') {
      const [kindStr, pubkey, dTag] = tagInfo.value.split(':');
      if (kindStr && pubkey && dTag) {
        const aTagKey = `${kindStr}:${pubkey}:${dTag}`;
        const event = aTagEvents.get(aTagKey);
        if (event) {
          const node = {
            event,
            children: []
          };
          
          // If this is a 30040 event (branch), recursively fetch its children
          if (event.kind === 30040 && !visitedIds.has(event.id)) {
            // Create promise for fetching children
            const promiseIndex = nodePromises.length;
            nodePromises.push(buildBookEventHierarchy(event, visitedIds));
            branchNodes.push({ node, promiseIndex });
            nodes.push(node); // Add node now, fill children later
          } else {
            // Leaf node
            nodes.push(node);
          }
        }
      }
    } else if (tagInfo.type === 'e') {
      const event = eTagEvents.get(tagInfo.value);
      if (event) {
        nodes.push({
          event,
          children: []
        });
      }
    }
  }
  
  // Wait for all recursive calls to complete in parallel
  if (nodePromises.length > 0) {
    const allChildren = await Promise.all(nodePromises);
    // Fill in children for branch nodes
    for (const { node, promiseIndex } of branchNodes) {
      node.children = allChildren[promiseIndex];
    }
  }

  return nodes;
}

/**
 * Combine book events into AsciiDoc content
 * Renders hierarchical structure from nodes
 */
function combineBookEvents(indexEvent, hierarchy) {
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = nip19.npubEncode(indexEvent.pubkey);
  }

  // Build basic document structure
  let doc = `= ${title}\n`;
  if (author) {
    doc += `${author}\n`;
  }
  doc += `:doctype: book\n`;
  doc += `:toc:\n`;
  doc += `:toclevels: 1\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  
  if (author) {
    doc += `:author: ${author}\n`;
  }

  const version = indexEvent.tags.find(([k]) => k === 'version')?.[1] || 'first edition';
  doc += `:version: ${version}\n`;
  doc += `:revnumber: ${version}\n`;

  const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
  if (image) {
    // Add cover image for all formats (EPUB, PDF, HTML)
    doc += `:front-cover-image: ${image}\n`;
    doc += `:epub-cover-image: ${image}\n`; // Also set epub-cover-image for EPUB compatibility
  }

  doc += `\n\n`;

  // Render hierarchy recursively
  function renderNode(node, level = 2) {
    const event = node.event;
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1] || 
                        event.tags.find(([k]) => k === 'T')?.[1];
    
    if (sectionTitle) {
      const headingLevel = '='.repeat(Math.min(level, 6)); // Max level 6
      doc += `${headingLevel} ${sectionTitle}\n\n`;
    }
    
    // Add content if it exists
    if (event.content && event.content.trim().length > 0) {
      doc += `${event.content}\n\n`;
    }
    
    // Render children
    for (const child of node.children) {
      renderNode(child, level + 1);
    }
  }

  // Render all top-level nodes
  for (const node of hierarchy) {
    renderNode(node, 2);
  }

  return { content: doc, title, author };
}

/**
 * Generate EPUB using AsciiDoctor server
 */
async function generateEPUB(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/epub`;
  
  console.log(`[EPUB Download] Generating EPUB via ${url}`);
  console.log(`[EPUB Download] Content length: ${content.length} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      title,
      author
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();
  return blob;
}

/**
 * Generate PDF using AsciiDoctor server
 */
async function generatePDF(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/pdf`;
  
  console.log(`[PDF Download] Generating PDF via ${url}`);
  console.log(`[PDF Download] Content length: ${content.length} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      title,
      author
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();
  return blob;
}

/**
 * Generate HTML using AsciiDoctor server
 */
async function generateHTML(content, title, author) {
  const url = `${ASCIIDOCTOR_SERVER_URL}/convert/html5`;
  
  console.log(`[HTML View] Generating HTML via ${url}`);
  console.log(`[HTML View] Content length: ${content.length} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      title,
      author
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AsciiDoctor server error: ${response.status} ${errorText}`);
  }

  const html = await response.text();
  return html;
}

/**
 * Fetch kind 30040 events (books)
 */
async function fetchBooks(limit = 50) {
  try {
    console.log(`[Books] Fetching ${limit} books from relays...`);
    
    const filter = {
      kinds: [30040],
      limit: Number(limit)
    };
    
    console.log(`[Books] Using filter:`, JSON.stringify(filter));
    
    // Use individual relay subscriptions to avoid subscribeMany serialization issues
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    const eoseRelays = new Set();
    const totalRelays = DEFAULT_RELAYS.length;
    const subscriptions = [];
    
    // Subscribe to each relay individually
    for (const relayUrl of DEFAULT_RELAYS) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseRelays.add(relayUrl);
            console.log(`[Books] EOSE from ${relayUrl} (${eoseRelays.size}/${totalRelays})`);
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Books] Error subscribing to ${relayUrl}:`, error);
        eoseRelays.add(relayUrl); // Mark as done (failed)
      }
    }
    
    // Wait for all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseRelays.size >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        console.log(`[Books] Timeout reached after ${eoseRelays.size}/${totalRelays} relays responded`);
        resolve();
      }, 15000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(sub => sub.close());
    
    console.log(`[Books] Found ${foundEvents.length} books`);
    return foundEvents;
  } catch (error) {
    console.error('[Books] Error fetching books:', error);
    throw error;
  }
}

/**
 * Fetch comments (kind 1111) and highlights (kind 9802) for a book event
 */
async function fetchComments(bookEvent) {
  try {
    // Build article coordinate: kind:pubkey:identifier
    const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
    const articleCoordinate = `${bookEvent.kind}:${bookEvent.pubkey}:${identifier}`;
    
    console.log(`[Comments] Fetching comments and highlights for coordinate: ${articleCoordinate}`);
    
    const foundEvents = [];
    const eventMap = new Map(); // Deduplicate by event ID
    let eoseCount = 0;
    const totalRelays = DEFAULT_RELAYS.length;
    const subscriptions = [];
    
    // Fetch both kind 1111 (comments) and kind 9802 (highlights)
    const filter = {
      kinds: [1111, 9802],
      '#A': [articleCoordinate], // NIP-22: uppercase A tag for root scope
      limit: 500
    };
    
    // Subscribe to each relay individually
    for (const relayUrl of DEFAULT_RELAYS) {
      try {
        const relay = await pool.ensureRelay(relayUrl);
        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            // Deduplicate events by ID
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, event);
              foundEvents.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
          }
        });
        subscriptions.push(sub);
      } catch (error) {
        console.error(`[Comments] Error subscribing to ${relayUrl}:`, error);
        eoseCount++;
      }
    }
    
    // Wait for all relays to respond or timeout
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (eoseCount >= totalRelays) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
    
    // Close all subscriptions
    subscriptions.forEach(s => s.close());
    
    console.log(`[Comments] Found ${foundEvents.length} comments and highlights`);
    return foundEvents;
  } catch (error) {
    console.error('[Comments] Error fetching comments:', error);
    return [];
  }
}

/**
 * Build threaded structure for comments and highlights
 */
function buildThreadedComments(events) {
  // Create a map of all events by ID
  const eventMap = new Map();
  for (const event of events) {
    eventMap.set(event.id, { ...event, children: [] });
  }
  
  // Build tree structure
  const rootEvents = [];
  const processed = new Set();
  
  for (const event of events) {
    if (processed.has(event.id)) continue;
    
    // Find parent via 'e' tag (NIP-22: lowercase 'e' for parent event)
    const parentETag = event.tags.find(([k]) => k === 'e');
    const parentEventId = parentETag?.[1];
    
    // Also check for 'a' tag (article reference) - might reference another comment/highlight
    const parentATag = event.tags.find(([k]) => k === 'a');
    let parentEvent = null;
    
    if (parentEventId && eventMap.has(parentEventId)) {
      parentEvent = eventMap.get(parentEventId);
    } else if (parentATag && parentATag[1]) {
      // Try to find parent by a-tag (format: kind:pubkey:identifier)
      const [kindStr, pubkey, identifier] = parentATag[1].split(':');
      if (kindStr && pubkey && identifier) {
        // Look for a comment/highlight with matching kind, pubkey, and d-tag
        for (const e of events) {
          if (e.kind === parseInt(kindStr, 10) && 
              e.pubkey === pubkey && 
              e.tags.find(([k]) => k === 'd')?.[1] === identifier) {
            parentEvent = eventMap.get(e.id);
            break;
          }
        }
      }
    }
    
    if (parentEvent && parentEvent.id !== event.id) {
      // Add as child of parent
      parentEvent.children.push(eventMap.get(event.id));
      processed.add(event.id);
    } else {
      // Root level comment/highlight
      rootEvents.push(eventMap.get(event.id));
      processed.add(event.id);
    }
  }
  
  // Sort by created_at
  const sortByDate = (a, b) => a.created_at - b.created_at;
  rootEvents.sort(sortByDate);
  for (const event of eventMap.values()) {
    if (event.children.length > 0) {
      event.children.sort(sortByDate);
    }
  }
  
  return rootEvents;
}

/**
 * Format timestamp to readable date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text
 */
function truncate(text, maxLength = 200) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Handle HTTP request
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS headers for e-paper readers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  // Handle root - show book view with search
  if (url.pathname === '/' || url.pathname === '') {
    const query = url.searchParams.get('naddr') || url.searchParams.get('q') || url.searchParams.get('d');
    const searchType = url.searchParams.get('type'); // 'naddr', 'd', or auto-detect
    
    // If query provided, process it
    if (query) {
      // Auto-detect if it's a naddr or d tag
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
        try {
          console.log(`[Search] Searching for books with query: ${query}`);
          // Use fuzzy search instead of exact d-tag match
          // Fetch more books (500) to have better search coverage
          const books = await searchBooks(query, 500);
          
          // Sort by created_at (newest first)
          books.sort((a, b) => b.created_at - a.created_at);
          
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          
          let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Search Results - Alexandria Catalogue</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    button:hover { background: #0056b3; }
    .results-header { margin: 1.5em 0; }
    .book-result { margin: 1.5em 0; padding: 1em; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; }
    .book-title { font-size: 1.2em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #666; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 0.5em; }
    .book-actions a { display: inline-block; margin-right: 1em; color: #007bff; text-decoration: none; }
    .book-actions a:hover { text-decoration: underline; }
    .no-results { color: #666; font-style: italic; margin: 2em 0; text-align: center; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="results-header">
    <h2>Search Results for: "${escapeHtml(query)}"</h2>
    <p>Found ${books.length} book${books.length !== 1 ? 's' : ''} matching your search:</p>
  </div>
`;

          if (books.length === 0) {
            html += '<p class="no-results">No books found with this d tag.</p>';
          } else {
            for (const book of books) {
              const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                           book.tags.find(([k]) => k === 'T')?.[1] ||
                           'Untitled';
              const author = book.tags.find(([k]) => k === 'author')?.[1] || 
                            nip19.npubEncode(book.pubkey).substring(0, 16) + '...';
              const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
              const date = formatDate(book.created_at);
              
              // Generate naddr
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
      Author: ${escapeHtml(author)}<br>
      Created: ${date}
    </div>
    <div class="book-actions">
      <a href="/?naddr=${encodeURIComponent(naddr)}">View & Comments</a>
      <a href="/view?naddr=${encodeURIComponent(naddr)}">View as Web Page</a>
      <a href="/download-epub?naddr=${encodeURIComponent(naddr)}">Download EPUB</a>
      <a href="/download-pdf?naddr=${encodeURIComponent(naddr)}">Download PDF</a>
    </div>
  </div>
`;
            }
          }
          
          html += `
</body>
</html>
`;
          
          res.end(html);
        } catch (error) {
          console.error('[Search] Error:', error);
          const errorMsg = error?.message || String(error);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error - Alexandria Catalogue</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr or d tag..." value="${escapeHtml(query || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="error">
    <h2>Error</h2>
    <p>${escapeHtml(errorMsg)}</p>
  </div>
</body>
</html>
          `);
        }
        return;
      }
      
      // It's a naddr, show single book
      const naddr = query;
      try {
        console.log(`[Book View] Request received for naddr: ${naddr}`);
        
        // Fetch the book event
        const bookEvent = await fetchBookEvent(naddr);
        console.log(`[Book View] Found book event: ${bookEvent.id}`);

        // Fetch comments and highlights
        console.log(`[Book View] Fetching comments and highlights...`);
        const allItems = await fetchComments(bookEvent);
        console.log(`[Book View] Found ${allItems.length} comments and highlights`);

        // Build threaded structure
        const threadedItems = buildThreadedComments(allItems);
        
        // Count comments and highlights separately
        const commentCount = allItems.filter(e => e.kind === 1111).length;
        const highlightCount = allItems.filter(e => e.kind === 9802).length;

        const title = bookEvent.tags.find(([k]) => k === 'title')?.[1] || 
                     bookEvent.tags.find(([k]) => k === 'T')?.[1] ||
                     'Untitled';
        const author = bookEvent.tags.find(([k]) => k === 'author')?.[1] || 
                      nip19.npubEncode(bookEvent.pubkey).substring(0, 16) + '...';
        const date = formatDate(bookEvent.created_at);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    button:hover { background: #0056b3; }
    .book-header { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    .book-title { font-size: 1.5em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #666; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 1em; }
    .book-actions a, .book-actions button { display: inline-block; margin-right: 1em; padding: 0.5em 1em; color: white; background: #28a745; text-decoration: none; border: none; cursor: pointer; border-radius: 4px; }
    .book-actions a:hover, .book-actions button:hover { background: #218838; }
    .comments-section { margin-top: 2em; }
    .comment, .highlight { margin: 1.5em 0; padding: 1em; border-left: 3px solid #ddd; background: #fafafa; }
    .highlight { border-left-color: #ffc107; background: #fffbf0; }
    .comment-author, .highlight-author { font-weight: bold; color: #333; margin-bottom: 0.5em; }
    .comment-date, .highlight-date { color: #666; font-size: 0.85em; }
    .comment-content, .highlight-content { margin-top: 0.5em; white-space: pre-wrap; word-wrap: break-word; }
    .comment-type { display: inline-block; padding: 0.2em 0.5em; font-size: 0.75em; border-radius: 3px; margin-left: 0.5em; }
    .comment-type.comment { background: #e3f2fd; color: #1976d2; }
    .comment-type.highlight { background: #fff3cd; color: #856404; }
    .no-comments { color: #666; font-style: italic; margin: 1em 0; }
    .thread-reply { margin-left: 2em; margin-top: 1em; border-left: 2px solid #ccc; padding-left: 1em; }
    .thread-reply .comment, .thread-reply .highlight { border-left-width: 2px; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr)}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="book-header">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      Author: ${escapeHtml(author)}<br>
      Created: ${date}
    </div>
    <div class="book-actions">
      <a href="/view?naddr=${encodeURIComponent(naddr)}">View as Web Page</a>
      <a href="/download-epub?naddr=${encodeURIComponent(naddr)}">Download EPUB</a>
      <a href="/download-pdf?naddr=${encodeURIComponent(naddr)}">Download PDF</a>
    </div>
  </div>
  
  <div class="comments-section">
    <h2>Comments & Highlights (${commentCount} comments, ${highlightCount} highlights)</h2>
`;

        if (threadedItems.length === 0) {
          html += '<p class="no-comments">No comments or highlights yet.</p>';
        } else {
          // Recursive function to render threaded items
          const renderItem = (item, depth = 0) => {
            const isHighlight = item.kind === 9802;
            const itemClass = isHighlight ? 'highlight' : 'comment';
            const authorClass = isHighlight ? 'highlight-author' : 'comment-author';
            const dateClass = isHighlight ? 'highlight-date' : 'comment-date';
            const contentClass = isHighlight ? 'highlight-content' : 'comment-content';
            
            const author = nip19.npubEncode(item.pubkey).substring(0, 16) + '...';
            const date = formatDate(item.created_at);
            const content = escapeHtml(truncate(item.content || '', 1000));
            const typeLabel = isHighlight ? 'Highlight' : 'Comment';
            
            let itemHtml = `
    <div class="${itemClass}"${depth > 0 ? ' style="margin-left: ' + (depth * 2) + 'em;"' : ''}>
      <div class="${authorClass}">
        ${escapeHtml(author)}
        <span class="comment-type ${itemClass}">${typeLabel}</span>
      </div>
      <div class="${dateClass}">${date}</div>
      <div class="${contentClass}">${content}</div>
`;
            
            // Render children (replies)
            if (item.children && item.children.length > 0) {
              itemHtml += '      <div class="thread-replies">\n';
              for (const child of item.children) {
                itemHtml += renderItem(child, depth + 1);
              }
              itemHtml += '      </div>\n';
            }
            
            itemHtml += '    </div>\n';
            return itemHtml;
          };
          
          for (const item of threadedItems) {
            html += renderItem(item);
          }
        }
        
        html += `
  </div>
</body>
</html>
`;
        
        res.end(html);
      } catch (error) {
        console.error('[Book View] Error:', error);
        const errorMsg = error?.message || String(error);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr || '')}" required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="error">
    <h2>Error</h2>
    <p>${escapeHtml(errorMsg)}</p>
  </div>
</body>
</html>
        `);
      }
      return;
    }
    
    // No naddr - show search form
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alexandria Catalogue</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #f5f5f5; border-radius: 4px; }
    input[type="text"] { width: 70%; padding: 0.5em; font-size: 1em; margin-right: 0.5em; }
    button { padding: 0.5em 1em; font-size: 1em; background: #007bff; color: white; border: none; cursor: pointer; }
    button:hover { background: #0056b3; }
    .info { color: #666; margin: 1em 0; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
  <p class="info">Enter a book naddr (nostr address) or d tag to view the book and download as EPUB</p>
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="naddr1... or d tag..." required>
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books" style="color: #007bff; text-decoration: none; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  <p class="info">Examples: naddr1qq... or a d tag identifier<br>If multiple books share the same d tag, all will be shown.<br>Or browse all books from the <a href="/books">Browse Library</a> page.</p>
</body>
</html>
    `);
    return;
  }

  // Handle view endpoint - render book as HTML
  if (url.pathname === '/view') {
    const naddr = url.searchParams.get('naddr');
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[HTML View] Request received for naddr: ${naddr}`);
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr);
      console.log(`[HTML View] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[HTML View] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent);
      console.log(`[HTML View] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[HTML View] Combined content: ${content.length} chars`);

      // Generate HTML
      console.log(`[HTML View] Generating HTML...`);
      const htmlContent = await generateHTML(content, title, author);
      console.log(`[HTML View] HTML generated: ${htmlContent.length} chars`);

      // Send HTML as response
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(htmlContent);
      
      console.log(`[HTML View] HTML sent successfully`);
    } catch (error) {
      console.error('[HTML View] Error:', error);
      const errorMsg = error?.message || String(error);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
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
    return;
  }

  // Handle EPUB download endpoint
  if (url.pathname === '/download-epub') {
    const naddr = url.searchParams.get('naddr');
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[EPUB Download] Request received for naddr: ${naddr}`);
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr);
      console.log(`[EPUB Download] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[EPUB Download] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent);
      console.log(`[EPUB Download] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[EPUB Download] Combined content: ${content.length} chars`);

      // Generate EPUB
      console.log(`[EPUB Download] Generating EPUB...`);
      const epubBlob = await generateEPUB(content, title, author);
      console.log(`[EPUB Download] EPUB generated: ${epubBlob.size} bytes`);

      // Send EPUB as download
      const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.epub`;
      res.writeHead(200, {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': epubBlob.size
      });
      
      const buffer = Buffer.from(await epubBlob.arrayBuffer());
      res.end(buffer);
      
      console.log(`[EPUB Download] EPUB sent successfully`);
    } catch (error) {
      console.error('[EPUB Download] Error:', error);
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
    return;
  }

  // Handle PDF download
  if (url.pathname === '/download-pdf') {
    const naddr = url.searchParams.get('naddr');
    
    if (!naddr) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
</head>
<body>
  <h1>Error</h1>
  <p>Missing naddr parameter. Please provide a book naddr.</p>
  <p><a href="/">Go back</a></p>
</body>
</html>
      `);
      return;
    }

    try {
      console.log(`[PDF Download] Request received for naddr: ${naddr}`);
      
      // Fetch the book index event
      const indexEvent = await fetchBookEvent(naddr);
      console.log(`[PDF Download] Found book event: ${indexEvent.id}`);

      // Build book hierarchy
      console.log(`[PDF Download] Building book hierarchy...`);
      const hierarchy = await buildBookEventHierarchy(indexEvent);
      console.log(`[PDF Download] Built hierarchy with ${hierarchy.length} top-level nodes`);

      // Combine into AsciiDoc
      const { content, title, author } = combineBookEvents(indexEvent, hierarchy);
      console.log(`[PDF Download] Combined content: ${content.length} chars`);

      // Generate PDF
      console.log(`[PDF Download] Generating PDF...`);
      const pdfBlob = await generatePDF(content, title, author);
      console.log(`[PDF Download] PDF generated: ${pdfBlob.size} bytes`);

      // Send PDF as download
      const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBlob.size
      });
      
      const buffer = Buffer.from(await pdfBlob.arrayBuffer());
      res.end(buffer);
      
      console.log(`[PDF Download] PDF sent successfully`);
    } catch (error) {
      console.error('[PDF Download] Error:', error);
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
    return;
  }

  // Handle books browse page - table/list of all 30040 indexes
  if (url.pathname === '/books') {
    try {
      console.log('[Books] Fetching books list...');
      const books = await fetchBooks(200); // Fetch more books for the table
      
      // Sort by created_at (newest first)
      books.sort((a, b) => b.created_at - a.created_at);
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      
      let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alexandria Catalogue - Browse Library</title>
  <style>
    body { font-family: sans-serif; max-width: 1000px; margin: 2em auto; padding: 1em; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 1em; color: #007bff; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin-top: 1em; }
    th, td { padding: 0.75em; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    tr:hover { background: #f9f9f9; }
    .book-link { color: #007bff; text-decoration: none; }
    .book-link:hover { text-decoration: underline; }
    .book-title { font-weight: bold; }
    .book-author { color: #666; font-size: 0.9em; }
    .book-date { color: #666; font-size: 0.85em; white-space: nowrap; }
    .loading { text-align: center; color: #666; padding: 2em; }
    .error { color: red; margin: 1em 0; padding: 1em; background: #fee; border: 1px solid #fcc; }
    .book-count { color: #666; margin-bottom: 1em; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Alexandria Catalogue</a>
    <a href="/books">Browse Library</a>
  </nav>
  <h1><span aria-label="Books">📚</span> Alexandria Catalogue - Browse Library</h1>
  <p style="color: #666; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #007bff; text-decoration: none;">Alexandria</a>.</p>
`;
      
      if (books.length === 0) {
        html += '<p class="loading">No books found.</p>';
      } else {
        html += `<p class="book-count">Found ${books.length} books:</p>`;
        html += `
  <table>
    <thead>
      <tr>
        <th>Title</th>
        <th>Author</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>
`;
        
        for (const book of books) {
          const title = book.tags.find(([k]) => k === 'title')?.[1] || 
                       book.tags.find(([k]) => k === 'T')?.[1] ||
                       'Untitled';
          const author = book.tags.find(([k]) => k === 'author')?.[1] || 
                        nip19.npubEncode(book.pubkey).substring(0, 16) + '...';
          const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
          
          // Generate naddr
          let naddr = '';
          try {
            naddr = nip19.naddrEncode({
              kind: book.kind,
              pubkey: book.pubkey,
              identifier: identifier
            });
          } catch (e) {
            console.error('[Books] Error encoding naddr:', e);
            continue; // Skip this book if we can't encode naddr
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
  <div style="margin-top: 2em; text-align: center;">
    <a href="/" style="color: #007bff; text-decoration: none; font-size: 1em;">← Back to Search</a>
  </div>
`;
      }
      
      html += `
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
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`[Alexandria Catalogue] Listening on port ${PORT}`);
  console.log(`[Alexandria Catalogue] Access at http://localhost:${PORT}`);
  console.log(`[Alexandria Catalogue] AsciiDoctor server: ${ASCIIDOCTOR_SERVER_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  pool.close();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Alexandria Catalogue] Shutting down...');
  pool.close();
  server.close(() => {
    process.exit(0);
  });
});
