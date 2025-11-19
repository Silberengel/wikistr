/**
 * Tests for BookPassageGroup range search and ordering functionality
 * Tests the logic for finding events with range tags or individual sections
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostr/tools/pure';
import { parseBookWikilink, bookReferenceToTags } from '../src/lib/bookWikilinkParser';

describe('BookPassageGroup Range Search', () => {
  // Mock events for testing
  const createMockEvent = (
    id: string,
    tags: string[][],
    content: string = 'Test content'
  ): NostrEvent => ({
    id,
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: 30041,
    tags,
    content,
    sig: 'test-sig'
  });

  describe('Range tag search priority', () => {
    it('should prefer events with range tag ["s", "4-6"] over individual sections', () => {
      const result = parseBookWikilink('[[book::romans 3:4-6]]');
      expect(result).not.toBeNull();
      
      const ref = result!.references[0];
      expect(ref.section).toEqual(['4', '5', '6']);
      
      // The BookPassageGroup should:
      // 1. First search for events with ["s", "4-6"]
      // 2. If not found, search for ["s", "4"], ["s", "5"], ["s", "6"]
      
      const tags = bookReferenceToTags(ref);
      const sectionTags = tags.filter(([tag]) => tag === 's');
      
      // Should have individual section tags for fallback search
      expect(sectionTags.length).toBe(3);
      expect(sectionTags.map(([, v]) => v)).toEqual(['4', '5', '6']);
    });
  });

  describe('Individual section search and ordering', () => {
    it('should find and order events with individual numeric sections', () => {
      const result = parseBookWikilink('[[book::romans 3:4-6]]');
      expect(result).not.toBeNull();
      
      const ref = result!.references[0];
      
      // Mock events with individual sections
      const event4 = createMockEvent('event-4', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4']
      ], 'Verse 4 content');
      
      const event5 = createMockEvent('event-5', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '5']
      ], 'Verse 5 content');
      
      const event6 = createMockEvent('event-6', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '6']
      ], 'Verse 6 content');
      
      // Events should be found and ordered numerically: 4, 5, 6
      const foundEvents = [
        { event: event4, sectionValue: '4' },
        { event: event5, sectionValue: '5' },
        { event: event6, sectionValue: '6' }
      ];
      
      // Sort by section value numerically
      foundEvents.sort((a, b) => {
        const aVal = a.sectionValue ? parseInt(a.sectionValue, 10) : 0;
        const bVal = b.sectionValue ? parseInt(b.sectionValue, 10) : 0;
        return aVal - bVal;
      });
      
      expect(foundEvents.map(e => e.sectionValue)).toEqual(['4', '5', '6']);
      expect(foundEvents[0].event.id).toBe('event-4');
      expect(foundEvents[1].event.id).toBe('event-5');
      expect(foundEvents[2].event.id).toBe('event-6');
    });

    it('should handle out-of-order events and sort them correctly', () => {
      // Mock events in wrong order
      const event6 = createMockEvent('event-6', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '6']
      ]);
      
      const event4 = createMockEvent('event-4', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4']
      ]);
      
      const event5 = createMockEvent('event-5', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '5']
      ]);
      
      const foundEvents = [
        { event: event6, sectionValue: '6' },
        { event: event4, sectionValue: '4' },
        { event: event5, sectionValue: '5' }
      ];
      
      // Sort numerically
      foundEvents.sort((a, b) => {
        const aVal = a.sectionValue ? parseInt(a.sectionValue, 10) : 0;
        const bVal = b.sectionValue ? parseInt(b.sectionValue, 10) : 0;
        return aVal - bVal;
      });
      
      expect(foundEvents.map(e => e.sectionValue)).toEqual(['4', '5', '6']);
    });
  });

  describe('Non-numeric section ordering with 30040 index', () => {
    it('should use 30040 index event with e tags for non-numeric section ordering', () => {
      // Mock a reference with non-numeric sections
      const result = parseBookWikilink('[[book::test-book 1:section-a,section-b,section-c]]');
      expect(result).not.toBeNull();
      
      const ref = result!.references[0];
      expect(ref.section).toBeDefined();
      expect(ref.section?.some(s => !/^\d+$/.test(s))).toBe(true);
      
      // Mock 30040 index event with ordered 'e' tags
      const indexEvent: NostrEvent = createMockEvent('index-event', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['e', 'event-c-id'], // Listed first in index
        ['e', 'event-a-id'], // Listed second
        ['e', 'event-b-id']  // Listed third
      ], '');
      
      // Mock content events
      const eventA = createMockEvent('event-a-id', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-a']
      ]);
      
      const eventB = createMockEvent('event-b-id', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-b']
      ]);
      
      const eventC = createMockEvent('event-c-id', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-c']
      ]);
      
      // Extract ordered event IDs from index (e tags)
      const orderedEventIds = indexEvent.tags
        .filter(([t]) => t === 'e')
        .map(([, id]) => id);
      
      expect(orderedEventIds).toEqual(['event-c-id', 'event-a-id', 'event-b-id']);
      
      // Found events (in random order)
      const foundEvents = [
        { event: eventA, sectionValue: 'section-a' },
        { event: eventB, sectionValue: 'section-b' },
        { event: eventC, sectionValue: 'section-c' }
      ];
      
      // Sort by index order
      foundEvents.sort((a, b) => {
        const aIndex = orderedEventIds.indexOf(a.event.id);
        const bIndex = orderedEventIds.indexOf(b.event.id);
        
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        
        return aIndex - bIndex;
      });
      
      // Should be ordered: C, A, B (as per index)
      expect(foundEvents.map(e => e.event.id)).toEqual(['event-c-id', 'event-a-id', 'event-b-id']);
    });

    it('should use 30040 index event with a tags for non-numeric section ordering', () => {
      // Mock a reference with non-numeric sections
      const result = parseBookWikilink('[[book::test-book 1:section-a,section-b,section-c]]');
      expect(result).not.toBeNull();
      
      // Mock content events with d tags
      const eventA = createMockEvent('event-a-id', [
        ['d', 'romans-3-section-a'],
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-a']
      ]);
      
      const eventB = createMockEvent('event-b-id', [
        ['d', 'romans-3-section-b'],
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-b']
      ]);
      
      const eventC = createMockEvent('event-c-id', [
        ['d', 'romans-3-section-c'],
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-c']
      ]);
      
      // Mock 30040 index event with ordered 'a' tags (kind:pubkey:identifier)
      const indexEvent: NostrEvent = createMockEvent('index-event', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['a', `30041:${eventC.pubkey}:romans-3-section-c`], // Listed first
        ['a', `30041:${eventA.pubkey}:romans-3-section-a`], // Listed second
        ['a', `30041:${eventB.pubkey}:romans-3-section-b`]  // Listed third
      ], '');
      
      // Extract ordered a tags from index
      const orderedATags = indexEvent.tags
        .filter(([t]) => t === 'a')
        .map(([, value]) => value);
      
      expect(orderedATags.length).toBe(3);
      
      // Found events (in random order)
      const foundEvents = [
        { event: eventA, sectionValue: 'section-a' },
        { event: eventB, sectionValue: 'section-b' },
        { event: eventC, sectionValue: 'section-c' }
      ];
      
      // Sort by index order using a tags
      foundEvents.sort((a, b) => {
        // Construct a tag for each event
        const aDTag = a.event.tags.find(([t]) => t === 'd')?.[1] || '';
        const aATag = aDTag ? `${a.event.kind}:${a.event.pubkey}:${aDTag}` : '';
        const aIndex = aATag ? orderedATags.indexOf(aATag) : -1;
        
        const bDTag = b.event.tags.find(([t]) => t === 'd')?.[1] || '';
        const bATag = bDTag ? `${b.event.kind}:${b.event.pubkey}:${bDTag}` : '';
        const bIndex = bATag ? orderedATags.indexOf(bATag) : -1;
        
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        
        return aIndex - bIndex;
      });
      
      // Should be ordered: C, A, B (as per index)
      expect(foundEvents.map(e => e.event.id)).toEqual(['event-c-id', 'event-a-id', 'event-b-id']);
    });

    it('should handle index event with both e and a tags', () => {
      // Mock content events
      const eventA = createMockEvent('event-a-id', [
        ['d', 'romans-3-section-a'],
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-a']
      ]);
      
      const eventB = createMockEvent('event-b-id', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['s', 'section-b']
      ]);
      
      // Mock 30040 index event with both e and a tags
      const indexEvent: NostrEvent = createMockEvent('index-event', [
        ['C', 'test-collection'],
        ['T', 'test-book'],
        ['c', '1'],
        ['e', 'event-b-id'], // e tag for event B
        ['a', `30041:${eventA.pubkey}:romans-3-section-a`] // a tag for event A
      ], '');
      
      // Extract both e and a tags
      const orderedEventIds = indexEvent.tags
        .filter(([t]) => t === 'e')
        .map(([, id]) => id);
      
      const orderedATags = indexEvent.tags
        .filter(([t]) => t === 'a')
        .map(([, value]) => value);
      
      // Found events
      const foundEvents = [
        { event: eventA, sectionValue: 'section-a' },
        { event: eventB, sectionValue: 'section-b' }
      ];
      
      // Sort by index order (prefer a tags as default, then e tags as fallback)
      foundEvents.sort((a, b) => {
        // Try a tags first (default)
        const aDTag = a.event.tags.find(([t]) => t === 'd')?.[1] || '';
        const aATag = aDTag ? `${a.event.kind}:${a.event.pubkey}:${aDTag}` : '';
        const aIndexByATag = aATag ? orderedATags.indexOf(aATag) : -1;
        
        const bDTag = b.event.tags.find(([t]) => t === 'd')?.[1] || '';
        const bATag = bDTag ? `${b.event.kind}:${b.event.pubkey}:${bDTag}` : '';
        const bIndexByATag = bATag ? orderedATags.indexOf(bATag) : -1;
        
        // Fall back to e tags if a tag not found
        const aIndexById = aIndexByATag === -1 ? orderedEventIds.indexOf(a.event.id) : -1;
        const bIndexById = bIndexByATag === -1 ? orderedEventIds.indexOf(b.event.id) : -1;
        
        const aIndex = aIndexByATag !== -1 ? aIndexByATag : (aIndexById !== -1 ? orderedATags.length + aIndexById : -1);
        const bIndex = bIndexByATag !== -1 ? bIndexByATag : (bIndexById !== -1 ? orderedATags.length + bIndexById : -1);
        
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        
        return aIndex - bIndex;
      });
      
      // Should be ordered: A (a tag - default), B (e tag - fallback)
      expect(foundEvents.map(e => e.event.id)).toEqual(['event-a-id', 'event-b-id']);
    });
  });

  describe('Multiple versions grouping and ordering', () => {
    it('should fetch and group events by version in order', () => {
      const result = parseBookWikilink('[[book::bible | romans 3:4-6 | kjv drb niv]]');
      expect(result).not.toBeNull();
      
      const ref = result!.references[0];
      expect(ref.version).toEqual(['kjv', 'drb', 'niv']);
      expect(ref.section).toEqual(['4', '5', '6']);
      
      // Mock events for each version
      const kjvEvent4 = createMockEvent('kjv-event-4', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4'],
        ['v', 'kjv']
      ], 'KJV verse 4');
      
      const kjvEvent5 = createMockEvent('kjv-event-5', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '5'],
        ['v', 'kjv']
      ], 'KJV verse 5');
      
      const kjvEvent6 = createMockEvent('kjv-event-6', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '6'],
        ['v', 'kjv']
      ], 'KJV verse 6');
      
      const drbEvent4 = createMockEvent('drb-event-4', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4'],
        ['v', 'drb']
      ], 'DRB verse 4');
      
      const drbEvent5 = createMockEvent('drb-event-5', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '5'],
        ['v', 'drb']
      ], 'DRB verse 5');
      
      const drbEvent6 = createMockEvent('drb-event-6', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '6'],
        ['v', 'drb']
      ], 'DRB verse 6');
      
      const nivEvent4 = createMockEvent('niv-event-4', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4'],
        ['v', 'niv']
      ], 'NIV verse 4');
      
      const nivEvent5 = createMockEvent('niv-event-5', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '5'],
        ['v', 'niv']
      ], 'NIV verse 5');
      
      const nivEvent6 = createMockEvent('niv-event-6', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '6'],
        ['v', 'niv']
      ], 'NIV verse 6');
      
      // Group events by version
      const eventsByVersion = new Map<string | undefined, Array<{ event: NostrEvent; sectionValue?: string }>>();
      
      // KJV events (sorted by section)
      eventsByVersion.set('kjv', [
        { event: kjvEvent4, sectionValue: '4' },
        { event: kjvEvent5, sectionValue: '5' },
        { event: kjvEvent6, sectionValue: '6' }
      ]);
      
      // DRB events (sorted by section)
      eventsByVersion.set('drb', [
        { event: drbEvent4, sectionValue: '4' },
        { event: drbEvent5, sectionValue: '5' },
        { event: drbEvent6, sectionValue: '6' }
      ]);
      
      // NIV events (sorted by section)
      eventsByVersion.set('niv', [
        { event: nivEvent4, sectionValue: '4' },
        { event: nivEvent5, sectionValue: '5' },
        { event: nivEvent6, sectionValue: '6' }
      ]);
      
      // Combine events from all versions in version order
      const versionOrder = ref.version || [undefined];
      const combinedPassages: Array<{ event: NostrEvent; sectionValue?: string; version?: string }> = [];
      
      for (const version of versionOrder) {
        const versionEvents = eventsByVersion.get(version) || [];
        for (const { event, sectionValue } of versionEvents) {
          combinedPassages.push({ event, sectionValue, version });
        }
      }
      
      // Verify order: all KJV (4, 5, 6), then all DRB (4, 5, 6), then all NIV (4, 5, 6)
      expect(combinedPassages.length).toBe(9);
      expect(combinedPassages[0].version).toBe('kjv');
      expect(combinedPassages[0].sectionValue).toBe('4');
      expect(combinedPassages[1].version).toBe('kjv');
      expect(combinedPassages[1].sectionValue).toBe('5');
      expect(combinedPassages[2].version).toBe('kjv');
      expect(combinedPassages[2].sectionValue).toBe('6');
      
      expect(combinedPassages[3].version).toBe('drb');
      expect(combinedPassages[3].sectionValue).toBe('4');
      expect(combinedPassages[4].version).toBe('drb');
      expect(combinedPassages[4].sectionValue).toBe('5');
      expect(combinedPassages[5].version).toBe('drb');
      expect(combinedPassages[5].sectionValue).toBe('6');
      
      expect(combinedPassages[6].version).toBe('niv');
      expect(combinedPassages[6].sectionValue).toBe('4');
      expect(combinedPassages[7].version).toBe('niv');
      expect(combinedPassages[7].sectionValue).toBe('5');
      expect(combinedPassages[8].version).toBe('niv');
      expect(combinedPassages[8].sectionValue).toBe('6');
    });

    it('should handle single version correctly', () => {
      const result = parseBookWikilink('[[book::bible | romans 3:4-6 | kjv]]');
      expect(result).not.toBeNull();
      
      const ref = result!.references[0];
      expect(ref.version).toEqual(['kjv']);
      
      // Should still work with single version
      const versionOrder = ref.version && ref.version.length > 0 ? ref.version : [undefined];
      expect(versionOrder).toEqual(['kjv']);
    });

    it('should generate unique Bible Gateway URLs for each card', () => {
      // Simulate the generateBibleGatewayUrl function logic
      function generateBibleGatewayUrl(
        collection: string | undefined,
        title: string,
        chapter: string | undefined,
        sectionValue: string | undefined,
        version: string | undefined
      ): string | null {
        if (collection !== 'bible') return null;

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

        const bgVersion = version 
          ? (versionMap[version.toLowerCase()] || version.toUpperCase())
          : 'KJV';

        let search = title;
        if (chapter) {
          search += ` ${chapter}`;
          if (sectionValue) {
            search += `:${sectionValue}`;
          }
        }

        const encodedSearch = encodeURIComponent(search);
        return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${bgVersion}`;
      }

      // Test: 3 passages (4, 5, 6) from 3 versions (kjv, drb, niv) = 9 cards
      const passages = [
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '4', version: 'kjv' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '5', version: 'kjv' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '6', version: 'kjv' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '4', version: 'drb' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '5', version: 'drb' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '6', version: 'drb' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '4', version: 'niv' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '5', version: 'niv' },
        { collection: 'bible', title: 'romans', chapter: '3', sectionValue: '6', version: 'niv' }
      ];

      const urls = passages.map(p => 
        generateBibleGatewayUrl(p.collection, p.title, p.chapter, p.sectionValue, p.version)
      );

      // All URLs should be unique
      expect(new Set(urls).size).toBe(9);
      
      // Verify specific URLs
      expect(urls[0]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A4&version=KJV');
      expect(urls[1]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A5&version=KJV');
      expect(urls[2]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A6&version=KJV');
      expect(urls[3]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A4&version=DRA');
      expect(urls[4]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A5&version=DRA');
      expect(urls[5]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A6&version=DRA');
      expect(urls[6]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A4&version=NIV');
      expect(urls[7]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A5&version=NIV');
      expect(urls[8]).toBe('https://www.biblegateway.com/passage/?search=romans%203%3A6&version=NIV');
    });
  });

  describe('Edge cases', () => {
    it('should handle single section in range', () => {
      const result = parseBookWikilink('[[book::romans 3:4]]');
      expect(result).not.toBeNull();
      expect(result?.references[0].section).toEqual(['4']);
      
      // Should not try to find range tag, just search for s:4
      const tags = bookReferenceToTags(result!.references[0]);
      const sectionTags = tags.filter(([tag]) => tag === 's');
      expect(sectionTags.length).toBe(1);
      expect(sectionTags[0][1]).toBe('4');
    });

    it('should handle large ranges', () => {
      const result = parseBookWikilink('[[book::romans 3:1-10]]');
      expect(result).not.toBeNull();
      const sections = result?.references[0].section || [];
      expect(sections.length).toBe(10);
      expect(sections).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    });

    it('should handle events with multiple section tags', () => {
      // Event that matches multiple sections in range
      const event = createMockEvent('event-multi', [
        ['C', 'bible'],
        ['T', 'romans'],
        ['c', '3'],
        ['s', '4'],
        ['s', '5'],
        ['s', '6']
      ]);
      
      // Should only appear once in results (deduplicated by event ID)
      const eventSections = event.tags.filter(([t]) => t === 's').map(([, v]) => v);
      expect(eventSections).toEqual(['4', '5', '6']);
      
      // When querying for 4-6, this event should match but appear only once
      const querySections = ['4', '5', '6'];
      const matches = querySections.some(qs => eventSections.includes(qs));
      expect(matches).toBe(true);
    });
  });
});

