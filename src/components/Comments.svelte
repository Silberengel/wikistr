<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { onMount } from 'svelte';
  import { pool } from '@nostr/gadgets/global';
  import { DEFAULT_WIKI_RELAYS, DEFAULT_METADATA_QUERY_RELAYS, DEFAULT_WRITE_RELAYS, DEFAULT_SOCIAL_RELAYS } from '$lib/defaults';
  import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
  import { formatDate, deduplicateRelays } from '$lib/utils';
  import { nip19 } from '@nostr/tools';
  import { signer, account } from '$lib/nostr';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import UserLabel from './UserLabel.svelte';

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();

  let comments = $state<NostrEvent[]>([]);
  let loading = $state(true);
  let users = $state<Map<string, NostrUser>>(new Map());
  let commentText = $state('');
  let isSubmitting = $state(false);
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');
  let publishStatus = $state<{
    show: boolean;
    title: string;
    attempts: Array<{url: string, status: 'pending' | 'success' | 'failure', message?: string}>;
  }>({
    show: false,
    title: '',
    attempts: []
  });

  // Generate the coordinate for the wiki article (kind:pubkey:identifier format)
  // This follows NIP-22: kind 1111 comments reference their root using this coordinate
  const articleCoordinate = `${event.kind}:${event.pubkey}:${event.tags.find(([k]) => k === 'd')?.[1] || ''}`;

  onMount(() => {
    loadComments();
  });

  // Helper function to get user's inbox relays (for reading)
  async function getUserInboxRelays(pubkey: string): Promise<string[]> {
    const relayList = await loadRelayList(pubkey);
    return relayList.items
      .filter((ri) => ri.read)
      .map((ri) => ri.url);
  }

  // Helper function to get user's outbox relays (for writing)
  async function getUserOutboxRelays(pubkey: string): Promise<string[]> {
    const relayList = await loadRelayList(pubkey);
    return relayList.items
      .filter((ri) => ri.write)
      .map((ri) => ri.url);
  }

  async function loadComments() {
    loading = true;
    comments = [];

    try {
      // Get user's inbox relays for reading comments
      const userInboxRelays = $account ? await getUserInboxRelays($account.pubkey) : [];
      const readRelays = [...new Set([...DEFAULT_SOCIAL_RELAYS, ...userInboxRelays])];
      const normalizedReadRelays = deduplicateRelays(readRelays);

      // Fetch kind 1111 comments that reference this wiki article
      // Following Jumble's pattern: kind 1111 comments reference kind 30818 wiki articles as root
      
      // Use broader filter to avoid relay rejections - do all filtering client-side
      // This prevents issues with restrictive relays like nostr.sovbit.host
      const sub = pool.subscribeMany(
        normalizedReadRelays,
        [{
          kinds: [1111], // All kind 1111 comments
          limit: 200 // Get more comments to filter client-side
        }],
        {
          onevent(commentEvent) {
            // Client-side filtering for our specific wiki article
            const aTag = commentEvent.tags.find(([k]) => k === 'A');
            const KTag = commentEvent.tags.find(([k]) => k === 'K');
            
            // Check if this comment references our wiki article
            if (aTag && aTag[1] === articleCoordinate && 
                KTag && KTag[1] === event.kind.toString()) {
              comments.push(commentEvent);
              loadUserMetadata(commentEvent.pubkey);
            }
          },
          oneose() {
            sub.close();
            loading = false;
          }
        }
      );

      // Timeout after 10 seconds
      setTimeout(() => {
        if (sub) sub.close();
        loading = false;
      }, 10000);

    } catch (e) {
      console.error('Failed to load comments:', e);
      loading = false;
    }
  }

  async function loadUserMetadata(pubkey: string) {
    if (users.has(pubkey)) return;

    try {
      const user = await loadNostrUser(pubkey);
      users.set(pubkey, user);
    } catch (e) {
      console.error('Failed to load user metadata:', e);
    }
  }

  async function submitComment() {
    if (!commentText.trim() || isSubmitting) return;
    if (!$account) {
      alert('Please connect your Nostr account to comment.');
      return;
    }

    isSubmitting = true;

    try {
      // Get user's outbox relays for publishing
      const userOutboxRelays = await getUserOutboxRelays($account.pubkey);
      const allWriteRelays = [...new Set([...userOutboxRelays, ...DEFAULT_WRITE_RELAYS])];
      const normalizedRelays = deduplicateRelays(allWriteRelays);

      // Initialize publish status
      publishStatus = {
        show: true,
        title: 'Publishing Comment',
        attempts: normalizedRelays.map(url => ({ url, status: 'pending' as const }))
      };

      // Create comment event template following NIP-22
      // Kind 1111 comments reference kind 30818 wiki articles as root (like Jumble's kind 11/1111 pattern)
      const eventTemplate = {
        kind: 1111, // NIP-22 comment
        content: commentText.trim(),
        tags: [
          // Root scope tags (the wiki article)
          ['A', articleCoordinate], // Root scope - wiki article coordinate
          ['K', event.kind.toString()], // Root kind (30818 for wiki articles)
          ['P', event.pubkey], // Root pubkey (wiki article author)
          
          // Parent scope tags (same as root for top-level comments)
          ['a', articleCoordinate], // Parent scope - wiki article coordinate  
          ['k', event.kind.toString()], // Parent kind (30818 for wiki articles)
          ['p', event.pubkey], // Parent pubkey (wiki article author)
        ],
        created_at: Math.round(Date.now() / 1000)
      };

      // Sign and publish the comment
      const signedComment = await signer.signEvent(eventTemplate);
      
      // Publish to relays with status tracking
      const publishPromises = normalizedRelays.map(async (url, index) => {
        try {
          const relay = await pool.ensureRelay(url);
          await relay.publish(signedComment);
          
          // Update status to success
          publishStatus.attempts[index] = { url, status: 'success' };
          publishStatus = publishStatus; // Trigger reactivity
        } catch (err) {
          // Update status to failure with error message
          const errorMessage = err instanceof Error ? err.message : String(err);
          publishStatus.attempts[index] = { url, status: 'failure', message: errorMessage };
          publishStatus = publishStatus; // Trigger reactivity
        }
      });

      await Promise.all(publishPromises);
      
      // Clear the text and reload comments
      commentText = '';
      
      // Reload comments after a short delay to pick up the new comment
      // Also add write relays to ensure we fetch from where we just published
      setTimeout(async () => {
        const userInboxRelays = $account ? await getUserInboxRelays($account.pubkey) : [];
        const userOutboxRelays = $account ? await getUserOutboxRelays($account.pubkey) : [];
        const allReadRelays = [...new Set([...DEFAULT_SOCIAL_RELAYS, ...userInboxRelays, ...userOutboxRelays])];
        const normalizedAllRelays = deduplicateRelays(allReadRelays);
        
        // Quick fetch using broader filter to avoid relay rejections
        const quickSub = pool.subscribeMany(
          normalizedAllRelays,
          [{
            kinds: [1111],
            limit: 100
          }],
          {
            onevent(commentEvent) {
              const aTag = commentEvent.tags.find(([k]) => k === 'A');
              const KTag = commentEvent.tags.find(([k]) => k === 'K');
              
              if (aTag && aTag[1] === articleCoordinate && 
                  KTag && KTag[1] === event.kind.toString()) {
                
                // Add if not already present
                if (!comments.find(c => c.id === commentEvent.id)) {
                  comments.push(commentEvent);
                  loadUserMetadata(commentEvent.pubkey);
                }
              }
            },
            oneose() {
              quickSub.close();
            }
          }
        );
        
        // Close quick fetch after 3 seconds
        setTimeout(() => quickSub.close(), 3000);
      }, 1000);

      // Hide publish status after 3 seconds
      setTimeout(() => {
        publishStatus.show = false;
      }, 3000);

    } catch (e) {
      publishStatus.show = false;
      alert('Failed to publish comment. Please try again.');
    } finally {
      isSubmitting = false;
    }
  }

  // Organize comments into a threaded structure
  interface ThreadedComment {
    comment: NostrEvent;
    replies: ThreadedComment[];
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

    // Second pass: organize into hierarchy
    comments.forEach(comment => {
      const threadedComment = commentMap.get(comment.id)!;
      
      // Check if this is a reply to another comment
      const parentETag = comment.tags.find(([k]) => k === 'e');
      const parentKTag = comment.tags.find(([k]) => k === 'k');
      
      if (parentETag && parentKTag && parentKTag[1] === '1111') {
        // This is a reply to another comment
        const parentId = parentETag[1];
        const parent = commentMap.get(parentId);
        if (parent) {
          parent.replies.push(threadedComment);
        } else {
          // Parent not found, treat as top-level
          topLevelComments.push(threadedComment);
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(threadedComment);
      }
    });

    // Sort top-level comments and their replies by creation time
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

  function cancelReply() {
    replyingTo = null;
    replyText = '';
  }

  async function submitReply(parentComment: NostrEvent) {
    if (!replyText.trim() || isSubmitting) return;
    if (!$account) {
      alert('Please connect your Nostr account to reply.');
      return;
    }

    isSubmitting = true;

    try {
      // Get user's outbox relays for publishing
      const userOutboxRelays = await getUserOutboxRelays($account.pubkey);
      const allWriteRelays = [...new Set([...userOutboxRelays, ...DEFAULT_WRITE_RELAYS])];
      const normalizedRelays = deduplicateRelays(allWriteRelays);

      // Initialize publish status
      publishStatus = {
        show: true,
        title: 'Publishing Reply',
        attempts: normalizedRelays.map(url => ({ url, status: 'pending' as const }))
      };

      // Create reply event template following NIP-22
      // Reply to a comment in the thread (kind 1111 -> kind 1111)
      const eventTemplate = {
        kind: 1111, // NIP-22 comment
        content: replyText.trim(),
        tags: [
          // Root scope tags (the wiki article)
          ['A', articleCoordinate], // Root scope - wiki article coordinate
          ['K', event.kind.toString()], // Root kind (30818 for wiki articles)
          ['P', event.pubkey], // Root pubkey (wiki article author)
          
          // Parent scope tags (the comment being replied to)
          ['e', parentComment.id], // Parent event ID (the comment)
          ['k', '1111'], // Parent kind (1111 for comment)
          ['p', parentComment.pubkey], // Parent pubkey (comment author)
        ],
        created_at: Math.round(Date.now() / 1000)
      };

      // Sign and publish the reply
      const signedReply = await signer.signEvent(eventTemplate);
      
      // Publish to relays with status tracking
      const publishPromises = normalizedRelays.map(async (url, index) => {
        try {
          const relay = await pool.ensureRelay(url);
          await relay.publish(signedReply);
          
          // Update status to success
          publishStatus.attempts[index] = { url, status: 'success' };
          publishStatus = publishStatus; // Trigger reactivity
        } catch (err) {
          // Update status to failure with error message
          const errorMessage = err instanceof Error ? err.message : String(err);
          publishStatus.attempts[index] = { url, status: 'failure', message: errorMessage };
          publishStatus = publishStatus; // Trigger reactivity
        }
      });

      await Promise.all(publishPromises);
      
      // Clear the text and reload comments
      replyText = '';
      replyingTo = null;
      
      // Reload comments after a short delay to pick up the new reply
      // Also add write relays to ensure we fetch from where we just published
      setTimeout(async () => {
        const userInboxRelays = $account ? await getUserInboxRelays($account.pubkey) : [];
        const userOutboxRelays = $account ? await getUserOutboxRelays($account.pubkey) : [];
        const allReadRelays = [...new Set([...DEFAULT_SOCIAL_RELAYS, ...userInboxRelays, ...userOutboxRelays])];
        const normalizedAllRelays = deduplicateRelays(allReadRelays);
        
        // Quick fetch using broader filter to avoid relay rejections
        const quickSub = pool.subscribeMany(
          normalizedAllRelays,
          [{
            kinds: [1111],
            limit: 100
          }],
          {
            onevent(commentEvent) {
              const aTag = commentEvent.tags.find(([k]) => k === 'A');
              const KTag = commentEvent.tags.find(([k]) => k === 'K');
              
              if (aTag && aTag[1] === articleCoordinate && 
                  KTag && KTag[1] === event.kind.toString()) {
                
                // Add if not already present
                if (!comments.find(c => c.id === commentEvent.id)) {
                  comments.push(commentEvent);
                  loadUserMetadata(commentEvent.pubkey);
                }
              }
            },
            oneose() {
              quickSub.close();
            }
          }
        );
        
        // Close quick fetch after 3 seconds
        setTimeout(() => quickSub.close(), 3000);
      }, 1000);

      // Hide publish status after 3 seconds
      setTimeout(() => {
        publishStatus.show = false;
      }, 3000);

    } catch (e) {
      console.error('Failed to submit reply:', e);
      alert('Failed to publish reply. Please try again.');
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="mt-8 border-t border-gray-200 pt-6">
  <h3 class="text-lg font-semibold mb-4">Comments</h3>
  
  <!-- Comment Form -->
  {#if $account}
    <div class="mb-6 py-4">
      <textarea
        bind:value={commentText}
        placeholder="Write a comment..."
        class="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
        rows="4"
        disabled={isSubmitting}
      ></textarea>
      <div class="mt-3 flex justify-end">
        <button
          onclick={submitComment}
          disabled={!commentText.trim() || isSubmitting}
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-base transition-colors"
        >
          {isSubmitting ? 'Submitting...' : 'Post Comment'}
        </button>
      </div>
    </div>
  {:else}
    <div class="mb-6 py-4 text-center text-gray-600">
      <p class="text-base">Please connect your Nostr account to comment.</p>
    </div>
  {/if}

  <!-- Comments List -->
  {#if loading}
    <div class="text-center py-4 text-gray-500">Loading comments...</div>
  {:else if threadedComments.length === 0}
    <div class="text-center py-8 text-gray-500">
      No comments yet. Be the first to comment!
    </div>
  {:else}
    <div class="space-y-4">
      {#each threadedComments as threadedComment (threadedComment.comment.id)}
        {@const comment = threadedComment.comment}
        <div class="border-l-4 border-blue-500 pl-4 py-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <UserLabel pubkey={comment.pubkey} createChild={() => {}} />
                <span class="text-gray-500">•</span>
                <span class="text-base text-gray-700 font-semibold">
                  {formatDate(comment.created_at)}
                </span>
              </div>
              
              {#if $account}
                <button
                  onclick={() => startReply(comment.id)}
                  class="text-base text-blue-600 hover:text-blue-800 font-medium px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  disabled={isSubmitting}
                >
                  Reply
                </button>
              {/if}
            </div>
            
            <div class="text-base text-gray-900 leading-relaxed">
              {comment.content}
            </div>

            <!-- Reply Form -->
            {#if replyingTo === comment.id && $account}
              <div class="mt-3 border-l-4 border-blue-400 pl-4 py-3">
                <textarea
                  bind:value={replyText}
                  placeholder="Write a reply..."
                  class="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                  rows="3"
                  disabled={isSubmitting}
                ></textarea>
                <div class="mt-3 flex justify-end space-x-3">
                  <button
                    onclick={cancelReply}
                    class="px-4 py-2 text-base text-gray-600 hover:text-gray-800 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    onclick={() => submitReply(comment)}
                    disabled={!replyText.trim() || isSubmitting}
                    class="px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {isSubmitting ? 'Submitting...' : 'Reply'}
                  </button>
                </div>
              </div>
            {/if}

            <!-- Replies -->
            {#if threadedComment.replies.length > 0}
              <div class="mt-4 ml-4 border-l-4 border-purple-400 pl-4 space-y-3">
                {#each threadedComment.replies as replyThread (replyThread.comment.id)}
                  {@const reply = replyThread.comment}
                  <div class="py-2">
                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                          <UserLabel pubkey={reply.pubkey} createChild={() => {}} />
                          <span class="text-gray-500">•</span>
                          <span class="text-base text-gray-700 font-semibold">
                            {formatDate(reply.created_at)}
                          </span>
                        </div>
                        
                        {#if $account}
                          <button
                            onclick={() => startReply(reply.id)}
                            class="text-base text-purple-600 hover:text-purple-800 font-medium px-3 py-1 rounded-lg hover:bg-purple-50 transition-colors"
                            disabled={isSubmitting}
                          >
                            Reply
                          </button>
                        {/if}
                      </div>
                      
                      <div class="text-base text-gray-900 leading-relaxed">
                        {reply.content}
                      </div>

                      <!-- Nested Reply Form -->
                      {#if replyingTo === reply.id && $account}
                        <div class="mt-3 border-l-4 border-purple-400 pl-4 py-3">
                          <textarea
                            bind:value={replyText}
                            placeholder="Write a reply..."
                            class="w-full p-3 border border-gray-300 rounded-lg text-base resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            rows="3"
                            disabled={isSubmitting}
                          ></textarea>
                          <div class="mt-3 flex justify-end space-x-3">
                            <button
                              onclick={cancelReply}
                              class="px-4 py-2 text-base text-gray-600 hover:text-gray-800 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                              disabled={isSubmitting}
                            >
                              Cancel
                            </button>
                            <button
                              onclick={() => submitReply(reply)}
                              disabled={!replyText.trim() || isSubmitting}
                              class="px-4 py-2 text-base bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                            >
                              {isSubmitting ? 'Submitting...' : 'Reply'}
                            </button>
                          </div>
                        </div>
                      {/if}

                      <!-- Nested Replies (replies to replies) -->
                      {#if replyThread.replies.length > 0}
                        <div class="mt-3 ml-4 border-l-4 border-green-400 pl-4 space-y-2">
                          {#each replyThread.replies as nestedReplyThread (nestedReplyThread.comment.id)}
                            {@const nestedReply = nestedReplyThread.comment}
                            <div class="py-1">
                              <div class="space-y-1">
                                <div class="flex items-center justify-between">
                                  <div class="flex items-center space-x-3">
                                    <UserLabel pubkey={nestedReply.pubkey} createChild={() => {}} />
                                    <span class="text-gray-500">•</span>
                                    <span class="text-base text-gray-700 font-semibold">
                                      {formatDate(nestedReply.created_at)}
                                    </span>
                                  </div>
                                  
                                  {#if $account}
                                    <button
                                      onclick={() => startReply(nestedReply.id)}
                                      class="text-base text-green-600 hover:text-green-800 font-medium px-3 py-1 rounded-lg hover:bg-green-50 transition-colors"
                                      disabled={isSubmitting}
                                    >
                                      Reply
                                    </button>
                                  {/if}
                                </div>
                                
                                <div class="text-base text-gray-900 leading-relaxed">
                                  {nestedReply.content}
                                </div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            </div>
          </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Publish Status Dialog -->
{#if publishStatus.show}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold mb-4">{publishStatus.title}</h3>
      
      <div class="space-y-2 mb-4">
        {#each publishStatus.attempts as attempt (attempt.url)}
          <div class="flex items-center justify-between p-2 rounded border">
            <span class="text-sm font-mono truncate flex-1 mr-2">{attempt.url}</span>
            <div class="flex items-center space-x-2">
              {#if attempt.status === 'pending'}
                <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span class="text-xs text-blue-600">Publishing...</span>
              {:else if attempt.status === 'success'}
                <div class="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                  <svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                  </svg>
                </div>
                <span class="text-xs text-green-600">Success</span>
              {:else if attempt.status === 'failure'}
                <div class="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                  <svg class="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                  </svg>
                </div>
                <span class="text-xs text-red-600">Failed</span>
              {/if}
            </div>
          </div>
          
          {#if attempt.status === 'failure' && attempt.message}
            <div class="ml-4 p-2 bg-red-50 border-l-2 border-red-200 rounded-r">
              <p class="text-xs text-red-700">{attempt.message}</p>
            </div>
          {/if}
        {/each}
      </div>
      
      <div class="flex justify-end">
        <button
          onclick={() => publishStatus.show = false}
          class="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
