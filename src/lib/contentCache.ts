/**
 * Comprehensive Content Cache Manager
 * Handles IndexedDB caching for all content types with smart invalidation
 */

import * as idbkv from 'idb-keyval';
import type { Event, NostrEvent } from '@nostr/tools/pure';

// Create a custom store for better visibility in browser dev tools
const store = idbkv.createStore('wikistr-cache', 'content-store');

// Cache configuration
const CACHE_KEYS = {
  publications: 'wikistr:cache:publications',  // 30040, 30041
  longform: 'wikistr:cache:longform',        // 30023
  wikis: 'wikistr:cache:wikis',             // 30817, 30818
  reactions: 'wikistr:cache:reactions',      // Reactions (kind 7) and deletions (kind 5)
  kind1111: 'wikistr:cache:kind1111',
  kind10002: 'wikistr:cache:kind10002',
  kind10432: 'wikistr:cache:kind10432',
  profile: 'wikistr:cache:profile',  // Profile metadata (kind 0, 10133)
  deletions: 'wikistr:cache:deletions'  // Deletion events (kind 5) - persistent
} as const;

// Cache expiration times (in milliseconds)
const CACHE_EXPIRY = {
  publications: 10 * 60 * 1000,  // 10 minutes (30040, 30041)
  longform: 5 * 60 * 1000,       // 5 minutes (30023)
  wikis: 5 * 60 * 1000,          // 5 minutes (30817, 30818)
  reactions: 2 * 60 * 1000,   // 2 minutes  
  kind1111: 5 * 60 * 1000,    // 5 minutes
  kind10002: 60 * 60 * 1000,  // 1 hour (relay lists change infrequently)
  kind10432: 60 * 60 * 1000,  // 1 hour (cache relay lists change infrequently)
  profile: 30 * 60 * 1000,    // 30 minutes (profile metadata: kind 0, 10133)
  deletions: Infinity  // Deletion events never expire (persistent)
} as const;

interface CachedEvent {
  event: Event;
  relays: string[];
  cachedAt: number;
}

interface ContentCache {
  publications: Map<string, CachedEvent>;   // 30040, 30041
  longform: Map<string, CachedEvent>;       // 30023
  wikis: Map<string, CachedEvent>;          // 30817, 30818
  reactions: Map<string, CachedEvent>;
  kind1111: Map<string, CachedEvent>;
  kind10002: Map<string, CachedEvent>;
  kind10432: Map<string, CachedEvent>;
  profile: Map<string, CachedEvent>;  // Profile metadata (kind 0, 10133)
  deletions: Map<string, CachedEvent>;  // Deletion events (kind 5) - persistent
}

class ContentCacheManager {
  private cache: ContentCache = {
    publications: new Map(),   // 30040, 30041
    longform: new Map(),      // 30023
    wikis: new Map(),         // 30817, 30818
    reactions: new Map(),
    kind1111: new Map(),
    kind10002: new Map(),
    kind10432: new Map(),
    profile: new Map(),  // Profile metadata (kind 0, 10133)
    deletions: new Map()  // Deletion events (kind 5) - persistent
  };

  private loaded = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Ensure cache is initialized (waits if already initializing)
   */
  async ensureInitialized(): Promise<void> {
    if (this.loaded) return;
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    this.initializationPromise = this.initialize();
    return this.initializationPromise;
  }

