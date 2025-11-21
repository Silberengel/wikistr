import { parseBookWikilink as parseBookWikilinkNKBIP08 } from '$lib/bookWikilinkParser';

const bibleGatewayVersionMap: Record<string, string> = {
  drb: 'DRA',
  kjv: 'KJV',
  niv: 'NIV',
  esv: 'ESV',
  nasb: 'NASB',
  nlt: 'NLT',
  rsv: 'RSV',
  asv: 'ASV',
  web: 'WEB'
};

const bibleGatewayProxyPrefix = 'https://r.jina.ai/http://';

function capitalizeWords(text: string): string {
  return text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function normalizeBookstrWikilink(query: string): string {
  const trimmed = query.trim();
  if (trimmed.startsWith('[[book::')) return trimmed;
  if (trimmed.startsWith('book::')) {
    return `[[${trimmed}]]`;
  }
  return `[[book::${trimmed}]]`;
}

function formatReferenceForBibleGateway(reference: { title?: string; chapter?: string; section?: string[]; version?: string[] }): string {
  const bookTitle = reference.title ? capitalizeWords(reference.title) : '';
  let formatted = bookTitle;

  if (reference.chapter) {
    formatted += ` ${reference.chapter}`;
    if (reference.section && reference.section.length > 0) {
      formatted += `:${reference.section.join(',')}`;
    }
  }

  if (reference.version && reference.version.length > 0) {
    formatted += ` (${reference.version.join(', ')})`;
  }

  return formatted.trim();
}

function buildProxyUrl(target: string): string {
  return `${bibleGatewayProxyPrefix}${target.replace(/^https?:\/\//, '')}`;
}

export function generateBibleGatewayUrlFromQuery(query: string): string | null {
  const wikilink = normalizeBookstrWikilink(query);
  const parsed = parseBookWikilinkNKBIP08(wikilink);
  if (!parsed || parsed.references.length === 0) return null;

  const bibleRefs = parsed.references
    .filter((ref) => !ref.collection || ref.collection === 'bible')
    .map((ref) => formatReferenceForBibleGateway(ref))
    .filter(Boolean);

  if (bibleRefs.length === 0) return null;

  const versionSet = new Set<string>();
  for (const ref of parsed.references) {
    if (ref.version && ref.version.length > 0) {
      ref.version.forEach((v) => versionSet.add(v.toLowerCase()));
    }
  }

  const versionParam =
    versionSet.size > 0
      ? Array.from(versionSet).map((v) => bibleGatewayVersionMap[v] || v.toUpperCase()).join(';')
      : 'DRA';

  const searchParam = bibleRefs.join(', ');
  const encodedSearch = encodeURIComponent(searchParam);

  return `https://www.biblegateway.com/passage/?search=${encodedSearch}&version=${versionParam}`;
}

export async function fetchBibleGatewayOgFromUrl(url: string): Promise<{ title?: string; description?: string; image?: string }> {
  const proxied = buildProxyUrl(url);
  const response = await fetch(proxied);
  if (!response.ok) {
    throw new Error('Preview unavailable');
  }
  const html = await response.text();
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

