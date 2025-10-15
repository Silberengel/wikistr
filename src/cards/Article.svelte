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
  import UserBadge from '$components/UserBadge.svelte';
  import ArticleContent from '$components/ArticleContent.svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import { nip19 } from '@nostr/tools';
  import { createFilteredSubscription } from '$lib/filtering';

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
  let likeStatus = $state<'liked' | 'disliked' | 'none'>('none');
  let canLike = $state<boolean | undefined>();
  let seenOn = $state<string[]>([]);
  let view = $state<'formatted' | 'asciidoc' | 'raw'>('formatted');
  let voteCounts = $state<{ likes: number; dislikes: number }>({ likes: 0, dislikes: 0 });
  let userReaction = $state<NostrEvent | null>(null);

  const articleCard = card as ArticleCard;
  const dTag = articleCard.data[0];
  const pubkey = articleCard.data[1];

  let author = $state<NostrUser>(bareNostrUser(pubkey));

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  let title = $derived(event?.tags?.find?.(([k]) => k === 'title')?.[1] || dTag);
  let summary = $derived(event?.tags?.find(([k]) => k === 'summary')?.[1]);
  let rawEvent = $derived(event ? JSON.stringify(event, null, 2) : '{...}');

  function handleProfileClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
  }

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

  async function copyNevent() {
    if (event) {
      try {
        const nevent = naddrEncode({
          kind: wikiKind,
          identifier: dTag,
          pubkey,
          relays: seenOn
        });
        
        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(nevent);
        } else {
          // Fallback for older browsers or non-HTTPS
          const textArea = document.createElement('textarea');
          textArea.value = nevent;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        
        neventCopied = true;
        setTimeout(() => {
          neventCopied = false;
        }, 2500);
      } catch (error) {
        console.error('Failed to copy nevent:', error);
      }
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
        [
          ...relays.items
            .filter((ri) => ri.write && ri.url)
            .map((ri) => ri.url)
            .filter(url => url && url.startsWith('wss://')),
          ...((card as ArticleCard).relayHints || [])
        ],
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
          .filter((ri) => ri.write && ri.url)
          .map((ri) => ri.url)
          .filter(url => url && url.startsWith('wss://'))
          .slice(0, 3)
          .forEach(async (url) => {
            try {
              let relay = await pool.ensureRelay(url);
              relay.publish(event!);
            } catch (err) {
              console.warn('Failed to publish to relay', url, err);
            }
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

    // Load reactions for this article
    loadReactions();

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

  function loadReactions() {
    if (!event) return;

    // Load all reactions to this article
    createFilteredSubscription(
      seenOn.length > 0 ? seenOn : ['wss://relay.damus.io', 'wss://nos.lol'],
      [
        {
          '#e': [event.id],
          kinds: [reactionKind],
          limit: 100
        }
      ],
      {
        onevent(reaction) {
          // Count votes
          if (reaction.content === '+' || reaction.content === '') {
            voteCounts.likes++;
          } else if (reaction.content === '-') {
            voteCounts.dislikes++;
          }

          // Check if this is the current user's reaction
          if ($account && reaction.pubkey === $account.pubkey) {
            userReaction = reaction;
            if (reaction.content === '+' || reaction.content === '') {
              likeStatus = 'liked';
            } else if (reaction.content === '-') {
              likeStatus = 'disliked';
            }
          }
        }
      }
    );

    // Also load deletion events to handle deleted reactions
    createFilteredSubscription(
      seenOn.length > 0 ? seenOn : ['wss://relay.damus.io', 'wss://nos.lol'],
      [
        {
          kinds: [5], // deletion events
          limit: 100
        }
      ],
      {
        onevent(deletion) {
          // Check if this deletion is for a reaction to our article
          const deletedEventId = deletion.tags.find(([tag]: [string, string]) => tag === 'e')?.[1];
          if (deletedEventId && userReaction && userReaction.id === deletedEventId) {
            // Store the content before clearing userReaction
            const deletedContent = userReaction.content;
            
            // User's reaction was deleted
            userReaction = null;
            likeStatus = 'none';
            
            // Update vote counts
            if (deletedContent === '+' || deletedContent === '') {
              voteCounts.likes = Math.max(0, voteCounts.likes - 1);
            } else if (deletedContent === '-') {
              voteCounts.dislikes = Math.max(0, voteCounts.dislikes - 1);
            }
          }
        }
      }
    );
  }

  async function deleteReaction(reaction: NostrEvent) {
    if (!event) return;

    // Create deletion event (kind 5) for the reaction
    let deletionTemplate: EventTemplate = {
      kind: 5,
      tags: [
        ['e', reaction.id],
        ['k', reactionKind.toString()]
      ],
      content: 'Vote removed',
      created_at: Math.round(Date.now() / 1000)
    };

    let inboxRelays = (await loadRelayList(pubkey)).items
      .filter((ri) => ri.read && ri.url)
      .map((ri) => ri.url)
      .filter(url => url && url.startsWith('wss://'));
    let relays = [...(card as ArticleCard).relayHints, ...inboxRelays, ...seenOn];

    let deletion: NostrEvent;
    try {
      deletion = await signer.signEvent(deletionTemplate);
    } catch (err) {
      console.warn('failed to create deletion event', err);
      return;
    }

    // Update local state immediately
    userReaction = null;
    likeStatus = 'none';
    
    // Update vote counts
    if (reaction.content === '+' || reaction.content === '') {
      voteCounts.likes = Math.max(0, voteCounts.likes - 1);
    } else if (reaction.content === '-') {
      voteCounts.dislikes = Math.max(0, voteCounts.dislikes - 1);
    }

    // Publish deletion event
    relays.forEach(async (url) => {
      try {
        const r = await pool.ensureRelay(url);
        await r.publish(deletion);
      } catch (err) {
        console.warn('failed to publish deletion', event, 'to', url, err);
      }
    });
  }

  async function vote(v: '+' | '-') {
    if (!event) return;
    if (!canLike) return;

    // Check if user already voted the same way - toggle off by deleting the reaction
    if (userReaction && userReaction.content === v) {
      await deleteReaction(userReaction);
      return;
    }

    // Check if user already voted differently - delete old reaction first
    if (userReaction && userReaction.content !== v) {
      await deleteReaction(userReaction);
    }

    let eventTemplate: EventTemplate = {
      kind: reactionKind,
      tags: [
        ['e', event.id, seenOn[0] || ''],
        ['p', event.pubkey, seenOn[0] || '']
      ],
      content: v,
      created_at: Math.round(Date.now() / 1000)
    };

    let inboxRelays = (await loadRelayList(pubkey)).items
      .filter((ri) => ri.read && ri.url)
      .map((ri) => ri.url)
      .filter(url => url && url.startsWith('wss://'));
    let relays = [...(card as ArticleCard).relayHints, ...inboxRelays, ...seenOn];

    let reaction: NostrEvent;
    try {
      reaction = await signer.signEvent(eventTemplate);
    } catch (err) {
      console.warn('failed to publish reaction', err);
      return;
    }

    // Update local state immediately
    userReaction = reaction;
    likeStatus = v === '+' ? 'liked' : 'disliked';
    if (v === '+') {
      voteCounts.likes++;
    } else {
      voteCounts.dislikes++;
    }

    relays.forEach(async (url) => {
      try {
        const r = await pool.ensureRelay(url);
        await r.publish(reaction);
      } catch (err) {
        console.warn('failed to publish reaction', event, 'to', url, err);
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
          <div class="flex flex-col items-center">
            <a
              aria-label="like"
              title={canLike ? 'Vote up' : likeStatus === 'liked' ? 'You liked this article' : ''}
              class:cursor-pointer={canLike}
              onclick={() => vote('+')}
            >
              <svg
                class:fill-stone-600={likeStatus !== 'liked'}
                class:fill-cyan-500={likeStatus === 'liked'}
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
              >
            </a>
            <span class="text-xs text-gray-500 mt-1">{voteCounts.likes}</span>
          </div>
          <div class="flex flex-col items-center">
            <a
              aria-label="dislike"
              title={canLike ? 'Vote down' : likeStatus === 'disliked' ? 'You disliked this article' : ''}
              class:cursor-pointer={canLike}
              onclick={() => vote('-')}
            >
              <svg
                class:fill-stone-600={likeStatus !== 'disliked'}
                class:fill-rose-400={likeStatus === 'disliked'}
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
              >
            </a>
            <span class="text-xs text-gray-500 mt-1">{voteCounts.dislikes}</span>
          </div>
        </div>
      {/if}
      <div class="ml-2 mb-4">
        <div class="mt-2 font-bold text-4xl mb-4">{title || dTag}</div>
        <div class="flex items-center space-x-3 mb-4">
          <UserBadge pubkey={event.pubkey} {createChild} onProfileClick={handleProfileClick} size="small" />
          {#if event.created_at}
            <span class="text-xs text-gray-500 whitespace-nowrap">
              {formatDate(event.created_at)}
            </span>
          {/if}
        </div>
        <div>
          <a class="cursor-pointer underline text-burgundy-700 hover:text-burgundy-800" onclick={edit}>
            {#if event?.pubkey === $account?.pubkey}
              Edit
            {:else}
              Fork
            {/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline text-burgundy-700 hover:text-burgundy-800" onclick={shareCopy}>
            {#if copied}Copied!{:else}Share{/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline text-burgundy-700 hover:text-burgundy-800" onmouseup={seeOthers}>{nOthers || ''} Versions</a>
          &nbsp;• &nbsp;
          {#if event}
            <button
              onclick={copyNevent}
              class="p-2 text-burgundy-700 hover:text-burgundy-800 hover:bg-brown-200 rounded-lg transition-all duration-200"
              title="Copy nevent"
            >
              {#if neventCopied}
                <svg class="w-4 h-4 text-burgundy-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                </svg>
              {/if}
            </button>
            {#if neventCopied}
              <span class="text-xs text-burgundy-700 font-medium ml-2 animate-fade-in">Nevent copied!</span>
            {/if}
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
        <ArticleContent {event} {createChild} {replaceSelf} />
      </div>
    {/if}

    <!-- Article Metadata Section (always visible) -->
    <div class="mt-8 pt-4 border-t border-gray-300">
      <div class="flex flex-wrap items-center gap-2">
        <!-- Source Button (first position) -->
        <button
          onclick={() => {
            view = view === 'formatted' ? 'asciidoc' : view === 'asciidoc' ? 'raw' : 'formatted';
          }}
          class="font-normal text-xs px-2 py-1 rounded cursor-pointer transition-colors bg-brown-400 hover:bg-brown-500 text-espresso-900 focus:outline-none"
          >see {#if view === 'formatted'}asciidoc source{:else if view === 'asciidoc'}raw event{:else}formatted{/if}</button
        >
        
        <!-- Relays (after source button) -->
        {#if seenOn.length}
          {#each seenOn as r (r)}
            <RelayItem url={r} {createChild} />
          {/each}
        {/if}
      </div>
    </div>

  {/if}
</div>

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
  {createChild}
/>
