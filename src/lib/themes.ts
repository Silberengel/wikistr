export type ThemeType = 'wikistr' | 'biblestr';

export interface ThemeConfig {
  name: string;
  title: string;
  tagline: string;
  description: string;
  brandColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  highlightColor: string;
  relays: string[];
  showBibleLinks: boolean;
  searchHelpText: string;
  typography: {
    fontFamily: string;
    fontFamilyHeading: string;
    fontFamilyMono: string;
    fontSize: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
      '4xl': string;
      '5xl': string;
      '6xl': string;
    };
  };
  styling: {
    headerStyle: string;
    buttonStyle: string;
    cardStyle: string;
    inputStyle: string;
  };
}

export const themes: Record<ThemeType, ThemeConfig> = {
  wikistr: {
    name: 'wikistr',
    title: 'Wikistr',
    tagline: 'READ. WRITE. CONNECT.',
    description: 'A decentralized wiki system built on Nostr',
    brandColor: '#9333ea', // Purple
    backgroundColor: '#0f172a', // Very dark blue-gray (like VS Code)
    textColor: '#f8fafc', // Very light gray
    accentColor: '#3b82f6', // Blue
    highlightColor: '#ef4444', // Red
    relays: [
      'wss://relay.wikifreedia.xyz',
      'wss://nostr.wine',
      'wss://nostr21.com',
      'wss://relay.nostr.band',
      'wss://thecitadel.nostr1.com',
      'wss://orly-relay.imwald.eu',
      'wss://nostr.land'
    ],
    showBibleLinks: false,
    searchHelpText: `Search for articles by title, content, or author. Use "author:pubkey" to find articles by a specific author.

**Book Search Examples:**
• book:bible:John 3:16
• book:quran:Al-Fatiha:1-7  
• book:catechism:CCC 1
• book:torah:Genesis 1:1

**Adding New Book Types:**
Publish a NIP-78 event with app="Wikistr" and type="book-config" to add new book types. The system will automatically load and make them available for searching.

**Compare content with diff:**
• diff::article1 | article2
• diff::book:bible:John 3:16 KJV | NIV
• diff::article1; article2; article3
• diff::book:bible:John 3:16 KJV | ESV

Use <code>diff::</code> prefix to compare wiki articles, book versions, or any content. Supports pipe <code>|</code> and semicolon <code>;</code> separation.`,
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontFamilyHeading: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontFamilyMono: '"SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
        '6xl': '3.75rem'
      }
    },
    styling: {
      headerStyle: 'font-semibold tracking-tight',
      buttonStyle: 'font-medium transition-all duration-200 hover:scale-105',
      cardStyle: 'border border-gray-700 bg-gray-800 rounded-lg shadow-lg',
      inputStyle: 'border border-gray-600 bg-gray-800 text-gray-100 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent'
    }
  },
  biblestr: {
    name: 'biblestr',
    title: 'Biblestr',
    tagline: 'READ THE ORIGINAL. MAKE CONNECTIONS. CULTIVATE KNOWLEDGE.',
    description: 'A decentralized Bible study and wiki system built on Nostr',
    brandColor: '#059669', // Green
    backgroundColor: '#fefefe', // Light background
    textColor: '#1a1a1a', // Very dark text for better contrast
    accentColor: '#d97706', // Orange
    highlightColor: '#b91c1c', // Darker burgundy for better contrast
    relays: [
      'wss://relay.wikifreedia.xyz',
      'wss://nostr.wine',
      'wss://nostr21.com',
      'wss://relay.nostr.band',
      'wss://thecitadel.nostr1.com',
      'wss://orly-relay.imwald.eu',
      'wss://nostr.land'
    ],
    showBibleLinks: true,
    searchHelpText: `Search for articles by title, content, or author. Use "author:pubkey" to find articles by a specific author.

**Bible Search Examples:**
• John 3:16 (full book name)
• Jn 3:16 (abbreviated)
• john3:16 (no spaces, case insensitive)
• Romans 1:16-25 (verse ranges)
• Psalm 23:1, 3-5 (multiple verses)
• John 3:16 KJV (with version)
• Romans 1:16-25; Psalm 19:2-3 (multiple references)

**Common Bible Abbreviations:**
• Gen, Exod, Lev, Num, Deut (Pentateuch)
• Josh, Judg, Ruth, 1 Sam, 2 Sam, 1 Kgs, 2 Kgs (Historical)
• 1 Chr, 2 Chr, Ezra, Neh, Esth (Chronicles)
• Job, Ps, Prov, Eccl, Song (Wisdom/Poetry)
• Isa, Jer, Lam, Ezek, Dan (Major Prophets)
• Hos, Joel, Amos, Obad, Jonah, Mic, Nah, Hab, Zeph, Hag, Zech, Mal (Minor Prophets)
• Matt, Mk, Lk, Jn (Gospels)
• Acts, Rom, 1 Cor, 2 Cor, Gal, Eph, Phil, Col, 1 Thess, 2 Thess, 1 Tim, 2 Tim, Tit, Phlm (Pauline)
• Heb, Jas, 1 Pet, 2 Pet, 1 Jn, 2 Jn, 3 Jn, Jude, Rev (General/Catholic)

**Bible Versions:**
KJV, NIV, ESV, NASB, NRSV, DRB, RSV, NLT, MSG, AMP, TLB, NKJV, ASV, YLT, WEB, NET, CSB, NAB, NJB, CEV, GNT, NIRV, BSB, LSB, MEV, NLV, TPT, AMPC, CJB, DARBY, ERV, EXB, GNV, GW, ICB, ISV, JUB, KJV21, LEB, MOUNCE, NABRE, NCV, NIRV, NLV, NRSV, OJB, RGT, TLV, TPT, VOICE, WYC, YLT98

**Compare content with diff:**
• diff::article1 | article2
• diff::book:bible:John 3:16 KJV | NIV
• diff::article1; article2; article3
• diff::book:bible:John 3:16 KJV | ESV

Use <code>diff::</code> prefix to compare wiki articles, Bible versions, or any content. Supports pipe <code>|</code> and semicolon <code>;</code> separation.`,
    typography: {
      fontFamily: '"Crimson Text", "Times New Roman", "Times", "Georgia", serif',
      fontFamilyHeading: '"Crimson Text", "Times New Roman", "Times", "Georgia", serif',
      fontFamilyMono: '"Courier New", "Courier", "Liberation Mono", monospace',
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1.125rem', // Slightly larger for readability
        lg: '1.25rem',
        xl: '1.375rem',
        '2xl': '1.625rem',
        '3xl': '2rem',
        '4xl': '2.5rem',
        '5xl': '3.25rem',
        '6xl': '4rem'
      }
    },
    styling: {
      headerStyle: 'font-serif font-normal tracking-wide',
      buttonStyle: 'font-serif transition-all duration-300 hover:shadow-lg',
      cardStyle: 'border border-amber-200 bg-amber-50 rounded-none shadow-md',
      inputStyle: 'border border-amber-300 rounded-none focus:ring-2 focus:ring-green-600 focus:border-transparent bg-amber-50'
    }
  }
};

// Get theme from environment variable, default to 'wikistr'
export function getCurrentTheme(): ThemeType {
  // Check for injected theme variable (set at build time)
  if (typeof __THEME__ !== 'undefined') {
    const theme = __THEME__ as ThemeType;
    return theme && theme in themes ? theme : 'wikistr';
  }
  
  // Default fallback - theme is injected at build time via vite config
  return 'wikistr';
}

export function getThemeConfig(theme?: ThemeType): ThemeConfig {
  const currentTheme = theme || getCurrentTheme();
  return themes[currentTheme];
}
