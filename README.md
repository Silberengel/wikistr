# Wikistr - Biblestr Edition

A decentralized wiki and book study system built on Nostr. Supports traditional wiki articles and comprehensive book study functionality with powerful diff capabilities for ANY structured text - religious texts, academic works, legal documents, literature, and more.

## Features

### Multi-Tier Search System
- **d-tag search** (exact identifier match)
- **title search** (title tag matches)
- **summary search** (summary tag matches)
- **full-text search** (content search)
- **WOT prioritization** (results from trusted authors appear first)

### Generic Book System
- **Universal support** for ANY structured text (Bible, Quran, Catechism, Torah, academic textbooks, legal codes, literature, etc.)
- **Flexible notation** (case-insensitive, whitespace-tolerant)
- **Version support** with fallback mechanisms
- **Book wikilinks** in wiki articles
- **Cross-reference search** capabilities
- **Easy customization** - add your own book types with custom notation and versions

### Diff Functionality
- **Version comparison** (different translations/versions)
- **Wiki article comparison** (revisions, related content)
- **Mixed content comparison** (books vs wiki articles)
- **Line-by-line diff display** with highlighted changes
- **Multiple item comparison** support

### Wiki System
- **Nostr-based** decentralized wiki
- **Asciidoc support** for rich formatting
- **Wikilink system** with book integration
- **User-friendly editing** interface

## Quick Start

### Search
- **Wiki articles**: Use the main search bar
- **Book passages**: Use `book:type:reference` or book wikilinks
- **Diff comparison**: Use `diff::content1 | content2` in main search

### Book Search Examples

**Bible:**
```
book:bible:John 3:16
book:bible:John 3:16 | KJV
book:bible:Psalm 23:1
book:bible:Romans 1:16-25 | KJV DRB
```

**Quran:**
```
book:quran:Al-Fatiha 1-7
book:quran:Al-Baqarah 2:255 | SAHIH
book:quran:Al-Mulk 67:1-5
```

**Catechism:**
```
book:catechism:Article 1:1
book:catechism:Article 2558 | CCC
book:catechism:Part 1, Section 2, Chapter 3
```

### Book Wikilinks in Articles

**Bible:**
```asciidoc
The most famous verse is [[book:bible:John 3:16 | KJV]].

For the full chapter, see [[book:bible:John 3 | KJV]].

Multiple verses: [[book:bible:John 3:16,18 | KJV]]
```

**Quran:**
```asciidoc
The opening chapter is [[book:quran:Al-Fatiha 1-7 | SAHIH]].

For the throne verse, see [[book:quran:Al-Baqarah 2:255 | SAHIH]].
```

**Catechism:**
```asciidoc
The first article states [[book:catechism:Article 1:1 | CCC]].

For the creed, see [[book:catechism:Article 185-197 | CCC]].
```

### Diff Examples
```
diff::John 3:16 KJV | NIV
diff::Al-Fatiha SAHIH | PICKTHAL
diff::Article 1:1 CCC | CCC-EN
diff::article1 | article2
diff::article1; article2; article3
```

## Supported Book Types

The system is completely generic and can support ANY structured text. Here are the pre-configured examples:

### Bible
- **Versions**: KJV, NKJV, NIV, ESV, NASB, NLT, MSG, CEV, NRSV, RSV, ASV, YLT, WEB, GNV, DRB
- **Books**: All 66 canonical books plus Deuterocanonical books
- **Notation**: `Book Chapter:Verse` (e.g., `John 3:16`, `Romans 1:16-25`)

### Quran
- **Versions**: SAHIH, PICKTHAL, YUSUFALI, SHAKIR, MUHD, HILALI
- **Surahs**: All 114 surahs
- **Notation**: `SurahName Chapter:Verses` (e.g., `Al-Fatiha 1-7`, `Al-Baqarah 2:255`)

