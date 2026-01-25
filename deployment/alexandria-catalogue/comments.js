/**
 * Comments and highlights fetching and threading
 */

import { fetchEventsByFilters } from './nostr.js';
import { DEFAULT_RELAYS } from './config.js';
import { collectAllEventsFromHierarchy } from './book.js';

/**
 * Fetch comments (kind 1111) for a book event (NIP-22)
 * Comments are scoped to the root event using A tags
 */
export async function fetchComments(bookEvent, hierarchy = [], customRelays = null) {
  const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
  
  // Build article coordinate for the root 30040 event (for comments)
  const identifier = bookEvent.tags.find(([k]) => k === 'd')?.[1] || bookEvent.id;
  const rootCoordinate = `${bookEvent.kind}:${bookEvent.pubkey}:${identifier}`;
  
  console.log(`[Comments] Fetching comments for root coordinate: ${rootCoordinate}`);
  
  // Fetch comments (kind 1111) for the root 30040 event
  // NIP-22: Comments use A tags to reference the root scope
  const commentFilter = {
    kinds: [1111],
    '#A': [rootCoordinate],
    limit: 500
  };
  
  const allItems = await fetchEventsByFilters([commentFilter], relays, 10000);
  
  const commentCount = allItems.filter(e => e.kind === 1111).length;
  console.log(`[Comments] Found ${commentCount} comments`);
  return allItems;
}

/**
 * Build threaded structure for comments (NIP-22)
 * NIP-22: Comments use lowercase tags (e, a, i) for parent items
 * and uppercase tags (E, A, I) for root scope
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
    
    // NIP-22: Check for parent using lowercase tags (e, a, i)
    // First check 'e' tag (parent event id)
    const parentETag = event.tags.find(([k]) => k === 'e');
    const parentEventId = parentETag?.[1];
    
    // Then check 'a' tag (parent event address)
    const parentATag = event.tags.find(([k]) => k === 'a');
    
    // Also check 'i' tag (parent I-tag reference)
    const parentITag = event.tags.find(([k]) => k === 'i');
    
    let parentEvent = null;
    
    // Priority: e tag > a tag > i tag
    if (parentEventId && eventMap.has(parentEventId)) {
      // Parent is another comment (reply to comment)
      parentEvent = eventMap.get(parentEventId);
    } else if (parentATag && parentATag[1]) {
      // Try to find parent by event address (kind:pubkey:identifier)
      // For comments, the 'a' tag with lowercase refers to the parent comment's address
      // We need to find a comment that matches this address
      for (const e of events) {
        if (e.id === event.id) continue; // Skip self
        
        // Check if this event's address matches the parent 'a' tag
        const eDTag = e.tags.find(([k]) => k === 'd')?.[1];
        if (eDTag) {
          const eCoordinate = `${e.kind}:${e.pubkey}:${eDTag}`;
          if (eCoordinate === parentATag[1]) {
            parentEvent = eventMap.get(e.id);
            break;
          }
        }
        // Also check if the event id matches (in case parentATag[1] is actually an event id)
        if (e.id === parentATag[1]) {
          parentEvent = eventMap.get(e.id);
          break;
        }
      }
    } else if (parentITag && parentITag[1]) {
      // For I-tag references, match by the I value
      for (const e of events) {
        if (e.id === event.id) continue; // Skip self
        
        // Check if this event has a matching I tag
        const eITag = e.tags.find(([k]) => k === 'I' || k === 'i');
        if (eITag && eITag[1] === parentITag[1]) {
          parentEvent = eventMap.get(e.id);
          break;
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
