<script lang="ts">
  import type { EventTemplate } from '@nostr/tools/pure';
  import AsciidocContent from '$components/AsciidocContent.svelte';
  import { wikiKind, account, signer, loadBlockedRelays } from '$lib/nostr';
  import type { ArticleCard, Card, EditorCard, EditorData } from '$lib/types.ts';
  import {
    getTagOr,
    next,
    preprocessContentForAsciidoc,
    unique,
    urlWithoutScheme,
    deduplicateRelays
  } from '$lib/utils';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    replaceSelf: (card: Card) => void;
    card: Card;
  }

  let { replaceSelf, card }: Props = $props();

  const editorCard = card as EditorCard;

  let data = $state<EditorData>({ ...editorCard.data });
  let error = $state<string | undefined>();
  let targets: { url: string; status: 'pending' | 'success' | 'failure'; message?: string }[] =
    $state([]);
  let previewing = $state(false);
  let editingJson = $state(false);
  let jsonContent = $state('');
  
  // Get the original event kind (from data.kind, previous event, or default to wikiKind)
  const originalKind = $derived(
    data.kind || 
    editorCard.data.previous?.actualEvent?.kind || 
    wikiKind
  );
  
  // Check if this is a kind 30040 (book index) which has no content, just tags
  const isBookIndex = $derived(originalKind === 30040);


  async function publish() {
    if (!$account) return;
    
    targets = [];
    error = undefined;

    data.title = data.title.trim();

    let eventTemplate: EventTemplate;
    
    if (isBookIndex) {
      // For kind 30040, use tags from data.tags (includes a-tags/e-tags)
      eventTemplate = {
        kind: originalKind,
        tags: data.tags ? [...data.tags.map(t => [...t])] : [['d', normalizeIdentifier(data.title)]],
        content: '', // Kind 30040 has no content
        created_at: Math.round(Date.now() / 1000)
      };
      // Ensure d-tag exists
      if (!eventTemplate.tags.find(t => t[0] === 'd')) {
        eventTemplate.tags.unshift(['d', normalizeIdentifier(data.title)]);
      }
    } else {
      // Regular content-based event
      eventTemplate = {
        kind: originalKind,
        tags: [['d', normalizeIdentifier(data.title)]],
        content: data.content.trim(),
        created_at: Math.round(Date.now() / 1000)
      };
    }
    
    // Add metadata tags (trim values)
    if (data.title && data.title !== getTagOr({ tags: eventTemplate.tags } as any, 'd')) {
      eventTemplate.tags.push(['title', data.title.trim()]);
    }
    if (data.summary) eventTemplate.tags.push(['summary', data.summary.trim()]);
    if (data.image) eventTemplate.tags.push(['image', data.image.trim()]);
    if (data.author) eventTemplate.tags.push(['author', data.author.trim()]);
    
    // Trim all tag values (except d-tag which is already normalized)
    eventTemplate.tags = eventTemplate.tags.map(tag => {
      if (!Array.isArray(tag) || tag.length < 2) return tag;
      if (tag[0] === 'd') return tag; // d-tag already normalized
      if (typeof tag[1] === 'string') {
        return [tag[0], tag[1].trim()];
      }
      return tag;
    });

    try {
      let event = await signer.signEvent(eventTemplate);
      
      // Use relay service for publishing
      const result = await relayService.publishEvent(
        $account.pubkey,
        'wiki-write',
        event,
        false // Don't show toast for articles
      );
      
      // Only show relay status if there are failures, or show briefly on success then auto-hide
      if (result.failedRelays.length > 0) {
        // Show failures - user should know about these
        targets = result.publishedTo.concat(result.failedRelays).map(url => ({
          url,
          status: result.publishedTo.includes(url) ? 'success' as const : 'failure' as const,
          message: result.publishedTo.includes(url) ? 'Published' : 'Failed'
        }));
      } else if (result.success) {
        // All succeeded - show briefly then hide
        targets = result.publishedTo.map(url => ({
          url,
          status: 'success' as const,
          message: 'Published'
        }));
        // Auto-hide after 1.5 seconds
        setTimeout(() => {
          targets = [];
        }, 1500);
      }

      // Cache the event after publishing
      if (result.success && result.publishedTo.length > 0) {
        const { contentCache } = await import('$lib/contentCache');
        const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                         event.kind === 30023 ? 'longform' :
                         (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
        if (cacheType) {
          await contentCache.storeEvents(cacheType, [{
            event,
            relays: result.publishedTo
          }]);
          
          // Trigger welcome panel refresh
          window.dispatchEvent(new CustomEvent('wikistr:cache-updated', { detail: { event } }));
        }
      }

      if (result.success) {
        setTimeout(() => {
          // Create a clean, serializable copy of the event
          const cleanEvent = {
            id: event.id,
            pubkey: event.pubkey,
            created_at: event.created_at,
            kind: event.kind,
            tags: event.tags.map(tag => [...tag]), // Deep copy tags array
            content: event.content,
            sig: event.sig
          };
          
          replaceSelf({
            id: next(),
            type: 'article',
            data: [getTagOr(event, 'd'), event.pubkey],
            actualEvent: cleanEvent,
            relayHints: result.publishedTo
          } as ArticleCard);
        }, 1400);
      }
    } catch (err) {
      error = String(err);
      targets = []; // setting this will hide the publish report dialog
      return;
    }
  }
</script>

<div class="my-4 font-bold text-4xl flex items-center gap-4">
  <span>
    {#if editorCard.data.content}
      Editing an article
    {:else}
      Creating an article
    {/if}
  </span>
  <button
    onclick={() => {
      if (!editingJson) {
        // Prepare JSON from current data - handle all kinds properly
        let eventTemplate: EventTemplate;
        
        if (isBookIndex) {
          // For kind 30040, use tags from data.tags (includes a-tags/e-tags)
          eventTemplate = {
            kind: originalKind,
            tags: data.tags ? [...data.tags.map(t => [...t])] : [['d', normalizeIdentifier(data.title)]],
            content: '', // Kind 30040 has no content
            created_at: Math.round(Date.now() / 1000)
          };
          // Ensure d-tag exists
          if (!eventTemplate.tags.find(t => t[0] === 'd')) {
            eventTemplate.tags.unshift(['d', normalizeIdentifier(data.title)]);
          }
        } else {
          // Regular content-based event
          eventTemplate = {
            kind: originalKind,
            tags: [['d', normalizeIdentifier(data.title)]],
            content: data.content.trim(),
            created_at: Math.round(Date.now() / 1000)
          };
        }
        
        // Add metadata tags
        if (data.title && data.title !== getTagOr({ tags: eventTemplate.tags } as any, 'd')) {
          eventTemplate.tags.push(['title', data.title]);
        }
        if (data.summary) eventTemplate.tags.push(['summary', data.summary]);
        if (data.image) eventTemplate.tags.push(['image', data.image]);
        if (data.author) eventTemplate.tags.push(['author', data.author]);
        
        jsonContent = JSON.stringify(eventTemplate, null, 2);
      }
      editingJson = !editingJson;
    }}
    class="text-sm px-3 py-1 rounded border cursor-pointer transition-colors"
    style="color: var(--accent); border-color: var(--accent); background-color: {editingJson ? 'var(--accent)' : 'transparent'}; color: {editingJson ? 'white' : 'var(--accent)'};"
    title="Edit raw JSON event"
  >
    Edit Json
  </button>
</div>
{#if editingJson}
  <div class="mt-4">
    <label class="block mb-2">
      <span class="text-sm font-semibold">Raw JSON Event</span>
      {#if previewing && jsonContent && jsonContent.trim()}
        {@const parsed = (() => {
          try {
            const parsed = JSON.parse(jsonContent) as EventTemplate;
            // Only show preview for content-based events (not kind 30040)
            if (parsed.kind === 30040) return null;
            return parsed;
          } catch {
            return null;
          }
        })()}
        {#if parsed}
          <div class="prose prose-p:my-0 prose-li:my-0 border rounded p-4 mb-2" style="border-color: var(--border);">
            <AsciidocContent 
              event={{ 
                content: parsed.content || '', 
                pubkey: $account?.pubkey || '', 
                created_at: parsed.created_at || Math.floor(Date.now() / 1000),
                kind: parsed.kind,
                tags: parsed.tags || [],
                id: '',
                sig: ''
              } as any}
              createChild={() => {}}
            />
          </div>
        {:else if jsonContent && jsonContent.trim()}
          <div class="text-red-600 mb-2">Invalid JSON - cannot preview</div>
        {/if}
      {/if}
      <textarea
        bind:value={jsonContent}
        class="h-96 font-mono text-sm shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full border-gray-300 rounded-md mt-1"
        style="font-family: monospace;"
      >      </textarea>
    </label>
    {#if targets.length > 0}
      <div class="mt-2">
        Publishing to:
        {#each targets as target}
          <div class="flex items-center mt-1">
            <div
              class="p-1 rounded"
              class:bg-sky-100={target.status === 'pending'}
              class:bg-red-200={target.status === 'failure'}
              class:bg-emerald-200={target.status === 'success'}
            >
              {urlWithoutScheme(target.url)}
            </div>
            <div class="ml-1 text-xs uppercase font-mono">{target.status}</div>
            <div class="ml-1 text-sm">{target.message || ''}</div>
          </div>
        {/each}
      </div>
    {/if}
    {#if error}
      <div class="mt-2 bg-red-200 px-2 py-1 rounded">
        <span class="font-bold">ERROR:</span>
        {error}
      </div>
    {/if}
    <div class="mt-2 flex justify-between">
      <button
        onclick={() => {
          editingJson = false;
        }}
        class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
        style="font-family: {theme.typography.fontFamily};"
      >
        Cancel
      </button>
      {#if jsonContent && jsonContent.trim()}
        {@const parsed = (() => {
          try {
            const parsed = JSON.parse(jsonContent) as EventTemplate;
            // Only show preview button for content-based events (not kind 30040)
            return parsed.kind !== 30040 ? parsed : null;
          } catch {
            return null;
          }
        })()}
        {#if parsed}
          <button
            onclick={() => {
              previewing = !previewing;
            }}
            class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
            style="font-family: {theme.typography.fontFamily};"
          >
            {#if previewing}Hide Preview{:else}Preview{/if}
          </button>
        {/if}
      {/if}
      <button
        onclick={async () => {
          if (!$account) return;
          
          try {
            // Parse JSON
            const parsed = JSON.parse(jsonContent) as any;
            
            // Remove fields that should be regenerated: sig, pubkey, created_at, kind, id
            const { sig, pubkey, created_at, kind, id, ...cleanData } = parsed;
            
            // Create event template with only the allowed fields
            const eventTemplate: EventTemplate = {
              kind: originalKind, // Use the original kind from editor data
              tags: cleanData.tags || [],
              content: cleanData.content || '',
              created_at: Math.round(Date.now() / 1000) // Set current timestamp
            };
            
            // Validate required tags: d-tag and title tag
            if (!eventTemplate.tags || !Array.isArray(eventTemplate.tags)) {
              error = 'Invalid event: missing required field (tags)';
              return;
            }
            
            // Check for d-tag
            const dTag = eventTemplate.tags.find(tag => tag[0] === 'd' && tag[1]);
            if (!dTag) {
              error = 'Invalid event: missing required d-tag';
              return;
            }
            
            // Check for title tag
            const titleTag = eventTemplate.tags.find(tag => tag[0] === 'title' && tag[1]);
            if (!titleTag) {
              error = 'Invalid event: missing required title tag';
              return;
            }
            
            // For kind 30040, content is optional (book index has no content)
            if (eventTemplate.kind !== 30040 && eventTemplate.content === undefined) {
              error = 'Invalid event: missing required field (content)';
              return;
            }
            
            // Normalize and trim tags
            eventTemplate.tags = eventTemplate.tags.map(tag => {
              if (!Array.isArray(tag) || tag.length === 0) return tag;
              
              const tagKey = tag[0];
              const tagValue = tag[1];
              
              // Trim tag values (except for d-tag which gets normalized)
              if (tagKey === 'd' && tagValue) {
                return ['d', normalizeIdentifier(tagValue)];
              } else if (tagValue && typeof tagValue === 'string') {
                return [tagKey, tagValue.trim()];
              }
              
              return tag;
            });
            
            // Sign the event (this will generate id, pubkey, and sig)
            let event = await signer.signEvent(eventTemplate);
            
            // Use relay service for publishing
            const result = await relayService.publishEvent(
              $account.pubkey,
              'wiki-write',
              event,
              false
            );
            
            // Only show relay status if there are failures, or show briefly on success then auto-hide
            if (result.failedRelays.length > 0) {
              // Show failures - user should know about these
              targets = result.publishedTo.concat(result.failedRelays).map(url => ({
                url,
                status: result.publishedTo.includes(url) ? 'success' as const : 'failure' as const,
                message: result.publishedTo.includes(url) ? 'Published' : 'Failed'
              }));
            } else if (result.success) {
              // All succeeded - show briefly then hide
              targets = result.publishedTo.map(url => ({
                url,
                status: 'success' as const,
                message: 'Published'
              }));
              // Auto-hide after 1.5 seconds
              setTimeout(() => {
                targets = [];
              }, 1500);
            }
            
            // Cache the event after publishing
            if (result.success && result.publishedTo.length > 0) {
              const { contentCache } = await import('$lib/contentCache');
              const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                               event.kind === 30023 ? 'longform' :
                               (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
              if (cacheType) {
                await contentCache.storeEvents(cacheType, [{
                  event,
                  relays: result.publishedTo
                }]);
                
                // Trigger welcome panel refresh
                window.dispatchEvent(new CustomEvent('wikistr:cache-updated', { detail: { event } }));
              }
            }
            
            if (result.success) {
              setTimeout(() => {
                // Create a clean, serializable copy of the event
                const cleanEvent = {
                  id: event.id,
                  pubkey: event.pubkey,
                  created_at: event.created_at,
                  kind: event.kind,
                  tags: event.tags.map(tag => [...tag]),
                  content: event.content,
                  sig: event.sig
                };
                
                // Update data from event
                data.title = getTagOr(event, 'title') || getTagOr(event, 'd') || '';
                data.summary = getTagOr(event, 'summary') || '';
                data.content = event.content || '';
                data.image = getTagOr(event, 'image') || '';
                data.author = getTagOr(event, 'author') || '';
                data.kind = event.kind;
                data.tags = event.tags ? [...event.tags.map(t => [...t])] : undefined;
                
                replaceSelf({
                  id: next(),
                  type: 'article',
                  data: [getTagOr(event, 'd'), event.pubkey],
                  actualEvent: cleanEvent,
                  relayHints: result.publishedTo
                } as ArticleCard);
              }, 1400);
            }
          } catch (err) {
            error = String(err);
            targets = [];
          }
        }}
        class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
        style="font-family: {theme.typography.fontFamily}; background-color: var(--accent); color: white;"
      >
        Publish
      </button>
    </div>
  </div>
{:else if data}
  {#if isBookIndex}
    <!-- Special form for kind 30040 (book index) - no content, just tags -->
    <div class="mt-2">
      <label class="flex items-center"
        >Title
        <input
          placeholder="example: Book Title"
          bind:value={data.title}
          class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
        /></label
      >
    </div>
    <div class="mt-2">
      <label class="block mb-2">
        <span class="text-sm font-semibold">Event References (a-tags or e-tags)</span>
        <textarea
          placeholder="One per line, format: 30041:pubkey:d-tag or event-id"
          value={(() => {
            if (!data.tags) return '';
            const aTags = data.tags.filter(t => t[0] === 'a' || t[0] === 'A').map(t => t[1] || '').filter(Boolean);
            const eTags = data.tags.filter(t => t[0] === 'e' || t[0] === 'E').map(t => t[1] || '').filter(Boolean);
            return [...aTags, ...eTags].join('\n');
          })()}
          oninput={(e) => {
            const lines = (e.target as HTMLTextAreaElement).value.split('\n').filter(l => l.trim());
            const newTags: string[][] = [['d', normalizeIdentifier(data.title)]];
            lines.forEach(line => {
              const trimmed = line.trim();
              if (trimmed.match(/^\d+:[a-f0-9]{64}:/)) {
                // a-tag format: kind:pubkey:d-tag
                newTags.push(['a', trimmed]);
              } else if (trimmed.match(/^[a-f0-9]{64}$/)) {
                // e-tag format: event-id
                newTags.push(['e', trimmed]);
              }
            });
            // Preserve other tags (title, summary, image, author, etc.)
            if (data.tags) {
              data.tags.forEach(tag => {
                if (tag[0] !== 'a' && tag[0] !== 'A' && tag[0] !== 'e' && tag[0] !== 'E' && tag[0] !== 'd') {
                  newTags.push(tag);
                }
              });
            }
            data.tags = newTags;
          }}
          class="h-80 shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono"
        ></textarea>
      </label>
    </div>
    <div class="mt-2">
      <details>
        <summary>Metadata</summary>
        <div class="mt-2 space-y-2">
          <label class="flex items-center"
            >Summary
            <input
              bind:value={data.summary}
              placeholder="Optional summary"
              class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
            /></label
          >
          <label class="flex items-center"
            >Image (URL)
            <input
              type="url"
              bind:value={data.image}
              placeholder="https://example.com/image.jpg"
              class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm rounded-md ml-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
            /></label
          >
          <label class="flex items-center"
            >Author
            <input
              bind:value={data.author}
              placeholder="Author name"
              class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
            /></label
          >
        </div>
      </details>
    </div>
  {:else}
    <!-- Regular form for content-based events (30023, 30817, 30818, 30041) -->
    <div class="mt-2">
      <label class="flex items-center"
        >Title
        <input
          placeholder="example: Greek alphabet"
          bind:value={data.title}
          class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
        /></label
      >
    </div>
    <div class="mt-2">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>
        Article
        {#if previewing}
        <div class="prose prose-p:my-0 prose-li:my-0">
          {#if jsonContent && jsonContent.trim()}
            {@const parsed = (() => {
              try {
                return JSON.parse(jsonContent) as EventTemplate;
              } catch {
                return null;
              }
            })()}
            {#if parsed}
              <AsciidocContent 
                event={{ 
                  content: parsed.content || data.content, 
                  pubkey: $account?.pubkey || '', 
                  created_at: parsed.created_at || Math.floor(Date.now() / 1000),
                  kind: parsed.kind || originalKind,
                  tags: parsed.tags || [],
                  id: '',
                  sig: ''
                } as any}
                createChild={() => {}}
              />
            {:else}
              <div class="text-red-600">Invalid JSON - cannot preview</div>
            {/if}
          {:else}
            <AsciidocContent 
              event={{ 
                content: data.content, 
                pubkey: $account?.pubkey || '', 
                created_at: Math.floor(Date.now() / 1000),
                kind: originalKind,
                tags: data.tags || [],
                id: '',
                sig: ''
              } as any}
              createChild={() => {}}
            />
          {/if}
        </div>
      {:else}
        <textarea
          placeholder="The **Greek alphabet** has been used to write the [[Greek language]] sincie the late 9th or early 8th century BC. The Greek alphabet is the ancestor of the [[Latin]] and [[Cyrillic]] scripts."
          bind:value={data.content}
          class="h-80 shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md"
        ></textarea>
      {/if}
    </label>
  </div>
  <div class="mt-2">
    <details>
      <summary>Add a summary?</summary>
      <label
        >Summary
        <textarea
          bind:value={data.summary}
          placeholder="The Greek alphabet is the earliest known alphabetic script to have distict letters for vowels. The Greek alphabet existed in many local variants."
          class="h-32 shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md"
        ></textarea></label
      >
    </details>
  </div>
  <div class="mt-2">
    <label class="flex items-center"
      >Image (URL)
      <input
        type="url"
        placeholder="https://example.com/image.jpg"
        bind:value={data.image}
        class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm rounded-md ml-2"
        style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
        onblur={(e) => {
          const url = (e.target as HTMLInputElement).value.trim();
          if (url) {
            // Validate image URL format
            const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i;
            if (!imageExtensions.test(url)) {
              alert('Please enter a valid image URL ending in .jpg, .png, .gif, .webp, .svg, .bmp, or .ico');
              data.image = '';
            }
          }
        }}
      /></label
    >
  </div>
  <div class="mt-2">
    <label class="flex items-center"
      >Author
      <input
        placeholder="Author name"
        bind:value={data.author}
        class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
      /></label
    >
  </div>
  {/if}
{/if}

<!-- Submit (only shown when NOT in JSON edit mode) -->
{#if !editingJson}
  {#if targets.length > 0}
    <div class="mt-2">
      Publishing to:
      {#each targets as target}
        <div class="flex items-center mt-1">
          <div
            class="p-1 rounded"
            class:bg-sky-100={target.status === 'pending'}
            class:bg-red-200={target.status === 'failure'}
            class:bg-emerald-200={target.status === 'success'}
          >
            {urlWithoutScheme(target.url)}
          </div>
          <div class="ml-1 text-xs uppercase font-mono">{target.status}</div>
          <div class="ml-1 text-sm">{target.message || ''}</div>
        </div>
      {/each}
    </div>
  {:else}
    {#if error}
      <div class="mt-2 bg-red-200 px-2 py-1 rounded">
        <span class="font-bold">ERROR:</span>
        {error}
      </div>
    {/if}
    <div class="mt-2 flex justify-between">
      <button
        onclick={publish}
        class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
        style="font-family: {theme.typography.fontFamily}; background-color: var(--accent); color: white;"
        >Publish</button>
      {#if !isBookIndex}
        <!-- Preview button only shown for content-based events (not kind 30040) -->
        <button
          onclick={() => {
            previewing = !previewing;
          }}
          class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
          style="font-family: {theme.typography.fontFamily};"
          >{#if previewing}Edit{:else}Preview{/if}</button>
      {/if}
    </div>
  {/if}
{/if}
