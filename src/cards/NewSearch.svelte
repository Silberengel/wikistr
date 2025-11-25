<script lang="ts">
  import { onMount } from 'svelte';
import { next } from '$lib/utils';
  import { getThemeConfig } from '$lib/themes';
  import { relayService } from '$lib/relayService';
  import { account } from '$lib/nostr';

import type { SearchCard, Card, ArticleCard } from '$lib/types';
  import { normalizeIdentifier } from '@nostr/tools/nip54';
import { openBookSearchCard } from '$lib/bookSearchLauncher';
import ModeToggle from '$components/ModeToggle.svelte';
import ProfilePopup from '$components/ProfilePopup.svelte';
import UserBadge from '$components/UserBadge.svelte';
import CacheBrowser from '$components/CacheBrowser.svelte';
import Settings from '$cards/Settings.svelte';
  import { nip19 } from '@nostr/tools';
  import { decode } from '@nostr/tools/nip19';
  import pkg from '../../package.json';

  // Theme configuration
  const theme = getThemeConfig();
  const version = pkg.version;

  interface Props {
    replaceNewCard: (card: Card) => void;
  }

  let { replaceNewCard }: Props = $props();
  let query = $state('');
  let showSettings = $state(false);
  let showCacheBrowser = $state(false);
  let showProfilePopup = $state(false);
  
  // Relay information
  let themeRelays = $state<{url: string, hasWiki: boolean, hasSocial: boolean, isUserRelay: boolean}[]>([]);
  let relaysLoaded = $state(false);

  function search(ev: SubmitEvent) {
    ev.preventDefault();

    if (query) {
      // Check if this is a book:: query - preserve the book:: prefix
      if (query.startsWith('book::')) {
        openBookSearchCard(query);
      } else {
        const trimmedQuery = query.trim();
        
        // Helper function to fetch and open an event by ID
        const fetchAndOpenEvent = async (eventId: string, relayHints: string[] = []) => {
          try {
            const result = await relayService.queryEvents(
              $account?.pubkey || 'anonymous',
              'wiki-read',
              [{ ids: [eventId] }],
              { 
                excludeUserContent: false, 
                currentUserPubkey: $account?.pubkey,
                customRelays: relayHints
              }
            );

            if (result.events.length > 0) {
              const foundEvent = result.events[0];
              const articleKinds = [30023, 30817, 30041, 30040, 30818];
              
              if (articleKinds.includes(foundEvent.kind)) {
                if (foundEvent.kind === 30040) {
                  // Check if it's a book (has bookstr tags) or publication
                  const { isBookEvent } = await import('$lib/books');
                  const isBook = isBookEvent(foundEvent as any);
                  
                  if (isBook) {
                    // Book index event with bookstr tags - open as book card
                    const { openBookSearchCard } = await import('$lib/bookSearchLauncher');
                    const { getTagOr } = await import('$lib/utils');
                    const dTag = getTagOr(foundEvent, 'd') || '';
                    openBookSearchCard(`book::${dTag}`);
                    query = '';
                    return;
                  } else {
                    // Publication event (30040 without bookstr tags) - open as article card
                    const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
                    const { getTagOr } = await import('$lib/utils');
                    openOrCreateArticleCard({
                      type: 'article',
                      data: [getTagOr(foundEvent, 'd') || '', foundEvent.pubkey],
                      actualEvent: foundEvent,
                      relayHints: result.relays
                    });
                    query = '';
                    return;
                  }
                } else {
                  // Article event - create article card
                  const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
                  const { getTagOr } = await import('$lib/utils');
                  openOrCreateArticleCard({
                    type: 'article',
                    data: [getTagOr(foundEvent, 'd') || '', foundEvent.pubkey],
                    actualEvent: foundEvent,
                    relayHints: result.relays
                  });
                  query = '';
                  return;
                }
              } else {
                alert(`Event found but is not an article kind (30023, 30817, 30041, 30040, or 30818). Found kind: ${foundEvent.kind}`);
                query = '';
                return;
              }
            } else {
              alert('Event not found on any relays.');
              query = '';
              return;
            }
          } catch (error) {
            console.error('Failed to fetch event:', error);
            alert(`Failed to fetch event: ${error instanceof Error ? error.message : 'Unknown error'}`);
            query = '';
            return;
          }
        };
        
        // Check if this is a hex ID (64-character hex string)
        if (/^[a-f0-9]{64}$/i.test(trimmedQuery)) {
          fetchAndOpenEvent(trimmedQuery);
          return;
        }
        
        // Check if this is a naddr or nevent identifier
        if (trimmedQuery.startsWith('naddr1') || trimmedQuery.startsWith('nevent1')) {
          // Try to decode the identifier
          try {
            const decoded = decode(trimmedQuery);
            if (decoded.type === 'naddr' || decoded.type === 'nevent') {
              // Check if it's an article kind
              const articleKinds = [30023, 30817, 30041, 30040, 30818];
              if (decoded.type === 'naddr' && decoded.data.kind && articleKinds.includes(decoded.data.kind)) {
                // For naddr, we need to fetch the event to check for bookstr tags
                // Build the filter to query by kind, pubkey, and identifier
                (async () => {
                  try {
                    const filters: any[] = [{
                      kinds: [decoded.data.kind],
                      authors: [decoded.data.pubkey],
                      '#d': [decoded.data.identifier]
                    }];
                    
                    const result = await relayService.queryEvents(
                      $account?.pubkey || 'anonymous',
                      'wiki-read',
                      filters,
                      { 
                        excludeUserContent: false, 
                        currentUserPubkey: $account?.pubkey,
                        customRelays: decoded.data.relays || []
                      }
                    );

                    if (result.events.length > 0) {
                      const foundEvent = result.events[0];
                      
                      if (foundEvent.kind === 30040 || foundEvent.kind === 30041) {
                        // Check if it has uppercase T tags (bookstr tags) - lowercase 't' is for topics, not bookstr
                        const hasTTags = foundEvent.tags.some((tag: string[]) => tag[0] === 'T');
                        
                        if (hasTTags) {
                          // Bookstr event - open as book card
                          const { openBookSearchCard } = await import('$lib/bookSearchLauncher');
                          openBookSearchCard(`book::${decoded.data.identifier}`);
                          query = '';
                          return;
                        } else {
                          // Publication event (30040/30041 without T tags) - open as article card
                          const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
                          const { getTagOr } = await import('$lib/utils');
                          openOrCreateArticleCard({
                            type: 'article',
                            data: [getTagOr(foundEvent, 'd') || decoded.data.identifier || '', foundEvent.pubkey],
                            actualEvent: foundEvent,
                            relayHints: result.relays
                          });
                          query = '';
                          return;
                        }
                      } else {
                        // Article event - create article card
                        const { openOrCreateArticleCard } = await import('$lib/articleLauncher');
                        openOrCreateArticleCard({
                          type: 'article',
                          data: [decoded.data.identifier || '', decoded.data.pubkey || ''],
                          actualEvent: foundEvent,
                          relayHints: result.relays
                        });
                        query = '';
                        return;
                      }
                    } else {
                      // Event not found, but we can still create an article card from naddr data
                      const articleCard: ArticleCard = {
                        id: next(),
                        type: 'article',
                        data: [decoded.data.identifier || '', decoded.data.pubkey || ''],
                        back: undefined,
                        actualEvent: undefined,
                        relayHints: decoded.data.relays || []
                      };
                      replaceNewCard(articleCard);
                      query = '';
                      return;
                    }
                  } catch (error) {
                    console.error('Failed to fetch naddr event:', error);
                    // Fallback: create article card from naddr data
                    const articleCard: ArticleCard = {
                      id: next(),
                      type: 'article',
                      data: [decoded.data.identifier || '', decoded.data.pubkey || ''],
                      back: undefined,
                      actualEvent: undefined,
                      relayHints: decoded.data.relays || []
                    };
                    replaceNewCard(articleCard);
                    query = '';
                    return;
                  }
                })();
                return;
              } else if (decoded.type === 'nevent' && decoded.data.id) {
                // For nevent, fetch the event directly and open it
                fetchAndOpenEvent(decoded.data.id, decoded.data.relays || []);
                return;
              } else {
                // Not an article kind or couldn't determine
                alert(`This ${decoded.type} is not an article kind (30023, 30817, 30041, 30040, or 30818). Found kind: ${decoded.type === 'naddr' ? decoded.data.kind : 'unknown'}`);
                query = '';
                return;
              }
            }
          } catch (error) {
            // Invalid naddr/nevent format
            alert('Invalid naddr or nevent identifier. Could not decode.');
            query = '';
            return;
          }
        }
        
        // Regular search
        const newCard: SearchCard = {
          id: next(),
          type: 'find',
          data: normalizeIdentifier(query),
          preferredAuthors: []
        };
        replaceNewCard(newCard);
      }
      query = '';
    }
  }

  async function loadRelayInfo() {
    try {
      const userPubkey = $account?.pubkey || 'anonymous';
      
      // Get theme relays directly from theme configuration
      const themeWikiRelays = theme.relays?.wiki || [];
      const themeSocialRelays = theme.relays?.social || [];
      
      // Get user relays via relay service (includes user's personal relays)
      const allWikiRelays = await relayService.getRelaysForOperation(userPubkey, 'wiki-read');
      const allSocialRelays = await relayService.getRelaysForOperation(userPubkey, 'social-read');
      
      // Find user-only relays (not in theme config)
      const allUserRelays = [...allWikiRelays, ...allSocialRelays];
      const userOnlyRelays = allUserRelays.filter(relay => 
        !themeWikiRelays.includes(relay) && !themeSocialRelays.includes(relay)
      );
      
      // Combine theme relays + user-only relays
      const allRelays = new Set([...themeWikiRelays, ...themeSocialRelays, ...userOnlyRelays]);
      
      // Map each relay to show its capabilities and source
      themeRelays = Array.from(allRelays).map(relay => {
        const isThemeWiki = themeWikiRelays.includes(relay);
        const isThemeSocial = themeSocialRelays.includes(relay);
        const isUserRelay = !isThemeWiki && !isThemeSocial;
        
        return {
          url: relay,
          hasWiki: isThemeWiki || allWikiRelays.includes(relay), // Show wiki capability if in wiki relays
          hasSocial: isThemeSocial || allSocialRelays.includes(relay), // Show social capability if in social relays
          isUserRelay: isUserRelay
        };
      });
      
      relaysLoaded = true;
    } catch (error) {
      console.error('Failed to load relay information:', error);
      relaysLoaded = true; // Still mark as loaded to show error state
    }
  }

  // Load relay information on mount
  onMount(() => {
    loadRelayInfo();
  });




  function toggleSettings() {
    showSettings = !showSettings;
  }

  function toggleCacheBrowser() {
    showCacheBrowser = !showCacheBrowser;
  }

  function openProfilePopup() {
    showProfilePopup = true;
  }

  // Convert npub to hex pubkey for ProfilePopup (static, no need for reactivity)
  const hexPubkey = (() => {
    try {
      const decoded = nip19.decode('npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z');
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch (e) {
      console.error('Failed to decode npub:', e);
    }
    return 'npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z';
  })();

  function closeProfilePopup() {
    showProfilePopup = false;
  }
</script>

<form onsubmit={search} class="mt- flex rounded-md shadow-sm">
  <div class="relative flex items-stretch flex-grow focus-within:z-10">
    <input
      bind:value={query}
      class="block w-full sm:text-sm border rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-offset-2"
      style="font-family: {theme.typography.fontFamily}; background-color: var(--bg-primary); color: var(--text-primary); border-color: var(--border); --tw-ring-color: var(--accent);"
      placeholder="article name, search term, or book::reference"
    />
  </div>
  <button
    type="submit"
    class="inline-flex items-center space-x-2 px-3 py-2 text-sm font-medium rounded-r-md border transition-colors hover:opacity-90"
    style="font-family: {theme.typography.fontFamily}; background-color: var(--bg-primary); color: var(--accent); border-color: var(--accent);"
    >Go</button>
</form>

<!-- Search Instructions -->
<div class="mt-4 p-3 rounded-lg border" style="background-color: var(--bg-secondary); border-color: var(--border);">
  <div class="text-sm whitespace-pre-line" style="color: var(--text-primary);">
    {@html theme.searchHelpText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
  </div>
</div>

  <!-- Bottom Panel -->
<div class="mt-4 flex flex-col md:flex-row md:justify-between md:items-center gap-2">
  <!-- About Statement (Bottom Left) -->
  <div class="flex items-center space-x-2 flex-wrap">
    <span class="text-xs" style="color: var(--text-secondary);">
      Need help? Contact 
    </span>
    <UserBadge 
      pubkey="fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1"
      size="small"
      showAvatar={true}
      onProfileClick={openProfilePopup}
      hideSearchIcon={true}
    />
    <span class="text-xs" style="color: var(--text-secondary);">
      for support.
    </span>
  </div>

  <!-- Browse Cache and Settings Buttons (Bottom Right) -->
  <div class="flex items-center space-x-2 self-start md:self-auto">
    <!-- Browse Cache Button -->
    <button
      onclick={toggleCacheBrowser}
      class="p-2 rounded-md border transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2" style="background-color: var(--bg-primary); color: var(--accent); border-color: var(--accent); --tw-ring-color: var(--accent);"
      title="Browse Cache"
      aria-label="Open cache browser"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
      </svg>
    </button>
    
    <!-- Settings Button -->
    <button
      onclick={toggleSettings}
      class="p-2 rounded-md border transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2" style="background-color: var(--bg-primary); color: var(--accent); border-color: var(--accent); --tw-ring-color: var(--accent);"
      title="Settings"
      aria-label="Open settings"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    </button>
  </div>
</div>

<!-- Settings Panel -->
{#if showSettings}
  <!-- Mobile: Bottom drawer -->
  <div class="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50" onclick={toggleSettings} onkeydown={(e) => e.key === 'Escape' && toggleSettings()} role="dialog" aria-modal="true" tabindex="-1">
    <div class="fixed bottom-0 left-0 right-0 max-h-[90vh] overflow-y-auto rounded-t-lg border-t" style="background-color: var(--bg-primary); border-color: var(--border);" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="0">
      <div class="p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold" style="color: var(--text-primary);">Settings</h3>
          <button
            onclick={toggleSettings}
            class="p-1 rounded transition-colors hover:opacity-70"
            style="color: var(--text-primary); background-color: var(--bg-secondary);"
            aria-label="Close settings"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <Settings createChild={() => {}} />
      </div>
    </div>
  </div>

  <!-- Desktop: Popup -->
  <div class="hidden md:block fixed inset-0 z-50 bg-black bg-opacity-50" onclick={toggleSettings} onkeydown={(e) => e.key === 'Escape' && toggleSettings()} role="dialog" aria-modal="true" tabindex="-1">
    <div class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-4xl max-h-[90vh] overflow-y-auto p-6 rounded-lg border shadow-lg" style="background-color: var(--bg-primary); border-color: var(--border);" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" tabindex="0">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-2xl font-semibold" style="color: var(--text-primary);">Settings</h3>
        <button
          onclick={toggleSettings}
          class="p-1 rounded transition-colors hover:opacity-70" style="color: var(--text-primary); background-color: var(--bg-secondary);"
          aria-label="Close settings"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <Settings createChild={() => {}} />
    </div>
  </div>
{/if}

<!-- Cache Browser -->
{#if showCacheBrowser}
  <CacheBrowser onClose={toggleCacheBrowser} />
{/if}


<!-- Profile Popup -->
{#if showProfilePopup}
  <ProfilePopup
    pubkey={hexPubkey}
    bech32="npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z"
    isOpen={showProfilePopup}
    onClose={closeProfilePopup}
  />
{/if}
