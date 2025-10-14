# Bible Test Events

This directory contains test events for the Bible functionality in WikiStr.

## Kind 30041 Events (Bible Verses)

These are individual Bible verses with proper Bible tags that should be detected and displayed by the Bible search functionality.

### Files:
- `exodus_3_16_30041.json` - Exodus 3:16 (KJV)
- `john_3_16_30041.json` - John 3:16 (KJV) 
- `john_3_16_niv_30041.json` - John 3:16 (NIV)
- `version_fallback_test_30041.json` - John 3:16 (ESV)
- `revelation_11_15_30041.json` - Revelation 11:15 (Douay-Rheims)
- `psalm_23_1_30041.json` - Psalm 23:1 (KJV)

### Tags Used:
- `type: bible` - Identifies as Bible event
- `bible-book` - Book name (e.g., "John", "Exodus")
- `bible-chapter` - Chapter number
- `bible-verses` - Verse number(s)
- `bible-version` - Version name (e.g., "King James Version")

## Kind 1 Events (Bible Verses as Notes)

These are regular Kind 1 notes that contain actual Bible verse content with Bible tags. People have already published the Bible as Kind 1 notes, so our system needs to detect and handle these.

### Bible Verse Kind 1 Events:
- `john_3_16_kind1.json` - John 3:16 (KJV) as Kind 1
- `john_3_16_niv_kind1.json` - John 3:16 (NIV) as Kind 1
- `exodus_3_16_kind1.json` - Exodus 3:16 (KJV) as Kind 1
- `psalm_23_1_kind1.json` - Psalm 23:1 (KJV) as Kind 1
- `revelation_11_15_kind1.json` - Revelation 11:15 (DRB) as Kind 1

### Reference Kind 1 Events:
- `bible_verse_note_kind1.json` - Note about John 3:16 (references with "e" tag)
- `exodus_verse_note_kind1.json` - Note about Exodus 3:16 (references with "e" tag)

### Tags Used:
- **Bible Verse Kind 1s**: `type: bible`, `bible-book`, `bible-chapter`, `bible-verses`, `bible-version`
- **Reference Kind 1s**: `e` - References the Bible verse event ID, `p` - References the Bible verse author

## Kind 30023 Events (Long-form Articles)

These are long-form articles that reference Bible verses using "a" tags.

### Files:
- `bible_article_30023.json` - Article about John 3:16 with "a" tag reference

### Tags Used:
- `a` - References Bible verse event (kind:id:pubkey format)

## Kind 30818 Events (Wiki Pages)

These are wiki events that should open as wiki pages, NOT as Bible pages.

### Files:
- `bible_study_wiki_30818.json` - Wiki page about Bible study
- `bible_versions_wiki_30818.json` - Wiki page comparing Bible versions
- `bible_study_guide_30818.json` - Wiki page with [[wikilink]] Bible references

### Tags Used:
- `subject` - Subject tags for categorization
- Note: Kind 30818 defaults to wiki type, no `type` tag needed

## Test Scenarios

### Version Fallback Testing
Search for `[[John 3:16 | XYZ]]` (non-existent version) to test the fallback functionality. The system should:
1. Show warning that "XYZ" version not found
2. Display all available versions (KJV, NIV, ESV)

### Event Type Detection
- **Kind 30041 with Bible tags** → Should open as Bible page
- **Kind 1 with Bible tags** → Should open as Bible page (people have published Bible as Kind 1)
- **Kind 1 with "e" tags** → Should open as regular note (references Bible verses)
- **Kind 30818 with wiki tags** → Should open as wiki page

### Bible Search Testing
- `[[John 3:16]]` → Should show all versions
- `[[John 3:16 | KJV]]` → Should show only KJV version
- `[[Exodus 3:16]]` → Should show Exodus verse
- `[[Revelation 11:15 | DRB]]` → Should show Douay-Rheims version

## Original Chapter Events

- `exodus_chapter.json` - Full Exodus Chapter 3 (KJV)
- `john._chapter.json` - Full Revelation Chapter 11 (Douay-Rheims)

These are the original chapter events that the verse events were derived from.

## Unit Tests

### Function Tests (`bible.test.ts`)
Tests the Bible utility functions directly with mock data:

```bash
npm test bible.test.ts
```

**Coverage:**
- ✅ Bible notation parsing (single verse, chapter, book, ranges)
- ✅ Wikilink parsing with and without versions
- ✅ Bible event detection (Kind 30041, Kind 1 with Bible tags)
- ✅ Metadata extraction from events
- ✅ Title generation for display
- ✅ Search query generation
- ✅ Abbreviation support (Turabian standard)
- ✅ Deuterocanonical books support

### Integration Tests (`bible-integration.test.ts`)
Tests using the actual test event files:

```bash
npm test bible-integration.test.ts
```

**Coverage:**
- ✅ Real Kind 30041 events (exodus_3_16_30041.json, john_3_16_30041.json, etc.)
- ✅ Real Kind 1 Bible events (john_3_16_kind1.json, exodus_3_16_kind1.json, etc.)
- ✅ Real Kind 1 reference events (should NOT be detected as Bible events)
- ✅ Real Kind 30818 wiki events (should NOT be detected as Bible events)
- ✅ Real Kind 30023 article events (should NOT be detected as Bible events)
- ✅ Version fallback testing with multiple John 3:16 versions
- ✅ Deuterocanonical books (Douay-Rheims Bible)
- ✅ Wikilink parsing with real test data

### Run All Tests
```bash
npm test test/bible*.test.ts
```
