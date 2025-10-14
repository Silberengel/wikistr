# Wikistr - Biblestr Edition Test Summary

## Test Coverage Overview

The test suite covers all core functionality with **129 tests** across **7 test files**, achieving **100% test success rate**.

## Test Files

### Unit Tests (`test/bible.test.ts`)
Comprehensive tests covering all book functionality:
- **Book Notation Parsing**: Single verses, chapters, books, ranges
- **Wikilink Parsing**: With/without versions, explicit book: prefix
- **Event Detection**: Kind 30041, Kind 1 with book tags, exclusions
- **Metadata Extraction**: All book tag fields
- **Title Generation**: Verses, chapters, books with versions
- **Search Queries**: Proper query generation for all reference types
- **Abbreviations**: Standard abbreviation support
- **Multi-format Support**: Bible, Quran, Catechism

### Integration Tests (`test/bible-integration.test.ts`)
Real-world integration testing with actual event data:
- **Kind 30041 Events**: Bible verse events with proper tags
- **Kind 1 Events**: Bible note events with book tags
- **Event Detection**: Proper identification of book events
- **Metadata Extraction**: Real event data processing
- **Version Fallback**: Multiple version handling
- **Deuterocanonical Books**: Catholic Bible support
- **Wikilink Integration**: Article-to-book linking

### Multiple References Tests (`test/multiple-references.test.ts`)
Complex reference parsing and handling:
- **Semicolon Separation**: Multiple references in one query
- **Version Handling**: Individual and global version specification
- **Pipe Separation**: Version comparison syntax
- **Mixed Formats**: Various notation styles
- **Real-world Scenarios**: Daily readings, version comparisons

### Multi-Verse Integration Tests (`test/multi-verse-integration.test.ts`)
Advanced multi-reference functionality:
- **Cross-book References**: Different books in one query
- **Version Comparison**: Multiple versions across references
- **Event Matching**: Complex query matching
- **Metadata Processing**: Bulk metadata extraction
- **Search Query Generation**: Multi-reference query creation

### Diff Tests (`test/diff.test.ts`)
Content comparison functionality:
- **Query Parsing**: Pipe and semicolon separation
- **Content Type Detection**: Book vs wiki content
- **Version Comparison**: Side-by-side version display
- **Multiple Item Comparison**: Three or more items
- **Mixed Content**: Books and articles together

### Diff Integration Tests (`test/diff-integration.test.ts`)
Real-world diff scenarios:
- **Book Version Diffs**: Bible version comparisons
- **Wiki Article Diffs**: Article revision comparisons
- **Mixed Content Diffs**: Books vs articles
- **Complex Scenarios**: Multi-paragraph comparisons

### Search-Diff Integration Tests (`test/search-diff-integration.test.ts`)
Search and diff system integration:
- **Search Routing**: Proper routing to diff functionality
- **Query Processing**: Search-to-diff query conversion
- **Result Display**: Integrated search and diff results

## Test Data

### Book Events (Kind 30041)
- `exodus_3_16_30041.json` - Exodus 3:16 (KJV)
- `john_3_16_30041.json` - John 3:16 (KJV)
- `john_3_16_niv_30041.json` - John 3:16 (NIV)
- `psalm_23_1_30041.json` - Psalm 23:1 (KJV)
- `psalm_19_2_30041.json` - Psalm 19:2 (KJV)
- `romans_1_16_30041.json` - Romans 1:16 (KJV)
- `revelation_11_15_30041.json` - Revelation 11:15 (DRB)
- `genesis_1_1_30041.json` - Genesis 1:1 (KJV)
- `luke_11_37_30041.json` - Luke 11:37 (KJV)
- `version_fallback_test_30041.json` - Version fallback test

