import type { Filter } from '@nostr/tools/filter';
import type { SubCloser } from '@nostr/tools/pool';
import { relayService } from './relayService';

type OutboxParams = {
  onevent?: (event: any) => void;
  oneose?: () => void;
  receivedEvent?: (relay: any, id: string) => void;
};

export function subscribeAllOutbox(
  pubkeys: string[],
  baseFilter: Omit<Filter, 'authors'> & { limit: number },
  params: OutboxParams
): SubCloser {
  let closed = false;

  // Use relayService for all outbox queries
  Promise.all(pubkeys.map(pubkey => {
    const filter = { ...baseFilter, authors: [pubkey] } as Filter;
    return relayService.queryEvents(
      pubkey,
      'wiki-read',
      [filter],
      {
        excludeUserContent: false,
        currentUserPubkey: pubkey
      }
    );
  })).then(results => {
    if (closed) return;
    
    // Process all events from all results
    results.forEach(result => {
      result.events.forEach(event => {
        if (params.onevent) {
          params.onevent(event);
        }
      });
    });
    
    if (params.oneose) {
      params.oneose();
    }
  }).catch(error => {
    console.error('Failed to query outbox events:', error);
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

export function subscribeOutbox(
  pubkey: string,
  baseFilter: Omit<Filter, 'authors'> & { limit: number },
  params: OutboxParams
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
      // Simulate receivedEvent callback for each relay that returned this event
      if (params.receivedEvent) {
        result.relays.forEach(relay => {
          params.receivedEvent!({ url: relay }, event.id);
        });
      }
      
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
