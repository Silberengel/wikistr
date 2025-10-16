<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { relayService } from '$lib/relayService';
  import { bareNostrUser, loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { naddrEncode } from '@nostr/tools/nip19';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { account, reactionKind, wikiKind, signer } from '$lib/nostr';
  import { formatRelativeTime, getA, getTagOr, next } from '$lib/utils';
  import { contentCache } from '$lib/contentCache';
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import UserBadge from '$components/UserBadge.svelte';
  import ArticleContent from '$components/ArticleContent.svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import { nip19 } from '@nostr/tools';

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
  let lastEventId = $state<string | null>(null);
  let userReaction = $state<NostrEvent | null>(null);
  let isVoting = $state(false); // Prevent multiple votes

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
      try {
        const result = await relayService.queryEvents(
          $account?.pubkey || 'anonymous',
          'wiki-read',
          [
            {
              authors: [pubkey],
              '#d': [dTag],
              kinds: [wikiKind]
            }
          ],
          {
            excludeUserContent: false,
            currentUserPubkey: $account?.pubkey
          }
        );

        // Find the most recent article (highest created_at)
        const articleEvent = result.events
          .filter(evt => evt.pubkey === pubkey && getTagOr(evt, 'd') === dTag && evt.kind === wikiKind)
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

        if (articleEvent) {
          event = articleEvent;
          seenOn = result.relays;
          setupLikes();
        }
      } catch (error) {
        console.error('Failed to load article:', error);
      }
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
  }

  // Effect to reload reactions when event changes
  let lastLoadTime = 0;
  $effect(() => {
    if (event && event.id !== lastEventId) {
      const now = Date.now();
      // Prevent loading too frequently (within 1 second)
      if (now - lastLoadTime > 1000) {
        lastLoadTime = now;
        lastEventId = event.id;
        console.log('Effect triggered - account state:', $account ? 'logged in' : 'anonymous', $account?.pubkey);
        console.log('Loading reactions for article:', event.id);
        loadReactions();
      }
    }
  });

  function processReactions(reactions: NostrEvent[]) {
    // Group reactions by user and get the latest one from each user
    const userReactions = new Map<string, NostrEvent>();
    
    for (const reaction of reactions) {
      console.log('Processing reaction:', reaction.content, 'from:', reaction.pubkey);
      
      const existing = userReactions.get(reaction.pubkey);
      if (!existing || reaction.created_at > existing.created_at) {
        userReactions.set(reaction.pubkey, reaction);
      }
    }
    
    // Count votes from latest reaction per user
    let likes = 0;
    let dislikes = 0;
    
    for (const reaction of userReactions.values()) {
      if (reaction.content === '+') {
        likes++;
      } else if (reaction.content === '-') {
        dislikes++;
      }
    }
    
    // Update vote counts atomically
    voteCounts = { likes, dislikes };
    
    // Find user's current reaction
    const userPubkey = $account?.pubkey;
    if (userPubkey) {
      const userReactionEvent = userReactions.get(userPubkey);
      if (userReactionEvent) {
        userReaction = userReactionEvent;
        likeStatus = userReactionEvent.content === '+' ? 'liked' : 
                    userReactionEvent.content === '-' ? 'disliked' : 'none';
      } else {
        userReaction = null;
        likeStatus = 'none';
      }
    }
    
    console.log('[snapshot] Final vote counts:', { likes, dislikes });
    console.log('Final vote counts:', $state.snapshot(voteCounts));
    console.log('User reaction:', userReaction?.id, 'Status:', likeStatus);
  }

  async function loadReactions() {
    if (!event) return;

    // TypeScript assertion that event is not null after the check above
    const articleEvent = event;

    // Reset vote counts
    voteCounts.likes = 0;
    voteCounts.dislikes = 0;
    userReaction = null;
    likeStatus = 'none';

    console.log('Loading reactions for article:', articleEvent.id);
    console.log('Account state in loadReactions:', $account ? 'logged in' : 'anonymous', $account?.pubkey);

    try {
      // First, try to get reactions from cache and display them immediately
      const cachedReactions = await contentCache.getEvents('reactions');
      const articleReactions = cachedReactions.filter(cached => 
        cached.event.tags.some(tag => tag[0] === 'e' && tag[1] === articleEvent.id)
      );
      
      let result;
      if (articleReactions.length > 0) {
        console.log(`📦 Using ${articleReactions.length} cached reactions for article: ${articleEvent.id}`);
        result = {
          events: articleReactions.map(cached => cached.event),
          relays: [...new Set(articleReactions.flatMap(cached => cached.relays))]
        };
        
        // Display cached results immediately
        processReactions(result.events);
      }
      
      // Second pass: Always query relays for fresh data and update cache
      console.log('🔄 Querying relays for fresh reactions...');
      const freshResult = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'social-read',
        [
          {
            '#e': [articleEvent.id],
            kinds: [reactionKind],
            limit: 100
          }
        ],
        {
          excludeUserContent: false,
          currentUserPubkey: $account?.pubkey
        }
      );

      // Update cache with fresh results
      if (freshResult.events.length > 0) {
        await contentCache.storeEvents('reactions', 
          freshResult.events.map(event => ({ event, relays: freshResult.relays }))
        );
      }
      
      // Update display with fresh results
      result = freshResult;
      console.log('Loaded fresh reactions from relays:', result.events.length, 'for article:', articleEvent.id);
      console.log('Using relays:', result.relays);
      
      // Process fresh reactions
      processReactions(result.events);
    } catch (error) {
      console.error('Failed to load reactions:', error);
    }
  }


  async function deleteReaction(reaction: NostrEvent) {
    if (!event) return;
    if (!$account) return;
    if (isVoting) return; // Prevent multiple operations

    isVoting = true; // Set voting state

    try {
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

      let deletion: NostrEvent;
      try {
        deletion = await signer.signEvent(deletionTemplate);
      } catch (err) {
        console.warn('failed to create deletion event', err);
        return;
      }

      // Use relay service for social event publishing
      const result = await relayService.publishEvent($account.pubkey, 'social-write', deletion);
      
      if (result.success) {
        // Update local state only if publish succeeded
        userReaction = null;
        likeStatus = 'none';
        
        // Update vote counts atomically
        voteCounts = {
          likes: Math.max(0, voteCounts.likes - (reaction.content === '+' || reaction.content === '' ? 1 : 0)),
          dislikes: Math.max(0, voteCounts.dislikes - (reaction.content === '-' ? 1 : 0))
        };
      }
    } finally {
      isVoting = false; // Reset voting state
    }
  }

  async function vote(v: '+' | '-') {
    if (!event) return;
    if (!$account) return;
    if (!canLike) return;
    if (isVoting) return; // Prevent multiple votes

    isVoting = true; // Set voting state

    try {
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
          ['e', event!.id, seenOn[0] || ''],
          ['p', event!.pubkey, seenOn[0] || '']
        ],
        content: v,
        created_at: Math.round(Date.now() / 1000)
      };

      let reaction: NostrEvent;
      try {
        reaction = await signer.signEvent(eventTemplate);
      } catch (err) {
        console.warn('failed to sign reaction', err);
        return;
      }

      // Use relay service for social event publishing
      const result = await relayService.publishEvent($account.pubkey, 'social-write', reaction);
      
      if (result.success) {
        // Update local state only if publish succeeded
        userReaction = reaction;
        likeStatus = v === '+' ? 'liked' : 'disliked';
        
        // Update vote counts atomically
        voteCounts = {
          likes: voteCounts.likes + (v === '+' ? 1 : 0),
          dislikes: voteCounts.dislikes + (v === '-' ? 1 : 0)
        };
      }
    } finally {
      isVoting = false; // Reset voting state
    }
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
      <!-- Unified voting interface -->
      <div
        class="flex flex-col items-center space-y-2 mr-3"
        class:hidden={$account?.pubkey === event.pubkey}
      >
        <!-- Like button -->
        <div class="flex flex-col items-center">
          {#if $account}
            <!-- Interactive button for logged-in users -->
            <a
              aria-label="like"
              title={isVoting ? 'Voting...' : canLike ? 'Vote up' : likeStatus === 'liked' ? 'You liked this article' : ''}
              class:cursor-pointer={canLike && !isVoting}
              class:cursor-not-allowed={isVoting}
              class:opacity-50={isVoting}
              onclick={() => vote('+')}
            >
              <svg
                style="fill: {likeStatus === 'liked' ? '#fbbf24' : '#9ca3af'};"
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
              >
            </a>
          {:else}
            <!-- Display-only for anonymous users -->
            <svg
              style="fill: #9ca3af;"
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
            >
          {/if}
          <span class="text-xs text-gray-500 mt-1">{voteCounts.likes}</span>
        </div>
        
        <!-- Dislike button -->
        <div class="flex flex-col items-center">
          {#if $account}
            <!-- Interactive button for logged-in users -->
            <a
              aria-label="dislike"
              title={isVoting ? 'Voting...' : canLike ? 'Vote down' : likeStatus === 'disliked' ? 'You disliked this article' : ''}
              class:cursor-pointer={canLike && !isVoting}
              class:cursor-not-allowed={isVoting}
              class:opacity-50={isVoting}
              onclick={() => vote('-')}
            >
              <svg
                style="fill: {likeStatus === 'disliked' ? '#fbbf24' : '#9ca3af'};"
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
              >
            </a>
          {:else}
            <!-- Display-only for anonymous users -->
            <svg
              style="fill: #9ca3af;"
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
            >
          {/if}
          <span class="text-xs text-gray-500 mt-1">{voteCounts.dislikes}</span>
        </div>
      </div>
      
      <div class="ml-2 mb-4">
        <div class="mt-2 font-bold text-4xl mb-4">{title || dTag}</div>
        <div class="flex items-center space-x-3 mb-4">
          <UserBadge pubkey={event.pubkey} {createChild} onProfileClick={handleProfileClick} size="small" />
          {#if event.created_at}
            <span class="text-xs text-gray-500 whitespace-nowrap">
              {formatRelativeTime(event.created_at)}
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