  /**
   * Initialize cache by loading from IndexedDB
   */
  async initialize(): Promise<void> {
    if (this.loaded) return;

    try {
      // Load all content types in parallel
      const [
        publicationsData,
        longformData,
        wikisData,
        reactionsData,
        kind1111Data,
        kind10002Data,
        kind10432Data,
        profileData,
        deletionsData
      ] = await Promise.all([
        idbkv.get(CACHE_KEYS.publications, store),
        idbkv.get(CACHE_KEYS.longform, store),
        idbkv.get(CACHE_KEYS.wikis, store),
        idbkv.get(CACHE_KEYS.reactions, store),
        idbkv.get(CACHE_KEYS.kind1111, store),
        idbkv.get(CACHE_KEYS.kind10002, store),
        idbkv.get(CACHE_KEYS.kind10432, store),
        idbkv.get(CACHE_KEYS.profile, store),
        idbkv.get(CACHE_KEYS.deletions, store)
      ]);

      // Restore Maps from serialized data
      this.cache.publications = new Map(publicationsData || []);
      this.cache.longform = new Map(longformData || []);
      this.cache.wikis = new Map(wikisData || []);
      this.cache.reactions = new Map(reactionsData || []);
      this.cache.kind1111 = new Map(kind1111Data || []);
      this.cache.kind10002 = new Map(kind10002Data || []);
      this.cache.kind10432 = new Map(kind10432Data || []);
      this.cache.profile = new Map(profileData || []);
      this.cache.deletions = new Map(deletionsData || []);
      
      // After loading, remove events that have deletion requests
      await this.removeDeletedEvents();

      this.loaded = true;

    } catch (error) {
      console.error('❌ Failed to load content cache:', error);
      this.loaded = true; // Mark as loaded to prevent retries
    }
  }

  /**
   * Remove a specific event by ID from all caches
   * Also handles cache keys for addressable/replaceable events
   */
  async removeEventById(eventId: string, eventKind?: number, eventPubkey?: string, dTag?: string): Promise<void> {
    try {
      await this.ensureInitialized();
      
      const cacheTypes: Array<keyof ContentCache> = [
        'publications', 'longform', 'wikis', 'reactions', 
        'kind1111', 'kind10002', 'kind10432', 'profile'
      ];
      
      let removed = false;
      
      for (const contentType of cacheTypes) {
        // First, try to find the event by ID in all entries
        let foundKey: string | null = null;
        for (const [id, cached] of this.cache[contentType].entries()) {
          if (cached.event.id === eventId) {
            foundKey = id;
            break;
          }
        }
        
        // If not found by ID and we have event metadata, try cache key formats
        if (!foundKey && eventKind !== undefined && eventPubkey) {
          const kind = eventKind;
          const isAddressable = kind >= 30000 && kind < 40000;
          const isReplaceable = (kind >= 10000 && kind < 20000) || kind === 0 || kind === 3;
          
          if (isAddressable && dTag) {
            // Try addressable cache key: kind:pubkey:d-tag
            const cacheKey = `${kind}:${eventPubkey}:${dTag}`;
            if (this.cache[contentType].has(cacheKey)) {
              const cached = this.cache[contentType].get(cacheKey);
              if (cached && cached.event.id === eventId) {
                foundKey = cacheKey;
              }
            }
          } else if (isReplaceable) {
            // Try replaceable cache key: kind:pubkey
            const cacheKey = `${kind}:${eventPubkey}`;
            if (this.cache[contentType].has(cacheKey)) {
              const cached = this.cache[contentType].get(cacheKey);
              if (cached && cached.event.id === eventId) {
                foundKey = cacheKey;
              }
            }
          }
        }
        
        // If found, remove it
        if (foundKey) {
          this.cache[contentType].delete(foundKey);
          removed = true;
          // Persist changes to IndexedDB
          try {
            const entries = Array.from(this.cache[contentType].entries());
            await idbkv.set(CACHE_KEYS[contentType], entries, store);
            console.log(`Removed event ${eventId.slice(0, 8)}... from ${contentType} cache (key: ${foundKey}), persisted ${entries.length} remaining entries to IndexedDB`);
            
            // Verify persistence by reading back
            const verify = await idbkv.get(CACHE_KEYS[contentType], store);
            if (verify) {
              const verifyMap = new Map(verify);
              if (verifyMap.has(foundKey)) {
                console.warn(`⚠️ Event ${eventId.slice(0, 8)}... still found in IndexedDB after removal!`);
              } else {
                console.log(`✅ Verified: Event ${eventId.slice(0, 8)}... removed from IndexedDB`);
              }
            }
          } catch (persistError) {
            console.error(`Failed to persist cache removal for ${contentType}:`, persistError);
            throw persistError; // Re-throw to ensure we know about persistence failures
          }
        }
      }
      
      if (removed) {
        console.log(`Successfully removed event ${eventId.slice(0, 8)}... from cache`);
      } else {
        console.log(`Event ${eventId.slice(0, 8)}... not found in cache (may have been already removed or stored under different key)`);
      }
    } catch (error) {
      console.error('Failed to remove event from cache:', error);
    }
  }

