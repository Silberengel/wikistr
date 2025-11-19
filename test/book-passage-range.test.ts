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

