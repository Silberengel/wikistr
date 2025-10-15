import type { Filter } from '@nostr/tools/filter';
import type { SubCloser, SubscribeManyParams } from '@nostr/tools/pool';
import { pool } from '@nostr/gadgets/global';
import { loadRelayList } from '@nostr/gadgets/lists';
import { outboxFilterRelayBatch } from '@nostr/gadgets/outbox';
import { createFilteredSubscription } from './filtering';
import { relayService } from './relayService';

export function subscribeAllOutbox(
  pubkeys: string[],
  baseFilter: Omit<Filter, 'authors'> & { limit: number },
  params: SubscribeManyParams
): SubCloser {
  let closed = false;
  let subc: SubCloser;

  outboxFilterRelayBatch(pubkeys, baseFilter).then((requests) => {
    subc = pool.subscribeMap(requests, { id: 'alloutbox', ...params } as any);
    if (closed) {
      subc.close();
    }
  });

  return {
    close() {
      if (subc) {
        subc.close();
      }
      closed = true;
    }
  };
}

export function subscribeOutbox(
  pubkey: string,
  baseFilter: Omit<Filter, 'authors'> & { limit: number },
  params: SubscribeManyParams
): SubCloser {
  let closed = false;
  let subc: SubCloser;

  const filter = baseFilter as Filter;
  filter.authors = [pubkey];

  // Use relay service for outbox queries
  relayService.queryEvents(
    pubkey,
    'wiki-read', // Use wiki-read for outbox queries
    [filter],
    {
      excludeUserContent: false,
      currentUserPubkey: pubkey
    }
  ).then(result => {
    if (closed) return;
    
    // Process events and call the original handlers
    result.events.forEach(event => {
      if (params.onevent) {
        params.onevent(event);
      }
    });
    
    if (params.oneose) {
      params.oneose();
    }
  });

  return {
    close() {
      closed = true;
    }
  };
}
