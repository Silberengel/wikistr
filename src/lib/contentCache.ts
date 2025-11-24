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
  wiki: 'wikistr:cache:wiki',
  reactions: 'wikistr:cache:reactions', 
  deletes: 'wikistr:cache:deletes',
  kind1: 'wikistr:cache:kind1',
  kind1111: 'wikistr:cache:kind1111',
  kind30041: 'wikistr:cache:kind30041',
  kind10002: 'wikistr:cache:kind10002',
  metadata: 'wikistr:cache:metadata',
  bookConfigs: 'wikistr:cache:bookconfigs',
  cacheInfo: 'wikistr:cache:info'
} as const;

// Cache expiration times (in milliseconds)
const CACHE_EXPIRY = {
  wiki: 5 * 60 * 1000,        // 5 minutes
  reactions: 2 * 60 * 1000,   // 2 minutes  
  deletes: 10 * 60 * 1000,    // 10 minutes
  kind1: 5 * 60 * 1000,       // 5 minutes
  kind1111: 5 * 60 * 1000,    // 5 minutes
  kind30041: 10 * 60 * 1000,  // 10 minutes
  kind10002: 60 * 60 * 1000,  // 1 hour (relay lists change infrequently)
  metadata: 30 * 60 * 1000,   // 30 minutes
  bookConfigs: 60 * 60 * 1000 // 1 hour
} as const;

interface CachedEvent {
  event: Event;
  relays: string[];
  cachedAt: number;
}

interface CacheInfo {
  lastUpdate: number;
  totalEvents: number;
  relayCount: number;
}

interface ContentCache {
  wiki: Map<string, CachedEvent>;
  reactions: Map<string, CachedEvent>;
  deletes: Map<string, CachedEvent>;
  kind1: Map<string, CachedEvent>;
  kind1111: Map<string, CachedEvent>;
  kind30041: Map<string, CachedEvent>;
  kind10002: Map<string, CachedEvent>;
  metadata: Map<string, CachedEvent>;
  bookConfigs: Map<string, CachedEvent>;
}

class ContentCacheManager {
  private cache: ContentCache = {
    wiki: new Map(),
    reactions: new Map(),
    deletes: new Map(),
    kind1: new Map(),
    kind1111: new Map(),
    kind30041: new Map(),
    kind10002: new Map(),
    metadata: new Map(),
    bookConfigs: new Map()
  };

  private loaded = false;

  /**
   * Initialize cache by loading from IndexedDB
   */
  async initialize(): Promise<void> {
    if (this.loaded) return;

    try {
      // Load all content types in parallel
      const [
        wikiData,
        reactionsData,
        deletesData,
        kind1Data,
        kind1111Data,
        kind30041Data,
        kind10002Data,
        metadataData,
        bookConfigsData
      ] = await Promise.all([
        idbkv.get(CACHE_KEYS.wiki, store),
        idbkv.get(CACHE_KEYS.reactions, store),
        idbkv.get(CACHE_KEYS.deletes, store),
        idbkv.get(CACHE_KEYS.kind1, store),
        idbkv.get(CACHE_KEYS.kind1111, store),
        idbkv.get(CACHE_KEYS.kind30041, store),
        idbkv.get(CACHE_KEYS.kind10002, store),
        idbkv.get(CACHE_KEYS.metadata, store),
        idbkv.get(CACHE_KEYS.bookConfigs, store)
      ]);

      // Restore Maps from serialized data
      this.cache.wiki = new Map(wikiData || []);
      this.cache.reactions = new Map(reactionsData || []);
      this.cache.deletes = new Map(deletesData || []);
      this.cache.kind1 = new Map(kind1Data || []);
      this.cache.kind1111 = new Map(kind1111Data || []);
      this.cache.kind30041 = new Map(kind30041Data || []);
      this.cache.kind10002 = new Map(kind10002Data || []);
      this.cache.metadata = new Map(metadataData || []);
      this.cache.bookConfigs = new Map(bookConfigsData || []);

      this.loaded = true;

    } catch (error) {
      console.error('❌ Failed to load content cache:', error);
      this.loaded = true; // Mark as loaded to prevent retries
    }
  }

