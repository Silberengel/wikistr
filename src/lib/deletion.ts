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
      
      // Cache the deletion event after publishing
      if (result.publishedTo.length > 0) {
        console.log(`Storing deletion event ${deletion.id.slice(0, 8)}... in deletions cache`);
        
        // Store deletion events in the deletions cache (persistent)
        await contentCache.storeEvents('deletions', [{
          event: deletion,
          relays: result.publishedTo
        }]);
        
        // Verify deletion event was stored
        const storedDeletions = contentCache.getEvents('deletions');
        const storedDeletion = storedDeletions.find(c => c.event.id === deletion.id);
        if (storedDeletion) {
          console.log(`✅ Deletion event ${deletion.id.slice(0, 8)}... stored in deletions cache`);
        } else {
          console.warn(`⚠️ Deletion event ${deletion.id.slice(0, 8)}... not found in deletions cache after storing`);
        }
        
        // Also store in reactions cache for backward compatibility
        await contentCache.storeEvents('reactions', [{
          event: deletion,
          relays: result.publishedTo
        }]);
        
        // Immediately remove the deleted events from cache
        // We need to find the events first to get their metadata (for addressable events)
        for (const eventId of eventIds) {
          console.log(`Removing event ${eventId.slice(0, 8)}... from cache`);
          
          // Try to find the event in cache to get its metadata
          let foundEvent: { event: any; kind?: number; pubkey?: string; dTag?: string } | null = null;
          
          // Check all relevant caches
          const cacheTypes: Array<'publications' | 'longform' | 'wikis'> = ['publications', 'longform', 'wikis'];
          for (const cacheType of cacheTypes) {
            const cachedEvents = contentCache.getEvents(cacheType);
            const cached = cachedEvents.find(c => c.event.id === eventId);
            if (cached) {
              foundEvent = {
                event: cached.event,
                kind: cached.event.kind,
                pubkey: cached.event.pubkey,
                dTag: cached.event.tags.find(([t]) => t === 'd')?.[1]
              };
              console.log(`Found event ${eventId.slice(0, 8)}... in ${cacheType} cache (kind: ${foundEvent.kind}, pubkey: ${foundEvent.pubkey?.slice(0, 8)}..., dTag: ${foundEvent.dTag || 'none'})`);
              break;
            }
          }
          
          // Remove with metadata if found, otherwise try without
          if (foundEvent) {
            await contentCache.removeEventById(
              eventId,
              foundEvent.kind,
              foundEvent.pubkey,
              foundEvent.dTag
            );
          } else {
            console.log(`Event ${eventId.slice(0, 8)}... not found in cache, trying with provided metadata`);
            // Fallback: try with provided metadata
            await contentCache.removeEventById(
              eventId,
              eventKinds?.[0],
              currentAccount.pubkey
            );
          }
        }
        
        // Also run the general cleanup to ensure everything is removed
        await contentCache.removeDeletedEvents();
        
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
