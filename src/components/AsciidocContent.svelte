<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import asciidoctor from '@asciidoctor/core';
  import { onMount } from 'svelte';
  import { loadWikiAuthors } from '@nostr/gadgets/lists';
  import type { Card } from '$lib/types';
  import { preprocessContentForAsciidoc } from '$lib/utils';
  import hljs from 'highlight.js';
  import { nip19 } from '@nostr/tools';
  import katex from 'katex';
  import { pool } from '@nostr/gadgets/global';
  import { relayService } from '$lib/relayService';
  import { next } from '$lib/utils';
  import type { ArticleCard } from '$lib/types';
  import ProfilePopup from './ProfilePopup.svelte';
  import UserBadge from './UserBadge.svelte';
  import EmbeddedEvent from './EmbeddedEvent.svelte';
  import BookSearch from './BookSearch.svelte';
  import { parseBookWikilink } from '$lib/books';

  interface Props {
    event: NostrEvent;
    createChild: (card: Card) => void;
    replaceSelf?: (card: Card) => void;
  }

  let { event, createChild, replaceSelf }: Props = $props();

  let authorPreferredWikiAuthors = $state<string[]>([]);
  let htmlContent = $state<string>('');
  let contentDiv: HTMLElement;
  let userCache = $state<Map<string, any>>(new Map());
  
  // Profile popup state
  let profilePopupOpen = $state(false);
  let selectedUserPubkey = $state('');
  let selectedUserBech32 = $state('');
  let embeddedEvents = $state<Array<{id: string, bech32: string, type: 'nevent' | 'note' | 'naddr'}>>([]);
  let bookSearchResults = $state<Array<{id: string, query: string, results: any[], bookType?: string}>>([]);
  let readInsteadData = $state<Array<{id: string, naddr: string, pubkey: string, identifier: string, displayName: string}>>([]);

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
        // Only highlight if it has a language class and hasn't been highlighted yet
        if (element.className.includes('language-') && !element.className.includes('language-undefined') && !element.dataset.highlighted) {
          hljs.highlightElement(element);
          element.dataset.highlighted = 'yes';
        }
      });
      
      // Highlight inline code that might have been missed
      contentDiv.querySelectorAll('code:not(pre code)').forEach((block) => {
        const element = block as HTMLElement;
        // Only highlight if it has a language class and it's not undefined and hasn't been highlighted yet
        if (element.className.includes('language-') && !element.className.includes('language-undefined') && !element.dataset.highlighted) {
          hljs.highlightElement(element);
          element.dataset.highlighted = 'yes';
        }
      });
    }
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

  onMount(async () => {
    // Load preferred authors
    loadWikiAuthors(event.pubkey).then((ps) => {
      authorPreferredWikiAuthors = ps.items;
    });

    // Clear previous read instead data
    readInsteadData = [];

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
    
    // Apply syntax highlighting and LaTeX rendering after the HTML is rendered
    setTimeout(() => {
      applySyntaxHighlighting();
      renderLatexExpressions();
    }, 0);
  });

  // Handle clicks on links to create child cards
  async function handleLinkClick(clickEvent: MouseEvent) {
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
  class="prose prose-sm max-w-none"
  onclick={handleLinkClick}
  role="document"
  tabindex="-1"
>{@html htmlContent}</div>

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
    @apply text-burgundy-700 hover:text-burgundy-800 cursor-pointer underline;
  }
  
  :global(.nostr-event-link) {
    @apply text-burgundy-700 hover:text-burgundy-800 cursor-pointer underline;
  }
  
  :global(.read-instead-container) {
    @apply flex flex-col my-4 px-4 py-3 bg-brown-50 border border-espresso-300 rounded-lg;
  }
  
  :global(.read-instead-text) {
    @apply flex flex-wrap items-center gap-1;
  }
  
  :global(.read-instead-action) {
    @apply flex justify-end;
  }
  
  :global(.read-instead-button) {
    @apply bg-burgundy-700 border-none px-3 py-2 rounded text-sm cursor-pointer transition-colors hover:bg-burgundy-800;
    color: #fbbf24;
  }
  
  :global(.read-instead-link) {
    @apply text-burgundy-700 hover:text-burgundy-800 cursor-pointer underline;
  }
</style>
