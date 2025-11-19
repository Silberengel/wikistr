<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import asciidoctor from '@asciidoctor/core';
  import { onMount, onDestroy } from 'svelte';
  import { loadWikiAuthors } from '@nostr/gadgets/lists';
  import type { Card } from '$lib/types';
  import { preprocessContentForAsciidoc } from '$lib/utils';
  import hljs from 'highlight.js';
  import { nip19 } from '@nostr/tools';
  import katex from 'katex';
  import { pool } from '@nostr/gadgets/global';
  import { relayService } from '$lib/relayService';
  import { type NostrUser } from '@nostr/gadgets/metadata';
  import { next } from '$lib/utils';
  import type { ArticleCard } from '$lib/types';
  import ProfilePopup from './ProfilePopup.svelte';
  import UserBadge from './UserBadge.svelte';
  import EmbeddedEvent from './EmbeddedEvent.svelte';
  import BookSearch from './BookSearch.svelte';
  import { parseBookWikilink } from '$lib/books';
  import BookPassageGroup from './BookPassageGroup.svelte';
  import { mount, unmount } from 'svelte';

  interface Props {
    event: NostrEvent;
    createChild: (card: Card) => void;
    replaceSelf?: (card: Card) => void;
  }

  let { event, createChild, replaceSelf }: Props = $props();

  let authorPreferredWikiAuthors = $state<string[]>([]);
  let htmlContent = $state<string>('');
  let isLoading = $state(false);
  let contentDiv: HTMLElement;
  let userCache = $state<Map<string, any>>(new Map());
  
  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');
  let embeddedEvents = $state<Array<{id: string, bech32: string, type: 'nevent' | 'note' | 'naddr'}>>([]);
  let bookSearchResults = $state<Array<{id: string, query: string, results: any[], bookType?: string}>>([]);
  let readInsteadData = $state<Array<{id: string, naddr: string, pubkey: string, identifier: string, displayName: string}>>([]);
  let bookstrPassages = $state<Array<{id: string, content: string}>>([]);
  let mountedBookstrComponents = new Map<string, any>();

  // Global functions for dynamically generated HTML
  function handleProfileAvatarClick(pubkey: string) {
    selectedUserPubkey = pubkey;
    selectedUserBech32 = nip19.npubEncode(pubkey);
    profilePopupOpen = true;
  }

  function handleProfileUsernameClick(pubkey: string) {
    // Create a search card for this user
    const searchCard: Card = {
      id: next(),
      type: 'find',
      data: `author:${pubkey}`,
      preferredAuthors: []
    };
    createChild(searchCard);
  }

  function handleReadInsteadClick(naddr: string) {
    try {
      const decoded = decodeNostrLink(naddr);
      if (decoded && decoded.type === 'naddr') {
        const { data } = decoded;
        const wikilinkCard = {
          id: next(),
          type: 'article' as const,
          data: [data.identifier, data.pubkey] as [string, string],
          relayHints: []
        };

        if (replaceSelf) {
          replaceSelf(wikilinkCard);
        } else {
          createChild(wikilinkCard);
        }
      } else {
        console.error('Failed to decode naddr or invalid type:', naddr);
      }
    } catch (error) {
      console.error('Error processing read instead link:', error);
    }
  }

  // Make functions globally available for inline HTML
  if (typeof window !== 'undefined') {
    (window as any).handleProfileAvatarClick = handleProfileAvatarClick;
    (window as any).handleProfileUsernameClick = handleProfileUsernameClick;
  }

  // Function to add embedded event (prevents duplicates)
  function addEmbeddedEvent(bech32: string, type: 'nevent' | 'note' | 'naddr') {
    // Check if this bech32 is already embedded
    const exists = embeddedEvents.some(event => event.bech32 === bech32);
    if (!exists) {
      const eventId = `embedded-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      embeddedEvents = [...embeddedEvents, { id: eventId, bech32, type }];
    }
  }

  // Function to remove embedded event
  function removeEmbeddedEvent(eventId: string) {
    embeddedEvents = embeddedEvents.filter(event => event.id !== eventId);
  }

  // Function to add book search (prevents duplicates)
  function addBookSearch(query: string, bookType: string = 'bible') {
    // Check if this query is already being searched
    const exists = bookSearchResults.some(search => search.query === query && search.bookType === bookType);
    if (!exists) {
      const searchId = `book-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      bookSearchResults = [...bookSearchResults, { id: searchId, query, results: [], bookType }];
    }
  }

  // Function to remove book search
  function removeBookSearch(searchId: string) {
    bookSearchResults = bookSearchResults.filter(search => search.id !== searchId);
  }

  // Function to update book search results
  function updateBookSearchResults(searchId: string, results: any[]) {
    bookSearchResults = bookSearchResults.map(search => 
      search.id === searchId ? { ...search, results } : search
    );
  }

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
      // Fetch user metadata using relayService
      const result = await relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        {
          excludeUserContent: false,
          currentUserPubkey: undefined
        }
      );

      const userEvent = result.events.find(event => event.pubkey === pubkey);
      if (userEvent) {
        try {
          const content = JSON.parse(userEvent.content);
          const user = {
            pubkey: userEvent.pubkey,
            display_name: content.display_name,
            name: content.name,
            shortName: content.display_name || content.name || `npub1${pubkey.slice(0, 8)}...`,
            ...content
          };
          userCache.set(pubkey, user);
          return user.shortName;
        } catch (e) {
          console.error('Failed to parse user metadata:', e);
        }
      }
      
      // If no metadata found, return shortened npub
      return `npub1${pubkey.slice(0, 8)}...`;
    } catch (e) {
      // If fetch fails, return shortened npub
      return `npub1${pubkey.slice(0, 8)}...`;
    }
  }

  // Fetch and display an embedded event
  async function openEmbeddedEvent(bech32: string, type: string) {
    try {
      const decoded = decodeNostrLink(bech32);
      if (!decoded) return;
      
      const { data } = decoded;
      let eventId: string | null = null;
      let author: string | null = null;
      
      if (type === 'nevent') {
        eventId = data.id;
        author = data.author || null;
      } else if (type === 'note') {
        eventId = data;
        // For notes, we need to fetch to get the author
      } else if (type === 'naddr') {
        // For naddr, we need to fetch by kind + author + d-tag
        const kind = data.kind;
        author = data.pubkey;
        const dTag = data.identifier;
        
        // Create a search card for the naddr
        const searchCard = {
          id: next(),
          type: 'find' as const,
          data: dTag,
          preferredAuthors: author ? [author] : []
        };
        createChild(searchCard);
        return;
      }
      
      if (!eventId) return;
      
      // Fetch the event by ID using relayService
      try {
        const result = await relayService.queryEvents(
          'anonymous',
          'wiki-read',
          [{ ids: [eventId], limit: 1 }],
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );

        const fetchedEvent = result.events.find(evt => evt.id === eventId) || null;
        
        if (fetchedEvent) {
        // Create an ArticleCard for the fetched event
        const dTag = fetchedEvent.tags.find(([k]) => k === 'd')?.[1] || fetchedEvent.id;
        const articleCard: ArticleCard = {
          id: next(),
          type: 'article',
          data: [dTag, fetchedEvent.pubkey],
          relayHints: [],
          actualEvent: fetchedEvent
        };
        createChild(articleCard);
        } else {
          console.log(`Event ${bech32} not found`);
        }
      } catch (e) {
        console.error('Failed to fetch embedded event:', e);
      }
    } catch (e) {
      console.error('Failed to fetch embedded event:', e);
    }
  }

  // Process Nostr links in HTML (async version)
  async function processNostrLinks(html: string): Promise<string> {
    let processed = html;
    
    // Process "Read naddr... instead." pattern
    const readInsteadMatches = processed.match(/Read (naddr[a-zA-Z0-9]+) instead\./g);
    if (readInsteadMatches) {
      for (const match of readInsteadMatches) {
        const naddrMatch = match.match(/Read (naddr[a-zA-Z0-9]+) instead\./);
        if (!naddrMatch) continue;
        
        const naddr = naddrMatch[1];
        const decoded = decodeNostrLink(naddr);
        if (!decoded || decoded.type !== 'naddr') continue;
        
        const { data } = decoded;
        const pubkey = data.pubkey;
        const identifier = data.identifier || 'wiki article';
        const displayName = await getDisplayName(pubkey);
        
        // Store the read instead data for rendering as a component
        const readInsteadId = `read-instead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        readInsteadData.push({
          id: readInsteadId,
          naddr,
          pubkey,
          identifier,
          displayName
        });
        
        // Replace with a placeholder that will be rendered as a component
        const replacement = `<div class="read-instead-placeholder" data-id="${readInsteadId}"></div>`;
        processed = processed.replace(match, replacement);
      }
    }
    
    // Process anchor links with nostr: data (our new format)
    const anchorMatches = processed.match(/<a[^>]*href="#nostr-([^"]+)"[^>]*>([^<]*)<\/a>/g);
    
    if (anchorMatches) {
      for (const match of anchorMatches) {
        const bech32Match = match.match(/href="#nostr-([^"]+)"/);
        if (!bech32Match) continue;
        
        const bech32 = bech32Match[1];
        const decoded = decodeNostrLink(bech32);
        if (!decoded) continue;
        
        const { type, data } = decoded;
        
        if (type === 'npub' || type === 'nprofile') {
          const pubkey = type === 'npub' ? data : data.pubkey;
          const displayName = await getDisplayName(pubkey);
          const replacement = `<span class="nostr-user-link" data-pubkey="${pubkey}" data-bech32="${bech32}" >@${displayName}</span>`;
          processed = processed.replace(match, replacement);
        } else if (type === 'nevent' || type === 'note') {
          // For nevent and note, show the full bech32 format
          const displayText = bech32.slice(0, 20) + '...';
          const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" >${displayText}</span>`;
          processed = processed.replace(match, replacement);
        } else if (type === 'naddr') {
          // For naddr, show the identifier or shortened bech32
          const identifier = data.identifier || bech32.slice(0, 20) + '...';
          const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" >${identifier}</span>`;
          processed = processed.replace(match, replacement);
        }
      }
    }
    
    // Also handle direct nostr: links (fallback for any that might still exist)
    const linkMatches = processed.match(/<a[^>]*href="nostr:([^"]+)"[^>]*>([^<]*)<\/a>/g);
    
    if (linkMatches) {
      for (const match of linkMatches) {
        const bech32Match = match.match(/href="nostr:([^"]+)"/);
        if (!bech32Match) continue;
        
        const bech32 = bech32Match[1];
        const decoded = decodeNostrLink(bech32);
        if (!decoded) continue;
        
        const { type, data } = decoded;
        
        if (type === 'npub' || type === 'nprofile') {
          const pubkey = type === 'npub' ? data : data.pubkey;
          const displayName = await getDisplayName(pubkey);
          const replacement = `<span class="nostr-user-link" data-pubkey="${pubkey}" data-bech32="${bech32}" >@${displayName}</span>`;
          processed = processed.replace(match, replacement);
        } else if (type === 'nevent' || type === 'note') {
          // For nevent and note, show the full bech32 format
          const displayText = bech32.slice(0, 20) + '...';
          const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" >${displayText}</span>`;
          processed = processed.replace(match, replacement);
        } else if (type === 'naddr') {
          // For naddr, show the identifier or shortened bech32
          const identifier = data.identifier || bech32.slice(0, 20) + '...';
          const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" >${identifier}</span>`;
          processed = processed.replace(match, replacement);
        }
      }
    }
    
    // Clean up any remaining placeholder text
    processed = processed.replace(/PLACEHOLDER_NOSTR_LINK/g, '');
    
    return processed;
  }

  // Process LaTeX expressions in raw text
  function processLatexExpressions(text: string): string {
    // Handle inline LaTeX: $expression$ -> rendered math
    return text.replace(/\$([^$]+)\$/g, (match, expression) => {
      try {
        const rendered = katex.renderToString(expression, {
          throwOnError: false,
          displayMode: false,
          output: 'html'
        });
        return rendered;
      } catch (error) {
        console.warn('LaTeX rendering error:', error);
        return match; // Keep original if rendering fails
      }
    });
  }


  // Enhanced Nostr link processing
  async function processNostrLinksEnhanced(text: string): Promise<string> {
    let processed = text;
    
    // Process standalone nostr: links (not already in HTML)
    const nostrMatches = processed.match(/nostr:([a-zA-Z0-9]+)/g);
    if (nostrMatches) {
      for (const match of nostrMatches) {
        const bech32 = match.replace('nostr:', '');
        const decoded = decodeNostrLink(bech32);
        if (decoded) {
          const { type, data } = decoded;
          
          if (type === 'npub' || type === 'nprofile') {
            const pubkey = type === 'npub' ? data : data.pubkey;
            const displayName = await getDisplayName(pubkey);
            const replacement = `<span class="nostr-user-link" data-pubkey="${pubkey}" data-bech32="${bech32}" style="color: var(--accent); cursor: pointer;">@${displayName}</span>`;
            processed = processed.replace(match, replacement);
          } else if (type === 'nevent' || type === 'note') {
            const displayText = bech32.slice(0, 20) + '...';
            const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" style="color: var(--accent); cursor: pointer;">${displayText}</span>`;
            processed = processed.replace(match, replacement);
          } else if (type === 'naddr') {
            const identifier = data.identifier || bech32.slice(0, 20) + '...';
            const replacement = `<span class="nostr-event-link" data-bech32="${bech32}" data-type="${type}" style="color: var(--accent); cursor: pointer;">${identifier}</span>`;
            processed = processed.replace(match, replacement);
          }
        }
      }
    }
    
    return processed;
  }

  // Convert Markdown syntax to AsciiDoc syntax
  function convertMarkdownToAsciiDoc(markdown: string): string {
    let asciidoc = markdown;
    
    // Convert strikethrough: ~~text~~ -> [line-through]#text#
    asciidoc = asciidoc.replace(/~~([^~]+)~~/g, '[line-through]#$1#');
    
    // Convert code blocks: ```lang ... ``` -> [source,lang]
    asciidoc = asciidoc.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const langAttr = lang ? `,${lang}` : '';
      return `[source${langAttr}]\n----\n${code.trim()}\n----`;
    });

    // Convert images: ![alt](url) -> image:url[alt]
    asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 'image::$2[$1]');
    
    // Convert links: [text](url) -> link:text[text]
    asciidoc = asciidoc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 'link:$2[$1]');
    
    // Convert tables: | col1 | col2 | -> [cols="1,1"]
    asciidoc = asciidoc.replace(/^(\|[^|\n]*(?:\|[^|\n]*)*\|)\s*(?:\n\s*\|[^|\n]*(?:\|[^|\n]*)*\|)*\s*$/gm, (match) => {
      const rows = match.trim().split('\n').filter(row => row.trim());
      if (rows.length === 0) return match;
      
      // Check if this is a proper markdown table (has header separator)
      const hasHeaderSeparator = rows.some(row => {
        const cells = row.trim().split('|').filter(cell => cell.trim());
        return cells.every(cell => /^-+$/.test(cell.trim()));
      });
      
      if (!hasHeaderSeparator) return match; // Not a proper table, skip
      
      const firstRow = rows[0];
      const colCount = (firstRow.match(/\|/g) || []).length - 1;
      
      let asciidocTable = `[cols="${'1,'.repeat(colCount).slice(0, -1)}"]\n|===\n`;
      
      rows.forEach((row, index) => {
        const cells = row.trim().split('|').filter(cell => cell.trim());
        // Skip separator rows (rows with only dashes)
        if (cells.every(cell => /^-+$/.test(cell.trim()))) {
          return;
        }
        
        // Build the row with all cells on one line
        let rowContent = '';
        cells.forEach(cell => {
          const trimmedCell = cell.trim();
          // For header row (first row after separator), make it bold
          if (index === 0) {
            rowContent += `|*${trimmedCell}*`;
          } else {
            rowContent += `|${trimmedCell}`;
          }
        });
        asciidocTable += rowContent + '\n';
      });
      
      asciidocTable += '|===';
      return asciidocTable;
    });
    
    return asciidoc;
  }

  // Detect if content is primarily Markdown vs AsciiDoc
  function detectMarkdownContent(content: string): boolean {
    // Count Markdown indicators
    const markdownIndicators = [
      /^#{1,6}\s+/gm,           // Headers
      /```[\s\S]*?```/,         // Code blocks
      /^\|.*\|$/gm,             // Tables
      /!\[.*?\]\(.*?\)/,        // Images
      /\[.*?\]\(.*?\)/,         // Links
    ];
    
    // Count AsciiDoc indicators
    const asciidocIndicators = [
      /^=+\s+/gm,               // AsciiDoc headers
      /\[\[.*?\]\]/,            // AsciiDoc links
      /^\[source,/gm,           // Source blocks
      /^\[NOTE\]/gm,            // Admonitions
    ];
    
    let markdownScore = 0;
    let asciidocScore = 0;
    
    markdownIndicators.forEach(regex => {
      const matches = content.match(regex);
      if (matches) markdownScore += matches.length;
    });
    
    asciidocIndicators.forEach(regex => {
      const matches = content.match(regex);
      if (matches) asciidocScore += matches.length;
    });
    
    // If we have significantly more Markdown indicators, treat as Markdown
    return markdownScore > asciidocScore && markdownScore > 0;
  }

  // Postprocessor to handle Nostr-specific features after AsciiDoc processing
  async function postprocessHtml(html: string): Promise<string> {
    let processed = html;
    
    // Process Nostr links in the HTML output
    processed = await processNostrLinks(processed);
    
    // Process standalone nostr: links that might not be in HTML yet
    processed = await processNostrLinksEnhanced(processed);
    
    // Process LaTeX expressions in inline code elements
    processed = processed.replace(/<code>([^<]+)<\/code>/g, (match, codeContent) => {
      // Check if this is a LaTeX expression
      const latexMatch = codeContent.match(/^\$([^$]+)\$$/);
      if (latexMatch) {
        try {
          const rendered = katex.renderToString(latexMatch[1], {
            throwOnError: false,
            displayMode: false,
            output: 'html'
          });
          return rendered;
        } catch (error) {
          console.warn('LaTeX rendering error:', error);
          return match; // Keep original if rendering fails
        }
      }
      return match; // Not LaTeX, keep as-is
    });
    
    return processed;
  }

  // Apply syntax highlighting to code blocks
  function applySyntaxHighlighting() {
    if (contentDiv) {
      // AsciiDoc is already handling highlighting, so we just need to ensure
      // any code blocks without proper highlighting get processed
      contentDiv.querySelectorAll('pre code').forEach((block) => {
        const element = block as HTMLElement;
        
        // Only process if not already highlighted by AsciiDoc
        if (!element.className.includes('hljs')) {
          // Get the current language class
          const currentLang = element.className.match(/language-(\w+)/);
          const lang = currentLang ? currentLang[1] : null;
          
          try {
          if (lang && lang !== 'undefined' && lang !== 'none') {
              // Check if the language is registered in highlight.js
              const language = hljs.getLanguage(lang);
              if (language) {
                // Language is registered, highlight with it
            hljs.highlightElement(element);
              } else {
                // Language not registered, remove the language class and try auto-detect
                // This prevents the warning about missing language module
                element.className = element.className.replace(/language-\w+/g, '');
                hljs.highlightElement(element);
              }
          } else {
            // No language class, try to auto-detect
            hljs.highlightElement(element);
            }
          } catch (error) {
            // Silently ignore highlighting errors for unknown languages
            // The code will still be displayed, just without syntax highlighting
          }
          
          // Add line numbers after highlighting
          addLineNumbers(element);
        }
      });
      
      // Add copy and word-wrap buttons to all code blocks
      addCodeBlockButtons();
    }
  }
  
  // Add copy and word-wrap buttons to code blocks
  function addCodeBlockButtons() {
    if (!contentDiv) {
      console.log('addCodeBlockButtons: contentDiv is null');
      return;
    }
    
    const preElements = contentDiv.querySelectorAll('pre');
    console.log(`addCodeBlockButtons: Found ${preElements.length} pre elements`);
    
    preElements.forEach((preElement, index) => {
      // Skip if buttons already added
      if (preElement.querySelector('.code-block-controls')) {
        console.log(`addCodeBlockButtons: Skipping pre[${index}] - buttons already added`);
        return;
      }
      
      const codeElement = preElement.querySelector('code');
      if (!codeElement) {
        console.log(`addCodeBlockButtons: Skipping pre[${index}] - no code element found`);
        return;
      }
      
      console.log(`addCodeBlockButtons: Processing pre[${index}]`);
      
      // Create wrapper div with relative positioning
      const wrapper = document.createElement('div');
      wrapper.className = 'relative code-block-wrapper';
      wrapper.style.position = 'relative';
      wrapper.style.width = '100%';
      wrapper.style.overflow = 'visible';
      
      // Create controls container
      const controls = document.createElement('div');
      controls.className = 'code-block-controls';
      controls.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 8px; z-index: 10;';
      
      // Word-wrap button
      const wrapButton = document.createElement('button');
      wrapButton.className = 'code-wrap-btn';
      wrapButton.style.cssText = 'padding: 6px; border-radius: 4px; background: transparent; border: none; cursor: pointer; color: var(--text-secondary); transition: background-color 0.2s;';
      wrapButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 16px; height: 16px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
      `;
      wrapButton.title = 'Toggle word wrap';
      
      let wordWrapEnabled = true; // ON by default
      // Set default - use data attribute for reliable CSS control
      preElement.setAttribute('data-word-wrap', 'enabled');
      console.log(`addCodeBlockButtons: Set initial data-word-wrap="enabled" on pre[${index}]`);
      
      wrapButton.addEventListener('mouseenter', () => {
        wrapButton.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      });
      wrapButton.addEventListener('mouseleave', () => {
        wrapButton.style.backgroundColor = 'transparent';
      });
      
      wrapButton.addEventListener('click', (e) => {
        console.log('Word-wrap button clicked!', e);
        e.preventDefault();
        e.stopPropagation();
        wordWrapEnabled = !wordWrapEnabled;
        console.log(`Word-wrap state changed to: ${wordWrapEnabled}`);
        // Use data attribute to trigger CSS rules
        if (wordWrapEnabled) {
          preElement.setAttribute('data-word-wrap', 'enabled');
          console.log('Set data-word-wrap="enabled"');
        } else {
          preElement.setAttribute('data-word-wrap', 'disabled');
          console.log('Set data-word-wrap="disabled"');
        }
        console.log('Pre element attributes:', Array.from(preElement.attributes).map(a => `${a.name}="${a.value}"`).join(', '));
        console.log('Computed white-space:', window.getComputedStyle(preElement).whiteSpace);
        console.log('Computed overflow-x:', window.getComputedStyle(preElement).overflowX);
        // Force a reflow to ensure the change takes effect
        void preElement.offsetWidth;
      });
      
      console.log(`addCodeBlockButtons: Added word-wrap button to pre[${index}]`);
      
      // Copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'code-copy-btn';
      copyButton.style.cssText = 'padding: 6px; border-radius: 4px; background: transparent; border: none; cursor: pointer; color: var(--text-secondary); transition: background-color 0.2s;';
      copyButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 16px; height: 16px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      `;
      copyButton.title = 'Copy code';
      
      copyButton.addEventListener('mouseenter', () => {
        copyButton.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      });
      copyButton.addEventListener('mouseleave', () => {
        copyButton.style.backgroundColor = 'transparent';
      });
      
      copyButton.addEventListener('click', async () => {
        // Extract code text, excluding line numbers if present
        let codeText = '';
        
        // Check if line numbers table exists
        const lineNumbersTable = preElement.querySelector('.line-numbers-table');
        if (lineNumbersTable) {
          // Extract only the code content from the table
          const codeContentCell = lineNumbersTable.querySelector('.code-content');
          if (codeContentCell) {
            codeText = codeContentCell.textContent || '';
          } else {
            // Fallback: try to get text from code element
            codeText = codeElement.textContent || '';
          }
        } else {
          // No line numbers, just get the code text directly
          codeText = codeElement.textContent || '';
        }
        
        try {
          await navigator.clipboard.writeText(codeText);
          // Show checkmark temporarily
          const originalHTML = copyButton.innerHTML;
          copyButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 16px; height: 16px; color: var(--accent);">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          `;
          setTimeout(() => {
            copyButton.innerHTML = originalHTML;
          }, 2000);
        } catch (e) {
          console.error('Failed to copy code:', e);
        }
      });
      
      controls.appendChild(wrapButton);
      controls.appendChild(copyButton);
      wrapper.appendChild(controls);
      
      // Wrap the pre element
      preElement.parentNode?.insertBefore(wrapper, preElement);
      wrapper.appendChild(preElement);
    });
  }

  // Add line numbers to code blocks
  function addLineNumbers(codeElement: HTMLElement) {
    const preElement = codeElement.parentElement;
    if (!preElement || preElement.tagName !== 'PRE') return;
    
    // Skip if already has line numbers
    if (preElement.querySelector('.line-numbers-table')) return;
    
    // Get the code content
    const codeContent = codeElement.innerHTML;
    const lines = codeContent.split('\n');
    const lineCount = lines.length;
    
    // Generate line numbers
    const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
    
    // Create table structure for line numbers
    const tableHTML = `
      <table class="line-numbers-table">
        <tr>
          <td class="line-numbers">${lineNumbers}</td>
          <td class="code-content">${codeContent}</td>
        </tr>
      </table>
    `;
    
    // Replace the code content with the table
    codeElement.innerHTML = tableHTML;
  }

  // Render LaTeX expressions in inline code
  function renderLatexExpressions() {
    if (contentDiv) {
      contentDiv.querySelectorAll('code:not(pre code)').forEach((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent || '';
        
        // Check if this is a LaTeX expression (starts with latex and ends with [/latex])
        const latexMatch = text.match(/^latex(.+?)\[\/latex\]$/);
        if (latexMatch && !htmlElement.dataset.latexRendered) {
          try {
            const latexContent = latexMatch[1];
            const rendered = katex.renderToString(latexContent, {
              throwOnError: false,
              displayMode: false, // inline mode
              output: 'html'
            });
            htmlElement.innerHTML = rendered;
            htmlElement.dataset.latexRendered = 'yes';
          } catch (error) {
            console.warn('LaTeX rendering error:', error);
            // Keep original text if rendering fails
          }
        }
      });
    }
  }

  // Render a publication index (kind 30040) by fetching and rendering referenced events
  async function renderPublicationIndex(indexEvent: NostrEvent) {
    isLoading = true;
    // Get all a-tags from the index event
    const aTags = indexEvent.tags.filter(tag => tag[0] === 'a');
    
    if (aTags.length === 0) {
      htmlContent = '<div class="publication-index"><p>Publication Index (no references found)</p></div>';
      isLoading = false;
      return;
    }

    // Fetch all referenced events
    const referencedEvents: NostrEvent[] = [];
    const { contentCache } = await import('$lib/contentCache');
    
    for (const aTag of aTags) {
      const aTagValue = aTag[1]; // Format: "kind:pubkey:dtag"
      const eventId = aTag[3]; // Optional event ID for version tracking
      
      let referencedEvent: NostrEvent | null = null;
      
      // Try to get from cache first
      if (eventId) {
        const cached = contentCache.getEvent('wiki', eventId);
        if (cached) {
          referencedEvent = cached.event;
        }
      }
      
      // If not in cache, try to fetch by a-tag or event ID
      if (!referencedEvent) {
        try {
          // Parse a-tag: "kind:pubkey:dtag"
          const [kindStr, pubkey, dtag] = aTagValue.split(':');
          const kind = parseInt(kindStr, 10);
          
          // Try cache first by a-tag
          const cachedEvents = contentCache.getEvents('wiki');
          const cached = cachedEvents.find(c => {
            if (c.event.kind !== kind || c.event.pubkey !== pubkey) return false;
            const eventDTag = c.event.tags.find(t => t[0] === 'd')?.[1];
            return eventDTag === dtag;
          });
          
          if (cached) {
            referencedEvent = cached.event;
          } else {
            // Fetch from relays
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [
                {
                  authors: [pubkey],
                  '#d': [dtag],
                  kinds: [kind],
                  limit: 1
                }
              ],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined
              }
            );
            
            if (result.events.length > 0) {
              referencedEvent = result.events[0];
              // Cache it
              await contentCache.storeEvents('wiki', [{
                event: referencedEvent,
                relays: result.relays
              }]);
            }
          }
        } catch (error) {
          console.warn('Failed to fetch referenced event:', aTagValue, error);
        }
      }
      
      if (referencedEvent) {
        referencedEvents.push(referencedEvent);
      }
    }
    
    if (referencedEvents.length === 0) {
      htmlContent = '<div class="publication-index"><p>Loading publication content...</p></div>';
      isLoading = false;
      return;
    }
    
    // Build AsciiDoc content from referenced events
    let asciidocContent = '';
    
    for (const refEvent of referencedEvents) {
      // Get title from event
      const title = refEvent.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
      
      // Handle nested 30040 indices recursively
      if (refEvent.kind === 30040) {
        // For nested indices, render as a section with nested content
        asciidocContent += `\n== ${title}\n\n`;
        // Recursively render nested index (we'll fetch and render inline)
        const nestedContent = await renderNestedPublicationIndex(refEvent);
        asciidocContent += nestedContent;
      } else {
        // Regular content event (30041, 30818, etc.)
        asciidocContent += `\n== ${title}\n\n`;
        
        // Get content and preprocess
        const rawContent = refEvent.content;
        const processedContent = preprocessContentForAsciidoc(rawContent);
        
        // Detect if Markdown
        const isMarkdown = refEvent.kind === 30817 || detectMarkdownContent(processedContent);
        const finalContent = isMarkdown 
          ? convertMarkdownToAsciiDoc(processedContent)
          : processedContent;
        
        asciidocContent += finalContent + '\n\n';
      }
    }
    
    // Render the combined AsciiDoc content
    const asciiDoc = asciidoctor();
    const doc = asciiDoc.load(asciidocContent, {
      safe: 'safe',
      backend: 'html5',
      doctype: 'book',
      attributes: {
        'source-highlighter': 'none',
        'toc': 'left',
        'toclevels': 3
      }
    });
    
    // Convert to HTML
    let renderedHtml = doc.convert();
    
    // Remove any max-width constraints from AsciiDoc-generated HTML
    renderedHtml = renderedHtml.replace(/max-width:\s*[^;]+;?/gi, '');
    renderedHtml = renderedHtml.replace(/style="([^"]*max-width[^"]*)"/gi, (match, styles) => {
      const cleaned = styles.replace(/max-width:\s*[^;]+;?/gi, '').trim();
      return cleaned ? `style="${cleaned}"` : '';
    });
    
    // Post-process the HTML (handle Nostr links, etc.)
    renderedHtml = await processNostrLinksEnhanced(renderedHtml);
    
    htmlContent = renderedHtml;
    
    // Mount bookstr components after a delay
    setTimeout(() => {
      mountBookstrComponents();
    }, 100);
    
    isLoading = false;
  }
  
  // Helper function to render nested publication indices
  async function renderNestedPublicationIndex(indexEvent: NostrEvent): Promise<string> {
    const aTags = indexEvent.tags.filter(tag => tag[0] === 'a');
    const { contentCache } = await import('$lib/contentCache');
    let nestedContent = '';
    
    for (const aTag of aTags) {
      const aTagValue = aTag[1];
      const eventId = aTag[3];
      
      let referencedEvent: NostrEvent | null = null;
      
      if (eventId) {
        const cached = contentCache.getEvent('wiki', eventId);
        if (cached) {
          referencedEvent = cached.event;
        }
      }
      
      if (!referencedEvent) {
        try {
          const [kindStr, pubkey, dtag] = aTagValue.split(':');
          const kind = parseInt(kindStr, 10);
          
          const cachedEvents = contentCache.getEvents('wiki');
          const cached = cachedEvents.find(c => {
            if (c.event.kind !== kind || c.event.pubkey !== pubkey) return false;
            const eventDTag = c.event.tags.find(t => t[0] === 'd')?.[1];
            return eventDTag === dtag;
          });
          
          if (cached) {
            referencedEvent = cached.event;
          } else {
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [
                {
                  authors: [pubkey],
                  '#d': [dtag],
                  kinds: [kind],
                  limit: 1
                }
              ],
              {
                excludeUserContent: false,
                currentUserPubkey: undefined
              }
            );
            
            if (result.events.length > 0) {
              referencedEvent = result.events[0];
              await contentCache.storeEvents('wiki', [{
                event: referencedEvent,
                relays: result.relays
              }]);
            }
          }
        } catch (error) {
          console.warn('Failed to fetch nested event:', aTagValue, error);
        }
      }
      
      if (referencedEvent) {
        const title = referencedEvent.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
        
        if (referencedEvent.kind === 30040) {
          nestedContent += `\n=== ${title}\n\n`;
          const deeperNested = await renderNestedPublicationIndex(referencedEvent);
          nestedContent += deeperNested;
        } else {
          nestedContent += `\n=== ${title}\n\n`;
          const rawContent = referencedEvent.content;
          const processedContent = preprocessContentForAsciidoc(rawContent);
          const isMarkdown = referencedEvent.kind === 30817 || detectMarkdownContent(processedContent);
          const finalContent = isMarkdown 
            ? convertMarkdownToAsciiDoc(processedContent)
            : processedContent;
          nestedContent += finalContent + '\n\n';
        }
      }
    }
    
    return nestedContent;
  }

  onMount(async () => {
    // Load preferred authors
    loadWikiAuthors(event.pubkey).then((ps) => {
      authorPreferredWikiAuthors = ps.items;
    });

    // Clear previous read instead data and bookstr passages
    readInsteadData = [];
    bookstrPassages = [];

    // Handle different event kinds
    // 30040: Publication Index - fetch and render referenced events
    if (event.kind === 30040) {
      await renderPublicationIndex(event);
      return;
    }

    // Let bookstr wikilinks pass through processing - we'll find and replace them in the final HTML
    const rawContent = event.content;
    
    // 30817: Markdown content, 30818: AsciiDoc content, 30041: AsciiDoc content
    // Preprocess content (bookstr wikilinks will be converted to placeholder divs)
    const content = preprocessContentForAsciidoc(rawContent);
    
    // Detect if content is primarily Markdown vs AsciiDoc
    // 30817 events are Markdown, 30818 and 30041 are AsciiDoc
    const isMarkdown = event.kind === 30817 || detectMarkdownContent(content);
    
    let processedContent = content;
    if (isMarkdown) {
      // Convert Markdown syntax to AsciiDoc syntax
      processedContent = convertMarkdownToAsciiDoc(content);
    }
    
    // Configure AsciiDoc processor
    const asciiDoc = asciidoctor();
    const doc = asciiDoc.load(processedContent, {
      safe: 'safe',
      backend: 'html5',
      doctype: 'book',
      attributes: {
        'source-highlighter': 'none',
        'toc': 'left',
        'toclevels': 3
      }
    });

    // Convert to HTML and postprocess (async)
    let html = doc.convert();
    
    // Remove any max-width constraints from AsciiDoc-generated HTML
    html = html.replace(/max-width:\s*[^;]+;?/gi, '');
    html = html.replace(/style="([^"]*max-width[^"]*)"/gi, (match, styles) => {
      const cleaned = styles.replace(/max-width:\s*[^;]+;?/gi, '').trim();
      return cleaned ? `style="${cleaned}"` : '';
    });
    
    html = await postprocessHtml(html);
    
    // Find bookstr placeholder divs that were created by preprocessContentForAsciidoc
    // They might be escaped, so check both escaped and unescaped versions
    const placeholderRegex = /<div class="bookstr-placeholder"[^>]*data-bookstr-id="([^"]+)"[^>]*data-bookstr-content="([^"]+)"[^>]*><\/div>/g;
    let match;
    while ((match = placeholderRegex.exec(html)) !== null) {
      const [, id, content] = match;
      bookstrPassages.push({
        id,
        content: content.replace(/&quot;/g, '"')
      });
    }
    
    // Also check for HTML-escaped versions
    const escapedRegex = /&lt;div class="bookstr-placeholder"[^&]*data-bookstr-id="([^"]+)"[^&]*data-bookstr-content="([^"]+)"[^&]*&gt;&lt;\/div&gt;/g;
    while ((match = escapedRegex.exec(html)) !== null) {
      const [, id, content] = match;
      bookstrPassages.push({
        id,
        content: content.replace(/&quot;/g, '"')
      });
    }
    
    
    // Replace placeholders with markers that we can find in the DOM
    html = html.replace(/<div class="bookstr-placeholder"[^>]*data-bookstr-id="([^"]+)"[^>]*><\/div>/g, 
      '<div data-bookstr-id="$1" class="bookstr-marker"></div>');
    
    htmlContent = html;
    
    // Apply syntax highlighting and LaTeX rendering after the HTML is rendered
    setTimeout(() => {
      applySyntaxHighlighting();
      renderLatexExpressions();
      mountBookstrComponents();
    }, 100);
  });

  // Cleanup mounted components on destroy
  onDestroy(() => {
    mountedBookstrComponents.forEach((instance) => {
      if (instance) {
        unmount(instance);
      }
    });
    mountedBookstrComponents.clear();
  });

  // Mount BookPassageGroup components at marker locations
  function mountBookstrComponents() {
    if (!contentDiv) {
      return;
    }
    
    // Find all bookstr markers in the rendered HTML
    const markers = contentDiv.querySelectorAll('[data-bookstr-id]');
    
    if (markers.length === 0 && bookstrPassages.length > 0) {
      // Try again after a delay
      setTimeout(() => {
        const retryMarkers = contentDiv.querySelectorAll('[data-bookstr-id]');
        if (retryMarkers.length > 0) {
          mountBookstrComponents();
        }
      }, 200);
      return;
    }
    
    markers.forEach((marker) => {
      const markerElement = marker as HTMLElement;
      const bookstrId = markerElement.getAttribute('data-bookstr-id');
      if (!bookstrId) {
        return;
      }
      
      // Find the corresponding passage data
      const passage = bookstrPassages.find(p => p.id === bookstrId);
      if (!passage) {
        return;
      }
      
      // Skip if already mounted
      if (mountedBookstrComponents.has(bookstrId)) {
        return;
      }
      
      // Create a container to replace the marker
      const container = document.createElement('div');
      container.className = 'bookstr-component-container';
      
      // Replace marker with container
      markerElement.parentNode?.replaceChild(container, markerElement);
      
      try {
        // Mount the BookPassageGroup component
        const instance = mount(BookPassageGroup, {
          target: container,
          props: {
            bookstrContent: passage.content,
            createChild: createChild
          }
        });
        
        // Store the instance for cleanup
        mountedBookstrComponents.set(bookstrId, instance);
      } catch (error) {
        console.error(`mountBookstrComponents: Error mounting ${bookstrId}:`, error);
      }
    });
  }
  
  // Track clicked links to prevent duplicate card creation
  const clickedLinks = new Set<string>();

  // Handle clicks on links to create child cards
  async function handleLinkClick(clickEvent: MouseEvent) {
    const target = clickEvent.target as HTMLElement;
    
    // Handle wikilinks
    if (target.tagName === 'A') {
      const href = target.getAttribute('href');
      if (href?.startsWith('wikilink:')) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        
        const identifier = href.replace('wikilink:', '');
        const linkKey = `wikilink:${identifier}`;
        
        // Prevent duplicate card creation
        if (clickedLinks.has(linkKey)) {
          return;
        }
        clickedLinks.add(linkKey);
        
        // Clear after a delay to allow re-clicking if needed
        setTimeout(() => clickedLinks.delete(linkKey), 1000);
        
        createChild({
          id: next(),
          type: 'find',
          data: identifier,
          preferredAuthors: [event.pubkey, ...authorPreferredWikiAuthors]
        } as any);
      } else if (href?.startsWith('book:')) {
        clickEvent.preventDefault();
        const bookQuery = href.replace('book:', '');
        const parts = bookQuery.split(':');
        if (parts.length >= 2) {
          const bookType = parts[0];
          const query = parts.slice(1).join(':');
          addBookSearch(query, bookType);
        } else {
          addBookSearch(bookQuery);
        }
      } else if (href?.startsWith('#nostr-')) {
        // Handle our special nostr anchor links
        clickEvent.preventDefault();
        const bech32 = href.replace('#nostr-', '');
        const decoded = decodeNostrLink(bech32);
        if (decoded) {
          const { type, data } = decoded;
          if (type === 'npub' || type === 'nprofile') {
            const pubkey = type === 'npub' ? data : data.pubkey;
            selectedUserPubkey = pubkey;
            selectedUserBech32 = bech32;
            profilePopupOpen = true;
          } else if (type === 'nevent' || type === 'note') {
            // Add embedded event for nevent and note
            addEmbeddedEvent(bech32, type as 'nevent' | 'note');
          } else if (type === 'naddr') {
            // For naddr, fetch the event first to check its actual kind
            const { data } = decoded;
            
            // Fetch the event to determine its real kind
            const eventPromise = new Promise<NostrEvent | null>((resolve) => {
              let eventData: NostrEvent | null = null;
              relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ 
                  authors: [data.pubkey],
                  '#d': [data.identifier],
                  kinds: [data.kind],
                  limit: 1 
                }],
                {
                  excludeUserContent: false,
                  currentUserPubkey: undefined
                }
              ).then(result => {
                const event = result.events.find(evt => 
                  evt.pubkey === data.pubkey && 
                  evt.tags.some(([tag, value]) => tag === 'd' && value === data.identifier) &&
                  evt.kind === data.kind
                );
                resolve(event || null);
              }).catch(() => resolve(null));
            });
            
            try {
              const actualEvent = await eventPromise;
              
              if (actualEvent?.kind === 30818) {
                // 30818 wiki events: treat as normal d-tag wikilinks
                const wikilinkCard = {
                  id: next(),
                  type: 'article' as const,
                  data: [data.identifier, data.pubkey] as [string, string],
                  relayHints: []
                };
                createChild(wikilinkCard);
              } else {
                // Everything else (30041, etc.): embedded events
                addEmbeddedEvent(bech32, 'naddr');
              }
            } catch (error) {
              // If fetch fails, default to wikilink behavior
              console.warn('Failed to fetch naddr event, defaulting to wikilink:', error);
              const wikilinkCard = {
                id: next(),
                type: 'article' as const,
                data: [data.identifier, data.pubkey] as [string, string],
                relayHints: []
              };
              createChild(wikilinkCard);
            }
          }
        }
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
        if (type === 'nevent' || type === 'note') {
          // Add embedded event for nevent and note
          addEmbeddedEvent(bech32, type as 'nevent' | 'note');
        } else if (type === 'naddr') {
          // For naddr, fetch the event first to check its actual kind
          const decoded = decodeNostrLink(bech32);
          if (decoded && decoded.type === 'naddr') {
            const { data } = decoded;
            
            // Fetch the event to determine its real kind
            const eventPromise = new Promise<NostrEvent | null>((resolve) => {
              let eventData: NostrEvent | null = null;
              relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ 
                  authors: [data.pubkey],
                  '#d': [data.identifier],
                  kinds: [data.kind],
                  limit: 1 
                }],
                {
                  excludeUserContent: false,
                  currentUserPubkey: undefined
                }
              ).then(result => {
                const event = result.events.find(evt => 
                  evt.pubkey === data.pubkey && 
                  evt.tags.some(([tag, value]) => tag === 'd' && value === data.identifier) &&
                  evt.kind === data.kind
                );
                resolve(event || null);
              }).catch(() => resolve(null));
            });
            
            try {
              const actualEvent = await eventPromise;
              
              if (actualEvent?.kind === 30818) {
                // 30818 wiki events: treat as normal d-tag wikilinks
                const wikilinkCard = {
                  id: next(),
                  type: 'article' as const,
                  data: [data.identifier, data.pubkey] as [string, string],
                  relayHints: []
                };
                createChild(wikilinkCard);
              } else {
                // Everything else (30041, etc.): embedded events
                addEmbeddedEvent(bech32, 'naddr');
              }
            } catch (error) {
              // If fetch fails, default to wikilink behavior
              console.warn('Failed to fetch naddr event, defaulting to wikilink:', error);
              const wikilinkCard = {
                id: next(),
                type: 'article' as const,
                data: [data.identifier, data.pubkey] as [string, string],
                relayHints: []
              };
              createChild(wikilinkCard);
            }
          }
        }
      }
    }
    
  }

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div 
  bind:this={contentDiv}
  class="prose prose-sm max-w-none w-full"
  style="max-width: 100% !important; width: 100% !important;"
  onclick={handleLinkClick}
  role="document"
  tabindex="-1"
