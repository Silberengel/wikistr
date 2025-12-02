/**
 * Utility functions for creating and handling NIP-09 deletion events (kind 5)
 */

import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
import { get } from 'svelte/store';
import { signer, account } from './nostr';
import { relayService } from './relayService';
import { contentCache } from './contentCache';

export interface DeletionResult {
  deletion: NostrEvent;
  publishedTo: string[];
  failedRelays: string[];
}

/**
 * Create and publish a deletion event (kind 5) for one or more events
 * @param eventIds Array of event IDs to delete
 * @param eventKinds Array of event kinds corresponding to the event IDs (optional, but recommended per NIP-09)
 * @param reason Optional reason for deletion
 * @returns The deletion result with event and relay info if successful, null otherwise
 */
export async function createDeletionEvent(
  eventIds: string[],
  eventKinds?: number[],
  reason?: string
): Promise<DeletionResult | null> {
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
    console.log(`Publishing deletion event for ${eventIds.length} event(s)...`);
    const result = await relayService.publishEvent(
      currentAccount.pubkey,
      'social-write',
      deletion
    );

    if (result.success) {
      console.log(`Deletion event published successfully to ${result.publishedTo.length} relay(s):`, result.publishedTo);
      
      // Tombstone all deleted event IDs to prevent them from being re-added
      if (result.publishedTo.length > 0) {
        console.log(`🗿 Tombstoning ${eventIds.length} deleted event ID(s)...`);
        
        for (const eventId of eventIds) {
          await contentCache.tombstoneEvent(eventId);
        }
        
        console.log(`✅ Tombstoned ${eventIds.length} event ID(s) (events removed from cache and prevented from being re-added)`);
        
        // Dispatch event to trigger feed refresh in Welcome card and Cache Browser
        // This ensures all UI components that display cached events are updated
        window.dispatchEvent(new CustomEvent('wikistr:cache-updated', { 
          detail: { deletedEventIds: eventIds } 
        }));
      }
      
      return {
        deletion,
        publishedTo: result.publishedTo,
        failedRelays: result.failedRelays || []
      };
    } else {
      console.error('Failed to publish deletion event:', result);
      return null;
    }
  } catch (error) {
    console.error('Failed to create deletion event:', error);
    return null;
  }
}
