# Book Search Guide

Complete guide to the generic book search functionality in Wikistr - Biblestr Edition.

## Overview

The book system is completely generic and supports ANY structured text with standardized tags and flexible notation. While Bible, Quran, and Catechism are provided as examples, you can use this system with:

- **Religious texts**: Bible, Quran, Torah, Bhagavad Gita, etc.
- **Academic works**: Textbooks, research papers, study guides
- **Legal documents**: Law codes, regulations, case studies
- **Literature**: Poetry collections, anthologies, series
- **Reference works**: Encyclopedias, dictionaries, manuals
- **Any structured content** that can be organized into books, chapters, and sections

The system uses a flexible configuration approach that allows you to define your own book types, notation styles, and version systems.

## Adding Custom Book Types

To add support for your own book type, you need to configure it in the system. Here's how:

### 1. Define Book Configuration

Edit `src/lib/books.ts` and add your book type to the `BOOK_CONFIGS` object:

```typescript
export const BOOK_CONFIGS = {
  // ... existing configurations
  'your-book-type': {
    name: 'Your Book Type',
    books: {
      'Book 1': 'Book 1',
      'Book 2': 'Book 2',
      // ... your books
    },
    abbreviations: {
      'B1': 'Book 1',
      'B2': 'Book 2',
      // ... your abbreviations
    },
    versions: {
      'VERSION1': 'Version 1 Name',
      'VERSION2': 'Version 2 Name',
      // ... your versions
    },
    parsingPatterns: [
      /^(.+?)\s+(\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/, // Book Chapter:Section
      /^(.+?)\s+(\d+)$/, // Book Chapter
      /^(.+?)$/, // Book only
    ]
  }
};
```

### 2. Create Book Events

Your Nostr events should use these standardized tags:

```json
{
  "kind": 30041,
  "tags": [
    ["type", "your-book-type"],
    ["book", "Book Name"],
    ["chapter", "Chapter Number"],
    ["section", "Section Number"],
    ["version", "Version Name"]
  ],
  "content": "Your book content here"
}
```

### 3. Search Your Books

Once configured, you can search your custom book type:

```
book:your-book-type:Book 1:2:5
book:your-book-type:Book 1:2:5 | VERSION1
```

### 4. Use in Wiki Articles

Embed references in wiki articles:

```asciidoc
See [[book:your-book-type:Book 1:2:5 | VERSION1]] for details.

The reference states [[book:your-book-type:Book 1:2:5 | Book 1, Chapter 2, Section 5 | VERSION1]].
```

### Example: Adding Torah Support

Here's how you could add Torah support:

```typescript
'torah': {
  name: 'Torah',
  books: {
    'Genesis': 'Genesis',
    'Exodus': 'Exodus',
    'Leviticus': 'Leviticus',
    'Numbers': 'Numbers',
    'Deuteronomy': 'Deuteronomy'
  },
  abbreviations: {
    'Gen': 'Genesis',
    'Exod': 'Exodus',
    'Lev': 'Leviticus',
    'Num': 'Numbers',
    'Deut': 'Deuteronomy'
  },
  versions: {
    'MT': 'Masoretic Text',
    'LXX': 'Septuagint',
    'TARGUM': 'Targum'
  },
  parsingPatterns: [
    /^(.+?)\s+(\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/, // Book Chapter:Verse
    /^(.+?)\s+(\d+)$/, // Book Chapter
    /^(.+?)$/, // Book only
  ]
}
```

Then you could search:
```
book:torah:Genesis 1:1
book:torah:Genesis 1:1 | MT
book:torah:Exodus 20:1-17 | MT LXX
```

### Example: Adding Academic Textbook Support

```typescript
'textbook': {
  name: 'Academic Textbook',
  books: {
    'Introduction to Physics': 'Introduction to Physics',
    'Advanced Mathematics': 'Advanced Mathematics',
    'Organic Chemistry': 'Organic Chemistry'
  },
  abbreviations: {
    'Intro Physics': 'Introduction to Physics',
    'Adv Math': 'Advanced Mathematics',
    'Org Chem': 'Organic Chemistry'
  },
  versions: {
    '1ST': 'First Edition',
    '2ND': 'Second Edition',
    '3RD': 'Third Edition'
  },
  parsingPatterns: [
    /^(.+?)\s+(\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/, // Book Chapter:Section
    /^(.+?)\s+(\d+)$/, // Book Chapter
    /^(.+?)$/, // Book only
  ]
}
```

Then you could search:
```
book:textbook:Introduction to Physics:5:2
book:textbook:Advanced Mathematics:3:1-5 | 2ND
```

## Pre-configured Book Types

### Bible
- **Type**: `bible`
- **Structure**: Book → Chapter → Verse
- **Notation**: `Book Chapter:Verse`
- **Versions**: KJV, NKJV, NIV, ESV, NASB, NLT, MSG, CEV, NRSV, RSV, ASV, YLT, WEB, GNV, DRB