  /**
   * Get cached events for a specific content type
   */
  getEvents(contentType: keyof ContentCache): CachedEvent[] {
    const cachedEvents = Array.from(this.cache[contentType].values());
    
    // Filter out expired events
    const now = Date.now();
    const expiry = CACHE_EXPIRY[contentType];
    
    return cachedEvents.filter(cached => (now - cached.cachedAt) < expiry);
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
   * Store events in cache
   * For replaceable events (wiki, kind30041, etc.), deduplicate by a-tag (kind:pubkey:d-tag) and keep only the newest
   */
  async storeEvents(
    contentType: keyof ContentCache,
    events: { event: Event; relays: string[] }[]
  ): Promise<void> {
    try {
      const now = Date.now();
      
      // Cache key logic based on NIP specification:
      // - Regular (1000 <= n < 10000 || 4 <= n < 45 || n == 1 || n == 2): use event.id
      // - Replaceable (10000 <= n < 20000 || n == 0 || n == 3): use kind:pubkey
      // - Ephemeral (20000 <= n < 30000): use event.id (not expected to be stored, but we cache them)
      // - Addressable (30000 <= n < 40000): use kind:pubkey:d-tag
      const isReplaceable = contentType === 'wiki' || contentType === 'kind30041' || contentType === 'kind1111' || contentType === 'kind10002' || contentType === 'metadata';
      
      // Merge new events with existing cache, preventing duplicates
      events.forEach(({ event, relays }) => {
        let cacheKey = event.id;
        
        const kind = event.kind;
        
        // Determine event type based on NIP specification
        const isRegular = (kind >= 1000 && kind < 10000) || (kind >= 4 && kind < 45) || kind === 1 || kind === 2;
        const isReplaceableKind = (kind >= 10000 && kind < 20000) || kind === 0 || kind === 3;
        const isEphemeral = kind >= 20000 && kind < 30000;
        const isAddressable = kind >= 30000 && kind < 40000;
        
        if (isReplaceableKind) {
          // Replaceable events: use kind:pubkey as key
          // Only the latest event for each (kind, pubkey) combination is kept
          cacheKey = `${kind}:${event.pubkey}`;
          
          // Check if we already have a version of this replaceable event
          const existing = this.cache[contentType].get(cacheKey);
          if (existing) {
            // Keep only the newest version (by created_at)
            if (event.created_at > existing.event.created_at) {
              // Newer version - replace it
              this.cache[contentType].set(cacheKey, {
                event,
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
          const dTag = event.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) {
            cacheKey = `${kind}:${event.pubkey}:${dTag}`;
            
            // Check if we already have a version of this addressable event
            const existing = this.cache[contentType].get(cacheKey);
            if (existing) {
              // Keep only the newest version (by created_at)
              if (event.created_at > existing.event.created_at) {
                // Newer version - replace it
                this.cache[contentType].set(cacheKey, {
                  event,
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
            event,
            relays,
            cachedAt: now
          });
        }
      });

      // Persist to IndexedDB
      await idbkv.set(CACHE_KEYS[contentType], Array.from(this.cache[contentType].entries()), store);


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
        idbkv.del(CACHE_KEYS.wiki, store),
        idbkv.del(CACHE_KEYS.reactions, store),
        idbkv.del(CACHE_KEYS.deletes, store),
        idbkv.del(CACHE_KEYS.kind1, store),
        idbkv.del(CACHE_KEYS.kind1111, store),
        idbkv.del(CACHE_KEYS.kind30041, store),
        idbkv.del(CACHE_KEYS.kind10002, store),
        idbkv.del(CACHE_KEYS.metadata, store),
        idbkv.del(CACHE_KEYS.bookConfigs, store),
        idbkv.del(CACHE_KEYS.cacheInfo, store)
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
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      let totalCleaned = 0;

      (Object.keys(this.cache) as Array<keyof ContentCache>).forEach(contentType => {
        const expiry = CACHE_EXPIRY[contentType];
        const originalSize = this.cache[contentType].size;
        
        // Remove expired events
        for (const [id, cached] of this.cache[contentType].entries()) {
          if ((now - cached.cachedAt) > expiry) {
            this.cache[contentType].delete(id);
            totalCleaned++;
          }
        }

        // Persist cleaned cache
        idbkv.set(CACHE_KEYS[contentType], Array.from(this.cache[contentType].entries()), store);
        
        if (this.cache[contentType].size < originalSize) {
          console.log(`🧹 Cleaned ${originalSize - this.cache[contentType].size} expired ${contentType} events`);
        }
      });

      if (totalCleaned > 0) {
        console.log(`🧹 Total cleanup: ${totalCleaned} expired events removed`);
      }

    } catch (error) {
      console.error('❌ Failed to cleanup cache:', error);
    }
  }
}

// Export singleton instance
export const contentCache = new ContentCacheManager();

// Initialize cache on import
contentCache.initialize().catch(console.error);

// DISABLED: Cleanup expired events to prevent doom loops
// setInterval(() => {
//   contentCache.cleanup().catch(console.error);
// }, 5 * 60 * 1000);
