<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import debounce from 'debounce';
  import type { NostrEvent, Event } from '@nostr/tools/pure';
  import type { AbstractRelay } from '@nostr/tools/abstract-relay';
  import type { SubCloser } from '@nostr/tools/abstract-pool';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  import { wot, userWikiRelays } from '$lib/nostr';
  import type { Card, BookCard, ArticleCard } from '$lib/types';
  import { addUniqueTaggedReplaceable, getTagOr, next, unique, formatRelativeTime, formatSections } from '$lib/utils';
  import { relayService } from '$lib/relayService';
import {
    isBookEvent,
    extractBookMetadata,
    generateBookTitle,
    type BookReference,
    type BookEvent,
    BOOK_TYPES
  } from '$lib/books';
import { highlightedBookCardId } from '$lib/bookSearchLauncher';
import { openOrCreateArticleCard } from '$lib/articleLauncher';
  
  // Helper to check if event is a bible event
  function isBibleEvent(event: BookEvent): boolean {
    const cTag = event.tags.find(([tag]) => tag === 'C');
    const typeTag = event.tags.find(([tag]) => tag === 'type');
    return !!(cTag && cTag[1]?.toLowerCase() === 'bible') || 
           !!(typeTag && typeTag[1]?.toLowerCase() === 'bible');
  }
  
  // Helper to capitalize words for display
  function capitalizeWords(text: string): string {
    return text.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }
  
  
  // Generate Bible Gateway URL for the entire query (all references)
  // Optionally specify a version to use instead of the default
  function generateCompositeBibleGatewayUrl(specificVersion?: string): string | null {
    return generateBibleGatewayUrl(parsedQuery, specificVersion);
  }
  
  // Generate Bible Gateway URL for a single event (legacy, kept for compatibility)
  function generateBibleGatewayUrlForEvent(event: BookEvent): string | null {
    return generateCompositeBibleGatewayUrl();
  }
  
  // Helper to extract sections directly from event tags (NKBIP-08 format only - single-letter 's' tag)
  function extractEventSections(event: BookEvent): string[] {
    // Only use NKBIP-08 format: single-letter 's' tag
    const sectionTags = event.tags.filter(([tag]) => tag === 's').map(([, value]) => value);
    return sectionTags;
  }
  import { parseBookWikilink as parseBookWikilinkNKBIP08, type ParsedBookReference } from '$lib/bookWikilinkParser';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { cards } from '$lib/state';
  import { generateBibleGatewayUrl, generateBibleGatewayUrlForReference, fetchBibleGatewayOg } from '$lib/bibleGatewayUtils';
  import { generateSefariaUrl, generateSefariaUrlForReference, fetchSefariaOg } from '$lib/sefariaUtils';
  import { generateExploreQuranUrl, generateExploreQuranUrlForReference, fetchExploreQuranOg } from '$lib/exploreQuranUtils';
  import BookFallbackCards from '$components/BookFallbackCards.svelte';

  interface Props {
    card: Card;
    replaceSelf: (card: Card) => void;
    createChild: (card: Card) => void;
  }

  let { card, replaceSelf, createChild }: Props = $props();

  let tried = $state(false);
  let eosed = $state(0);
  let editable = $state(false);
  let versionNotFound = $state(false);
  let fallbackResults: BookEvent[] = [];
  let ogPreview = $state<{ title?: string; description?: string; image?: string } | null>(null);
  let ogLoading = $state(false);
  let ogError = $state<string | null>(null);
  let ogLoadedQuery = $state('');
  // Version-specific OG previews for empty versions
  let versionOgPreviews = $state<Map<string, { title?: string; description?: string; image?: string }>>(new Map());
  let versionOgLoading = $state<Map<string, boolean>>(new Map());
  let versionOgErrors = $state<Map<string, string | null>>(new Map());
  // Reference-specific OG previews (for individual book references)
  let referenceOgPreviews = $state<Map<string, { title?: string; description?: string; image?: string }>>(new Map());
  let referenceOgLoading = $state<Map<string, boolean>>(new Map());
  let referenceOgErrors = $state<Map<string, string | null>>(new Map());
  const bibleGatewayUrlForQuery = $derived.by(() => (bookCard.bookType === 'bible' && parsedQuery ? generateBibleGatewayUrl(parsedQuery) : null));
  const sefariaUrlForQuery = $derived.by(() => (bookCard.bookType === 'torah' && parsedQuery ? generateSefariaUrl(parsedQuery) : null));
  const exploreQuranUrlForQuery = $derived.by(() => (bookCard.bookType === 'quran' && parsedQuery ? generateExploreQuranUrl(parsedQuery) : null));

  const bookCard = card as BookCard;

  let query = $state<string>('');
  let seenCache: { [id: string]: string[] } = {};
  let results = $state<BookEvent[]>([]);
  type DisplayReference = BookReference & { sections?: string[] };
  let parsedQuery = $state<{ references: DisplayReference[], version?: string, versions?: string[] } | null>(null);
  let indexOrders = $state<Map<string, string[]>>(new Map());

  async function loadBibleGatewayPreview() {
    const targetUrl = generateBibleGatewayUrl(parsedQuery);
    console.log('Book: loadBibleGatewayPreview', { query, targetUrl, bookType: bookCard.bookType, tried, resultsLength: results.length, versionNotFound });
    
    if (!targetUrl) {
      console.log('Book: No BibleGateway URL generated for query:', query);
      ogPreview = null;
      ogError = null;
      ogLoadedQuery = query;
      return;
    }

    if (ogLoadedQuery === query || ogLoading) {
      console.log('Book: Skipping OG load - already loaded or loading', { ogLoadedQuery, query, ogLoading });
      return;
    }

    console.log('Book: Loading OG preview from:', targetUrl);
    ogLoading = true;
    ogError = null;

    try {
      ogPreview = await fetchBibleGatewayOg(targetUrl);
      console.log('Book: OG preview loaded:', ogPreview);
      ogLoadedQuery = query;
    } catch (error) {
      console.error('Book: Failed to load OG preview:', error);
      ogError = (error as Error).message;
    } finally {
      ogLoading = false;
    }
  }

  async function loadSefariaPreview() {
    const targetUrl = generateSefariaUrl(parsedQuery);
    console.log('Book: loadSefariaPreview', { query, targetUrl, bookType: bookCard.bookType, tried, resultsLength: results.length, versionNotFound });
    
    if (!targetUrl) {
      console.log('Book: No Sefaria URL generated for query:', query);
      ogPreview = null;
      ogError = null;
      ogLoadedQuery = query;
      return;
    }

    if (ogLoadedQuery === query || ogLoading) {
      console.log('Book: Skipping OG load - already loaded or loading', { ogLoadedQuery, query, ogLoading });
      return;
    }

    console.log('Book: Loading OG preview from:', targetUrl);
    ogLoading = true;
    ogError = null;

    try {
      ogPreview = await fetchSefariaOg(targetUrl);
      console.log('Book: OG preview loaded:', ogPreview);
      ogLoadedQuery = query;
    } catch (error) {
      console.error('Book: Failed to load OG preview:', error);
      ogError = (error as Error).message;
    } finally {
      ogLoading = false;
    }
  }

  async function loadExploreQuranPreview() {
    const targetUrl = generateExploreQuranUrl(parsedQuery);
    console.log('Book: loadExploreQuranPreview', { query, targetUrl, bookType: bookCard.bookType, tried, resultsLength: results.length, versionNotFound });
    
    if (!targetUrl) {
      console.log('Book: No ExploreQuran URL generated for query:', query);
      ogPreview = null;
      ogError = null;
      ogLoadedQuery = query;
      return;
    }

    if (ogLoadedQuery === query || ogLoading) {
      console.log('Book: Skipping OG load - already loaded or loading', { ogLoadedQuery, query, ogLoading });
      return;
    }

    console.log('Book: Loading OG preview from:', targetUrl);
    ogLoading = true;
    ogError = null;

    try {
      ogPreview = await fetchExploreQuranOg(targetUrl);
      console.log('Book: OG preview loaded:', ogPreview);
      ogLoadedQuery = query;
    } catch (error) {
      console.error('Book: Failed to load OG preview:', error);
      ogError = (error as Error).message;
    } finally {
      ogLoading = false;
    }
  }

  // Load OG preview for a specific version (for empty version cards)
  async function loadVersionOgPreview(versionKey: string) {
    if (!parsedQuery) return;
    
    const targetUrl = bookCard.bookType === 'bible' 
      ? generateBibleGatewayUrl(parsedQuery, versionKey)
      : bookCard.bookType === 'torah'
      ? generateSefariaUrl(parsedQuery)
      : bookCard.bookType === 'quran'
      ? generateExploreQuranUrl(parsedQuery)
      : null;
    console.log('Book: loadVersionOgPreview', { versionKey, targetUrl, bookType: bookCard.bookType });
    
    if (!targetUrl) {
      const serviceName = bookCard.bookType === 'bible' ? 'BibleGateway' : bookCard.bookType === 'torah' ? 'Sefaria' : bookCard.bookType === 'quran' ? 'ExploreQuran' : 'external service';
      console.log(`Book: No ${serviceName} URL generated for version:`, versionKey);
      versionOgErrors.set(versionKey, `Could not generate ${serviceName} URL`);
      return;
    }

    if (versionOgLoading.get(versionKey) || versionOgPreviews.has(versionKey)) {
      console.log('Book: Skipping version OG load - already loaded or loading', { versionKey });
      return;
    }

    console.log('Book: Loading OG preview for version:', versionKey, targetUrl);
    versionOgLoading.set(versionKey, true);
    versionOgErrors.set(versionKey, null);

    try {
      const preview = bookCard.bookType === 'bible'
        ? await fetchBibleGatewayOg(targetUrl)
        : bookCard.bookType === 'torah'
        ? await fetchSefariaOg(targetUrl)
        : bookCard.bookType === 'quran'
        ? await fetchExploreQuranOg(targetUrl)
        : { title: undefined, description: undefined, image: undefined };
      console.log('Book: OG preview loaded for version:', versionKey, preview);
      versionOgPreviews.set(versionKey, preview);
    } catch (error) {
      console.error('Book: Failed to load OG preview for version:', versionKey, error);
      versionOgErrors.set(versionKey, (error as Error).message);
    } finally {
      versionOgLoading.set(versionKey, false);
    }
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

  // Load OG preview for a specific reference (for individual BG cards)
  async function loadReferenceOgPreview(ref: BookReference, version?: string) {
    // Use version-specific key if version is provided (for version cards)
    const refKey = version ? getReferenceKeyWithVersion(ref, version) : getReferenceKey(ref);
    const targetUrl = bookCard.bookType === 'bible'
      ? generateBibleGatewayUrlForReference(ref, version || parsedQuery?.versions?.[0] || parsedQuery?.version)
      : bookCard.bookType === 'torah'
      ? generateSefariaUrlForReference(ref)
      : bookCard.bookType === 'quran'
      ? generateExploreQuranUrlForReference(ref)
      : null;
    
    if (!targetUrl) {
      const serviceName = bookCard.bookType === 'bible' ? 'BibleGateway' : bookCard.bookType === 'torah' ? 'Sefaria' : bookCard.bookType === 'quran' ? 'ExploreQuran' : 'external service';
      referenceOgErrors.set(refKey, `Could not generate ${serviceName} URL`);
      return;
    }

    // Skip if already loading, already has preview, or already has an error (prevent infinite retries)
    if (referenceOgLoading.get(refKey)) {
      console.log('Book: Skipping OG load - already loading', { refKey });
      return;
    }
    if (referenceOgPreviews.has(refKey)) {
      console.log('Book: Skipping OG load - already has preview', { refKey });
      return;
    }
    if (referenceOgErrors.has(refKey)) {
      console.log('Book: Skipping OG load - already has error (preventing retry)', { refKey });
      return;
    }

    console.log('Book: Starting OG load', { refKey, targetUrl, bookType: bookCard.bookType });
    // Create a new Map to trigger reactivity
    const newLoading = new Map(referenceOgLoading);
    newLoading.set(refKey, true);
    referenceOgLoading = newLoading;
    
    // Clear any previous error
    if (referenceOgErrors.has(refKey)) {
      const newErrors = new Map(referenceOgErrors);
      newErrors.delete(refKey);
      referenceOgErrors = newErrors;
    }

    try {
      const preview = bookCard.bookType === 'bible'
        ? await fetchBibleGatewayOg(targetUrl)
        : bookCard.bookType === 'torah'
        ? await fetchSefariaOg(targetUrl)
        : bookCard.bookType === 'quran'
        ? await fetchExploreQuranOg(targetUrl)
        : { title: undefined, description: undefined, image: undefined };
      console.log('Book: OG load successful', { refKey, preview });
      // Create a new Map to trigger reactivity
      const newPreviews = new Map(referenceOgPreviews);
      newPreviews.set(refKey, preview);
      referenceOgPreviews = newPreviews;
    } catch (error) {
      console.error('Book: OG load failed', { refKey, error });
      // Create a new Map to trigger reactivity
      const newErrors = new Map(referenceOgErrors);
      newErrors.set(refKey, (error as Error).message);
      referenceOgErrors = newErrors;
    } finally {
      // Create a new Map to trigger reactivity
      const newLoading = new Map(referenceOgLoading);
      newLoading.set(refKey, false);
      referenceOgLoading = newLoading;
      console.log('Book: OG load finished', { refKey });
    }
  }

  $effect(() => {
    if (query && ogLoadedQuery !== query) {
      ogPreview = null;
      ogError = null;
    }
  });

  $effect(() => {
    // Log effect execution even if condition isn't met
    console.log('Book: OG preview effect running', { 
      query: !!query, 
      queryValue: query,
      ogLoadedQuery, 
      ogLoading, 
      bookType: bookCard.bookType, 
      tried, 
      resultsLength: results.length, 
      versionNotFound 
    });
    
    // Only load OG preview if bookType is set and matches the service
    // This prevents loading Bible Gateway for torah/quran queries
    const shouldLoadBible = query && ogLoadedQuery !== query && !ogLoading && bookCard.bookType === 'bible' && tried && (results.length === 0 || versionNotFound);
    const shouldLoadSefaria = query && ogLoadedQuery !== query && !ogLoading && bookCard.bookType === 'torah' && tried && (results.length === 0 || versionNotFound);
    const shouldLoadExploreQuran = query && ogLoadedQuery !== query && !ogLoading && bookCard.bookType === 'quran' && tried && (results.length === 0 || versionNotFound);
    
    // Debug logging
    if (query && tried && (results.length === 0 || versionNotFound)) {
      console.log('Book: OG preview effect', { 
        query, 
        bookType: bookCard.bookType, 
        shouldLoadBible, 
        shouldLoadSefaria, 
        shouldLoadExploreQuran,
        ogLoadedQuery,
        ogLoading,
        resultsLength: results.length,
        versionNotFound
      });
    }
    console.log('Book: OG preview effect - shouldLoadBible:', shouldLoadBible, 'shouldLoadSefaria:', shouldLoadSefaria, 'shouldLoadExploreQuran:', shouldLoadExploreQuran);
    
    if (shouldLoadBible) {
      loadBibleGatewayPreview();
    } else if (shouldLoadSefaria) {
      loadSefariaPreview();
    } else if (shouldLoadExploreQuran) {
      loadExploreQuranPreview();
    }
  });

  // Load OG previews for empty versions when multiple versions are requested
  $effect(() => {
    if (!tried || !parsedQuery || !groupedResults.hasVersionRequested || !groupedResults.versionGroups) return;
    
    for (const [versionKey, versionBookMap] of groupedResults.versionGroups.entries()) {
      const hasResults = versionBookMap.size > 0;
      
      // Load OG preview for empty versions - always load reference-specific previews
      if (!hasResults && parsedQuery.references) {
        for (const ref of parsedQuery.references) {
          const refKey = getReferenceKeyWithVersion(ref, versionKey);
          // Don't retry if we already have an error (prevent infinite retries)
          if (!referenceOgPreviews.has(refKey) && !referenceOgLoading.get(refKey) && !referenceOgErrors.has(refKey)) {
            console.log('Book: Loading reference OG preview for empty version:', { versionKey, ref });
            loadReferenceOgPreview(ref, versionKey).catch(err => console.error('Failed to load reference OG:', err));
          }
        }
      }
    }
  });

  // Load OG previews for each reference when there are no results
  $effect(() => {
    if (!tried || !parsedQuery || results.length > 0 || !bookCard.bookType || bookCard.bookType !== 'bible') return;
    if (!parsedQuery.references || parsedQuery.references.length === 0) return;
    
    // Load OG preview for each reference (including single references)
    for (const ref of parsedQuery.references) {
      const refKey = getReferenceKey(ref);
      // Don't retry if we already have an error (prevent infinite retries)
      if (!referenceOgPreviews.has(refKey) && !referenceOgLoading.get(refKey) && !referenceOgErrors.has(refKey)) {
        loadReferenceOgPreview(ref).catch(err => console.error('Failed to load reference OG:', err));
      }
    }
  });
  
  // Helper to create a unique key for a book event (book + chapter + section)
  function getEventKey(event: BookEvent): string {
    const metadata = extractBookMetadata(event);
    const book = metadata.book ? normalizeIdentifier(metadata.book).toLowerCase() : 'unknown';
    const chapter = metadata.chapter || '';
    const sections = extractEventSections(event);
    const section = sections.length > 0 ? sections.sort((a, b) => parseInt(a) - parseInt(b)).join(',') : '';
    return `${book}:${chapter}:${section}`;
  }
  
  // Use formatSections from utils instead of formatVerseRange
  
  // Keywords that should appear before numeric sections
  const prefaceKeywords = ['preamble', 'preface', 'foreword', 'introduction'];

  function isPrefaceSection(section: string): boolean {
    const normalized = section.toLowerCase();
    return prefaceKeywords.some(keyword => normalized.includes(keyword));
  }

  // Helper to get all unique sections from a group of references
  function getAllSectionsFromGroup(referenceGroups: { best: BookEvent; all: BookEvent[] }[]): string[] {
    const allSections = new Set<string>();
    for (const refGroup of referenceGroups) {
      const sections = extractEventSections(refGroup.best);
      sections.forEach(s => allSections.add(s));
    }
    return Array.from(allSections);
  }

  function getOrderedSections(
    allSections: string[],
    sectionMap: Map<string, { best: BookEvent; all: BookEvent[] }>,
    chapterOrder?: string[]
  ): string[] {
    const orderMap = new Map<string, number>();
    if (chapterOrder && chapterOrder.length > 0) {
      chapterOrder.forEach((eventId, index) => {
        if (eventId) {
          orderMap.set(eventId, index);
        }
      });
    }

    return [...allSections].sort((a, b) => {
      const refA = sectionMap.get(a);
      const refB = sectionMap.get(b);
      const idA = refA?.best.id;
      const idB = refB?.best.id;
      const idxA = idA && orderMap.has(idA) ? orderMap.get(idA)! : Number.MAX_SAFE_INTEGER;
      const idxB = idB && orderMap.has(idB) ? orderMap.get(idB)! : Number.MAX_SAFE_INTEGER;

      if (idxA !== idxB) {
        return idxA - idxB;
      }

      const specialA = isPrefaceSection(a);
      const specialB = isPrefaceSection(b);
      if (specialA && !specialB) return -1;
      if (!specialA && specialB) return 1;

      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }

      return a.localeCompare(b);
    });
  }

  function getScopeKey(bookKey: string, chapter?: string): string {
    return `${bookKey}:${chapter && chapter.length > 0 ? chapter : 'book'}`;
  }

  function extractIndexOrder(event: BookEvent): string[] {
    return event.tags.filter(([tag]) => tag === 'e').map(([, value]) => value).filter(Boolean);
  }
  
  // Helper to get version preference score (higher = better)
  function getVersionPreferenceScore(version: string | undefined): number {
    if (!version) return 0;
    const v = version.toLowerCase();
    // Preference order: DRB > KJV > ESV > NASB > others
    if (v === 'drb' || v === 'douay-rheims' || v === 'douay rheims') return 40;
    if (v === 'kjv' || v === 'king james' || v === 'king james version') return 30;
    if (v === 'esv' || v === 'english standard version') return 20;
    if (v === 'nasb' || v === 'new american standard bible') return 10;
    return 0;
  }
  
  // Helper to calculate match score (considering all tags)
  function calculateMatchScore(event: BookEvent, query: typeof parsedQuery): number {
    if (!query) return 0;
    
    let score = 0;
    const metadata = extractBookMetadata(event);
    const eventSections = extractEventSections(event);
    
    // Check each reference in the query
    for (const ref of query.references) {
      const refBook = ref.book ? normalizeIdentifier(ref.book).toLowerCase() : '';
      const eventBook = metadata.book ? normalizeIdentifier(metadata.book).toLowerCase() : '';
      
      if (refBook === eventBook) {
        score += 10; // Book match
        
        if (ref.chapter && metadata.chapter && ref.chapter.toString() === metadata.chapter) {
          score += 5; // Chapter match
          
          // Check section matches
          if (ref.verse) {
            const refSections = ref.verse.split(',').map(s => s.trim());
            const matchingSections = refSections.filter(rs => eventSections.includes(rs));
            score += matchingSections.length * 2; // Section matches
          }
        }
      }
    }
    
    // Version match bonus
    if (query.versions && query.versions.length > 0) {
      const eventVersion = metadata.version?.toLowerCase();
      if (eventVersion && query.versions.some(v => v.toLowerCase() === eventVersion)) {
        score += 3;
      }
    } else {
      // No version specified - apply preference for Bible events
      if (isBibleEvent(event)) {
        score += getVersionPreferenceScore(metadata.version);
      }
    }
    
    return score;
  }
  
  async function refreshIndexOrders() {
    if (!parsedQuery) return;

    const scopes = new Set<string>();
    for (const ref of parsedQuery.references) {
      if (!ref.book) continue;
      const normalizedBook = normalizeIdentifier(ref.book).toLowerCase();
      const chapterKey = ref.chapter ? ref.chapter.toString() : undefined;
      scopes.add(getScopeKey(normalizedBook, chapterKey));
      scopes.add(getScopeKey(normalizedBook, undefined));
    }

    for (const event of results) {
      const metadata = extractBookMetadata(event);
      if (!metadata.book) continue;
      const normalizedBook = normalizeIdentifier(metadata.book).toLowerCase();
      const chapterKey = metadata.chapter || undefined;
      scopes.add(getScopeKey(normalizedBook, chapterKey));
    }

    const newIndexOrders = new Map<string, string[]>();

    for (const scopeKey of scopes) {
      const [bookKey, chapterKey] = scopeKey.split(':');
      if (!bookKey) continue;

      const filters: any = {
        kinds: [30040],
        limit: 1,
        '#T': [bookKey]
      };

      if (bookCard.bookType) {
        filters['#C'] = [normalizeIdentifier(bookCard.bookType).toLowerCase()];
      }

      if (chapterKey && chapterKey !== 'book') {
        filters['#c'] = [chapterKey];
      }

      try {
        // Check cache first
        const { contentCache } = await import('$lib/contentCache');
        const allCached = [
          ...(await contentCache.getEvents('publications')),
          ...(await contentCache.getEvents('longform')),
          ...(await contentCache.getEvents('wikis'))
        ];
        let indexEvent = allCached.find(c => {
          const event = c.event;
          if (filters.kinds && !filters.kinds.includes(event.kind)) return false;
          if (filters.authors && !filters.authors.includes(event.pubkey)) return false;
          if (filters['#c'] && !event.tags.some(t => t[0] === 'c' && t[1] === filters['#c'][0])) return false;
          return true;
        })?.event;
        
        let indexResult: any;
        if (indexEvent) {
          indexResult = { events: [indexEvent], relays: allCached.find(c => c.event.id === indexEvent!.id)!.relays };
        } else {
          indexResult = await relayService.queryEvents(
            'anonymous',
            'wiki-read',
            [filters],
            {
              excludeUserContent: false,
              currentUserPubkey: undefined
            }
          );
          
          // Store in cache
          if (indexResult.events.length > 0) {
            for (const event of indexResult.events) {
              const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                               event.kind === 30023 ? 'longform' :
                               (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
              if (cacheType) {
                await contentCache.storeEvents(cacheType, [{ event, relays: indexResult.relays }]);
              }
            }
          }
        }

        const foundIndexEvent = indexResult.events.find((evt: NostrEvent) => evt.id);
        if (foundIndexEvent) {
          const order = extractIndexOrder(foundIndexEvent as BookEvent);
          if (order.length > 0) {
            newIndexOrders.set(scopeKey, order);
          }
        }
      } catch (error) {
        console.warn('Book: Failed to load index order for scope', scopeKey, error);
      }
    }

    indexOrders = newIndexOrders;
  }

  // Group bible results by book, preserving order, and deduplicate by reference
  const groupedResults = $derived.by(() => {
    const bibleResults: BookEvent[] = [];
    const nonBibleResults: BookEvent[] = [];
    
    for (const result of results) {
      if (isBibleEvent(result)) {
        bibleResults.push(result);
      } else {
        nonBibleResults.push(result);
      }
    }
    
    // Group by reference key (book:chapter:section)
    const referenceGroups = new Map<string, BookEvent[]>();
    for (const result of bibleResults) {
      const refKey = getEventKey(result);
      if (!referenceGroups.has(refKey)) {
        referenceGroups.set(refKey, []);
      }
      referenceGroups.get(refKey)!.push(result);
    }
    
    // For each reference, find the best match (highest score, then newest)
    const deduplicatedResults = new Map<string, { best: BookEvent; all: BookEvent[] }>();
    for (const [refKey, events] of referenceGroups.entries()) {
      if (events.length === 0) continue;
      
      // Calculate match scores
      const scoredEvents = events.map(event => ({
        event,
        score: calculateMatchScore(event, parsedQuery),
        created_at: event.created_at || 0
      }));
      
      // Sort by score (descending), then by created_at (descending = newest first)
      scoredEvents.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.created_at - a.created_at;
      });
      
      deduplicatedResults.set(refKey, {
        best: scoredEvents[0].event,
        all: events
      });
    }
    
    // Group deduplicated results by book+chapter (for Bible Gateway style grouping)
    // Structure: Map<bookKey, Map<chapterKey, { best: BookEvent; all: BookEvent[] }[]>>
    const bibleGroups = new Map<string, Map<string, { best: BookEvent; all: BookEvent[] }[]>>();
    const bookOrder: string[] = []; // Track order of first appearance
    
    for (const [refKey, { best, all }] of deduplicatedResults.entries()) {
      const metadata = extractBookMetadata(best);
      const bookKey = metadata.book ? normalizeIdentifier(metadata.book).toLowerCase() : 'unknown';
      const chapterKey = metadata.chapter || '';
      
      if (!bibleGroups.has(bookKey)) {
        bibleGroups.set(bookKey, new Map());
        bookOrder.push(bookKey);
      }
      
      const chapterMap = bibleGroups.get(bookKey)!;
      if (!chapterMap.has(chapterKey)) {
        chapterMap.set(chapterKey, []);
      }
      chapterMap.get(chapterKey)!.push({ best, all });
    }
    
    // Create ordered entries array
    const orderedBibleGroups = new Map<string, Map<string, { best: BookEvent; all: BookEvent[] }[]>>();
    for (const bookKey of bookOrder) {
      orderedBibleGroups.set(bookKey, bibleGroups.get(bookKey)!);
    }
    
    // If any version is requested, group by version (even if just one)
    const hasVersionRequested = parsedQuery?.versions && parsedQuery.versions.length > 0;
    
    if (hasVersionRequested) {
      // Group by version: Map<versionKey, Map<bookKey, Map<chapterKey, { best: BookEvent; all: BookEvent[] }[]>>>
      const versionGroups = new Map<string, Map<string, Map<string, { best: BookEvent; all: BookEvent[] }[]>>>();
      const versionOrder: string[] = [];
      
      // Initialize all requested versions (even if empty)
      for (const requestedVersion of parsedQuery!.versions!) {
        const versionKey = requestedVersion.toLowerCase();
        if (!versionGroups.has(versionKey)) {
          versionGroups.set(versionKey, new Map());
          versionOrder.push(versionKey);
        }
      }
      
      // Filter results to only include requested versions
      for (const [bookKey, chapterMap] of orderedBibleGroups.entries()) {
        for (const [chapterKey, referenceGroups] of chapterMap.entries()) {
          for (const refGroup of referenceGroups) {
            const metadata = extractBookMetadata(refGroup.best);
            const eventVersion = metadata.version?.toLowerCase();
            
            // Find matching requested version
            const matchingVersion = parsedQuery!.versions!.find(v => v.toLowerCase() === eventVersion);
            if (matchingVersion) {
              const versionKey = matchingVersion.toLowerCase();
              
              const versionBookMap = versionGroups.get(versionKey)!;
              if (!versionBookMap.has(bookKey)) {
                versionBookMap.set(bookKey, new Map());
              }
              
              const versionChapterMap = versionBookMap.get(bookKey)!;
              if (!versionChapterMap.has(chapterKey)) {
                versionChapterMap.set(chapterKey, []);
              }
              
              versionChapterMap.get(chapterKey)!.push(refGroup);
            }
          }
        }
      }
      
      // Create ordered version groups (preserve order of requested versions)
      const orderedVersionGroups = new Map<string, Map<string, Map<string, { best: BookEvent; all: BookEvent[] }[]>>>();
      for (const versionKey of versionOrder) {
        orderedVersionGroups.set(versionKey, versionGroups.get(versionKey)!);
      }
      
      return { 
        bibleGroups: orderedBibleGroups, 
        versionGroups: orderedVersionGroups,
        hasVersionRequested: true,
        nonBibleResults 
      };
    }
    
    return { 
      bibleGroups: orderedBibleGroups, 
      versionGroups: null,
      hasMultipleVersions: false,
      nonBibleResults 
    };
  });
  
  // close handlers
  let uwrcancel: () => void;
  let subs: SubCloser[] = [];

  onMount(() => {
    query = bookCard.data;
    // Parse the query using the shared function
    const parsed = parseQueryString(query);
    if (parsed) {
      console.log('Book: Parsed query successfully:', { query, parsedQuery });
    } else {
      console.warn('Book: Parser returned no references for query:', query);
    }
  });

  onMount(() => {
    // we won't do any searches if we already have the results
    if (bookCard.results) {
      seenCache = bookCard.seenCache || {};
      results = bookCard.results || [];

      tried = true;
      return;
    }

    performBookSearch();
  });

  onDestroy(destroy);

  function destroy() {
    if (uwrcancel) uwrcancel();
    subs.forEach((sub) => sub.close());
    // search operations are now handled by relayService
  }

  // Sort results by order in query, then by chapter, section, version
  function sortBookResults(results: BookEvent[]): BookEvent[] {
    if (!parsedQuery || parsedQuery.references.length === 0) {
      // Fallback to alphabetical if no parsed query
      return results.sort((a, b) => {
        const metadataA = extractBookMetadata(a);
        const metadataB = extractBookMetadata(b);
        const bookA = (metadataA.book || '').toLowerCase();
        const bookB = (metadataB.book || '').toLowerCase();
        return bookA.localeCompare(bookB);
      });
    }
    
    // Create a map of book order from the query
    const bookOrder = new Map<string, number>();
    parsedQuery.references.forEach((ref, index) => {
      if (ref.book) {
        const normalizedBook = normalizeIdentifier(ref.book).toLowerCase();
        if (!bookOrder.has(normalizedBook)) {
          bookOrder.set(normalizedBook, index);
        }
      }
    });
    
    return results.sort((a, b) => {
      const metadataA = extractBookMetadata(a);
      const metadataB = extractBookMetadata(b);
      
      // 1. Sort by book order in query (preserve wikilink order)
      const bookA = metadataA.book ? normalizeIdentifier(metadataA.book).toLowerCase() : '';
      const bookB = metadataB.book ? normalizeIdentifier(metadataB.book).toLowerCase() : '';
      const orderA = bookOrder.get(bookA) ?? 999;
      const orderB = bookOrder.get(bookB) ?? 999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      
      // 2. Sort by chapter (numerically)
      const chapterA = metadataA.chapter ? parseInt(metadataA.chapter, 10) : 0;
      const chapterB = metadataB.chapter ? parseInt(metadataB.chapter, 10) : 0;
      if (chapterA !== chapterB) {
        return chapterA - chapterB;
      }
      
      // 3. Sort by section/verse (numerically, use first section if multiple)
      const sectionsA = extractEventSections(a);
      const sectionsB = extractEventSections(b);
      const sectionA = sectionsA.length > 0 ? parseInt(sectionsA[0], 10) : 0;
      const sectionB = sectionsB.length > 0 ? parseInt(sectionsB[0], 10) : 0;
      if (sectionA !== sectionB) {
        return sectionA - sectionB;
      }
      
      // 4. Sort by version (alphabetically)
      const versionA = (metadataA.version || '').toLowerCase();
      const versionB = (metadataB.version || '').toLowerCase();
      if (versionA !== versionB) {
        return versionA.localeCompare(versionB);
      }
      
      // 5. Finally, sort by WOT score (higher is better)
      return ($wot[b.pubkey] || 0) - ($wot[a.pubkey] || 0);
    });
  }

  async function performBookSearch() {
    if (!parsedQuery) {
      console.warn('Book: Cannot perform search, parsedQuery is null. Query was:', query);
      return;
    }

    // cancel existing subscriptions and zero variables
    destroy();
    tried = false;
    eosed = 0;
    results = [];

    const update = debounce(() => {
      // Sort by book, chapter, section, version, then WOT score
      results = sortBookResults(results);
      seenCache = seenCache;
      refreshIndexOrders();
    }, 500);

    // Check cache first before making relay queries
    try {
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = [
        ...(await contentCache.getEvents('publications')),
        ...(await contentCache.getEvents('longform')),
        ...(await contentCache.getEvents('wikis'))
      ];
      
      // Filter cached events for book events (kind 30040 and 30041)
      const bookCachedEvents = cachedEvents.filter(cached => 
        cached.event.kind === 30040 || cached.event.kind === 30041
      );
      
      if (bookCachedEvents.length > 0) {
        console.log(`Book: Found ${bookCachedEvents.length} cached book events, filtering hierarchically (collection -> title -> chapter -> section -> version)...`);
        
        // Hierarchical filtering: collection -> title -> chapter -> section -> version
        let filtered = bookCachedEvents;
        let matchedCount = 0;
        let rejectedCount = 0;
        
        // Step 1: Filter by collection (C tag for NKBIP-08, type tag for legacy) if specified
        if (bookCard.bookType) {
          const before = filtered.length;
          const normalizedQueryCollection = normalizeIdentifier(bookCard.bookType!).toLowerCase();
          filtered = filtered.filter(cached => {
            const evt = cached.event as BookEvent;
            // Check NKBIP-08 format (C tag)
            const collectionTag = evt.tags.find(([tag]) => tag === 'C');
            if (collectionTag) {
              const normalizedCollection = normalizeIdentifier(collectionTag[1]).toLowerCase();
              return normalizedCollection === normalizedQueryCollection;
            }
            // Check legacy format (type tag)
            const typeTag = evt.tags.find(([tag]) => tag === 'type');
            if (typeTag) {
              const normalizedType = normalizeIdentifier(typeTag[1]).toLowerCase();
              return normalizedType === normalizedQueryCollection;
            }
            // No collection/type tag - reject (prevents cross-collection results)
            return false;
          });
          console.log(`Book: After collection filter (${bookCard.bookType}): ${filtered.length} of ${before} events`);
        }
        
        // Step 2: Filter by title (T tag) for each reference
        // We need to check if any reference matches
        const beforeTitle = filtered.length;
        const titleMatches: typeof filtered = [];
        for (const ref of parsedQuery!.references) {
          if (!ref.book) continue;
          // The parser already normalized the title, so we just need to normalize the event tag the same way
          // Use normalizeIdentifier (from NIP-54) which should match the parser's normalizeNip54
          const normalizedQueryTitle = normalizeIdentifier(ref.book).toLowerCase();
          console.log(`Book: Looking for title "${ref.book}" (normalized: "${normalizedQueryTitle}")`);
          
          // Sample a few events to see what titles we have (for debugging)
          const sampleSize = Math.min(5, filtered.length);
          if (sampleSize > 0) {
            console.log(`Book: Sampling ${sampleSize} events to check titles...`);
            for (const cached of filtered.slice(0, sampleSize)) {
              const evt = cached.event as BookEvent;
              const titleTag = evt.tags.find(([tag]) => tag === 'T');
              if (titleTag) {
                const normalizedEventTitle = normalizeIdentifier(titleTag[1]).toLowerCase();
                const matches = normalizedEventTitle === normalizedQueryTitle;
                console.log(`Book: Event title: "${titleTag[1]}" -> normalized: "${normalizedEventTitle}" ${matches ? '✓ MATCHES' : '✗ no match'}`);
              } else {
                console.log(`Book: Event has no T tag`);
              }
            }
          }
          
          for (const cached of filtered) {
            const evt = cached.event as BookEvent;
            const titleTag = evt.tags.find(([tag]) => tag === 'T');
            if (!titleTag) continue;
            const normalizedEventTitle = normalizeIdentifier(titleTag[1]).toLowerCase();
            
            if (normalizedEventTitle === normalizedQueryTitle) {
              // Check if we already added this event for a different reference
              if (!titleMatches.find(c => c.event.id === evt.id)) {
                titleMatches.push(cached);
              }
            }
          }
        }
        filtered = titleMatches;
        console.log(`Book: After title filter: ${filtered.length} of ${beforeTitle} events`);
        
        // Step 3: Filter by chapter (c tag) if specified
        const beforeChapter = filtered.length;
        if (parsedQuery!.references.some(ref => ref.chapter)) {
          const chapterMatches: typeof filtered = [];
          for (const ref of parsedQuery!.references) {
            if (!ref.chapter) {
              // If this reference doesn't specify a chapter, include all chapters
              for (const cached of filtered) {
                if (!chapterMatches.find(c => c.event.id === cached.event.id)) {
                  chapterMatches.push(cached);
                }
              }
              continue;
            }
            
            const queryChapter = ref.chapter.toString();
            for (const cached of filtered) {
              const evt = cached.event as BookEvent;
              const chapterTag = evt.tags.find(([tag]) => tag === 'c');
              if (!chapterTag) continue;
              
              if (chapterTag[1] === queryChapter) {
                if (!chapterMatches.find(c => c.event.id === evt.id)) {
                  chapterMatches.push(cached);
                }
              }
            }
          }
          filtered = chapterMatches;
          console.log(`Book: After chapter filter: ${filtered.length} of ${beforeChapter} events`);
        }
        
        // Step 4: Filter by section (s tag) if specified
        const beforeSection = filtered.length;
        if (parsedQuery!.references.some(ref => ref.verse)) {
          const sectionMatches: typeof filtered = [];
          for (const ref of parsedQuery!.references) {
            if (!ref.verse) {
              // If this reference doesn't specify a verse, include all verses
              for (const cached of filtered) {
                if (!sectionMatches.find(c => c.event.id === cached.event.id)) {
                  sectionMatches.push(cached);
                }
              }
              continue;
            }
            
            // Expand verse ranges
            const expandVerseToSections = (verse: string): string[] => {
              const sections: string[] = [];
              const parts = verse.split(',').map(p => p.trim());
              for (const part of parts) {
                if (part.includes('-')) {
                  const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
                  if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let i = start; i <= end; i++) {
                      sections.push(i.toString());
                    }
                  } else {
                    sections.push(part);
                  }
                } else {
                  sections.push(part);
                }
              }
              return sections;
            };
            
            const querySections = expandVerseToSections(ref.verse);
            for (const cached of filtered) {
              const evt = cached.event as BookEvent;
              const eventSections = extractEventSections(evt);
              
              const hasMatchingSection = querySections.some(qs => eventSections.includes(qs));
              if (hasMatchingSection) {
                if (!sectionMatches.find(c => c.event.id === evt.id)) {
                  sectionMatches.push(cached);
                }
              }
            }
          }
          filtered = sectionMatches;
          console.log(`Book: After section filter: ${filtered.length} of ${beforeSection} events`);
        }
        
        // Step 5: Filter by version (v tag) if specified
        const beforeVersion = filtered.length;
        if (parsedQuery!.versions && parsedQuery!.versions.length > 0) {
          const queryVersions = parsedQuery!.versions.map(v => v.toLowerCase());
          filtered = filtered.filter(cached => {
            const evt = cached.event as BookEvent;
            const versionTags = evt.tags.filter(([tag]) => tag === 'v').map(([, value]) => value.toLowerCase());
            if (versionTags.length === 0) return true; // If event has no version, include it
            return queryVersions.some(qv => versionTags.includes(qv));
          });
          console.log(`Book: After version filter: ${filtered.length} of ${beforeVersion} events`);
        }
        
        // Now add the filtered events to results
        for (const cached of filtered) {
          const evt = cached.event as BookEvent;
          matchedCount++;
          // Track which relays returned this event
          cached.relays.forEach(relay => {
            if (!seenCache[evt.id]) seenCache[evt.id] = [];
            if (seenCache[evt.id].indexOf(relay) === -1) {
              seenCache[evt.id].push(relay);
            }
          });
          
          if (addUniqueTaggedReplaceable(results, evt)) update();
        }
        
        rejectedCount = bookCachedEvents.length - matchedCount;
        console.log(`Book: Cache filtering complete - matched: ${matchedCount}, rejected: ${rejectedCount}, total cached: ${bookCachedEvents.length}`);
        
        if (results.length > 0) {
          console.log(`Book: Found ${results.length} matching events in cache`);
          tried = true;
          // Still query relays in background to get fresh results, but show cache immediately
        }
      }
    } catch (error) {
      console.error('Book: Failed to check cache:', error);
    }

    // Don't set a timeout if we already have cache results - they'll set tried = true
    // Only set timeout if we have no cache results yet
    if (results.length === 0) {
      setTimeout(() => {
        tried = true;
      }, 3000); // Increased timeout to allow relay queries to complete
    }

    const relaysFromPreferredAuthors = unique(
      (await Promise.all(([]).map((pk) => loadRelayList(pk))))
        .map((rl) => rl.items)
        .flat()
        .filter((ri) => ri.write)
        .map((ri) => ri.url)
    );

    let previouslyQueriedRelays: string[] = [];
    uwrcancel = userWikiRelays.subscribe(async (uwr) => {
      const relaysToUseNow = [];

      for (let i = 0; i < uwr.length; i++) {
        let r = uwr[i];
        if (previouslyQueriedRelays.indexOf(r) === -1) {
          relaysToUseNow.push(r);
          previouslyQueriedRelays.push(r);
        }
      }

      for (let i = 0; i < relaysFromPreferredAuthors.length; i++) {
        let r = relaysFromPreferredAuthors[i];
        if (previouslyQueriedRelays.indexOf(r) === -1) {
          relaysToUseNow.push(r);
          previouslyQueriedRelays.push(r);
        }
      }

      if (relaysToUseNow.length === 0) return;

      // Build relay filters using C, T, c, s, v tags (NKBIP-08 format)
      // Query both kind 30040 (index) and 30041 (content) events
      const filters: any[] = [];
      
      for (const ref of parsedQuery!.references) {
        const filter: any = {
          kinds: [30040, 30041],
          limit: 100 // Increase limit since we're filtering more client-side
        };
        
        // Only use T (title) and c (chapter) tags in relay filter
        // Filter collection, section, and version client-side to avoid relay limitations
        
        // T tag: title/book name (normalized using NIP-54)
        if (ref.book) {
          // Normalize book name using NIP-54 rules: lowercase, replace non-alphanumeric with hyphens
          // The parser already normalized it, but we normalize again to ensure consistency
          const normalizedBook = normalizeIdentifier(ref.book);
          filter['#T'] = [normalizedBook];
        }
        
        // c tag: chapter
        if (ref.chapter) {
          filter['#c'] = [ref.chapter.toString()];
        }
        
        // Don't include #C, #s, or #v in relay filter - filter client-side instead
        // This avoids "too many tags" errors and relay compatibility issues
        
        filters.push(filter);
      }
      
      // Use relayService for book search with tag filters
      // Note: Book events (kind 30040/30041) are wiki events, so use 'wiki-read' not 'social-read'
      // Some relays may not support all NKBIP-08 tags, so errors are expected
      try {
        const result = await relayService.queryEvents(
          'anonymous',
          'wiki-read',
          filters,
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );

        tried = true;
        console.log(`Book: Relay query returned ${result.events.length} events`);
        for (const evt of result.events) {
          // Check if this event matches our book criteria
          const isBook = isBookEvent(evt as BookEvent, bookCard.bookType);
          const matches = matchesBookQuery(evt as BookEvent, parsedQuery!);
          if (isBook && matches) {
            if (addUniqueTaggedReplaceable(results, evt)) update();
          } else {
            // Debug: log why events are being rejected
            const titleTag = evt.tags.find(([tag]) => tag === 'T');
            console.log(`Book: Relay event rejected - isBook: ${isBook}, matches: ${matches}, title: ${titleTag ? titleTag[1] : 'none'}`);
          }
        }
        
        console.log('Book: Finished processing relay events, results.length:', results.length);
        
        // Check immediately after processing events
        const hasNoResults = results.length === 0;
        console.log('Book: IMMEDIATE CHECK - hasNoResults:', hasNoResults, 'bookType:', bookCard.bookType, 'query:', query);
        
        // After search completes, check if we need to load OG preview
        // Only load the appropriate service based on bookType
        if (tried && hasNoResults && query) {
          if (bookCard.bookType === 'bible') {
            console.log('Book: IMMEDIATELY Triggering Bible Gateway OG preview load');
            loadBibleGatewayPreview().catch(err => {
              console.error('Book: Failed to load OG preview:', err);
            });
          } else if (bookCard.bookType === 'torah') {
            console.log('Book: IMMEDIATELY Triggering Sefaria OG preview load');
            loadSefariaPreview().catch(err => {
              console.error('Book: Failed to load OG preview:', err);
            });
          } else if (bookCard.bookType === 'quran') {
            console.log('Book: IMMEDIATELY Triggering ExploreQuran OG preview load');
            loadExploreQuranPreview().catch(err => {
              console.error('Book: Failed to load OG preview:', err);
            });
          }
        }
      } catch (error) {
        // Some relays may reject filters with certain tags - this is expected
        // We'll still get results from cache and other relays that support the tags
        console.warn('Book search: Some relays rejected the query (this is normal for relays that don\'t support NKBIP-08 tags):', error);
      }
    });

    function oneose() {
      eosed++;
      if (eosed >= 2) {
        tried = true;
        
        // If we were searching for a specific version and found no results, try fallback
        const requestedVersionCount = (parsedQuery?.version ? 1 : 0) + (parsedQuery?.versions?.length ?? 0);
        if (requestedVersionCount > 0 && results.length === 0) {
          versionNotFound = true;
          performFallbackSearch();
        } else {
          bookCard.results = results;
          bookCard.seenCache = seenCache;
          refreshIndexOrders();
          
          // Load OG preview if no results found - use correct service based on bookType
          if (results.length === 0 && query) {
            if (bookCard.bookType === 'bible') {
              console.log('Book: Triggering Bible Gateway OG preview load after eosed (no results)');
              loadBibleGatewayPreview();
            } else if (bookCard.bookType === 'torah') {
              console.log('Book: Triggering Sefaria OG preview load after eosed (no results)');
              loadSefariaPreview();
            } else if (bookCard.bookType === 'quran') {
              console.log('Book: Triggering ExploreQuran OG preview load after eosed (no results)');
              loadExploreQuranPreview();
            }
          }
        }
      }
    }

    function receivedEvent(relay: AbstractRelay, id: string) {
      if (!(id in seenCache)) seenCache[id] = [];
      if (seenCache[id].indexOf(relay.url) === -1) seenCache[id].push(relay.url);
    }
  }
  async function performFallbackSearch() {
    if (!parsedQuery) return;

    // Create a new query without the version specification
    const fallbackQuery = { references: parsedQuery.references, version: undefined, versions: undefined };
    
    // Build relay filters using only T and c tags (filter collection, section, version client-side)
    const filters: any[] = [];
    
    for (const ref of fallbackQuery.references) {
      const filter: any = {
        kinds: [30040, 30041],
        limit: 100 // Increase limit since we're filtering more client-side
      };
      
      // Only use T (title) and c (chapter) tags in relay filter
      // Filter collection, section, and version client-side
      
      // T tag: title/book name (normalized using NIP-54)
      if (ref.book) {
        const normalizedBook = normalizeIdentifier(ref.book);
        filter['#T'] = [normalizedBook];
      }
      
      // c tag: chapter
      if (ref.chapter) {
        filter['#c'] = [ref.chapter.toString()];
      }
      
      // Don't include #C, #s, or #v in relay filter - filter client-side instead
      
      filters.push(filter);
    }
    
    const fallbackUpdate = debounce(() => {
      // Sort by book, chapter, section, version, then WOT score
      fallbackResults = sortBookResults(fallbackResults);
    }, 500);

    // Use relayService for fallback search with tag filters
    try {
      const fallbackResult = await relayService.queryEvents(
        'anonymous',
        'wiki-read',
        filters,
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );

      for (const evt of fallbackResult.events) {
        // Check if this event matches our book criteria (without version restriction)
        if (isBookEvent(evt as BookEvent, bookCard.bookType) && matchesBookQuery(evt as BookEvent, fallbackQuery)) {
          if (addUniqueTaggedReplaceable(fallbackResults, evt)) fallbackUpdate();
        }
      }

      // Update the main results with fallback results
      results = fallbackResults;
      bookCard.results = results;
      bookCard.seenCache = seenCache;
      refreshIndexOrders();
    } catch (error) {
      console.error('Failed to search for fallback books:', error);
    }
  }

  function matchesBookQuery(event: BookEvent, query: { references: BookReference[], version?: string, versions?: string[] }): boolean {
    const metadata = extractBookMetadata(event);
    
    // If a specific version is requested, check if this event matches that version
    // Support both singular 'version' and plural 'versions' from parsed query
    const requestedVersions = query.versions || (query.version ? [query.version] : []);
    if (requestedVersions.length > 0 && metadata.version) {
      const queryVersions = requestedVersions.map(v => v.toLowerCase());
      const eventVersions = metadata.version.toLowerCase().split(/\s+/);
      const hasMatchingVersion = queryVersions.some(qv => eventVersions.includes(qv));
      if (!hasMatchingVersion) {
        return false; // No version matches
      }
    }
    
    // Normalize book names for comparison (both should already be normalized, but ensure consistency)
    const normalizeBookName = (name: string) => normalizeIdentifier(name).toLowerCase();
    
    // Check if any of the references match
    for (const ref of query.references) {
      if (!metadata.book) continue;
      
      // Normalize both sides for comparison
      const normalizedQueryBook = normalizeBookName(ref.book);
      const normalizedEventBook = normalizeBookName(metadata.book);
      
      if (normalizedQueryBook !== normalizedEventBook) {
        continue; // Book doesn't match
      }
      
      // Book matches - check chapter
      if (ref.chapter) {
        if (!metadata.chapter || ref.chapter.toString() !== metadata.chapter) {
          continue; // Chapter doesn't match
        }
        
        // Chapter matches - check verse/section
        if (ref.verse) {
          // Expand verse ranges properly (e.g., "2-4" -> ["2", "3", "4"])
          const expandVerseToSections = (verse: string): string[] => {
            const sections: string[] = [];
            const parts = verse.split(',').map(p => p.trim());
            
            for (const part of parts) {
              if (part.includes('-')) {
                // It's a range
                const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                  for (let i = start; i <= end; i++) {
                    sections.push(i.toString());
                  }
                } else {
                  // Invalid range, just add as-is
                  sections.push(part);
                }
              } else {
                // Single section
                sections.push(part);
              }
            }
            
            return sections;
          };
          
          const querySections = expandVerseToSections(ref.verse);
          // Extract sections directly from event tags (more reliable than metadata.verse)
          const eventSections = extractEventSections(event);
          
          // Check if any query section matches any event section
          const hasMatchingSection = querySections.some(qs => eventSections.includes(qs));
          if (!hasMatchingSection) {
            continue; // No section matches
          }
        }
        // Chapter matches (and verse matches if specified)
        return true;
      } else {
        // Just book matches (no chapter specified)
        return true;
      }
    }
    
    return false;
  }

  function openBookEvent(result: BookEvent, ev?: MouseEvent) {
    const isMiddleClick = ev?.button === 1;
    const dTag = getTagOr(result, 'd') || result.id;
    const pubkey = result.pubkey;
    const relayHints = seenCache[result.id] || [];
    
    const articleCardData: Omit<ArticleCard, 'id'> = {
      type: 'article',
      data: [dTag, pubkey],
      relayHints,
      actualEvent: result
    };
    
    openOrCreateArticleCard(articleCardData);
  }

  // Find and open a 30040 event for a book/chapter
  async function openBookIndex(bookName: string, chapter?: string, ev?: MouseEvent) {
    const isMiddleClick = ev?.button === 1;
    
    try {
      const { findBookIndexEvent } = await import('$lib/books');
      const indexEvent = await findBookIndexEvent(
        bookName,
        chapter,
        bookCard.bookType,
        relayService,
        undefined
      );
      
      if (indexEvent) {
        const dTag = getTagOr(indexEvent, 'd') || indexEvent.id;
        const pubkey = indexEvent.pubkey;
        
        const articleCardData: Omit<ArticleCard, 'id'> = {
          type: 'article',
          data: [dTag, pubkey],
          relayHints: [],
          actualEvent: indexEvent
        };
        
        if (isMiddleClick) {
          const card: ArticleCard = {
            id: next(),
            ...articleCardData
          };
          createChild(card);
        } else {
          openOrCreateArticleCard(articleCardData);
        }
      }
    } catch (error) {
      console.warn('Book: Failed to find index event for', bookName, chapter, error);
    }
  }

  function startEditing() {
    debouncedPerformBookSearch.clear();
    editable = true;
  }

  function preventKeys(ev: KeyboardEvent) {
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      (ev.currentTarget as any)?.blur();
      finishedEditing();
    }
  }

  // Parse the query and update parsedQuery
  function parseQueryString(queryStr: string) {
    let queryToParse = queryStr;
    if (queryStr.startsWith('book::')) {
      // Search bar format: book::... (no brackets)
      queryToParse = `[[${queryStr}]]`; // Add brackets for parser
    } else if (queryStr.match(/^\[\[book::/)) {
      // Wikilink format: [[book::...]] (already has brackets)
      queryToParse = queryStr;
    }
    
    if (queryToParse.match(/^\[\[book::/)) {
      // NKBIP-08 format: parse with NKBIP-08 parser
      const parsed = parseBookWikilinkNKBIP08(queryToParse);
      if (parsed && parsed.references.length > 0) {
        // Convert NKBIP-08 format to BookReference format
        const references: DisplayReference[] = parsed.references.map(ref => ({
          book: ref.title,
          chapter: ref.chapter ? parseInt(ref.chapter, 10) : undefined,
          verse: ref.section ? (ref.section.length === 1 ? ref.section[0] : ref.section.join(',')) : undefined,
          sections: ref.section
        }));
        parsedQuery = {
          references,
          versions: parsed.references[0]?.version || []
        };
        // Extract bookType from first reference if available - CRITICAL for collection filtering
        if (parsed.references[0]?.collection) {
          bookCard.bookType = parsed.references[0].collection;
          console.log('Book: Set bookType from collection:', bookCard.bookType);
        } else {
          // If no collection in parsed result, try to extract from query string
          // Format: book::collection | title
          const collectionMatch = queryStr.match(/^book::([a-zA-Z0-9_-]+)\s*\|/);
          if (collectionMatch) {
            bookCard.bookType = collectionMatch[1].toLowerCase();
            console.log('Book: Extracted bookType from query string:', bookCard.bookType);
          } else {
            console.warn('Book: No collection found in query, bookType will be undefined:', queryStr);
          }
        }
        return true;
      }
    }
    
    // If parsing fails, set parsedQuery to null
    parsedQuery = null;
    return false;
  }

  function finishedEditing() {
    if (!editable) return;

    editable = false;
    query = query.replace(/[\r\n]/g, '').trim();
    if (query !== bookCard.data) {
      // Parse the new query to update parsedQuery
      parseQueryString(query);
      
      // replace browser url and history
      let index = $cards.findIndex((t) => t.id === card.id);
      let replacementURL = page.url.pathname.split('/').slice(1);
      replacementURL[index] = query;

      let currentState = page.state as [number, Card];
      replaceState('/' + replacementURL.join('/'), currentState[0] === index ? [] : currentState);

      // update stored card state
      bookCard.data = query;
      bookCard.results = undefined;

      // redo the query (parsedQuery is already updated synchronously by parseQueryString)
      debouncedPerformBookSearch();
    }
  }

  const debouncedPerformBookSearch = debounce(performBookSearch, 400);

  // Get the display name for the book type
  // Use the actual bookType from the card, or fallback to 'bible' only if truly undefined
  // This ensures torah/quran show correct names, not "bible"
  const bookTypeDisplayName = bookCard.bookType 
    ? (BOOK_TYPES[bookCard.bookType]?.displayName || bookCard.bookType.charAt(0).toUpperCase() + bookCard.bookType.slice(1))
    : 'book'; // Generic fallback instead of defaulting to 'bible'

  function formatReferenceForHeader(ref: DisplayReference): string {
    const book = ref.book ? capitalizeWords(ref.book) : '';
    const chapter = ref.chapter ? ` ${ref.chapter}` : '';
    const sections = ref.sections && ref.sections.length > 0 ? `:${formatSections(ref.sections)}` : '';
    const version = ref.version ? ` (${ref.version.toUpperCase()})` : '';
    return `${book}${chapter}${sections}${version}`.trim();
  }

  const readableQuery = $derived.by(() => {
    if (!parsedQuery || parsedQuery.references.length === 0) {
      return query;
    }
    const parts = parsedQuery.references.map((ref) => formatReferenceForHeader(ref)).filter((part) => part && part.trim().length > 0);
    return parts.length > 0 ? parts.join('; ') : query;
  });

  const requestedVersionsLabel = $derived.by(() => {
    if (!parsedQuery?.versions || parsedQuery.versions.length === 0) return null;
    const uniqueVersions = Array.from(new Set(parsedQuery.versions.map((v) => v.toLowerCase())));
    if (uniqueVersions.length === 0) return null;
    const displayNames = uniqueVersions.map((version) => {
      return version.toUpperCase();
    });
    return displayNames.join(', ');
  });

  // Get examples for the book type
  const getExamples = () => {
    switch (bookCard.bookType) {
      case 'quran':
        return [
          'Al-Fatiha 1-7',
          'Al-Baqarah 2:255 | SAHIH',
          'Surah Al-Ikhlas',
          'Al-Fatiha 1-7 | SAHIH PICKTHALL'
        ];
      case 'catechism':
        return [
          'Article 1:1',
          'Part I:1',
          'Article 2:1-5 | CCC',
          'Part II:1 | YOUCAT'
        ];
      default: // bible
        return [
          'John 3:16',
          'John 3:16 | KJV',
          'Psalm 23:1',
          'Genesis 1:1 | KJV',
          'Revelation 11:15 | DRB',
          'Romans 1:16-25; Psalm 19:2-3',
          'Romans 1:16-25 | KJV DRB'
        ];
    }
  };
</script>

<div class="mt-2 font-bold text-4xl" style="font-family: var(--font-family-heading);">
  <div class="flex items-center justify-between">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cursor-text flex-1"
      onclick={startEditing}
      onkeydown={preventKeys}
      role="textbox"
      tabindex="0"
    >
      {#if editable}
        <input
          bind:value={query}
          class="bg-transparent border-none outline-none w-full text-4xl font-bold"
          onblur={finishedEditing}
          onkeydown={preventKeys}
        />
      {:else}
        {readableQuery}
        {#if requestedVersionsLabel}
          <div class="text-xs font-semibold text-gray-500 uppercase tracking-[0.3em]" style="letter-spacing: 0.1em; margin-top: 0.35rem;">
            {requestedVersionsLabel}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<!-- Retry button at top of results pane -->
{#if tried || results.length > 0}
  <div class="mt-4 mb-4 flex justify-end">
    <button
      onclick={() => performBookSearch()}
      class="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors shadow-sm hover:shadow"
      title="Retry search"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Retry
    </button>
  </div>
{/if}

{#if tried && results.length === 0}
  {#if versionNotFound}
    <div class="mt-4 mb-4">
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div class="flex items-center space-x-2 text-yellow-800">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
          </svg>
          <span class="font-medium">Version not found</span>
        </div>
        <div class="mt-2 text-sm text-yellow-700">
          The requested version was not found. Showing the BibleGateway preview while passages load.
        </div>
      </div>
    </div>
  {/if}
  {#if bookCard.bookType === 'bible'}
    <div class="text-gray-500 italic">
      No {BOOK_TYPES[bookCard.bookType]?.displayName.toLowerCase() || 'bible'} passages found for "{query}"
    </div>
  {/if}
  {#if parsedQuery && parsedQuery.versions && parsedQuery.versions.length > 1}
    <!-- Multiple versions: Show OG cards for each version -->
    {#each parsedQuery.versions as version}
      <BookFallbackCards
        parsedQuery={parsedQuery}
        bibleGatewayUrl={bookCard.bookType === 'bible' ? generateBibleGatewayUrl(parsedQuery, version) : null}
        sefariaUrl={bookCard.bookType === 'torah' ? generateSefariaUrl(parsedQuery) : null}
        exploreQuranUrl={bookCard.bookType === 'quran' ? generateExploreQuranUrl(parsedQuery) : null}
        referenceOgPreviews={referenceOgPreviews}
        referenceOgLoading={referenceOgLoading}
        referenceOgErrors={referenceOgErrors}
        getReferenceKey={getReferenceKey}
        getReferenceKeyWithVersion={getReferenceKeyWithVersion}
        version={version}
        versionDisplayName={version.toUpperCase()}
        noWrapper={false}
        showBibleGateway={bookCard.bookType === 'bible'}
        showSefaria={bookCard.bookType === 'torah'}
        showExploreQuran={bookCard.bookType === 'quran'}
      />
    {/each}
  {:else}
    <!-- Single version or no version specified -->
    <BookFallbackCards
      parsedQuery={parsedQuery}
      bibleGatewayUrl={bibleGatewayUrlForQuery}
      sefariaUrl={sefariaUrlForQuery}
      exploreQuranUrl={exploreQuranUrlForQuery}
      referenceOgPreviews={referenceOgPreviews}
      referenceOgLoading={referenceOgLoading}
      referenceOgErrors={referenceOgErrors}
      getReferenceKey={getReferenceKey}
      getReferenceKeyWithVersion={getReferenceKeyWithVersion}
      showBibleGateway={bookCard.bookType === 'bible'}
      showSefaria={bookCard.bookType === 'torah'}
      showExploreQuran={bookCard.bookType === 'quran'}
    />
  {/if}
{:else if results.length > 0}
  {#if versionNotFound}
    <div class="mt-4 mb-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div class="flex items-center space-x-2 text-blue-800">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
          </svg>
          <span class="font-medium">Showing all available versions</span>
        </div>
        <div class="mt-2 text-sm text-blue-700">
          The requested version "{parsedQuery?.version}" was not found. Here are all available versions:
        </div>
      </div>
    </div>
  {/if}
  {@const compositeBgUrl = generateCompositeBibleGatewayUrl()}
  
  <div class="mt-4 space-y-4">
    {#if groupedResults.hasVersionRequested && groupedResults.versionGroups && groupedResults.versionGroups.size > 0}
      <!-- Multiple versions: Group by version -->
      {#each Array.from(groupedResults.versionGroups.entries()) as [versionKey, versionBookMap]}
        {@const versionDisplayName = versionKey.toUpperCase()}
        {@const hasResults = versionBookMap.size > 0}
        
        <!-- Version Group Container -->
        <div 
          class="version-group" 
          style="margin: 2rem 0; border: 2px solid var(--accent); border-radius: 0.75rem; padding: 1.5rem; background-color: var(--bg-primary); position: relative;"
        >
          <!-- Version Header -->
          <div 
            class="version-header" 
            style="font-size: 0.75em; font-variant: small-caps; letter-spacing: 0.1em; margin-bottom: 1rem; color: var(--text-secondary, #6b7280); opacity: 0.8; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border, #e5e7eb);"
          >
            {versionDisplayName}
          </div>
          
          {#if hasResults}
            {@const versionSpecificBgUrl = generateCompositeBibleGatewayUrl(versionKey)}
            <!-- Bible Gateway link for this version -->
            {#if versionSpecificBgUrl}
              <a 
                href={versionSpecificBgUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                class="bible-gateway-link"
                style="position: absolute; top: 1.5rem; right: 1.5rem; text-decoration: none; color: var(--accent); font-size: 1.25rem; transition: opacity 0.2s;"
                title="View on Bible Gateway"
              >
                🔗
              </a>
            {/if}
            
            <!-- Passages for this version -->
            {#each Array.from(versionBookMap.entries()) as [bookKey, chapterMap]}
              {@const firstChapter = Array.from(chapterMap.values())[0]?.[0]}
              {@const firstMetadata = firstChapter ? extractBookMetadata(firstChapter.best) : null}
              {@const bookTitle = firstMetadata ? capitalizeWords(firstMetadata.book || '') : ''}
              
              <!-- Single container for all passages from this book -->
              <div 
                class="book-passage-group" 
                style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding: 1.25rem; background-color: var(--bg-secondary); border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative;"
              >
                <!-- Each chapter group -->
                {#each Array.from(chapterMap.entries()) as [chapterKey, referenceGroups]}
                {@const chapterMetadata = extractBookMetadata(referenceGroups[0].best)}
                {@const chapter = chapterMetadata.chapter || ''}
                {@const allSections = getAllSectionsFromGroup(referenceGroups)}
                {@const headerVerses = formatSections(allSections)}
                {@const chapterKeys = Array.from(chapterMap.keys())}
                {@const isFirstChapter = chapterKey === chapterKeys[0]}
                {@const bookName = firstMetadata?.book || ''}
                
                <!-- Chapter header with clickable parts -->
                <div 
                  class="chapter-header" 
                  style="font-weight: bold; font-size: 1.1em; margin-bottom: 0.75rem; margin-top: {isFirstChapter ? '0' : '1.5rem'}; color: var(--accent);"
                >
                  <button
                    type="button"
                    onclick={(e) => openBookIndex(bookName, undefined, e)}
                    style="color: var(--accent); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit;"
                    title="Open book index"
                  >
                    {bookTitle}
                  </button>
                  {#if chapter}
                    {' '}
                    <button
                      type="button"
                      onclick={(e) => openBookIndex(bookName, chapter, e)}
                      style="color: var(--accent); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit;"
                      title="Open chapter index"
                    >
                      {chapter}
                    </button>
                  {/if}
                  :{headerVerses}
                </div>
                
                <!-- Create a map of section -> best event for this chapter -->
                          {@const sectionToRefGroupMap = (() => {
                            const map = new Map<string, { best: BookEvent; all: BookEvent[] }>();
                            for (const refGroup of referenceGroups) {
                              const sections = extractEventSections(refGroup.best);
                              for (const section of sections) {
                                if (!map.has(section)) {
                                  map.set(section, refGroup);
                                }
                              }
                            }
                            return map;
                          })()}
                          {@const chapterOrderKey = getScopeKey(bookKey, chapter)}
                          {@const chapterOrderList = indexOrders.get(chapterOrderKey)}
                          {@const orderedSections = getOrderedSections(allSections, sectionToRefGroupMap, chapterOrderList)}
                          
                          <!-- Verses in this chapter (sorted by verse number or index order) -->
                          {#each orderedSections as section}
                  {@const refGroup = sectionToRefGroupMap.get(section)}
                  {#if refGroup}
                    {@const currentVerseEvent = refGroup.best}
                    
                    <div 
                      class="verse-item"
                      style="display: flex; align-items: flex-start; margin-bottom: 0.5rem; gap: 0.6rem; line-height: 1.6;"
                    >
                      <!-- Verse number (left) -->
                      <span 
                        style="font-weight: bold; color: var(--accent); min-width: 2rem; flex-shrink: 0;"
                      >
                        {section}
                      </span>
                      
                      <!-- Verse content -->
                      <span 
                        class="verse-content" 
                        style="color: var(--text-primary); flex: 1; cursor: pointer;"
                        onclick={(e) => openBookEvent(currentVerseEvent, e)}
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => e.key === 'Enter' && openBookEvent(currentVerseEvent, undefined)}
                        title="Click to open this passage in a new panel"
                      >
                        {currentVerseEvent.content}
                      </span>
                    </div>
                  {/if}
                {/each}
              {/each}
              </div>
            {/each}
          {:else}
            <!-- No results for this version - show reference cards -->
            {@const versionSpecificBgUrl = bookCard.bookType === 'bible' ? generateCompositeBibleGatewayUrl(versionKey) : null}
            {@const versionSpecificSefariaUrl = bookCard.bookType === 'torah' ? generateSefariaUrl(parsedQuery) : null}
            {@const versionSpecificExploreQuranUrl = bookCard.bookType === 'quran' ? generateExploreQuranUrl(parsedQuery) : null}
            {@const versionSpecificParsedQuery = parsedQuery ? { ...parsedQuery, versions: [versionKey] } : null}
            <BookFallbackCards
              parsedQuery={versionSpecificParsedQuery}
              bibleGatewayUrl={versionSpecificBgUrl}
              sefariaUrl={versionSpecificSefariaUrl}
              exploreQuranUrl={versionSpecificExploreQuranUrl}
              referenceOgPreviews={referenceOgPreviews}
              referenceOgLoading={referenceOgLoading}
              referenceOgErrors={referenceOgErrors}
              getReferenceKey={getReferenceKey}
              getReferenceKeyWithVersion={getReferenceKeyWithVersion}
              version={versionKey}
              versionDisplayName={versionDisplayName}
              noWrapper={true}
              showBibleGateway={bookCard.bookType === 'bible'}
              showSefaria={bookCard.bookType === 'torah'}
              showExploreQuran={bookCard.bookType === 'quran'}
            />
          {/if}
        </div>
      {/each}
    {:else}
      <!-- Single version: Grouped Bible Results (Bible Gateway style) -->
      {#each Array.from(groupedResults.bibleGroups.entries()) as [bookKey, chapterMap]}
      {@const firstChapter = Array.from(chapterMap.values())[0]?.[0]}
      {@const firstMetadata = firstChapter ? extractBookMetadata(firstChapter.best) : null}
      {@const bookTitle = firstMetadata ? capitalizeWords(firstMetadata.book || '') : ''}
      
      <!-- Single container for all passages from this book -->
      <div 
        class="book-passage-group" 
        style="margin: 1.5rem 0; border-left: 4px solid var(--accent); padding: 1.25rem; background-color: var(--bg-secondary); border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative;"
      >
        <!-- Bible Gateway link (top-right) -->
        {#if compositeBgUrl}
          <a 
            href={compositeBgUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            class="bible-gateway-link"
            style="position: absolute; top: 0.75rem; right: 0.75rem; text-decoration: none; color: var(--accent); font-size: 1.25rem; transition: opacity 0.2s;"
            title="View on Bible Gateway"
          >
            🔗
          </a>
        {/if}
        
        <!-- Each chapter group -->
        {#each Array.from(chapterMap.entries()) as [chapterKey, referenceGroups]}
          {@const chapterMetadata = extractBookMetadata(referenceGroups[0].best)}
          {@const chapter = chapterMetadata.chapter || ''}
          {@const allSections = getAllSectionsFromGroup(referenceGroups)}
          {@const headerVerses = formatSections(allSections)}
          {@const chapterKeys = Array.from(chapterMap.keys())}
          {@const isFirstChapter = chapterKey === chapterKeys[0]}
          {@const bookName = firstMetadata?.book || ''}
          
          <!-- Chapter header with clickable parts -->
          <div 
            class="chapter-header" 
            style="font-weight: bold; font-size: 1.1em; margin-bottom: 0.75rem; margin-top: {isFirstChapter ? '0' : '1.5rem'}; color: var(--accent);"
          >
            <button
              type="button"
              onclick={(e) => openBookIndex(bookName, undefined, e)}
              style="color: var(--accent); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit;"
              title="Open book index"
            >
              {bookTitle}
            </button>
            {#if chapter}
              {' '}
              <button
                type="button"
                onclick={(e) => openBookIndex(bookName, chapter, e)}
                style="color: var(--accent); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit;"
                title="Open chapter index"
              >
                {chapter}
              </button>
            {/if}
            :{headerVerses}
          </div>
          
          <!-- Create a map of section -> best event for this chapter -->
          {@const sectionToRefGroup = (() => {
            const map = new Map<string, { best: BookEvent; all: BookEvent[] }>();
            for (const refGroup of referenceGroups) {
              const sections = extractEventSections(refGroup.best);
              for (const section of sections) {
                if (!map.has(section)) {
                  map.set(section, refGroup);
                }
              }
            }
            return map;
          })()}
          {@const chapterOrderKey = getScopeKey(bookKey, chapter)}
          {@const chapterOrderList = indexOrders.get(chapterOrderKey)}
          {@const orderedSections = getOrderedSections(allSections, sectionToRefGroup, chapterOrderList)}
          
          <!-- Verses in this chapter (sorted by verse number or index order) -->
          {#each orderedSections as section}
            {@const refGroup = sectionToRefGroup.get(section)}
            {#if refGroup}
              {@const currentVerseEvent = refGroup.best}
              <div 
                class="verse-item"
                style="display: flex; margin-bottom: 0.5rem; line-height: 1.6;"
              >
                <!-- Verse number (left) -->
                <span 
                  style="font-weight: bold; color: var(--accent); margin-right: 0.5rem; min-width: 2rem; flex-shrink: 0;"
                >
                  {section}
                </span>
                
                <!-- Verse content -->
                <span 
                  class="verse-content" 
                  style="color: var(--text-primary); flex: 1; cursor: pointer;"
                  onclick={(e) => openBookEvent(currentVerseEvent, e)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && openBookEvent(currentVerseEvent, undefined)}
                  title="Click to open this passage in a new panel"
                >
                  {currentVerseEvent.content}
                </span>
              </div>
            {/if}
          {/each}
        {/each}
      </div>
    {/each}
    {/if}
    
    <!-- Non-Bible Results -->
    {#each groupedResults.nonBibleResults as result (result.id)}
      {@const metadata = extractBookMetadata(result)}
      {@const title = generateBookTitle(metadata)}
      
      <div 
        class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
        role="button"
        tabindex="0"
        onclick={(e) => openBookEvent(result, e)}
        onkeydown={(e) => e.key === 'Enter' && openBookEvent(result, undefined)}
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-blue-600 hover:text-blue-800">
              {title}
            </h3>
            <div class="text-sm text-gray-600 mt-1">
              by <span class="font-mono text-xs">{result.pubkey.slice(0, 8)}...</span>
              {#if result.created_at}
                • {formatRelativeTime(result.created_at)}
              {/if}
            </div>
            <div class="mt-2 text-sm text-gray-700 line-clamp-3">
              {result.content.slice(0, 200)}...
            </div>
          </div>
          <div class="ml-4 text-xs text-gray-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </div>
        </div>
      </div>
    {/each}
  </div>
{:else if !tried && parsedQuery}
  <!-- Show loading state while searching -->
  <div class="mt-4 text-gray-500 italic">
    <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 0.5rem; vertical-align: middle;"></div>
    <span>Searching for {bookTypeDisplayName.toLowerCase()} passages...</span>
  </div>
{/if}

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
  
  .bible-gateway-link:hover {
    opacity: 0.7;
  }
</style>
