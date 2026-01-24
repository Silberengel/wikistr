/**
 * Comments and highlights fetching and threading
 */

import { fetchEventsByFilters } from './nostr.js';
import { DEFAULT_RELAYS } from './config.js';
import { collectAllEventsFromHierarchy } from './book.js';

/**
 * Fetch comments (kind 1111) and highlights (kind 9802) for a book event
 */
export async function fetchComments(bookEvent, hierarchy = [], customRelays = null) {
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
  
  // Build article coordinate for the root 30040 event (for comments only)
  const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
  const rootCoordinate = `${bookEvent.kind}:${bookEvent.pubkey}:${identifier}`;
  
  // Collect all event coordinates from the hierarchy (for highlights)
  const allEvents = collectAllEventsFromHierarchy(bookEvent, hierarchy);
  const highlightCoordinates = [];
  const coordinateSet = new Set();
  
  for (const event of allEvents) {
    const dTag = event.tags.find(([k]) => k === 'd')?.[1];
    if (dTag) {
      const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
      if (!coordinateSet.has(coordinate)) {
        coordinateSet.add(coordinate);
        highlightCoordinates.push(coordinate);
      }
    } else {
      const coordinate = `${event.kind}:${event.pubkey}:${event.id}`;
      if (!coordinateSet.has(coordinate)) {
        coordinateSet.add(coordinate);
        highlightCoordinates.push(coordinate);
      }
    }
  }
  
  console.log(`[Comments] Fetching comments for root coordinate: ${rootCoordinate}`);
  console.log(`[Comments] Fetching highlights for ${highlightCoordinates.length} events in hierarchy`);
  
  // Fetch comments (kind 1111) only for the root 30040 event
  const commentFilter = {
    kinds: [1111],
    '#A': [rootCoordinate],
    limit: 500
  };
  
  // Fetch highlights (kind 9802) for all events in the hierarchy
  const highlightFilter = {
    kinds: [9802],
    '#A': highlightCoordinates,
    limit: 1000
  };
  
  // Fetch both comments and highlights using batch filter (both filters in one subscription per relay)
  // Increase timeout for large books with many events
  const timeout = Math.min(Math.max(10000, highlightCoordinates.length * 50), 30000); // 10s minimum, 50ms per coordinate, 30s maximum
  const allItems = await fetchEventsByFilters([commentFilter, highlightFilter], relays, timeout);
  
  const commentCount = allItems.filter(e => e.kind === 1111).length;
  const highlightCount = allItems.filter(e => e.kind === 9802).length;
  console.log(`[Comments] Found ${commentCount} comments and ${highlightCount} highlights`);
  return allItems;
}

/**
 * Build threaded structure for comments and highlights
 */
export function buildThreadedComments(events) {
  const eventMap = new Map();
  for (const event of events) {
    eventMap.set(event.id, { ...event, children: [] });
  }
  
  const rootEvents = [];
  const processed = new Set();
  
  for (const event of events) {
    if (processed.has(event.id)) continue;
    
    const parentETag = event.tags.find(([k]) => k === 'e');
    const parentEventId = parentETag?.[1];
    
    const parentATag = event.tags.find(([k]) => k === 'a');
    let parentEvent = null;
    
    if (parentEventId && eventMap.has(parentEventId)) {
      parentEvent = eventMap.get(parentEventId);
    } else if (parentATag && parentATag[1]) {
      const [kindStr, pubkey, identifier] = parentATag[1].split(':');
      if (kindStr && pubkey && identifier) {
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
      parentEvent.children.push(eventMap.get(event.id));
      processed.add(event.id);
    } else {
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