  /**
   * Remove events that have deletion requests (kind 5 events)
   * This is called on startup to ensure deleted events are removed from cache
   */
  async removeDeletedEvents(): Promise<void> {
    try {
      // Get all deletion events (kind 5) from the deletions cache and reactions cache
      const deletionEvents: NostrEvent[] = [];
      
      // Check deletions cache
      for (const cached of this.cache.deletions.values()) {
        if (cached.event.kind === 5) {
          deletionEvents.push(cached.event as NostrEvent);
        }
      }
      
      // Also check reactions cache for deletion events (for backward compatibility)
      for (const cached of this.cache.reactions.values()) {
        if (cached.event.kind === 5) {
          deletionEvents.push(cached.event as NostrEvent);
        }
      }
      
      if (deletionEvents.length === 0) {
        return; // No deletion events found
      }
      
      // Collect all deleted event IDs from 'e' tags in deletion events
      const deletedEventIds = new Set<string>();
      deletionEvents.forEach(deletionEvent => {
        deletionEvent.tags.forEach(([tag, value]) => {
          if (tag === 'e' && value) {
            deletedEventIds.add(value);
          }
        });
      });
      
      if (deletedEventIds.size === 0) {
        return; // No event IDs to remove
      }
      
      let totalRemoved = 0;
      
      // Remove deleted events from all caches
      const cacheTypes: Array<keyof ContentCache> = [
        'publications', 'longform', 'wikis', 'reactions', 
        'kind1111', 'kind10002', 'kind10432', 'profile'
      ];
      
      for (const contentType of cacheTypes) {
        const originalSize = this.cache[contentType].size;
        const keysToRemove: string[] = [];
        
        // Collect keys to remove first (can't modify map while iterating)
        for (const [id, cached] of this.cache[contentType].entries()) {
          // Check if this event ID is in the deleted set
          if (deletedEventIds.has(cached.event.id)) {
            keysToRemove.push(id);
            totalRemoved++;
          }
        }
        
        // Remove collected keys
        for (const key of keysToRemove) {
          this.cache[contentType].delete(key);
        }
        
        // Persist changes if any were made
        if (keysToRemove.length > 0) {
          try {
            const entries = Array.from(this.cache[contentType].entries());
            await idbkv.set(CACHE_KEYS[contentType], entries, store);
            console.log(`Persisted ${contentType} cache: removed ${keysToRemove.length} deleted events, ${entries.length} remaining`);
          } catch (error) {
            console.error(`Failed to persist ${contentType} cache after removing deleted events:`, error);
          }
        }
      }
      
      if (totalRemoved > 0) {
        console.log(`🗑️ Removed ${totalRemoved} deleted events from cache on startup`);
      }
    } catch (error) {
      console.error('❌ Failed to remove deleted events from cache:', error);
    }
  }

  /**
   * Get cached events for a specific content type
   * Events with d-tags (articles/publications) never expire and are always returned
   */
  getEvents(contentType: keyof ContentCache): CachedEvent[] {
    // Ensure cache is initialized (non-blocking check)
    if (!this.loaded && !this.initializationPromise) {
      this.ensureInitialized().catch(console.error);
    }
    // Safety check: ensure cache map exists
    if (!this.cache[contentType]) {
      this.cache[contentType] = new Map();
    }
    const cachedEvents = Array.from(this.cache[contentType].values());
    
    // Filter out expired events, but preserve events with d-tags (articles/publications)
    const now = Date.now();
    const expiry = CACHE_EXPIRY[contentType];
    
    return cachedEvents.filter(cached => {
      // Deletion events (kind 5) never expire
      if (cached.event.kind === 5) {
        return true;
      }
      // Events with d-tags never expire
      const dTag = cached.event.tags.find(([k]) => k === 'd')?.[1];
      if (dTag) {
        return true; // Always return events with d-tags
      }
      // For events without d-tags, check expiry
      return (now - cached.cachedAt) < expiry;
    });
  }

