<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { parseBookWikilink, bookReferenceToTags, type ParsedBookReference, type ParsedBookWikilink } from '$lib/bookWikilinkParser';
  import type { Card, BookCard, ArticleCard } from '$lib/types';
  import { next, getTagOr } from '$lib/utils';

  interface Props {
    bookstrContent: string;
    createChild?: (card: Card) => void;
    relayHints?: string[];
  }

  let { bookstrContent, createChild = () => {}, relayHints = [] }: Props = $props();

  let passages = $state<Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }>>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let parsedReference = $state<ParsedBookWikilink | null>(null);

  /**
   * Format a reference for Bible Gateway search
   * Examples:
   * - "romans 3:16,17,18" for multiple verses
   * - "romans 3:16-18" for a range
   * - "1 Macc 1:2,4" for multiple verses in a book with number
   */
  function formatReferenceForBibleGateway(ref: ParsedBookReference): string {
    let formatted = capitalizeWords(ref.title);
    
    if (ref.chapter) {
      formatted += ` ${ref.chapter}`;
      if (ref.section && ref.section.length > 0) {
        // Check if sections form a range (consecutive numbers)
        if (ref.section.length > 1 && ref.section.every((s: string) => /^\d+$/.test(s))) {
          const nums = ref.section.map((s: string) => parseInt(s, 10)).sort((a, b) => a - b);
          const isConsecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
          
          if (isConsecutive) {
            // Format as range: "16-18"
            formatted += `:${nums[0]}-${nums[nums.length - 1]}`;
          } else {
            // Format as comma-separated: "16,17,18"
            formatted += `:${ref.section.join(',')}`;
          }
        } else {
          // Non-numeric or mixed: use comma-separated
          formatted += `:${ref.section.join(',')}`;
        }
      }
    }
    
    return formatted;
  }

  /**
   * Generate Bible Gateway URL for all references in a wikilink
   * One URL with all references and all versions (semicolon-separated)
   */
  function generateBibleGatewayUrlForWikilink(
    parsed: ParsedBookWikilink
  ): string | null {
    // Only generate URLs for Bible passages
    const hasBible = parsed.references.some(ref => ref.collection === 'bible' || !ref.collection);
    if (!hasBible) return null;

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

    // Collect all unique versions from all references
    const allVersions = new Set<string>();
    for (const ref of parsed.references) {
      if (ref.version && ref.version.length > 0) {
        for (const v of ref.version) {
          allVersions.add(v.toLowerCase());
        }
      }
    }

    // Map versions to Bible Gateway codes, default to DRA if none specified
    const bgVersions: string[] = [];
    if (allVersions.size > 0) {
      for (const v of allVersions) {
        const bgVersion = versionMap[v] || v.toUpperCase();
        bgVersions.push(bgVersion);
      }
    } else {
      // Default to DRA if no version specified
      bgVersions.push('DRA');
    }

    // Format all Bible references
    const bibleRefs = parsed.references
      .filter((ref: ParsedBookReference) => ref.collection === 'bible' || !ref.collection)
      .map((ref: ParsedBookReference) => formatReferenceForBibleGateway(ref));
    
    if (bibleRefs.length === 0) return null;

    // Join multiple references with ", "
    const search = bibleRefs.join(', ');
    const encodedSearch = encodeURIComponent(search);
    
    // Join versions with semicolons: DRA;NIV;KJV
    const versionParam = bgVersions.join(';');
    
    return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${versionParam}`;
  }

  /**
   * Format a book reference as human-readable text
   */
  function formatReference(reference: ParsedBookReference): string {
    let formatted = reference.title;
    
    if (reference.chapter) {
      formatted += ` ${reference.chapter}`;
      if (reference.section && reference.section.length > 0) {
        formatted += `:${reference.section.join(',')}`;
      }
    }
    
    if (reference.version && reference.version.length > 0) {
      formatted += ` (${reference.version.join(', ')})`;
    }
    
    return formatted;
  }

  /**
   * Capitalize first letter of each word for display
   */
  function capitalizeWords(text: string): string {
    return text.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }

  // Parse immediately for fallback display
  const fullWikilink = `[[book::${bookstrContent}]]`;
  const initialParsed = parseBookWikilink(fullWikilink);
  if (initialParsed && initialParsed.references.length > 0) {
    parsedReference = initialParsed;
  }

  onMount(() => {
    // Load passages in the background to avoid blocking the main content
    // Use requestIdleCallback if available, otherwise use a small delay
    const loadPassages = async () => {
      try {
        // Use already parsed reference
        const parsed = parsedReference;
        
        if (!parsed || parsed.references.length === 0) {
          error = 'Failed to parse bookstr wikilink';
          loading = false;
          return;
        }

        // Check cache first for instant results
        const { contentCache } = await import('$lib/contentCache');
        const cachedEvents = contentCache.getEvents('wiki');
        const bookKinds = [30040, 30041]; // Book event kinds
        
        // Helper function to check if an event matches a book reference
        const eventMatchesRef = (event: NostrEvent, ref: ParsedBookReference, version?: string): { matches: boolean; sectionValue?: string } => {
          // Check kind
          if (!bookKinds.includes(event.kind)) return { matches: false };
          
          // Get tags
          const cTag = event.tags.find(([t]) => t === 'C')?.[1]?.toLowerCase();
          const tTag = event.tags.find(([t]) => t === 'T')?.[1];
          const chapterTag = event.tags.find(([t]) => t === 'c')?.[1];
          const sectionTags = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
          const vTag = event.tags.find(([t]) => t === 'v')?.[1]?.toLowerCase();
          
          // Check collection (C tag)
          if (ref.collection && cTag !== ref.collection.toLowerCase()) {
            return { matches: false };
          }
          
          // Check book name (T tag) - normalize for comparison
          if (ref.title) {
            const normalizedRefTitle = ref.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const normalizedEventTitle = (tTag || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            if (normalizedEventTitle !== normalizedRefTitle) {
              return { matches: false };
            }
          }
          
          // Check chapter (c tag)
          if (ref.chapter && chapterTag !== ref.chapter.toString()) {
            return { matches: false };
          }
          
          // Check version (v tag)
          if (version && vTag !== version.toLowerCase()) {
            return { matches: false };
          }
          
          // Check sections (s tags)
          if (ref.section && ref.section.length > 0) {
            const matchingSection = ref.section.find(s => sectionTags.includes(s));
            if (matchingSection) {
              return { matches: true, sectionValue: matchingSection };
            }
            // Also check for range tags (e.g., "3-16")
            const rangeMatch = ref.section.find(s => {
              const range = sectionTags.find(st => st.includes('-') && st.startsWith(s.split('-')[0]));
              return range !== undefined;
            });
            if (rangeMatch) {
              return { matches: true, sectionValue: rangeMatch };
            }
            return { matches: false };
          }
          
          return { matches: true };
        };

      // Fetch events for each reference
      // When multiple versions are specified, we need to fetch and group by version
      const fetchedPassages: Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }> = [];

      for (const ref of parsed.references) {
        // If multiple versions are specified, fetch events for each version separately
        const versionsToFetch = ref.version && ref.version.length > 0 ? ref.version : [undefined];
        
        // Store events grouped by version
        const eventsByVersion = new Map<string | undefined, Array<{ event: NostrEvent; sectionValue?: string }>>();
        
        for (const version of versionsToFetch) {
          // Check cache first
          let foundEvents: Array<{ event: NostrEvent; sectionValue?: string }> = [];
          
          for (const cached of cachedEvents) {
            if (bookKinds.includes(cached.event.kind)) {
              const match = eventMatchesRef(cached.event, ref, version);
              if (match.matches) {
                foundEvents.push({ event: cached.event, sectionValue: match.sectionValue });
              }
            }
          }
          
          if (foundEvents.length > 0) {
            console.log(`BookPassageGroup: Found ${foundEvents.length} cached events for "${ref.title}"`);
            eventsByVersion.set(version, foundEvents);
            continue; // Skip relay query if we found cached events
          }
          
          // Check if we have a range of sections (e.g., ["4", "5", "6"] from "4-6")
          const hasRange = ref.section && ref.section.length > 1;
          const allNumeric = ref.section && ref.section.every(s => /^\d+$/.test(s));
          
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
                currentUserPubkey: undefined,
                customRelays: relayHints.length > 0 ? relayHints : undefined
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
            // Batch sections to avoid "too many tags" relay errors
            // Most relays limit tag arrays to ~10-20 items, use conservative size
            const SECTION_BATCH_SIZE = 10;
            const sectionBatches: string[][] = [];
            
            for (let i = 0; i < ref.section.length; i += SECTION_BATCH_SIZE) {
              sectionBatches.push(ref.section.slice(i, i + SECTION_BATCH_SIZE));
            }
            
            // Query each batch separately
            for (const sectionBatch of sectionBatches) {
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
              
              // Add section batch to search for
              baseFilters['#s'] = sectionBatch;
              
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [baseFilters],
                {
                  excludeUserContent: false,
                  currentUserPubkey: undefined,
                  customRelays: relayHints.length > 0 ? relayHints : undefined
                }
              );
              
              // Collect events from this batch
              const eventMap = new Map<string, { event: NostrEvent; sectionValue?: string }>();
              
              for (const event of result.events) {
                const eventSections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
                
                // Find matching sections
                for (const querySection of sectionBatch) {
                  if (eventSections.includes(querySection)) {
                    // Use event ID as key to avoid duplicates
                    if (!eventMap.has(event.id)) {
                      eventMap.set(event.id, { event, sectionValue: querySection });
                    }
                  }
                }
              }
              
              // Add found events from this batch
              foundEvents.push(...Array.from(eventMap.values()));
            }
            
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
              
              const baseTagsForIndex = bookReferenceToTags(versionSpecificRef).filter(([tag]) => tag !== 's' && tag !== 'v');
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
                    currentUserPubkey: undefined,
                    customRelays: relayHints.length > 0 ? relayHints : undefined
                  }
                );
                
                if (indexResult.events.length > 0) {
                  const indexEvent = indexResult.events[0];
                  // Parse index event to get section order
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
                  foundEvents.sort((a, b) => {
                    const aDTag = a.event.tags.find(([t]) => t === 'd')?.[1] || '';
                    const aATag = aDTag ? `${a.event.kind}:${a.event.pubkey}:${aDTag}` : '';
                    const aIndexByATag = aATag ? orderedATags.indexOf(aATag) : -1;
                    
                    const bDTag = b.event.tags.find(([t]) => t === 'd')?.[1] || '';
                    const bATag = bDTag ? `${b.event.kind}:${b.event.pubkey}:${bDTag}` : '';
                    const bIndexByATag = bATag ? orderedATags.indexOf(bATag) : -1;
                    
                    const aIndexById = aIndexByATag === -1 ? orderedEventIds.indexOf(a.event.id) : -1;
                    const bIndexById = bIndexByATag === -1 ? orderedEventIds.indexOf(b.event.id) : -1;
                    
                    const aIndex = aIndexByATag !== -1 ? aIndexByATag : (aIndexById !== -1 ? orderedATags.length + aIndexById : -1);
                    const bIndex = bIndexByATag !== -1 ? bIndexByATag : (bIndexById !== -1 ? orderedATags.length + bIndexById : -1);
                    
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
          
          // If we still have no events and no sections, try a general search
          if (foundEvents.length === 0 && (!ref.section || ref.section.length === 0)) {
            // This is a fallback for queries without sections (e.g., just book/chapter)
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
            
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [baseFilters],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined
              }
            );
            
            // Collect events
            for (const event of result.events) {
              foundEvents.push({ event });
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
    };
    
    // Use requestIdleCallback for background loading, with fallback
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadPassages, { timeout: 2000 });
    } else {
      // Fallback: use setTimeout with a small delay to allow main content to render first
      setTimeout(loadPassages, 100);
    }
  });
  
  function handleClick() {
    // Create a BookCard with the original query to allow searching/filtering
    const bookCard: BookCard = {
      id: next(),
      type: 'book',
      data: bookstrContent
    };
    createChild(bookCard);
  }
  
  function openEvent(event: NostrEvent, ev?: MouseEvent) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    // Create an ArticleCard to display the book event in a new panel
    const dTag = getTagOr(event, 'd');
    const articleCard: ArticleCard = {
      id: next(),
      type: 'article',
      data: [dTag || '', event.pubkey],
      relayHints: [],
      actualEvent: {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags.map(tag => [...tag]),
        content: event.content,
        sig: event.sig
      }
    };
    createChild(articleCard);
  }
</script>

{#if loading || passages.length === 0}
  <!-- Fallback card: show while loading or if no passages found -->
  {#if parsedReference}
    {@const bgUrl = generateBibleGatewayUrlForWikilink(parsedReference)}
    <div 
      class="book-passage-fallback" 
      style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding: 1.25rem; background-color: var(--bg-secondary); border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; cursor: pointer;"
      onclick={handleClick}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && handleClick()}
      title="Click to search for this book passage"
    >
      <!-- Bible Gateway link (top-right) - one link for entire wikilink with all references and versions -->
      {#if bgUrl}
        <a 
          href={bgUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          class="bible-gateway-link"
          style="position: absolute; top: 0.75rem; right: 0.75rem; text-decoration: none; color: var(--accent); font-size: 1.25rem; transition: opacity 0.2s;"
          title="View on Bible Gateway"
        >
          🔗
        </a>
      {/if}

      <!-- All references -->
      {#each parsedReference.references as ref (ref.title + (ref.chapter || '') + (ref.section?.join(',') || ''))}
        <div class="book-passage-fallback-item" style="margin-bottom: 0.75rem; padding: 0.75rem; background-color: var(--bg-primary); border-radius: 0.375rem;">
          <!-- Passage reference (human-readable) -->
          <div class="passage-reference" style="font-weight: 600; font-size: 1rem; color: var(--text-primary); line-height: 1.4;">
            {capitalizeWords(ref.title)}
            {#if ref.chapter}
              {ref.chapter}
              {#if ref.section && ref.section.length > 0}
                :{ref.section.length === 1 ? ref.section[0] : `${ref.section[0]}-${ref.section[ref.section.length - 1]}`}
              {/if}
            {/if}
            {#if ref.version && ref.version.length > 0}
              <span style="font-weight: 400; color: var(--text-secondary); font-size: 0.9em; margin-left: 0.5rem;">
                ({ref.version.map((v: string) => v.toUpperCase()).join(', ')})
              </span>
            {/if}
          </div>
        </div>
      {/each}

      <!-- Loading or not found message -->
      <div class="passage-status" style="color: var(--text-secondary); font-style: italic; font-size: 0.95rem; margin-top: 0.5rem;">
        {#if loading}
          <span style="display: inline-block; animation: pulse 2s ease-in-out infinite;">Loading passage...</span>
        {:else}
          Passage not found on Nostr relays
        {/if}
      </div>
    </div>
  {:else}
    <div class="book-passage-loading" style="padding: 1rem; text-align: center; color: var(--text-secondary);">
      Loading passages...
    </div>
  {/if}
{:else if error}
  <div class="book-passage-error" style="padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; background-color: var(--bg-secondary); color: var(--text-error);">
    {error}
  </div>
{:else if passages.length > 0}
  {@const passagesByVersion = (() => {
    const grouped = new Map<string | undefined, Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }>>();
    for (const passage of passages) {
      const versionKey = passage.version || undefined; // undefined means default DRA
      if (!grouped.has(versionKey)) {
        grouped.set(versionKey, []);
      }
      grouped.get(versionKey)!.push(passage);
    }
    return grouped;
  })()}
  {@const bgUrl = parsedReference ? generateBibleGatewayUrlForWikilink(parsedReference) : null}
  <div 
    class="book-passage-group" 
    style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding: 1.25rem; background-color: var(--bg-secondary); border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; cursor: pointer;"
    onclick={handleClick}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && handleClick()}
    title="Click to search for this book passage"
  >
    <!-- Bible Gateway link (top-right) - one link for entire wikilink with all references and versions -->
    {#if bgUrl}
      <a 
        href={bgUrl} 
        target="_blank" 
        rel="noopener noreferrer"
        class="bible-gateway-link"
        style="position: absolute; top: 0.75rem; right: 0.75rem; text-decoration: none; color: var(--accent); font-size: 1.25rem; transition: opacity 0.2s;"
        title="View on Bible Gateway"
      >
        🔗
      </a>
    {/if}

    <!-- All passages grouped by version -->
    {#each Array.from(passagesByVersion.entries()) as [version, versionPassages], i}
      <!-- Version header -->
      <div class="version-header" style="font-weight: 600; font-size: 1rem; margin-bottom: 1rem; margin-top: {i === 0 ? '0' : '1.5rem'}; color: var(--text-secondary); text-transform: uppercase;">
        {version ? version : 'DRA'}
      </div>

      <!-- All passages for this version -->
      {#each versionPassages as { event, reference, sectionValue } (event.id)}
        <div class="book-passage-item" style="margin-bottom: 1rem; padding: 1rem; background-color: var(--bg-primary); border-radius: 0.375rem;">
          <!-- Passage title/reference - clickable to open event -->
          <div 
            class="passage-reference" 
            style="font-weight: bold; margin-bottom: 0.5rem; color: var(--accent); cursor: pointer; text-decoration: underline;"
            onclick={(e) => openEvent(event, e)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && openEvent(event, e)}
            title="Click to open this passage in a new panel"
          >
            {reference.title}
            {#if reference.chapter}
              {reference.chapter}
              {#if sectionValue}
                :{sectionValue}
              {:else if reference.section && reference.section.length > 0}
                :{reference.section.join(',')}
              {/if}
            {/if}
          </div>

          <!-- Passage content -->
          <div class="passage-content" style="font-style: italic; color: var(--text-primary);">
            {event.content}
          </div>
        </div>
      {/each}
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

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>

