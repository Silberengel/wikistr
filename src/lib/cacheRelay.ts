/**
 * Cache Relay System
 * Implements a local cache relay using kind 10432 events
 * Events are stored in IndexedDB and served as a local relay
 */

import * as idbkv from 'idb-keyval';
import type { NostrEvent, EventTemplate } from '@nostr/tools/pure';
import { account, signer } from './nostr';
import { relayService } from './relayService';
import { get as getStore } from 'svelte/store';

const CACHE_RELAY_KIND = 10432;
const CACHE_RELAY_STORE = idbkv.createStore('wikistr-cache-relay', 'events-store');
const CACHE_RELAY_KEY = 'cache-relay:events';

/**
 * Get the cache relay URL (local identifier)
 */
export function getCacheRelayUrl(): string {
  return 'local://cache-relay';
}

/**
 * Store an event in the cache relay (kind 10432)
 */
export async function storeEventInCacheRelay(event: NostrEvent): Promise<void> {
  try {
    const allEvents = await getAllCachedEvents();
    
    // Check if we already have this event (by id)
    const existingIndex = allEvents.findIndex(e => e.id === event.id);
    if (existingIndex >= 0) {
      // Update existing event
      allEvents[existingIndex] = event;
    } else {
      // Add new event
      allEvents.push(event);
    }
    
    // Store back to IndexedDB
    await idbkv.set(CACHE_RELAY_KEY, allEvents, CACHE_RELAY_STORE);
    
    // Also create/update a kind 10432 event for this event
    await createCacheRelayEvent(event);
  } catch (error) {
    console.error('Failed to store event in cache relay:', error);
  }
}

/**
 * Get all events from cache relay
 */
export async function getAllCachedEvents(): Promise<NostrEvent[]> {
  try {
    const events = await idbkv.get<NostrEvent[]>(CACHE_RELAY_KEY, CACHE_RELAY_STORE);
    return events || [];
  } catch (error) {
    console.error('Failed to get cached events:', error);
    return [];
  }
}

/**
 * Get events from cache relay matching filters
 */
export async function queryCacheRelay(filters: any[]): Promise<NostrEvent[]> {
  const allEvents = await getAllCachedEvents();
  const results: NostrEvent[] = [];
  
  for (const filter of filters) {
    for (const event of allEvents) {
      // Check kind filter
      if (filter.kinds && !filter.kinds.includes(event.kind)) {
        continue;
      }
      
      // Check authors filter
      if (filter.authors && !filter.authors.includes(event.pubkey)) {
        continue;
      }
      
      // Check ids filter
      if (filter.ids && !filter.ids.includes(event.id)) {
        continue;
      }
      
      // Check #e filter
      if (filter['#e']) {
        const eventIds = event.tags.filter(t => t[0] === 'e').map(t => t[1]);
        if (!filter['#e'].some((id: string) => eventIds.includes(id))) {
          continue;
        }
      }
      
      // Check #p filter
      if (filter['#p']) {
        const pubkeys = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
        if (!filter['#p'].some((p: string) => pubkeys.includes(p))) {
          continue;
        }
      }
      
      // Check #d filter
      if (filter['#d']) {
        const dTags = event.tags.filter(t => t[0] === 'd').map(t => t[1]);
        if (!filter['#d'].some((d: string) => dTags.includes(d))) {
          continue;
        }
      }
      
      // Check since/until filters
      if (filter.since && event.created_at < filter.since) {
        continue;
      }
      if (filter.until && event.created_at > filter.until) {
        continue;
      }
      
      // Check limit
      if (filter.limit && results.length >= filter.limit) {
        break;
      }
      
      results.push(event);
    }
  }
  
  // Deduplicate by event id
  const uniqueResults = Array.from(new Map(results.map(e => [e.id, e])).values());
  
  return uniqueResults;
}

/**
 * Create a kind 10432 event to store in the user's outbox
 */
async function createCacheRelayEvent(event: NostrEvent): Promise<void> {
  const accountValue = getStore(account);
  if (!accountValue) return;
  
  try {
    // Create a kind 10432 event that references the cached event
    const cacheEvent: EventTemplate = {
      kind: CACHE_RELAY_KIND,
      tags: [
        ['e', event.id], // Reference to the cached event
        ['kind', event.kind.toString()], // Store the kind
        ['pubkey', event.pubkey], // Store the author
      ],
      content: JSON.stringify(event), // Store the full event as JSON
      created_at: Math.round(Date.now() / 1000)
    };
    
    // Add d-tag if present
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag) {
      cacheEvent.tags.push(['d', dTag]);
    }
    
    const signed = await signer.signEvent(cacheEvent);
    
    // Store locally (don't publish to relays, just cache)
    await idbkv.set(`cache-relay:${event.id}`, signed, CACHE_RELAY_STORE);
  } catch (error) {
    console.error('Failed to create cache relay event:', error);
  }
}

/**
 * Add cache relay to inboxes/outboxes dynamically
 */
export function addCacheRelayToRelaySets(): string {
  return getCacheRelayUrl();
}

