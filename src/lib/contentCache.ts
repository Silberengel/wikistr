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
      console.log('🔄 Loading content cache from IndexedDB...');
      
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

      const totalEvents = Object.values(this.cache).reduce((sum, map) => sum + map.size, 0);
      console.log(`📦 Loaded ${totalEvents} cached events from IndexedDB`);
      console.log(`  📰 Wiki: ${this.cache.wiki.size}`);
      console.log(`  ❤️  Reactions: ${this.cache.reactions.size}`);
      console.log(`  🗑️  Deletes: ${this.cache.deletes.size}`);
      console.log(`  💬 Kind 1: ${this.cache.kind1.size}`);
      console.log(`  💭 Kind 1111: ${this.cache.kind1111.size}`);
      console.log(`  📖 Kind 30041: ${this.cache.kind30041.size}`);
      console.log(`  👤 Metadata: ${this.cache.metadata.size}`);
      console.log(`  📚 Book configs: ${this.cache.bookConfigs.size}`);

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
    // Cache is fresh if it has non-expired events
    return cachedEvents.length > 0;
  }

  /**
   * Store events in cache
   */
  async storeEvents(
    contentType: keyof ContentCache,
    events: { event: Event; relays: string[] }[]
  ): Promise<void> {
    try {
      const now = Date.now();
      
      // Merge new events with existing cache, preventing duplicates
      events.forEach(({ event, relays }) => {
        const existing = this.cache[contentType].get(event.id);
        if (existing) {
          // Merge relays and update timestamp
          existing.relays = [...new Set([...existing.relays, ...relays])];
          existing.cachedAt = now;
        } else {
          // Store new event
          this.cache[contentType].set(event.id, {
            event,
            relays,
            cachedAt: now
          });
        }
      });

      // Persist to IndexedDB
      await idbkv.set(CACHE_KEYS[contentType], Array.from(this.cache[contentType].entries()), store);

      console.log(`💾 Cached ${events.length} ${contentType} events to IndexedDB`);

    } catch (error) {
      console.error(`❌ Failed to cache ${contentType} events:`, error);
    }
  }

  /**
   * Get specific event by ID
   */
  getEvent(contentType: keyof ContentCache, eventId: string): CachedEvent | undefined {
    return this.cache[contentType].get(eventId);
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

// Cleanup expired events every 5 minutes
setInterval(() => {
  contentCache.cleanup().catch(console.error);
}, 5 * 60 * 1000);
