<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import type { Card } from '$lib/types';
  import { getTagOr, formatDate } from '$lib/utils';
  import { 
    isBibleEvent, 
    extractBibleMetadata, 
    generateBibleTitle,
    type BibleEvent
  } from '$lib/bible';
  import UserLabel from './UserLabel.svelte';
  import AsciidocContent from './AsciidocContent.svelte';

  interface Props {
    event: BibleEvent;
    createChild: (card: Card) => void;
  }

  let { event, createChild }: Props = $props();

  // Extract Bible metadata
  const metadata = extractBibleMetadata(event);
  const title = generateBibleTitle(metadata);
  const dTag = getTagOr(event, 'd') || event.id;

  function copyNevent() {
    // TODO: Implement copying nevent for Bible events
    console.log('Copy nevent for Bible event:', event.id);
  }

  function shareCopy() {
    // TODO: Implement sharing Bible events
    console.log('Share Bible event:', event.id);
  }
</script>

<div class="bible-display">
  <!-- Header -->
  <div class="mb-6">
    <div class="flex justify-between items-start mb-2">
      <div class="flex-1">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">
          {title}
        </h1>
        <div class="flex items-center text-sm text-gray-600 space-x-4">
          <span>
            by <UserLabel pubkey={event.pubkey} {createChild} />
          </span>
          {#if event.created_at}
            <span>• {formatDate(event.created_at)}</span>
          {/if}
        </div>
      </div>
      
      <!-- Action buttons -->
      <div class="flex items-center space-x-4 text-sm">
        <button
          onclick={shareCopy}
          class="text-burgundy-700 hover:text-burgundy-800 underline cursor-pointer"
        >
          Share
        </button>
        <button
          onclick={copyNevent}
          class="text-burgundy-700 hover:text-burgundy-800 underline cursor-pointer"
        >
          Copy nevent
        </button>
      </div>
    </div>
    
    <!-- Bible reference info -->
    <div class="bg-brown-100 border border-brown-300 rounded-lg p-4">
      <div class="flex items-center space-x-2 text-espresso-800">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span class="font-medium">Bible Passage</span>
      </div>
      <div class="mt-2 text-sm text-blue-700">
        {#if metadata.book}
          <span class="font-medium">{metadata.book}</span>
          {#if metadata.chapter}
            <span> {metadata.chapter}</span>
            {#if metadata.verses}
              <span>:{metadata.verses}</span>
            {/if}
          {/if}
        {/if}
        {#if metadata.version}
          <span class="ml-2 text-blue-600">({metadata.version})</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="prose prose-lg max-w-none">
    <AsciidocContent {event} {createChild} />
  </div>

  <!-- Footer with Bible-specific info -->
  <div class="mt-8 pt-6 border-t border-gray-200">
    <div class="flex justify-between items-center text-sm text-gray-500">
      <div class="flex items-center space-x-4">
        <span>Bible Event ID: <code class="text-xs">{event.id.slice(0, 8)}...</code></span>
        {#if dTag !== event.id}
          <span>Identifier: <code class="text-xs">{dTag}</code></span>
        {/if}
      </div>
      <div class="text-xs">
        Kind 30041 • Bible Content
      </div>
    </div>
  </div>
</div>

<style>
  .prose {
    color: #374151;
  }
  
  .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
    color: #1f2937;
  }
  
  .prose blockquote {
    border-left: 4px solid #3b82f6;
    background-color: #f8fafc;
    padding: 1rem;
    margin: 1.5rem 0;
  }
  
  .prose code {
    background-color: #f1f5f9;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }
  
  .prose pre {
    background-color: #1e293b;
    color: #e2e8f0;
  }
</style>