### Book Notes (Kind 1)
- `john_3_16_kind1.json` - John 3:16 note (KJV)
- `john_3_16_niv_kind1.json` - John 3:16 note (NIV)
- `exodus_3_16_kind1.json` - Exodus 3:16 note (KJV)
- `psalm_23_1_kind1.json` - Psalm 23:1 note (KJV)
- `psalm_19_2_kind1.json` - Psalm 19:2 note (KJV)
- `romans_1_16_kind1.json` - Romans 1:16 note (KJV)
- `revelation_11_15_kind1.json` - Revelation 11:15 note (DRB)

### Non-Book Events (Control Data)
- `bible_verse_note_kind1.json` - Bible reference note (not a book event)
- `exodus_verse_note_kind1.json` - Exodus reference note (not a book event)
- `bible_study_wiki_30818.json` - Bible study wiki article
- `bible_versions_wiki_30818.json` - Bible versions wiki article
- `bible_study_guide_30818.json` - Bible study guide wiki
- `bible_article_30023.json` - Bible article (Kind 30023)

### Chapter Events
- `exodus_chapter.json` - Exodus chapter (Kind 30041)
- `john._chapter.json` - John chapter (Kind 30041)

## Test Results

### Current Status
- **Total Tests**: 129
- **Passing**: 129 (100%)
- **Failing**: 0 (0%)
- **Test Files**: 7
- **Coverage**: All core functionality

### Test Categories
1. **Unit Tests**: 24 tests - Core function testing
2. **Integration Tests**: 21 tests - Real data integration
3. **Multiple References**: 19 tests - Complex parsing
4. **Multi-Verse Integration**: 18 tests - Advanced functionality
5. **Diff Tests**: 21 tests - Comparison functionality
6. **Diff Integration**: 12 tests - Real-world diff scenarios
7. **Search-Diff Integration**: 14 tests - System integration

## Key Test Scenarios

### Book Notation Parsing
- Single verses: `John 3:16`
- Chapters: `John 3`
- Books: `John`
- Ranges: `Romans 1:16-25`
- Multiple verses: `John 3:16,18`
- Multiple references: `John 3:16; Romans 1:16; Psalm 23:1`

### Version Handling
- Single versions: `John 3:16 | KJV`
- Multiple versions: `John 3:16 | KJV NIV`
- Version fallback: Automatic fallback when requested version not found
- Version comparison: Side-by-side version display

### Event Detection
- Kind 30041 events with proper book tags
- Kind 1 events with book tags
- Exclusion of non-book events
- Proper metadata extraction

### Search Query Generation
- Proper query format: `type:bible book:john chapter:3 verse:16 version:kjv`
- Version handling in queries
- Multiple reference queries
- Fallback query generation

### Wikilink Integration
- Basic wikilinks: `[[book:bible:John 3:16]]`
- Version specification: `[[book:bible:John 3:16 | KJV]]`
- Display text: `[[book:bible:John 3:16 | The Famous Verse | KJV]]`
- Multiple formats: Bible, Quran, Catechism

### Diff Functionality
- Version comparisons: `diff::John 3:16 KJV | NIV`
- Article comparisons: `diff::article1 | article2`
- Multiple item comparisons: `diff::item1; item2; item3`
- Mixed content comparisons: Books vs articles

## Test Maintenance

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test bible.test.ts

# Run tests with UI
npm run test:ui

# Run tests in watch mode
npm test -- --watch
```

### Test Data Updates
When adding new book types or features:
1. Update test data files with new tag formats
2. Add new test cases for new functionality
3. Update test expectations for changed behavior
4. Ensure backward compatibility tests pass

### Test Coverage
The test suite covers:
- All public API functions
- All supported book types
- All notation formats
- All version handling scenarios
- All diff functionality
- All integration points
- Error handling and edge cases

## Continuous Integration

Tests are designed to run in CI/CD environments:
- No external dependencies
- Deterministic results
- Fast execution
- Clear error reporting
- Comprehensive coverage

The test suite ensures that all core functionality works correctly and that changes don't break existing features.