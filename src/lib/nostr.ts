import { derived, readable } from 'svelte/store';
import * as idbkv from 'idb-keyval';

import type { EventTemplate, Event } from '@nostr/tools/pure';
import { relayService } from './relayService';
import { unique, deduplicateRelays } from './utils';
import { DEFAULT_METADATA_RELAYS } from './defaults';
import {
  loadFollowsList,
  loadRelayList,
  loadWikiAuthors,
  loadWikiRelays,
  type Result
} from '@nostr/gadgets/lists';
import { type NostrUser } from '@nostr/gadgets/metadata';
import { pool } from '@nostr/gadgets/global';

const startTime = Math.round(Date.now() / 1000);

export const reactionKind = 7;
export const wikiKind = 30818;

let setWOT: (_: string) => Promise<void>;
export const wot = readable<{ [pubkey: string]: number }>({}, (set) => {
  setWOT = async (pubkey) => {
    try {
      const cached = await idbkv.get('wikistr:wot');
      if (cached && cached.when > startTime - 7 * 24 * 60 * 60) {
        set(cached.scoremap);
        return;
      }

      const scoremap: { [pubkey: string]: number } = {};
      
      // Define recurse function inside the scope where scoremap is available
      const recurse = async (
        fetch: (srcpk: string) => Promise<Result<string>>,
        degrade: number,
        src: string,
        score: number
      ) => {
        scoremap[src] = (scoremap[src] || 0) + score;

        if (score <= degrade) return;

        const nextkeys = await fetch(src);
        await Promise.all(
          nextkeys.items.map(async (next) => {
            return recurse(fetch, degrade, next, score - degrade);
          })
        );
      };
      
      // Add timeout protection to prevent blocking
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('WOT calculation timeout')), 15000)
      );
      
      const wotPromise = Promise.all([
        recurse(loadFollowsList, 10, pubkey, 30),
        recurse(loadWikiAuthors, 6, pubkey, 30)
      ]);
      
      await Promise.race([wotPromise, timeoutPromise]);
      idbkv.set(`wikistr:wot`, { when: startTime, scoremap });
      set(scoremap);
    } catch (error) {
      console.error('WOT calculation failed:', error);
      // Set empty scoremap to prevent blocking
      set({});
    }
  };
  
  // Return cleanup function (required by readable)
  return () => {};
});

let setAccount: (_: string | null) => Promise<void>;
export const account = readable<NostrUser | null>(null, (set) => {
  setAccount = async (pubkey: string | null) => {
    if (pubkey) {
      try {
        // Load user data using relayService (only metadata-read relays)
        const { relayService } = await import('$lib/relayService');
        const result = await relayService.queryEvents(
          'anonymous',
          'metadata-read',
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          { excludeUserContent: false, currentUserPubkey: undefined }
        );
        
        let account;
        if (result.events.length > 0) {
          const event = result.events[0];
          try {
            const content = JSON.parse(event.content);
            account = {
              pubkey: pubkey,
              npub: pubkey,
              shortName: content.display_name || content.name || pubkey.slice(0, 8) + '...',
              image: content.picture || undefined,
              metadata: content,
              lastUpdated: Date.now()
            };
          } catch (e) {
            console.warn('nostr.ts: Failed to parse account metadata:', e);
            account = {
              pubkey: pubkey,
              npub: pubkey,
              shortName: pubkey.slice(0, 8) + '...',
              image: undefined,
              metadata: {},
              lastUpdated: Date.now()
            };
          }
        } else {
          account = {
            pubkey: pubkey,
            npub: pubkey,
            shortName: pubkey.slice(0, 8) + '...',
            image: undefined,
            metadata: {},
            lastUpdated: Date.now()
          };
        }
        
        idbkv.set('wikistr:loggedin', account);
        set(account);
      } catch (e) {
        console.warn('nostr.ts: Failed to load account data:', e);
        const account = {
          pubkey: pubkey,
          npub: pubkey,
          shortName: pubkey.slice(0, 8) + '...',
          image: undefined,
          metadata: {},
          lastUpdated: Date.now()
        };
        idbkv.set('wikistr:loggedin', account);
        set(account);
      }
    } else {
      set(null);
    }
  };

  // try to load account from local storage on startup with timeout protection
  setTimeout(async () => {
    try {
      const loadPromise = idbkv.get('wikistr:loggedin');
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Account loading timeout')), 5000)
      );
      
      const data = await Promise.race([loadPromise, timeoutPromise]);
      if (data && data.pubkey !== '0000000000000000000000000000000000000000000000000000000000000000') {
        set(data);
      } else {
        // Clear invalid dummy account from localStorage
        if (data && data.pubkey === '0000000000000000000000000000000000000000000000000000000000000000') {
          await idbkv.del('wikistr:loggedin');
        }
      }
    } catch (error) {
      console.error('Failed to load account from localStorage:', error);
      // Don't retry automatically to prevent loops
    }
  }, 700);
  
  // Return cleanup function (required by readable)
  return () => {};
});

