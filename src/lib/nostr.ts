import { derived, readable } from 'svelte/store';
import * as idbkv from 'idb-keyval';

import type { EventTemplate, Event } from '@nostr/tools/pure';
import { DEFAULT_WIKI_RELAYS, DEFAULT_METADATA_QUERY_RELAYS } from './defaults';
import { unique, deduplicateRelays } from './utils';
import {
  loadFollowsList,
  loadRelayList,
  loadWikiAuthors,
  loadWikiRelays,
  type Result
} from '@nostr/gadgets/lists';
import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
import { pool } from '@nostr/gadgets/global';

const startTime = Math.round(Date.now() / 1000);

export const reactionKind = 7;
export const wikiKind = 30818;

let setWOT: (_: string) => Promise<void>;
export const wot = readable<{ [pubkey: string]: number }>({}, (set) => {
  setWOT = async (pubkey) => {
    const cached = await idbkv.get('wikistr:wot');
    if (cached && cached.when > startTime - 7 * 24 * 60 * 60) {
      set(cached.scoremap);
      return;
    }

    const scoremap: { [pubkey: string]: number } = {};
    await Promise.all([
      recurse(loadFollowsList, 10, pubkey, 30),
      recurse(loadWikiAuthors, 6, pubkey, 30)
    ]);
    idbkv.set(`wikistr:wot`, { when: startTime, scoremap });
    set(scoremap);

    async function recurse(
      fetch: (srcpk: string) => Promise<Result<string>>,
      degrade: number,
      src: string,
      score: number
    ) {
      scoremap[src] = (scoremap[src] || 0) + score;

      if (score <= degrade) return;

      const nextkeys = await fetch(src);
      await Promise.all(
        nextkeys.items.map(async (next) => {
          return recurse(fetch, degrade, next, score - degrade);
        })
      );
    }
  };
});

let setAccount: (_: string | null) => Promise<void>;
export const account = readable<NostrUser | null>(null, (set) => {
  setAccount = async (pubkey: string | null) => {
    if (pubkey) {
      const account = await loadNostrUser(pubkey);
      idbkv.set('wikistr:loggedin', account);
      set(account);
    } else {
      set(null);
    }
  };

  // try to load account from local storage on startup
  setTimeout(async () => {
    const data = await idbkv.get('wikistr:loggedin');
    if (data) set(data);
  }, 700);
});

const unsub = account.subscribe((account) => {
  if (account) {
    setTimeout(() => {
      setWOT(account.pubkey);
      unsub();
    }, 300);
  }
});

// ensure these subscriptions are always on
account.subscribe(() => {});
wot.subscribe(() => {});

export const userWikiRelays = derived(
  account,
  (account, set) => {
    account ? getBasicUserWikiRelays(account.pubkey).then(set) : set(DEFAULT_WIKI_RELAYS);
  },
  DEFAULT_WIKI_RELAYS
);

export async function loadBlockedRelays(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    const blockedRelays: string[] = [];
    const sub = pool.subscribeMany(
      DEFAULT_METADATA_QUERY_RELAYS,
      [{ kinds: [10006], authors: [pubkey], limit: 1 }],
      {
        onevent(event) {
          // Extract relay URLs from 't' tags
          event.tags.forEach(([tag, value]) => {
            if (tag === 't' && value) {
              blockedRelays.push(value);
            }
          });
        },
        oneose() {
          sub.close();
          resolve(blockedRelays);
        }
      }
    );

    // Timeout after 3 seconds if no response
    setTimeout(() => {
      sub.close();
      resolve(blockedRelays);
    }, 3000);
  });
}

export async function getBasicUserWikiRelays(pubkey: string): Promise<string[]> {
  const [rl1, rl2, blockedRelays] = await Promise.all([
    loadWikiRelays(pubkey).then((rl) => rl.items),
    Promise.all((await loadWikiAuthors(pubkey)).items.map((pk) => loadRelayList(pk))).then((rll) =>
      rll
        .map((rl) => rl.items)
        .flat()
        .filter((ri) => ri.write)
        .map((ri) => ri.url)
    ),
    loadBlockedRelays(pubkey)
  ]);

  const normalizedBlocked = new Set(deduplicateRelays(blockedRelays));
  let list = unique(rl1, rl2);
  
  // Normalize all relay URLs first
  list = deduplicateRelays(list);
  
  // Filter out blocked relays (using normalized comparison)
  list = list.filter(url => !normalizedBlocked.has(url));
  
  if (list.length < 2) {
    list = unique(list, DEFAULT_WIKI_RELAYS);
    list = deduplicateRelays(list);
    list = list.filter(url => !normalizedBlocked.has(url));
  }

  return list;
}

export { setAccount };

export const signer = {
  getPublicKey: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pubkey = await (window as any).nostr.getPublicKey();
    setAccount(pubkey);
    return pubkey;
  },
  signEvent: async (event: EventTemplate): Promise<Event> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const se: Event = await (window as any).nostr.signEvent(event);
    setAccount(se.pubkey);
    return se;
  }
};
