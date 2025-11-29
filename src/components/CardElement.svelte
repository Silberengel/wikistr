<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { npubEncode } from '@nostr/tools/nip19';

  import { goto } from '$app/navigation';
  import { cards } from '$lib/state';
  import { type EditorCard, type Card, serializeCardForRouter } from '$lib/types';
  import { scrollCardIntoView, isElementInViewport, hashbow, urlWithoutScheme } from '$lib/utils';
import Article from '$cards/Article.svelte';
import Editor from '$cards/Editor.svelte';
import Welcome from '$cards/Welcome.svelte';
import SearchResults from '$cards/SearchResults.svelte';
import Settings from '$cards/Settings.svelte';
import Relay from '$cards/Relay.svelte';
import NewSearch from '$cards/NewSearch.svelte';
import User from '$cards/User.svelte';
import Book from '$cards/Book.svelte';
import Diff from '$cards/Diff.svelte';
import { highlightedBookCardId } from '$lib/bookSearchLauncher';
import { highlightedArticleCardId } from '$lib/articleLauncher';

  interface Props {
    card: Card;
  }

  let { card }: Props = $props();

  // Expand state for all cards (desktop only)
  // Persist expanded state per card in sessionStorage
  const expandedKey = `card-expanded-${card.id}`;
  let expanded = $state(false);
  let isDesktop = $state(false);

  // Check if we're on desktop (width >= 1024px)
  function checkDesktop() {
    isDesktop = window.innerWidth >= 1024;
  }

  function toggleExpand() {
    expanded = !expanded;
    // Persist expanded state
    if (isDesktop) {
      try {
        if (expanded) {
          sessionStorage.setItem(expandedKey, 'true');
        } else {
          sessionStorage.removeItem(expandedKey);
        }
      } catch (e) {
        // Ignore storage errors
      }
    }
    // Scroll card into view when expanded to ensure it's visible
    if (expanded) {
      setTimeout(() => {
        const cardElement = document.getElementById(`wikicard-${card.id}`);
        if (cardElement) {
          cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
      }, 100);
    }
  }

  // Check desktop on mount and resize
  onMount(() => {
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    
    // Restore expanded state from sessionStorage after checking desktop
    // Use a small delay to ensure isDesktop is set
    setTimeout(() => {
      if (isDesktop) {
        try {
          const savedExpanded = sessionStorage.getItem(expandedKey);
          if (savedExpanded === 'true') {
            expanded = true;
            // Scroll into view after restoring expanded state
            setTimeout(() => {
              const cardElement = document.getElementById(`wikicard-${card.id}`);
              if (cardElement) {
                cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
              }
            }, 200);
          }
        } catch (e) {
          // Ignore storage errors
        }
      }
    }, 0);
  });
  
  onDestroy(() => {
    window.removeEventListener('resize', checkDesktop);
  });

  function close(ev?: MouseEvent) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (card.type === 'editor' && card.data.previous) replaceSelf(card.data.previous);
    else removeSelf();
  }

  function back() {
    if (card.back) replaceSelf(card.back);
  }

  function removeSelf() {
    const index = $cards.findIndex((item) => item.id === card.id);
    const newCards = [...$cards];
    newCards.splice(index, 1);
    goto('/' + newCards.map((card) => toURL(card)).join('/'));
  }

  // Check if this card can be moved (not welcome, not new/search, not at ends)
  // Welcome and new cards are hardcoded in layout, so cards in $cards won't be those types
  // But we should still check to be safe
  const canMoveLeft = $derived.by(() => {
    const index = $cards.findIndex((item) => item.id === card.id);
    // Can move left if not at the start (index > 0) and not a special card type
    return index > 0 && card.type !== 'welcome' && card.type !== 'new';
  });

  const canMoveRight = $derived.by(() => {
    const index = $cards.findIndex((item) => item.id === card.id);
    // Can move right if not at the end and not a special card type
    const isLastCard = index === $cards.length - 1;
    if (isLastCard || card.type === 'welcome' || card.type === 'new') return false;
    // Check if next card exists and isn't a special type
    const nextCard = $cards[index + 1];
    return nextCard && nextCard.type !== 'new';
  });

  function moveLeft() {
    const index = $cards.findIndex((item) => item.id === card.id);
    if (index <= 0) return;
    
    const newCards = [...$cards];
    [newCards[index - 1], newCards[index]] = [newCards[index], newCards[index - 1]];
    goto('/' + newCards.map((card) => toURL(card)).join('/'));
    
    // Scroll the moved card into view
    setTimeout(() => {
      scrollCardIntoView(String(card.id), true);
    }, 50);
  }

  function moveRight() {
    const index = $cards.findIndex((item) => item.id === card.id);
    if (index < 0 || index >= $cards.length - 1) return;
    
    const nextCard = $cards[index + 1];
    if (nextCard && nextCard.type === 'new') return;
    
    const newCards = [...$cards];
    [newCards[index], newCards[index + 1]] = [newCards[index + 1], newCards[index]];
    goto('/' + newCards.map((card) => toURL(card)).join('/'));
    
    // Scroll the moved card into view
    setTimeout(() => {
      scrollCardIntoView(String(card.id), true);
    }, 50);
  }

  function createChild(newChild: Card) {
    const index = $cards.findIndex((item) => item.id === card.id);
    const newCards = $cards
      .slice(0, index + 1)
      .concat(newChild)
      .concat($cards.slice(index + 1));
    goto('/' + newCards.map((card) => toURL(card)).join('/'));

    setTimeout(() => {
      if (!isElementInViewport(String(newChild.id))) {
        scrollCardIntoView(String(newChild.id), false);
      }
    }, 1);
  }

  function replaceSelf(updatedCard: Card) {
    const index = $cards.findIndex((item) => item.id === card.id);
    const newCards = $cards.slice();
    newCards[index] = updatedCard;
    goto(
      '/' +
        newCards
          .map((card) => toURL(card))
          .filter((v) => v)
          .join('/'),
      {
        state: [index, serializeCardForRouter(updatedCard)]
      }
    );
  }

  function replaceNewCard(newCard: Card) {
    const newCards = $cards.concat(newCard);
    goto(
      '/' +
        newCards
          .map((card) => toURL(card))
          .filter((v) => v)
          .join('/'),
      {
        state: [$cards.length, serializeCardForRouter(newCard)]
      }
    );

    setTimeout(() => {
      if (!isElementInViewport(String(newCard.id))) {
        scrollCardIntoView(String(newCard.id), false);
      }
    }, 1);
  }

  function scrollIntoViewIfNecessary(ev: MouseEvent & { currentTarget: HTMLElement }) {
    if (!isElementInViewport(ev.currentTarget)) scrollCardIntoView(ev.currentTarget, false);
  }

  function toURL(card: Card): string | null {
    switch (card.type) {
      case 'find':
        return card.data;
      case 'article':
        // Encode the d-tag to handle special characters like æ, but keep * separator unencoded
        // The pubkey is hex and doesn't need encoding, but encoding it is harmless
        return encodeURIComponent(card.data[0]) + '*' + card.data[1];
      case 'relay':
        return encodeURIComponent(urlWithoutScheme(card.data));
      case 'user':
        return npubEncode(card.data);
      case 'editor':
        return 'edit:' + (card as EditorCard).data.title;
      case 'book':
        // Always use book:: format for URLs
        // Check if data already starts with book:: to avoid duplication
        const bookData = card.data as string;
        if (bookData.startsWith('book::')) {
          return encodeURIComponent(bookData);
        }
        return 'book::' + encodeURIComponent(bookData);
      case 'diff':
        return 'diff:' + encodeURIComponent(card.data);
    }
    return null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
  id={`wikicard-${card.id}`}
  class:highlighted-card={
    (card.type === 'book' && $highlightedBookCardId === card.id) ||
    ((card.type === 'article' || card.type === 'find') && $highlightedArticleCardId === card.id)
  }
  class="wikicard
  overflow-y-auto
  {expanded && isDesktop ? 'overflow-x-visible card-expanded' : card.type === 'diff' ? 'overflow-x-visible' : 'overflow-x-hidden'}
  mx-2 mt-2
  {expanded && isDesktop ? 'min-w-[395px] lg:min-w-[32rem]' : card.type === 'diff' ? 'min-w-[395px] lg:min-w-[32rem]' : 'min-w-[395px] max-w-[395px] lg:min-w-[32rem] lg:max-w-[32rem]'}
  rounded-lg border-8
  h-[calc(100vh_-_32px)]
  min-h-[calc(100vh_-_32px)]
  p-4
  scrollbar-thin
  flex
  flex-col"
  style="background-color: var(--bg-primary); border-color: var(--border); {expanded && isDesktop ? 'min-width: 64rem !important; width: 64rem !important; max-width: 64rem !important; flex: 0 0 64rem !important; overflow-x: visible !important;' : !expanded && isDesktop ? 'min-width: 32rem !important; width: 32rem !important; max-width: 32rem !important; flex: 0 0 32rem !important;' : ''}"
  ondblclick={scrollIntoViewIfNecessary}
>
  {#if card.type !== 'welcome' && card.type !== 'new'}
    <div class="flex justify-between items-center">
      {#if card.back}
        <button aria-label="back" onclick={back} class="transition-colors hover:opacity-70">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-6 h-6"
            style="stroke: var(--text-secondary);"
            viewBox="0 0 219.151 219.151"
          >
            <path
              d="M94.861,156.507c2.929,2.928,7.678,2.927,10.606,0c2.93-2.93,2.93-7.678-0.001-10.608l-28.82-28.819l83.457-0.008 c4.142-0.001,7.499-3.358,7.499-7.502c-0.001-4.142-3.358-7.498-7.5-7.498l-83.46,0.008l28.827-28.825 c2.929-2.929,2.929-7.679,0-10.607c-1.465-1.464-3.384-2.197-5.304-2.197c-1.919,0-3.838,0.733-5.303,2.196l-41.629,41.628 c-1.407,1.406-2.197,3.313-2.197,5.303c0.001,1.99,0.791,3.896,2.198,5.305L94.861,156.507z"
            ></path>
          </svg>
        </button>
      {:else}
        <div></div>
      {/if}
      <div class="flex items-center gap-2">
        {#if canMoveLeft || canMoveRight}
          <div class="flex items-center gap-1">
            {#if canMoveLeft}
              <button
                aria-label="Move left"
                onclick={(e) => { e.stopPropagation(); moveLeft(); }}
                class="transition-colors hover:opacity-70 p-1"
                title="Move pane left"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-5 h-5"
                  style="stroke: var(--text-secondary);"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            {/if}
            {#if canMoveRight}
              <button
                aria-label="Move right"
                onclick={(e) => { e.stopPropagation(); moveRight(); }}
                class="transition-colors hover:opacity-70 p-1"
                title="Move pane right"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-5 h-5"
                  style="stroke: var(--text-secondary);"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            {/if}
          </div>
        {/if}
        {#if isDesktop}
          <button
            onclick={toggleExpand}
            onfocus={(e) => {
              if (e.target) {
                (e.target as HTMLButtonElement).style.opacity = '0.8';
              }
            }}
            onblur={(e) => {
              if (e.target) {
                (e.target as HTMLButtonElement).style.opacity = '1';
              }
            }}
            onmouseover={(e) => {
              if (e.target) {
                (e.target as HTMLButtonElement).style.opacity = '0.8';
              }
            }}
            onmouseout={(e) => {
              if (e.target) {
                (e.target as HTMLButtonElement).style.opacity = '1';
              }
            }}
            class="inline-flex items-center p-2 text-sm font-medium rounded-md transition-colors"
            style="color: var(--accent); background-color: var(--bg-primary); border: 1px solid var(--accent);"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {#if expanded}
              <!-- Collapse icon (compress) -->
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14h6v6"/>
                <path d="M20 10h-6V4"/>
                <path d="M14 10l7-7"/>
                <path d="M3 21l7-7"/>
              </svg>
            {:else}
              <!-- Expand icon (maximize) -->
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>
                <path d="M21 8H8l5-5"/>
              </svg>
            {/if}
          </button>
        {/if}
        <button aria-label="close" onclick={(e) => close(e)} class="transition-colors hover:opacity-70">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            class="w-6 h-6"
            style="stroke: var(--text-secondary);"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            ><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
          >
        </button>
      </div>
    </div>
  {/if}
  <article class="font-sans p-2 flex-1 {expanded && isDesktop ? 'w-full max-w-none' : card.type === 'diff' ? '' : 'w-full max-w-full'}" style="{expanded && isDesktop ? 'max-width: 100% !important; width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; overflow-x: visible !important;' : 'max-width: 100% !important; width: 100% !important; box-sizing: border-box !important;'}">
    {#key `${card.id}-${expanded}-${isDesktop}`}
      {#if card.type === 'article'}
        <Article {createChild} {replaceSelf} {back} {card} {expanded} {isDesktop} />
      {:else if card.type === 'new'}
        <NewSearch {replaceNewCard} />
      {:else if card.type === 'find'}
        <SearchResults {createChild} {replaceSelf} {card} />
      {:else if card.type === 'welcome'}
        <Welcome {createChild} />
      {:else if card.type === 'relay'}
        <Relay {createChild} {replaceSelf} {card} />
      {:else if card.type === 'user'}
        <User {createChild} {card} />
      {:else if card.type === 'settings'}
        <Settings {createChild} />
      {:else if card.type === 'editor'}
        <Editor {replaceSelf} {card} />
      {:else if card.type === 'book'}
        <Book {createChild} {replaceSelf} {card} />
      {:else if card.type === 'diff'}
        <Diff {card} {expanded} {toggleExpand} />
      {/if}
    {/key}
  </article>
</div>

<style>
  .highlighted-card {
    box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.45);
  }
</style>