// DISABLED: WOT calculation to prevent doom loops
// let lastWotPubkey: string | null = null;
// const unsub = account.subscribe((account) => {
//   if (account && account.pubkey !== lastWotPubkey) {
//     lastWotPubkey = account.pubkey;
//     console.log('Account loaded, starting WOT calculation for:', account.pubkey);
//     setTimeout(() => {
//       // Run WOT calculation in background without blocking UI
//       setWOT(account.pubkey).catch(error => {
//         console.error('Background WOT calculation failed:', error);
//       });
//       unsub();
//     }, 300);
//   } else if (!account) {
//     lastWotPubkey = null;
//     console.log('No account loaded, skipping WOT calculation');
//   }
// });

// Note: In Svelte 5, stores are automatically reactive when used with runes ($account, $wot)
// Manual subscriptions are not needed and can cause issues

// Create userWikiRelays as a readable store that subscribes to account
// Using readable instead of derived to avoid potential Svelte 5 compatibility issues
export const userWikiRelays = readable<string[]>([], (set) => {
  let cancelled = false;
  let unsubscribeAccount: (() => void) | null = null;
  
  // Subscribe to account store manually
  unsubscribeAccount = account.subscribe(async (currentAccount) => {
    if (cancelled) return;
    
    try {
      if (currentAccount) {
        const relays = await getBasicUserWikiRelays(currentAccount.pubkey);
        if (!cancelled) set(relays);
      } else {
        const relays = await relayService.getRelaysForOperation('anonymous', 'wiki-read');
        if (!cancelled) set(relays);
      }
    } catch (err) {
      console.error('Failed to get wiki relays:', err);
      if (!cancelled) {
        try {
          const defaultRelays = await relayService.getRelaysForOperation('anonymous', 'wiki-read');
          if (!cancelled) set(defaultRelays);
        } catch {
          if (!cancelled) set([]);
        }
      }
    }
  });
  
  // Return cleanup function
  return () => {
    cancelled = true;
    if (unsubscribeAccount) {
      unsubscribeAccount();
    }
  };
});

export async function loadBlockedRelays(pubkey: string, relays: string[]): Promise<string[]> {
  try {
    // Use relayService to load blocked relays
    const result = await relayService.queryEvents(
      pubkey,
      'metadata-read',
      [{ kinds: [10006], authors: [pubkey], limit: 1 }],
      {
        excludeUserContent: false,
        currentUserPubkey: pubkey
      }
    );

    const blockedRelays: string[] = [];
    for (const event of result.events) {
      // Extract relay URLs from 't' tags
      event.tags.forEach((tagArray) => {
        const [tag, value] = tagArray;
        if (tag === 't' && value) {
          blockedRelays.push(value);
        }
      });
    }
    
    return blockedRelays;
  } catch (error) {
    console.error('Failed to load blocked relays:', error);
    return [];
  }
}

export async function getBasicUserWikiRelays(pubkey: string): Promise<string[]> {
  // Get user's relay list first
  const rl1 = await loadWikiRelays(pubkey).then((rl) => rl.items);
  
  // Load blocked relays using relayService
  const blockedRelays = await loadBlockedRelays(pubkey, DEFAULT_METADATA_RELAYS);

  const normalizedBlocked = new Set(deduplicateRelays(blockedRelays));
  let list = rl1;
  
  // Normalize all relay URLs first
  list = deduplicateRelays(list);
  
  // Filter out blocked relays (using normalized comparison)
  list = list.filter(url => !normalizedBlocked.has(url));
  
  if (list.length < 2) {
    // Use relayService to get default wiki relays as fallback
    const defaultRelays = await relayService.getRelaysForOperation('anonymous', 'wiki-read');
    list = unique([...list, ...defaultRelays]);
    list = deduplicateRelays(list);
    list = list.filter(url => !normalizedBlocked.has(url));
  }

  return list;
}

export { setAccount };

export const signer = {
  getPublicKey: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nostr = (window as any).nostr;
    if (!nostr) {
      throw new Error('Nostr extension not found');
    }
    
    // Add timeout to prevent infinite blocking
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Nostr extension timeout')), 10000)
    );
    
    const pubkeyPromise = nostr.getPublicKey();
    const pubkey = await Promise.race([pubkeyPromise, timeoutPromise]) as string;
    setAccount(pubkey);
    return pubkey;
  },
  signEvent: async (event: EventTemplate): Promise<Event> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nostr = (window as any).nostr;
    if (!nostr) {
      throw new Error('Nostr extension not found');
    }
    
    // Add timeout to prevent infinite blocking
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Nostr extension timeout')), 10000)
    );
    
    const signPromise = nostr.signEvent(event);
    const se: Event = await Promise.race([signPromise, timeoutPromise]) as Event;
    setAccount(se.pubkey);
    return se;
  }
};
