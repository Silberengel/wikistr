/**
 * Bible functionality for WikiStr
 * Supports searching, parsing, and displaying Bible passages using Nostr events
 */

export interface BibleReference {
  book: string;
  chapter?: number;
  verses?: string; // Can be "1", "1-3", "1,3,5", etc.
  version?: string;
}

export interface BibleEvent {
  id: string;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
  kind: number;
  sig: string;
}

// ============================================================================
// BIBLE BOOK ABBREVIATIONS (Turabian Standard)
// ============================================================================

export const BIBLE_BOOKS = {
  // Old Testament
  'Genesis': ['Gen', 'Ge', 'Gn'],
  'Exodus': ['Exod', 'Ex', 'Exo'],
  'Leviticus': ['Lev', 'Le', 'Lv'],
  'Numbers': ['Num', 'Nu', 'Nm', 'Nb'],
  'Deuteronomy': ['Deut', 'De', 'Dt'],
  'Joshua': ['Josh', 'Jos', 'Jsh'],
  'Judges': ['Judg', 'Jg', 'Jdgs'],
  'Ruth': ['Ruth', 'Ru', 'Rth'],
  '1 Samuel': ['1 Sam', '1 Sa', '1S', 'I Sa', 'I Sam', '1Sam', '1st Sam', 'First Sam'],
  '2 Samuel': ['2 Sam', '2 Sa', '2S', 'II Sa', 'II Sam', '2Sam', '2nd Sam', 'Second Sam'],
  '1 Kings': ['1 Kgs', '1 Ki', '1K', 'I Kgs', 'I Ki', '1Kgs', '1st Kgs', 'First Kgs'],
  '2 Kings': ['2 Kgs', '2 Ki', '2K', 'II Kgs', 'II Ki', '2Kgs', '2nd Kgs', 'Second Kgs'],
  '1 Chronicles': ['1 Chr', '1 Ch', 'I Ch', '1Chr', '1st Chr', 'First Chr'],
  '2 Chronicles': ['2 Chr', '2 Ch', 'II Ch', '2Chr', '2nd Chr', 'Second Chr'],
  'Ezra': ['Ezra', 'Ezr', 'Ez'],
  'Nehemiah': ['Neh', 'Ne'],
  'Esther': ['Esth', 'Es'],
  'Job': ['Job', 'Jb'],
  'Psalms': ['Ps', 'Psalm', 'Psa', 'Psm', 'Pss'],
  'Proverbs': ['Prov', 'Pr', 'Prv'],
  'Ecclesiastes': ['Eccl', 'Ec', 'Ecc'],
  'Song of Solomon': ['Song', 'So', 'SOS', 'Song of Songs', 'Canticles', 'Cant'],
  'Isaiah': ['Isa', 'Is'],
  'Jeremiah': ['Jer', 'Je', 'Jr'],
  'Lamentations': ['Lam', 'La'],
  'Ezekiel': ['Ezek', 'Eze', 'Ezk'],
  'Daniel': ['Dan', 'Da', 'Dn'],
  'Hosea': ['Hos', 'Ho'],
  'Joel': ['Joel', 'Jl'],
  'Amos': ['Amos', 'Am'],
  'Obadiah': ['Obad', 'Ob'],
  'Jonah': ['Jonah', 'Jnh'],
  'Micah': ['Mic', 'Mc'],
  'Nahum': ['Nah', 'Na'],
  'Habakkuk': ['Hab', 'Hb'],
  'Zephaniah': ['Zeph', 'Zep', 'Zp'],
  'Haggai': ['Hag', 'Hg'],
  'Zechariah': ['Zech', 'Zec', 'Zc'],
  'Malachi': ['Mal', 'Ml'],

  // Deuterocanonical Books (Apocrypha) - included in Catholic Bibles like Douay-Rheims
  'Tobit': ['Tob', 'Tb'],
  'Judith': ['Jdt', 'Jth'],
  'Wisdom': ['Wis', 'Ws'],
  'Sirach': ['Sir', 'Ecclus', 'Ecclesiasticus'],
  'Baruch': ['Bar', 'Ba'],
  '1 Maccabees': ['1 Macc', '1 Mac', '1M', 'I Mac', '1Mac', '1st Mac', 'First Mac'],
  '2 Maccabees': ['2 Macc', '2 Mac', '2M', 'II Mac', '2Mac', '2nd Mac', 'Second Mac'],
  '1 Esdras': ['1 Esd', '1 Es', 'I Esd', '1Esd', '1st Esd', 'First Esd'],
  '2 Esdras': ['2 Esd', '2 Es', 'II Esd', '2Esd', '2nd Esd', 'Second Esd'],
  'Prayer of Manasseh': ['Pr Man', 'Prayer of Man', 'Man'],
  '3 Maccabees': ['3 Macc', '3 Mac', '3M', 'III Mac', '3Mac', '3rd Mac', 'Third Mac'],
  '4 Maccabees': ['4 Macc', '4 Mac', '4M', 'IV Mac', '4Mac', '4th Mac', 'Fourth Mac'],
  'Psalm 151': ['Ps 151', 'Psalm 151'],
  'Additions to Esther': ['Add Esth', 'Add Est', 'Esther Additions'],
  'Additions to Daniel': ['Add Dan', 'Daniel Additions'],
  'Bel and the Dragon': ['Bel', 'Bel and Dragon'],
  'Susanna': ['Sus', 'Susanna'],
  'Prayer of Azariah': ['Pr Azar', 'Prayer of Azar', 'Azar'],
  'Song of the Three Young Men': ['Song Three', 'Three Young Men', 'Three Youths'],

  // New Testament
  'Matthew': ['Matt', 'Mt'],
  'Mark': ['Mk', 'Mrk'],
  'Luke': ['Lk', 'Luk'],
  'John': ['Jn', 'Joh'],
  'Acts': ['Acts', 'Ac'],
  'Romans': ['Rom', 'Ro', 'Rm'],
  '1 Corinthians': ['1 Cor', '1 Co', 'I Co', '1Cor', '1st Cor', 'First Cor'],
  '2 Corinthians': ['2 Cor', '2 Co', 'II Co', '2Cor', '2nd Cor', 'Second Cor'],
  'Galatians': ['Gal', 'Ga'],
  'Ephesians': ['Eph', 'Ephes'],
  'Philippians': ['Phil', 'Php', 'Pp'],
  'Colossians': ['Col', 'Co'],
  '1 Thessalonians': ['1 Thess', '1 Th', 'I Th', '1Thess', '1st Thess', 'First Thess'],
  '2 Thessalonians': ['2 Thess', '2 Th', 'II Th', '2Thess', '2nd Thess', 'Second Thess'],
  '1 Timothy': ['1 Tim', '1 Ti', 'I Ti', '1Tim', '1st Tim', 'First Tim'],
  '2 Timothy': ['2 Tim', '2 Ti', 'II Ti', '2Tim', '2nd Tim', 'Second Tim'],
  'Titus': ['Titus', 'Ti'],
  'Philemon': ['Phlm', 'Phm'],
  'Hebrews': ['Heb'],
  'James': ['Jas', 'Jm'],
  '1 Peter': ['1 Pet', '1 Pe', 'I Pe', '1Pe', '1st Pet', 'First Pet'],
  '2 Peter': ['2 Pet', '2 Pe', 'II Pe', '2Pe', '2nd Pet', 'Second Pet'],
  '1 John': ['1 John', '1 Jn', 'I Jn', '1Jn', '1st Jn', 'First Jn'],
  '2 John': ['2 John', '2 Jn', 'II Jn', '2Jn', '2nd Jn', 'Second Jn'],
  '3 John': ['3 John', '3 Jn', 'III Jn', '3Jn', '3rd Jn', 'Third Jn'],
  'Jude': ['Jude', 'Jud'],
  'Revelation': ['Rev', 'Re', 'The Revelation']
};

