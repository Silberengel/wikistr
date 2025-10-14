# WikiStr Test Summary

## Test Files Created

### Unit Tests (`test/bible.test.ts`)
Comprehensive tests covering all Bible functionality:
- **Bible Notation Parsing**: Single verses, chapters, books, ranges
- **Wikilink Parsing**: With/without versions, explicit bible: prefix
- **Event Detection**: Kind 30041, Kind 1 with Bible tags, exclusions
- **Metadata Extraction**: All Bible tag fields
- **Title Generation**: Verses, chapters, books with versions
- **Search Queries**: Proper query generation for all reference types
- **Abbreviations**: Turabian standard support
- **Deuterocanonical Books**: Catholic Bible book support

### Test Events

#### Kind 30041 (Bible Verses - Replaceable)
- `exodus_3_16_30041.json` - Exodus 3:16 (KJV)
- `john_3_16_30041.json` - John 3:16 (KJV)
- `john_3_16_niv_30041.json` - John 3:16 (NIV)
- `version_fallback_test_30041.json` - John 3:16 (ESV)
- `revelation_11_15_30041.json` - Revelation 11:15 (DRB)
- `psalm_23_1_30041.json` - Psalm 23:1 (KJV)

#### Kind 1 (Bible Verses - Regular Notes)
- `john_3_16_kind1.json` - John 3:16 (KJV)
- `john_3_16_niv_kind1.json` - John 3:16 (NIV)
- `exodus_3_16_kind1.json` - Exodus 3:16 (KJV)
- `psalm_23_1_kind1.json` - Psalm 23:1 (KJV)
- `revelation_11_15_kind1.json` - Revelation 11:15 (DRB)

#### Kind 1 (Reference Notes)
- `bible_verse_note_kind1.json` - References John 3:16 with "e" tag
- `exodus_verse_note_kind1.json` - References Exodus 3:16 with "e" tag

#### Kind 30023 (Long-form Articles)
- `bible_article_30023.json` - Article with "a" tag Bible reference

#### Kind 30818 (Wiki Pages)
- `bible_study_wiki_30818.json` - Wiki about Bible study
- `bible_versions_wiki_30818.json` - Wiki comparing versions
- `bible_study_guide_30818.json` - Wiki with [[wikilink]] references

#### Chapter Events
- `exodus_chapter.json` - Full Exodus Chapter 3
- `john._chapter.json` - Full Revelation Chapter 11

## Key Test Scenarios

### 1. Event Type Detection
- ✅ Kind 30041 with Bible tags → Bible page
- ✅ Kind 1 with Bible tags → Bible page
- ✅ Kind 1 with "e" tags only → Regular note
- ✅ Kind 30818 → Wiki page (not Bible page)

### 2. Version Support
- ✅ Multiple versions of John 3:16 (KJV, NIV, ESV)
- ✅ Version-specific search: `[[John 3:16 | KJV]]`
- ✅ All versions search: `[[John 3:16]]`
- ✅ Version fallback when not found

### 3. Reference Types
- ✅ Single verse: `[[John 3:16]]`
- ✅ Chapter: `[[John 3]]`
- ✅ Book: `[[John]]`
- ✅ Verse range: `[[John 3:16-18]]`
- ✅ Multiple verses: `[[John 3:16,18]]`

### 4. Abbreviations
- ✅ Turabian standard (Gen, Exod, Ps, Rev, etc.)
- ✅ Deuterocanonical books (Tob, Sir, Macc, etc.)

## Running Tests

```bash
npm test bible.test.ts
```

## Expected Behavior

### Bible Search
1. Parse Bible notation correctly
2. Detect Bible events by tags (not kind)
3. Match events to search queries
4. Display results with proper titles
5. Handle version fallback gracefully

### Wiki Integration
- [[wikilink]] format works for Bible references
- bible: prefix recommended to avoid false positives
- Proper rendering in Asciidoc content
- Integration with existing card system

## Diff Functionality Tests

### Unit Tests (`test/diff.test.ts`)
Comprehensive tests covering diff functionality:
- **Diff Query Parsing**: Bible, wiki, and mixed content detection
- **Query Syntax**: Pipe separation, semicolon separation, single items
- **Edge Cases**: Special characters, whitespace, unicode, long texts
- **Content Type Detection**: Automatic Bible vs wiki detection

### Integration Tests (`test/diff-integration.test.ts`)
Tests using mock events and real-world scenarios:
- **Bible Version Comparisons**: KJV vs NIV, ESV vs DRB
- **Wiki Article Comparisons**: Article revisions, related content
- **Mixed Content**: Bible vs wiki comparisons
- **Real-world Scenarios**: Complex multi-paragraph diffs

### Search Integration Tests (`test/search-diff-integration.test.ts`)
Tests for diff integration with search system:
- **Query Detection**: Proper routing of diff vs regular queries
- **Search Help Integration**: Appropriate help text for different query types
- **Multi-tier Search**: Diff queries don't interfere with regular search
- **WOT Priority**: Diff doesn't apply WOT priority (content comparison focus)
- **Error Handling**: Graceful handling of malformed queries

## Test Coverage Summary

### Total Tests: 129 tests across 7 test files
- ✅ **Bible Tests**: 24 unit tests + 21 integration tests + 19 multiple references + 18 multi-verse integration = 82 tests
- ✅ **Diff Tests**: 21 unit tests + 12 integration tests + 14 search integration = 47 tests
- ✅ **All tests passing** with comprehensive coverage

### Key Test Scenarios Covered

#### Bible Functionality
- ✅ Event type detection (Kind 30041, Kind 1 with Bible tags)
- ✅ Version support and fallback mechanisms
- ✅ Reference types (single verse, chapter, book, ranges)
- ✅ Abbreviation support (Turabian standard)
- ✅ Deuterocanonical books (Catholic Bibles)
- ✅ Flexible case and whitespace handling

#### Diff Functionality
- ✅ Bible version comparisons (KJV vs NIV, etc.)
- ✅ Wiki article comparisons (revisions, related content)
- ✅ Mixed content comparisons (Bible vs wiki)
- ✅ Multiple item comparisons (3+ items)
- ✅ Query parsing and content type detection
- ✅ Search system integration

#### Search System
- ✅ Multi-tier search (d-tag, title, summary, full-text)
- ✅ WOT prioritization (trusted authors first)
- ✅ Diff query routing and detection
- ✅ Help text integration
- ✅ Error handling and edge cases

## Running All Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test bible.test.ts
npm test diff.test.ts
npm test diff-integration.test.ts
npm test search-diff-integration.test.ts

# Run tests with UI
npm run test:ui
```

## Expected Behavior

### Bible Search
1. Parse Bible notation correctly
2. Detect Bible events by tags (not kind)
3. Match events to search queries
4. Display results with proper titles
5. Handle version fallback gracefully

### Diff Functionality
1. Parse diff queries correctly
2. Detect content types automatically
3. Generate meaningful line-by-line diffs
4. Display changes with proper highlighting
5. Integrate seamlessly with search system

### Wiki Integration
- [[wikilink]] format works for Bible references
- bible: prefix recommended to avoid false positives
- Proper rendering in Asciidoc content
- Integration with existing card system
