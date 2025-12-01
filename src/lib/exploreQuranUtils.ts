import type { BookReference } from './books';

// Mapping from Quran book names (surah names) to surah numbers (1-114)
// This follows the standard compilation order
const surahNameToNumber: Record<string, number> = {
  'Al-Fatiha': 1,
  'Al-Baqarah': 2,
  'Ali Imran': 3,
  'An-Nisa': 4,
  'Al-Maidah': 5,
  'Al-Anam': 6,
  'Al-Araf': 7,
  'Al-Anfal': 8,
  'At-Tawbah': 9,
  'Yunus': 10,
  'Hud': 11,
  'Yusuf': 12,
  'Ar-Rad': 13,
  'Ibrahim': 14,
  'Al-Hijr': 15,
  'An-Nahl': 16,
  'Al-Isra': 17,
  'Al-Kahf': 18,
  'Maryam': 19,
  'Taha': 20,
  'Al-Anbiya': 21,
  'Al-Hajj': 22,
  'Al-Muminun': 23,
  'An-Nur': 24,
  'Al-Furqan': 25,
  'Ash-Shuara': 26,
  'An-Naml': 27,
  'Al-Qasas': 28,
  'Al-Ankabut': 29,
  'Ar-Rum': 30,
  'Luqman': 31,
  'As-Sajdah': 32,
  'Al-Ahzab': 33,
  'Saba': 34,
  'Fatir': 35,
  'Ya-Sin': 36,
  'As-Saffat': 37,
  'Sad': 38,
  'Az-Zumar': 39,
  'Ghafir': 40,
  'Fussilat': 41,
  'Ash-Shura': 42,
  'Az-Zukhruf': 43,
  'Ad-Dukhan': 44,
  'Al-Jathiyah': 45,
  'Al-Ahqaf': 46,
  'Muhammad': 47,
  'Al-Fath': 48,
  'Al-Hujurat': 49,
  'Qaf': 50,
  'Adh-Dhariyat': 51,
  'At-Tur': 52,
  'An-Najm': 53,
  'Al-Qamar': 54,
  'Ar-Rahman': 55,
  'Al-Waqiah': 56,
  'Al-Hadid': 57,
  'Al-Mujadilah': 58,
  'Al-Hashr': 59,
  'Al-Mumtahanah': 60,
  'As-Saff': 61,
  'Al-Jumuah': 62,
  'Al-Munafiqun': 63,
  'At-Taghabun': 64,
  'At-Talaq': 65,
  'At-Tahrim': 66,
  'Al-Mulk': 67,
  'Al-Qalam': 68,
  'Al-Haqqah': 69,
  'Al-Maarij': 70,
  'Nuh': 71,
  'Al-Jinn': 72,
  'Al-Muzzammil': 73,
  'Al-Muddaththir': 74,
  'Al-Qiyamah': 75,
  'Al-Insan': 76,
  'Al-Mursalat': 77,
  'An-Naba': 78,
  'An-Naziat': 79,
  'Abasa': 80,
  'At-Takwir': 81,
  'Al-Infitar': 82,
  'Al-Mutaffifin': 83,
  'Al-Inshiqaq': 84,
  'Al-Buruj': 85,
  'At-Tariq': 86,
  'Al-Ala': 87,
  'Al-Ghashiyah': 88,
  'Al-Fajr': 89,
  'Al-Balad': 90,
  'Ash-Shams': 91,
  'Al-Layl': 92,
  'Ad-Duha': 93,
  'Ash-Sharh': 94,
  'At-Tin': 95,
  'Al-Alaq': 96,
  'Al-Qadr': 97,
  'Al-Bayyinah': 98,
  'Az-Zalzalah': 99,
  'Al-Adiyat': 100,
  'Al-Qariah': 101,
  'At-Takathur': 102,
  'Al-Asr': 103,
  'Al-Humazah': 104,
  'Al-Fil': 105,
  'Quraysh': 106,
  'Al-Maun': 107,
  'Al-Kawthar': 108,
  'Al-Kafirun': 109,
  'An-Nasr': 110,
  'Al-Masad': 111,
  'Al-Ikhlas': 112,
  'Al-Falaq': 113,
  'An-Nas': 114
};

/**
 * Get the first ayah number from an ayah string (handles ranges and lists)
 * Since quran.com doesn't support ranges in the URL, we use the first ayah as startingVerse
 * Users can scroll down from there to see the rest of the range
 */
