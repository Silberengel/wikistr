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

  let passages = $state<Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }>>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  /**
   * Generate Bible Gateway URL for a specific passage card
   * Each card gets its own URL based on its specific version and section
   */
  function generateBibleGatewayUrl(
    collection: string | undefined,
    title: string,
    chapter: string | undefined,
    sectionValue: string | undefined,
    version: string | undefined
  ): string | null {
    if (collection !== 'bible') return null;

    // Map version codes (e.g., "drb" -> "DRA" for Bible Gateway)
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

    // Use the specific version for this card, or default to KJV
    const bgVersion = version 
      ? (versionMap[version.toLowerCase()] || version.toUpperCase())
      : 'KJV';

    // Format: book chapter:verse (using the specific section for this card)
    let search = title;
    if (chapter) {
      search += ` ${chapter}`;
      if (sectionValue) {
        // Use the specific section value for this card
        search += `:${sectionValue}`;
      }
    }

    // URL encode the search query
    const encodedSearch = encodeURIComponent(search);
    return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${bgVersion}`;
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
      // When multiple versions are specified, we need to fetch and group by version
      const fetchedPassages: Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }> = [];

      for (const ref of parsed.references) {
        // If multiple versions are specified, fetch events for each version separately
        const versionsToFetch = ref.version && ref.version.length > 0 ? ref.version : [undefined];
        
        // Store events grouped by version
        const eventsByVersion = new Map<string | undefined, Array<{ event: NostrEvent; sectionValue?: string }>>();
        
        for (const version of versionsToFetch) {
          // Check if we have a range of sections (e.g., ["4", "5", "6"] from "4-6")
          const hasRange = ref.section && ref.section.length > 1;
          const allNumeric = ref.section && ref.section.every(s => /^\d+$/.test(s));
          
          let foundEvents: Array<{ event: NostrEvent; sectionValue?: string }> = [];

          // Create a version-specific reference for this fetch
          const versionSpecificRef: ParsedBookReference = {
            ...ref,
            version: version ? [version] : undefined
          };
          
          if (hasRange && allNumeric && ref.section) {
            // Try to find events with range tag first (e.g., ["s", "4-6"])
            const rangeStart = ref.section[0];
            const rangeEnd = ref.section[ref.section.length - 1];
            const rangeValue = `${rangeStart}-${rangeEnd}`;
            
            const rangeTags = bookReferenceToTags(versionSpecificRef);
            // Replace individual section tags with a single range tag
            const rangeTagsFiltered = rangeTags.filter(([tag]) => tag !== 's');
            rangeTagsFiltered.push(['s', rangeValue]);
            
            const rangeFilters: any = {
              kinds: [30041],
              limit: 50
            };
            
            for (const [tag, value] of rangeTagsFiltered) {
              if (tag === 'C') {
                rangeFilters['#C'] = rangeFilters['#C'] || [];
                rangeFilters['#C'].push(value);
              } else if (tag === 'T') {
                rangeFilters['#T'] = rangeFilters['#T'] || [];
                rangeFilters['#T'].push(value);
              } else if (tag === 'c') {
                rangeFilters['#c'] = rangeFilters['#c'] || [];
                rangeFilters['#c'].push(value);
              } else if (tag === 's') {
                rangeFilters['#s'] = rangeFilters['#s'] || [];
                rangeFilters['#s'].push(value);
              } else if (tag === 'v') {
                rangeFilters['#v'] = rangeFilters['#v'] || [];
                rangeFilters['#v'].push(value);
              }
            }
            
            const rangeResult = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [rangeFilters],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined
              }
            );
            
            // Check if any event has the range as a single tag
            for (const event of rangeResult.events) {
              const eventSections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
              if (eventSections.includes(rangeValue)) {
                foundEvents.push({ event, sectionValue: rangeValue });
              }
            }
          }
          
          // If no range events found, search for individual sections
          if (foundEvents.length === 0 && ref.section && ref.section.length > 0) {
            const baseTags = bookReferenceToTags(versionSpecificRef);
            const baseFilters: any = {
              kinds: [30041],
              limit: 50
            };
            
            // Add all non-section tags
            for (const [tag, value] of baseTags) {
              if (tag === 'C') {
                baseFilters['#C'] = baseFilters['#C'] || [];
                baseFilters['#C'].push(value);
              } else if (tag === 'T') {
                baseFilters['#T'] = baseFilters['#T'] || [];
                baseFilters['#T'].push(value);
              } else if (tag === 'c') {
                baseFilters['#c'] = baseFilters['#c'] || [];
                baseFilters['#c'].push(value);
              } else if (tag === 'v') {
                baseFilters['#v'] = baseFilters['#v'] || [];
                baseFilters['#v'].push(value);
              }
            }
            
            // Add all section values to search for
            if (ref.section.length > 0) {
              baseFilters['#s'] = ref.section;
            }
            
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [baseFilters],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined
              }
            );
            
            // Collect events with their section values
            const eventMap = new Map<string, { event: NostrEvent; sectionValue?: string }>();
            
            for (const event of result.events) {
              const eventSections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
              
              // Find matching sections
              for (const querySection of ref.section) {
                if (eventSections.includes(querySection)) {
                  // Use event ID as key to avoid duplicates
                  if (!eventMap.has(event.id)) {
                    eventMap.set(event.id, { event, sectionValue: querySection });
                  }
                }
              }
            }
            
            foundEvents = Array.from(eventMap.values());
            
            // If sections are numeric, sort by section value numerically
            if (allNumeric) {
              foundEvents.sort((a, b) => {
                const aVal = a.sectionValue ? parseInt(a.sectionValue, 10) : 0;
                const bVal = b.sectionValue ? parseInt(b.sectionValue, 10) : 0;
                return aVal - bVal;
              });
            } else if (ref.chapter) {
              // Non-numeric sections: find 30040 index event for ordering
              const indexFilters: any = {
                kinds: [30040],
                limit: 1
              };
              
              const baseTagsForIndex = baseTags.filter(([tag]) => tag !== 's' && tag !== 'v');
              for (const [tag, value] of baseTagsForIndex) {
                if (tag === 'C') {
                  indexFilters['#C'] = indexFilters['#C'] || [];
                  indexFilters['#C'].push(value);
                } else if (tag === 'T') {
                  indexFilters['#T'] = indexFilters['#T'] || [];
                  indexFilters['#T'].push(value);
                } else if (tag === 'c') {
                  indexFilters['#c'] = indexFilters['#c'] || [];
                  indexFilters['#c'].push(value);
                }
              }
              
              try {
                const indexResult = await relayService.queryEvents(
                  'anonymous',
                  'wiki-read',
                  [indexFilters],
                  {
                    excludeUserContent: false,
                    currentUserPubkey: undefined
                  }
                );
                
                if (indexResult.events.length > 0) {
                  const indexEvent = indexResult.events[0];
                  // Parse index event to get section order
                  // Index events can have 'e' tags (event IDs) or 'a' tags (kind:pubkey:identifier) pointing to content events
                  const orderedEventIds: string[] = [];
                  const orderedATags: string[] = [];
                  
                  // Extract 'e' tags (event IDs)
                  const eTags = indexEvent.tags.filter(([t]) => t === 'e');
                  for (const [, eventId] of eTags) {
                    orderedEventIds.push(eventId);
                  }
                  
                  // Extract 'a' tags (kind:pubkey:identifier)
                  const aTags = indexEvent.tags.filter(([t]) => t === 'a');
                  for (const [, aTagValue] of aTags) {
                    orderedATags.push(aTagValue);
                  }
                  
                  // Sort found events by their position in the index
                  // a-tags are the default in indexes, e-tags are less common
                  foundEvents.sort((a, b) => {
                    // Try to match by 'a' tag first (kind:pubkey:identifier) - this is the default
                    // For 30041 events, construct a tag as "30041:pubkey:d-tag"
                    const aDTag = a.event.tags.find(([t]) => t === 'd')?.[1] || '';
                    const aATag = aDTag ? `${a.event.kind}:${a.event.pubkey}:${aDTag}` : '';
                    const aIndexByATag = aATag ? orderedATags.indexOf(aATag) : -1;
                    
                    const bDTag = b.event.tags.find(([t]) => t === 'd')?.[1] || '';
                    const bATag = bDTag ? `${b.event.kind}:${b.event.pubkey}:${bDTag}` : '';
                    const bIndexByATag = bATag ? orderedATags.indexOf(bATag) : -1;
                    
                    // Fall back to event ID matching (from 'e' tags) if 'a' tag not found
                    const aIndexById = aIndexByATag === -1 ? orderedEventIds.indexOf(a.event.id) : -1;
                    const bIndexById = bIndexByATag === -1 ? orderedEventIds.indexOf(b.event.id) : -1;
                    
                    // Use whichever index is found (prefer 'a' tag index as it's the default)
                    const aIndex = aIndexByATag !== -1 ? aIndexByATag : (aIndexById !== -1 ? orderedATags.length + aIndexById : -1);
                    const bIndex = bIndexByATag !== -1 ? bIndexByATag : (bIndexById !== -1 ? orderedATags.length + bIndexById : -1);
                    
                    // If not in index, put at end
                    if (aIndex === -1 && bIndex === -1) return 0;
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    
                    return aIndex - bIndex;
                  });
                }
              } catch (e) {
                console.warn('Failed to fetch index event for ordering:', e);
              }
            }
          }
          
          // Store events for this version
          eventsByVersion.set(version, foundEvents);
        }
        
        // Now combine events from all versions, grouped by version in order
        // Sort versions in the order they were specified
        const versionOrder = ref.version && ref.version.length > 0 ? ref.version : [undefined];
        for (const version of versionOrder) {
          const versionEvents = eventsByVersion.get(version) || [];
          for (const { event, sectionValue } of versionEvents) {
            fetchedPassages.push({ event, reference: ref, sectionValue, version });
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
    {#each passages as { event, reference, sectionValue, version } (event.id)}
      <div class="book-passage-item" style="margin-bottom: 1rem; padding: 1rem; background-color: var(--bg-secondary); border-radius: 0.5rem; position: relative;">
        <!-- Bible Gateway link icon (top-right) - unique for each card -->
        {#if reference.collection === 'bible'}
          {@const bgUrl = generateBibleGatewayUrl(reference.collection, reference.title, reference.chapter, sectionValue, version)}
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
            {#if sectionValue}
              :{sectionValue}
            {:else if reference.section && reference.section.length > 0}
              :{reference.section.join(',')}
            {/if}
          {/if}
          {#if version}
            ({version})
          {:else if reference.version && reference.version.length > 0}
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

