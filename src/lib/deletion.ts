/**
 * Utility functions for creating and handling NIP-09 deletion events (kind 5)
 */

import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
import { get } from 'svelte/store';
import { signer, account } from './nostr';
import { relayService } from './relayService';
import { contentCache } from './contentCache';

/**
 * Create and publish a deletion event (kind 5) for one or more events
 * @param eventIds Array of event IDs to delete
 * @param eventKinds Array of event kinds corresponding to the event IDs (optional, but recommended per NIP-09)
 * @param reason Optional reason for deletion
 * @returns The signed deletion event if successful, null otherwise
 */
export async function createDeletionEvent(
  eventIds: string[],
  eventKinds?: number[],
  reason?: string
): Promise<NostrEvent | null> {
  const currentAccount = get(account);
  if (!currentAccount) {
    console.warn('Cannot create deletion event: no account logged in');
    return null;
  }

  if (eventIds.length === 0) {
    console.warn('Cannot create deletion event: no event IDs provided');
    return null;
  }

  try {
    // Build tags: 'e' tags for event IDs, 'k' tags for kinds (if provided)
    const tags: string[][] = [];
    
    // Add 'e' tags for each event ID
    eventIds.forEach(eventId => {
      tags.push(['e', eventId]);
    });
    
    // Add 'k' tags for each kind (if provided)
    if (eventKinds) {
      eventKinds.forEach(kind => {
        tags.push(['k', kind.toString()]);
      });
    }

    // Create deletion event template
    const deletionTemplate: EventTemplate = {
      kind: 5,
      tags,
      content: reason || '',
      created_at: Math.round(Date.now() / 1000)
    };

    // Sign the event
    const deletion = await signer.signEvent(deletionTemplate);

    // Publish the deletion event
    // Use 'social-write' for kind 5 events (deletion requests)
    const result = await relayService.publishEvent(
      currentAccount.pubkey,
      'social-write',
      deletion
    );

    // Cache the deletion event after publishing
    if (result.success && result.publishedTo.length > 0) {
      // Store deletion events in the deletions cache (persistent)
      await contentCache.storeEvents('deletions', [{
        event: deletion,
        relays: result.publishedTo
      }]);
      
      // Also store in reactions cache for backward compatibility
      await contentCache.storeEvents('reactions', [{
        event: deletion,
        relays: result.publishedTo
      }]);
      
      // Immediately remove the deleted events from cache
      await contentCache.removeDeletedEvents();
    }

    return result.success ? deletion : null;
  } catch (error) {
    console.error('Failed to create deletion event:', error);
    return null;
  }
}
