# NIP-78 Book Configuration for Wikistr

This document explains how to configure additional books in Wikistr using NIP-78 events.

## Overview

Wikistr now supports dynamic book configurations through NIP-78 events (kind 30078). This allows users to publish custom book configurations that will be automatically loaded by Wikistr clients.

## NIP-78 Event Structure

### Event Kind
- **Kind**: `30078` (NIP-78: Arbitrary custom app data)
- **d-tag**: `wikistr-book-config` (or any identifier)
- **Content**: JSON configuration (see below)

### Event Tags
```
[
  ["d", "wikistr-book-config"],
  ["app", "Wikistr"],
  ["type", "book-config"],
  ["name", "your-book-type"]
]
```

## Configuration Format

The event content should be a JSON object with the following structure:

```json
{
  "app": "Wikistr",
  "type": "book-config",
  "name": "torah",
  "displayName": "Torah",
  "books": {
    "Genesis": ["Gen", "Ge", "Gn"],
    "Exodus": ["Exod", "Ex", "Exo"],
    "Leviticus": ["Lev", "Le", "Lv"],
    "Numbers": ["Num", "Nu", "Nm", "Nb"],
    "Deuteronomy": ["Deut", "De", "Dt"]
  },
  "versions": {
    "JPS": "Jewish Publication Society",
    "TANAKH": "Tanakh",
    "HEBREW": "Hebrew Text",
    "SEPTUAGINT": "Septuagint"
  },
  "parsingRules": {
    "bookPattern": "^(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy)\\s+\\d+(?::\\d+)?(?:\\s*[-,]\\s*\\d+)*$",
    "chapterPattern": "^\\d+$",
    "versePattern": "^\\d+(?:[-,\\s]\\d+)*$",
    "versionPattern": "^(JPS|TANAKH|HEBREW|SEPTUAGINT)$"
  },
  "displayFormat": {
    "bookChapterVerse": "default",
    "withVersion": "default"
  }
}
```

### Required Fields

- **app**: Must be "Wikistr"
- **type**: Must be "book-config"
- **name**: Unique identifier for the book type (e.g., "torah", "quran", "catechism")
- **displayName**: Human-readable name for the book type
- **books**: Object mapping full book names to arrays of abbreviations
- **versions**: Object mapping version abbreviations to full names

### Optional Fields

- **parsingRules**: Custom regex patterns for parsing references
- **displayFormat**: Custom formatting functions (currently only "default" supported)

## How It Works

1. **Publishing**: Users publish NIP-78 events with book configurations
2. **Loading**: Wikistr automatically loads these configurations on startup
3. **Integration**: Custom book types are integrated with the existing book system
4. **Search**: Users can search for references using the new book types

## Usage Examples

### Torah References
```
/torah:Genesis 1:1
/torah:Exodus 3:16 | JPS
/torah:Leviticus 19:18 | TANAKH
```

### Wiki Links
```
[[torah:Genesis 1:1 | JPS]]
[[torah:Exodus 3:16]]
[[torah:Leviticus 19:18 | TANAKH]]
```

## Built-in Book Types

Wikistr comes with several built-in book types:

- **bible**: Bible (Old and New Testament)
- **quran**: Quran (114 surahs)
- **catechism**: Catechism of the Catholic Church

## Custom Book Types

You can add any book type by publishing a NIP-78 event. Examples:

- **torah**: Torah (first 5 books of the Bible)
- **hadith**: Islamic hadith collections
- **dhammapada**: Buddhist texts
- **gita**: Bhagavad Gita
- **tao**: Tao Te Ching

## Publishing a Book Configuration

### Using a Nostr Client

1. Create a NIP-78 event with kind 30078
2. Set the d-tag to "wikistr-book-config"
3. Add the required tags: app, type, name
4. Set the content to your JSON configuration
5. Sign and publish the event

### Example Event

```json
{
  "kind": 30078,
  "content": "{\"app\":\"Wikistr\",\"type\":\"book-config\",\"name\":\"torah\",\"displayName\":\"Torah\",\"books\":{\"Genesis\":[\"Gen\",\"Ge\",\"Gn\"],\"Exodus\":[\"Exod\",\"Ex\",\"Exo\"]},\"versions\":{\"JPS\":\"Jewish Publication Society\"}}",
  "tags": [
    ["d", "wikistr-book-config"],
    ["app", "Wikistr"],
    ["type", "book-config"],
    ["name", "torah"]
  ],
  "created_at": 1700000000,
  "pubkey": "your-pubkey",
  "id": "event-id",
  "sig": "signature"
}
```

## Loading and Refresh

- **Automatic Loading**: Book configurations are loaded automatically on startup
- **Manual Refresh**: Use the "🔄 Refresh Books" button on the search page
- **Real-time Updates**: New configurations are loaded when you refresh

## Technical Details

### File Structure
- `src/lib/nip78.ts`: NIP-78 event handling
- `src/lib/bookConfig.ts`: Centralized book configuration management
- `src/lib/books.ts`: Book parsing and display functions

### Integration Points
- Search functionality uses the centralized book configuration
- Book parsing functions support dynamic book types
- Display functions work with custom book types

## Troubleshooting

### Configuration Not Loading
1. Check that the event has the correct kind (30078)
2. Verify the d-tag is "wikistr-book-config"
3. Ensure the JSON content is valid
4. Check that required fields are present

### Parsing Issues
1. Verify regex patterns in parsingRules
2. Check that book names and abbreviations match
3. Ensure version patterns are correct

### Display Issues
1. Check that displayFormat is set to "default"
2. Verify book and version names are properly formatted

## Future Enhancements

- Custom display format functions
- Advanced parsing rules
- Book metadata (author, year, etc.)
- Book relationships and cross-references
- User-specific book configurations
- Book configuration validation
- Configuration versioning and updates
