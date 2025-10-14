import { normalizeIdentifier } from '@nostr/tools/nip54';
import type { NostrEvent } from '@nostr/tools/pure';

export function formatDate(unixtimestamp: number) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];

  const date = new Date(unixtimestamp * 1000);
  const now = Date.now();
  const diffInSeconds = Math.floor((now / 1000) - unixtimestamp);

  // Handle very recent times
  if (diffInSeconds < 60) {
    return 'just now';
  }

  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }

  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  // Check if it's today
  const today = new Date(now).toISOString().split('T')[0];
  const dateday = date.toISOString().split('T')[0];
  if (dateday === today) return 'today';

  // Check if it's yesterday
  const yesterday = new Date(now - 24 * 3600 * 1000).toISOString().split('T')[0];
  if (dateday === yesterday) return 'yesterday';

  // For older dates within 90 days
  if (diffInSeconds < 90 * 24 * 3600) {
    const days = Math.floor(diffInSeconds / 86400);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  // For very old dates, show the actual date
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const formattedDate = `${day} ${month} ${year}`;
  return 'on ' + formattedDate;
}

let serial = 1;

export function next(): number {
  return serial++;
}

export function scrollCardIntoView(el: number | string | HTMLElement, wait: boolean) {
  function scrollCard() {
    const element =
      el instanceof HTMLElement ? el : document.querySelector(`[id^="wikicard-${el}"]`);
    if (!element) return;

    element.scrollIntoView({
      behavior: 'smooth',
      inline: 'start'
    });
  }

  if (wait) {
    setTimeout(() => {
      scrollCard();
    }, 1);
  } else {
    scrollCard();
  }
}