### Quran
- **Type**: `quran`
- **Structure**: Surah → Chapter → Verses
- **Notation**: `SurahName Chapter:Verses`
- **Versions**: SAHIH, PICKTHAL, YUSUFALI, SHAKIR, MUHD, HILALI

### Catechism
- **Type**: `catechism`
- **Structure**: Article → Section → Subsection
- **Notation**: `Article Number:Section`
- **Versions**: CCC (Catechism of the Catholic Church), CCC-EN

## Search Syntax

### Basic Format
```
book:type:reference
```

### With Version
```
book:type:reference | version
```

### Multiple Versions
```
book:type:reference | version1 version2
```

## Examples by Book Type

### Bible Examples

**Single verse:**
```
book:bible:John 3:16
book:bible:John 3:16 | KJV
```

**Chapter:**
```
book:bible:John 3
book:bible:John 3 | KJV
```

**Verse range:**
```
book:bible:John 3:16-18
book:bible:Romans 1:16-25 | KJV
```

**Multiple verses:**
```
book:bible:John 3:16,18
book:bible:Psalm 23:1,3,5 | KJV
```

**Multiple references:**
```
book:bible:John 3:16; Romans 1:16; Psalm 23:1
book:bible:John 3:16; Romans 1:16; Psalm 23:1 | KJV
```

**Version comparison:**
```
book:bible:John 3:16 | KJV NIV
book:bible:Romans 1:16-25 | KJV DRB
```

### Quran Examples

**Single verse:**
```
book:quran:Al-Fatiha 1:1
book:quran:Al-Fatiha 1:1 | SAHIH
```

**Verse range:**
```
book:quran:Al-Fatiha 1:1-7
book:quran:Al-Baqarah 2:255 | SAHIH
```

**Multiple verses:**
```
book:quran:Al-Fatiha 1:1,3,5
book:quran:Al-Mulk 67:1,3,5 | SAHIH
```

**Multiple references:**
```
book:quran:Al-Fatiha 1:1-7; Al-Baqarah 2:255; Al-Mulk 67:1-5
book:quran:Al-Fatiha 1:1-7; Al-Baqarah 2:255; Al-Mulk 67:1-5 | SAHIH
```

**Version comparison:**
```
book:quran:Al-Fatiha 1:1-7 | SAHIH PICKTHAL
book:quran:Al-Baqarah 2:255 | SAHIH YUSUFALI
```

### Catechism Examples

**Single article:**
```
book:catechism:Article 1:1
book:catechism:Article 1:1 | CCC
```

**Article range:**
```
book:catechism:Article 1:1-3
book:catechism:Article 2558-2560 | CCC
```

**Multiple articles:**
```
book:catechism:Article 1:1; Article 2:1; Article 3:1
book:catechism:Article 1:1; Article 2:1; Article 3:1 | CCC
```

**Version comparison:**
```
book:catechism:Article 1:1 | CCC CCC-EN
book:catechism:Article 2558 | CCC CCC-EN
```

## Wikilinks in Articles

Book references can be embedded in wiki articles using wikilink syntax:

### Basic Wikilink
```asciidoc
[[book:type:reference]]
```

### With Display Text
```asciidoc
[[book:type:reference | display text]]
```

### With Version
```asciidoc
[[book:type:reference | version]]
[[book:type:reference | display text | version]]
```

## Examples in Articles

### Bible in Articles
```asciidoc
The most famous verse is [[book:bible:John 3:16 | KJV]].

For the full chapter, see [[book:bible:John 3 | KJV]].

Multiple verses: [[book:bible:John 3:16,18 | KJV]]

The love chapter is [[book:bible:1 Corinthians 13 | 1 Corinthians 13 | KJV]].
```

### Quran in Articles
```asciidoc
The opening chapter is [[book:quran:Al-Fatiha 1:1-7 | SAHIH]].

For the throne verse, see [[book:quran:Al-Baqarah 2:255 | SAHIH]].

Multiple verses: [[book:quran:Al-Fatiha 1:1,3,5 | SAHIH]]

The opening is [[book:quran:Al-Fatiha 1:1-7 | The Opening | SAHIH]].
```

### Catechism in Articles
```asciidoc
The first article states [[book:catechism:Article 1:1 | CCC]].

For the creed, see [[book:catechism:Article 185-197 | CCC]].

Multiple articles: [[book:catechism:Article 1:1; Article 2:1 | CCC]]

The creed is [[book:catechism:Article 185-197 | The Apostles' Creed | CCC]].
```

## Advanced Features

### Version Fallback
If a requested version is not found, the system will:
1. Show all available versions
2. Allow selection of alternative versions
3. Display version comparison options

### Case Insensitive
All searches are case-insensitive:
```
book:bible:john 3:16
book:bible:JOHN 3:16
book:bible:John 3:16
```