### Catechism
- **Versions**: CCC (Catechism of the Catholic Church), CCC-EN
- **Structure**: Parts, Sections, Chapters, Articles
- **Notation**: `Article Number:Section` (e.g., `Article 1:1`, `Article 2558`)

### Adding Your Own Book Types

You can easily add support for any structured text by configuring it in the system:

- **Religious texts**: Torah, Bhagavad Gita, Tao Te Ching, etc.
- **Academic works**: Textbooks, research papers, study guides
- **Legal documents**: Law codes, regulations, case studies
- **Literature**: Poetry collections, anthologies, series
- **Reference works**: Encyclopedias, dictionaries, manuals

See the [Book Search Guide](BOOK_SEARCH_GUIDE.md) for detailed instructions on adding custom book types.

## Themes and Customization

### Light Theme (Biblestr)
```bash
npm run dev -- --theme=biblestr
```
- Clean, academic design
- Optimized for Bible study
- High contrast for readability
- Traditional typography

### Dark Theme (Wikistr)
```bash
npm run dev -- --theme=wikistr
```
- Modern, minimalist design
- Optimized for general wiki use
- Dark mode for reduced eye strain
- Contemporary interface

### Custom Themes
Create your own theme by modifying `src/lib/themes.ts`:

```typescript
export const customTheme = {
  name: 'Custom Theme',
  colors: {
    primary: '#your-color',
    secondary: '#your-color',
    // ... other theme properties
  },
  fonts: {
    heading: 'Your Font',
    body: 'Your Font',
  }
};
```

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
git clone git@github.com:Silberengel/wikistr.git
cd wikistr
npm install
```

### Development Server
```bash
# Light theme (Biblestr)
npm run dev -- --theme=biblestr

# Dark theme (Wikistr)
npm run dev -- --theme=wikistr

# Default theme
npm run dev
```

### Testing
```bash
# Run all tests
npm test

# Run specific test suites
npm test bible.test.ts
npm test diff.test.ts

# Run tests with UI
npm run test:ui
```

### Building
```bash
npm run build
```

## Architecture

### Search System
- Multi-tier search with prioritized results
- WOT integration for trusted content prioritization
- Diff routing for content comparison
- Generic book search integration

### Book System
- Event detection (Kind 30041, Kind 1 with book tags)
- Metadata extraction (book, chapter, verse, version)
- Notation parsing (flexible case and whitespace)
- Version handling with fallback mechanisms

### Diff System
- Query parsing (pipe and semicolon separation)
- Content type detection (books vs wiki)
- Line-by-line comparison algorithm
- Visual diff display with highlighting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## Author

**Silberengel**
- GitHub: [@Silberengel](https://github.com/Silberengel/)
- Nostr: [npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z](https://jumble.imwald.eu/users/npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions and support:
- Check the [Troubleshooting Guide](TROUBLESHOOTING.md)
- Review the [Book Search Guide](BOOK_SEARCH_GUIDE.md)
- Consult the [Diff Guide](DIFF_GUIDE.md)
- Contact the author via GitHub or Nostr

---

## Acknowledgments

**Wikistr - Biblestr Edition** is a [Gitcitadel](https://jumble.imwald.eu/users/npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz) fork of [WikiStr](https://github.com/fiatjaf/wikistr) by [fiatjaf](https://jumble.imwald.eu/users/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6), enhanced with specialized book study functionality and Alexandria-inspired design. We thank Fiatjaf for inspiring this application, providing assistance in understanding Nostr wikis, and explaining how best to use markup for advanced documentation.

We thank [mleku](https://jumble.imwald.eu/users/npub1fjqqy4a93z5zsjwsfxqhc2764kvykfdyttvldkkkdera8dr78vhsmmleku) for providing the biblestr domain, encouraging our efforts, and helping us develop an appropriate relay for storing and serving the books.

We would also like to thank the many Christian and Muslim Nostriches, who have been very patient, generous, and supportive, awaiting the creation of this project.