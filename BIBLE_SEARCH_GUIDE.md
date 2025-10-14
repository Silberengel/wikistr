# Bible Search Guide for WikiStr

This guide explains how to search for Bible events and use Bible wikilinks in WikiStr.

## How Bible Search Works

WikiStr has **two separate search systems**:

1. **Wiki Search** (main search bar) - Searches for wiki articles only
2. **Bible Search** (dedicated Bible functionality) - Searches for Bible events

### Wiki Search vs Bible Search

| Search Type | What It Searches | How to Access | URL Format |
|-------------|------------------|---------------|------------|
| **Wiki Search** | Wiki articles (Kind 30818) | Main search bar | `/search-term` |
| **Bible Search** | Bible events (Kind 30041, Kind 1 with Bible tags) | Bible wikilinks or direct URL | `/bible:search-term` |

## Searching for Bible Events

### Method 1: Direct URL Search
Navigate directly to Bible search URLs:

```
/bible:John 3:16
/bible:John 3:16 | KJV
/bible:Exodus 3:16
/bible:Psalm 23:1
/bible:Revelation 11:15 | DRB
```

### Method 2: Bible Wikilinks in Documents
Use Bible wikilinks in wiki articles and other content:

```asciidoc
The most famous verse is [[John 3:16 | KJV]].

For the full chapter, see [[John 3 | KJV]].

Multiple verses: [[John 3:16,18 | KJV]]

Verse range: [[John 3:16-18 | KJV]]

Explicit Bible prefix (recommended): [[bible:John 3:16 | KJV]]
```

## Bible Wikilink Syntax

### Basic Format
```
[[Bible Reference | Version]]
```

### Examples

#### Single Verse
```asciidoc
[[John 3:16 | KJV]]
[[John 3:16 | NIV]]
[[John 3:16]]  // All versions
```

#### Chapter
```asciidoc
[[John 3 | KJV]]     // Entire chapter
[[John 3]]           // All versions of chapter
```

#### Book
```asciidoc
[[John | KJV]]       // Entire book
[[John]]             // All versions of book
```

#### Verse Ranges
```asciidoc
[[John 3:16-18 | KJV]]     // Verse range
[[John 3:16,18,20 | KJV]]  // Multiple specific verses
```

#### Multiple References
```asciidoc
[[John 1–3; 3:16; 6:14, 44 | KJV]]
[[Romans 1:16-25; Psalm 19:2-3 | KJV]]
[[Romans 1:16-25 KJV; Romans 1:16-25 DRB]]
```

### Explicit Bible Prefix (Recommended)
To avoid false positives with names like "John Smith":

```asciidoc
[[bible:John 3:16 | KJV]]
[[bible:Genesis 1:1]]
[[bible:Psalm 23:1 | KJV]]
```

### Flexible Case and Whitespace
The system handles various case and whitespace patterns automatically:

```asciidoc
[[bible:John 3:16]]        // Normal spacing
[[bible:john 3:16]]        // Lowercase book name
[[bible:JOHN 3:16]]        // Uppercase book name
[[bible:jOhN 3:16]]        // Mixed case book name
[[bible:John3:16]]         // No space between book and chapter
[[bible:  John  3:16  ]]   // Extra spaces
[[bible:john3:16 | kjv]]   // Lowercase + no space + version
[[bible:  JOHN  3:16  |  KJV  ]]  // Uppercase + extra spaces + version
```

All of these work identically!

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

## Bible Book Abbreviations