  /**
   * Check if cache is fresh for a content type
   */
  isCacheFresh(contentType: keyof ContentCache): boolean {
    const cachedEvents = this.getEvents(contentType);
    if (cachedEvents.length === 0) return false;
    
    // Check if any events are still within the expiry time
    const now = Date.now();
    const expiryTime = CACHE_EXPIRY[contentType];
    
    const hasFreshEvents = cachedEvents.some(cached => {
      const age = now - cached.cachedAt;
      return age < expiryTime;
    });
    
    return hasFreshEvents;
  }

  /**
   * Serialize an event to ensure it's IndexedDB-compatible
   * Extracts only the serializable properties from the event
   */
  private serializeEvent(event: Event): Event {
    return {
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags ? event.tags.map(tag => [...tag]) : [],
      content: event.content || '',
      sig: event.sig
    };
  }

  /**
   * Store events in cache
   * For replaceable events (publications, longform, wikis, etc.), deduplicate by a-tag (kind:pubkey:d-tag) and keep only the newest
   */
  async storeEvents(
    contentType: keyof ContentCache,
    events: { event: Event; relays: string[] }[]
  ): Promise<void> {
    // Ensure cache is initialized before storing
    await this.ensureInitialized();
    // Safety check: ensure cache map exists
    if (!this.cache[contentType]) {
      this.cache[contentType] = new Map();
    }
    try {
      const now = Date.now();
      
      // Cache key logic based on NIP specification:
      // - Regular (1000 <= n < 10000 || 4 <= n < 45 || n == 1 || n == 2): use event.id
      // - Replaceable (10000 <= n < 20000 || n == 0 || n == 3): use kind:pubkey
      // - Ephemeral (20000 <= n < 30000): use event.id (not expected to be stored, but we cache them)
      // - Addressable (30000 <= n < 40000): use kind:pubkey:d-tag
      const isReplaceable = contentType === 'publications' || contentType === 'longform' || contentType === 'wikis' || contentType === 'kind1111' || contentType === 'kind10002' || contentType === 'kind10432' || contentType === 'profile';
      
      // Merge new events with existing cache, preventing duplicates
      events.forEach(({ event, relays }) => {
        // Serialize event to ensure it's IndexedDB-compatible
        const serializedEvent = this.serializeEvent(event);
        let cacheKey = serializedEvent.id;
        
        const kind = serializedEvent.kind;
        
        // Determine event type based on NIP specification
        const isRegular = (kind >= 1000 && kind < 10000) || (kind >= 4 && kind < 45) || kind === 2;
        const isReplaceableKind = (kind >= 10000 && kind < 20000) || kind === 0 || kind === 3;
        const isEphemeral = kind >= 20000 && kind < 30000;
        const isAddressable = kind >= 30000 && kind < 40000;
        
        if (isReplaceableKind) {
          // Replaceable events: use kind:pubkey as key
          // Only the latest event for each (kind, pubkey) combination is kept
          cacheKey = `${kind}:${serializedEvent.pubkey}`;
          
          // Check if we already have a version of this replaceable event
          const existing = this.cache[contentType].get(cacheKey);
          if (existing) {
            // Keep only the newest version (by created_at)
            if (serializedEvent.created_at > existing.event.created_at) {
              // Newer version - replace it
              this.cache[contentType].set(cacheKey, {
                event: serializedEvent,
                relays,
                cachedAt: now
              });
            } else {
              // Older version - just merge relays if needed
              existing.relays = [...new Set([...existing.relays, ...relays])];
              existing.cachedAt = now;
            }
            return;
          }
        } else if (isAddressable) {
          // Addressable events: use kind:pubkey:d-tag as key
          // Only the latest event for each (kind, pubkey, d-tag) combination is kept
          const dTag = serializedEvent.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) {
            cacheKey = `${kind}:${serializedEvent.pubkey}:${dTag}`;
            
            // Check if we already have a version of this addressable event
            const existing = this.cache[contentType].get(cacheKey);
            if (existing) {
              // Keep only the newest version (by created_at)
              if (serializedEvent.created_at > existing.event.created_at) {
                // Newer version - replace it
                this.cache[contentType].set(cacheKey, {
                  event: serializedEvent,
                  relays,
                  cachedAt: now
                });
              } else {
                // Older version - just merge relays if needed
                existing.relays = [...new Set([...existing.relays, ...relays])];
                existing.cachedAt = now;
              }
              return;
            }
          }
          // If addressable event has no d-tag, fall through to use event.id
        }
        // For regular and ephemeral events, use event.id (already set above)
        
        // For non-replaceable events or events without d-tag, use event.id
        const existing = this.cache[contentType].get(cacheKey);
        if (existing) {
          // Merge relays and update timestamp
          existing.relays = [...new Set([...existing.relays, ...relays])];
          existing.cachedAt = now;
        } else {
          // Store new event
          this.cache[contentType].set(cacheKey, {
            event: serializedEvent,
            relays,
            cachedAt: now
          });
        }
      });

      // Persist to IndexedDB
      await idbkv.set(CACHE_KEYS[contentType], Array.from(this.cache[contentType].entries()), store);
      
      // If storing a deletion event (kind 5), also store it in the deletions cache
      events.forEach(({ event }) => {
        if (event.kind === 5) {
          const deletionKey = event.id;
          this.cache.deletions.set(deletionKey, {
            event: this.serializeEvent(event),
            relays: events.find(e => e.event.id === event.id)?.relays || [],
            cachedAt: now
          });
        }
      });
      
      // Persist deletions cache if we added any
      if (events.some(({ event }) => event.kind === 5)) {
        await idbkv.set(CACHE_KEYS.deletions, Array.from(this.cache.deletions.entries()), store);
      }

    } catch (error) {
      console.error(`❌ Failed to cache ${contentType} events:`, error);
    }
  }

  /**
   * Get specific event by ID or cache key
   * Cache key formats:
   * - Replaceable (10000 <= n < 20000 || n == 0 || n == 3): kind:pubkey
   * - Addressable (30000 <= n < 40000): kind:pubkey:d-tag
   * - Regular/Ephemeral: event.id
   */
  getEvent(contentType: keyof ContentCache, eventId: string): CachedEvent | undefined {
    // Ensure cache is initialized (non-blocking check)
    if (!this.loaded && !this.initializationPromise) {
      this.ensureInitialized().catch(console.error);
    }
    // Safety check: ensure cache map exists
    if (!this.cache[contentType]) {
      this.cache[contentType] = new Map();
    }
    // First try direct lookup (works for event.id or cache keys)
    const direct = this.cache[contentType].get(eventId);
    if (direct) return direct;
    
    // If eventId contains colons, it might be a cache key format
    if (eventId.includes(':')) {
      const parts = eventId.split(':');
      
      // Try kind:pubkey format (replaceable events: 10000-19999, 0, 3)
      if (parts.length === 2) {
        const [kindStr, pubkey] = parts;
        const kindNum = parseInt(kindStr);
        if (!isNaN(kindNum)) {
          const key = `${kindNum}:${pubkey}`;
          const found = this.cache[contentType].get(key);
          if (found) return found;
        }
      }
      
      // Try kind:pubkey:d-tag format (addressable events: 30000-39999)
      if (parts.length === 3) {
        const [kindStr, pubkey, dTag] = parts;
        const kindNum = parseInt(kindStr);
        if (!isNaN(kindNum)) {
          const key = `${kindNum}:${pubkey}:${dTag}`;
          const found = this.cache[contentType].get(key);
          if (found) return found;
        }
      }
    }
    
    // Fallback: search all entries by event.id (for regular/ephemeral events or if cache key lookup failed)
    for (const cached of this.cache[contentType].values()) {
      if (cached.event.id === eventId) {
        return cached;
      }
    }
    
    return undefined;
  }

  /**
   * Get all unique relays from cache
   */
  getAllRelays(): string[] {
    const relaySet = new Set<string>();
    
    Object.values(this.cache).forEach(map => {
      map.forEach((cached: CachedEvent) => {
        cached.relays.forEach((relay: string) => relaySet.add(relay));
      });
    });

    return Array.from(relaySet);
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    try {
      Object.values(this.cache).forEach(map => map.clear());
      
      await Promise.all([
        idbkv.del(CACHE_KEYS.publications, store),
        idbkv.del(CACHE_KEYS.longform, store),
        idbkv.del(CACHE_KEYS.wikis, store),
        idbkv.del(CACHE_KEYS.reactions, store),
        idbkv.del(CACHE_KEYS.kind1111, store),
        idbkv.del(CACHE_KEYS.kind10002, store),
        idbkv.del(CACHE_KEYS.kind10432, store),
        idbkv.del(CACHE_KEYS.profile, store),
        idbkv.del(CACHE_KEYS.deletions, store)
      ]);

      console.log('🗑️ Cleared all content caches');
    } catch (error) {
      console.error('❌ Failed to clear caches:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { [key: string]: { count: number; fresh: boolean } } {
    const stats: { [key: string]: { count: number; fresh: boolean } } = {};
    
    (Object.keys(this.cache) as Array<keyof ContentCache>).forEach(contentType => {
      const events = this.getEvents(contentType);
      stats[contentType] = {
        count: events.length,
        fresh: this.isCacheFresh(contentType)
      };
    });

    return stats;
  }

  /**
   * Clean up expired events
   * Preserves bookmarked items and items with reading places (persistent cache)
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      let totalCleaned = 0;

      // Import bookmarks module to check for bookmarked items
      const { getBookmarks, getReadingPlaces } = await import('./bookmarks');
      
      // Get all bookmarked events and reading places
      const bookmarks = await getBookmarks().catch(() => []);
      const readingPlaces = await getReadingPlaces().catch(() => []);
      
      // Create sets for quick lookup
      const bookmarkedATags = new Set(
        bookmarks.map(event => {
          const dTag = event.tags.find(([k]) => k === 'd')?.[1] || '';
          return `${event.kind}:${event.pubkey}:${dTag}`;
        })
      );
      const eventIdsWithReadingPlaces = new Set(readingPlaces.map(rp => rp.eventId));

      (Object.keys(this.cache) as Array<keyof ContentCache>).forEach(contentType => {
        const expiry = CACHE_EXPIRY[contentType];
        const originalSize = this.cache[contentType].size;
        
        // Remove expired events, but preserve:
        // 1. Events with d-tags (articles and publications - never expire)
        // 2. Bookmarked items
        // 3. Items with reading places
        for (const [id, cached] of this.cache[contentType].entries()) {
          const event = cached.event;
          const age = now - cached.cachedAt;
          
          // Skip if within expiry time
          if (age <= expiry) {
            continue;
          }
          
          // Check if event has a d-tag - these are articles/publications and should NEVER expire
          const dTag = event.tags.find(([k]) => k === 'd')?.[1];
          const hasDTag = !!dTag;
          
          // Check if this event is bookmarked
          // For events with d-tags, use a-tag format (kind:pubkey:d-tag)
          // For events without d-tags (like some 30040), use event ID
          let isBookmarked = false;
          if (dTag) {
            const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
            isBookmarked = bookmarkedATags.has(aTag);
          } else {
            // For events without d-tags, check if any bookmarked event matches by ID
            isBookmarked = bookmarks.some(b => b.id === event.id);
          }
          
          // Check if this event has a reading place
          const hasReadingPlace = eventIdsWithReadingPlaces.has(event.id);
          
          // Only remove if expired AND no d-tag AND not bookmarked AND no reading place
          // Events with d-tags (articles/publications) are NEVER removed
          if (!hasDTag && !isBookmarked && !hasReadingPlace) {
            this.cache[contentType].delete(id);
            totalCleaned++;
          } else {
            // Update cachedAt for preserved items to extend their lifetime
            cached.cachedAt = now;
          }
        }

        // Persist cleaned cache
        idbkv.set(CACHE_KEYS[contentType], Array.from(this.cache[contentType].entries()), store);
        
        if (this.cache[contentType].size < originalSize) {
          console.log(`🧹 Cleaned ${originalSize - this.cache[contentType].size} expired ${contentType} events`);
        }
      });

      if (totalCleaned > 0) {
        console.log(`🧹 Total cleanup: ${totalCleaned} expired events removed (bookmarked items preserved)`);
      }

    } catch (error) {
      console.error('❌ Failed to cleanup cache:', error);
    }
  }
}

// Export singleton instance
export const contentCache = new ContentCacheManager();

// Initialize cache on import
contentCache.initialize().then(() => {
  // Clean up expired events after initialization
  // This removes expired entries from IndexedDB on app startup
  contentCache.cleanup().catch(console.error);
}).catch(console.error);