>
  {#if isLoading}
    <div class="flex items-center justify-center py-12">
      <div class="flex flex-col items-center space-y-4">
        <div class="spinner" style="width: 48px; height: 48px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <p class="text-lg" style="color: var(--text-secondary);">Loading content...</p>
      </div>
    </div>
  {:else if htmlContent}
    {@html htmlContent}
  {/if}
</div>

<!-- Bookstr Passage Groups are now mounted inline at marker locations -->

<!-- Embedded Events -->
{#each embeddedEvents as embeddedEvent (embeddedEvent.id)}
  <EmbeddedEvent 
    bech32={embeddedEvent.bech32} 
    type={embeddedEvent.type}
    onClose={() => removeEmbeddedEvent(embeddedEvent.id)}
    {createChild}
  />
{/each}

<!-- Read Instead Components -->
{#each readInsteadData as readInstead (readInstead.id)}
  <div class="read-instead-container">
    <div class="read-instead-text">
      <span class="text-espresso-700">Read the {readInstead.identifier} article from </span>
      <UserBadge 
        pubkey={readInstead.pubkey} 
        {createChild} 
        onProfileClick={handleProfileAvatarClick} 
        size="small" 
        hideSearchIcon={true}
      />
      <span class="text-espresso-700"> instead.</span>
    </div>
    <div class="read-instead-action">
      <button 
        class="read-instead-button" 
        onclick={() => handleReadInsteadClick(readInstead.naddr)}
      >
        Read
      </button>
    </div>
  </div>
{/each}

<!-- Profile Popup -->
<ProfilePopup 
  pubkey={selectedUserPubkey}
  bech32={selectedUserBech32}
  isOpen={profilePopupOpen}
  onClose={() => profilePopupOpen = false}
/>

<!-- Book Search Results -->
{#each bookSearchResults as bookSearch (bookSearch.id)}
  <div class="mt-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
    <div class="flex justify-between items-center mb-3">
      <h3 class="text-lg font-semibold text-blue-800">
        {bookSearch.bookType === 'quran' ? 'Quran' : bookSearch.bookType === 'catechism' ? 'Catechism' : 'Bible'} Search: {bookSearch.query}
      </h3>
      <button
        onclick={() => removeBookSearch(bookSearch.id)}
        class="text-blue-600 hover:text-blue-800 text-sm underline"
      >
        Close
      </button>
    </div>
    <BookSearch 
      query={bookSearch.query}
      bookType={bookSearch.bookType || 'bible'}
      {createChild}
      onResults={(results) => updateBookSearchResults(bookSearch.id, results)}
    />
  </div>
{/each}

<style>
  /* Component-specific styles only - main styling handled in app.postcss */
  
  /* Nostr link styling - component-specific */
  :global(.nostr-user-link) {
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  
  :global(.nostr-event-link) {
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  
  :global(.read-instead-container) {
    @apply flex flex-col my-4 px-4 py-3 rounded-lg border;
    background-color: var(--bg-secondary);
    border-color: var(--border);
  }
  
  :global(.read-instead-text) {
    @apply flex flex-wrap items-center gap-1;
  }
  
  :global(.read-instead-action) {
    @apply flex justify-end;
  }
  
  :global(.read-instead-button) {
    @apply px-3 py-2 rounded text-sm cursor-pointer transition-colors;
    background-color: var(--accent);
    color: white;
  }
  
  :global(.read-instead-button:hover) {
    background-color: var(--accent-hover);
  }
  
  :global(.read-instead-link) {
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }

  /* Override table styling for markdown-converted tables */
  :global(table) {
    border-collapse: collapse;
    border: none !important;
  }

  :global(table th),
  :global(table td) {
    padding: 0.5rem 0.75rem !important;
    border: none !important;
    border-bottom: 1px solid var(--border) !important;
    background: transparent !important;
  }

  :global(table th) {
    font-family: var(--theme-font, inherit) !important;
    font-weight: bold !important;
    border-bottom: 2px solid var(--border) !important;
    padding-bottom: 0.75rem !important;
  }

  :global(table tr:last-child td) {
    border-bottom: none !important;
  }
</style>