### Old Testament
Genesis (Gen), Exodus (Exod), Leviticus (Lev), Numbers (Num), Deuteronomy (Deut), Joshua (Josh), Judges (Judg), Ruth (Ruth), 1 Samuel (1 Sam), 2 Samuel (2 Sam), 1 Kings (1 Kgs), 2 Kings (2 Kgs), 1 Chronicles (1 Chr), 2 Chronicles (2 Chr), Ezra (Ezra), Nehemiah (Neh), Esther (Esth), Job (Job), Psalms (Ps), Proverbs (Prov), Ecclesiastes (Eccl), Song of Solomon (Song), Isaiah (Isa), Jeremiah (Jer), Lamentations (Lam), Ezekiel (Ezek), Daniel (Dan), Hosea (Hos), Joel (Joel), Amos (Amos), Obadiah (Obad), Jonah (Jonah), Micah (Mic), Nahum (Nah), Habakkuk (Hab), Zephaniah (Zeph), Haggai (Hag), Zechariah (Zech), Malachi (Mal)

### New Testament
Matthew (Matt), Mark (Mk), Luke (Lk), John (Jn), Acts (Acts), Romans (Rom), 1 Corinthians (1 Cor), 2 Corinthians (2 Cor), Galatians (Gal), Ephesians (Eph), Philippians (Phil), Colossians (Col), 1 Thessalonians (1 Thess), 2 Thessalonians (2 Thess), 1 Timothy (1 Tim), 2 Timothy (2 Tim), Titus (Titus), Philemon (Phlm), Hebrews (Heb), James (Jas), 1 Peter (1 Pet), 2 Peter (2 Pet), 1 John (1 John), 2 John (2 John), 3 John (3 John), Jude (Jude), Revelation (Rev)

### Deuterocanonical Books (Catholic Bibles)
Tobit (Tob), Judith (Jdt), Wisdom (Wis), Sirach (Sir), Baruch (Bar), 1 Maccabees (1 Macc), 2 Maccabees (2 Macc), 1 Esdras (1 Esd), 2 Esdras (2 Esd), Prayer of Manasseh (Pr Man), 3 Maccabees (3 Macc), 4 Maccabees (4 Macc), Psalm 151 (Ps 151), Additions to Esther (Add Esth), Additions to Daniel (Add Dan), Bel and the Dragon (Bel), Susanna (Sus), Prayer of Azariah (Pr Azar), Song of the Three Young Men (Song Three)

## Version Fallback Behavior

### When Version is Specified
- `[[John 3:16 | KJV]]` → Shows only KJV version
- `[[John 3:16 | XYZ]]` → Shows warning + all available versions

### When No Version is Specified
- `[[John 3:16]]` → Shows all available versions
- `[[bible:John 3:16]]` → Shows all available versions

## Best Practices

### 1. Use Explicit Bible Prefix
```asciidoc
// ✅ Recommended - avoids false positives
[[bible:John 3:16 | KJV]]

// ⚠️ May match "John Smith" in some contexts
[[John 3:16 | KJV]]
```

### 2. Specify Versions When Needed
```asciidoc
// ✅ Clear version specification
[[bible:John 3:16 | KJV]]

// ✅ All versions when comparing
[[bible:John 3:16]]
```

### 3. Use Appropriate Abbreviations
```asciidoc
// ✅ Standard abbreviations
[[bible:Gen 1:1 | KJV]]
[[bible:Ps 23:1 | KJV]]
[[bible:Rev 11:15 | DRB]]

// ✅ Full names also work
[[bible:Genesis 1:1 | KJV]]
[[bible:Psalms 23:1 | KJV]]
[[bible:Revelation 11:15 | DRB]]
```

### 4. Complex References
```asciidoc
// ✅ Multiple references
[[bible:John 1–3; 3:16; 6:14, 44 | KJV]]

// ✅ Verse ranges
[[bible:John 3:16-18 | KJV]]

// ✅ Multiple specific verses
[[bible:John 3:16,18,20 | KJV]]
```

## What Gets Searched

### Bible Events (Found by Bible Search)
- **Kind 30041** events with Bible tags
- **Kind 1** events with Bible tags (people have published Bible as regular notes)

### Not Bible Events (Found by Wiki Search)
- **Kind 30818** wiki events (even if they mention Bible topics)
- **Kind 1** events that only reference Bible events with "e" tags
- **Kind 30023** long-form articles

## Troubleshooting

