<script lang="ts">
  import { nip19 } from '@nostr/tools';
  import { account, signer } from '$lib/nostr';
  import { pool } from '@nostr/gadgets/global';
  import UserBadge from './UserBadge.svelte';
  import AsciidocContent from './AsciidocContent.svelte';
  import ProfilePopup from './ProfilePopup.svelte';
  import ReplyToBlurb from './ReplyToBlurb.svelte';
  import { browser } from '$app/environment';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { formatRelativeTime } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  import { contentCache } from '$lib/contentCache';

  // Theme configuration
  const theme = getThemeConfig();

  interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }

  interface Props {
    event: NostrEvent;
    createChild?: ((card: any) => void) | undefined;
  }

  let { event, createChild }: Props = $props();
  
  // Generate the coordinate for the wiki article (kind:pubkey:identifier format)
  // This follows NIP-22: kind 1111 comments reference their root using this coordinate
  const articleCoordinate = $derived.by(() => {
    const identifier = event.tags.find(([k]) => k === 'd')?.[1] || event.id;
    return `${event.kind}:${event.pubkey}:${identifier}`;
  });

  let comments = $state<NostrEvent[]>([]);
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');
  let commentText = $state('');
  let isSubmitting = $state(false);
  let copiedNevent = $state<Set<string>>(new Set());
  let copiedNeventMessage = $state<Set<string>>(new Set());
  let publishStatus = $state({ show: false, title: '', attempts: [] as Array<{ status: 'pending' | 'success' | 'failure', message?: string }> });

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  interface ThreadedComment {
    comment: NostrEvent;
    replies: ThreadedComment[];
    isDeeplyNested?: boolean;
    originalParentId?: string;
  }

  function organizeCommentsIntoThreads(comments: NostrEvent[]): ThreadedComment[] {
    const commentMap = new Map<string, ThreadedComment>();
    const topLevelComments: ThreadedComment[] = [];

    // First pass: create threaded comment objects
    comments.forEach(comment => {
      commentMap.set(comment.id, {
        comment,
        replies: []
      });
    });

    // Helper function to calculate the depth of a comment
    function calculateDepth(comment: NostrEvent, visited = new Set<string>()): number {
      if (visited.has(comment.id)) return 0; // Prevent infinite loops
      visited.add(comment.id);
      
      const parentETag = comment.tags.find(([k]: string[]) => k === 'e');
      const parentKTag = comment.tags.find(([k]: string[]) => k === 'k');
      
      if (parentETag && parentKTag && parentKTag[1] === '1111') {
        // This is a reply to another comment
        const parentId = parentETag[1];
        const parentComment = comments.find(c => c.id === parentId);
        if (parentComment) {
          return 1 + calculateDepth(parentComment, visited);
        }
      }
      
      return 1; // Root level
    }

    // Second pass: organize into hierarchy with 3-level limit
    comments.forEach(comment => {
      const threadedComment = commentMap.get(comment.id)!;
      const depth = calculateDepth(comment);
      
      // Check if this is a reply to another comment
      const parentETag = comment.tags.find(([k]: string[]) => k === 'e');
      const parentKTag = comment.tags.find(([k]: string[]) => k === 'k');
      
      if (parentETag && parentKTag && parentKTag[1] === '1111') {
        // This is a reply to another comment
        const parentId = parentETag[1];
        const parent = commentMap.get(parentId);
        
        if (parent && depth <= 3) {
          // Normal hierarchy for levels 1-3
          parent.replies.push(threadedComment);
        } else {
          // Level 4+ or parent not found, treat as top-level but mark as deeply nested
          threadedComment.isDeeplyNested = true;
          threadedComment.originalParentId = parentId;
          topLevelComments.push(threadedComment);
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(threadedComment);
      }
    });

    // Sort top-level comments and their replies by creation time (oldest to newest)
    function sortThreadedComments(threaded: ThreadedComment[]): ThreadedComment[] {
      return threaded.sort((a, b) => (a.comment.created_at || 0) - (b.comment.created_at || 0));
    }

    function sortReplies(threaded: ThreadedComment): ThreadedComment {
      if (threaded.replies.length > 0) {
        threaded.replies = sortThreadedComments(threaded.replies);
        threaded.replies = threaded.replies.map(sortReplies);
      }
      return threaded;
    }

    const sortedTopLevel = sortThreadedComments(topLevelComments);
    return sortedTopLevel.map(sortReplies);
  }

  const threadedComments = $derived(organizeCommentsIntoThreads(comments));

  function startReply(commentId: string) {
    replyingTo = commentId;
    replyText = '';
  }

  async function submitTopLevelComment(evt: Event) {
    evt.preventDefault();
    
    if (!commentText.trim() || isSubmitting || !$account) return;
    
    isSubmitting = true;
    
    try {
      const commentEvent = {
        kind: 1111,
        content: commentText.trim(),
        tags: [
          ['A', articleCoordinate, 'wss://relay.example.com', 'article'],
          ['K', event.kind.toString()]
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: $account.pubkey
      };

      publishStatus.show = true;
      publishStatus.title = 'Publishing comment...';
      publishStatus.attempts = [];

      // Use relay service for comment publishing
      if (!$account) return;
      
      const result = await relayService.publishEvent(
        $account.pubkey,
        'social-write',
        commentEvent as any, // Cast to proper NostrEvent type
        false // Don't show toast for comments
      );
      
      const attempts = result.publishedTo.concat(result.failedRelays).map((relay: string) => ({
        status: result.publishedTo.includes(relay) ? 'success' as const : 'failure' as const,
        url: relay,
        message: result.publishedTo.includes(relay) ? 'Published' : 'Failed'
      }));
      publishStatus.attempts = attempts;

      // Update the comment event tags with proper NIP-22 format
      commentEvent.tags = [
        ['A', articleCoordinate, 'article'],
        ['K', event.kind.toString()]
      ];

      // Sign the event first
      const signedEvent = await signer.signEvent(commentEvent);
      
      // Clear the form
      commentText = '';
      
      // Refresh comments after a short delay
      setTimeout(() => {
        fetchComments();
      }, 1000);
      
      // If there are successful publications, keep modal open longer to show success
      if (result.publishedTo.length > 0) {
        setTimeout(() => {
          publishStatus.show = false;
        }, 4000); // Show success for 4 seconds
      } else {
        // No successful publications, close immediately
        publishStatus.show = false;
      }
      
    } catch (error) {
      console.error('Error publishing comment:', error);
      // On error, close modal immediately
      publishStatus.show = false;
    } finally {
      isSubmitting = false;
    }
  }

  function cancelReply() {
    replyingTo = null;
    replyText = '';
  }

  function handleProfileClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
  }

  async function copyCommentNevent(commentId: string) {
    try {
      const nevent = nip19.neventEncode({ id: commentId });
      
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
      
      copiedNevent.add(commentId);
      copiedNeventMessage.add(commentId);
      
      // Hide checkmark after 2.5 seconds
      setTimeout(() => {
        copiedNevent.delete(commentId);
        copiedNevent = copiedNevent; // Trigger reactivity
      }, 2500);
      
      // Hide message after 3 seconds
      setTimeout(() => {
        copiedNeventMessage.delete(commentId);
        copiedNeventMessage = copiedNeventMessage; // Trigger reactivity
      }, 3000);
    } catch (error) {
      console.error('Failed to copy nevent:', error);
    }
  }

  function getParentCommentText(comment: NostrEvent): string {
    const parentETag = comment.tags.find(([k]: string[]) => k === 'e');
    if (parentETag) {
      const parentId = parentETag[1];
      const parentComment = comments.find(c => c.id === parentId);
      if (parentComment) {
        // Truncate to first 100 characters and add ellipsis if needed
        const text = parentComment.content.trim();
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }
    return '';
  }

  async function submitReply(parentComment: NostrEvent) {
    if (!replyText.trim() || isSubmitting) return;
    
    isSubmitting = true;
    
    try {
      const commentEvent = {
        kind: 1111,
        content: replyText.trim(),
        tags: [
          ['A', articleCoordinate, 'wss://relay.example.com', 'article'],
          ['e', parentComment.id, 'wss://relay.example.com', 'reply'],
          ['K', event.kind.toString()],
          ['p', parentComment.pubkey]
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: $account?.pubkey || ''
      };

      publishStatus.show = true;
      publishStatus.title = 'Publishing comment...';
      publishStatus.attempts = [];

      // Get user's actual inbox relays (kind 10002) for publishing comments
      const socialRelays = await relayService.getRelaysForOperation($account?.pubkey || 'anonymous', 'social-write'); // Using relayService
      let userInboxRelays: string[] = [];
      
      if ($account) {
        try {
          const relayList = await loadRelayList($account.pubkey);
          userInboxRelays = relayList.items
            .filter((ri) => ri.write)
            .map((ri) => ri.url);
        } catch (error) {
          console.error('Error loading user inbox relays for publishing:', error);
        }
      }
      
      const relays = [...new Set([...socialRelays, ...userInboxRelays])];
      const attempts = relays.map(relay => ({ status: 'pending' as const }));
      publishStatus.attempts = attempts;

      // Update the comment event tags with proper NIP-22 format
      commentEvent.tags = [
        ['A', articleCoordinate, relays[0], 'article'],
        ['e', parentComment.id, relays[0], 'reply'],
        ['K', event.kind.toString()],
        ['p', parentComment.pubkey]
      ];

      // Sign the event first
      const signedEvent = await signer.signEvent(commentEvent);
      
      const promises = relays.map(async (relay, index) => {
        try {
          await pool.publish([relay], signedEvent);
          publishStatus.attempts[index] = { status: 'success' };
        } catch (error) {
          publishStatus.attempts[index] = { 
            status: 'failure', 
            message: error instanceof Error ? error.message : 'Unknown error' 
          };
        }
      });

      await Promise.all(promises);
      
      // Reset form
      replyingTo = null;
      replyText = '';
      
      // Refresh comments after a short delay
      setTimeout(() => {
        fetchComments();
      }, 1000);
      
      // If there are successful publications, keep modal open longer to show success
      const successCount = publishStatus.attempts.filter(a => a.status === 'success').length;
      if (successCount > 0) {
        setTimeout(() => {
          publishStatus.show = false;
        }, 4000); // Show success for 4 seconds
      } else {
        // No successful publications, close immediately
        publishStatus.show = false;
      }
      
    } catch (error) {
      console.error('Error submitting reply:', error);
      // On error, close modal immediately
      publishStatus.show = false;
    } finally {
      isSubmitting = false;
    }
  }


  function processComments(commentEvents: NostrEvent[]) {
    // Client-side filtering for our specific wiki article
    const filteredComments = commentEvents.filter(commentEvent => {
      const aTag = commentEvent.tags.find(([k]) => k === 'A');
      const kTag = commentEvent.tags.find(([k]) => k === 'K');
      
      // Check if this comment references our wiki article
      return aTag && aTag[1] === articleCoordinate && 
             kTag && kTag[1] === event.kind.toString();
    });

    comments = filteredComments;
    console.log('Processed comments:', filteredComments.length);
  }

  async function fetchComments() {
    if (!browser) return;
    
    try {
      let result;
      
      // First, try to get comments from cache and display them immediately
      const cachedComments = await contentCache.getEvents('kind1111');
      
      if (cachedComments.length > 0) {
        console.log(`📦 Using ${cachedComments.length} cached comments`);
        result = {
          events: cachedComments.map(cached => cached.event),
          relays: [...new Set(cachedComments.flatMap(cached => cached.relays))]
        };
        
        // Display cached results immediately
        processComments(result.events);
      }
      
      // Second pass: Always query relays for fresh data and update cache
      console.log('🔄 Querying relays for fresh comments...');
      const freshResult = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'social-read',
        [
          {
            kinds: [1111],
            limit: 200
          }
        ],
        {
          excludeUserContent: false,
          currentUserPubkey: $account?.pubkey
        }
      );
      
      // Update cache with fresh results
      if (freshResult.events.length > 0) {
        await contentCache.storeEvents('kind1111', 
          freshResult.events.map(event => ({ event, relays: freshResult.relays }))
        );
      }
      
      // Update display with fresh results
      result = freshResult;
      console.log('Loaded fresh comments from relays:', result.events.length);
      
      // Process fresh comments
      processComments(result.events);
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  }

  // Fetch comments when component mounts
  $effect(() => {
    if (event) {
      fetchComments();
    }
  });
</script>

<div class="mt-6">
  <h3 class="text-lg font-semibold mb-4" style="color: var(--text-primary);">Comments</h3>
  
  <!-- Comment Entry Form -->
  {#if $account}
    <div class="mb-6 p-4 rounded-lg border" style="background-color: var(--bg-secondary); border-color: var(--border);">
      <form onsubmit={submitTopLevelComment}>
        <div class="mb-3">
          <textarea
            bind:value={commentText}
            placeholder="Write a comment..."
            class="w-full p-3 border rounded-lg transition-colors resize-none"
            style="font-family: {theme.typography.fontFamily};"
            rows="3"
            disabled={isSubmitting}
          ></textarea>
        </div>
        <div class="flex justify-end">
          <button
            type="submit"
            class="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            style="font-family: {theme.typography.fontFamily};"
            disabled={!commentText.trim() || isSubmitting}
          >
            {isSubmitting ? 'Posting...' : 'Post Comment'}
          </button>
        </div>
      </form>
    </div>
  {:else}
    <div class="mb-6 p-4 rounded-lg border text-center" style="background-color: var(--bg-secondary); border-color: var(--border);">
      <p style="color: var(--text-secondary);">Please sign in to post comments.</p>
    </div>
  {/if}
  
  {#if comments.length === 0}
    <p class="text-center py-8" style="color: var(--text-secondary);">No comments yet. Be the first to comment!</p>
  {:else}
    <div class="space-y-4">
      {#each threadedComments as threadedComment (threadedComment.comment.id)}
        {@const comment = threadedComment.comment}
        <!-- Top-level comment -->
        <div class="py-2 px-4 rounded-lg border" style="background-color: var(--bg-primary); border-color: var(--border);">
          <div class="flex items-center mb-1">
            <div class="flex items-center space-x-3 flex-1 min-w-0">
              <UserBadge pubkey={comment.pubkey} {createChild} onProfileClick={handleProfileClick} size="tiny" hideSearchIcon={false} />
              <span class="text-xs whitespace-nowrap" style="color: var(--text-secondary);">
                {formatRelativeTime(comment.created_at)}
              </span>
            </div>
            
            <div class="flex items-center space-x-2 flex-shrink-0 ml-2">
              <button
                onclick={() => copyCommentNevent(comment.id)}
                class="p-2 rounded-lg transition-all duration-200"
                style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                title="Copy nevent"
              >
                {#if copiedNevent.has(comment.id)}
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                {:else}
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                  </svg>
                {/if}
              </button>
              {#if copiedNeventMessage.has(comment.id)}
                <span class="text-xs font-medium animate-fade-in" style="color: var(--accent);">Nevent copied!</span>
              {/if}
              {#if $account}
                <button
                  onclick={() => startReply(comment.id)}
                  class="p-2 rounded-lg transition-all duration-200"
                  style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                  disabled={isSubmitting}
                  title="Reply"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          
          <!-- Show blurb if this is a reply -->
          {#if comment.tags.find(([k]) => k === 'e')}
            {@const parentETag = comment.tags.find(([k]) => k === 'e')}
            {#if parentETag}
              {@const parentComment = comments.find(c => c.id === parentETag[1])}
              {#if parentComment}
                {#if threadedComment.isDeeplyNested}
                  <ReplyToBlurb pubkey={parentComment.pubkey} content={parentComment.content} variant="deeply-nested" />
                {:else}
                  <ReplyToBlurb pubkey={parentComment.pubkey} content={parentComment.content} variant="inline" />
                {/if}
              {/if}
            {/if}
          {/if}

          <div class="leading-relaxed mb-4" style="color: var(--text-primary);">
            <AsciidocContent event={comment} createChild={() => {}} />
          </div>

          <!-- Reply Form for top-level comment -->
          {#if replyingTo === comment.id && $account}
            <div class="mt-4 border-l-4 border-espresso-400 pl-4 py-3">
              <!-- Blurb showing parent comment -->
              <ReplyToBlurb pubkey={comment.pubkey} content={comment.content} />
              <textarea
                bind:value={replyText}
                placeholder="Write a reply..."
                class="w-full p-3 border rounded-lg text-sm resize-none"
                style="font-family: {theme.typography.fontFamily};"
                rows="3"
                disabled={isSubmitting}
              ></textarea>
              <div class="mt-3 flex justify-end space-x-3">
                <button
                  onclick={cancelReply}
                  class="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                  style="color: var(--text-secondary); background-color: var(--bg-secondary); border: 1px solid var(--border);"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  onclick={() => submitReply(comment)}
                  disabled={!replyText.trim() || isSubmitting}
                  class="px-4 py-2 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                  style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                >
                  {isSubmitting ? 'Submitting...' : 'Reply'}
                </button>
              </div>
            </div>
          {/if}

          <!-- Level 2 replies -->
          {#if threadedComment.replies.length > 0}
            <div class="mt-6 ml-4 border-l-2 border-espresso-400 pl-4 space-y-3">
              {#each threadedComment.replies as replyThread (replyThread.comment.id)}
                {@const reply = replyThread.comment}
                <div class="py-1 px-3 rounded-lg border" style="background-color: var(--bg-secondary); border-color: var(--border);">
                  <div class="flex items-center mb-1">
                    <div class="flex items-center space-x-3 flex-1 min-w-0">
                      <UserBadge pubkey={reply.pubkey} {createChild} onProfileClick={handleProfileClick} size="tiny" hideSearchIcon={false} />
                      <span class="text-xs whitespace-nowrap" style="color: var(--text-secondary);">
                        {formatRelativeTime(reply.created_at)}
                      </span>
                    </div>
                    
                    <div class="flex items-center space-x-2 flex-shrink-0 ml-2">
                      <button
                        onclick={() => copyCommentNevent(reply.id)}
                        class="p-2 rounded-lg transition-all duration-200"
                        style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                        title="Copy nevent"
                      >
                        {#if copiedNevent.has(reply.id)}
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                          </svg>
                        {:else}
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                          </svg>
                        {/if}
                      </button>
                      {#if copiedNeventMessage.has(reply.id)}
                        <span class="text-xs font-medium animate-fade-in" style="color: var(--accent);">Nevent copied!</span>
                      {/if}
                      {#if $account}
                        <button
                          onclick={() => startReply(reply.id)}
                          class="p-2 rounded-lg transition-all duration-200"
                          style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                          disabled={isSubmitting}
                          title="Reply"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>
                          </svg>
                        </button>
                      {/if}
                    </div>
                  </div>
                  
                  
                <!-- Show blurb if this is a reply -->
                {#if reply.tags.find(([k]) => k === 'e')}
                  {@const parentETag = reply.tags.find(([k]) => k === 'e')}
                  {#if parentETag}
                    {@const parentComment = comments.find(c => c.id === parentETag[1])}
                    {#if parentComment}
                      <ReplyToBlurb pubkey={parentComment.pubkey} content={parentComment.content} variant="compact" />
                    {/if}
                  {/if}
                {/if}

                <div class="leading-relaxed mb-3" style="color: var(--text-primary);">
                  <AsciidocContent event={reply} createChild={() => {}} />
                </div>

              <!-- Reply Form for level 2 -->
              {#if replyingTo === reply.id && $account}
                <div class="mt-3 border-l-4 border-espresso-400 pl-4 py-3">
                  <!-- Blurb showing parent comment -->
                  <ReplyToBlurb pubkey={reply.pubkey} content={reply.content} />
                  <textarea
                        bind:value={replyText}
                        placeholder="Write a reply..."
                        class="w-full p-3 border rounded-lg text-sm resize-none"
                style="font-family: {theme.typography.fontFamily};"
                        rows="3"
                        disabled={isSubmitting}
                      ></textarea>
                      <div class="mt-3 flex justify-end space-x-3">
                        <button
                          onclick={cancelReply}
                          class="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                  style="color: var(--text-secondary); background-color: var(--bg-secondary); border: 1px solid var(--border);"
                          disabled={isSubmitting}
                        >
                          Cancel
                        </button>
                        <button
                          onclick={() => submitReply(reply)}
                          disabled={!replyText.trim() || isSubmitting}
                          class="px-4 py-2 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                          style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                        >
                          {isSubmitting ? 'Submitting...' : 'Reply'}
                        </button>
                      </div>
                    </div>
                  {/if}

                  <!-- Level 3 replies -->
                  {#if replyThread.replies.length > 0}
                    <div class="mt-5 ml-4 border-l-2 border-brown-400 pl-4 space-y-2">
                      {#each replyThread.replies as nestedReplyThread (nestedReplyThread.comment.id)}
                        {@const nestedReply = nestedReplyThread.comment}
                        <div class="py-1 px-3 rounded border" style="background-color: var(--bg-tertiary); border-color: var(--border);">
                          <div class="flex items-center mb-1">
                            <div class="flex items-center space-x-3 flex-1 min-w-0">
                              <UserBadge pubkey={nestedReply.pubkey} {createChild} onProfileClick={handleProfileClick} size="tiny" hideSearchIcon={false} />
                              <span class="text-xs whitespace-nowrap" style="color: var(--text-secondary);">
                                {formatRelativeTime(nestedReply.created_at)}
                              </span>
                            </div>
                            
                            <div class="flex items-center space-x-2 flex-shrink-0 ml-2">
                              <button
                                onclick={() => copyCommentNevent(nestedReply.id)}
                                class="p-2 rounded-lg transition-all duration-200"
                                style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
                                title="Copy nevent"
                              >
                                {#if copiedNevent.has(nestedReply.id)}
                                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                  </svg>
                                {:else}
                                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                  </svg>
                                {/if}
                              </button>
                              {#if copiedNeventMessage.has(nestedReply.id)}
                                <span class="text-xs font-medium animate-fade-in" style="color: var(--accent);">Nevent copied!</span>
                              {/if}
                            </div>
                          </div>
                          
                          <!-- Show blurb if this is a reply -->
                          {#if nestedReply.tags.find(([k]) => k === 'e')}
                            {@const parentETag = nestedReply.tags.find(([k]) => k === 'e')}
                            {#if parentETag}
                              {@const parentComment = comments.find(c => c.id === parentETag[1])}
                              {#if parentComment}
                                <ReplyToBlurb pubkey={parentComment.pubkey} content={parentComment.content} variant="inline" />
                              {/if}
                            {/if}
                          {/if}
                          
                          <div class="leading-relaxed mb-2" style="color: var(--text-primary);">
                            <AsciidocContent event={nestedReply} createChild={() => {}} />
                          </div>


                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Publish Status Dialog -->
{#if publishStatus.show}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="rounded-lg p-6 max-w-md w-full mx-4" style="color: var(--text-primary);">
      <h3 class="text-lg font-semibold mb-4">{publishStatus.title}</h3>
      
      <div class="space-y-3 mb-6">
        {#each publishStatus.attempts as attempt, index (index)}
          <div class="flex items-center space-x-3">
            <div class="flex-shrink-0">
              {#if attempt.status === 'pending'}
                <div class="w-4 h-4 border-2 border-espresso-500 border-t-transparent rounded-full animate-spin"></div>
                <span class="text-xs" style="color: var(--text-primary);">Publishing...</span>
              {:else if attempt.status === 'success'}
                <div class="w-4 h-4 bg-burgundy-700 rounded-full flex items-center justify-center">
                  <svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                  </svg>
                </div>
                <span class="text-xs" style="color: var(--accent);">Success</span>
              {:else if attempt.status === 'failure'}
                <div class="w-4 h-4 bg-burgundy-800 rounded-full flex items-center justify-center">
                  <svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                  </svg>
                </div>
                <span class="text-xs" style="color: var(--text-primary);">Failed</span>
              {/if}
            </div>
          </div>
          
          {#if attempt.status === 'failure' && attempt.message}
            <div class="ml-4 p-2 border-l-2 rounded-r" style="border-color: var(--accent);">
              <p class="text-xs" style="color: var(--text-primary);">{attempt.message}</p>
            </div>
          {/if}
        {/each}
      </div>
      
      <div class="flex justify-end">
        <button
          onclick={() => publishStatus.show = false}
          class="px-4 py-2 rounded-md transition-colors"
          style="background-color: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border);"
        >
          Close
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