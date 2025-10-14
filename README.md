# Biblestr

Biblestr is a decentralized Bible study and wiki system built on Nostr that supports both traditional wiki articles and comprehensive Bible study functionality with powerful diff capabilities.

## Features

### 🔍 **Multi-Tier Search System**
- **d-tag search** (exact identifier match)
- **title search** (title tag matches)
- **summary search** (summary tag matches)
- **full-text search** (content search)
- **WOT prioritization** (results from trusted authors appear first)

### 📖 **Bible Functionality**
- **Bible event support** (Kind 30041 and Kind 1 with Bible tags)
- **Multiple Bible versions** (KJV, NIV, ESV, DRB, etc.)
- **Flexible notation** (case-insensitive, whitespace-tolerant)
- **Bible wikilinks** in wiki articles
- **Version fallback** (shows all versions if requested version not found)

### 🔄 **Diff Functionality**
- **Bible version comparison** (KJV vs NIV, etc.)
- **Wiki article comparison** (article revisions, related content)
- **Mixed content comparison** (Bible vs wiki articles)
- **Line-by-line diff display** with highlighted changes
- **Multiple item comparison** support

### 📝 **Wiki System**
- **Nostr-based** decentralized wiki
- **Asciidoc support** for rich formatting
- **Wikilink system** with Bible integration
- **User-friendly editing** interface

## Quick Start

### Search
- **Wiki articles**: Use the main search bar
- **Bible passages**: Use `/bible:John 3:16` or Bible wikilinks
- **Diff comparison**: Use `diff::content1 | content2` in main search

### Bible Search Examples
```
/bible:John 3:16
/bible:John 3:16 | KJV
/bible:Psalm 23:1
/bible:Romans 1:16-25 | KJV DRB
```

### Bible Wikilinks in Articles
```asciidoc
The most famous verse is [[bible:John 3:16 | KJV]].

For the full chapter, see [[bible:John 3 | KJV]].

Multiple verses: [[bible:John 3:16,18 | KJV]]
```

### Diff Examples
```
diff::John 3:16 KJV | NIV
diff::article1 | article2
diff::bible:Romans 1:16 KJV | ESV
diff::article1; article2; article3
```

## Documentation

- **[Bible Search Guide](BIBLE_SEARCH_GUIDE.md)** - Complete guide to Bible functionality
- **[Diff Guide](DIFF_GUIDE.md)** - Comprehensive diff functionality documentation
- **[Bible Functionality](BIBLE_FUNCTIONALITY.md)** - Technical details about Bible implementation
- **[Deployment Guide](DEPLOYMENT-GUIDE.md)** - How to deploy WikiStr
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues and solutions

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

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
git clone <repository-url>
cd wikistr
npm install
```

### Development Server
```bash
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
- **Multi-tier search** with prioritized results
- **WOT integration** for trusted content prioritization
- **Diff routing** for content comparison
- **Bible search** integration

### Bible System
- **Event detection** (Kind 30041, Kind 1 with Bible tags)
- **Metadata extraction** (book, chapter, verse, version)
- **Notation parsing** (flexible case and whitespace)
- **Version handling** with fallback mechanisms

### Diff System
- **Query parsing** (pipe and semicolon separation)
- **Content type detection** (Bible vs wiki)
- **Line-by-line comparison** algorithm
- **Visual diff display** with highlighting

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
- Review the [Bible Search Guide](BIBLE_SEARCH_GUIDE.md)
- Consult the [Diff Guide](DIFF_GUIDE.md)
- Contact the author via GitHub or Nostr

---

## Acknowledgments

**Biblestr** is a [Gitcitadel](https://jumble.imwald.eu/users/npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz) fork of [WikiStr](https://github.com/fiatjaf/wikistr) by [fiatjaf](https://jumble.imwald.eu/users/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6), enhanced with specialized Bible functionality and Alexandria-inspired design. We thank Fiatjaf for inspiring this application, providing assistance in understanding Nostr wikis, and explaining how best to use markup for advanced documentation.

We thank [mleku](https://jumble.imwald.eu/users/npub1fjqqy4a93z5zsjwsfxqhc2764kvykfdyttvldkkkdera8dr78vhsmmleku) for providing the biblestr domain, encouraging our efforst, and helping us develop an appropriate relay for storing and serving-up the Bibles.

We would also like to thank the many Christian Nostriches, who have been very patient, generous, and supportive, awaiting the creation of this project. ✝