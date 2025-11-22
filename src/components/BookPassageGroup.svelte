<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { parseBookWikilink, bookReferenceToTags, type ParsedBookReference, type ParsedBookWikilink } from '$lib/bookWikilinkParser';
  import type { Card, BookCard, ArticleCard } from '$lib/types';
  import { next, getTagOr, formatSections } from '$lib/utils';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
  import { generateBibleGatewayUrl, generateBibleGatewayUrlForReference, fetchBibleGatewayOg } from '$lib/bibleGatewayUtils';
  import type { BookReference } from '$lib/books';
  import BookReferenceOgPreview from '$components/BookReferenceOgPreview.svelte';
  import { BOOK_TYPES } from '$lib/books';

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
  
  // OG preview state (same as Book.svelte)
  let ogPreview = $state<{ title?: string; description?: string; image?: string } | null>(null);
  let ogLoading = $state(false);
  let ogError = $state<string | null>(null);
  let referenceOgPreviews = $state<Map<string, { title?: string; description?: string; image?: string }>>(new Map());
  let referenceOgLoading = $state<Map<string, boolean>>(new Map());
  let referenceOgErrors = $state<Map<string, string | null>>(new Map());
  
  // Convert ParsedBookReference to BookReference
  function convertToBookReference(ref: ParsedBookReference): BookReference {
    return {
      book: ref.title,
      chapter: ref.chapter ? parseInt(ref.chapter, 10) : undefined,
      verse: ref.section ? (ref.section.length === 1 ? ref.section[0] : ref.section.join(',')) : undefined
    };
  }
  
  // Convert ParsedBookWikilink to format expected by BookReferenceOgPreview
  function convertToParsedQuery(parsed: ParsedBookWikilink): { references: BookReference[]; version?: string; versions?: string[] } | null {
    if (!parsed || parsed.references.length === 0) return null;
    
    const references: BookReference[] = parsed.references
      .filter((ref: ParsedBookReference) => ref.collection === 'bible' || !ref.collection)
      .map(convertToBookReference);
    
    if (references.length === 0) return null;
    
    // Collect all unique versions
    const allVersions = new Set<string>();
    for (const ref of parsed.references) {
      if (ref.version && ref.version.length > 0) {
        for (const v of ref.version) {
          allVersions.add(v.toLowerCase());
        }
      }
    }
    
    const versions = allVersions.size > 0 ? Array.from(allVersions) : undefined;
    
    return { references, versions };
  }
  
  // Helper to create a unique key for a reference
  function getReferenceKey(ref: BookReference): string {
    return `${ref.book || ''}:${ref.chapter || ''}:${ref.verse || ''}`;
  }
  
  // Helper to create a unique key for a reference with version
  function getReferenceKeyWithVersion(ref: BookReference, version?: string): string {
    const baseKey = getReferenceKey(ref);
    return version ? `${baseKey}:${version.toLowerCase()}` : baseKey;
  }
  
  // Load OG preview for a specific reference
  async function loadReferenceOgPreview(ref: BookReference, version?: string) {
    const refKey = version ? getReferenceKeyWithVersion(ref, version) : getReferenceKey(ref);
    const targetUrl = generateBibleGatewayUrlForReference(ref, version);
    
    if (!targetUrl) {
      referenceOgErrors.set(refKey, 'Could not generate BibleGateway URL');
      return;
    }

    if (referenceOgLoading.get(refKey) || referenceOgPreviews.has(refKey)) {
      return;
    }

    referenceOgLoading.set(refKey, true);
    referenceOgErrors.set(refKey, null);

    try {
      const preview = await fetchBibleGatewayOg(targetUrl);
      referenceOgPreviews.set(refKey, preview);
    } catch (error) {
      referenceOgErrors.set(refKey, (error as Error).message);
    } finally {
      referenceOgLoading.set(refKey, false);
    }
  }
  
  // Load combined OG preview
  async function loadBibleGatewayPreview(parsedQuery: { references: BookReference[]; version?: string; versions?: string[] }) {
    const targetUrl = generateBibleGatewayUrl(parsedQuery);
    
    if (!targetUrl) {
      ogPreview = null;
      ogError = null;
      return;
    }

    if (ogLoading) return;

    ogLoading = true;
    ogError = null;

    try {
      ogPreview = await fetchBibleGatewayOg(targetUrl);
    } catch (error) {
      ogError = (error as Error).message;
    } finally {
      ogLoading = false;
    }
  }

  /**
   * Generate Bible Gateway URL for all references in a wikilink
   * Uses shared utility to avoid duplication
   */
  function generateBibleGatewayUrlForWikilink(
    parsed: ParsedBookWikilink
  ): string | null {
    // Only generate URLs for Bible passages
    const hasBible = parsed.references.some(ref => ref.collection === 'bible' || !ref.collection);
    if (!hasBible) return null;

    // Convert ParsedBookReference to BookReference format for shared utility
    const references: BookReference[] = parsed.references
      .filter((ref: ParsedBookReference) => ref.collection === 'bible' || !ref.collection)
      .map((ref: ParsedBookReference) => ({
        book: ref.title,
        chapter: ref.chapter ? parseInt(ref.chapter, 10) : undefined,
        verse: ref.section ? (ref.section.length === 1 ? ref.section[0] : ref.section.join(',')) : undefined
      }));

    if (references.length === 0) return null;

    // Collect all unique versions from all references
    const allVersions = new Set<string>();
    for (const ref of parsed.references) {
      if (ref.version && ref.version.length > 0) {
        for (const v of ref.version) {
          allVersions.add(v.toLowerCase());
        }
      }
    }

    // Convert to format expected by generateBibleGatewayUrl
    const versions = allVersions.size > 0 ? Array.from(allVersions) : ['drb'];
    
    const parsedQuery = {
      references,
      versions: versions.length > 0 ? versions : undefined
    };

    // Use shared utility - for multiple versions, generate URL with first version
    // (Bible Gateway doesn't support multiple versions in one URL, so we use the first)
    return generateBibleGatewayUrl(parsedQuery, versions[0] || 'drb');
  }

  /**
   * Format a book reference as human-readable text
   */
  function formatReference(reference: ParsedBookReference): string {
    let formatted = reference.title;
    
    if (reference.chapter) {
      formatted += ` ${reference.chapter}`;
      if (reference.section && reference.section.length > 0) {
        // Format sections, preserving ranges (e.g., "16-18" instead of "16,17,18")
        const formattedSections = formatSections(reference.section);
        formatted += `:${formattedSections}`;
      }
    }
    
    if (reference.version && reference.version.length > 0) {
      formatted += ` (${reference.version.join(', ')})`;
    }
    
    return formatted;
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
        const cachedEvents = await contentCache.getEvents('wiki');
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
          
          // Check book name (T tag) - normalize for comparison using normalizeIdentifier
          if (ref.title) {
            const normalizedRefTitle = normalizeIdentifier(ref.title).toLowerCase();
            const normalizedEventTitle = normalizeIdentifier(tTag || '').toLowerCase();
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
          
          if (cachedEvents && Array.isArray(cachedEvents)) {
            for (const cached of cachedEvents) {
              if (cached && cached.event && bookKinds.includes(cached.event.kind)) {
                const match = eventMatchesRef(cached.event, ref, version);
                if (match.matches) {
                  foundEvents.push({ event: cached.event, sectionValue: match.sectionValue });
                }
              }
            }
          }
          
          if (foundEvents.length > 0) {
            console.log(`BookPassageGroup: Found ${foundEvents.length} cached events for "${ref.title}" ${ref.chapter ? `chapter ${ref.chapter}` : ''} ${ref.section ? `sections ${ref.section.join(',')}` : ''} ${version ? `version ${version}` : ''}`);
            eventsByVersion.set(version, foundEvents);
            continue; // Skip relay query if we found cached events
          }
          
          console.log(`BookPassageGroup: No cached events found for "${ref.title}" ${ref.chapter ? `chapter ${ref.chapter}` : ''} ${ref.section ? `sections ${ref.section.join(',')}` : ''} ${version ? `version ${version}` : ''}, querying relays...`);
          
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
        console.error('BookPassageGroup errors:', e);
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
  
  // Load OG previews when no passages are found - always load individual reference previews
  $effect(() => {
    if (!loading && passages.length === 0 && parsedReference && parsedReference.references.length > 0) {
      const parsedQuery = convertToParsedQuery(parsedReference);
      if (parsedQuery) {
        const hasBible = parsedQuery.references.some(ref => ref.book);
        if (hasBible) {
          // Always load OG preview for each reference (same for single and multiple)
          for (const ref of parsedQuery.references) {
            const version = parsedQuery.versions?.[0] || parsedQuery.version;
            const refKey = getReferenceKeyWithVersion(ref, version);
            if (!referenceOgPreviews.has(refKey) && !referenceOgLoading.get(refKey)) {
              loadReferenceOgPreview(ref, version).catch(err => console.error('Failed to load reference OG:', err));
            }
          }
        }
      }
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

{#if loading}
  <!-- Loading spinner -->
  <div class="book-passage-loading" style="padding: 1rem; text-align: center; color: var(--text-secondary);">
    <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>
    <span style="margin-left: 0.5rem;">Loading passage...</span>
  </div>
{:else if passages.length === 0}
  <!-- No passages found - always show individual reference cards (same for single and multiple) -->
  {#if parsedReference}
    {@const parsedQuery = convertToParsedQuery(parsedReference)}
    {@const hasBible = parsedQuery && parsedQuery.references.some(ref => ref.book)}
    {#if parsedQuery && hasBible}
      {@const bgUrl = generateBibleGatewayUrl(parsedQuery)}
      {@const buttonOgImage = ogPreview?.image || (parsedQuery.references?.[0] ? referenceOgPreviews.get(getReferenceKeyWithVersion(parsedQuery.references[0], parsedQuery.versions?.[0] || parsedQuery.version))?.image : null)}
      <!-- Always show one header, then list each reference separately (same for single and multiple) -->
      <div class="mt-4 space-y-4">
        <div class="space-y-4">
          <h3 class="text-base font-bold text-gray-900">BibleGateway</h3>
          {#each parsedQuery.references as ref}
            {@const refKey = getReferenceKeyWithVersion(ref, parsedQuery.versions?.[0] || parsedQuery.version)}
            {@const refBgUrl = generateBibleGatewayUrlForReference(ref, parsedQuery.versions?.[0] || parsedQuery.version)}
            <BookReferenceOgPreview
              reference={ref}
              bibleGatewayUrl={refBgUrl}
              ogPreview={referenceOgPreviews.get(refKey) || null}
              ogLoading={referenceOgLoading.get(refKey) || false}
              ogError={referenceOgErrors.get(refKey) || null}
            />
          {/each}
          {#if bgUrl}
            <div class="flex justify-center pt-2">
              <a
                href={bgUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors shadow-sm hover:shadow"
              >
                {#if buttonOgImage}
                  <img
                    src={buttonOgImage}
                    alt="BibleGateway"
                    class="w-10 h-10 object-contain"
                    onerror={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.style.display = 'none';
                      const svg = img.nextElementSibling as HTMLElement;
                      if (svg) svg.classList.remove('hidden');
                    }}
                  />
                {/if}
                <svg class="w-10 h-10 {buttonOgImage ? 'hidden' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                View All Passages on BibleGateway
              </a>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
{:else if error}
  <div class="book-passage-error" style="padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; background-color: var(--bg-secondary); color: var(--text-error);">
    {error}
  </div>
{:else if passages.length > 0}
  {@const passagesByVersion = (() => {
    const grouped = new Map<string | undefined, Array<{ event: NostrEvent; reference: ParsedBookReference; sectionValue?: string; version?: string }>>();
    for (const passage of passages) {
      const versionKey = passage.version || undefined; // undefined means default DRB
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
        {version ? version : 'DRB'}
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
            onkeydown={(e) => e.key === 'Enter' && openEvent(event, undefined)}
            title="Click to open this passage in a new panel"
          >
            {reference.title}
            {#if reference.chapter}
              {reference.chapter}
              {#if sectionValue}
                :{sectionValue}
              {:else if reference.section && reference.section.length > 0}
                :{formatSections(reference.section)}
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

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>