export function isElementInViewport(el: number | string | HTMLElement) {
  const element = el instanceof HTMLElement ? el : document.querySelector(`[id^="wikicard-${el}"]`);
  if (!element) return;

  const rect = element.getBoundingClientRect();

  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

export function getParentCard(el: HTMLElement): HTMLElement | null {
  let curr: HTMLElement | null = el;
  while (curr && !curr.id?.startsWith('wikicard')) {
    curr = curr.parentElement;
  }
  return curr;
}

export function getA(event: NostrEvent) {
  const dTag = event.tags.find(([t, v]) => t === 'd' && v)?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

export function hashbow(input: string, lightness: number): string {
  let value = 0;
  for (let i = 0; i < input.length; i++) {
    value += input.charCodeAt(i);
  }
  value **= 17;
  return `hsla(${value % 360}, 76%, ${lightness}%, 1)`;
}

export function getTagOr(event: NostrEvent, tagName: string, dflt: string = '') {
  return event.tags.find(([t]) => t === tagName)?.[1] || dflt;
}

export function isHex32(input: string): boolean {
  return Boolean(input.match(/^[a-f0-9]{64}$/));
}

export function isATag(input: string): boolean {
  return Boolean(input.match(/^\d+:[0-9a-f]{64}:[^:]+$/));
}

export function urlWithoutScheme(url: string): string {
  return url.replace('wss://', '').replace(/\/+$/, '');
}

export function unique<A>(...arrs: A[][]): A[] {
  const result = [];
  for (let i = 0; i < arrs.length; i++) {
    const arr = arrs[i];
    for (let j = 0; j < arr.length; j++) {
      const item = arr[j];
      if (result.indexOf(item) !== -1) continue;
      result.push(item);
    }
  }
  return result;
}

export function addUniqueTaggedReplaceable(haystack: NostrEvent[], needle: NostrEvent): boolean {
  const idx = haystack.findIndex(
    (evt) => evt.pubkey === needle.pubkey && getTagOr(evt, 'd') === getTagOr(needle, 'd')
  );
  if (idx === -1) {
    haystack.push(needle);
    return true;
  }
  if (haystack[idx].created_at < needle.created_at) {
    haystack[idx] = needle;
    return true;
  }

  return false;
}

export function turnWikilinksIntoAsciidocLinks(content: string): string {
  return content.replace(/\[\[(.*?)\]\]/g, (_: any, content: any) => {
    let [target, display] = content.split('|');
    display = display || target;
    
    // Check if this is explicitly marked as a book wikilink with "book:" prefix
    if (target.startsWith('book:')) {
      const bookTarget = target.substring(5); // Remove "book:" prefix
      return `link:book:${bookTarget}[${display}]`;
    }
    
    
    // Check if this is a book wikilink (contains book notation)
    if (isBookWikilink(target)) {
      return `link:book:${target}[${display}]`;
    }
    
    target = normalizeIdentifier(target);
    return `link:wikilink:${target}[${display}]`;
  });
}

export function isBookWikilink(target: string): boolean {
  // Check if the target contains book notation patterns
  // Look for patterns like "John 3:16", "Genesis 1", "Matthew 5-7", etc.
  // Be more specific to avoid false positives
  
  const bookPatterns = [
    // Bible patterns
    // Pattern for numbered books: "1 Samuel 1", "2 Corinthians 3:16", "1 Maccabees 1"
    /^\d*\s*(?:Samuel|Kings|Chronicles|Corinthians|Thessalonians|Timothy|Peter|John|Maccabees|Esdras)\s+\d+(?::\d+)?(?:\s*[-,]\s*\d+)*$/i,
    
    // Pattern for regular Bible books: "Genesis 1", "John 3:16", "Matthew 5-7", "Tobit 1", "Wisdom 1"
    /^(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Galatians|Ephesians|Philippians|Colossians|Titus|Philemon|Hebrews|James|Jude|Revelation|Tobit|Judith|Wisdom|Sirach|Baruch|Prayer of Manasseh|Psalm 151|Additions to Esther|Additions to Daniel|Bel and the Dragon|Susanna|Prayer of Azariah|Song of the Three Young Men)\s+\d+(?::\d+)?(?:\s*[-,]\s*\d+)*$/i,
    
    // Quran patterns: "Al-Fatiha 1", "Surah Al-Baqarah 2:255"
    /^(?:Al-|Ash-|Az-|At-|Ad-)?[A-Za-z][A-Za-z-]+(?:\s+[A-Za-z-]+)*(?:\s+\d+(?::\d+)?(?:\s*[-,]\s*\d+)*)?$/i,
    
    // Catechism patterns: "Article 1:1", "Part I:1"
    /^(?:Article|Art|Part)\s+\d+(?:\s+[A-Za-z-]+)*\s*\d+(?:[-,\s]\d+)*$/i
  ];
  
  return bookPatterns.some(pattern => pattern.test(target.trim()));
}


export function preprocessMarkdownToAsciidoc(content: string): string {
  let processed = content;

  // 1. Process markdown images: ![alt](url "title") -> image::url[alt,title]
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)(?:\s+"([^"]*)")?\)/g, (match, alt, url, title) => {
    const titleAttr = title ? `,${title}` : '';
    return `image::${url}[${alt}${titleAttr}]`;
  });

  // 2. Process markdown links: [text](url "title") -> link:url[text,title]
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)(?:\s+"([^"]*)")?\)/g, (match, text, url, title) => {
    // Skip if it's already a wikilink (handled separately)
    if (url.startsWith('wikilink:')) {
      return match;
    }
    const titleAttr = title ? `,${title}` : '';
    return `link:${url}[${text}${titleAttr}]`;
  });

  // 3. Process markdown tables: | col1 | col2 | -> [cols="1,1"]\n|===\n| col1 | col2 \n|===
  processed = processed.replace(/^(\|[^|\n]*(?:\|[^|\n]*)*\|)\s*$/gm, (match) => {
    const rows = match.trim().split('\n').filter(row => row.trim());
    if (rows.length === 0) return match;
    
    const firstRow = rows[0];
    const colCount = (firstRow.match(/\|/g) || []).length - 1; // Count pipes, subtract 1 for start
    const colSpec = Array(colCount).fill('1').join(',');
    
    const tableRows = rows.map(row => 
      row.trim().replace(/^\||\|$/g, '') // Remove leading/trailing pipes
    ).join('\n| ');
    
    return `[cols="${colSpec}"]\n|===\n| ${tableRows}\n|===`;
  });

  // 4. Process markdown code blocks: ```lang -> [source,lang]----
  processed = processed.replace(/^```(\w+)?\s*\n([\s\S]*?)\n```$/gm, (match, lang, code) => {
    const language = lang || '';
    return `[source,${language}]\n----\n${code}\n----`;
  });

  // 4b. Process inline code blocks with backticks: ```30040``` -> `30040`
  // Only match if it's not a multi-line code block (no newlines, single line)
  processed = processed.replace(/```([^`\n]+)```/g, '`$1`');

  // 5. Process LaTeX within inline code: `$...$` -> `pass:q[latex]...[/latex]`
  // Process LaTeX expressions only when they're within backticks
  processed = processed.replace(/`([^`\n]*\$[^$]+\$[^`\n]*)`/g, (match, code) => {
    // Replace $...$ with LaTeX passthrough within the code block
    const latexProcessed = code.replace(/\$([^$]+)\$/g, 'pass:q[latex]$1[/latex]');
    return `\`${latexProcessed}\``;
  });

  // 7. Process markdown headers: ## Header -> == Header
  processed = processed.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, text) => {
    const level = hashes.length;
    const asciidocLevel = '='.repeat(Math.min(level + 1, 6)); // Asciidoc uses = for headers
    return `${asciidocLevel} ${text}`;
  });

  return processed;
}

