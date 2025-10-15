import { pool } from '@nostr/gadgets/global';
import { loadRelayList } from '@nostr/gadgets/lists';
import { DEFAULT_WIKI_RELAYS, DEFAULT_SOCIAL_RELAYS, DEFAULT_WRITE_RELAYS } from '$lib/defaults';
import { createFilteredSubscription, isEventDeleted, isUserMuted } from '$lib/filtering';
import { showToast } from '$lib/toast';
import { loadBlockedRelays } from '$lib/nostr';
import type { NostrEvent } from '@nostr/tools/pure';

export type RelaySetType = 'wiki-read' | 'wiki-write' | 'social-read' | 'social-write';

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

class RelayService {
  private blockedRelays = new Set<string>();
  private userRelayLists = new Map<string, { inboxes: string[]; outboxes: string[] }>();
  private blockedRelaysLoaded = false;

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
   * Load blocked relays (kind 10006) from user's blocked relay list
   */
  private async loadBlockedRelays(userPubkey: string): Promise<void> {
    if (this.blockedRelaysLoaded) return;

    try {
      const blockedRelays = await loadBlockedRelays(userPubkey);
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
   */
  private async getRelaysForOperation(userPubkey: string, type: RelaySetType): Promise<string[]> {
    // Load blocked relays first
    await this.loadBlockedRelays(userPubkey);
    
    const userRelays = await this.loadUserRelayLists(userPubkey);
    
    let relays: string[] = [];
    
    switch (type) {
      case 'wiki-read':
        relays = [...DEFAULT_WIKI_RELAYS, ...userRelays.inboxes];
        break;
      case 'wiki-write':
        relays = [...DEFAULT_WIKI_RELAYS, ...userRelays.outboxes];
        break;
      case 'social-read':
        relays = [...DEFAULT_SOCIAL_RELAYS, ...userRelays.inboxes];
        break;
      case 'social-write':
        relays = [...DEFAULT_SOCIAL_RELAYS, ...userRelays.outboxes];
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
    
    return filteredRelays;
  }

  /**
   * Query events from relays with proper filtering
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
    
    return new Promise((resolve) => {
      const subscription = createFilteredSubscription(relays, filters, {
        onevent: (event: T) => {
          // Additional filtering is handled by createFilteredSubscription
          events.push(event);
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
      }, options);
      
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
    });
  }

  /**
   * Publish an event to relays with fallback
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
   * Get human-readable operation name for toasts
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
      default:
        return 'Event';
    }
  }

  /**
   * Clear cached relay lists (useful for testing or when user changes relays)
   */
  clearCache(): void {
    this.userRelayLists.clear();
    this.blockedRelays.clear();
    this.blockedRelaysLoaded = false;
  }

  /**
   * Get cached relay lists for a user
   */
  getCachedRelayLists(userPubkey: string): { inboxes: string[]; outboxes: string[] } | null {
    return this.userRelayLists.get(userPubkey) || null;
  }

  /**
   * Get blocked relays for debugging
   */
  getBlockedRelays(): string[] {
    return Array.from(this.blockedRelays);
  }

  /**
   * Check if a relay is blocked
   */
  isRelayBlocked(url: string): boolean {
    return this.blockedRelays.has(this.normalizeRelayUrl(url));
  }
}

// Export singleton instance
export const relayService = new RelayService();
