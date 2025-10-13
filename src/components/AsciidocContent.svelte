<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import asciidoctor from '@asciidoctor/core';
  import { onMount } from 'svelte';
  import { loadWikiAuthors } from '@nostr/gadgets/lists';
  import type { Card } from '$lib/types';
  import { preprocessContentForAsciidoc } from '$lib/utils';
  import hljs from 'highlight.js';
  import { nip19 } from '@nostr/tools';
  import { pool } from '@nostr/gadgets/global';
  import { DEFAULT_METADATA_QUERY_RELAYS } from '$lib/defaults';
  import ProfilePopup from './ProfilePopup.svelte';

  interface Props {
    event: NostrEvent;
    createChild: (card: Card) => void;
  }

  let { event, createChild }: Props = $props();

  let authorPreferredWikiAuthors = $state<string[]>([]);
  let htmlContent = $state<string>('');
  let contentDiv: HTMLElement;
  let userCache = $state<Map<string, any>>(new Map());
  
  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');

  // Reactive statement to apply highlighting when content changes
  $effect(() => {
    if (htmlContent && contentDiv) {
      applySyntaxHighlighting();
    }
  });

  // Decode Nostr NIP-19 bech32 strings
  function decodeNostrLink(bech32: string): { type: string; data: any } | null {
    try {
      const decoded = nip19.decode(bech32);
      return decoded;
    } catch (e) {
      return null;
    }
  }

  // Get display name for a pubkey with fallbacks
  async function getDisplayName(pubkey: string): Promise<string> {
    // Check cache first
    if (userCache.has(pubkey)) {
      const user = userCache.get(pubkey);
      return (user as any).display_name || (user as any).name || (user as any).shortName || `npub1${pubkey.slice(0, 8)}...`;
    }
    
    try {
      // Fetch user metadata directly using the metadata query relays
      const user = await new Promise((resolve) => {
        let userData: any = null;
        const sub = pool.subscribeMany(
          DEFAULT_METADATA_QUERY_RELAYS,
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          {
            onevent(event) {
              if (event.pubkey === pubkey) {
                try {
                  const content = JSON.parse(event.content);
                  userData = {
                    pubkey: event.pubkey,
                    display_name: content.display_name,
                    name: content.name,
                    shortName: content.display_name || content.name || `npub1${pubkey.slice(0, 8)}...`,
                    ...content
                  };
                } catch (e) {
                  console.error('Failed to parse user metadata:', e);
                }
              }
            },
            oneose() {
              sub.close();
              resolve(userData);
            }
          }
        );
        
        // Timeout after 3 seconds
        setTimeout(() => {
          sub.close();
          resolve(userData);
        }, 3000);
      });
      
      console.log('Direct metadata fetch result:', { pubkey, user });
      
      if (user) {
        userCache.set(pubkey, user);
        // Return display_name -> name -> shortName -> shortened npub fallback
        return (user as any).display_name || (user as any).name || (user as any).shortName || `npub1${pubkey.slice(0, 8)}...`;
      } else {
        // If no metadata found, return shortened npub
        return `npub1${pubkey.slice(0, 8)}...`;
      }
    } catch (e) {
      console.log('Direct metadata fetch error:', { pubkey, error: e });
      // If fetch fails, return shortened npub
      return `npub1${pubkey.slice(0, 8)}...`;
    }
  }
  2
  // Process Nostr links in HTML (async version)
  async function processNostrLinks(html: string): Promise<string> {
    let processed = html;
    
    // Process link:nostr: and nostr: links
    const linkMatches = processed.match(/<a[^>]*href="(?:link:)?nostr:([^"]+)"[^>]*>([^<]*)<\/a>/g);
    
    if (linkMatches) {
      for (const match of linkMatches) {
        const bech32Match = match.match(/href="(?:link:)?nostr:([^"]+)"/);
        if (!bech32Match) continue;
        
        const bech32 = bech32Match[1];
        const decoded = decodeNostrLink(bech32);
        if (!decoded) continue;
        
        const { type, data } = decoded;
        
        if (type === 'npub' || type === 'nprofile') {
          const pubkey = type === 'npub' ? data : data.pubkey;
          const displayName = await getDisplayName(pubkey);
          const replacement = `<span class="nostr-user-link" data-pubkey="${pubkey}" data-bech32="${bech32}" style="color: #059669; cursor: pointer; text-decoration: underline;">@${displayName}</span>`;
          processed = processed.replace(match, replacement);
        } else if (type === 'nevent' || type === 'naddr' || type === 'note') {
          const identifier = data.identifier || data.id || bech32.slice(0, 16) + '...';
          const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" style="color: #059669; cursor: pointer; text-decoration: underline;">${identifier}</span>`;
          processed = processed.replace(match, replacement);
        }
      }
    }
    
    return processed;
  }

  // Postprocessor to handle leftover markdown tags that AsciiDoc might miss
  async function postprocessHtml(html: string): Promise<string> {
    // Handle any leftover markdown tags that AsciiDoc didn't process
    let processed = html;
    
    // Process Nostr links first (async)
    processed = await processNostrLinks(processed);
    
    // Convert leftover markdown images: ![alt](url "title") -> <img alt="alt" src="url" title="title">
    processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)(?:\s+"([^"]*)")?\)/g, (match, alt, url, title) => {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img alt="${alt}" src="${url}"${titleAttr}>`;
    });
    
    // Convert leftover markdown links: [text](url "title") -> <a href="url" title="title">text</a>
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)(?:\s+"([^"]*)")?\)/g, (match, text, url, title) => {
      // Skip if it's already a wikilink (handled separately)
      if (url.startsWith('wikilink:')) {
        return match;
      }
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${url}"${titleAttr}>${text}</a>`;
    });
    
    // Convert leftover markdown tables: | col1 | col2 | -> proper HTML table
    processed = processed.replace(/^(\|[^|\n]*(?:\|[^|\n]*)*\|)\s*$/gm, (match) => {
      const rows = match.trim().split('\n').filter(row => row.trim());
      if (rows.length === 0) return match;
      
      const firstRow = rows[0];
      const colCount = (firstRow.match(/\|/g) || []).length - 1; // Count pipes, subtract 1 for start
      
      let tableHtml = '<table class="table-auto border-collapse border border-gray-300">';
      
      rows.forEach((row, index) => {
        const cells = row.trim().split('|').filter(cell => cell.trim());
        if (index === 0) {
          // Header row
          tableHtml += '<thead><tr>';
          cells.forEach(cell => {
            tableHtml += `<th class="border border-gray-300 px-4 py-2 bg-gray-100">${cell.trim()}</th>`;
          });
          tableHtml += '</tr></thead>';
        } else {
          // Data row
          if (index === 1) tableHtml += '<tbody>';
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td class="border border-gray-300 px-4 py-2">${cell.trim()}</td>`;
          });
          tableHtml += '</tr>';
        }
      });
      
      tableHtml += '</tbody></table>';
      return tableHtml;
    });
    
    return processed;
  }

  // Apply syntax highlighting to code blocks
  function applySyntaxHighlighting() {
    if (contentDiv) {
      // Highlight all code blocks
      contentDiv.querySelectorAll('pre code').forEach((block) => {
        const element = block as HTMLElement;
        // Only highlight if it has a language class
        if (element.className.includes('language-') && !element.className.includes('language-undefined')) {
          hljs.highlightElement(element);
        }
      });
      
      // Highlight inline code that might have been missed
      contentDiv.querySelectorAll('code:not(pre code)').forEach((block) => {
        const element = block as HTMLElement;
        // Only highlight if it has a language class and it's not undefined
        if (element.className.includes('language-') && !element.className.includes('language-undefined')) {
          hljs.highlightElement(element);
        }
      });
    }
  }

  onMount(async () => {
    // Load preferred authors
    loadWikiAuthors(event.pubkey).then((ps) => {
      authorPreferredWikiAuthors = ps.items;
    });

    // Process the content with AsciiDoc
    const content = preprocessContentForAsciidoc(event.content);
    
    // Configure AsciiDoc processor
    const asciiDoc = asciidoctor();
    const doc = asciiDoc.load(content, {
      safe: 'safe',
      backend: 'html5',
      doctype: 'article',
      attributes: {
        'source-highlighter': 'highlightjs',
        'highlightjs-theme': 'github'
      }
    });

    // Convert to HTML and postprocess (async)
    let html = doc.convert();
    html = await postprocessHtml(html);
    htmlContent = html;
    
    // Apply syntax highlighting after the HTML is rendered
    setTimeout(() => {
      applySyntaxHighlighting();
    }, 0);
  });

  // Handle clicks on links to create child cards
  function handleLinkClick(clickEvent: MouseEvent) {
    const target = clickEvent.target as HTMLElement;
    
    // Handle wikilinks
    if (target.tagName === 'A') {
      const href = target.getAttribute('href');
      if (href?.startsWith('wikilink:')) {
        clickEvent.preventDefault();
        const identifier = href.replace('wikilink:', '');
        createChild({
          id: Math.random(),
          type: 'find',
          data: identifier,
          preferredAuthors: [event.pubkey, ...authorPreferredWikiAuthors]
        } as any);
      }
    }
    
    // Handle Nostr user links
    if (target.classList.contains('nostr-user-link')) {
      clickEvent.preventDefault();
      const pubkey = target.getAttribute('data-pubkey');
      const bech32 = target.getAttribute('data-bech32');
      if (pubkey && bech32) {
        selectedUserPubkey = pubkey;
        selectedUserBech32 = bech32;
        profilePopupOpen = true;
      }
    }
    
    // Handle Nostr event links
    if (target.classList.contains('nostr-event-link')) {
      clickEvent.preventDefault();
      const bech32 = target.getAttribute('data-bech32');
      const type = target.getAttribute('data-type');
      if (bech32 && type) {
        // For now, just log the event - we could add event display later
        console.log('Clicked event:', type, bech32);
      }
    }
  }

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div 
  bind:this={contentDiv}
  class="prose prose-sm max-w-none"
  onclick={handleLinkClick}
>{@html htmlContent}</div>

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
/>

<style>
  :global(.prose code) {
    @apply bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono;
  }
  
  :global(.prose pre) {
    @apply overflow-x-auto bg-gray-50 p-4 rounded-md;
  }
  
  :global(.prose pre code) {
    @apply bg-transparent p-0 rounded-none;
  }

  /* Ensure proper styling for postprocessed markdown elements */
  :global(.prose strong) {
    @apply font-bold;
  }
  
  :global(.prose em) {
    @apply italic;
  }

  /* Highlight.js theme integration */
  :global(.prose .hljs) {
    @apply bg-gray-50;
  }

  /* Table styling for postprocessed markdown tables */
  :global(.prose table) {
    @apply w-full border-collapse border border-gray-300;
  }
  
  :global(.prose th) {
    @apply border border-gray-300 px-4 py-2 bg-gray-100 font-semibold;
  }
  
  :global(.prose td) {
    @apply border border-gray-300 px-4 py-2;
  }
  
  :global(.prose img) {
    @apply max-w-full h-auto rounded;
  }

  /* Nostr link styling */
  :global(.nostr-user-link) {
    @apply text-green-600 hover:text-green-800 cursor-pointer underline;
  }
  
  :global(.nostr-event-link) {
    @apply text-green-600 hover:text-green-800 cursor-pointer underline;
  }
</style>
