import { pool } from '@nostr/gadgets/global';
import { loadRelayList } from '@nostr/gadgets/lists';
import { 
  DEFAULT_WRITE_RELAYS,
  DEFAULT_METADATA_RELAYS,
  DEFAULT_SEARCH_RELAYS
} from '$lib/defaults';
import { getThemeConfig } from '$lib/themes';
import { isEventDeleted, isUserMuted, loadDeletionEvents, loadMuteLists } from '$lib/filtering';
import { showToast } from '$lib/toast';
import { loadBlockedRelays } from '$lib/nostr';
import type { NostrEvent } from '@nostr/tools/pure';

/**
 * Relay set types for different operations
 * 
 * Wiki Operations:
 * - 'wiki-read': Reading wiki articles (uses theme.wiki relays)
 * - 'wiki-write': Publishing wiki articles (uses theme.wiki relays)
 * 
 * Social Operations:
 * - 'social-read': Reading reactions, comments, zaps (uses theme.social relays)
 * - 'social-write': Publishing reactions, comments, zaps (uses theme.social relays)
 * 
 * Metadata Operations:
 * - 'metadata-read': User profiles (kind 0) (uses theme.social + metadata relays)
 * - 'relaylist-read': Relay lists (kind 10002) (uses theme.social + metadata relays)
 * - 'arbitrary-ids-read': Arbitrary IDs (kind 30078) (uses theme.social + metadata relays)
 * 
 * Search Operations:
 * - 'search-read': Search queries (uses theme.wiki + search relays)
 * 
 * Fallback Operations:
 * - 'fallback-write': Emergency publishing when primary relays fail
 */
export type RelaySetType = 
  | 'wiki-read' | 'wiki-write' 
  | 'social-read' | 'social-write'
  | 'metadata-read' | 'relaylist-read' 
  | 'arbitrary-ids-read' | 'search-read'
  | 'fallback-write';

export interface RelayServiceOptions {
  excludeUserContent?: boolean;
  currentUserPubkey?: string;
}

export interface PublishResult {
  success: boolean;
  publishedTo: string[];
  failedRelays: string[];
}

export interface QueryResult<T> {
  events: T[];
  relays: string[];
}

/**
 * RelayService manages relay selection and operations
 * 
 * Features:
 * - Theme-specific relay priority (wiki vs social)
 * - User relay list integration (inbox/outbox)
 * - Blocked relay filtering (kind 10006)
 * - Automatic fallback handling
 * - Consistent API for all relay operations
 */
class RelayService {
  private blockedRelays = new Set<string>();
  private userRelayLists = new Map<string, { inboxes: string[]; outboxes: string[] }>();
  private blockedRelaysLoaded = false;
  
  // Connection pooling optimizations
  private activeSubscriptions = new Map<string, number>();
  private relayHealth = new Map<string, { lastSeen: number; failures: number }>();

  /**
   * Normalize relay URLs to ws:// or wss:// format and remove trailing slashes
   */
  private normalizeRelayUrl(url: string): string {
    // Remove trailing slash
    let normalized = url.replace(/\/$/, '');
    
    // Ensure proper protocol
    if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
      normalized = 'wss://' + normalized;
    }
    