function getFirstAyah(ayah: string): number | null {
  if (!ayah) return null;
  
  // Split by comma to handle lists like "6,8,10"
  const firstPart = ayah.split(',')[0].trim();
  
  // Handle ranges like "6-8" - take the first number
  if (firstPart.includes('-')) {
    const start = parseInt(firstPart.split('-')[0].trim(), 10);
    return isNaN(start) ? null : start;
  }
  
  // Single ayah number
  const ayahNum = parseInt(firstPart, 10);
  return isNaN(ayahNum) ? null : ayahNum;
}

/**
 * Generate quran.com URL for a single reference
 * Format:
 * - Surah only: https://quran.com/{number}
 * - Surah with starting verse: https://quran.com/{number}?startingVerse={number}
 * 
 * Supports both:
 * - Numbered surahs: "18" -> surah 18
 * - Named surahs: "Al-Kahf" -> surah 18
 * 
 * For verse ranges (e.g., "5-10"), uses the first verse as startingVerse.
 * Users can scroll down from there to see the rest of the range.
 */
function generateSingleReferenceUrl(ref: BookReference): string | null {
  if (!ref.book) return null;
  
  console.log('Quran.com: generateSingleReferenceUrl', { book: ref.book, chapter: ref.chapter, verse: ref.verse });
  
  // For Quran, "chapter" is actually the surah number
  // If ref.chapter exists and is a valid surah number (1-114), use it directly
  let surahNumber: number | undefined;
  if (ref.chapter && typeof ref.chapter === 'number' && ref.chapter >= 1 && ref.chapter <= 114) {
    surahNumber = ref.chapter;
    console.log('Quran.com: Using chapter as surah number:', surahNumber);
  } else {
    // Fall back to book name lookuphf 18
    // First, check if the book name is already a number (1-114)
    // This handles numbered surahs like "18" or "1"
    const bookAsNumber = parseInt(ref.book.trim(), 10);
    if (!isNaN(bookAsNumber) && bookAsNumber >= 1 && bookAsNumber <= 114) {
      // Book name is a surah number (e.g., "18" -> 18)
      surahNumber = bookAsNumber;
    } else {
      // Book name is a surah name (e.g., "Al-Kahf" -> 18)
      // Get surah number from book name - case-insensitive lookup with multiple fallbacks
      // The parser normalizes book names, so we need flexible matching
      surahNumber = surahNameToNumber[ref.book];
    
      if (!surahNumber) {
        // Try case-insensitive lookup (handles "al-kahf" -> "Al-Kahf")
        const normalizedBook = ref.book.trim();
        const matchingKey = Object.keys(surahNameToNumber).find(
          key => key.toLowerCase() === normalizedBook.toLowerCase()
        );
        if (matchingKey) {
          surahNumber = surahNameToNumber[matchingKey];
        }
      }
    
      // Also try matching against normalized versions (remove hyphens, spaces, etc.)
      // This handles cases where the parser normalized "Al-Kahf" to "alkahf"
      if (!surahNumber) {
        const normalizedBook = ref.book.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchingKey = Object.keys(surahNameToNumber).find(key => {
          const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normalizedKey === normalizedBook;
        });
        if (matchingKey) {
          surahNumber = surahNameToNumber[matchingKey];
        }
      }
    
      // If still not found, try partial matching (e.g., "kahf" matches "Al-Kahf")
      if (!surahNumber) {
        const normalizedBook = ref.book.trim().toLowerCase();
        const matchingKey = Object.keys(surahNameToNumber).find(key => {
          const normalizedKey = key.toLowerCase();
          // Check if the normalized book name is contained in the key or vice versa
          // But require at least 3 characters to avoid false matches
          if (normalizedBook.length < 3 || normalizedKey.length < 3) {
            return false;
          }
          return normalizedKey.includes(normalizedBook) || normalizedBook.includes(normalizedKey);
        });
        if (matchingKey) {
          surahNumber = surahNameToNumber[matchingKey];
        }
      }
    }
  }
  
  if (!surahNumber) {
    console.warn('Quran.com: Unknown surah name:', ref.book, '(tried chapter, number, exact, case-insensitive, normalized, and partial matching)');
    console.warn('Quran.com: Available surah names:', Object.keys(surahNameToNumber).slice(0, 10).join(', '), '...');
    console.warn('Quran.com: Reference details:', { book: ref.book, chapter: ref.chapter, verse: ref.verse });
    return null;
  }
  
  console.log('Quran.com: Found surah number:', surahNumber, 'for book:', ref.book);
  
  // In Quran, "verse" is the ayah
  // quran.com uses startingVerse parameter to jump to a specific verse
  // For ranges, we use the first ayah as startingVerse (users can scroll down)
  if (ref.verse) {
    // Extract the first ayah number (handles ranges by taking the first number)
    const firstAyah = getFirstAyah(ref.verse);
    if (firstAyah === null) {
      // Invalid ayah, fall back to surah only
      return `https://quran.com/${surahNumber}`;
    }
    
    // Surah with starting verse (use first ayah for ranges)
    return `https://quran.com/${surahNumber}?startingVerse=${firstAyah}`;
  }
  
  // Surah only (no ayah specified)
  return `https://quran.com/${surahNumber}`;
}

