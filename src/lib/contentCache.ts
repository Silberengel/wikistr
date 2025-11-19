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
        metadataData,
        bookConfigsData
      ] = await Promise.all([
        idbkv.get(CACHE_KEYS.wiki, store),
        idbkv.get(CACHE_KEYS.reactions, store),
        idbkv.get(CACHE_KEYS.deletes, store),
        idbkv.get(CACHE_KEYS.kind1, store),
        idbkv.get(CACHE_KEYS.kind1111, store),
        idbkv.get(CACHE_KEYS.kind30041, store),
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
      
      // For replaceable event types, we need to deduplicate by a-tag and keep newest
      const isReplaceable = contentType === 'wiki' || contentType === 'kind30041' || contentType === 'kind1111';
      
      // Merge new events with existing cache, preventing duplicates
      events.forEach(({ event, relays }) => {
        let cacheKey = event.id;
        
        // For replaceable events, use a-tag (kind:pubkey:d-tag) as the key
        if (isReplaceable) {
          const dTag = event.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) {
            const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
            cacheKey = aTag;
            
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
          }
        }
        
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
   * Get specific event by ID or a-tag
   * For replaceable events, can search by a-tag (kind:pubkey:d-tag) or event.id
   */
  getEvent(contentType: keyof ContentCache, eventId: string): CachedEvent | undefined {
    // First try direct lookup
    const direct = this.cache[contentType].get(eventId);
    if (direct) return direct;
    
    // For replaceable events, also try searching by event.id if eventId looks like an a-tag
    const isReplaceable = contentType === 'wiki' || contentType === 'kind30041' || contentType === 'kind1111';
    if (isReplaceable && eventId.includes(':')) {
      // Might be an a-tag, try direct lookup (already tried above)
      // Or might be an event.id, search all entries
      for (const cached of this.cache[contentType].values()) {
        if (cached.event.id === eventId) {
          return cached;
        }
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