export function preprocessContentForAsciidoc(content: string): string {
  // Apply all preprocessing steps in the correct order
  let processed = content;
  
  // 1. First, handle wikilinks (highest priority)
  processed = turnWikilinksIntoAsciidocLinks(processed);
  
  // 2. Then handle other markdown syntax
  processed = preprocessMarkdownToAsciidoc(processed);
  
  // 3. Finally, handle nostr links
  processed = appendLinkMacroToNostrLinks(processed);
  
  return processed;
}

export function appendLinkMacroToNostrLinks(content: string): string {
  // Handle nostr: links that don't already have link: prefix
  // Use a more reliable approach: first replace link:nostr: with a placeholder, then process nostr:, then restore
  let processed = content;
  
  // Step 1: Temporarily replace existing link:nostr: with a placeholder
  processed = processed.replace(/link:nostr:/g, 'LINK_NOSTR_PLACEHOLDER:');
  
  // Step 2: Convert standalone nostr: to link:nostr:
  processed = processed.replace(/nostr:(npub|nprofile|nevent|naddr|note)([a-zA-Z0-9]+)/g, 'link:nostr:$1$2');
  
  // Step 3: Restore the original link:nostr: links
  processed = processed.replace(/LINK_NOSTR_PLACEHOLDER:/g, 'link:nostr:');
  
  // Step 4: Convert link:nostr: to AsciiDoc links with placeholder text
  processed = processed.replace(/link:nostr:([a-zA-Z0-9]+)/g, 'link:#nostr-$1[PLACEHOLDER_NOSTR_LINK]');
  
  return processed;
}

export function normalizeRelayUrl(url: string): string {
  // Handle undefined, null, or empty strings
  if (!url || typeof url !== 'string') {
    return '';
  }
  
  let normalized = url.trim();
  
  // Skip if empty after trimming
  if (!normalized) {
    return '';
  }
  
  // Ensure it starts with ws:// or wss://
  if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
    normalized = 'wss://' + normalized;
  }
  
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');
  
  return normalized;
}

export function deduplicateRelays(relays: string[]): string[] {
  const normalized = relays.map(normalizeRelayUrl).filter(url => url !== '');
  return Array.from(new Set(normalized));
}
