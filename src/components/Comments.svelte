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
  let isLoadingComments = $state(false);
  let copiedNevent = $state<Set<string>>(new Set());
  let copiedNeventMessage = $state<Set<string>>(new Set());
  let publishStatus = $state({ show: false, title: '', attempts: [] as Array<{ status: 'pending' | 'success' | 'failure', message?: string }> });

  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  // Sort comments by creation time (oldest to newest) - no threading
  const sortedComments = $derived([...comments].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)));
  
  // Helper to get parent comment for a reply (following NIP-22)
  function getParentComment(comment: NostrEvent): NostrEvent | null {
    // NIP-22: lowercase 'e' tag for parent event id
    const parentETag = comment.tags.find(([k]) => k === 'e');
    if (parentETag && parentETag[1]) {
      return comments.find(c => c.id === parentETag[1]) || null;
    }
    return null;
  }

  function startReply(commentId: string) {
    replyingTo = commentId;
    replyText = '';
  }

  async function submitTopLevelComment(evt: Event) {
    evt.preventDefault();
    
    if (!commentText.trim() || isSubmitting || !$account) return;
    
    isSubmitting = true;
    
    try {
      // NIP-22: Uppercase tags for root scope
      const commentEventTemplate = {
        kind: 1111,
        content: commentText.trim(),
        tags: [
          ['A', articleCoordinate], // Root scope: event address
          ['K', event.kind.toString()], // Root kind
          ['P', event.pubkey], // Root author pubkey
          // For top-level comments, parent tags are same as root
          ['a', articleCoordinate], // Parent scope (same as root for top-level)
          ['k', event.kind.toString()], // Parent kind (same as root for top-level)
          ['p', event.pubkey] // Parent author (same as root for top-level)
        ],
        created_at: Math.floor(Date.now() / 1000)
      };

      publishStatus.show = true;
      publishStatus.title = 'Publishing comment...';
      publishStatus.attempts = [];

      // Sign the event first
      const signedEvent = await signer.signEvent(commentEventTemplate);
      
      // Use relay service for comment publishing
      if (!$account) return;
      
      const result = await relayService.publishEvent(
        $account.pubkey,
        'social-write',
        signedEvent,
        false // Don't show toast for comments
      );
      
      // Cache the comment after publishing
      if (result.success && result.publishedTo.length > 0) {
        const { contentCache } = await import('$lib/contentCache');
        await contentCache.storeEvents('kind1111', [{
          event: signedEvent,
          relays: result.publishedTo
        }]);
      }
      
      const attempts = result.publishedTo.concat(result.failedRelays).map((relay: string) => ({
        status: result.publishedTo.includes(relay) ? 'success' as const : 'failure' as const,
        url: relay,
        message: result.publishedTo.includes(relay) ? 'Published' : 'Failed'
      }));
      publishStatus.attempts = attempts;
      
      // Store the comment text before clearing the form
      const commentContent = commentText.trim();
      
      // Clear the form
      commentText = '';
      
      // Add the new comment locally immediately
      const newComment = {
        ...signedEvent,
        id: signedEvent.id,
        pubkey: signedEvent.pubkey,
        created_at: signedEvent.created_at,
        kind: 1111,
        content: commentContent,
        tags: signedEvent.tags,
        sig: signedEvent.sig
      };
      
      // Add to local comments array immediately
      comments = [...comments, newComment];
      
      // Refresh comments after a short delay to get any other new comments
      setTimeout(() => {
        fetchComments(true); // Force refresh from relays
      }, 2000);
      
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
      // NIP-22: Uppercase for root, lowercase for parent
      const commentEventTemplate = {
        kind: 1111,
        content: replyText.trim(),
        tags: [
          // Root scope (the article)
          ['A', articleCoordinate], // Root event address
          ['K', event.kind.toString()], // Root kind
          ['P', event.pubkey], // Root author pubkey
          // Parent scope (the comment being replied to)
          ['e', parentComment.id], // Parent event id (lowercase)
          ['k', '1111'], // Parent kind (lowercase) - always 1111 for replies to comments
          ['p', parentComment.pubkey] // Parent author pubkey (lowercase)
        ],
        created_at: Math.floor(Date.now() / 1000)
      };

      publishStatus.show = true;
      publishStatus.title = 'Publishing comment...';
      publishStatus.attempts = [];

      // Sign the event first
      const signedEvent = await signer.signEvent(commentEventTemplate);
      
      // Use relayService to publish to social-write relays
      try {
        const result = await relayService.publishEvent(
          signedEvent.pubkey,
          'social-write',
          signedEvent,
          false // Don't show toast notification
        );
        
        // Cache the comment after publishing
        if (result.success && result.publishedTo.length > 0) {
          const { contentCache } = await import('$lib/contentCache');
          await contentCache.storeEvents('kind1111', [{
            event: signedEvent,
            relays: result.publishedTo
          }]);
        }
        
        if (result.success) {
          publishStatus.attempts.forEach((_, index) => {
            publishStatus.attempts[index] = { status: 'success' };
          });
        } else {
          publishStatus.attempts.forEach((_, index) => {
            publishStatus.attempts[index] = { 
              status: 'failure', 
              message: `Failed to publish to any relay. Issues: ${result.failedRelays.join(', ')}` 
            };
          });
        }
      } catch (error) {
        publishStatus.attempts.forEach((_, index) => {
          publishStatus.attempts[index] = { 
            status: 'failure', 
            message: error instanceof Error ? error.message : 'Unknown error' 
          };
        });
      }
      
      // Store the reply text before clearing the form
      const replyContent = replyText.trim();
      
      // Reset form
      replyingTo = null;
      replyText = '';
      
      // Add the new reply locally immediately
      const newReply = {
        ...signedEvent,
        id: signedEvent.id,
        pubkey: signedEvent.pubkey,
        created_at: signedEvent.created_at,
        kind: 1111,
        content: replyContent,
        tags: signedEvent.tags,
        sig: signedEvent.sig
      };
      
      // Add to local comments array immediately
      comments = [...comments, newReply];
      
      // Refresh comments after a short delay to get any other new comments
      setTimeout(() => {
        fetchComments(true); // Force refresh from relays
      }, 2000);
      
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
    // Optimized filtering: deduplicate and filter efficiently
    // Use Map for deduplication by event ID, then filter
    const uniqueComments = new Map<string, NostrEvent>();
    const articleCoord = articleCoordinate; // Cache for faster access
    const eventKindStr = event.kind.toString(); // Cache for faster access
    
    // First pass: deduplicate by event ID
    for (const commentEvent of commentEvents) {
      if (commentEvent.kind !== 1111) continue; // Skip non-comments
      uniqueComments.set(commentEvent.id, commentEvent);
    }
    
    // Second pass: filter for our article (optimized)
    const filteredComments: NostrEvent[] = [];
    for (const commentEvent of uniqueComments.values()) {
      // Find A tag (root scope) - most comments have this early in tags
      const aTagIndex = commentEvent.tags.findIndex(([k]) => k === 'A');
      if (aTagIndex === -1) continue;
      
      const aTag = commentEvent.tags[aTagIndex];
      
      // Quick check: coordinate match first (most specific)
      if (aTag[1] !== articleCoord) continue;
      
      // Optional: check K tag for extra validation (skip if not present)
      const kTag = commentEvent.tags.find(([k]) => k === 'K');
      if (kTag && kTag[1] !== eventKindStr) continue;
      
      filteredComments.push(commentEvent);
    }

    comments = filteredComments;
  }

  async function fetchComments(forceRefresh = false) {
    if (!browser) return;
    
    isLoadingComments = true;
    
    try {
      // Check cache first before making relay queries (unless forcing refresh)
      if (!forceRefresh) {
        // Optimize: Get all cached comments once, then filter efficiently
        // Use early exit if no cached comments exist
        const allCachedComments = contentCache.getEvents('kind1111');
        
        if (allCachedComments.length > 0) {
          // Optimized filter: check A tag first (most comments have it), then coordinate match
          // Use for...of loop which is faster than filter for early exits
          const cachedComments: typeof allCachedComments = [];
          const articleCoord = articleCoordinate; // Cache for faster access
          
          for (const cached of allCachedComments) {
            const event = cached.event;
            // Quick check: skip if not kind 1111 (shouldn't happen, but safety check)
            if (event.kind !== 1111) continue;
            
            // Find A tag (root scope) - most comments have this early in tags
            const aTagIndex = event.tags.findIndex(tag => tag[0] === 'A');
            if (aTagIndex === -1) continue;
            
            // Check if it matches our article coordinate
            if (event.tags[aTagIndex][1] === articleCoord) {
              cachedComments.push(cached);
            }
          }
          
          if (cachedComments.length > 0) {
            // Display cached results immediately (convert to events array)
            const cachedEvents = cachedComments.map(cached => cached.event);
            processComments(cachedEvents);
            isLoadingComments = false; // Cached results loaded, stop showing spinner
            
            // Fetch fresh comments in background to update cache (non-blocking)
            relayService.queryEvents(
              $account?.pubkey || 'anonymous',
              'social-read',
              [
                {
                  kinds: [1111],
                  '#A': [articleCoordinate], // NIP-22: Use uppercase #A for root scope
                  limit: 200
                }
              ],
              {
                excludeUserContent: false,
                currentUserPubkey: $account?.pubkey
              }
            ).then(async (freshResult) => {
              // Update cache with fresh results
              if (freshResult.events.length > 0) {
                await contentCache.storeEvents('kind1111', 
                  freshResult.events.map(event => ({ event, relays: freshResult.relays }))
                );
                // Update comments if we got new ones (merge with existing)
                processComments([...cachedEvents, ...freshResult.events]);
              }
            }).catch(err => {
              // Silently fail background refresh
              console.debug('Background comment refresh failed:', err);
            });
            
            return; // Exit early - cached comments displayed
          }
        }
      }
      
      // Only query relays if no cached comments found or forcing refresh
      const freshResult = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'social-read',
        [
          {
            kinds: [1111],
            '#A': [articleCoordinate], // NIP-22: Use uppercase #A for root scope
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
      
      // Process fresh comments
      processComments(freshResult.events);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      isLoadingComments = false;
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
  
  {#if isLoadingComments}
    <div class="flex items-center justify-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2" style="border-color: var(--accent);"></div>
      <span class="ml-3" style="color: var(--text-secondary);">Loading comments...</span>
    </div>
  {:else if comments.length === 0}
    <p class="text-center py-8" style="color: var(--text-secondary);">No comments yet. Be the first to comment!</p>
  {:else}
    <div class="space-y-4">
      {#each sortedComments as comment (comment.id)}
        {@const parentComment = getParentComment(comment)}
        <!-- Comment (flat list, no threading) -->
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
          
          <!-- Show quote bubble if this is a reply -->
          {#if parentComment}
            <div class="mb-3">
              <ReplyToBlurb pubkey={parentComment.pubkey} content={parentComment.content} />
            </div>
          {/if}

          <div class="leading-relaxed mb-4" style="color: var(--text-primary);">
            <AsciidocContent event={comment} createChild={() => {}} />
          </div>

          <!-- Reply Form -->
          {#if replyingTo === comment.id && $account}
            <div class="mt-4 border-l-4 pl-4 py-3" style="border-color: var(--accent);">
              <!-- Blurb showing parent comment -->
              <ReplyToBlurb pubkey={comment.pubkey} content={comment.content} />
              <textarea
                bind:value={replyText}
                placeholder="Write a reply..."
                class="w-full p-3 border rounded-lg text-sm resize-none mt-3"
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
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Publish Status Dialog -->
{#if publishStatus.show}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="rounded-lg p-6 max-w-md w-full mx-4" style="background-color: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border);">
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