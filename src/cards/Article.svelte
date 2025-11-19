<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { relayService } from '$lib/relayService';
  import { bareNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
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
  import Comments from '$components/Comments.svelte';
  import { nip19 } from '@nostr/tools';
  import { cards } from '$lib/state';

  interface Props {
    card: Card;
    createChild: (card: Card) => void;
    replaceSelf: (card: Card) => void;
    back: () => void;
  }

  let { card, createChild, replaceSelf, back }: Props = $props();
  let event = $state<NostrEvent | null>(null);
  let isLoading = $state(true);
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
  let rawJsonWordWrap = $state(true); // Word-wrap ON by default
  let rawJsonCopied = $state(false);

  const articleCard = card as ArticleCard;
  const dTag = articleCard.data[0];
  const pubkey = articleCard.data[1];

  let author = $state<NostrUser>(bareNostrUser(pubkey));

  // Helper function to create fallback author object
  function createFallbackAuthor() {
    return {
      pubkey: pubkey,
      npub: pubkey,
      shortName: pubkey.slice(0, 8) + '...',
      image: undefined,
      metadata: {},
      lastUpdated: Date.now()
    };
  }

  // Helper function to create author object from parsed content
  function createAuthorFromContent(content: any) {
    return {
      pubkey: pubkey,
      npub: pubkey,
      shortName: content.display_name || content.name || pubkey.slice(0, 8) + '...',
      image: content.picture || undefined,
      metadata: content,
      lastUpdated: Date.now()
    };
  }

  // Helper function to create events to store in cache
  function createEventsToStore(event: NostrEvent, relays: string[]) {
    return [{
      event,
      relays
    }];
  }

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  let title = $derived(event?.tags?.find?.(([k]) => k === 'title')?.[1] || dTag);
  
  // Get the currently selected relay URL from the cards array
  const selectedRelayUrl = $derived.by(() => {
    const relayCard = $cards.find(card => card.type === 'relay');
    return relayCard ? (relayCard as any).data : null;
  });
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
    // load this article - INSTANT CACHE LOOKUP
    if (articleCard.actualEvent) {
      event = articleCard.actualEvent;
      seenOn = articleCard.relayHints || [];
      return;
    }

    // INSTANT: Check cache synchronously first
    // Support all wiki kinds: 30818 (AsciiDoc), 30817 (Markdown), 30040 (Index), 30041 (Content)
    const wikiKinds = [30818, 30817, 30040, 30041];
    const cachedEvents = contentCache.getEvents('wiki');
    const cachedArticle = cachedEvents.find(cached => 
      cached.event.pubkey === pubkey && 
      getTagOr(cached.event, 'd') === dTag && 
      wikiKinds.includes(cached.event.kind)
    );
    
    if (cachedArticle) {
      event = cachedArticle.event;
      seenOn = cachedArticle.relays;
      isLoading = false;
    } else {
      // Only hit relays if not in cache
      (async () => {
        try {
          const result = await relayService.queryEvents(
            $account?.pubkey || 'anonymous',
            'wiki-read',
            [
              {
                authors: [pubkey],
                '#d': [dTag],
                kinds: wikiKinds
              }
            ],
            {
              excludeUserContent: false,
              currentUserPubkey: $account?.pubkey
            }
          );

          // Find the most recent article (highest created_at)
          const articleEvent = result.events
            .filter(evt => evt.pubkey === pubkey && getTagOr(evt, 'd') === dTag && wikiKinds.includes(evt.kind))
            .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

          if (articleEvent) {
            event = articleEvent;
            seenOn = result.relays;
            
            // Store the article in cache for future use
            const eventsToStore = createEventsToStore(articleEvent, result.relays);
            await contentCache.storeEvents('wiki', eventsToStore);
          }
          isLoading = false;
        } catch (error) {
          console.error('Failed to load article:', error);
          isLoading = false;
        }
      })();
    }
  });

  onMount(() => {
    // Load author data using relayService (only metadata-read relays)
    // INSTANT: Check cache first for author metadata
    const cachedEvents = contentCache.getEvents('metadata');
    const cachedAuthorEvent = cachedEvents.find(cached => 
      cached.event.pubkey === pubkey && cached.event.kind === 0
    );
    
    if (cachedAuthorEvent) {
      try {
        const content = JSON.parse(cachedAuthorEvent.event.content);
        author = createAuthorFromContent(content);
      } catch (e) {
        console.warn('Article: Failed to parse cached author metadata:', e);
      }
    } else {
      // Only hit relays if not in cache
      (async () => {
        try {
        const { relayService } = await import('$lib/relayService');
        const result = await relayService.queryEvents(
          'anonymous', // Always use anonymous for metadata requests - relays are determined by type
          'metadata-read',
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          { excludeUserContent: false, currentUserPubkey: undefined }
        );
        
        if (result.events.length > 0) {
          const event = result.events[0];
          try {
            const content = JSON.parse(event.content);
            author = createAuthorFromContent(content);
            
            // Store the author metadata in cache for future use
            const eventsToStore = createEventsToStore(event, result.relays);
            await contentCache.storeEvents('metadata', eventsToStore);
          } catch (e) {
            console.warn('Article: Failed to parse author metadata:', e);
            author = createFallbackAuthor();
          }
        } else {
          author = createFallbackAuthor();
        }
      } catch (e) {
        console.warn('Article: Failed to load author data:', e);
        author = createFallbackAuthor();
      }
    })();
    }
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
        loadReactions();
      }
    }
  });

  function processReactions(reactions: NostrEvent[]) {
    // Group reactions by user and get the latest one from each user
    const userReactions = new Map<string, NostrEvent>();
    
    for (const reaction of reactions) {
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

    try {
      // First, try to get reactions from cache and display them immediately
      const cachedReactions = await contentCache.getEvents('reactions');
      const articleReactions = cachedReactions.filter(cached => 
        cached.event.tags.some(tag => tag[0] === 'e' && tag[1] === articleEvent.id)
      );
      
      if (articleReactions.length > 0) {
        const result = {
          events: articleReactions.map(cached => cached.event),
          relays: [...new Set(articleReactions.flatMap(cached => cached.relays))]
        };
        
        // Display cached results immediately and exit - don't query relays
        processReactions(result.events);
        return;
      }
      
      // Only query relays if no cached reactions found
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
      
      // Process fresh reactions
      processReactions(freshResult.events);
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
  {#if isLoading}
    <div class="flex items-center justify-center py-12">
      <div class="flex flex-col items-center space-y-4">
        <div class="spinner" style="width: 48px; height: 48px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <p class="text-lg" style="color: var(--text-secondary);">Loading article...</p>
      </div>
    </div>
  {:else if event === null}
    <div class="px-4 py-5 border-2 border-stone rounded-lg mt-2 min-h-[48px]" style="background-color: var(--theme-bg);">
      <p class="mb-2">Can't find this article.</p>
      <button
        class="px-4 py-2 rounded"
        style="background-color: var(--accent); color: white;"
        onclick={() => createChild({ id: next(), type: 'editor', data: { title: dTag, summary: '', content: '' } } as any)}
      >
        Create this article!
      </button>
    </div>
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
                style="fill: {likeStatus === 'liked' ? 'var(--accent)' : 'var(--text-muted)'};"
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
              >
            </a>
          {:else}
            <!-- Display-only for anonymous users -->
            <svg
              style="fill: var(--text-muted);"
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 12h16L9 4l-8 8Z"></path></svg
            >
          {/if}
          <span class="text-xs mt-1" style="color: var(--text-secondary);">{voteCounts.likes}</span>
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
                style="fill: {likeStatus === 'disliked' ? 'var(--accent)' : 'var(--text-muted)'};"
                width="18"
                height="18"
                viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
              >
            </a>
          {:else}
            <!-- Display-only for anonymous users -->
            <svg
              style="fill: var(--text-muted);"
              width="18"
              height="18"
              viewBox="0 0 18 18"><path d="M1 6h16l-8 8-8-8Z"></path></svg
            >
          {/if}
          <span class="text-xs mt-1" style="color: var(--text-secondary);">{voteCounts.dislikes}</span>
        </div>
      </div>
      
      <div class="ml-2 mb-4">
        <div class="mt-2 font-bold text-4xl mb-4">{title || dTag}</div>
        <div class="flex items-center space-x-3 mb-4">
          <UserBadge pubkey={event.pubkey} {createChild} onProfileClick={handleProfileClick} size="small" hideSearchIcon={false} />
          {#if event.created_at}
            <span class="text-xs whitespace-nowrap" style="color: var(--text-secondary);">
              {formatRelativeTime(event.created_at)}
            </span>
          {/if}
        </div>
        <div>
          <a class="cursor-pointer underline transition-colors" style="color: var(--accent);" onclick={edit}>
            {#if event?.pubkey === $account?.pubkey}
              Edit
            {:else}
              Fork
            {/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline transition-colors" style="color: var(--accent);" onclick={shareCopy}>
            {#if copied}Copied!{:else}Share{/if}
          </a>
          &nbsp;• &nbsp;
          <a class="cursor-pointer underline transition-colors" style="color: var(--accent);" onmouseup={seeOthers}>{nOthers || ''} Versions</a>
          &nbsp;• &nbsp;
          {#if event}
            <button
              onclick={copyNevent}
              class="p-2 rounded-lg transition-all duration-200"
              style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
              title="Copy nevent"
            >
              {#if neventCopied}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                </svg>
              {/if}
            </button>
            {#if neventCopied}
              <span class="text-xs font-medium ml-2 animate-fade-in" style="color: var(--accent);">Nevent copied!</span>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <!-- Content -->
    {#if view === 'raw'}
      <div class="relative">
        <div class="absolute top-2 right-2 flex gap-2 z-10">
          <button
            onclick={() => {
              rawJsonWordWrap = !rawJsonWordWrap;
            }}
            class="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title={rawJsonWordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            style="color: var(--text-secondary);"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
          </button>
          <button
            onclick={async () => {
              try {
                await navigator.clipboard.writeText(rawEvent);
                rawJsonCopied = true;
                setTimeout(() => { rawJsonCopied = false; }, 2000);
              } catch (e) {
                console.error('Failed to copy:', e);
              }
            }}
            class="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Copy JSON"
            style="color: var(--text-secondary);"
          >
            {#if rawJsonCopied}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" style="color: var(--accent);">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
            {/if}
          </button>
        </div>
        <div class="font-mono {rawJsonWordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'}">{rawEvent}</div>
      </div>
    {:else if view === 'asciidoc'}
      <div class="prose whitespace-pre-wrap">{event.content}</div>
    {:else if view === 'formatted'}
      <div class="prose prose-p:my-0 prose-li:my-0">
        <ArticleContent {event} {createChild} {replaceSelf} />
      </div>
    {/if}

    <!-- Comments Section -->
    {#if event}
      <Comments {event} {createChild} />
    {/if}

    <!-- Article Metadata Section (always visible) -->
    <div class="mt-8 pt-4 border-t border-gray-300">
      <div class="flex flex-wrap items-center gap-2">
        <!-- Source Button (first position) -->
        <button
          onclick={() => {
            view = view === 'formatted' ? 'asciidoc' : view === 'asciidoc' ? 'raw' : 'formatted';
          }}
          class="font-normal text-xs px-2 py-1 rounded cursor-pointer transition-colors"
          style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
          >see {#if view === 'formatted'}asciidoc source{:else if view === 'asciidoc'}raw event{:else}formatted{/if}</button
        >
        
        <!-- Relays (after source button) -->
        {#if seenOn.length}
          {#each seenOn as r (r)}
            <RelayItem url={r} {createChild} selected={selectedRelayUrl && (r === selectedRelayUrl || r.includes(selectedRelayUrl.replace(/^wss?:\/\//, '').replace(/\/$/, '')))} />
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
/>
