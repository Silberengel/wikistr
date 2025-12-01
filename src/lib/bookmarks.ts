/**
 * Bookmarks and reading place management
 * 
 * Bookmarks: kind 10003 events with 'a' tags pointing to article kinds (30023, 30041, 30817, 30818, 30040)
 * Reading places: cached event IDs with timestamps
 */

import type { NostrEvent, EventTemplate } from '@nostr/tools/pure';
import { get as getStore } from 'svelte/store';
import { account, signer } from './nostr';
import { relayService } from './relayService';
import { get, set, del, keys } from 'idb-keyval';

const BOOKMARKS_KIND = 10003;
const READING_PLACE_PREFIX = 'reading-place:';
const BOOKMARKS_CACHE_KEY = 'bookmarks:10003';

// Article kinds that can be bookmarked
const BOOKMARKABLE_KINDS = [30023, 30041, 30817, 30040, 30818];

/**
 * Check if an event kind can be bookmarked
 */
export function isBookmarkableKind(kind: number): boolean {
  return BOOKMARKABLE_KINDS.includes(kind);
}

/**
 * Get the 'a' tag for an event (kind:pubkey:d-tag)
 */
export function getATag(event: NostrEvent): string {
  const dTag = event.tags.find(([k]) => k === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Add a bookmark (kind 10003) for an event
 */
export async function addBookmark(event: NostrEvent): Promise<void> {
  const { account: accountStore, signer } = await import('./nostr');
  const accountValue = getStore(accountStore);
  if (!accountValue) {
    throw new Error('Must be logged in to add bookmarks');
  }
  
  if (!isBookmarkableKind(event.kind)) {
    throw new Error(`Event kind ${event.kind} cannot be bookmarked`);
  }
  
  // Get existing bookmarks
  const existingBookmarks = await getBookmarks();
  
  // Check if already bookmarked
  const aTag = getATag(event);
  if (existingBookmarks.some(b => getATag(b) === aTag)) {
    return; // Already bookmarked
  }
  
  // Get all existing a-tags from current bookmarks
  const existingATags = existingBookmarks.map(b => getATag(b));
  existingATags.push(aTag); // Add new one
  
  // Create new bookmark event with all a-tags
  const bookmarkEvent: EventTemplate = {
    kind: BOOKMARKS_KIND,
    tags: existingATags.map(a => ['a', a]),
    content: '',
    created_at: Math.round(Date.now() / 1000)
  };
  
  // Sign and publish
  const signed = await signer.signEvent(bookmarkEvent);
  await relayService.publishEvent(
    accountValue.pubkey,
    'wiki-write',
    signed,
    false
  );
  
  // Update cache
  await refreshBookmarksCache();
}

/**
 * Remove a bookmark
 */
export async function removeBookmark(event: NostrEvent): Promise<void> {
  const { account: accountStore, signer } = await import('./nostr');
  const accountValue = getStore(accountStore);
  if (!accountValue) {
    throw new Error('Must be logged in to remove bookmarks');
  }
  
  // Get existing bookmarks
  const existingBookmarks = await getBookmarks();
  
  const aTag = getATag(event);
  const remainingBookmarks = existingBookmarks.filter(b => getATag(b) !== aTag);
  
  // Create new bookmark event without this one
  const bookmarkEvent: EventTemplate = {
    kind: BOOKMARKS_KIND,
    tags: remainingBookmarks.map(b => ['a', getATag(b)]),
    content: '',
    created_at: Math.round(Date.now() / 1000)
  };
  
  // Sign and publish
  const signed = await signer.signEvent(bookmarkEvent);
  await relayService.publishEvent(
    accountValue.pubkey,
    'wiki-write',
    signed,
    false
  );
  
  // Update cache
  await refreshBookmarksCache();
}

/**
 * Check if an event is bookmarked
 */
export async function isBookmarked(event: NostrEvent): Promise<boolean> {
  const bookmarks = await getBookmarks();
  const aTag = getATag(event);
  return bookmarks.some(b => getATag(b) === aTag);
}

/**
 * Get all bookmarks
 */
export async function getBookmarks(): Promise<NostrEvent[]> {
  const { account } = await import('./nostr');
  if (!account) {
    return [];
  }
  
  // Check cache first
  const cached = await get<NostrEvent[]>(BOOKMARKS_CACHE_KEY);
  if (cached) {
    return cached;
  }
  
  // Fetch from relays
  await refreshBookmarksCache();
  return await get<NostrEvent[]>(BOOKMARKS_CACHE_KEY) || [];
}

/**
 * Refresh bookmarks cache from relays
 */
export async function refreshBookmarksCache(): Promise<void> {
  const { account: accountStore } = await import('./nostr');
  const accountValue = getStore(accountStore);
  if (!accountValue) {
    return;
  }
  
  try {
    const result = await relayService.queryEvents(
      accountValue.pubkey,
      'wiki-read',
      [{ kinds: [BOOKMARKS_KIND], authors: [accountValue.pubkey], limit: 1 }],
      { excludeUserContent: false, currentUserPubkey: accountValue.pubkey }
    );
    
    if (result.events.length > 0) {
      // Get the most recent bookmark event
      const bookmarkEvent = result.events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
      
      // Extract 'a' tags and fetch the actual events
      const aTags = bookmarkEvent.tags.filter(([k]) => k === 'a').map(([, v]) => v);
      
      if (aTags.length > 0) {
        // Parse a-tags: kind:pubkey:d-tag
        const eventsToFetch: Array<{ kind: number; pubkey: string; dTag: string }> = [];
        for (const aTag of aTags) {
          const [kind, pubkey, dTag] = aTag.split(':');
          if (kind && pubkey && dTag) {
            eventsToFetch.push({
              kind: parseInt(kind),
              pubkey,
              dTag
            });
          }
        }
        
        // Fetch all bookmarked events
        const fetchPromises = eventsToFetch.map(({ kind, pubkey, dTag }) =>
          relayService.queryEvents(
            accountValue.pubkey,
            'wiki-read',
            [{ kinds: [kind], authors: [pubkey], '#d': [dTag], limit: 1 }],
            { excludeUserContent: false, currentUserPubkey: accountValue.pubkey }
          )
        );
        
        const results = await Promise.all(fetchPromises);
        const bookmarkedEvents: NostrEvent[] = [];
        
        for (const result of results) {
          if (result.events.length > 0) {
            bookmarkedEvents.push(result.events[0]);
          }
        }
        
        // Cache the bookmarked events
        await set(BOOKMARKS_CACHE_KEY, bookmarkedEvents);
      } else {
        await set(BOOKMARKS_CACHE_KEY, []);
      }
    } else {
      await set(BOOKMARKS_CACHE_KEY, []);
    }
  } catch (error) {
    console.error('Failed to refresh bookmarks cache:', error);
  }
}

/**
 * Save reading place for an event
 * @param eventId - The event ID to save reading place for
 * @param parentEventId - Optional parent event ID (e.g., 30040 book ID for a 30041 chapter)
 */
export async function saveReadingPlace(eventId: string, parentEventId?: string): Promise<void> {
  const timestamp = Date.now();
  const key = `${READING_PLACE_PREFIX}${eventId}`;
  const data: { timestamp: number; parentEventId?: string } = { timestamp };
  if (parentEventId) {
    data.parentEventId = parentEventId;
  }
  await set(key, data);
}

/**
 * Get all reading places (sorted by newest first)
 */
export async function getReadingPlaces(): Promise<Array<{ eventId: string; timestamp: number; parentEventId?: string }>> {
  const allKeys = await keys();
  const readingPlaceKeys = allKeys.filter((k): k is string => 
    typeof k === 'string' && k.startsWith(READING_PLACE_PREFIX)
  );
  
  const places = await Promise.all(
    readingPlaceKeys.map(async (key) => {
      const eventId = key.replace(READING_PLACE_PREFIX, '');
      const data = await get<{ timestamp: number; parentEventId?: string } | number>(key);
      
      // Handle both old format (just number) and new format (object with timestamp and parentEventId)
      if (typeof data === 'number') {
        return { eventId, timestamp: data };
      } else if (data && typeof data === 'object') {
        return { eventId, timestamp: data.timestamp || 0, parentEventId: data.parentEventId };
      } else {
        return { eventId, timestamp: 0 };
      }
    })
  );
  
  // Sort by newest first
  return places.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Remove a reading place
 */
export async function removeReadingPlace(eventId: string): Promise<void> {
  const key = `${READING_PLACE_PREFIX}${eventId}`;
  await del(key);
}

/**
 * Get reading place for an event
 */
export async function getReadingPlace(eventId: string): Promise<{ timestamp: number; parentEventId?: string } | null> {
  const key = `${READING_PLACE_PREFIX}${eventId}`;
  const data = await get<{ timestamp: number; parentEventId?: string } | number>(key);
  
  if (!data) return null;
  
  // Handle both old format (just number) and new format (object)
  if (typeof data === 'number') {
    return { timestamp: data };
  } else if (typeof data === 'object') {
    return { timestamp: data.timestamp || 0, parentEventId: data.parentEventId };
  }
  
  return null;
}

