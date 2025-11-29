<script lang="ts">
  import { onMount } from 'svelte';
  import type { Card } from '$lib/types';
  import { parseDiffQuery, isDiffQuery, diffText, generateDiffTitle } from '$lib/diff';
  import { parseBookWikilink, generateBookSearchQuery } from '$lib/books';
  import DiffView from '$components/DiffView.svelte';
  import type { DiffResult } from '$lib/diff';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';
  import { getTagOr } from '$lib/utils';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
  import { contentCache } from '$lib/contentCache';

  // Theme configuration
  const theme = getThemeConfig();

  interface Props {
    card: Card;
    expanded?: boolean;
    toggleExpand?: () => void;
  }

  let { card, expanded = false, toggleExpand }: Props = $props();
  const diffCard = card as any; // We'll create a proper DiffCard type later

  let selectedEvents = $state<any[]>([]);
  let diffResult = $state<DiffResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  
  // Calculate selected count from actual events
  const selectedCount = $derived(selectedEvents.length);
  
  // Calculate expand width based on number of articles (limited to 2)
  function getExpandWidth() {
    const count = selectedEvents.length;
    if (count <= 2) return '1500px';
    return '1500px'; // Always 1500px for two-pane layout
  }

  // Helper function to get article title
  function getArticleTitle(event: any): string {
    return event.tags.find((t: any) => t[0] === 'title')?.[1] || 
           event.tags.find((t: any) => t[0] === 'd')?.[1] || 
           'Untitled';
  }

  // Support all wiki kinds
  const wikiKinds = [30818, 30817, 30040, 30041, 30023];

  // Fetch article by d-tag and optionally pubkey
  async function fetchArticleByDTag(dTag: string, pubkey?: string): Promise<any | null> {
    try {
      // First check cache
      const cachedEvents = [
        ...contentCache.getEvents('publications'),
        ...contentCache.getEvents('longform'),
        ...contentCache.getEvents('wikis')
      ];
      const cached = cachedEvents.find(cached => {
        const matchesDTag = getTagOr(cached.event, 'd') === dTag;
        const matchesKind = wikiKinds.includes(cached.event.kind);
        const matchesPubkey = !pubkey || cached.event.pubkey === pubkey;
        return matchesDTag && matchesKind && matchesPubkey;
      });
      
      if (cached) {
        return cached.event;
      }
      
      // If not in cache, query relays
      const filter: any = {
        '#d': [dTag],
        kinds: wikiKinds
      };
      
      // Add pubkey filter if specified
      if (pubkey) {
        filter.authors = [pubkey];
      }
      
      const result = await relayService.queryEvents(
        $account?.pubkey || 'anonymous',
        'wiki-read',
        [filter],
        {
          excludeUserContent: false,
          currentUserPubkey: $account?.pubkey
        }
      );
      
      // Get the most recent event matching both d-tag and pubkey (if specified)
      const event = result.events
        .filter(evt => {
          const matchesDTag = getTagOr(evt, 'd') === dTag;
          const matchesKind = wikiKinds.includes(evt.kind);
          const matchesPubkey = !pubkey || evt.pubkey === pubkey;
          return matchesDTag && matchesKind && matchesPubkey;
        })
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
      
      if (event) {
        // Store in appropriate cache based on kind
        const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                         event.kind === 30023 ? 'longform' :
                         (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
        if (cacheType) {
          await contentCache.storeEvents(cacheType, [{
            event,
            relays: result.relays
          }]);
        }
        return event;
      }
      
      return null;
    } catch (err) {
      console.error('Failed to fetch article:', err);
      return null;
    }
  }

  onMount(async () => {
    console.log('🔍 Diff component received with localStorage approach:', diffCard);
    console.log('🔍 data:', diffCard.data);
    
    // Try to retrieve selected events from localStorage
    const query = diffCard.data;
    const diffKey = `diff_${query}`;
    const storedEvents = localStorage.getItem(diffKey);
    
    if (storedEvents) {
      try {
        console.log('✅ Found stored events in localStorage');
        selectedEvents = JSON.parse(storedEvents);
        // Clean up the localStorage entry after use
        localStorage.removeItem(diffKey);
        performDiff();
      } catch (err) {
        console.error('❌ Failed to parse stored events:', err);
        error = 'Failed to load selected articles for comparison';
      }
    } else {
      console.log('❌ No stored events found in localStorage');
      // Fallback to legacy query-based format - fetch articles
      if (isDiffQuery(query)) {
        const parsed = parseDiffQuery(query);
        if (parsed && parsed.left && parsed.right) {
          loading = true;
          error = null;
          
          try {
            // Parse d-tag and pubkey from format: "dTag" or "dTag*pubkey"
            function parseArticleRef(ref: string): { dTag: string; pubkey?: string } {
              const cleaned = ref.replace(/^['"]|['"]$/g, '').trim();
              
              // Check if it's in format "dTag*pubkey"
              if (cleaned.includes('*')) {
                const parts = cleaned.split('*');
                if (parts.length === 2 && parts[1].length === 64) {
                  return {
                    dTag: normalizeIdentifier(parts[0].trim()),
                    pubkey: parts[1].trim()
                  };
                }
              }
              
              // Just d-tag
              return {
                dTag: normalizeIdentifier(cleaned)
              };
            }
            
            const leftRef = parseArticleRef(parsed.left);
            const rightRef = parseArticleRef(parsed.right);
            
            console.log('📥 Fetching articles for diff:', { left: leftRef, right: rightRef });
            
            // Check if both sides are the same (same d-tag and same pubkey if specified)
            if (leftRef.dTag === rightRef.dTag && 
                (!leftRef.pubkey || !rightRef.pubkey || leftRef.pubkey === rightRef.pubkey)) {
              error = `Both sides of the diff are the same article ("${parsed.left}"). Please specify two different articles to compare.`;
              loading = false;
              return;
            }
            
            // Fetch both articles
            const [leftEvent, rightEvent] = await Promise.all([
              fetchArticleByDTag(leftRef.dTag, leftRef.pubkey),
              fetchArticleByDTag(rightRef.dTag, rightRef.pubkey)
            ]);
            
            if (!leftEvent) {
              const leftDesc = leftRef.pubkey 
                ? `"${parsed.left}" (d-tag: ${leftRef.dTag}, pubkey: ${leftRef.pubkey.slice(0, 8)}...)`
                : `"${parsed.left}" (d-tag: ${leftRef.dTag})`;
              error = `Article ${leftDesc} not found`;
              loading = false;
              return;
            }
            
            if (!rightEvent) {
              const rightDesc = rightRef.pubkey 
                ? `"${parsed.right}" (d-tag: ${rightRef.dTag}, pubkey: ${rightRef.pubkey.slice(0, 8)}...)`
                : `"${parsed.right}" (d-tag: ${rightRef.dTag})`;
              error = `Article ${rightDesc} not found`;
              loading = false;
              return;
            }
            
            // Check if we got the same event (same event ID)
            if (leftEvent.id === rightEvent.id) {
              error = `Both sides resolved to the same article version. The articles "${parsed.left}" and "${parsed.right}" appear to be the same.`;
              loading = false;
              return;
            }
            
            // Set selected events and perform diff
            selectedEvents = [leftEvent, rightEvent];
            performDiff();
          } catch (err) {
            console.error('❌ Failed to fetch articles for diff:', err);
            error = err instanceof Error ? err.message : 'Failed to load articles for comparison';
            loading = false;
          }
        } else {
          error = 'Invalid diff query format';
        }
      } else {
        error = 'Invalid diff data format';
      }
    }
  });

  async function performDiff() {
    if (selectedEvents.length < 2) {
      error = 'Need at least 2 articles to compare';
      return;
    }

    loading = true;
    error = null;

    try {
      // For now, compare the first two selected events
      // TODO: In the future, we could implement multi-way diff comparison
      const leftEvent = selectedEvents[0];
      const rightEvent = selectedEvents[1];

      // Extract titles and content
      const leftTitle = getArticleTitle(leftEvent);
      const rightTitle = getArticleTitle(rightEvent);

      const result: DiffResult = {
        type: 'wiki',
        left: {
          title: leftTitle,
          content: leftEvent.content,
          pubkey: leftEvent.pubkey
        },
        right: {
          title: rightTitle,
          content: rightEvent.content,
          pubkey: rightEvent.pubkey
        },
        changes: []
      };

      // Calculate actual differences
      result.changes = diffText(result.left.content, result.right.content);
      
      diffResult = result;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<div class="diff-card w-full" 
     style="background-color: var(--theme-bg); color: var(--theme-text); transition: all 0.3s ease; width: 100%;">
  <div class="mb-4 flex justify-between items-center">
    <!-- Expand/Collapse Button -->
    {#if toggleExpand}
      <button
        onclick={toggleExpand}
        class="inline-flex items-center p-2 text-sm font-medium rounded-md transition-colors"
        style="color: {theme.accentColor}; background-color: var(--bg-primary); border: 1px solid {theme.accentColor};"
        onmouseover={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '0.8';
          }
        }}
        onmouseout={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '1';
          }
        }}
        onfocus={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '0.8';
          }
        }}
        onblur={(e) => {
          if (e.target) {
            (e.target as HTMLButtonElement).style.opacity = '1';
          }
        }}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {#if expanded}
          <!-- Collapse icon (compress) -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h6v6"/>
            <path d="M20 10h-6V4"/>
            <path d="M14 10l7-7"/>
            <path d="M3 21l7-7"/>
          </svg>
        {:else}
          <!-- Expand icon (maximize) -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>
            <path d="M21 8H8l5-5"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2" style="border-color: {theme.accentColor};"></div>
      <span class="ml-2" style="color: var(--theme-text-secondary);">Loading diff...</span>
    </div>
  {:else if error}
    <div class="rounded-lg p-4" style="background-color: #fef2f2; border: 1px solid #fecaca;">
      <h3 class="font-medium" style="color: #dc2626;">Error</h3>
      <p class="text-sm mt-1" style="color: #b91c1c;">{error}</p>
    </div>
  {:else if diffResult}
    <DiffView {diffResult} {expanded} />
  {:else}
    <div class="rounded-lg p-4" style="background-color: var(--theme-bg-secondary); border: 1px solid var(--theme-border);">
      <p style="color: var(--theme-text-secondary);">No diff data available</p>
    </div>
  {/if}
</div>
