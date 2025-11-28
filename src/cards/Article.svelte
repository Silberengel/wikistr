<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { EventTemplate, NostrEvent } from '@nostr/tools/pure';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { relayService } from '$lib/relayService';
  import { bareNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { naddrEncode, neventEncode } from '@nostr/tools/nip19';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { account, reactionKind, wikiKind, signer } from '$lib/nostr';
  import { formatRelativeTime, getA, getTagOr, next } from '$lib/utils';
  import { contentCache } from '$lib/contentCache';
  import { getThemeConfig } from '$lib/themes';
  import type { ArticleCard, SearchCard, Card } from '$lib/types';
  import UserBadge from '$components/UserBadge.svelte';
  import ArticleContent from '$components/ArticleContent.svelte';
  import RelayItem from '$components/RelayItem.svelte';
  import ProfilePopup from '$components/ProfilePopup.svelte';
  import Comments from '$components/Comments.svelte';
  import { nip19 } from '@nostr/tools';
  import { cards } from '$lib/state';
  import {
    downloadAsEPUB,
    downloadAsHTML5,
    downloadAsAsciiDoc,
    downloadAsMarkdown,
    downloadAsPDF,
    downloadBookAsAsciiDoc,
    downloadBookAsEPUB,
    downloadBookOverview
  } from '$lib/articleDownload';
  import { addBookmark, removeBookmark, isBookmarked, isBookmarkableKind } from '$lib/bookmarks';

  interface Props {
    card: Card;
    createChild: (card: Card) => void;
    replaceSelf: (card: Card) => void;
    back: () => void;
    expanded?: boolean;
    isDesktop?: boolean;
  }

  let { card, createChild, replaceSelf, back, expanded = false, isDesktop = false }: Props = $props();
  
  // Theme configuration
  const theme = getThemeConfig();
  
  let event = $state<NostrEvent | null>(null);
  let isLoading = $state(true);
  let nOthers = $state<number | undefined>(undefined);
  let copied = $state(false);
  let neventCopied = $state(false);
  let likeStatus = $state<'liked' | 'disliked' | 'none'>('none');
  let canLike = $state<boolean | undefined>();
  let seenOn = $state<string[]>([]);
  let view = $state<'formatted' | 'raw'>('formatted');
  let voteCounts = $state<{ likes: number; dislikes: number }>({ likes: 0, dislikes: 0 });
  let lastEventId = $state<string | null>(null);
  let userReaction = $state<NostrEvent | null>(null);
  let isVoting = $state(false); // Prevent multiple votes
  let rawJsonWordWrap = $state(true); // Word-wrap ON by default
  let rawJsonCopied = $state(false);
  let showDownloadMenu = $state(false);
  let isDownloading = $state(false);
  let isBookmarkedState = $state(false);
  let isBookmarking = $state(false);
  let errorDialogOpen = $state(false);
  let errorDialogMessage = $state('');
  let errorCopied = $state(false);

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

  // Show error dialog with copy functionality
  function showErrorDialog(message: string) {
    errorDialogMessage = message;
    errorDialogOpen = true;
    errorCopied = false;
  }

  // Copy error message to clipboard
  async function copyError() {
    try {
      await navigator.clipboard.writeText(errorDialogMessage);
      errorCopied = true;
      setTimeout(() => {
        errorCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy error message:', err);
    }
  }

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  let title = $derived(event?.tags?.find?.(([k]) => k === 'title')?.[1] || dTag);
  
  // Get emoji for event type
  function getEventEmoji(event: NostrEvent | null): string {
    if (!event) return '';
    
    // Check for wiki articles (30818, 30817, and 30023)
    if (event.kind === 30818 || event.kind === 30817 || event.kind === 30023) {
      return '📝';
    }
    
    // Check for publication events (30040 and 30041)
    if (event.kind === 30040 || event.kind === 30041) {
      // Check if it's a bible event - look for "bible" in C tag or type tag
      const cTag = event.tags.find(([k]) => k === 'C' || k === 'c');
      const typeTag = event.tags.find(([k]) => k === 'type');
      const collectionTag = event.tags.find(([k]) => k === 'collection');
      
      const isBible = 
        (cTag && cTag[1]?.toLowerCase() === 'bible') ||
        (typeTag && typeTag[1]?.toLowerCase() === 'bible') ||
        (collectionTag && collectionTag[1]?.toLowerCase() === 'bible');
      
      if (isBible) {
        return '✝️';
      } else {
        return '📖';
      }
    }
    
    return '';
  }
  
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
        image: event?.tags?.find(([k]) => k === 'image')?.[1] || '',
        author: event?.tags?.find(([k]) => k === 'author')?.[1] || '',
        previous: card as ArticleCard
      }
    });
  }

  function shareCopy() {
    const naddr = naddrEncode({
      kind: wikiKind,
      identifier: dTag,
      pubkey,
      relays: seenOn
    });
    navigator.clipboard.writeText(
      `https://next-alexandria.gitcitadel.eu/publication/naddr/${naddr}`
    );
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2500);
  }

  async function copyNevent() {
    if (event) {
      try {
        const nevent = neventEncode({
          id: event.id,
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
      isLoading = false; // Set immediately for cached events
      return;
    }

    // INSTANT: Check cache synchronously first
    // Support all wiki kinds: 30818 (AsciiDoc), 30817 (Markdown), 30040 (Index), 30041 (Content), 30023 (Long-form)
    const wikiKinds = [30818, 30817, 30040, 30041, 30023];
    const cachedEvents = contentCache.getEvents('wiki');
    const cachedArticle = cachedEvents.find(cached => 
      cached.event.pubkey === pubkey && 
      getTagOr(cached.event, 'd') === dTag && 
      wikiKinds.includes(cached.event.kind)
    );
    
    if (cachedArticle) {
      event = cachedArticle.event;
      seenOn = cachedArticle.relays;
      isLoading = false; // Set immediately - no async delay
      return; // Exit early - no need to query relays
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
        // Try to parse from tags first, then content
        let content: any = {};
        if (cachedAuthorEvent.event.tags && Array.isArray(cachedAuthorEvent.event.tags)) {
          for (const tag of cachedAuthorEvent.event.tags) {
            if (Array.isArray(tag) && tag.length >= 2) {
              const key = tag[0].toLowerCase();
              const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
              if (value && typeof value === 'string') {
                if (key === 'display_name' || key === 'displayname') content.display_name = value;
                else if (key === 'name') content.name = value;
                else if (key === 'picture' || key === 'avatar') content.picture = value;
              }
            }
          }
        }
        // Fallback to content if tags didn't provide values
        if (!content.display_name && !content.name && !content.picture) {
          content = JSON.parse(cachedAuthorEvent.event.content);
        }
        author = createAuthorFromContent(content);
      } catch (e) {
        console.warn('Article: Failed to parse cached author metadata:', e);
      }
    } else {
      // Only hit relays if not in cache
      (async () => {
        try {
        const { relayService } = await import('$lib/relayService');
        // Check cache first
        const { contentCache } = await import('$lib/contentCache');
        const cachedEvents = contentCache.getEvents('metadata');
        const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === pubkey && cached.event.kind === 0);
        
        let result: any;
        if (cachedUserEvent) {
          result = { events: [cachedUserEvent.event], relays: cachedUserEvent.relays };
        } else {
          result = await relayService.queryEvents(
            'anonymous', // Always use anonymous for metadata requests - relays are determined by type
            'metadata-read',
            [{ kinds: [0], authors: [pubkey], limit: 1 }],
            { excludeUserContent: false, currentUserPubkey: undefined }
          );
          
          // Store in cache for future use
          if (result.events.length > 0) {
            await contentCache.storeEvents('metadata', result.events.map((event: any) => ({
              event,
              relays: result.relays
            })));
          }
        }
        
        if (result.events.length > 0) {
          const event = result.events[0];
          try {
            // Try to parse from tags first, then content
            let content: any = {};
            if (event.tags && Array.isArray(event.tags)) {
              for (const tag of event.tags) {
                if (Array.isArray(tag) && tag.length >= 2) {
                  const key = tag[0].toLowerCase();
                  const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
                  if (value && typeof value === 'string') {
                    if (key === 'display_name' || key === 'displayname') content.display_name = value;
                    else if (key === 'name') content.name = value;
                    else if (key === 'picture' || key === 'avatar') content.picture = value;
                  }
                }
              }
            }
            // Fallback to content if tags didn't provide values
            if (!content.display_name && !content.name && !content.picture) {
              content = JSON.parse(event.content);
            }
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

  // Check bookmark status when event loads
  $effect(() => {
    if (event && isBookmarkableKind(event.kind)) {
      isBookmarked(event).then(bookmarked => {
        isBookmarkedState = bookmarked;
      });
    } else {
      isBookmarkedState = false;
    }
  });


  async function toggleBookmark() {
    if (!event || !isBookmarkableKind(event.kind) || !$account) return;
    
    isBookmarking = true;
    try {
      if (isBookmarkedState) {
        await removeBookmark(event);
        isBookmarkedState = false;
      } else {
        await addBookmark(event);
        isBookmarkedState = true;
      }
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
      alert('Failed to update bookmark. Please try again.');
    } finally {
      isBookmarking = false;
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
    <!-- Header Card: Image, Author, Summary (on its own line) -->
    {#if event.tags.find(([k]) => k === 'image')?.[1] || event.tags.find(([k]) => k === 'author')?.[1] || summary}
      <div class="mb-6 p-6 rounded-lg border" style="background-color: var(--bg-secondary); border-color: var(--border);">
        <div class={expanded && isDesktop ? 'flex items-start gap-4' : 'flex flex-col'}>
          {#if event.tags.find(([k]) => k === 'image')?.[1]}
            {@const imageUrl = event.tags.find(([k]) => k === 'image')?.[1]}
            <div class={expanded && isDesktop ? 'flex-shrink-0' : 'mb-4'}>
              <img 
                src={imageUrl} 
                alt={title || dTag}
                class="rounded-lg object-cover"
                style="width: 300px; height: auto;"
                onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          {/if}
          <div class="flex-1">
            {#if event.tags.find(([k]) => k === 'author')?.[1]}
              {@const authorTag = event.tags.find(([k]) => k === 'author')?.[1]}
              <div class="mb-3">
                <p class="text-sm font-semibold mb-1" style="color: var(--text-secondary);">Author</p>
                <p class="text-lg" style="color: var(--text-primary);">{authorTag}</p>
              </div>
            {/if}
            {#if summary}
              <div>
                <p class="text-sm font-semibold mb-1" style="color: var(--text-secondary);">Summary</p>
                <p class="text-base leading-relaxed" style="color: var(--text-primary);">{summary}</p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
    
    <!-- Title with voting on the left -->
    <div id="article-header" class="flex items-start gap-3 mb-4">
      <!-- Unified voting interface -->
      <div
        class="flex flex-col items-center space-y-2 flex-shrink-0"
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
      
      <div class="flex-1">
        <div class="flex items-center justify-between mb-4">
          <div class="font-bold text-4xl flex items-center gap-3" style="font-family: {theme.typography.fontFamilyHeading};">
            <span>{title || dTag}</span>
            {#if event && isBookmarkableKind(event.kind)}
              <button
                onclick={toggleBookmark}
                disabled={isBookmarking}
                class="p-1.5 rounded transition-colors disabled:opacity-50"
                style="color: {isBookmarkedState ? 'var(--accent)' : 'var(--text-secondary)'};"
                title={isBookmarkedState ? 'Remove bookmark' : 'Add bookmark'}
              >
                {#if isBookmarking}
                  <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                {:else}
                  <svg class="w-5 h-5" fill={isBookmarkedState ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                {/if}
              </button>
            {/if}
          </div>
          {#if event}
            <div class="relative">
              <button
                onclick={() => showDownloadMenu = !showDownloadMenu}
                class="px-3 py-2 rounded-lg transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-sm"
                style="color: var(--text-secondary);"
                title="Open"
              >
                ...
              </button>
              {#if showDownloadMenu}
                <div
                  class="absolute right-0 mt-2 w-56 rounded-lg shadow-lg z-50"
                  style="background-color: var(--bg-primary); border: 1px solid var(--border);"
                  onclick={(e) => e.stopPropagation()}
                >
                  <div class="py-1">
                    <div class="px-4 py-2 text-xs font-semibold" style="color: var(--text-secondary);">
                      Download:
                    </div>
                    {#if event && event.kind === 30040}
                      <!-- Book (30040) - HTML, EPUB, AsciiDoc, PDF -->
                      <button
                        onclick={async () => {
                          if (!event) return;
                          showDownloadMenu = false;
                          isDownloading = true;
                          try {
                            await downloadAsHTML5(event);
                          } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            showErrorDialog(`Failed to download HTML:\n\n${errorMessage}`);
                          } finally {
                            isDownloading = false;
                          }
                        }}
                        disabled={isDownloading}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        style="color: var(--text-primary);"
                      >
                        {#if isDownloading}
                          Downloading HTML...
                        {:else}
                          HTML
                        {/if}
                      </button>
                      <button
                        onclick={async () => {
                          if (!event) return;
                          showDownloadMenu = false;
                          isDownloading = true;
                          try {
                            await downloadBookAsEPUB(event);
                          } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            console.error('EPUB download failed:', error);
                            showErrorDialog(`Failed to download EPUB:\n\n${errorMessage}`);
                          } finally {
                            isDownloading = false;
                          }
                        }}
                        disabled={isDownloading}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        style="color: var(--text-primary);"
                      >
                        {#if isDownloading}
                          Downloading EPUB...
                        {:else}
                          EPUB
                        {/if}
                      </button>
                      <button
                        onclick={async () => {
                          if (!event) return;
                          showDownloadMenu = false;
                          isDownloading = true;
                          try {
                            await downloadBookAsAsciiDoc(event);
                          } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            showErrorDialog(`Failed to download AsciiDoc:\n\n${errorMessage}`);
                          } finally {
                            isDownloading = false;
                          }
                        }}
                        disabled={isDownloading}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        style="color: var(--text-primary);"
                      >
                        {#if isDownloading}
                          Downloading AsciiDoc...
                        {:else}
                          AsciiDoc
                        {/if}
                      </button>
                      <button
                        onclick={async () => {
                          if (!event) return;
                          showDownloadMenu = false;
                          isDownloading = true;
                          try {
                            await downloadAsPDF(event);
                          } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            showErrorDialog(`Failed to download PDF:\n\n${errorMessage}`);
                          } finally {
                            isDownloading = false;
                          }
                        }}
                        disabled={isDownloading}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        style="color: var(--text-primary);"
                      >
                        {#if isDownloading}
                          Downloading PDF...
                        {:else}
                          PDF
                        {/if}
                      </button>
                    {:else if event}
                      <!-- All events: HTML, EPUB, AsciiDoc -->
                      <button
                        onclick={async () => {
                          if (!event) return;
                          showDownloadMenu = false;
                          isDownloading = true;
                          try {
                            await downloadAsHTML5(event);
                          } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            showErrorDialog(`Failed to download HTML:\n\n${errorMessage}`);
                          } finally {
                            isDownloading = false;
                          }
                        }}
                        disabled={isDownloading}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        style="color: var(--text-primary);"
                      >
                        {#if isDownloading}
                          Downloading HTML...
                        {:else}
                          HTML
                        {/if}
                      </button>
                        <button
                          onclick={async () => {
                            if (!event) return;
                            showDownloadMenu = false;
                            isDownloading = true;
                            try {
                              await downloadAsEPUB(event);
                            } catch (error) {
                              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                              console.error('EPUB download failed:', error);
                              showErrorDialog(`Failed to download EPUB:\n\n${errorMessage}`);
                            } finally {
                              isDownloading = false;
                            }
                          }}
                          disabled={isDownloading}
                          class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                          style="color: var(--text-primary);"
                        >
                          {#if isDownloading}
                            Downloading EPUB...
                          {:else}
                            EPUB
                          {/if}
                        </button>
                        <button
                          onclick={async () => {
                            if (!event) return;
                            showDownloadMenu = false;
                            isDownloading = true;
                            try {
                              await downloadAsAsciiDoc(event);
                            } catch (error) {
                              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                              showErrorDialog(`Failed to download AsciiDoc:\n\n${errorMessage}`);
                            } finally {
                              isDownloading = false;
                            }
                          }}
                          disabled={isDownloading}
                          class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                          style="color: var(--text-primary);"
                        >
                          {#if isDownloading}
                            Downloading AsciiDoc...
                          {:else}
                            AsciiDoc
                          {/if}
                        </button>
                        {#if event && (event.kind === 30817 || event.kind === 30023)}
                          <button
                            onclick={async () => {
                              if (!event) return;
                              showDownloadMenu = false;
                              isDownloading = true;
                              try {
                                await downloadAsMarkdown(event);
                              } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                                showErrorDialog(`Failed to download Markdown:\n\n${errorMessage}`);
                              } finally {
                                isDownloading = false;
                              }
                            }}
                            disabled={isDownloading}
                            class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            style="color: var(--text-primary);"
                          >
                            {#if isDownloading}
                              Downloading Markdown...
                            {:else}
                              Markdown
                            {/if}
                          </button>
                        {/if}
                        {#if event && (event.kind === 30818 || event.kind === 30040 || event.kind === 30041 || event.kind === 30023 || event.kind === 30817)}
                          <button
                            onclick={async () => {
                              if (!event) return;
                              showDownloadMenu = false;
                              isDownloading = true;
                              try {
                                await downloadAsPDF(event);
                              } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                                showErrorDialog(`Failed to download PDF:\n\n${errorMessage}`);
                              } finally {
                                isDownloading = false;
                              }
                            }}
                            disabled={isDownloading}
                            class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            style="color: var(--text-primary);"
                          >
                            {#if isDownloading}
                              Downloading PDF...
                            {:else}
                              PDF
                            {/if}
                          </button>
                        {/if}
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
        <div class="flex items-center space-x-3 mb-4">
          {#if event.tags.find(([k]) => k === 'author')?.[1]}
            <span class="text-xs font-semibold" style="color: var(--text-primary);">
              {event.tags.find(([k]) => k === 'author')?.[1]}
            </span>
            <span class="text-xs" style="color: var(--text-secondary);">•</span>
          {/if}
          <UserBadge pubkey={event.pubkey} {createChild} onProfileClick={handleProfileClick} size="small" hideSearchIcon={false} />
          {#if event.created_at}
            <span class="text-xs whitespace-nowrap" style="color: var(--text-secondary);">
              {formatRelativeTime(event.created_at)}
            </span>
          {/if}
        </div>
      </div>
    </div>
    <div class="mb-6">
      <!-- Top row: Fork • Share • Versions • Copy Nevent -->
      <div class="mb-2">
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
          <a 
            class="cursor-pointer underline transition-colors" 
            style="color: var(--accent);" 
            onclick={copyNevent}
            title="Copy nevent"
          >
            {#if neventCopied}Copied!{:else}Copy Nevent{/if}
          </a>
        {/if}
      </div>
      
      <!-- Second row: Source button and Relay buttons -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <!-- Source Button -->
        <button
          onclick={() => {
            view = view === 'formatted' ? 'raw' : 'formatted';
          }}
          class="font-normal text-xs px-2 py-1 rounded cursor-pointer transition-colors"
          style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
        >
          see {#if view === 'formatted'}raw event{:else}formatted{/if}
        </button>
        
        <!-- Relays -->
        {#if seenOn.length}
          {#each seenOn as r (r)}
            <RelayItem url={r} {createChild} selected={selectedRelayUrl && (r === selectedRelayUrl || r.includes(selectedRelayUrl.replace(/^wss?:\/\//, '').replace(/\/$/, '')))} />
          {/each}
        {/if}
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
    {:else if view === 'formatted'}
      <div class="prose prose-p:my-0 prose-li:my-0">
        <ArticleContent {event} {createChild} {replaceSelf} relayHints={seenOn} />
      </div>
    {/if}

    <!-- Comments Section -->
    {#if event}
      <Comments {event} {createChild} />
    {/if}

    <!-- Return to top button at bottom -->
    <div class="mt-8 pt-4 border-t border-gray-300 flex justify-center">
      <button
        onclick={() => {
          // Find the card container for this specific card
          const cardContainer = document.getElementById(`wikicard-${card.id}`);
          if (cardContainer) {
            // Scroll the card container to top
            cardContainer.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            // Fallback: try to find article-header within this card's context
            const header = document.getElementById('article-header');
            if (header) {
              header.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              // Last resort: scroll window (shouldn't happen)
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }
        }}
        class="font-normal text-sm px-4 py-2 rounded cursor-pointer transition-colors"
        style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
        title="Return to top"
      >
        ↑ Return to top
      </button>
    </div>

  {/if}
</div>

<!-- Click outside to close download menu -->
{#if showDownloadMenu}
  <div
    class="fixed inset-0 z-40"
    role="button"
    tabindex="-1"
    onclick={() => showDownloadMenu = false}
    onkeydown={(e) => e.key === 'Escape' && (showDownloadMenu = false)}
    aria-label="Close menu"
  ></div>
{/if}

<!-- Error Dialog -->
{#if errorDialogOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="error-dialog-title"
  >
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black bg-opacity-50"
      role="button"
      tabindex="-1"
      onclick={() => errorDialogOpen = false}
      onkeydown={(e) => e.key === 'Escape' && (errorDialogOpen = false)}
      aria-label="Close dialog"
    ></div>
    
    <!-- Dialog -->
    <div
      class="relative rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      style="border: 1px solid var(--accent); background-color: var(--bg-primary);"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b" style="border-color: var(--accent); background-color: var(--bg-primary);">
        <h2 id="error-dialog-title" class="text-lg font-semibold" style="color: var(--text-primary);">
          Error
        </h2>
        <button
          onclick={() => errorDialogOpen = false}
          class="transition-colors hover:opacity-70"
          style="color: var(--text-secondary);"
          aria-label="Close"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4" style="background-color: var(--bg-primary);">
        <pre class="whitespace-pre-wrap font-mono text-sm p-4 rounded" style="background-color: #2d2d2d; color: #ffffff;">{errorDialogMessage}</pre>
      </div>
      
      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 p-4 border-t" style="border-color: var(--accent); background-color: var(--bg-primary);">
        <button
          onclick={copyError}
          class="px-4 py-2 rounded transition-colors hover:opacity-90"
          style="color: var(--accent); border: 1px solid var(--accent); background-color: var(--bg-primary);"
        >
          {#if errorCopied}
            ✓ Copied!
          {:else}
            Copy Error
          {/if}
        </button>
        <button
          onclick={() => errorDialogOpen = false}
          class="px-4 py-2 rounded transition-colors hover:opacity-90"
          style="background-color: var(--accent); color: white;"
        >
          OK
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
/>
