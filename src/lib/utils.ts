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
  const dateday = date.toISOString().split('T')[0];

  const now = Date.now();

  const today = new Date(now).toISOString().split('T')[0];
  if (dateday === today) return 'today';

  const yesterday = new Date(now - 24 * 3600 * 1000).toISOString().split('T')[0];
  if (dateday === yesterday) return 'yesterday';

  if (unixtimestamp > now / 1000 - 24 * 3600 * 90) {
    return Math.round((now / 1000 - unixtimestamp) / (24 * 3600)) + ' days ago';
  }

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
    target = normalizeIdentifier(target);
    return `link:wikilink:${target}[${display}]`;
  });
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
  // Handle both link:nostr: and nostr: prefixes
  let processed = content.replace(/nostr:/g, 'link:nostr:');
  // Also handle standalone nostr links that might not have been caught
  processed = processed.replace(/(?<!link:)nostr:(npub|nprofile|nevent|naddr|note)[a-zA-Z0-9]+/g, 'link:$&');
  return processed;
}

export function normalizeRelayUrl(url: string): string {
  let normalized = url.trim();
  
  // Ensure it starts with ws:// or wss://
  if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
    normalized = 'wss://' + normalized;
  }
  
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');
  
  return normalized;
}

export function deduplicateRelays(relays: string[]): string[] {
  const normalized = relays.map(normalizeRelayUrl);
  return Array.from(new Set(normalized));
}
