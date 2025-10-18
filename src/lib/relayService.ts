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
}

/**
 * Simple, robust relay service without circular dependencies
 * Designed to prevent doom loops with clear initialization and error handling
 */
class RelayService {
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private relayCache = new Map<string, string[]>();
  
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
      console.log('🔧 Initializing RelayService...');
      
      // Initialize with basic theme configuration
      const theme = getThemeConfig();
      console.log('🎨 Theme loaded:', theme.name);
      
      this.initialized = true;
      console.log('✅ RelayService initialized successfully');
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
          // For inbox, start with empty array - only use user's relay list
          relays = [];
          break;
        case 'metadata-read':
          relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS];
          break;
        case 'fallback-write':
          relays = [...DEFAULT_WRITE_RELAYS];
          break;
      }
      
      // Add user's relay list if available and not anonymous
      if (userPubkey !== 'anonymous' && userPubkey !== '0000000000000000000000000000000000000000000000000000000000000000') {
        try {
          if (type === 'inbox-read') {
            // For inbox, only use user's inbox relays (read-only)
            const userInboxRelays = await this.loadUserInboxRelays(userPubkey);
            relays = [...userInboxRelays];
          } else {
            // For other types, add user's inbox relays to theme relays
            const userInboxRelays = await this.loadUserInboxRelays(userPubkey);
            relays = [...relays, ...userInboxRelays];
          }
        } catch (error) {
          console.warn('Failed to load user relay list:', error);
          // Continue with default relays
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
      
      console.log(`🌐 Loaded ${relays.length} relays for ${type}`);
      return relays;
      
    } catch (error) {
      console.error('Failed to get relays:', error);
      // Return minimal fallback
      return DEFAULT_WRITE_RELAYS.slice(0, 3);
    }
  }
  
  /**
   * Load user's relay list with timeout protection
   */
  private async loadUserRelayList(userPubkey: string): Promise<string[]> {
    const timeoutPromise = new Promise<string[]>((_, reject) => 
      setTimeout(() => reject(new Error('Relay list timeout')), 3000)
    );
    
    const loadPromise = loadRelayList(userPubkey).then(list => 
      list.items
        .filter(ri => ri.url) // Include all relays with URLs, not just read-only ones
        .map(ri => this.normalizeRelayUrl(ri.url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')))
    );
    
    return Promise.race([loadPromise, timeoutPromise]);
  }
  
  /**
   * Load user's inbox relays (read-only) with timeout protection
   */
  private async loadUserInboxRelays(userPubkey: string): Promise<string[]> {
    const timeoutPromise = new Promise<string[]>((_, reject) => 
      setTimeout(() => reject(new Error('Inbox relay list timeout')), 3000)
    );
    
    const loadPromise = loadRelayList(userPubkey).then(list => 
      list.items
        .filter(ri => ri.url && ri.read) // Only read-only relays (inboxes)
        .map(ri => this.normalizeRelayUrl(ri.url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')))
    );
    
    return Promise.race([loadPromise, timeoutPromise]);
  }
  
  /**
   * Load user's outbox relays (write-only) with timeout protection
   */
  private async loadUserOutboxRelays(userPubkey: string): Promise<string[]> {
    const timeoutPromise = new Promise<string[]>((_, reject) => 
      setTimeout(() => reject(new Error('Outbox relay list timeout')), 3000)
    );
    
    const loadPromise = loadRelayList(userPubkey).then(list => 
      list.items
        .filter(ri => ri.url && ri.write) // Only write-only relays (outboxes)
        .map(ri => this.normalizeRelayUrl(ri.url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')))
    );
    
    return Promise.race([loadPromise, timeoutPromise]);
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
   * Query events from relays with timeout protection
   */
  async queryEvents<T extends NostrEvent>(
    userPubkey: string,
    type: RelaySetType,
    filters: any[],
    options: RelayServiceOptions = {}
  ): Promise<QueryResult<T>> {
    await this.ensureInitialized();
    
    let relays = await this.getRelaysForOperation(userPubkey, type);
    
    
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
    let subscriptionClosed = false;
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!subscriptionClosed) {
          subscriptionClosed = true;
          console.log('Query timeout, returning partial results');
          resolve({ events, relays });
        }
      }, 8000); // 8 second timeout
      
      try {
        const subscription = pool.subscribeMany(relays, filters, {
          onevent: (event: any) => {
            if (subscriptionClosed) return;
            
            const typedEvent = event as T;
            
            // Filter out user's own content if requested
            if (options.excludeUserContent && options.currentUserPubkey && 
                typedEvent.pubkey === options.currentUserPubkey) {
              return;
            }
            
            events.push(typedEvent);
          },
          oneose: () => {
            if (!subscriptionClosed) {
              subscriptionClosed = true;
              clearTimeout(timeout);
              subscription.close();
              resolve({ events, relays });
            }
          }
        });
        
        // Handle subscription errors with try-catch instead
        // Note: SubCloser doesn't have 'on' method, so we rely on try-catch
        
      } catch (error) {
        if (!subscriptionClosed) {
          subscriptionClosed = true;
          clearTimeout(timeout);
          console.error('Failed to create subscription:', error);
          resolve({ events, relays });
        }
      }
    });
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
    
    // Try to publish to each relay
    for (const url of relays) {
      try {
        const r = await pool.ensureRelay(url);
        await r.publish(event);
        publishedTo.push(url);
        console.log('✅ Published to', url);
      } catch (err) {
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
