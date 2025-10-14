# Diff Guide for WikiStr

WikiStr includes powerful diff functionality that allows you to compare Bible versions, wiki articles, and other content side-by-side with highlighted differences.

## Overview

The diff functionality is accessible through the main search bar using the `diff::` prefix. It automatically detects the type of content being compared and provides appropriate comparison tools.

## How to Use Diff

### Basic Syntax

Use the `diff::` prefix in the main search bar:

```
diff::content1 | content2
```

### Query Types

#### 1. Bible Version Comparisons
Compare different Bible versions of the same passage:

```
diff::John 3:16 KJV | NIV
diff::bible:Romans 1:16 KJV | ESV
diff::Psalm 23:1 KJV | DRB
diff::Genesis 1:1 KJV | NIV
```

#### 2. Wiki Article Comparisons
Compare different wiki articles or versions:

```
diff::article1 | article2
diff::wiki-page | another-page
diff::article1; article2; article3
```

#### 3. Mixed Content Comparisons
Compare Bible content with wiki articles:

```
diff::bible:John 3:16 KJV | gospel-explanation
diff::article1 | John 3:16 NIV
```

## Diff Query Syntax

### Pipe Separation (Most Common)
```
diff::left-content | right-content
```

**Examples:**
- `diff::John 3:16 KJV | NIV`
- `diff::article1 | article2`
- `diff::bible:Romans 1:16 KJV | ESV`

### Semicolon Separation (Multiple Items)
```
diff::item1; item2; item3
```

**Examples:**
- `diff::article1; article2; article3`
- `diff::version1; version2; version3`

### Single Item (Self-Comparison)
```
diff::single-item
```

**Examples:**
- `diff::article1`
- `diff::John 3:16 KJV`

## Content Type Detection

The system automatically detects content types:

### Bible Content Detection
Content is treated as Bible when:
- Query starts with `bible:`
- Query contains Bible version abbreviations (KJV, NIV, ESV, DRB, etc.)

### Wiki Content Detection
Content is treated as wiki when:
- No Bible indicators are present
- Content appears to be article identifiers or titles

## Diff Display Features

### Visual Comparison
- **Side-by-side view** for easy comparison
- **Line-by-line comparison** with highlighted differences
- **Line numbers** for easy reference
- **Color coding** for different change types

### Change Types
- **Added content** (green highlighting)
- **Removed content** (red highlighting)
- **Modified content** (highlighted differences)
- **Common content** (normal text)

### Navigation
- **Scroll synchronization** between compared content
- **Responsive design** for different screen sizes
- **Keyboard navigation** support

## Examples

### Bible Version Comparisons

#### John 3:16 - KJV vs NIV
```
diff::John 3:16 KJV | NIV
```

**KJV:** "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."

**NIV:** "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life."

**Differences highlighted:**
- "that he gave his only begotten Son" vs "that he gave his one and only Son"
- "whosoever believeth" vs "whoever believes"
- "everlasting life" vs "eternal life"

#### Romans 1:16 - Multiple Versions
```
diff::Romans 1:16 KJV | NIV | ESV
```

Shows differences between King James, New International, and English Standard versions.

### Wiki Article Comparisons

#### Article Revisions
```
diff::article-v1 | article-v2
```

Shows changes between different versions of the same article.

#### Related Articles
```
diff::gospel-explanation | salvation-doctrine
```

Compares two related wiki articles on similar topics.

### Mixed Content Comparisons

#### Bible vs Commentary
```
diff::bible:John 3:16 KJV | john-commentary
```

Compares a Bible verse with a wiki article providing commentary.

#### Multiple Content Types
```
diff::bible:Romans 1:16 KJV; gospel-summary; salvation-article
```

Compares a Bible verse with multiple wiki articles.

## Best Practices

### 1. Use Specific Identifiers
```
✅ Good: diff::John 3:16 KJV | NIV
❌ Avoid: diff::John 3:16 | NIV
```

### 2. Compare Similar Content Types
```
✅ Good: diff::article1 | article2
✅ Good: diff::John 3:16 KJV | NIV
❌ Avoid: diff::John 3:16 KJV | random-article
```

### 3. Use Clear Version Specifications
```
✅ Good: diff::John 3:16 KJV | NIV
✅ Good: diff::bible:Romans 1:16 KJV | ESV
❌ Avoid: diff::John 3:16 | NIV
```

### 4. Use the Main Search Bar
```
✅ Correct: Use main search bar with diff:: prefix
❌ Incorrect: Don't use Bible search (/bible:) for diff queries
```

## Advanced Usage

### Multiple Item Comparisons
```
diff::item1; item2; item3; item4
```

Shows progressive changes between multiple items.

### Complex Bible References
```
diff::bible:John 3:16-18 KJV | NIV
diff::bible:Romans 1:16-25 KJV | ESV
```

Compare verse ranges between versions.

### Article Series Comparisons
```
diff::part1; part2; part3
```

Compare different parts of a series or tutorial.

## Troubleshooting

### "No content found for comparison"
- Check spelling of article identifiers
- Ensure Bible references use correct format
- Verify version abbreviations are correct

### "Content type not detected"
- Use explicit `bible:` prefix for Bible content
- Ensure version abbreviations are present for Bible detection
- Check that wiki articles exist

### "Diff display issues"
- Try refreshing the page
- Check that both content items loaded successfully
- Ensure content is not empty

### "Search not working"
- Use main search bar (not Bible search)
- Ensure `diff::` prefix is present
- Check query syntax (pipe `|` or semicolon `;` separation)

## Integration with Other Features

### Wiki Search Integration
- Diff queries are automatically detected and routed
- Regular search continues to work normally
- No interference between diff and regular search

### Bible Search Integration
- Bible diff queries can reference Bible search results
- Bible search continues to work independently
- Cross-referencing between systems is supported

### Multi-tier Search
- Diff queries bypass multi-tier search (not needed for content comparison)
- WOT prioritization doesn't apply to diff (content comparison focus)
- Search performance is optimized for diff operations

## Technical Details

### Diff Algorithm
- **Line-by-line comparison** for accurate results
- **Change detection** for additions, deletions, and modifications
- **Context preservation** for meaningful comparisons
- **Performance optimization** for large content

### Content Fetching
- **Parallel loading** of compared content
- **Error handling** for missing content
- **Caching** for improved performance
- **Fallback mechanisms** for failed loads

### Display Rendering
- **Responsive design** for all screen sizes
- **Accessibility support** with proper ARIA labels
- **Keyboard navigation** for all interactive elements
- **Color contrast** compliance for readability

This diff functionality provides a powerful tool for studying differences between Bible versions, comparing wiki articles, and analyzing content changes in WikiStr.
