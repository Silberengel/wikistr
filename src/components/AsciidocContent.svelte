<script lang="ts">
  import type { NostrEvent } from '@nostr/tools/pure';
  import asciidoctor from '@asciidoctor/core';
  import { onMount } from 'svelte';
  import { loadWikiAuthors } from '@nostr/gadgets/lists';
  import type { Card } from '$lib/types';
  import { preprocessContentForAsciidoc } from '$lib/utils';
  import hljs from 'highlight.js';

  interface Props {
    event: NostrEvent;
    createChild: (card: Card) => void;
  }

  let { event, createChild }: Props = $props();

  let authorPreferredWikiAuthors = $state<string[]>([]);
  let htmlContent = $state<string>('');
  let contentDiv: HTMLElement;

  // Reactive statement to apply highlighting when content changes
  $effect(() => {
    if (htmlContent && contentDiv) {
      applySyntaxHighlighting();
    }
  });

  // Postprocessor to handle leftover markdown tags that AsciiDoc might miss
  function postprocessHtml(html: string): string {
    // Handle any leftover markdown tags that AsciiDoc didn't process
    let processed = html;
    
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
        hljs.highlightElement(block as HTMLElement);
      });
      
      // Highlight inline code that might have been missed
      contentDiv.querySelectorAll('code:not(pre code)').forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    }
  }

  onMount(() => {
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

    // Convert to HTML and postprocess
    let html = doc.convert();
    html = postprocessHtml(html);
    htmlContent = html;
    
    // Apply syntax highlighting after the HTML is rendered
    setTimeout(() => {
      applySyntaxHighlighting();
    }, 0);
  });

  // Handle clicks on links to create child cards
  function handleLinkClick(clickEvent: MouseEvent) {
    const target = clickEvent.target as HTMLElement;
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
  }

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div 
  bind:this={contentDiv}
  class="prose prose-sm max-w-none"
  onclick={handleLinkClick}
>{@html htmlContent}</div>

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
</style>