/**
 * Generate quran.com URL from parsed query
 * For multiple references, we generate a URL for the first reference
 * (quran.com doesn't support multiple references in one URL)
 */
export function generateQuranComUrl(
  parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null
): string | null {
  if (!parsedQuery || parsedQuery.references.length === 0) return null;
  
  // quran.com doesn't support multiple references, so use the first one
  return generateSingleReferenceUrl(parsedQuery.references[0]);
}

/**
 * Generate quran.com URL for a single book reference (for individual cards)
 */
export function generateQuranComUrlForReference(
  ref: BookReference
): string | null {
  return generateSingleReferenceUrl(ref);
}

// Legacy function names for backward compatibility
export const generateExploreQuranUrl = generateQuranComUrl;
export const generateExploreQuranUrlForReference = generateQuranComUrlForReference;

// Get proxy URL from environment variable, default to relative path
const OG_PROXY_URL = (import.meta.env.VITE_OG_PROXY_URL as string | undefined)?.trim() || '/sites/';

function buildProxyUrl(target: string): string {
  // Use query parameter instead of encoding in path
  const encoded = encodeURIComponent(target);
  
  // Always ensure trailing slash before query parameter
  let baseUrl: string;
  if (OG_PROXY_URL.startsWith('http://') || OG_PROXY_URL.startsWith('https://')) {
    // Full URL - ensure trailing slash
    baseUrl = OG_PROXY_URL.endsWith('/') ? OG_PROXY_URL : `${OG_PROXY_URL}/`;
  } else {
    // Relative path - ensure trailing slash
    baseUrl = OG_PROXY_URL.endsWith('/') ? OG_PROXY_URL : (OG_PROXY_URL || '/sites/');
    if (!baseUrl.endsWith('/')) {
      baseUrl = `${baseUrl}/`;
    }
  }
  
  return `${baseUrl}?url=${encoded}`;
}

/**
 * Fetch OG metadata from quran.com via proxy
 */
export async function fetchQuranComOg(url: string): Promise<{ title?: string; description?: string; image?: string }> {
  const proxied = buildProxyUrl(url);
  console.log('Quran.com: Proxy URL constructed:', proxied, 'from target:', url);
  
  let response: Response;
  try {
    response = await fetch(proxied, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      // Add timeout to prevent hanging (5 seconds - should be quick, fallback to link if slow)
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      // For 502/504 errors, provide more context
      if (response.status === 502 || response.status === 504) {
        console.warn('Quran.com OG fetch failed: Proxy server error', response.status, response.statusText, 'for', url);
        throw new Error('Proxy server error - quran.com may be temporarily unavailable');
      }
      console.warn('Quran.com OG fetch failed:', response.status, response.statusText, 'for', url);
      throw new Error('Preview unavailable');
    }
  } catch (error: any) {
    // Handle timeout and network errors
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.warn('Quran.com OG fetch timeout for', url);
      throw new Error('Request timeout - quran.com took too long to respond');
    }
    if (error.message?.includes('Proxy server error')) {
      throw error; // Re-throw our custom error
    }
    console.warn('Quran.com OG fetch error:', error.message || error, 'for', url);
    throw new Error('Preview unavailable');
  }
  
  // Check content type
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    console.warn('Quran.com OG fetch: unexpected content type', contentType, 'for', url);
  }
  
  const html = await response.text();
  
  if (!html || html.trim().length === 0) {
    console.warn('Quran.com OG fetch: empty response for', url);
    throw new Error('Preview unavailable');
  }
  
  if (typeof DOMParser === 'undefined') {
    throw new Error('Preview unavailable');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.querySelector('title')?.textContent || '';
  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
    '';
  const image = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined;

  return {
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
    image
  };
}

// Legacy function name for backward compatibility
export const fetchExploreQuranOg = fetchQuranComOg;

