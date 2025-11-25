/**
 * Cache Relay System
 * Handles kind 10432 events which store lists of cache relay URLs (ws:// addresses)
 * Similar to kind 10002 which stores wss:// relay lists
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { account } from './nostr';
import { relayService } from './relayService';
import { contentCache } from './contentCache';
import { get as getStore } from 'svelte/store';

const CACHE_RELAY_KIND = 10432;

/**
 * Load cache relay URLs from kind 10432 event for the current user
 * Returns array of ws:// relay URLs
 */
async function loadCacheRelayUrls(userPubkey: string): Promise<string[]> {
  try {
    // Check contentCache for kind 10432 event
    const cachedEvents = contentCache.getEvents('kind10432');
    const cachedEvent = cachedEvents.find(c => c.event.pubkey === userPubkey && c.event.kind === CACHE_RELAY_KIND);
    
    if (cachedEvent) {
      const relays = cachedEvent.event.tags
        .filter(tag => tag[0] === 'r')
        .map(tag => tag[1])
        .filter(relay => relay && (relay.startsWith('ws://') || relay.startsWith('wss://')));
      
      return relays;
    }
    
    // Only load cache relays for the logged-in user
    const accountValue = getStore(account);
    const currentUserPubkey = accountValue?.pubkey;
    
    if (userPubkey !== currentUserPubkey) {
      return [];
    }
    
    // Query for kind 10432 event
    const result = await relayService.queryEvents(
      userPubkey,
      'metadata-read',
      [{ kinds: [CACHE_RELAY_KIND], authors: [userPubkey], limit: 1 }],
      { excludeUserContent: false, currentUserPubkey }
    );
    
    let relays: string[] = [];
    
    if (result.events.length > 0) {
      const event = result.events[0];
      relays = event.tags
        .filter(tag => tag[0] === 'r')
        .map(tag => tag[1])
        .filter(relay => relay && (relay.startsWith('ws://') || relay.startsWith('wss://')));
      
      // Store in contentCache for future use
      await contentCache.storeEvents('kind10432', [{
        event,
        relays: result.relays
      }]);
    }
    
    return relays;
  } catch (error) {
    console.error('Failed to load cache relay URLs:', error);
    return [];
  }
}

/**
 * Get cache relay URLs for the current user
 * Returns array of ws:// relay URLs from kind 10432 events
 */
export async function getCacheRelayUrls(): Promise<string[]> {
  const accountValue = getStore(account);
  if (!accountValue?.pubkey) {
    return [];
  }
  
  return await loadCacheRelayUrls(accountValue.pubkey);
}

/**
 * Get a single cache relay URL (for backward compatibility)
 * Returns the first cache relay URL, or empty string if none
 */
export async function getCacheRelayUrl(): Promise<string> {
  const urls = await getCacheRelayUrls();
  return urls[0] || '';
}

/**
 * Add cache relay to relay sets dynamically
 * This is called to include cache relays in relay lists
 */
export async function addCacheRelayToRelaySets(): Promise<string[]> {
  return await getCacheRelayUrls();
}

/**
 * Save cache relay URLs as a kind 10432 event
 * Creates or updates the user's cache relay list
 */
export async function saveCacheRelayUrls(urls: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const accountValue = getStore(account);
    if (!accountValue?.pubkey) {
      return { success: false, error: 'Not logged in' };
    }

    const { signer } = await import('./nostr');
    const { relayService } = await import('./relayService');
    
    // Validate URLs - must be ws:// addresses
    const validUrls = urls.filter(url => {
      if (!url || typeof url !== 'string') return false;
      return url.startsWith('ws://') || url.startsWith('wss://');
    });

    // Create kind 10432 event
    const eventTemplate = {
      kind: CACHE_RELAY_KIND,
      tags: validUrls.map(url => ['r', url]),
      content: '',
      created_at: Math.round(Date.now() / 1000)
    };

    const signedEvent = await signer.signEvent(eventTemplate);
    
    // Publish to relays
    const result = await relayService.publishEvent(
      accountValue.pubkey,
      'metadata-read', // Use metadata-read relay set for publishing
      signedEvent,
      false // Don't show toast
    );

    if (result.success) {
      // Update cache
      await contentCache.storeEvents('kind10432', [{
        event: signedEvent,
        relays: result.publishedTo
      }]);
      
      return { success: true };
    } else {
      return { success: false, error: 'Failed to publish to relays' };
    }
  } catch (error) {
    console.error('Failed to save cache relay URLs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