### Whitespace Tolerant
Extra whitespace is ignored:
```
book:bible:John   3:16
book:bible:John 3 : 16
book:bible:  John 3:16  |
```

### Flexible Notation
Different notation styles are supported:

**Bible:**
- `John 3:16`
- `Jn 3:16`
- `John 3`
- `John`

**Quran:**
- `Al-Fatiha 1:1-7`
- `Al-Fatiha 1`
- `Al-Fatiha`

**Catechism:**
- `Article 1:1`
- `Article 1`
- `Article`

## Nostr Event Structure

Book events use standardized Nostr tags:

```
[
  ["type", "bible"],
  ["book", "John"],
  ["chapter", "3"],
  ["verse", "16"],
  ["version", "King James Version"]
]
```

## Troubleshooting

### Common Issues

**No results found:**
- Check spelling and notation
- Verify version availability
- Try without version specification

**Wrong version displayed:**
- Use version fallback
- Check available versions
- Verify event tags

**Wikilinks not working:**
- Check syntax format
- Verify book type support
- Test direct search first

### Supported Abbreviations

**Bible Books:**
- Gen, Exod, Lev, Num, Deut, Josh, Judg, Ruth
- 1 Sam, 2 Sam, 1 Kgs, 2 Kgs, 1 Chr, 2 Chr
- Ezra, Neh, Esth, Job, Ps, Prov, Eccl, Song
- Isa, Jer, Lam, Ezek, Dan, Hos, Joel, Amos
- Obad, Jonah, Mic, Nah, Hab, Zeph, Hag, Zech, Mal
- Matt, Mk, Lk, Jn, Acts, Rom, 1 Cor, 2 Cor, Gal, Eph
- Phil, Col, 1 Thess, 2 Thess, 1 Tim, 2 Tim, Titus, Phlm
- Heb, Jas, 1 Pet, 2 Pet, 1 John, 2 John, 3 John, Jude, Rev

**Quran Surahs:**
- Al-Fatiha, Al-Baqarah, Ali 'Imran, An-Nisa, Al-Ma'idah
- Al-An'am, Al-A'raf, Al-Anfal, At-Tawbah, Yunus
- Hud, Yusuf, Ar-Ra'd, Ibrahim, Al-Hijr, An-Nahl
- Al-Isra, Al-Kahf, Maryam, Ta-Ha, Al-Anbiya, Al-Hajj
- Al-Mu'minun, An-Nur, Al-Furqan, Ash-Shu'ara, An-Naml
- Al-Qasas, Al-'Ankabut, Ar-Rum, Luqman, As-Sajdah
- Al-Ahzab, Saba, Fatir, Ya-Sin, As-Saffat, Sad
- Az-Zumar, Ghafir, Fussilat, Ash-Shura, Az-Zukhruf
- Ad-Dukhan, Al-Jathiyah, Al-Ahqaf, Muhammad, Al-Fath
- Al-Hujurat, Qaf, Adh-Dhariyat, At-Tur, An-Najm
- Al-Qamar, Ar-Rahman, Al-Waqi'ah, Al-Hadid, Al-Mujadilah
- Al-Hashr, Al-Mumtahanah, As-Saff, Al-Jumu'ah, Al-Munafiqun
- At-Taghabun, At-Talaq, At-Tahrim, Al-Mulk, Al-Qalam
- Al-Haqqah, Al-Ma'arij, Nuh, Al-Jinn, Al-Muzzammil
- Al-Muddaththir, Al-Qiyamah, Al-Insan, Al-Mursalat, An-Naba
- An-Nazi'at, 'Abasa, At-Takwir, Al-Infitar, Al-Mutaffifin
- Al-Inshiqaq, Al-Buruj, At-Tariq, Al-A'la, Al-Ghashiyah
- Al-Fajr, Al-Balad, Ash-Shams, Al-Layl, Ad-Duha, Ash-Sharh
- At-Tin, Al-'Alaq, Al-Qadr, Al-Bayyinah, Az-Zalzalah
- Al-'Adiyat, Al-Qari'ah, At-Takathur, Al-'Asr, Al-Humazah
- Al-Fil, Quraysh, Al-Ma'un, Al-Kawthar, Al-Kafirun
- An-Nasr, Al-Masad, Al-Ikhlas, Al-Falaq, An-Nas

## API Reference

### Search Functions
- `parseBookNotation(notation, bookType)` - Parse book reference notation
- `generateBookSearchQuery(references, bookType, version, versions)` - Generate search queries
- `isBookEvent(event, bookType)` - Check if event is a book event
- `extractBookMetadata(event)` - Extract metadata from book event

### Utility Functions
- `formatBookReference(reference, bookType)` - Format reference for display
- `generateBookTitle(metadata)` - Generate human-readable title
- `matchesBookQuery(event, query, bookType)` - Check if event matches query
