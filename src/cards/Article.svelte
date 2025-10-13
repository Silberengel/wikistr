<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { bareNostrUser, loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { naddrEncode } from '@nostr/tools/nip19';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { account, reactionKind, wikiKind, signer } from '$lib/nostr';
  import { formatDate, getA, getTagOr, next } from '$lib/utils';
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import UserLabel from '$components/UserLabel.svelte';
  import ArticleContent from '$components/ArticleContent.svelte';
  import RelayItem from '$components/RelayItem.svelte';

  interface Props {
    card: Card;
    createChild: (card: Card) => void;
    replaceSelf: (card: Card) => void;
    back: () => void;
  }

  let { card, createChild, replaceSelf, back }: Props = $props();
  let event = $state<NostrEvent | null>(null);
  let nOthers = $state<number | undefined>(undefined);
  let copied = $state(false);
  let neventCopied = $state(false);
  let likeStatus: 'liked' | 'disliked' | unknown;
  let canLike = $state<boolean | undefined>();
  let seenOn = $state<string[]>([]);
  let view = $state<'formatted' | 'asciidoc' | 'raw'>('formatted');

  const articleCard = card as ArticleCard;
  const dTag = articleCard.data[0];
  const pubkey = articleCard.data[1];

  let author = $state<NostrUser>(bareNostrUser(pubkey));

  let title = $derived(event?.tags?.find?.(([k]) => k === 'title')?.[1] || dTag);
  let summary = $derived(event?.tags?.find(([k]) => k === 'summary')?.[1]);
  let rawEvent = $derived(event ? JSON.stringify(event, null, 2) : '{...}');

  function edit() {
    replaceSelf({
      id: next(),
      type: 'editor',
      data: {
        title: title || '',
        summary: summary || '',
        content: event?.content || '',
        previous: card as ArticleCard
      }
    });
  }

  function shareCopy() {
    navigator.clipboard.writeText(
      `https://njump.me/${naddrEncode({
        kind: wikiKind,
        identifier: dTag,
        pubkey,
        relays: seenOn
      })}`
    );
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2500);
  }

  function copyNevent() {
    if (event) {
      const nevent = naddrEncode({
        kind: wikiKind,
        identifier: dTag,
        pubkey,
        relays: seenOn
      });
      navigator.clipboard.writeText(nevent);
      neventCopied = true;
      setTimeout(() => {
        neventCopied = false;
      }, 2500);
    }
  }

  function seeOthers(ev: MouseEvent) {
    if (
      articleCard.back &&
      event &&
      normalizeIdentifier((articleCard.back as any).data) === getTagOr(event, 'd')
    ) {
      // just go back
      back();
      return;
    }

    let nextCard: SearchCard = {
      id: next(),
      type: 'find',
      data: dTag,
      preferredAuthors: [] // leave empty so we ensure the list of alternatives will be shown
    };
    if (ev.button === 1) createChild(nextCard);
    else replaceSelf(nextCard);
  }

  onMount(() => {
    // load this article
    if (articleCard.actualEvent) {
      event = articleCard.actualEvent;
      seenOn = articleCard.relayHints || [];
      return;
    }

    (async () => {
      let relays = await loadRelayList(pubkey);

      pool.subscribeMany(
        relays.items
          .filter((ri) => ri.write)
          .map((ri) => ri.url)
          .concat((card as ArticleCard).relayHints || []),
        [
          {
            authors: [pubkey],
            '#d': [dTag],
            kinds: [wikiKind]
          }
        ],
        {
          id: 'article',
          receivedEvent(relay, _id) {
            if (seenOn.indexOf(relay.url) === -1) {
              seenOn.push(relay.url);
              seenOn = seenOn;
            }
          },
          onevent(evt) {
            if (!event || event.created_at < evt.created_at) {
              event = evt;
              setupLikes();
            }
          }
        }
      );
    })();

    (async () => {
      author = await loadNostrUser(pubkey);
    })();
  });

  onMount(() => {
    // redraw likes thing when we have a logged in user
    return account.subscribe(setupLikes);
  });

  onMount(() => {
    // help nostr stay by publishing articles from others into their write relays
    let to = setTimeout(async () => {
      if (event) {
        (await loadRelayList(event.pubkey)).items
          .filter((ri) => ri.write)
          .map((ri) => ri.url)
          .slice(0, 3)
          .forEach(async (url) => {
            let relay = await pool.ensureRelay(url);
            relay.publish(event!);
          });
      }
    }, 5000);

    return () => clearTimeout(to);
  });

  onMount(() => {
    // preemptively load other versions if necessary
    if (articleCard.versions) {
      nOthers = articleCard.versions.length;
      return;
    }
  });

  let cancelers: Array<() => void> = [];
  onDestroy(() => {
    cancelers.forEach((fn) => fn());
  });

  function setupLikes() {
    if (!event) return;
    if (!$account) return;

    if ($account.pubkey === event.pubkey) {
      canLike = false;
    }

    setTimeout(() => {
      if (canLike === undefined) {
        canLike = true;
      }
    }, 2500);

    //cancelers.push(
    //  cachingSub(
    //    `reaction-${eventId.slice(-8)}`,
    //    unique($userPreferredRelays.read, safeRelays),
    //    { authors: [$account.pubkey], ['#a']: [getA(event)] },
    //    (result) => {
    //      canLike = false;

    //      switch (result[0]?.content) {
    //        case '+':
    //          liked = true;
    //          break;
    //        case '-':
    //          disliked = true;
    //          break;
    //      }
    //    }
    //  )
    //);
  }

  async function vote(v: '+' | '-') {
    if (!event) return;
    if (!canLike) return;

    let eventTemplate: EventTemplate = {
      kind: reactionKind,
      tags: [
        ['a', getA(event), seenOn[0] || ''],
        ['e', event.id, seenOn[1] || seenOn[0] || '']
      ],
      content: v,
      created_at: Math.round(Date.now() / 1000)
    };

    let inboxRelays = (await loadRelayList(pubkey)).items
      .filter((ri) => ri.read)
      .map((ri) => ri.url);
    let relays = [...(card as ArticleCard).relayHints, ...inboxRelays, ...seenOn];

    let like: NostrEvent;
    try {
      like = await signer.signEvent(eventTemplate);
    } catch (err) {
      console.warn('failed to publish like', err);
      return;
    }

    relays.forEach(async (url) => {
      try {
        const r = await pool.ensureRelay(url);
        await r.publish(like);
      } catch (err) {
        console.warn('failed to publish like', event, 'to', url, err);
      }
    });
  }
