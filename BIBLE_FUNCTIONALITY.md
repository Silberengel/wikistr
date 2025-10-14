# Bible Functionality for WikiStr

WikiStr now supports Bible passages using Nostr events, allowing users to search, embed, and display Bible content with full version support and fallback handling.

## Quick Start

### Basic Usage
```asciidoc
// Simple Bible reference
The famous verse [[John 3:16 | KJV]].

// Multiple references
See [[John 1–3; 3:16; 6:14, 44 | KJV]].

// Explicit Bible prefix (recommended)
[[bible:John 3:16 | KJV]]
```

### Direct Search
- `/bible:John 3:16` - Search all versions
- `/bible:John 3:16 | KJV` - Search specific version

## Bible Event Structure

Bible events use any kind number with these tags:
```json
{
  "kind": 30041,
  "content": "For God so loved the world...",
  "tags": [
    ["type", "bible"],
    ["bible-book", "John"],
    ["bible-chapter", "3"],
    ["bible-verses", "16"],
    ["bible-version", "KJV"],
    ["d", "john-3-16-kjv"]
  ]
}
```

## Supported Bible Versions

| Abbreviation | Full Name |
|-------------|-----------|
| KJV | King James Version |
| NKJV | New King James Version |
| NIV | New International Version |
| ESV | English Standard Version |
| NASB | New American Standard Bible |
| NLT | New Living Translation |
| MSG | The Message |
| CEV | Contemporary English Version |
| NRSV | New Revised Standard Version |
| RSV | Revised Standard Version |
| ASV | American Standard Version |
| YLT | Young's Literal Translation |
| WEB | World English Bible |
| GNV | 1599 Geneva Bible |
| DRB | Douay-Rheims Bible (includes Deuterocanonical books) |

## Version Handling

- **With version**: Shows only that version
- **Without version**: Shows all available versions
- **Version not found**: Shows warning + all available versions as fallback

## Bible Book Abbreviations

### Old Testament
Genesis (Gen), Exodus (Exod), Leviticus (Lev), Numbers (Num), Deuteronomy (Deut), Joshua (Josh), Judges (Judg), Ruth (Ruth), 1 Samuel (1 Sam), 2 Samuel (2 Sam), 1 Kings (1 Kgs), 2 Kings (2 Kgs), 1 Chronicles (1 Chr), 2 Chronicles (2 Chr), Ezra (Ezra), Nehemiah (Neh), Esther (Esth), Job (Job), Psalms (Ps), Proverbs (Prov), Ecclesiastes (Eccl), Song of Solomon (Song), Isaiah (Isa), Jeremiah (Jer), Lamentations (Lam), Ezekiel (Ezek), Daniel (Dan), Hosea (Hos), Joel (Joel), Amos (Amos), Obadiah (Obad), Jonah (Jonah), Micah (Mic), Nahum (Nah), Habakkuk (Hab), Zephaniah (Zeph), Haggai (Hag), Zechariah (Zech), Malachi (Mal)

### New Testament
Matthew (Matt), Mark (Mk), Luke (Lk), John (Jn), Acts (Acts), Romans (Rom), 1 Corinthians (1 Cor), 2 Corinthians (2 Cor), Galatians (Gal), Ephesians (Eph), Philippians (Phil), Colossians (Col), 1 Thessalonians (1 Thess), 2 Thessalonians (2 Thess), 1 Timothy (1 Tim), 2 Timothy (2 Tim), Titus (Titus), Philemon (Phlm), Hebrews (Heb), James (Jas), 1 Peter (1 Pet), 2 Peter (2 Pet), 1 John (1 John), 2 John (2 John), 3 John (3 John), Jude (Jude), Revelation (Rev)

### Deuterocanonical Books (Catholic Bibles)
Tobit (Tob), Judith (Jdt), Wisdom (Wis), Sirach (Sir), Baruch (Bar), 1 Maccabees (1 Macc), 2 Maccabees (2 Macc), 1 Esdras (1 Esd), 2 Esdras (2 Esd), Prayer of Manasseh (Pr Man), 3 Maccabees (3 Macc), 4 Maccabees (4 Macc), Psalm 151 (Ps 151), Additions to Esther (Add Esth), Additions to Daniel (Add Dan), Bel and the Dragon (Bel), Susanna (Sus), Prayer of Azariah (Pr Azar), Song of the Three Young Men (Song Three)

## Examples

### Wiki Pages
```asciidoc
The most famous Bible verse is [[John 3:16 | KJV]].

For broader context, see [[John 1–3; 3:16; 6:14, 44 | KJV]].

// Deuterocanonical books (Catholic Bibles)
The wisdom of Sirach says [[Sirach 1:1 | DRB]].
The Maccabees fought for religious freedom [[1 Maccabees 1:1 | DRB]].
```

### Search Scenarios
- `[[John 3:16]]` → Shows all versions (KJV, NIV, ESV, etc.)
- `[[John 3:16 | KJV]]` → Shows only KJV version
- `[[John 3:16 | XYZ]]` → Shows warning + all available versions

## Technical Implementation

### Key Files
- `src/lib/bible.ts` - Core Bible utilities and parsing
- `src/components/BibleSearch.svelte` - Search component
- `src/components/BibleDisplay.svelte` - Display component
- `src/cards/Bible.svelte` - Bible card component

### Key Functions
- `parseBibleWikilink()` - Parses Bible wikilink notation
- `parseBibleNotation()` - Parses Bible reference strings
- `isBibleEvent()` - Detects Bible events by tags
- `extractBibleMetadata()` - Extracts Bible metadata from events
- `generateBibleTitle()` - Creates display titles

### Event Detection
Bible events are identified by having any of these tags:
- `type: bible`
- `bible-book`
- `bible-chapter`
- `bible-version`

The system is kind-agnostic and works with any Nostr event that has Bible-specific tags.

## Features

- ✅ Full Bible book abbreviation support (Turabian standard)
- ✅ Multiple Bible version support
- ✅ Version fallback handling
- ✅ Complex reference parsing (multiple chapters/verses)
- ✅ Deuterocanonical book support (Catholic Bibles)
- ✅ Automatic Bible reference detection
- ✅ Explicit Bible prefix support
- ✅ Search and display functionality
- ✅ Integration with existing wiki system