// ============================================================================
// BIBLE VERSIONS
// ============================================================================

export const BIBLE_VERSIONS = {
  'KJV': 'King James Version',
  'NKJV': 'New King James Version',
  'NIV': 'New International Version',
  'ESV': 'English Standard Version',
  'NASB': 'New American Standard Bible',
  'NLT': 'New Living Translation',
  'MSG': 'The Message',
  'CEV': 'Contemporary English Version',
  'NRSV': 'New Revised Standard Version',
  'RSV': 'Revised Standard Version',
  'ASV': 'American Standard Version',
  'YLT': 'Young\'s Literal Translation',
  'WEB': 'World English Bible',
  'GNV': '1599 Geneva Bible',
  'DRB': 'Douay-Rheims Bible'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Create reverse mapping from abbreviations to full names
export const BIBLE_ABBREVIATIONS: { [key: string]: string } = {};
Object.entries(BIBLE_BOOKS).forEach(([fullName, abbreviations]) => {
  abbreviations.forEach(abbr => {
    BIBLE_ABBREVIATIONS[abbr.toLowerCase()] = fullName;
  });
  // Also add the full name itself
  BIBLE_ABBREVIATIONS[fullName.toLowerCase()] = fullName;
});

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Normalize whitespace and case in Bible reference strings
 * Handles cases like "John3:16", "  john  3:16  ", "JOHN 3:16", etc.
 */
function normalizeBibleReferenceWhitespace(ref: string): string {
  // Remove extra whitespace and normalize
  let normalized = ref.trim();
  
  // Handle cases where there's no space between book name and chapter/verse
  // Pattern: BookName followed immediately by digits (like "John3:16" or "John3")
  normalized = normalized.replace(/^([A-Za-z]+)(\d+)/, '$1 $2');
  
  // Handle cases where there's no space between chapter and verse
  // Pattern: digits followed immediately by colon and digits (like "3:16")
  normalized = normalized.replace(/(\d+):(\d+)/, '$1:$2'); // This is already correct, but let's be explicit
  
  // Normalize multiple spaces to single spaces
  normalized = normalized.replace(/\s+/g, ' ');
  
  return normalized.trim();
}

/**
 * Parse Bible notation like "John 1–3; 3:16; 6:14, 44"
 * Returns an array of BibleReference objects
 */
export function parseBibleNotation(notation: string): BibleReference[] {
  const references: BibleReference[] = [];
  
  // Split by semicolon to handle multiple references
  const parts = notation.split(';').map(p => p.trim());
  
  for (const part of parts) {
    // Normalize whitespace for each part
    const normalizedPart = normalizeBibleReferenceWhitespace(part);
    const ref = parseSingleBibleReference(normalizedPart);
    if (ref) {
      references.push(ref);
    }
  }
  
  return references;
}

/**
 * Parse a single Bible reference like "John 3:16" or "John 1-3" or "John 3:16 KJV"
 */
function parseSingleBibleReference(ref: string): BibleReference | null {
  // Remove extra whitespace
  ref = ref.trim();
  
  // First, try to extract version from the end
  let version: string | undefined;
  let refWithoutVersion = ref;
  
  // Check if the reference ends with a known version abbreviation
  const versionPattern = /\s+(KJV|NKJV|NIV|ESV|NASB|NLT|MSG|CEV|NRSV|RSV|ASV|YLT|WEB|GNV|DRB)$/i;
  const versionMatch = ref.match(versionPattern);
  if (versionMatch) {
    version = versionMatch[1].toUpperCase();
    refWithoutVersion = ref.replace(versionPattern, '').trim();
  }
  
  // Match patterns like:
  // "John 3:16" -> book: "John", chapter: 3, verses: "16"
  // "John 1-3" -> book: "John", chapter: 1, verses: "1-3"
  // "John 3" -> book: "John", chapter: 3
  // "John" -> book: "John"
  
  const patterns = [
    // Book Chapter:Verses (e.g., "John 3:16", "John 3:16,18")
    /^(.+?)\s+(\d+):(.+)$/,
    // Book Chapter-Verses (e.g., "John 1-3", "John 1-3,5")
    /^(.+?)\s+(\d+)-(.+)$/,
    // Book Chapter (e.g., "John 3")
    /^(.+?)\s+(\d+)$/,
    // Just Book (e.g., "John")
    /^(.+)$/
  ];
  
  for (const pattern of patterns) {
    const match = refWithoutVersion.match(pattern);
    if (match) {
      const bookName = match[1].trim();
      const fullBookName = BIBLE_ABBREVIATIONS[bookName.toLowerCase()];
      
      if (!fullBookName) {
        continue; // Try next pattern
      }
      
      const reference: BibleReference = {
        book: fullBookName
      };
      
      if (match[2]) {
        reference.chapter = parseInt(match[2]);
      }
      
      if (match[3]) {
        reference.verses = match[3];
      }
      
      // Add version if found
      if (version) {
        reference.version = version;
      }
      
      return reference;
    }
  }
  
  return null;
}

/**
 * Parse Bible wikilink notation like "[[John 1–3; 3:16; 6:14, 44 | KJV]]" or "[[John 3:16 | KJV DRB]]"
 */
export function parseBibleWikilink(wikilink: string): { references: BibleReference[], versions?: string[] } | null {
  // Remove the [[ and ]] brackets
  const content = wikilink.replace(/^\[\[|\]\]$/g, '');
  
  // Split by | to separate references from versions
  const parts = content.split('|').map(p => p.trim());
  
  if (parts.length === 0) return null;
  
  // Normalize whitespace in the reference part
  const normalizedReference = normalizeBibleReferenceWhitespace(parts[0]);
  const references = parseBibleNotation(normalizedReference);
  
  // Parse multiple versions if provided 
  let versions: string[] | undefined;
  if (parts[1]) {
    versions = parts[1].split(/\s+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0);
  }
  
  return { references, versions };
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Generate a search query for Bible events based on references
 */
export function generateBibleSearchQuery(references: BibleReference[], version?: string, versions?: string[]): string[] {
  const queries: string[] = [];
  
  for (const ref of references) {
    // Determine which versions to search for
    let versionsToSearch: string[] = [];
    
    if (versions && versions.length > 0) {
      // Multiple versions specified after pipe
      versionsToSearch = versions;
    } else if (ref.version) {
      // Individual reference version
      versionsToSearch = [ref.version];
    } else if (version) {
      // Global version
      versionsToSearch = [version];
    }
    
    if (versionsToSearch.length > 0) {
      // Generate a query for each version
      for (const versionToUse of versionsToSearch) {
        let query = `type:bible bible-book:${ref.book.toLowerCase().replace(/\s+/g, '-')}`;
        
        if (ref.chapter) {
          query += ` bible-chapter:${ref.chapter}`;
        }
        
        if (ref.verses) {
          query += ` bible-verses:${ref.verses}`;
        }
        
        query += ` bible-version:${versionToUse.toLowerCase()}`;
        
        queries.push(query);
      }
    } else {
      // No version specified - search all versions
      let query = `type:bible bible-book:${ref.book.toLowerCase().replace(/\s+/g, '-')}`;
      
      if (ref.chapter) {
        query += ` bible-chapter:${ref.chapter}`;
      }
      
      if (ref.verses) {
        query += ` bible-verses:${ref.verses}`;
      }
      
      queries.push(query);
    }
  }
  
  return queries;
}

// ============================================================================
// EVENT DETECTION FUNCTIONS
// ============================================================================

/**
 * Check if an event is a Bible event (based on Bible-specific tags)
 */
export function isBibleEvent(event: BibleEvent): boolean {
  // Check for bible-specific tags
  const typeTag = event.tags.find(([tag]) => tag === 'type');
  const bibleBookTag = event.tags.find(([tag]) => tag === 'bible-book');
  const bibleChapterTag = event.tags.find(([tag]) => tag === 'bible-chapter');
  const bibleVersionTag = event.tags.find(([tag]) => tag === 'bible-version');
  
  // It's a Bible event if it has the type tag OR has Bible-specific tags
  return (typeTag && typeTag[1] === 'bible') || 
         !!bibleBookTag || 
         !!bibleChapterTag || 
         !!bibleVersionTag;
}

/**
 * Extract Bible metadata from event tags
 */
export function extractBibleMetadata(event: BibleEvent): {
  book?: string;
  chapter?: string;
  verses?: string;
  version?: string;
} {
  const metadata: any = {};
  
  for (const [tag, value] of event.tags) {
    switch (tag) {
      case 'bible-book':
        metadata.book = value;
        break;
      case 'bible-chapter':
        metadata.chapter = value;
        break;
      case 'bible-verses':
        metadata.verses = value;
        break;
      case 'bible-version':
        metadata.version = value;
        break;
    }
  }
  
  return metadata;
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Format Bible reference for display
 */
export function formatBibleReference(ref: BibleReference): string {
  let formatted = ref.book;
  
  if (ref.chapter) {
    formatted += ` ${ref.chapter}`;
    
    if (ref.verses) {
      formatted += `:${ref.verses}`;
    }
  }
  
  return formatted;
}

/**
 * Generate a human-readable title for Bible content
 */
export function generateBibleTitle(metadata: { book?: string; chapter?: string; verses?: string; version?: string }): string {
  let title = metadata.book || 'Bible';
  
  if (metadata.chapter) {
    title += ` ${metadata.chapter}`;
    
    if (metadata.verses) {
      title += `:${metadata.verses}`;
    }
  }
  
  if (metadata.version) {
    const versionName = BIBLE_VERSIONS[metadata.version.toUpperCase() as keyof typeof BIBLE_VERSIONS] || metadata.version;
    title += ` (${versionName})`;
  }
  
  return title;
}
