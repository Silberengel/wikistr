import { pool } from '@nostr/gadgets/global';
import { account } from './nostr';
import { get } from 'svelte/store';

/**
 * Utility functions for filtering deleted events and muted users in relay queries
 */

// Cache for deleted event IDs and muted users
let deletedEvents = new Set<string>();
let mutedUsers = new Set<string>();
let deletionSubscriptions = new Map<string, () => void>();
let muteListSubscriptions = new Map<string, () => void>();

/**
 * Load deletion events (kind 5) to track which events have been deleted
 */
export function loadDeletionEvents(relays: string[]): () => void {
  const cacheKey = relays.sort().join(',');
  
  // Return existing subscription if already loaded
  if (deletionSubscriptions.has(cacheKey)) {
    return deletionSubscriptions.get(cacheKey)!;
  }

  const sub = pool.subscribeMany(
    relays,
    [{ kinds: [5], limit: 1000 }], // Load deletion events
    {
      onevent(deletionEvent) {
        // Extract deleted event IDs from 'e' tags
        deletionEvent.tags.forEach(([tag, value]) => {
          if (tag === 'e' && value) {
            deletedEvents.add(value);
          }
        });
      }
    }
  );

  const unsubscribe = () => {
    sub.close();
    deletionSubscriptions.delete(cacheKey);
  };

  deletionSubscriptions.set(cacheKey, unsubscribe);
  return unsubscribe;
}

/**
 * Load mute lists (kind 10000) to track muted users
 */
export function loadMuteLists(relays: string[]): () => void {
  const cacheKey = relays.sort().join(',');
  
  // Return existing subscription if already loaded
  if (muteListSubscriptions.has(cacheKey)) {
    return muteListSubscriptions.get(cacheKey)!;
  }

  const currentAccount = get(account);
  if (!currentAccount) {
    return () => {}; // No account, no mute list to load
  }

  const sub = pool.subscribeMany(
    relays,
    [{ kinds: [10000], authors: [currentAccount.pubkey], limit: 1 }],
    {
      onevent(muteListEvent) {
        // Extract muted pubkeys from 'p' tags
        muteListEvent.tags.forEach(([tag, value]) => {
          if (tag === 'p' && value) {
            mutedUsers.add(value);
          }
        });
      }
    }
  );

  const unsubscribe = () => {
    sub.close();
    muteListSubscriptions.delete(cacheKey);
  };

  muteListSubscriptions.set(cacheKey, unsubscribe);
  return unsubscribe;
}

/**
 * Check if an event has been deleted
 */
export function isEventDeleted(eventId: string): boolean {
  return deletedEvents.has(eventId);
}

/**
 * Check if a user is muted
 */
export function isUserMuted(pubkey: string): boolean {
  return mutedUsers.has(pubkey);
}

/**
 * Filter out deleted events and events from muted users
 */
export function filterEvents<T extends { id: string; pubkey: string }>(events: T[]): T[] {
  return events.filter(event => 
    !isEventDeleted(event.id) && !isUserMuted(event.pubkey)
  );
}

/**
 * Enhanced relay subscription that automatically filters deleted events and muted users
 */
export function createFilteredSubscription(
  relays: string[],
  filters: any[],
  handlers: {
    onevent?: (event: any) => void;
    oneose?: () => void;
    receivedEvent?: (relay: any, id: string) => void;
    [key: string]: any;
  }
): { close: () => void } {
  // Load deletion events and mute lists for these relays
  const unsubscribeDeletions = loadDeletionEvents(relays);
  const unsubscribeMutes = loadMuteLists(relays);

  // Create the subscription with filtering
  const sub = pool.subscribeMany(relays, filters, {
    ...handlers,
    onevent: (event) => {
      // Filter out deleted events and muted users
      if (isEventDeleted(event.id) || isUserMuted(event.pubkey)) {
        return;
      }
      
      // Call the original onevent handler
      if (handlers.onevent) {
        handlers.onevent(event);
      }
    }
  });

  // Return a closer that also cleans up our subscriptions
  return {
    close: () => {
      sub.close();
      unsubscribeDeletions();
      unsubscribeMutes();
    }
  };
}

/**
 * Clear all cached deletion and mute data
 */
export function clearFilteringCache(): void {
  deletedEvents.clear();
  mutedUsers.clear();
  
  // Close all subscriptions
  deletionSubscriptions.forEach(unsubscribe => unsubscribe());
  muteListSubscriptions.forEach(unsubscribe => unsubscribe());
  
  deletionSubscriptions.clear();
  muteListSubscriptions.clear();
}

/**
 * Initialize filtering for the current account
 */
export function initializeFiltering(): () => void {
  const unsubscribe = account.subscribe((currentAccount) => {
    if (currentAccount) {
      // Clear cache when account changes
      clearFilteringCache();
    }
  });

  return () => {
    unsubscribe();
    clearFilteringCache();
  };
}
