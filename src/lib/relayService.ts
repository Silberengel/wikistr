import { pool } from '@nostr/gadgets/global';
import { loadRelayList } from '@nostr/gadgets/lists';
import { DEFAULT_METADATA_RELAYS, DEFAULT_WRITE_RELAYS, DEFAULT_SEARCH_RELAYS } from '$lib/defaults';
import { getThemeConfig } from '$lib/themes';
import type { NostrEvent } from '@nostr/tools/pure';

export type RelaySetType = 'wiki-read' | 'wiki-write' | 'social-read' | 'social-write' | 'metadata-read' | 'fallback-write' | 'inbox-read';

export interface QueryResult<T> {
  events: T[];
  relays: string[];
}

export interface RelayServiceOptions {
  excludeUserContent?: boolean;
  currentUserPubkey?: string;
  customRelays?: string[];
}

/**
 * Simple, robust relay service without circular dependencies
 * Designed to prevent doom loops with clear initialization and error handling
 */
class RelayService {
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private relayCache = new Map<string, string[]>();
  
  // Subscription management to prevent concurrent request overload
  private activeSubscriptions = new Set<string>();
  private requestQueue: Array<() => Promise<void>> = [];
  private maxConcurrentSubscriptions = 5; // Increased to handle more concurrent requests
  private maxQueueSize = 50; // Increased queue size to handle bursts of requests
  private isProcessingQueue = false;
  private requestDeduplication = new Map<string, Promise<any>>(); // Deduplicate identical requests
  
  /**
   * Manage subscription queue to prevent relay overload
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.requestQueue.length > 0 && this.activeSubscriptions.size < this.maxConcurrentSubscriptions) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.warn('Queue request failed:', error);
        }
      }
    }
    
    this.isProcessingQueue = false;
  }
  
  /**
   * Add a request to the queue with throttling and deduplication
   */
  private async queueRequest<T>(requestFn: () => Promise<T>, subscriptionId: string): Promise<T> {
    // Create a deduplication key based on the request type and target user
    // For metadata requests, extract the target user pubkey (3rd segment) and use it for deduplication
    // This ensures multiple requests for the same user's metadata are deduplicated
    const parts = subscriptionId.split('-');
    let deduplicationKey: string;
    
    if (parts[0] === 'metadata-read' && parts.length >= 4) {
      // For metadata requests: metadata-read-{userPubkey}-{targetUser}-{timestamp}-{random}
      // Use: metadata-read-{userPubkey}-{targetUser} to deduplicate requests for same user
      deduplicationKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
    } else {
      // For other requests, use type-userPubkey-targetUser (first 4 parts, excluding timestamp)
      deduplicationKey = parts.slice(0, 4).join('-');
    }
    
    // Check if we already have an identical request in progress
    if (this.requestDeduplication.has(deduplicationKey)) {
      return this.requestDeduplication.get(deduplicationKey)!;
    }
    
    // Check queue size limit
    if (this.requestQueue.length >= this.maxQueueSize) {
      console.warn(`⚠️ Queue full (${this.requestQueue.length}/${this.maxQueueSize}), rejecting request ${subscriptionId}`);
      throw new Error(`Request queue is full (${this.requestQueue.length}/${this.maxQueueSize})`);
    }
    
    const promise = new Promise<T>((resolve, reject) => {
      const queuedRequest = async () => {
        try {
          this.activeSubscriptions.add(subscriptionId);
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeSubscriptions.delete(subscriptionId);
          this.requestDeduplication.delete(deduplicationKey);
          // Process next item in queue with a smaller delay for faster processing
          setTimeout(() => this.processQueue(), 100);
        }
      };
      
      this.requestQueue.push(queuedRequest);
      
      // Clean up old deduplication entries periodically
      if (Math.random() < 0.1) { // 10% chance to clean up
        this.cleanupDeduplicationCache();
      }
      
      this.processQueue();
    });
    
    // Store the promise for deduplication
    this.requestDeduplication.set(deduplicationKey, promise);
    
    return promise;
  }

  /**
   * Clean up old deduplication entries to prevent memory leaks
   */
  private cleanupDeduplicationCache(): void {
    // Limit cache size to prevent unbounded growth
    // Remove oldest entries if cache exceeds limit
    if (this.requestDeduplication.size > 100) {
      const keysToDelete = Array.from(this.requestDeduplication.keys()).slice(0, 20);
      keysToDelete.forEach(key => this.requestDeduplication.delete(key));
    }
  }