</script>

<div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_missing_attribute -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  {#if event === null}
    Loading article {dTag} from {author.shortName}
  {:else}
    <div class="flex items-center">
      {#if $account}
        <div
          class="flex flex-col items-center space-y-2 mr-3"
          class:hidden={$account?.pubkey === event.pubkey}
        >
          <a
            aria-label="like"
            title={canLike ? '' : likeStatus === 'like' ? 'you considered this a good article' : ''}
            class:cursor-pointer={canLike}
            onclick={() => vote('+')}
          >
            <svg
              class:fill-stone-600={canLike}
              class:fill-cyan-500={likeStatus === 'like'}
              class:hidden={likeStatus === 'disliked'}
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
            >
          </a>
          <a
            aria-label="dislike"
            title={canLike
              ? 'this is a bad article'
              : likeStatus === 'disliked'
                ? 'you considered this a bad article'
                : ''}
            class:cursor-pointer={canLike}
            onclick={() => vote('-')}
          >
            <svg
              class:fill-stone-600={canLike}
              class:fill-rose-400={likeStatus === 'disliked'}
              class:hidden={likeStatus === 'liked'}
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
            >
          </a>
        </div>
      {/if}
      <div class="ml-2 mb-4">
        <div class="mt-2 font-bold text-4xl">{title || dTag}</div>
        <div>
          by <UserLabel pubkey={event.pubkey} {createChild} />
          {#if event.created_at}
            {formatDate(event.created_at)}
          {/if}
        </div>
        <div>
          <a class="cursor-pointer underline" onclick={edit}>
            {#if event?.pubkey === $account?.pubkey}
              Edit
            {:else}
              Fork
            {/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline" onclick={shareCopy}>
            {#if copied}Copied!{:else}Share{/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline" onmouseup={seeOthers}>{nOthers || ''} Versions</a>
          &nbsp;• &nbsp;
          {#if event}
            <button
              onclick={copyNevent}
              class="cursor-pointer underline inline-flex items-center text-gray-600 hover:text-gray-800 transition-colors"
              title="Copy nevent"
            >
              {#if neventCopied}
                <svg class="w-4 h-4 mr-1 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                Copied!
              {:else}
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                </svg>
                Copy nevent
              {/if}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Content -->
    {#if view === 'raw'}
      <div class="font-mono whitespace-pre-wrap">{rawEvent}</div>
    {:else if view === 'asciidoc'}
      <div class="prose whitespace-pre-wrap">{event.content}</div>
    {:else if view === 'formatted'}
      <div class="prose prose-p:my-0 prose-li:my-0">
        <ArticleContent {event} {createChild} />
      </div>
    {/if}

    {#if seenOn.length}
      <div class="mt-4 flex flex-wrap items-center">
        {#each seenOn as r (r)}
          <RelayItem url={r} {createChild} />
        {/each}
        <button
          onclick={() => {
            view = view === 'formatted' ? 'asciidoc' : view === 'asciidoc' ? 'raw' : 'formatted';
          }}
          class="font-normal text-xs px-1 py-0.5 mr-1 my-0.5 rounded cursor-pointer transition-colors bg-purple-300 hover:bg-purple-400 focus:outline-none"
          >see {#if view === 'formatted'}asciidoc source{:else if view === 'asciidoc'}raw event{:else}formatted{/if}</button
        >
      </div>
    {/if}
  {/if}
</div>
