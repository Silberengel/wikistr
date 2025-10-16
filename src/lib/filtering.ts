import { account } from './nostr';
import { relayService } from './relayService';
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
export async function loadDeletionEvents(relays: string[]): Promise<void> {
  const cacheKey = relays.sort().join(',');
  
  // Return if already loaded
  if (deletionSubscriptions.has(cacheKey)) {
    return;
  }

  try {
    const result = await relayService.queryEvents(
      'anonymous',
      'social-read',
      [{ kinds: [5], limit: 1000 }], // Load deletion events
      {
        excludeUserContent: false,
        currentUserPubkey: undefined
      }
    );

    // Extract deleted event IDs from 'e' tags
    result.events.forEach(deletionEvent => {
      deletionEvent.tags.forEach(([tag, value]) => {
        if (tag === 'e' && value) {
          deletedEvents.add(value);
        }
      });
    });

    const unsubscribe = () => {
      deletionSubscriptions.delete(cacheKey);
    };

    deletionSubscriptions.set(cacheKey, unsubscribe);
  } catch (error) {
    console.error('Failed to load deletion events:', error);
  }
}

/**
 * Load mute lists (kind 10000) to track muted users
 */
export async function loadMuteLists(relays: string[]): Promise<void> {
  const cacheKey = relays.sort().join(',');
  
  // Return if already loaded
  if (muteListSubscriptions.has(cacheKey)) {
    return;
  }

  const currentAccount = get(account);
  if (!currentAccount) {
    return; // No account, no mute list to load
  }

  try {
    const result = await relayService.queryEvents(
      currentAccount.pubkey,
      'social-read',
      [{ kinds: [10000], authors: [currentAccount.pubkey], limit: 1 }],
      {
        excludeUserContent: false,
        currentUserPubkey: currentAccount.pubkey
      }
    );

    // Extract muted pubkeys from 'p' tags
    result.events.forEach(muteListEvent => {
      muteListEvent.tags.forEach(([tag, value]) => {
        if (tag === 'p' && value) {
          mutedUsers.add(value);
        }
      });
    });

    const unsubscribe = () => {
      muteListSubscriptions.delete(cacheKey);
    };

    muteListSubscriptions.set(cacheKey, unsubscribe);
  } catch (error) {
    console.error('Failed to load mute lists:', error);
  }
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
 * Filter out events from the current user (except when viewing own content)
 */
export function filterUserEvents<T extends { id: string; pubkey: string }>(events: T[], currentUserPubkey?: string, showUserContent = false): T[] {
  if (!currentUserPubkey || showUserContent) {
    return events;
  }
  
  return events.filter(event => event.pubkey !== currentUserPubkey);
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