  /**
   * Ensure service is initialized only once
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    this.initializationPromise = this.initialize();
    await this.initializationPromise;
  }
  
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Initialize with basic theme configuration
      const theme = getThemeConfig();
      
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize RelayService:', error);
      throw error;
    }
  }
  
  /**
   * Get relays for a specific operation type
   * Simple, deterministic relay selection
   */
  async getRelaysForOperation(userPubkey: string, type: RelaySetType): Promise<string[]> {
    await this.ensureInitialized();
    
    const cacheKey = `${userPubkey}-${type}`;
    if (this.relayCache.has(cacheKey)) {
      return this.relayCache.get(cacheKey)!;
    }
    
    let relays: string[] = [];
    
    try {
      // Get theme-specific relays
      const theme = getThemeConfig();
      const themeWikiRelays = theme.relays?.wiki || [];
      const themeSocialRelays = theme.relays?.social || [];
      
      switch (type) {
        case 'wiki-read':
        case 'wiki-write':
          relays = [...themeWikiRelays];
          break;
        case 'social-read':
        case 'social-write':
          relays = [...themeSocialRelays];
          break;
        case 'inbox-read':
          // For inbox, start with theme social relays as fallback
          // Only use user's relay list if available
          relays = [...themeSocialRelays];
          break;
        case 'metadata-read':
          relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS];
          break;
        case 'fallback-write':
          relays = [...DEFAULT_WRITE_RELAYS];
          break;
      }
      
      // Load user's own relays only for the logged-in user and only if we need more relays
      if (userPubkey && userPubkey !== 'anonymous' && userPubkey !== 'undefined' && userPubkey !== 'null' && relays.length < 3) {
        try {
          const userRelays = await this.loadUserRelayList(userPubkey);
          relays = [...relays, ...userRelays];
        } catch (error) {
          console.warn('Failed to load user relays:', error);
        }
      }
      
      // Normalize and deduplicate
      relays = [...new Set(relays.map(url => this.normalizeRelayUrl(url)))]
        .filter(url => url && 
                      url !== 'undefined' && 
                      url !== 'null' && 
                      url !== '' && 
                      typeof url === 'string' &&
                      (url.startsWith('ws://') || url.startsWith('wss://')));
      
      // Cache the result
      this.relayCache.set(cacheKey, relays);
      
      return relays;
      
    } catch (error) {
      console.error('Failed to get relays:', error);
      // Return minimal fallback
      return DEFAULT_WRITE_RELAYS.slice(0, 3);
    }
  }
  
  // Cache for user relay lists to prevent infinite loops
  private userRelayCache = new Map<string, { relays: string[], timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Load user's relay list with caching to prevent infinite loops
   */
  private async loadUserRelayList(userPubkey: string): Promise<string[]> {
    try {
      // Check cache first
      const cached = this.userRelayCache.get(userPubkey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.relays;
      }
      
      // Only load relays for the logged-in user, not for other users
      const { get } = await import('idb-keyval');
      const loggedInData = await get('wikistr:loggedin');
      
      const currentUserPubkey = loggedInData ? loggedInData.pubkey : null;
      
      if (userPubkey !== currentUserPubkey) {
        // Cache empty result to prevent repeated queries
        this.userRelayCache.set(userPubkey, {
          relays: [],
          timestamp: Date.now()
        });
        return [];
      }
      
      // Add timeout protection to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('User relay list query timeout')), 10000)
      );
      
      // Use metadata-read relays to load the user's kind 10002 event
      const queryPromise = this.queryEvents(
        userPubkey,
        'metadata-read',
        [{ kinds: [10002], authors: [userPubkey], limit: 1 }],
        { excludeUserContent: false, currentUserPubkey }
      );
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      let relays: string[] = [];
      
      if (result.events.length > 0) {
        const event = result.events[0];
        relays = event.tags
          .filter(tag => tag[0] === 'r')
          .map(tag => tag[1])
          .filter(relay => relay && relay.startsWith('wss://'));
      }
      
      // Cache the result
      this.userRelayCache.set(userPubkey, {
        relays,
        timestamp: Date.now()
      });
      
      return relays;
    } catch (error) {
      console.warn('Failed to load user relay list:', error);
      
      // Cache empty result to prevent repeated failures
      this.userRelayCache.set(userPubkey, {
        relays: [],
        timestamp: Date.now()
      });
      
      return [];
    }
  }
  
  // Cache for user inbox relays to prevent infinite loops
  private userInboxCache = new Map<string, { relays: string[], timestamp: number }>();

  /**
   * Load user's inbox relays (read-only) with caching to prevent infinite loops
   */
  private async loadUserInboxRelays(userPubkey: string): Promise<string[]> {
    try {
      // Check cache first
      const cached = this.userInboxCache.get(userPubkey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.relays;
      }
      
      // Only load for the logged-in user
      const { get } = await import('idb-keyval');
      const loggedInData = await get('wikistr:loggedin');
      const currentUserPubkey = loggedInData ? loggedInData.pubkey : null;
      
      if (userPubkey !== currentUserPubkey) {
        return [];
      }
      
      // Get user's relay list and filter for read-only relays
      const userRelays = await this.loadUserRelayList(userPubkey);
      const inboxRelays = userRelays.filter(relay => {
        // Filter for read-only relays (no write permission)
        return relay && !relay.includes('write') && !relay.includes('wss://');
      });
      
      // Cache the result
      this.userInboxCache.set(userPubkey, {
        relays: inboxRelays,
        timestamp: Date.now()
      });
      
      return inboxRelays;
    } catch (error) {
      console.warn('Failed to load user inbox relays:', error);
      return [];
    }
  }
  
  // Cache for user outbox relays to prevent infinite loops
  private userOutboxCache = new Map<string, { relays: string[], timestamp: number }>();

  /**
   * Load user's outbox relays (write-only) with caching to prevent infinite loops
   */
  private async loadUserOutboxRelays(userPubkey: string): Promise<string[]> {
    try {
      // Check cache first
      const cached = this.userOutboxCache.get(userPubkey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.relays;
      }
      
      // Only load for the logged-in user
      const { get } = await import('idb-keyval');
      const loggedInData = await get('wikistr:loggedin');
      const currentUserPubkey = loggedInData ? loggedInData.pubkey : null;
      
      if (userPubkey !== currentUserPubkey) {
        return [];
      }
      
      // Get user's relay list and filter for write-only relays
      const userRelays = await this.loadUserRelayList(userPubkey);
      const outboxRelays = userRelays.filter(relay => {
        // Filter for write-only relays (with write permission)
        return relay && (relay.includes('write') || relay.startsWith('wss://'));
      });
      
      // Cache the result
      this.userOutboxCache.set(userPubkey, {
        relays: outboxRelays,
        timestamp: Date.now()
      });
      
      return outboxRelays;
    } catch (error) {
      console.warn('Failed to load user outbox relays:', error);
      return [];
    }
  }
  
  /**
   * Load both inbox and outbox relays for settings popup
   */
  async loadUserRelayLists(userPubkey: string): Promise<{ inbox: string[]; outbox: string[] }> {
    try {
      const [inboxRelays, outboxRelays] = await Promise.all([
        this.loadUserInboxRelays(userPubkey),
        this.loadUserOutboxRelays(userPubkey)
      ]);
      
      return {
        inbox: inboxRelays,
        outbox: outboxRelays
      };
    } catch (error) {
      console.warn('Failed to load user relay lists:', error);
      return { inbox: [], outbox: [] };
    }
  }
  
  /**
   * Normalize relay URL
   */
  private normalizeRelayUrl(url: string): string {
    if (!url) return '';
    
    let normalized = url.replace(/\/$/, '');
    
    if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
      normalized = 'wss://' + normalized;
    }
    
    return normalized;
  }
  
  /**
   * Query events from relays with timeout protection and request throttling
   */
  async queryEvents<T extends NostrEvent>(
    userPubkey: string,
    type: RelaySetType,
    filters: any[],
    options: RelayServiceOptions = {}
  ): Promise<QueryResult<T>> {
    await this.ensureInitialized();
    
    // Create unique subscription ID for this request
    // For metadata requests, include the target user's pubkey to avoid deduplication issues
    const targetUser = filters.find(f => f.authors && f.authors.length > 0)?.authors?.[0];
    const subscriptionId = targetUser 
      ? `${type}-${userPubkey}-${targetUser.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      : `${type}-${userPubkey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Use the queue system to throttle requests
    return this.queueRequest(async () => {
      // First, check cache relay for events
      const { queryCacheRelay, storeEventInCacheRelay } = await import('./cacheRelay');
      const cachedEvents = await queryCacheRelay(filters) as T[];
      
      // Use customRelays if provided, otherwise get relays for operation
      let relays = options.customRelays || await this.getRelaysForOperation(userPubkey, type);
      
      // Extra safety filter for undefined/null relays
      relays = relays.filter(url => url && 
                                    url !== 'undefined' && 
                                    url !== 'null' && 
                                    url !== '' && 
                                    typeof url === 'string' &&
                                    (url.startsWith('ws://') || url.startsWith('wss://')));
      
      if (relays.length === 0) {
        console.warn('No relays available for query');
        return { events: [], relays: [] };
      }
      
      const events: T[] = [];
      const eventMap = new Map<string, T>();
      
      // Add cached events to the map
      for (const cachedEvent of cachedEvents) {
        eventMap.set(cachedEvent.id, cachedEvent);
        events.push(cachedEvent);
      }
      
      let subscriptionClosed = false;
      
      return new Promise<QueryResult<T>>((resolve) => {
        const timeout = setTimeout(() => {
          if (!subscriptionClosed) {
            subscriptionClosed = true;
            console.log(`Query timeout for ${subscriptionId}, returning partial results`);
            resolve({ events: Array.from(eventMap.values()), relays });
          }
        }, 8000); // 8 second timeout
        
        try {
          // Use pool.subscribeMany with our controlled relay sets
          const subscription = pool.subscribeMany(relays, filters, {
            onevent: async (event: any) => {
              if (subscriptionClosed) return;
              
              const typedEvent = event as T;
              
              // Filter out user's own content if requested
              if (options.excludeUserContent && options.currentUserPubkey && 
                  typedEvent.pubkey === options.currentUserPubkey) {
                return;
              }
              
              // Check if we have a newer version in cache or if this is a new event
              const existing = eventMap.get(typedEvent.id);
              if (!existing || typedEvent.created_at > existing.created_at) {
                // Newer version or new event - update cache and map
                eventMap.set(typedEvent.id, typedEvent);
                await storeEventInCacheRelay(typedEvent);
                
                // Update events array
                const index = events.findIndex(e => e.id === typedEvent.id);
                if (index >= 0) {
                  events[index] = typedEvent;
                } else {
                  events.push(typedEvent);
                }
              }
            },
            oneose: () => {
              if (!subscriptionClosed) {
                subscriptionClosed = true;
                clearTimeout(timeout);
                subscription.close();
                resolve({ events: Array.from(eventMap.values()), relays });
              }
            }
          });
          
          // Handle subscription errors with try-catch instead
          // Note: SubCloser doesn't have 'on' method, so we rely on try-catch
          
        } catch (error) {
          if (!subscriptionClosed) {
            subscriptionClosed = true;
            clearTimeout(timeout);
            console.error(`Failed to create subscription for ${subscriptionId}:`, error);
            resolve({ events: Array.from(eventMap.values()), relays });
          }
        }
      });
    }, subscriptionId);
  }
  
  /**
   * Publish an event to relays
   */
  async publishEvent(
    userPubkey: string,
    type: RelaySetType,
    event: NostrEvent,
    showToastNotification = true
  ): Promise<{ success: boolean; publishedTo: string[]; failedRelays: string[] }> {
    await this.ensureInitialized();
    
    // Store in cache relay first
    try {
      const { storeEventInCacheRelay } = await import('./cacheRelay');
      await storeEventInCacheRelay(event);
    } catch (error) {
      console.warn('Failed to store event in cache relay:', error);
    }
    
    const relays = await this.getRelaysForOperation(userPubkey, type);
    
    let publishedTo: string[] = [];
    let failedRelays: string[] = [];
    
    // Publish to each relay using our controlled relay sets
    for (const url of relays) {
      try {
        const r = await pool.ensureRelay(url);
        
        // Try to authenticate if the relay requires it
        try {
          // Get the signer from the logged-in user
          const { get } = await import('idb-keyval');
          const loggedInUser = await get('wikistr:loggedin');
          if (loggedInUser) {
            if (loggedInUser.signer) {
              await r.auth(loggedInUser.signer);
              console.log('🔐 Authenticated to', url);
            } else {
              console.log('ℹ️ No signer available for', url);
            }
          } else {
            console.log('ℹ️ No logged-in user for', url);
          }
        } catch (authErr) {
          // If auth fails, continue anyway - some relays don't need auth for publishing
          console.log('ℹ️ Auth failed for', url, authErr);
        }
        
        await r.publish(event);
        publishedTo.push(url);
        console.log('✅ Published to', url);
      } catch (err) {
        // Handle specific error types
        if (err instanceof Error) {
          if (err.message.includes('UNIQUE constraint failed')) {
            console.log('⚠️ Event already exists on', url, '- skipping');
            continue; // Skip this relay, don't count as failure
          }
          if (err.message.includes('rate-limited')) {
            console.log('⚠️ Rate limited on', url, '- skipping');
            continue; // Skip this relay, don't count as failure
          }
        }
        failedRelays.push(url);
        console.warn('❌ Failed to publish to', url, err);
      }
    }
    
    const result = {
      success: publishedTo.length > 0,
      publishedTo,
      failedRelays
    };
    
    return result;
  }


  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.relayCache.clear();
  }
  
  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const relayService = new RelayService();