### "No Bible passages found"
- Check spelling of book name
- Try using abbreviations (Gen, Exod, Ps, etc.)
- Try without version specification
- Ensure you're using Bible search (`/bible:`) not wiki search

### "Version not found"
- The system will automatically show all available versions
- Check the version abbreviation (KJV, NIV, ESV, etc.)
- Some versions may not be available for all passages

### False Positives
- Use `bible:` prefix to avoid matching names like "John Smith"
- Be specific with book names and abbreviations

### Case and Whitespace Issues
- The system automatically handles various case and whitespace patterns
- `john3:16` works the same as `John 3:16`
- `JOHN 3:16` works the same as `john 3:16`
- Extra spaces are normalized automatically
- Book names and versions are case-insensitive
- If you're having issues, try the explicit `bible:` prefix format

## Examples in Practice

### In a Wiki Article
```asciidoc
= Bible Study: Key Verses

== The Gospel Message

The foundation of Christian faith is found in [[bible:John 3:16 | KJV]].

Case and spacing are flexible:
- [[bible:john 3:16 | kjv]] (lowercase)
- [[bible:JOHN 3:16 | KJV]] (uppercase)  
- [[bible:jOhN 3:16 | KjV]] (mixed case)
- [[bible:john3:16 | kjv]] (no spaces)

== God's Care

[[bible:Psalm 23:1 | KJV]] expresses God's care for His people.

== The Exodus

[[bible:Exodus 3:16 | KJV]] shows God's instruction to Moses.

== End Times

[[bible:Revelation 11:15 | DRB]] announces the coming kingdom.
```

### Direct Search URLs
```
/bible:John 3:16
/bible:John 3:16 | KJV
/bible:Psalm 23:1
/bible:Genesis 1:1 | KJV
/bible:Revelation 11:15 | DRB
```

## Comparing Bible Versions with Diff

WikiStr includes powerful diff functionality to compare different Bible versions, wiki articles, and other content.

### How to Use Diff

Use the `diff::` prefix in the main search bar to compare content:

#### Bible Version Comparisons
```
diff::John 3:16 KJV | NIV
diff::bible:Romans 1:16 KJV | ESV
diff::Psalm 23:1 KJV | DRB
diff::Genesis 1:1 KJV | NIV
```

#### Wiki Article Comparisons
```
diff::article1 | article2
diff::wiki-page | another-page
diff::article1; article2; article3
```

#### Mixed Content Comparisons
```
diff::bible:John 3:16 KJV | wiki-article
diff::article1 | John 3:16 NIV
```

### Diff Query Syntax

#### Pipe Separation (Most Common)
```
diff::left-content | right-content
```

#### Semicolon Separation (Multiple Items)
```
diff::item1; item2; item3
```

#### Bible-Specific Detection
The system automatically detects Bible content when:
- Query starts with `bible:`
- Query contains Bible version abbreviations (KJV, NIV, ESV, etc.)

### Diff Display Features

- **Line-by-line comparison** with highlighted differences
- **Change types**: Added, removed, modified content
- **Line numbers** for easy reference
- **Side-by-side view** for easy comparison
- **Color coding**: Green for additions, red for deletions

### Examples

#### Comparing Bible Versions
```
diff::John 3:16 KJV | NIV
```
Shows the differences between King James and New International versions of John 3:16.

#### Comparing Multiple Articles
```
diff::article1; article2; article3
```
Compares three different articles, showing changes between each.

#### Comparing Bible and Wiki Content
```
diff::bible:John 3:16 KJV | gospel-explanation
```
Compares a Bible verse with a wiki article explaining the gospel.

### Best Practices for Diff

1. **Use specific versions** for Bible comparisons
2. **Use clear identifiers** for wiki articles
3. **Compare similar content types** for meaningful results
4. **Use the main search bar** (not Bible search) for diff queries

This system allows you to seamlessly integrate Bible references into your wiki content while maintaining clear separation between wiki articles and Bible events, and provides powerful comparison tools for studying differences between versions and articles.
