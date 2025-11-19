/**
 * Generalized book functionality for WikiStr
 * Supports searching, parsing, and displaying any structured text passages using Nostr events
 * Originally designed for Bible references, now supports Quran, Catechism, and other books
 */

export interface BookReference {
  book: string;
  chapter?: number;
  verse?: string; // Can be "1", "1-3", "1,3,5", etc.
  version?: string;
}

export interface BookEvent {
  id: string;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
  kind: number;
  sig: string;
}

export interface BookType {
  name: string;
  displayName: string;
  books: { [fullName: string]: string[] }; // full name -> abbreviations
  versions: { [abbrev: string]: string }; // abbreviation -> full name
  parsingRules: {
    bookPattern: RegExp;
    chapterPattern: RegExp;
    versePattern: RegExp;
    versionPattern: RegExp;
  };
  displayFormat: {
    bookChapterVerse: (book: string, chapter?: number, verse?: string) => string;
    withVersion: (ref: string, version?: string) => string;
  };
}

// ============================================================================
// BOOK TYPE CONFIGURATIONS
// ============================================================================

export const BOOK_TYPES: { [type: string]: BookType } = {
  bible: {
    name: 'bible',
    displayName: 'Bible',
    books: {
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
      'Psalms': ['Ps', 'Psalm', 'Psa', 'Psm', 'Pss', 'Psal'],
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

      // Deuterocanonical Books
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
    },
    versions: {
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
    },
    parsingRules: {
      bookPattern: /^(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Galatians|Ephesians|Philippians|Colossians|Titus|Philemon|Hebrews|James|Jude|Revelation|Tobit|Judith|Wisdom|Sirach|Baruch|Prayer of Manasseh|Psalm 151|Additions to Esther|Additions to Daniel|Bel and the Dragon|Susanna|Prayer of Azariah|Song of the Three Young Men|\d+\s*(?:Samuel|Kings|Chronicles|Corinthians|Thessalonians|Timothy|Peter|John|Maccabees|Esdras))\s+\d+(?::\d+)?(?:\s*[-,]\s*\d+)*$/i,
      chapterPattern: /^[\w\-`]+$/,
      versePattern: /^[\w\-`.,\s]+$/,
      versionPattern: /^(KJV|NKJV|NIV|ESV|NASB|NLT|MSG|CEV|NRSV|RSV|ASV|YLT|WEB|GNV|DRB)$/i
    },
    displayFormat: {
      bookChapterVerse: (book: string, chapter?: number, verse?: string) => {
        let formatted = book;
        if (chapter) {
          formatted += ` ${chapter}`;
          if (verse) {
            formatted += `:${verse}`;
          }
        }
        return formatted;
      },
      withVersion: (ref: string, version?: string) => {
        return version ? `${ref} (${version})` : ref;
      }
    }
  },

  quran: {
    name: 'quran',
    displayName: 'Quran',
    books: {
      'Al-Fatiha': ['Al-Fatiha', 'Fatiha', 'The Opening'],
      'Al-Baqarah': ['Al-Baqarah', 'Baqarah', 'The Cow'],
      'Ali Imran': ['Ali Imran', 'Imran', 'Family of Imran'],
      'An-Nisa': ['An-Nisa', 'Nisa', 'The Women'],
      'Al-Maidah': ['Al-Maidah', 'Maidah', 'The Table Spread'],
      'Al-Anam': ['Al-Anam', 'Anam', 'The Cattle'],
      'Al-Araf': ['Al-Araf', 'Araf', 'The Heights'],
      'Al-Anfal': ['Al-Anfal', 'Anfal', 'The Spoils of War'],
      'At-Tawbah': ['At-Tawbah', 'Tawbah', 'The Repentance'],
      'Yunus': ['Yunus', 'Jonah'],
      'Hud': ['Hud', 'Hud'],
      'Yusuf': ['Yusuf', 'Joseph'],
      'Ar-Rad': ['Ar-Rad', 'Rad', 'The Thunder'],
      'Ibrahim': ['Ibrahim', 'Abraham'],
      'Al-Hijr': ['Al-Hijr', 'Hijr', 'The Rocky Tract'],
      'An-Nahl': ['An-Nahl', 'Nahl', 'The Bee'],
      'Al-Isra': ['Al-Isra', 'Isra', 'The Night Journey'],
      'Al-Kahf': ['Al-Kahf', 'Kahf', 'The Cave'],
      'Maryam': ['Maryam', 'Mary'],
      'Taha': ['Taha', 'Ta-Ha'],
      'Al-Anbiya': ['Al-Anbiya', 'Anbiya', 'The Prophets'],
      'Al-Hajj': ['Al-Hajj', 'Hajj', 'The Pilgrimage'],
      'Al-Muminun': ['Al-Muminun', 'Muminun', 'The Believers'],
      'An-Nur': ['An-Nur', 'Nur', 'The Light'],
      'Al-Furqan': ['Al-Furqan', 'Furqan', 'The Criterion'],
      'Ash-Shuara': ['Ash-Shuara', 'Shuara', 'The Poets'],
      'An-Naml': ['An-Naml', 'Naml', 'The Ant'],
      'Al-Qasas': ['Al-Qasas', 'Qasas', 'The Stories'],
      'Al-Ankabut': ['Al-Ankabut', 'Ankabut', 'The Spider'],
      'Ar-Rum': ['Ar-Rum', 'Rum', 'The Romans'],
      'Luqman': ['Luqman', 'Luqman'],
      'As-Sajdah': ['As-Sajdah', 'Sajdah', 'The Prostration'],
      'Al-Ahzab': ['Al-Ahzab', 'Ahzab', 'The Clans'],
      'Saba': ['Saba', 'Sheba'],
      'Fatir': ['Fatir', 'The Originator'],
      'Ya-Sin': ['Ya-Sin', 'Yasin', 'Yaseen'],
      'As-Saffat': ['As-Saffat', 'Saffat', 'Those Ranged in Rows'],
      'Sad': ['Sad', 'Sad'],
      'Az-Zumar': ['Az-Zumar', 'Zumar', 'The Groups'],
      'Ghafir': ['Ghafir', 'The Forgiver'],
      'Fussilat': ['Fussilat', 'Explained in Detail'],
      'Ash-Shura': ['Ash-Shura', 'Shura', 'The Consultation'],
      'Az-Zukhruf': ['Az-Zukhruf', 'Zukhruf', 'The Gold'],
      'Ad-Dukhan': ['Ad-Dukhan', 'Dukhan', 'The Smoke'],
      'Al-Jathiyah': ['Al-Jathiyah', 'Jathiyah', 'The Crouching'],
      'Al-Ahqaf': ['Al-Ahqaf', 'Ahqaf', 'The Wind-Curved Sandhills'],
      'Muhammad': ['Muhammad', 'Muhammad'],
      'Al-Fath': ['Al-Fath', 'Fath', 'The Victory'],
      'Al-Hujurat': ['Al-Hujurat', 'Hujurat', 'The Rooms'],
      'Qaf': ['Qaf', 'Qaf'],
      'Adh-Dhariyat': ['Adh-Dhariyat', 'Dhariyat', 'The Winnowing Winds'],
      'At-Tur': ['At-Tur', 'Tur', 'The Mount'],
      'An-Najm': ['An-Najm', 'Najm', 'The Star'],
      'Al-Qamar': ['Al-Qamar', 'Qamar', 'The Moon'],
      'Ar-Rahman': ['Ar-Rahman', 'Rahman', 'The Beneficent'],
      'Al-Waqiah': ['Al-Waqiah', 'Waqiah', 'The Event'],
      'Al-Hadid': ['Al-Hadid', 'Hadid', 'The Iron'],
      'Al-Mujadilah': ['Al-Mujadilah', 'Mujadilah', 'The Pleading Woman'],
      'Al-Hashr': ['Al-Hashr', 'Hashr', 'The Gathering'],
      'Al-Mumtahanah': ['Al-Mumtahanah', 'Mumtahanah', 'She That is to be Examined'],
      'As-Saff': ['As-Saff', 'Saff', 'The Ranks'],
      'Al-Jumuah': ['Al-Jumuah', 'Jumuah', 'Friday'],
      'Al-Munafiqun': ['Al-Munafiqun', 'Munafiqun', 'The Hypocrites'],
      'At-Taghabun': ['At-Taghabun', 'Taghabun', 'The Mutual Disillusion'],
      'At-Talaq': ['At-Talaq', 'Talaq', 'The Divorce'],
      'At-Tahrim': ['At-Tahrim', 'Tahrim', 'The Prohibition'],
      'Al-Mulk': ['Al-Mulk', 'Mulk', 'The Sovereignty'],
      'Al-Qalam': ['Al-Qalam', 'Qalam', 'The Pen'],
      'Al-Haqqah': ['Al-Haqqah', 'Haqqah', 'The Reality'],
      'Al-Maarij': ['Al-Maarij', 'Maarij', 'The Ascending Stairways'],
      'Nuh': ['Nuh', 'Noah'],
      'Al-Jinn': ['Al-Jinn', 'Jinn', 'The Jinn'],
      'Al-Muzzammil': ['Al-Muzzammil', 'Muzzammil', 'The Enshrouded One'],
      'Al-Muddaththir': ['Al-Muddaththir', 'Muddaththir', 'The Cloaked One'],
      'Al-Qiyamah': ['Al-Qiyamah', 'Qiyamah', 'The Resurrection'],
      'Al-Insan': ['Al-Insan', 'Insan', 'The Human'],
      'Al-Mursalat': ['Al-Mursalat', 'Mursalat', 'The Emissaries'],
      'An-Naba': ['An-Naba', 'Naba', 'The Tidings'],
      'An-Naziat': ['An-Naziat', 'Naziat', 'Those who drag forth'],
      'Abasa': ['Abasa', 'He Frowned'],
      'At-Takwir': ['At-Takwir', 'Takwir', 'The Overthrowing'],
      'Al-Infitar': ['Al-Infitar', 'Infitar', 'The Cleaving'],
      'Al-Mutaffifin': ['Al-Mutaffifin', 'Mutaffifin', 'Those who give short measure'],
      'Al-Inshiqaq': ['Al-Inshiqaq', 'Inshiqaq', 'The Sundering'],
      'Al-Buruj': ['Al-Buruj', 'Buruj', 'The Constellations'],
      'At-Tariq': ['At-Tariq', 'Tariq', 'The Night-Comer'],
      'Al-Ala': ['Al-Ala', 'Ala', 'The Most High'],
      'Al-Ghashiyah': ['Al-Ghashiyah', 'Ghashiyah', 'The Overwhelming'],
      'Al-Fajr': ['Al-Fajr', 'Fajr', 'The Dawn'],
      'Al-Balad': ['Al-Balad', 'Balad', 'The City'],
      'Ash-Shams': ['Ash-Shams', 'Shams', 'The Sun'],
      'Al-Layl': ['Al-Layl', 'Layl', 'The Night'],
      'Ad-Duha': ['Ad-Duha', 'Duha', 'The Morning Hours'],
      'Ash-Sharh': ['Ash-Sharh', 'Sharh', 'The Relief'],
      'At-Tin': ['At-Tin', 'Tin', 'The Fig'],
      'Al-Alaq': ['Al-Alaq', 'Alaq', 'The Clot'],
      'Al-Qadr': ['Al-Qadr', 'Qadr', 'The Power'],
      'Al-Bayyinah': ['Al-Bayyinah', 'Bayyinah', 'The Evidence'],
      'Az-Zalzalah': ['Az-Zalzalah', 'Zalzalah', 'The Earthquake'],
      'Al-Adiyat': ['Al-Adiyat', 'Adiyat', 'The Runners'],
      'Al-Qariah': ['Al-Qariah', 'Qariah', 'The Calamity'],
      'At-Takathur': ['At-Takathur', 'Takathur', 'The Rivalry in world increase'],
      'Al-Asr': ['Al-Asr', 'Asr', 'The Declining Day'],
      'Al-Humazah': ['Al-Humazah', 'Humazah', 'The Traducer'],
      'Al-Fil': ['Al-Fil', 'Fil', 'The Elephant'],
      'Quraysh': ['Quraysh', 'The Quraysh'],
      'Al-Maun': ['Al-Maun', 'Maun', 'The Small kindnesses'],
      'Al-Kawthar': ['Al-Kawthar', 'Kawthar', 'The Abundance'],
      'Al-Kafirun': ['Al-Kafirun', 'Kafirun', 'The Disbelievers'],
      'An-Nasr': ['An-Nasr', 'Nasr', 'The Divine Support'],
      'Al-Masad': ['Al-Masad', 'Masad', 'The Palm Fibre'],
      'Al-Ikhlas': ['Al-Ikhlas', 'Ikhlas', 'The Sincerity'],
      'Al-Falaq': ['Al-Falaq', 'Falaq', 'The Daybreak'],
      'An-Nas': ['An-Nas', 'Nas', 'The Mankind']
    },
    versions: {
      'SAHIH': 'Sahih International',
      'PICKTHALL': 'Muhammad Marmaduke William Pickthall',
      'YUSUFALI': 'Abdullah Yusuf Ali',
      'SHAKIR': 'Muhammad Habib Shakir',
      'MUHD': 'Dr. Ghali',
      'CLEARQURAN': 'Dr. Mustafa Khattab, the Clear Quran',
      'SARWAR': 'Muhammad Sarwar',
      'KHAN': 'Taqi-ud-Din al-Hilali and Muhammad Muhsin Khan',
      'QARIBULLAH': 'Qaribullah & Darwish',
      'ARABIC': 'Arabic Text'
    },
    parsingRules: {
      bookPattern: /^(?:Al-|Ash-|Az-|At-|Ad-)?[A-Za-z][A-Za-z-]+(?:\s+[A-Za-z-]+)*\s+\d+(?:[-,\s]\d+)*$/i,
      chapterPattern: /^[\w\-`]+$/,
      versePattern: /^[\w\-`.,\s]+$/,
      versionPattern: /^(SAHIH|PICKTHALL|YUSUFALI|SHAKIR|MUHD|CLEARQURAN|SARWAR|KHAN|QARIBULLAH|ARABIC)$/i
    },
    displayFormat: {
      bookChapterVerse: (book: string, chapter?: number, verse?: string) => {
        let formatted = book;
        if (chapter) {
          formatted += ` ${chapter}`;
          if (verse) {
            formatted += `:${verse}`;
          }
        }
        return formatted;
      },
      withVersion: (ref: string, version?: string) => {
        return version ? `${ref} (${version})` : ref;
      }
    }
  },

  catechism: {
    name: 'catechism',
    displayName: 'Catechism of the Catholic Church',
    books: {
      'Article 1': ['Article 1', 'Art 1'],
      'Article 2': ['Article 2', 'Art 2'],
      'Article 3': ['Article 3', 'Art 3'],
      'Part I': ['Part I', 'Part 1'],
      'Part II': ['Part II', 'Part 2'],
      'Part III': ['Part III', 'Part 3'],
      'Part IV': ['Part IV', 'Part 4']
    },
    versions: {
      'CCC': 'Catechism of the Catholic Church',
      'YOUCAT': 'Youth Catechism',
      'COMPENDIUM': 'Compendium of the Catechism'
    },
    parsingRules: {
      bookPattern: /^(?:Article|Art|Part)\s+\d+(?:\s+[A-Za-z-]+)*\s+\d+(?:[-,\s]\d+)*$/i,
      chapterPattern: /^[\w\-`]+$/,
      versePattern: /^[\w\-`.,\s]+$/,
      versionPattern: /^(CCC|YOUCAT|COMPENDIUM)$/i
    },
    displayFormat: {
      bookChapterVerse: (book: string, chapter?: number, verse?: string) => {
        let formatted = book;
        if (chapter) {
          formatted += `:${chapter}`;
          if (verse) {
            formatted += `.${verse}`;
          }
        }
        return formatted;
      },
      withVersion: (ref: string, version?: string) => {
        return version ? `${ref} (${version})` : ref;
      }
    }
  },
  torah: {
    name: 'torah',
    displayName: 'Torah',
    books: {
      'Genesis': ['Gen', 'Ge', 'Gn', 'Bereshit'],
      'Exodus': ['Exod', 'Ex', 'Exo', 'Shemot'],
      'Leviticus': ['Lev', 'Le', 'Lv', 'Vayikra'],
      'Numbers': ['Num', 'Nu', 'Nm', 'Nb', 'Bamidbar'],
      'Deuteronomy': ['Deut', 'De', 'Dt', 'Devarim']
    },
    versions: {
      'JPS': 'Jewish Publication Society',
      'NJPS': 'New Jewish Publication Society',
      'TANAKH': 'Tanakh',
      'HEBREW': 'Hebrew',
      'ENGLISH': 'English'
    },
    parsingRules: {
      bookPattern: /.*/,
      chapterPattern: /^[\w\-`]+$/,
      versePattern: /^[\w\-`.,\s]+$/,
      versionPattern: /.*/
    },
    displayFormat: {
      bookChapterVerse: (book: string, chapter?: number, verse?: string) => {
        if (chapter && verse) {
          return `${book} ${chapter}:${verse}`;
        } else if (chapter) {
          return `${book} ${chapter}`;
        } else {
          return book;
        }
      },
      withVersion: (ref: string, version?: string) => {
        return version ? `${ref} (${version})` : ref;
      }
    }
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Legacy support - these functions are now handled by the centralized bookConfig system
// Keeping for backward compatibility

/**
 * @deprecated Use bookConfig.getBookType() instead
 */
export function getBookType(name: string) {
  console.warn('getBookType is deprecated, use bookConfig.getBookType() instead');
  return BOOK_TYPES[name];
}

/**
 * @deprecated Use bookConfig.getAllBookTypesArray() instead
 */
export function getAllBookTypes(customBookTypes: { [name: string]: BookType } = {}): { [name: string]: BookType } {
  console.warn('getAllBookTypes is deprecated, use bookConfig.getAllBookTypesArray() instead');
  return { ...BOOK_TYPES, ...customBookTypes };
}

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Normalize whitespace and case in book reference strings
 * Handles cases like "John3:16", "  john  3:16  ", "JOHN 3:16", etc.
 */
function normalizeBookReferenceWhitespace(ref: string): string {
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
 * Parse book notation like "John 1–3; 3:16; 6:14, 44" for any book type
 * Returns an array of BookReference objects
 */
export function parseBookNotation(notation: string, bookType: string): BookReference[] {
  const references: BookReference[] = [];
  
  // Split by semicolon to handle multiple references
  const parts = notation.split(';').map(p => p.trim());
  
  for (const part of parts) {
    // Normalize whitespace for each part
    const normalizedPart = normalizeBookReferenceWhitespace(part);
    const ref = parseSingleBookReference(normalizedPart, bookType);
    if (ref) {
      references.push(ref);
    }
  }
  
  return references;
}

/**
 * Parse a single book reference like "John 3:16" or "John 1-3" or "John 3:16 KJV"
 */
function parseSingleBookReference(ref: string, bookType: string): BookReference | null {
  // For now, use built-in book types. In the future, this should use the centralized system
  const typeConfig = BOOK_TYPES[bookType];
  if (!typeConfig) return null;
  
  // Remove extra whitespace
  ref = ref.trim();
  
  // First, try to extract version from the end
  let version: string | undefined;
  let refWithoutVersion = ref;
  
  // Check if the reference ends with a known version abbreviation
  const versionPattern = new RegExp(`\\s+(${Object.keys(typeConfig.versions).join('|')})$`, 'i');
  const versionMatch = ref.match(versionPattern);
  if (versionMatch) {
    version = versionMatch[1].toUpperCase();
    refWithoutVersion = ref.replace(versionPattern, '').trim();
  }
  
  // Match patterns based on book type
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
      // For now, use built-in abbreviations. In the future, this should use the centralized system
      const fullBookName = BOOK_TYPES[bookType]?.books && 
        Object.entries(BOOK_TYPES[bookType].books).find(([fullName, abbreviations]) => 
          abbreviations.some(abbr => abbr.toLowerCase() === bookName.toLowerCase()) || 
          fullName.toLowerCase() === bookName.toLowerCase()
        )?.[0];
      
      if (!fullBookName) {
        continue; // Try next pattern
      }
      
      const reference: BookReference = {
        book: fullBookName
      };
      
      if (match[2]) {
        reference.chapter = parseInt(match[2]);
      }
      
      if (match[3]) {
        reference.verse = match[3];
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
 * Parse book wikilink notation like "[[John 1–3; 3:16; 6:14, 44 | KJV]]" or "[[John 3:16 | KJV DRB]]"
 * Now supports any book type
 */
export function parseBookWikilink(wikilink: string, bookType: string = 'bible'): { references: BookReference[], versions?: string[] } | null {
  // Remove the [[ and ]] brackets
  const content = wikilink.replace(/^\[\[|\]\]$/g, '');
  
  // Handle book: prefix (e.g., "book:bible:John 3:16")
  let referenceContent = content;
  if (content.startsWith('book:')) {
    const parts = content.substring(5).split(':');
    if (parts.length >= 2) {
      bookType = parts[0];
      referenceContent = parts.slice(1).join(':');
    }
  } else if (content.startsWith('bible:')) {
    // Legacy Bible prefix support
    bookType = 'bible';
    referenceContent = content.substring(6).trim();
  }
  
  // Split by | to separate references from versions
  const parts = referenceContent.split('|').map(p => p.trim());
  
  if (parts.length === 0) return null;
  
  // Normalize whitespace in the reference part
  const normalizedReference = normalizeBookReferenceWhitespace(parts[0]);
  const references = parseBookNotation(normalizedReference, bookType);
  
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
 * Generate a search query for book events based on references
 */
export function generateBookSearchQuery(references: BookReference[], bookType: string, version?: string, versions?: string[]): string[] {
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
        let query = `type:${bookType} book:${ref.book.toLowerCase().replace(/\s+/g, '-')}`;
        
        if (ref.chapter) {
          query += ` chapter:${ref.chapter}`;
        }
        
        if (ref.verse) {
          query += ` verse:${ref.verse}`;
        }
        
        query += ` version:${String(versionToUse).toLowerCase()}`;
        
        queries.push(query);
      }
    } else {
      // No version specified - search all versions
      let query = `type:${bookType} book:${ref.book.toLowerCase().replace(/\s+/g, '-')}`;
      
      if (ref.chapter) {
        query += ` chapter:${ref.chapter}`;
      }
      
      if (ref.verse) {
        query += ` verse:${ref.verse}`;
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
 * Check if an event is a book event (based on generic book tags)
 * Supports both old format (type/book/chapter/verse/version) and NKBIP-08 format (C/T/c/s/v)
 */
export function isBookEvent(event: BookEvent, bookType?: string): boolean {
  // Check for NKBIP-08 format tags (C/T/c/s/v)
  const collectionTag = event.tags.find(([tag]) => tag === 'C');
  const titleTag = event.tags.find(([tag]) => tag === 'T');
  const chapterTagNKBIP = event.tags.find(([tag]) => tag === 'c');
  const sectionTag = event.tags.find(([tag]) => tag === 's');
  const versionTagNKBIP = event.tags.find(([tag]) => tag === 'v');
  
  // Check for old format tags (type/book/chapter/verse/version)
  const typeTag = event.tags.find(([tag]) => tag === 'type');
  const bookTag = event.tags.find(([tag]) => tag === 'book');
  const chapterTag = event.tags.find(([tag]) => tag === 'chapter');
  const verseTag = event.tags.find(([tag]) => tag === 'verse');
  const versionTag = event.tags.find(([tag]) => tag === 'version');
  
  // If bookType is specified, check if collection/type matches
  if (bookType) {
    if (collectionTag && collectionTag[1] !== bookType) {
      return false;
    }
    if (typeTag && typeTag[1] !== bookType) {
      return false;
    }
  }
  
  // It's a book event if it has NKBIP-08 tags OR old format tags
  return !!(collectionTag || titleTag || chapterTagNKBIP || sectionTag || versionTagNKBIP) ||
         !!(typeTag || bookTag || chapterTag || verseTag || versionTag);
}

/**
 * Extract book metadata from event tags
 * Supports both old format (type/book/chapter/verse/version) and NKBIP-08 format (C/T/c/s/v)
 * Returns metadata in a normalized format for backward compatibility
 */
export function extractBookMetadata(event: BookEvent): {
  type?: string;
  book?: string;
  chapter?: string;
  verse?: string;
  version?: string;
} {
  const metadata: any = {};
  
  // First, check for NKBIP-08 format tags
  const collectionTag = event.tags.find(([tag]) => tag === 'C');
  const titleTag = event.tags.find(([tag]) => tag === 'T');
  const chapterTagNKBIP = event.tags.find(([tag]) => tag === 'c');
  const sectionTags = event.tags.filter(([tag]) => tag === 's').map(([, value]) => value);
  const versionTags = event.tags.filter(([tag]) => tag === 'v').map(([, value]) => value);
  
  if (collectionTag) {
    metadata.type = collectionTag[1];
  }
  if (titleTag) {
    // Convert normalized title back to display format if possible
    // For now, just use the normalized value - can be enhanced later
    metadata.book = titleTag[1];
  }
  if (chapterTagNKBIP) {
    metadata.chapter = chapterTagNKBIP[1];
  }
  if (sectionTags.length > 0) {
    // Handle multiple sections
    if (sectionTags.length === 1) {
      // Single section: just use it
      metadata.verse = sectionTags[0];
    } else {
      // Multiple sections: try to detect if it's a continuous range
      const sortedSections = sectionTags.map(s => parseInt(s, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
      if (sortedSections.length === sectionTags.length) {
        // All sections are numeric - check if they form a continuous range
        const isContinuous = sortedSections.every((val, idx) => 
          idx === 0 || val === sortedSections[idx - 1] + 1
        );
        if (isContinuous) {
          // It's a range: "16-18" format
          metadata.verse = `${sortedSections[0]}-${sortedSections[sortedSections.length - 1]}`;
        } else {
          // Not continuous: join with commas "16,18,20"
          metadata.verse = sectionTags.join(',');
        }
      } else {
        // Some non-numeric sections: just join with commas
        metadata.verse = sectionTags.join(',');
      }
    }
  }
  if (versionTags.length > 0) {
    // Handle multiple versions
    if (versionTags.length === 1) {
      // Single version: just use it
      metadata.version = versionTags[0];
    } else {
      // Multiple versions: join with space (e.g., "kjv niv")
      // This preserves all version information for display/search
      metadata.version = versionTags.join(' ');
    }
  }
  
  // Fall back to old format tags if NKBIP-08 tags not found
  if (!collectionTag && !titleTag) {
    for (const [tag, value] of event.tags) {
      switch (tag) {
        case 'type':
          metadata.type = value;
          break;
        case 'book':
          metadata.book = value;
          break;
        case 'chapter':
          metadata.chapter = value;
          break;
        case 'verse':
          metadata.verse = value;
          break;
        case 'version':
          metadata.version = value;
          break;
      }
    }
  }
  
  return metadata;
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Format book reference for display
 */
export function formatBookReference(ref: BookReference, bookType: string = 'bible'): string {
  const typeConfig = BOOK_TYPES[bookType];
  if (!typeConfig) {
    // Fallback to basic formatting
    let formatted = ref.book;
    if (ref.chapter) {
      formatted += ` ${ref.chapter}`;
      if (ref.verse) {
        formatted += `:${ref.verse}`;
      }
    }
    return formatted;
  }
  
  return typeConfig.displayFormat.bookChapterVerse(ref.book, ref.chapter, ref.verse);
}

/**
 * Generate a human-readable title for book content
 */
export function generateBookTitle(metadata: { type?: string; book?: string; chapter?: string; verse?: string; version?: string }): string {
  const bookType = metadata.type || 'bible';
  const typeConfig = BOOK_TYPES[bookType];
  
  let title = metadata.book || 'Book';
  
  if (metadata.chapter) {
    if (bookType === 'catechism') {
      title += `:${metadata.chapter}`;
      if (metadata.verse) {
        title += `.${metadata.verse}`;
      }
    } else {
      title += ` ${metadata.chapter}`;
      if (metadata.verse) {
        title += `:${metadata.verse}`;
      }
    }
  }
  
  if (metadata.version && typeConfig) {
    const versionName = typeConfig.versions[metadata.version.toUpperCase()] || metadata.version;
    title += ` (${versionName})`;
  }
  
  return title;
}

/**
 * Expand a verse string into individual section numbers
 * Handles ranges (e.g., "16-18" -> ["16", "17", "18"]) and comma-separated lists
 */
function expandVerseToSections(verse: string): string[] {
  const sections: string[] = [];
  const parts = verse.split(',').map(p => p.trim());
  
  for (const part of parts) {
    if (part.includes('-')) {
      // It's a range
      const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          sections.push(i.toString());
        }
      } else {
        // Invalid range, just add as-is
        sections.push(part);
      }
    } else {
      // Single section
      sections.push(part);
    }
  }
  
  return sections;
}

/**
 * Extract all section numbers from an event (from NKBIP-08 s tags or old verse tag)
 */
function extractEventSections(event: BookEvent): string[] {
  // Check for NKBIP-08 format first
  const sectionTags = event.tags.filter(([tag]) => tag === 's').map(([, value]) => value);
  if (sectionTags.length > 0) {
    return sectionTags;
  }
  
  // Fall back to old format
  const verseTag = event.tags.find(([tag]) => tag === 'verse');
  if (verseTag && verseTag[1]) {
    return expandVerseToSections(verseTag[1]);
  }
  
  return [];
}

/**
 * Check if a book event matches a search query
 * For section ranges, matches if the event contains ANY section in the range
 */
export function matchesBookQuery(event: BookEvent, query: string | { references: BookReference[], version?: string }, bookType: string): boolean {
  if (!isBookEvent(event, bookType)) {
    return false;
  }
  
  const metadata = extractBookMetadata(event);
  if (!metadata) {
    return false;
  }
  
  // Handle query string case
  if (typeof query === 'string') {
    // For now, just check if the event is a book event - this is a simplified implementation
    // In a real implementation, you'd parse the query string and match against metadata
    return true;
  }
  
  // Handle query object case
  // If a specific version is requested, check if this event matches that version
  if (query.version && metadata.version) {
    // Handle multiple versions (space-separated)
    const queryVersions = query.version.toLowerCase().split(/\s+/);
    const eventVersions = metadata.version.toLowerCase().split(/\s+/);
    const hasMatchingVersion = queryVersions.some(qv => eventVersions.includes(qv));
    if (!hasMatchingVersion) {
      return false; // No version matches
    }
  }
  
  // Extract sections from the event
  const eventSections = extractEventSections(event);
  
  // Check if any of the references match
  for (const ref of query.references) {
    // Check book match
    if (!metadata.book || ref.book.toLowerCase() !== metadata.book.toLowerCase()) {
      continue;
    }
    
    // Check chapter match
    if (ref.chapter) {
      if (!metadata.chapter || ref.chapter.toString() !== metadata.chapter) {
        continue;
      }
    } else {
      // No chapter in query, but event has chapter - still match (book-level match)
    }
    
    // Check section/verse match
    if (ref.verse) {
      // Expand the query verse into individual sections
      const querySections = expandVerseToSections(ref.verse);
      
      // Check if ANY query section matches ANY event section
      const hasMatchingSection = querySections.some(qs => eventSections.includes(qs));
      if (!hasMatchingSection) {
        continue; // No section matches, try next reference
      }
    } else if (ref.chapter && eventSections.length > 0) {
      // Query has chapter but no verse, event has sections - still match (chapter-level match)
    }
    
    // All checks passed for this reference
    return true;
  }
  
  return false;
}

