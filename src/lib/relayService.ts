import { pool } from '@nostr/gadgets/global';
import { loadRelayList } from '@nostr/gadgets/lists';
import { DEFAULT_METADATA_RELAYS, DEFAULT_WRITE_RELAYS, DEFAULT_SEARCH_RELAYS } from '$lib/defaults';
import { getThemeConfig } from '$lib/themes';
import type { NostrEvent } from '@nostr/tools/pure';

export type RelaySetType = 'wiki-read' | 'wiki-write' | 'social-read' | 'social-write' | 'metadata-read' | 'fallback-write' | 'inbox-read' | 'search';

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
  
  // Relay failure tracking (session-based)
  private readonly MAX_FAILURES = 3;
  private relayFailureCounts = new Map<string, number>();
  private relayLastFailureTime = new Map<string, number>();
  private relayLastSuccessTime = new Map<string, number>();
  
  /**
   * Get backoff delay for retry attempt (exponential backoff: 1s, 2s, 4s)
   */
  private getBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
  }
  
  /**
   * Record a relay failure
   */
  recordRelayFailure(url: string): void {
    const failures = this.relayFailureCounts.get(url) || 0;
    this.relayFailureCounts.set(url, failures + 1);
    this.relayLastFailureTime.set(url, Date.now());
  }
  
  /**
   * Record a relay success (reset failure count)
   */
  recordRelaySuccess(url: string): void {
    this.relayFailureCounts.delete(url);
    this.relayLastFailureTime.delete(url);
    this.relayLastSuccessTime.set(url, Date.now());
  }
  
  /**
   * Get relay status: 'parked' (failed 3+ times), 'retrying' (1-2 failures), or 'connected' (working)
   */
  getRelayStatus(url: string): 'parked' | 'retrying' | 'connected' {
    const failures = this.relayFailureCounts.get(url) || 0;
    const lastFailure = this.relayLastFailureTime.get(url) || 0;
    const lastSuccess = this.relayLastSuccessTime.get(url) || 0;
    
    if (failures >= this.MAX_FAILURES) {
      return 'parked';
    }
    
    if (failures > 0) {
      // Check if we're still in backoff period
      const attempt = failures + 1;
      const backoffDelay = this.getBackoffDelay(attempt);
      const timeSinceLastFailure = Date.now() - lastFailure;
      
      if (timeSinceLastFailure < backoffDelay && lastFailure > 0) {
        return 'retrying';
      }
    }
    
    // If we have a recent success, consider it connected
    if (lastSuccess > 0 && (Date.now() - lastSuccess) < 60000) {
      return 'connected';
    }
    
    // No failures or backoff expired - consider it connected (will be tested on next use)
    return failures > 0 ? 'retrying' : 'connected';
  }
  
  /**
   * Filter out parked relays (failed 3+ times) and relays still in backoff
   */
  filterWorkingRelays(relays: string[]): string[] {
    return relays.filter(url => {
      const status = this.getRelayStatus(url);
      return status !== 'parked';
    });
  }
  
  /**
   * Reset all relay failures (for "refresh" button)
   */
  resetAllRelayFailures(): void {
    this.relayFailureCounts.clear();
    this.relayLastFailureTime.clear();
    this.relayLastSuccessTime.clear();
  }
  
  /**
   * Get all relay statuses for display
   * Optionally accepts a list of all relays to include untracked ones
   */
  getAllRelayStatuses(allRelays?: string[]): Map<string, 'parked' | 'retrying' | 'connected'> {
    const statuses = new Map<string, 'parked' | 'retrying' | 'connected'>();
    
    // Get all unique relays from failure tracking
    const trackedRelays = new Set([
      ...this.relayFailureCounts.keys(),
      ...this.relayLastSuccessTime.keys()
    ]);
    
    // If allRelays is provided, include those too (for untracked relays, default to 'connected')
    const relaysToCheck = allRelays 
      ? new Set([...trackedRelays, ...allRelays])
      : trackedRelays;
    
    for (const url of relaysToCheck) {
      statuses.set(url, this.getRelayStatus(url));
    }
    
    return statuses;
  }
  
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
    const isLoggedIn = userPubkey && userPubkey !== 'anonymous' && userPubkey !== 'undefined' && userPubkey !== 'null';
    
    try {
      // Get theme-specific relays
      const theme = getThemeConfig();
      const themeWikiRelays = theme.relays?.wiki || [];
      const themeSocialRelays = theme.relays?.social || [];
      // Load cache relays non-blocking (don't await, use cached version if available)
      let cacheRelayUrls: string[] = [];
      try {
        const { getCacheRelayUrls } = await import('./cacheRelay');
        cacheRelayUrls = await getCacheRelayUrls();
      } catch (error) {
        // Silently fail - cache relays are optional
      }
      
      switch (type) {
        case 'wiki-read':
          // Articles READ: if logged in: wiki from theme + user's inboxes + cache relay
          //              if not logged in: wiki from theme
          relays = [...themeWikiRelays];
          if (isLoggedIn) {
            try {
              const userRelayLists = await this.loadUserRelayLists(userPubkey);
              relays.push(...userRelayLists.inbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } catch (error) {
              console.warn('Failed to load user inbox relays:', error);
            }
          }
          break;
          
        case 'wiki-write':
          // Articles WRITE: if logged in: wiki from theme + user's outboxes + cache relay
          //                if logged in but no outboxes/cache: wiki from theme + DEFAULT_WRITE_RELAYS
          //                if not logged in: no write allowed (return empty)
          if (!isLoggedIn) {
            return [];
          }
          relays = [...themeWikiRelays];
          try {
            const userRelayLists = await this.loadUserRelayLists(userPubkey);
            if (userRelayLists.outbox.length > 0 || cacheRelayUrls.length > 0) {
              relays.push(...userRelayLists.outbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } else {
              // No outboxes or cache relay, use default write relays
              relays.push(...DEFAULT_WRITE_RELAYS);
            }
          } catch (error) {
            console.warn('Failed to load user outbox relays:', error);
            // Fallback to default write relays
            relays.push(...DEFAULT_WRITE_RELAYS);
          }
          break;
          
        case 'social-read':
          // Comments/voting READ: if logged in: social from theme + user's inboxes + cache relay
          //                       if not logged in: social from theme
          relays = [...themeSocialRelays];
          if (isLoggedIn) {
            try {
              const userRelayLists = await this.loadUserRelayLists(userPubkey);
              relays.push(...userRelayLists.inbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } catch (error) {
              console.warn('Failed to load user inbox relays:', error);
            }
          }
          break;
          
        case 'social-write':
          // Comments/voting WRITE: if logged in: social from theme + user's outboxes + cache relay
          //                        if logged in but no relay list/cache: social from theme + DEFAULT_WRITE_RELAYS
          //                        if not logged in: no write allowed (return empty)
          if (!isLoggedIn) {
            return [];
          }
          relays = [...themeSocialRelays];
          try {
            const userRelayLists = await this.loadUserRelayLists(userPubkey);
            if (userRelayLists.outbox.length > 0 || cacheRelayUrls.length > 0) {
              relays.push(...userRelayLists.outbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } else {
              // No relay list or cache relay, use default write relays
              relays.push(...DEFAULT_WRITE_RELAYS);
            }
          } catch (error) {
            console.warn('Failed to load user outbox relays:', error);
            // Fallback to default write relays
            relays.push(...DEFAULT_WRITE_RELAYS);
          }
          break;
          
        case 'metadata-read':
          // Metadata: if logged in: social from theme + DEFAULT_METADATA_RELAYS + user's inboxes + cache relay
          //            if not logged in: social from theme + DEFAULT_METADATA_RELAYS
          relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS];
          if (isLoggedIn) {
            try {
              const userRelayLists = await this.loadUserRelayLists(userPubkey);
              relays.push(...userRelayLists.inbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } catch (error) {
              console.warn('Failed to load user inbox relays:', error);
            }
          }
          break;
          
        case 'search':
          // Search: if logged in: wiki from theme + DEFAULT_SEARCH_RELAYS + user's outboxes + cache relay
          //         if logged in but no relay list/cache, or not logged in: wiki from theme + DEFAULT_SEARCH_RELAYS
          relays = [...themeWikiRelays, ...DEFAULT_SEARCH_RELAYS];
          if (isLoggedIn) {
            try {
              const userRelayLists = await this.loadUserRelayLists(userPubkey);
              if (userRelayLists.outbox.length > 0 || cacheRelayUrls.length > 0) {
                relays.push(...userRelayLists.outbox);
                if (cacheRelayUrls.length > 0) {
                  relays.push(...cacheRelayUrls);
                }
              }
            } catch (error) {
              console.warn('Failed to load user outbox relays for search:', error);
            }
          }
          break;
          
        case 'inbox-read':
          // Legacy: For inbox, start with theme social relays as fallback
          relays = [...themeSocialRelays];
          if (isLoggedIn) {
            try {
              const userRelayLists = await this.loadUserRelayLists(userPubkey);
              relays.push(...userRelayLists.inbox);
              if (cacheRelayUrls.length > 0) {
                relays.push(...cacheRelayUrls);
              }
            } catch (error) {
              console.warn('Failed to load user inbox relays:', error);
            }
          }
          break;
          
        case 'fallback-write':
          // Legacy fallback
          relays = [...DEFAULT_WRITE_RELAYS];
          break;
      }
      
      // Normalize and deduplicate - filter out non-websocket URLs (like cache relay)
      // Cache relay is handled separately, not as a websocket relay
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
   * Now uses contentCache for kind 10002 events
   */
  private async loadUserRelayList(userPubkey: string): Promise<string[]> {
    try {
      // Check in-memory cache first
      const cached = this.userRelayCache.get(userPubkey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.relays;
      }
      
      // Check contentCache for kind 10002 event
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = contentCache.getEvents('kind10002');
      const cachedEvent = cachedEvents.find(c => c.event.pubkey === userPubkey && c.event.kind === 10002);
      
      if (cachedEvent) {
        const relays = cachedEvent.event.tags
          .filter(tag => tag[0] === 'r')
          .map(tag => tag[1])
          .filter(relay => relay && relay.startsWith('wss://'));
        
        // Update in-memory cache
        this.userRelayCache.set(userPubkey, {
          relays,
          timestamp: Date.now()
        });
        
        return relays;
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
      
      // Add timeout protection to prevent hanging (shorter timeout for relay list)
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('User relay list query timeout')), 5000)
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
        
        // Store in contentCache for future use
        await contentCache.storeEvents('kind10002', [{
          event,
          relays: result.relays
        }]);
      }
      
      // Cache the result in memory
      this.userRelayCache.set(userPubkey, {
        relays,
        timestamp: Date.now()
      });
      
      return relays;
    } catch (error) {
      // Only log if it's not a timeout (timeouts are expected and handled gracefully)
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      if (!isTimeout) {
        console.warn('Failed to load user relay list:', error);
      }
      
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
      
      // Include cache relays if they exist (optional, non-blocking)
      try {
        const { getCacheRelayUrls } = await import('./cacheRelay');
        const cacheRelayUrls = await getCacheRelayUrls();
        for (const cacheRelayUrl of cacheRelayUrls) {
          if (!inboxRelays.includes(cacheRelayUrl)) {
            inboxRelays.push(cacheRelayUrl);
          }
        }
      } catch (error) {
        // Silently fail - cache relays are optional
      }
      
      // Normalize and deduplicate
      const normalized = inboxRelays.map(url => this.normalizeRelayUrl(url));
      const deduplicated = [...new Set(normalized)];
      
      // Cache the result
      this.userInboxCache.set(userPubkey, {
        relays: deduplicated,
        timestamp: Date.now()
      });
      
      return deduplicated;
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
      
      // Include cache relays if they exist (optional, non-blocking)
      try {
        const { getCacheRelayUrls } = await import('./cacheRelay');
        const cacheRelayUrls = await getCacheRelayUrls();
        for (const cacheRelayUrl of cacheRelayUrls) {
          if (!outboxRelays.includes(cacheRelayUrl)) {
            outboxRelays.push(cacheRelayUrl);
          }
        }
      } catch (error) {
        // Silently fail - cache relays are optional
      }
      
      // Normalize and deduplicate
      const normalized = outboxRelays.map(url => this.normalizeRelayUrl(url));
      const deduplicated = [...new Set(normalized)];
      
      // Cache the result
      this.userOutboxCache.set(userPubkey, {
        relays: deduplicated,
        timestamp: Date.now()
      });
      
      return deduplicated;
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
      // Use customRelays if provided, otherwise get relays for operation
      const relays = options.customRelays || await this.getRelaysForOperation(userPubkey, type);
      
      // Extra safety filter for undefined/null relays
      let filteredRelays = relays.filter(url => url && 
                                    url !== 'undefined' && 
                                    url !== 'null' && 
                                    url !== '' && 
                                    typeof url === 'string' &&
                                    (url.startsWith('ws://') || url.startsWith('wss://')));
      
      // Filter out parked relays (failed 3+ times) and relays in backoff
      filteredRelays = this.filterWorkingRelays(filteredRelays);
      
      if (filteredRelays.length === 0) {
        console.warn('No relays available for query');
        return { events: [], relays };
      }
      
      const events: T[] = [];
      const eventMap = new Map<string, T>();
      
      let subscriptionClosed = false;
      
      return new Promise<QueryResult<T>>((resolve) => {
        const timeout = setTimeout(() => {
          if (!subscriptionClosed) {
            subscriptionClosed = true;
            console.log(`Query timeout for ${subscriptionId}, returning partial results`);
            
            // Timeout occurred - if no events received, mark relays as potentially failed
            // We'll be conservative: only mark as failed if we got no events AND haven't seen success recently
            if (events.length === 0) {
              filteredRelays.forEach(url => {
                const lastSuccess = this.relayLastSuccessTime.get(url) || 0;
                // Only mark as failed if no success in last 30 seconds
                if (Date.now() - lastSuccess > 30000) {
                  this.recordRelayFailure(url);
                }
              });
            } else {
              // Got some events - mark all relays as successful
              filteredRelays.forEach(url => this.recordRelaySuccess(url));
            }
            
            resolve({ events: Array.from(eventMap.values()), relays });
          }
        }, 8000); // 8 second timeout
        
        try {
          // Authenticate to relays that require it before subscribing
          (async () => {
            try {
              const { get } = await import('idb-keyval');
              const loggedInUser = await get('wikistr:loggedin');
              const signer = loggedInUser?.signer;
              
              if (signer) {
                // Authenticate to all relays before subscribing
                for (const url of filteredRelays) {
                  try {
                    const r = await pool.ensureRelay(url);
                    await r.auth(signer);
                  } catch (authErr) {
                    // If auth fails, continue anyway - some relays don't need auth for reading
                    // Connection errors are also expected for some relays
                  }
                }
              }
            } catch (err) {
              // Ignore auth errors - continue with subscription anyway
            }
          })();
          
          // Use pool.subscribeMany with our controlled relay sets
          const subscription = pool.subscribeMany(filteredRelays, filters, {
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
                
                // Update events array
                const index = events.findIndex(e => e.id === typedEvent.id);
                if (index >= 0) {
                  events[index] = typedEvent;
                } else {
                  events.push(typedEvent);
                }
              }
            },
            oneose: (relayUrl?: string) => {
              if (!subscriptionClosed) {
                subscriptionClosed = true;
                clearTimeout(timeout);
                subscription.close();
                
                // Record success for relays - if we got events, mark all as successful
                // (since pool.subscribeMany doesn't tell us which specific relay responded)
                if (events.length > 0) {
                  filteredRelays.forEach(url => this.recordRelaySuccess(url));
                }
                
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
  
  /**
   * Public method to get relay status
   */
  getRelayStatusPublic(url: string): 'parked' | 'retrying' | 'connected' {
    return this.getRelayStatus(url);
  }
  
  /**
   * Public method to get all relay statuses
   */
  getAllRelayStatusesPublic(allRelays?: string[]): Map<string, 'parked' | 'retrying' | 'connected'> {
    return this.getAllRelayStatuses(allRelays);
  }
  
  /**
   * Public method to reset all relay failures
   */
  resetAllRelayFailuresPublic(): void {
    this.resetAllRelayFailures();
  }
  
  /**
   * Public method to record relay failure
   */
  recordRelayFailurePublic(url: string): void {
    this.recordRelayFailure(url);
  }
  
  /**
   * Public method to record relay success
   */
  recordRelaySuccessPublic(url: string): void {
    this.recordRelaySuccess(url);
  }
}

// Export singleton instance
export const relayService = new RelayService();
