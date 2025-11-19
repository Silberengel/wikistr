<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { parseBookWikilink, bookReferenceToTags, type ParsedBookReference } from '$lib/bookWikilinkParser';
  import type { Card } from '$lib/types';

  interface Props {
    bookstrContent: string;
    createChild?: (card: Card) => void;
  }

  let { bookstrContent, createChild = () => {} }: Props = $props();

  let passages = $state<Array<{ event: NostrEvent; reference: ParsedBookReference }>>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  /**
   * Generate Bible Gateway URL for a book reference
   */
  function generateBibleGatewayUrl(ref: ParsedBookReference): string | null {
    if (ref.collection !== 'bible') return null;

    // Map version codes (e.g., "DRB" -> "DRA" for Bible Gateway)
    const versionMap: Record<string, string> = {
      'drb': 'DRA',
      'kjv': 'KJV',
      'niv': 'NIV',
      'esv': 'ESV',
      'nasb': 'NASB',
      'nlt': 'NLT',
      'rsv': 'RSV',
      'asv': 'ASV',
      'web': 'WEB'
    };

    const version = ref.version && ref.version.length > 0 
      ? versionMap[ref.version[0].toLowerCase()] || ref.version[0].toUpperCase()
      : 'KJV';

    // Format: book chapter:verse
    let search = ref.title;
    if (ref.chapter) {
      search += ` ${ref.chapter}`;
      if (ref.section && ref.section.length > 0) {
        // Use first and last section for range if multiple
        if (ref.section.length === 1) {
          search += `:${ref.section[0]}`;
        } else {
          search += `:${ref.section[0]}-${ref.section[ref.section.length - 1]}`;
        }
      }
    }

    // URL encode the search query
    const encodedSearch = encodeURIComponent(search);
    return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${version}`;
  }

  onMount(async () => {
    try {
      // Parse the bookstr wikilink
      const fullWikilink = `[[book::${bookstrContent}]]`;
      const parsed = parseBookWikilink(fullWikilink);
      
      if (!parsed || parsed.references.length === 0) {
        error = 'Failed to parse bookstr wikilink';
        loading = false;
        return;
      }

      // Fetch events for each reference
      const fetchedPassages: Array<{ event: NostrEvent; reference: ParsedBookReference }> = [];

      for (const ref of parsed.references) {
        // Convert reference to search tags
        const tags = bookReferenceToTags(ref);
        
        // Build search query
        const filters: any = {
          kinds: [30041], // Publication content events
          limit: 50
        };

        // Add tag filters
        for (const [tag, value] of tags) {
          if (tag === 'C') {
            filters['#C'] = filters['#C'] || [];
            filters['#C'].push(value);
          } else if (tag === 'T') {
            filters['#T'] = filters['#T'] || [];
            filters['#T'].push(value);
          } else if (tag === 'c') {
            filters['#c'] = filters['#c'] || [];
            filters['#c'].push(value);
          } else if (tag === 's') {
            filters['#s'] = filters['#s'] || [];
            filters['#s'].push(value);
          } else if (tag === 'v') {
            filters['#v'] = filters['#v'] || [];
            filters['#v'].push(value);
          }
        }

        // Query events
        const result = await relayService.queryEvents(
          'anonymous',
          'wiki-read',
          [filters],
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );

        // Match events to this reference
        for (const event of result.events) {
          // Check if event matches the reference tags
          let matches = true;
          for (const [tag, value] of tags) {
            const eventTag = event.tags.find(([t]) => t === tag);
            if (!eventTag || eventTag[1] !== value) {
              // For section tags, check if any section matches
              if (tag === 's') {
                const eventSections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
                if (!eventSections.includes(value)) {
                  matches = false;
                  break;
                }
              } else {
                matches = false;
                break;
              }
            }
          }

          if (matches) {
            fetchedPassages.push({ event, reference: ref });
          }
        }
      }

      passages = fetchedPassages;
    } catch (e) {
      error = `Failed to fetch book passages: ${e}`;
      console.error('BookPassageGroup error:', e);
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="book-passage-loading" style="padding: 1rem; text-align: center; color: var(--text-secondary);">
    Loading passages...
  </div>
{:else if error}
  <div class="book-passage-error" style="padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; background-color: var(--bg-secondary); color: var(--text-error);">
    {error}
  </div>
{:else if passages.length > 0}
  <div class="book-passage-group" style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding-left: 1rem; padding-right: 1rem;">
    {#each passages as { event, reference } (event.id)}
      <div class="book-passage-item" style="margin-bottom: 1rem; padding: 1rem; background-color: var(--bg-secondary); border-radius: 0.5rem; position: relative;">
        <!-- Bible Gateway link icon (top-right) -->
        {#if reference.collection === 'bible'}
          {@const bgUrl = generateBibleGatewayUrl(reference)}
          {#if bgUrl}
            <a 
              href={bgUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              class="bible-gateway-link"
              style="position: absolute; top: 0.5rem; right: 0.5rem; text-decoration: none; color: var(--accent); font-size: 1.25rem;"
              title="View on Bible Gateway"
            >
              🔗
            </a>
          {/if}
        {/if}

        <!-- Passage title/reference -->
        <div class="passage-reference" style="font-weight: bold; margin-bottom: 0.5rem; color: var(--text-primary);">
          {reference.title}
          {#if reference.chapter}
            {reference.chapter}
            {#if reference.section && reference.section.length > 0}
              :{reference.section.join(',')}
            {/if}
          {/if}
          {#if reference.version && reference.version.length > 0}
            ({reference.version.join(', ')})
          {/if}
        </div>

        <!-- Passage content -->
        <div class="passage-content" style="font-style: italic; color: var(--text-primary);">
          {event.content}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .book-passage-group {
    font-family: inherit;
  }
  
  .bible-gateway-link:hover {
    opacity: 0.7;
  }
</style>

