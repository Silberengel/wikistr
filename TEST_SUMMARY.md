# Bible Functionality Test Summary

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