    return normalized;
  }

  /**
   * Track relay health for connection optimization
   */
  private updateRelayHealth(relayUrl: string, success: boolean) {
    const now = Date.now();
    const health = this.relayHealth.get(relayUrl) || { lastSeen: 0, failures: 0 };
    
    if (success) {
      health.lastSeen = now;
      health.failures = Math.max(0, health.failures - 1); // Gradually reduce failure count
    } else {
      health.failures += 1;
    }
    
    this.relayHealth.set(relayUrl, health);
  }

  /**
   * Get healthy relays, prioritizing those with good health scores
   */
  private prioritizeHealthyRelays(relays: string[]): string[] {
    return relays.sort((a, b) => {
      const healthA = this.relayHealth.get(a) || { lastSeen: 0, failures: 0 };
      const healthB = this.relayHealth.get(b) || { lastSeen: 0, failures: 0 };
      
      // Prioritize relays with fewer failures and more recent activity
      const scoreA = healthA.lastSeen - (healthA.failures * 10000);
      const scoreB = healthB.lastSeen - (healthB.failures * 10000);
      
      return scoreB - scoreA;
    });
  }

  /**
   * Load blocked relays (kind 10006) from user's blocked relay list
   */
  private async loadBlockedRelays(userPubkey: string): Promise<void> {
    if (this.blockedRelaysLoaded) return;

    try {
      const blockedRelays = await loadBlockedRelays(userPubkey, DEFAULT_METADATA_RELAYS);
      const normalizedBlockedRelays = blockedRelays
        .map(url => this.normalizeRelayUrl(url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')));

      normalizedBlockedRelays.forEach(url => this.blockedRelays.add(url));
      this.blockedRelaysLoaded = true;
      
      if (normalizedBlockedRelays.length > 0) {
        console.log('Loaded blocked relays:', normalizedBlockedRelays);
      }
    } catch (err) {
      console.warn('Failed to load blocked relays:', err);
      this.blockedRelaysLoaded = true; // Don't retry on error
    }
  }

  /**
   * Load user's relay lists (kind 10002) and cache them
   */
  private async loadUserRelayLists(userPubkey: string): Promise<{ inboxes: string[]; outboxes: string[] }> {
    if (this.userRelayLists.has(userPubkey)) {
      return this.userRelayLists.get(userPubkey)!;
    }

    try {
      const relayList = await loadRelayList(userPubkey);
      const inboxes = relayList.items
        .filter((ri) => ri.read && ri.url)
        .map((ri) => this.normalizeRelayUrl(ri.url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')));
      
      const outboxes = relayList.items
        .filter((ri) => ri.write && ri.url)
        .map((ri) => this.normalizeRelayUrl(ri.url))
        .filter(url => url && (url.startsWith('ws://') || url.startsWith('wss://')));

      const result = { inboxes, outboxes };
      this.userRelayLists.set(userPubkey, result);
      return result;
    } catch (err) {
      console.warn('Failed to load user relay list:', err);
      return { inboxes: [], outboxes: [] };
    }
  }

/**
 * Get relays for a specific operation type
 * 
 * Priority order:
 * 1. Theme-specific relays (wiki or social based on operation type)
 * 2. Default system relays (for metadata, search, fallback)
 * 3. User's personal relay lists (inbox/outbox)
 */
  async getRelaysForOperation(userPubkey: string, type: RelaySetType): Promise<string[]> {
    // Load blocked relays first
    await this.loadBlockedRelays(userPubkey);
    
    const userRelays = await this.loadUserRelayLists(userPubkey);
    
    // Get theme-specific relays
    const theme = getThemeConfig();
    const themeWikiRelays = theme.relays?.wiki || [];
    const themeSocialRelays = theme.relays?.social || [];
    
    let relays: string[] = [];
    
    switch (type) {
      case 'wiki-read':
        // Wiki content reading: theme wiki relays + user inboxes
        relays = [...themeWikiRelays, ...userRelays.inboxes];
        break;
      case 'wiki-write':
        // Wiki content writing: theme wiki relays + user outboxes
        relays = [...themeWikiRelays, ...userRelays.outboxes];
        break;
      case 'social-read':
        // Social content reading (reactions, comments, zaps): theme social relays + user inboxes
        relays = [...themeSocialRelays, ...userRelays.inboxes];
        break;
      case 'social-write':
        // Social content writing (reactions, comments, zaps): theme social relays + user outboxes
        relays = [...themeSocialRelays, ...userRelays.outboxes];
        break;
      case 'metadata-read':
        // User profiles (kind 0): theme social relays + metadata relays + user inboxes
        relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS, ...userRelays.inboxes];
        break;
      case 'relaylist-read':
        // Relay lists (kind 10002): theme social relays + metadata relays + user inboxes
        relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS, ...userRelays.inboxes];
        break;
      case 'arbitrary-ids-read':
        // Arbitrary IDs (kind 30078): theme social relays + metadata relays + user inboxes
        relays = [...themeSocialRelays, ...DEFAULT_METADATA_RELAYS, ...userRelays.inboxes];
        break;
      case 'search-read':
        // Search operations: theme wiki relays + search relays + user inboxes
        relays = [...themeWikiRelays, ...DEFAULT_SEARCH_RELAYS, ...userRelays.inboxes];
        break;
      case 'fallback-write':
        // Emergency fallback when primary relays fail: write relays only
        relays = [...DEFAULT_WRITE_RELAYS];
        break;
    }
    
    // Remove duplicates and normalize URLs
    const normalizedRelays = [...new Set(relays.map(url => this.normalizeRelayUrl(url)))];
    
    // Remove blocked relays (kind 10006)
    const filteredRelays = normalizedRelays.filter(url => !this.blockedRelays.has(url));
    
    if (filteredRelays.length !== normalizedRelays.length) {
      const blockedCount = normalizedRelays.length - filteredRelays.length;
      console.log(`Filtered out ${blockedCount} blocked relays`);
    }
    
    // Prioritize healthy relays for better performance
    return this.prioritizeHealthyRelays(filteredRelays);
  }

  /**
   * Query events from relays with theme-specific relay selection
   * 
   * @param userPubkey - User's public key for relay list loading
   * @param type - Operation type (determines which theme relays to use)
   * @param filters - Nostr filters for the query
   * @param options - Additional options for filtering
   * @returns Promise with events and relays used
   */
  async queryEvents<T extends NostrEvent>(
    userPubkey: string,
    type: RelaySetType,
    filters: any[],
    options: RelayServiceOptions = {}
  ): Promise<QueryResult<T>> {
    const relays = await this.getRelaysForOperation(userPubkey, type);
    
    const events: T[] = [];
    let subscriptionClosed = false;
    
    return new Promise(async (resolve) => {
      try {
        // Load deletion events and mute lists for filtering
        await Promise.all([
          loadDeletionEvents(relays),
          loadMuteLists(relays)
        ]);

        // Use pool.subscribeMany directly to avoid circular dependency
        const subscription = pool.subscribeMany(relays, filters, {
          onevent: (event: any) => {
            // Cast to our generic type
            const typedEvent = event as T;
            
            // Filter out deleted events and muted users
            if (isEventDeleted(typedEvent.id) || isUserMuted(typedEvent.pubkey)) {
              return;
            }
            
            // Filter out user's own content if requested
            if (options.excludeUserContent && options.currentUserPubkey && typedEvent.pubkey === options.currentUserPubkey) {
              return;
            }
            
            events.push(typedEvent);
          },
          oneose: () => {
            // Subscription completed
            if (!subscriptionClosed) {
              subscriptionClosed = true;
              subscription.close();
              resolve({
                events,
                relays
              });
            }
          }
        });
        
        // Timeout fallback to prevent hanging
        setTimeout(() => {
          if (!subscriptionClosed) {
            subscriptionClosed = true;
            subscription.close();
            resolve({
              events,
              relays
            });
          }
        }, 5000); // 5 second timeout
      } catch (error) {
        console.error('Failed to query events:', error);
        resolve({
          events: [],
          relays
        });
      }
    });
  }

  /**
   * Publish an event to relays with theme-specific selection and fallback
   * 
   * @param userPubkey - User's public key for relay list loading
   * @param type - Operation type (determines which theme relays to use)
   * @param event - Nostr event to publish
   * @param showToastNotification - Whether to show success/failure toast
   * @returns Promise with publish results
   */
  async publishEvent(
    userPubkey: string,
    type: RelaySetType,
    event: NostrEvent,
    showToastNotification = true
  ): Promise<PublishResult> {
    const primaryRelays = await this.getRelaysForOperation(userPubkey, type);
    
    let publishedTo: string[] = [];
    let failedRelays: string[] = [];
    
    // Try primary relays first
    for (const url of primaryRelays) {
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
    
    // If no success with primary relays, try fallback relays
    if (publishedTo.length === 0 && DEFAULT_WRITE_RELAYS.length > 0) {
      console.log('No success with primary relays, trying fallback relays...');
      for (const url of DEFAULT_WRITE_RELAYS) {
        try {
          const r = await pool.ensureRelay(url);
          await r.publish(event);
          publishedTo.push(url);
          console.log('✅ Published to fallback relay', url);
        } catch (err) {
          failedRelays.push(url);
          console.warn('❌ Failed to publish to fallback relay', url, err);
        }
      }
    }
    
    const result: PublishResult = {
      success: publishedTo.length > 0,
      publishedTo,
      failedRelays
    };
    
    // Show toast notification if requested
    if (showToastNotification) {
      this.showPublishToast(result, type);
    }
    
    return result;
  }

  /**
   * Show appropriate toast notification for publish results
   */
  private showPublishToast(result: PublishResult, type: RelaySetType): void {
    const operationName = this.getOperationName(type);
    
    if (result.success) {
      const publishedRelays = result.publishedTo.map(url => url.replace(/^wss?:\/\//, '')).join(', ');
      showToast({
        type: 'success',
        title: `${operationName} Published`,
        message: `Successfully published to ${publishedRelays}`
      });
    } else {
      const failedRelays = result.failedRelays.map(url => url.replace(/^wss?:\/\//, '')).join(', ');
      showToast({
        type: 'error',
        title: `Failed to Publish ${operationName}`,
        message: `Could not publish to any relay. Failed: ${failedRelays}`
      });
    }
  }

  /**
   * Get human-readable operation name for toast notifications
   * 
   * @param type - Relay set type
   * @returns Human-readable operation name
   */
  private getOperationName(type: RelaySetType): string {
    switch (type) {
      case 'wiki-read':
        return 'Wiki Query';
      case 'wiki-write':
        return 'Wiki Article';
      case 'social-read':
        return 'Social Query';
      case 'social-write':
        return 'Social Event';
      case 'metadata-read':
        return 'Profile Query';
      case 'relaylist-read':
        return 'Relay List Query';
      case 'arbitrary-ids-read':
        return 'Arbitrary ID Query';
      case 'search-read':
        return 'Search Query';
      case 'fallback-write':
        return 'Fallback Publish';
      default:
        return 'Event';
    }
  }

  /**
   * Clear cached relay lists and blocked relays
   * Useful for testing or when user changes their relay configuration
   */
  clearCache(): void {
    this.userRelayLists.clear();
    this.blockedRelays.clear();
    this.blockedRelaysLoaded = false;
  }

  /**
   * Get cached relay lists for a user (for debugging)
   * 
   * @param userPubkey - User's public key
   * @returns Cached relay lists or null if not loaded
   */
  getCachedRelayLists(userPubkey: string): { inboxes: string[]; outboxes: string[] } | null {
    return this.userRelayLists.get(userPubkey) || null;
  }

  /**
   * Get blocked relays for debugging
   * 
   * @returns Array of blocked relay URLs
   */
  getBlockedRelays(): string[] {
    return Array.from(this.blockedRelays);
  }

  /**
   * Check if a relay is blocked
   * 
   * @param url - Relay URL to check
   * @returns True if relay is blocked
   */
  isRelayBlocked(url: string): boolean {
    return this.blockedRelays.has(this.normalizeRelayUrl(url));
  }
}

// Export singleton instance
export const relayService = new RelayService();
