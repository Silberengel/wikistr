<script lang="ts">
  import { onMount } from 'svelte';
  import { nip19 } from '@nostr/tools';
  import { relayService } from '$lib/relayService';
  import { extractNostrIdentifier, fetchOGMetadata, type OGMetadata } from '$lib/ogUtils';
  import { getTagOr } from '$lib/utils';
  import type { NostrEvent } from '@nostr/tools/pure';
  import UserBadge from './UserBadge.svelte';
  import asciidoctor from '@asciidoctor/core';
  import { convertMarkdownToAsciiDoc } from '$lib/markdownToAsciiDoc';
  import { contentCache } from '$lib/contentCache';

  interface Props {
    url: string;
    horizontal?: boolean;
  }

  let { url, horizontal = false }: Props = $props();
  
  let nostrId = $state<{ type: 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr' | 'hex' | 'nip05' | 'pubkey-dtag' | 'npub-dtag' | 'dtag-only' | null; value: string; pubkey?: string; dTag?: string } | null>(null);
  let event = $state<NostrEvent | null>(null);
  let profileData = $state<{ pubkey: string; display_name?: string; name?: string; picture?: string } | null>(null);
  let loading = $state(true);
  let contentPreview = $state<string>('');
  let contentPreviewHtml = $state<string>('');
  let contentTruncated = $state(false);
  let ogData = $state<OGMetadata | null>(null);
  let ogError = $state(false);
  let hasNostrId = $state(false);
  
  // Helper function to set content preview and track truncation
  function setContentPreview(content: string) {
    contentTruncated = content.length > 1000;
    contentPreview = content.substring(0, 1000);
  }

  // Render content preview (markdown or asciidoc)
  function renderContentPreview(content: string, kind: number): string {
    if (!content) return '';
    
    // Track if content was truncated
    contentTruncated = content.length > 1000;
    const preview = content.substring(0, 1000);
    
    // Determine if it's markdown or asciidoc
    // 30040 is an index, so it has not content
    const isMarkdown = kind === 30817 || kind === 30023;
    const isAsciiDoc = kind === 30818 || kind === 30041;
    
    try {
      const adoc = asciidoctor();
      let contentToRender = preview;
      
      if (isMarkdown) {
        // Convert markdown to asciidoc first, then render
        contentToRender = convertMarkdownToAsciiDoc(preview, {
          convertTables: false,
          convertCodeBlocks: false,
          convertBlockquotes: false
        });
      }
      
      // Render as asciidoc (works for both asciidoc and converted markdown)
      if (isAsciiDoc || isMarkdown) {
        return adoc.convert(contentToRender, { safe: 'safe', attributes: { showtitle: true } }) as string;
      } else {
        // For other kinds, just return plain text with line breaks
        return preview.replace(/\n/g, '<br>');
      }
    } catch (e) {
      // Fallback to plain text if rendering fails
      return preview.replace(/\n/g, '<br>');
    }
  }

  // Human-readable bookstr tag names
  const bookstrTagNames: Record<string, string> = {
    'C': 'Collection',
    'T': 'Title',
    'c': 'chapter',
    's': 'section',
    'v': 'version'
  };

  onMount(async () => {
    try {
      // Extract Nostr identifier from URL
      nostrId = extractNostrIdentifier(url);
      
      if (nostrId) {
        hasNostrId = true;
      } else if (horizontal) {
        // For horizontal layout, try to fetch OG metadata if no Nostr ID
        try {
          const data = await fetchOGMetadata(url);
          ogData = data;
          ogError = !data;
        } catch (e) {
          console.error('Failed to fetch OG data:', e);
          ogError = true;
        } finally {
          loading = false;
          return;
        }
      } else {
        loading = false;
        return;
      }

      // Handle dtag-only - query events by d-tag across all authors
      if (nostrId.type === 'dtag-only' && nostrId.dTag) {
        try {
          const dTag = nostrId.dTag;
          
          // Try common event kinds that use d-tags
          const kindsToTry = [30040, 30041, 30023, 30817, 30818];
          
          // Check cache first
          const allCached = [
            ...contentCache.getEvents('publications'),
            ...contentCache.getEvents('longform'),
            ...contentCache.getEvents('wikis')
          ];
          
          let foundEvent = allCached.find(c => 
            kindsToTry.includes(c.event.kind) &&
            getTagOr(c.event, 'd') === dTag
          )?.event;
          
          if (foundEvent) {
            event = foundEvent;
            const content = foundEvent.content || '';
            setContentPreview(content);
            contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
          } else {
            // Try each kind until we find a match (query without authors to search across all)
            for (const kind of kindsToTry) {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ kinds: [kind], '#d': [dTag], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              
              if (result.events.length > 0) {
                event = result.events[0];
                const content = event.content || '';
                setContentPreview(content);
                contentPreviewHtml = renderContentPreview(content, event.kind);
                
                // Store in cache
                const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                                 event.kind === 30023 ? 'longform' :
                                 (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
                if (cacheType) {
                  await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
                }
                break; // Found it, stop trying other kinds
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch event by d-tag only:', e);
        }
      }
      // Handle nip-05 - fetch profile by nip-05
      else if (nostrId.type === 'nip05') {
        try {
          // Resolve nip-05 to pubkey
          const [localPart, domain] = nostrId.value.split('@');
          const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${localPart}`;
          
          const response = await fetch(wellKnownUrl);
          if (response.ok) {
            const data = await response.json();
            const names = data.names || {};
            const pubkey = names[localPart];
            
            if (pubkey) {
              // Fetch profile using the resolved pubkey
              const cachedProfile = contentCache.getEvents('profile').find(c => 
                c.event.pubkey === pubkey && c.event.kind === 0
              );
              
              let result: any;
              if (cachedProfile) {
                result = { events: [cachedProfile.event], relays: cachedProfile.relays };
              } else {
                result = await relayService.queryEvents(
                  'anonymous',
                  'metadata-read',
                  [{ kinds: [0], authors: [pubkey], limit: 1 }],
                  { excludeUserContent: false, currentUserPubkey: undefined }
                );
                
                if (result.events.length > 0) {
                  await contentCache.storeEvents('profile', result.events.map((event: NostrEvent) => ({ event, relays: result.relays })));
                }
              }
              
              if (result.events.length > 0) {
                const profileEvent = result.events[0];
                let content: any = {};
                
                if (profileEvent.tags && Array.isArray(profileEvent.tags)) {
                  for (const tag of profileEvent.tags) {
                    if (Array.isArray(tag) && tag.length >= 2) {
                      const key = tag[0].toLowerCase();
                      const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
                      if (value && typeof value === 'string') {
                        if (key === 'display_name' || key === 'displayname') content.display_name = value;
                        else if (key === 'name') content.name = value;
                        else if (key === 'picture' || key === 'avatar') content.picture = value;
                      }
                    }
                  }
                }
                
                if (!content.display_name && !content.name && !content.picture) {
                  try {
                    content = JSON.parse(profileEvent.content);
                  } catch (e) {
                    // Ignore parse errors
                  }
                }
                
                profileData = {
                  pubkey,
                  display_name: content.display_name,
                  name: content.name,
                  picture: content.picture
                };
              } else {
                profileData = { pubkey };
              }
            }
          }
        } catch (e) {
          console.error('Failed to resolve nip-05:', e);
        }
      }
      // Handle npub/nprofile - fetch profile
      else if (nostrId.type === 'npub' || nostrId.type === 'nprofile') {
        try {
          const decoded = nip19.decode(nostrId.value);
          let pubkey: string;
          
          if (decoded.type === 'npub') {
            pubkey = decoded.data as string;
          } else if (decoded.type === 'nprofile') {
            const profileData = decoded.data as { pubkey: string };
            pubkey = profileData.pubkey;
          } else {
            // Unexpected type, skip
            loading = false;
            return;
          }
          
          // Check cache first for profile metadata
          const cachedProfile = contentCache.getEvents('profile').find(c => 
            c.event.pubkey === pubkey && c.event.kind === 0
          );
          
          let result: any;
          if (cachedProfile) {
            result = { events: [cachedProfile.event], relays: cachedProfile.relays };
          } else {
            // Fetch profile metadata
            result = await relayService.queryEvents(
              'anonymous',
              'metadata-read',
              [{ kinds: [0], authors: [pubkey], limit: 1 }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            
            // Store in cache
            if (result.events.length > 0) {
              await contentCache.storeEvents('profile', result.events.map((event: NostrEvent) => ({ event, relays: result.relays })));
            }
          }
          
          if (result.events.length > 0) {
            const profileEvent = result.events[0];
            let content: any = {};
            
            // Parse from tags first
            if (profileEvent.tags && Array.isArray(profileEvent.tags)) {
              for (const tag of profileEvent.tags) {
                if (Array.isArray(tag) && tag.length >= 2) {
                  const key = tag[0].toLowerCase();
                  const value = Array.isArray(tag[1]) ? tag[1][0] : tag[1];
                  if (value && typeof value === 'string') {
                    if (key === 'display_name' || key === 'displayname') content.display_name = value;
                    else if (key === 'name') content.name = value;
                    else if (key === 'picture' || key === 'avatar') content.picture = value;
                  }
                }
              }
            }
            
            // Fallback to content JSON
            if (!content.display_name && !content.name && !content.picture) {
              try {
                content = JSON.parse(profileEvent.content);
              } catch (e) {
                // Ignore parse errors
              }
            }
            
            profileData = {
              pubkey,
              display_name: content.display_name,
              name: content.name,
              picture: content.picture
            };
          } else {
            profileData = { pubkey };
          }
        } catch (e) {
          console.error('Failed to decode/fetch profile:', e);
        }
      } 
      // Handle hex ID - fetch event by hex ID
      else if (nostrId.type === 'hex') {
        try {
          const eventId = nostrId.value;
          const allCached = [
            ...contentCache.getEvents('publications'),
            ...contentCache.getEvents('longform'),
            ...contentCache.getEvents('wikis')
          ];
          
          let foundEvent = allCached.find(c => c.event.id === eventId)?.event;
          if (foundEvent) {
            event = foundEvent;
            // Generate content preview
            const content = foundEvent.content || '';
            setContentPreview(content);
            contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
          } else {
            const result = await relayService.queryEvents(
              'anonymous',
              'wiki-read',
              [{ ids: [eventId], limit: 1 }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            if (result.events.length > 0) {
              event = result.events[0];
              // Generate content preview
              const content = event.content || '';
              setContentPreview(content);
              contentPreviewHtml = renderContentPreview(content, event.kind);
              // Store in cache
              const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                               event.kind === 30023 ? 'longform' :
                               (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
              if (cacheType) {
                await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch event by hex ID:', e);
        }
      }
      // Handle pubkey-dtag pattern (d-tag*pubkey or pubkey*d-tag)
      else if (nostrId.type === 'pubkey-dtag' && nostrId.pubkey && nostrId.dTag) {
        try {
          const pubkey = nostrId.pubkey;
          const dTag = nostrId.dTag;
          
          // Try common event kinds that use d-tags
          const kindsToTry = [30040, 30041, 30023, 30817, 30818];
          
          // Check cache first
          const allCached = [
            ...contentCache.getEvents('publications'),
            ...contentCache.getEvents('longform'),
            ...contentCache.getEvents('wikis')
          ];
          
          let foundEvent = allCached.find(c => 
            c.event.pubkey === pubkey &&
            getTagOr(c.event, 'd') === dTag &&
            kindsToTry.includes(c.event.kind)
          )?.event;
          
          if (foundEvent) {
            event = foundEvent;
            const content = foundEvent.content || '';
            setContentPreview(content);
            contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
          } else {
            // Try each kind until we find a match
            for (const kind of kindsToTry) {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ kinds: [kind], authors: [pubkey], '#d': [dTag], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              
              if (result.events.length > 0) {
                event = result.events[0];
                const content = event.content || '';
                setContentPreview(content);
                contentPreviewHtml = renderContentPreview(content, event.kind);
                
                // Store in cache
                const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                                 event.kind === 30023 ? 'longform' :
                                 (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
                if (cacheType) {
                  await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
                }
                break; // Found it, stop trying other kinds
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch event by pubkey+d-tag:', e);
        }
      }
      // Handle npub-dtag pattern (d-tag/npub)
      else if (nostrId.type === 'npub-dtag' && nostrId.dTag) {
        try {
          // Decode npub to get pubkey
          const decoded = nip19.decode(nostrId.value);
          if (decoded.type === 'npub') {
            const pubkey = decoded.data as string;
            const dTag = nostrId.dTag;
            
            // Try common event kinds that use d-tags
            const kindsToTry = [30040, 30041, 30023, 30817, 30818];
            
            // Check cache first
            const allCached = [
              ...contentCache.getEvents('publications'),
              ...contentCache.getEvents('longform'),
              ...contentCache.getEvents('wikis')
            ];
            
            let foundEvent = allCached.find(c => 
              c.event.pubkey === pubkey &&
              getTagOr(c.event, 'd') === dTag &&
              kindsToTry.includes(c.event.kind)
            )?.event;
            
            if (foundEvent) {
              event = foundEvent;
              const content = foundEvent.content || '';
              setContentPreview(content);
              contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
            } else {
              // Try each kind until we find a match
              for (const kind of kindsToTry) {
                const result = await relayService.queryEvents(
                  'anonymous',
                  'wiki-read',
                  [{ kinds: [kind], authors: [pubkey], '#d': [dTag], limit: 1 }],
                  { excludeUserContent: false, currentUserPubkey: undefined }
                );
                
                if (result.events.length > 0) {
                  event = result.events[0];
                  const content = event.content || '';
                  setContentPreview(content);
                  contentPreviewHtml = renderContentPreview(content, event.kind);
                  
                  // Store in cache
                  const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                                   event.kind === 30023 ? 'longform' :
                                   (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
                  if (cacheType) {
                    await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
                  }
                  break; // Found it, stop trying other kinds
                }
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch event by npub+d-tag:', e);
        }
      }
      // Handle nevent/note/naddr - fetch event
      else if (nostrId.type === 'nevent' || nostrId.type === 'note' || nostrId.type === 'naddr') {
        try {
          let eventId: string | null = null;
          let author: string | null = null;
          let kind: number | null = null;
          let dTag: string | null = null;
          
          const decoded = nip19.decode(nostrId.value);
          
          if (decoded.type === 'nevent') {
            const eventData = decoded.data as { id: string; author?: string };
            eventId = eventData.id;
            author = eventData.author || null;
          } else if (decoded.type === 'note') {
            eventId = decoded.data as string;
          } else if (decoded.type === 'naddr') {
            const addrData = decoded.data as { kind: number; pubkey: string; identifier: string };
            kind = addrData.kind;
            author = addrData.pubkey;
            dTag = addrData.identifier;
          } else {
            // Unexpected type, skip
            loading = false;
            return;
          }
          
          // Fetch event - check cache first
          const allCached = [
            ...contentCache.getEvents('publications'),
            ...contentCache.getEvents('longform'),
            ...contentCache.getEvents('wikis')
          ];
          
          if (eventId) {
            let foundEvent = allCached.find(c => c.event.id === eventId)?.event;
            if (foundEvent) {
              event = foundEvent;
              // Generate content preview
              const content = foundEvent.content || '';
              setContentPreview(content);
              contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
            } else {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ ids: [eventId], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              if (result.events.length > 0) {
                event = result.events[0];
                // Generate content preview
                const content = event.content || '';
                setContentPreview(content);
                contentPreviewHtml = renderContentPreview(content, event.kind);
                // Store in cache
                const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                                 event.kind === 30023 ? 'longform' :
                                 (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
                if (cacheType) {
                  await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
                }
              }
            }
          } else if (kind && author && dTag) {
            const { getTagOr } = await import('$lib/utils');
            let foundEvent = allCached.find(c => 
              c.event.kind === kind &&
              c.event.pubkey === author &&
              getTagOr(c.event, 'd') === dTag
            )?.event;
            if (foundEvent) {
              event = foundEvent;
              // Generate content preview
              const content = foundEvent.content || '';
              setContentPreview(content);
              contentPreviewHtml = renderContentPreview(content, foundEvent.kind);
            } else {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ kinds: [kind], authors: [author], '#d': [dTag], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              if (result.events.length > 0) {
                event = result.events[0];
                // Generate content preview
                const content = event.content || '';
                setContentPreview(content);
                contentPreviewHtml = renderContentPreview(content, event.kind);
                // Store in cache
                const cacheType = event.kind === 30040 || event.kind === 30041 ? 'publications' :
                                 event.kind === 30023 ? 'longform' :
                                 (event.kind === 30817 || event.kind === 30818) ? 'wikis' : null;
                if (cacheType) {
                  await contentCache.storeEvents(cacheType, [{ event, relays: result.relays }]);
                }
              }
            }
          }
        } catch (e) {
          console.error('Failed to decode/fetch event:', e);
        }
      }
    } catch (e) {
      console.error('Failed to process fallback link:', e);
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  {#if horizontal}
    <div class="flex items-center space-x-3 p-3 rounded border" style="background-color: var(--bg-secondary); border-color: var(--border);">
      <div class="w-16 h-16 rounded flex-shrink-0" style="background-color: var(--bg-tertiary);"></div>
      <div class="flex-1 min-w-0">
        <div class="h-4 rounded mb-2" style="background-color: var(--bg-tertiary); width: 60%;"></div>
        <div class="h-3 rounded" style="background-color: var(--bg-tertiary); width: 80%;"></div>
      </div>
    </div>
  {:else}
    <div class="rounded-lg border p-4" style="background-color: var(--bg-secondary); border-color: var(--border);">
      <div class="h-4 rounded mb-2" style="background-color: var(--bg-tertiary); width: 60%;"></div>
      <div class="h-3 rounded" style="background-color: var(--bg-tertiary); width: 80%;"></div>
    </div>
  {/if}
{:else if horizontal && ogData && !ogError}
  <!-- Horizontal OG card -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center space-x-3 p-3 rounded border transition-colors hover:opacity-80"
    style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
  >
    {#if ogData.image}
      <img
        src={ogData.image}
        alt={ogData.title || 'Preview'}
        class="w-16 h-16 rounded object-cover flex-shrink-0"
        style="min-width: 64px;"
        onerror={(e) => {
          const target = e.target as HTMLImageElement;
          if (target) target.style.display = 'none';
        }}
      />
    {/if}
    <div class="flex-1 min-w-0">
      <div class="font-semibold text-sm mb-1 truncate" style="color: var(--text-primary);">
        {ogData.title}
      </div>
      {#if ogData.description}
        <div class="text-xs line-clamp-2" style="color: var(--text-secondary);">
          {ogData.description}
        </div>
      {/if}
      {#if true}
        {@const urlObj = (() => {
          try {
            return new URL(url);
          } catch {
            return null;
          }
        })()}
        {@const shortUrl = url.length > 60 ? url.substring(0, 57) + '...' : url}
        <div class="text-xs mt-2 pt-2 border-t" style="border-color: var(--border);">
          <div class="text-xs truncate underline" style="color: var(--accent);">
            {shortUrl}
          </div>
        </div>
      {/if}
    </div>
  </a>
{:else if horizontal && !hasNostrId}
  <!-- Horizontal generic fallback -->
  {#if true}
    {@const urlObj = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })()}
    {@const shortUrl = url.length > 60 ? url.substring(0, 57) + '...' : url}
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      class="block p-3 rounded border transition-colors hover:opacity-80"
      style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
    >
      <div class="text-sm break-all underline" style="color: var(--accent);">
        {shortUrl}
      </div>
    </a>
  {/if}
{:else if profileData}
  <!-- Profile fallback -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="block rounded-lg border p-4 transition-all hover:opacity-90"
    style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
  >
    <div class="flex items-center space-x-3">
      {#if profileData.picture}
        <img
          src={profileData.picture}
          alt={profileData.display_name || profileData.name || 'Profile'}
          class="w-12 h-12 rounded-full object-cover flex-shrink-0"
          onerror={(e) => {
            const target = e.target as HTMLImageElement;
            if (target) target.style.display = 'none';
          }}
        />
      {:else}
        <div class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: var(--bg-tertiary);">
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20" style="color: var(--text-secondary);">
            <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
          </svg>
        </div>
      {/if}
      <div class="flex-1 min-w-0">
        <div class="font-semibold" style="color: var(--text-primary);">
          {profileData.display_name || profileData.name || `npub1${profileData.pubkey.slice(0, 8)}...`}
        </div>
        {#if profileData.name && profileData.name !== profileData.display_name}
          <div class="text-sm" style="color: var(--text-secondary);">
            @{profileData.name}
          </div>
        {/if}
      </div>
    </div>
  </a>
{:else if event}
  <!-- Event fallback -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="block rounded-lg border overflow-hidden transition-all hover:opacity-90"
    style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
  >
    {#if getTagOr(event, 'image')}
      <div class="w-full h-48 overflow-hidden" style="background-color: var(--bg-tertiary);">
        <img
          src={getTagOr(event, 'image')}
          alt={getTagOr(event, 'title') || 'Event'}
          class="w-full h-full object-cover"
          onerror={(e) => {
            const target = e.target as HTMLImageElement;
            if (target) {
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent) parent.style.display = 'none';
            }
          }}
        />
      </div>
    {/if}
    <div class="p-4">
      {#if getTagOr(event, 'title')}
        <div class="font-semibold text-lg mb-2" style="color: var(--text-primary);">
          {getTagOr(event, 'title')}
        </div>
      {/if}
      {#if getTagOr(event, 'summary')}
        <div class="text-sm mb-2 line-clamp-3" style="color: var(--text-secondary);">
          {getTagOr(event, 'summary')}
        </div>
      {/if}
      
      <!-- Content Preview (first 1000 chars) -->
      {#if contentPreviewHtml}
        <div class="text-sm mb-2 prose prose-sm max-w-none" style="color: var(--text-secondary);">
          {@html contentPreviewHtml}
          {#if contentTruncated}
            <span style="color: var(--text-secondary);">...</span>
          {/if}
        </div>
      {:else if contentPreview}
        <div class="text-sm mb-2 whitespace-pre-wrap" style="color: var(--text-secondary);">
          {contentPreview}{#if contentTruncated}...{/if}
        </div>
      {/if}
      
      <!-- Bookstr tags -->
      {#if event.tags}
        {@const bookstrTags = event.tags.filter(([t]) => ['C', 'c', 'T', 't', 's', 'S', 'v', 'V'].includes(t))}
        {#if bookstrTags.length > 0}
          <div class="flex flex-wrap gap-2 mb-2">
            {#each bookstrTags as tag}
              {@const tagName = bookstrTagNames[tag[0]] || tag[0]}
              {@const tagValue = tag[1] || ''}
              {#if tagValue}
                <span class="text-xs px-2 py-1 rounded" style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
                  {tagName}: {tagValue}
                </span>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}
      
      <!-- Website name and URL -->
      {#if true}
        {@const urlObj = (() => {
          try {
            return new URL(url);
          } catch {
            return null;
          }
        })()}
        {@const shortUrl = url.length > 60 ? url.substring(0, 57) + '...' : url}
        <div class="mt-3 pt-3 border-t" style="border-color: var(--border);">
          <div class="text-xs break-all underline" style="color: var(--accent);">
            {shortUrl}
          </div>
        </div>
      {/if}
      
      <!-- Author -->
      <div class="flex items-center space-x-2 mt-2">
        {#if getTagOr(event, 'author')}
          <span class="text-xs font-medium" style="color: var(--text-primary);">
            {getTagOr(event, 'author')}
          </span>
          <span class="text-xs" style="color: var(--text-secondary);">
            via
          </span>
        {/if}
        <UserBadge pubkey={event.pubkey} />
      </div>
    </div>
  </a>
{:else}
  <!-- Generic fallback -->
  {#if true}
    {@const urlObj = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })()}
    {@const shortUrl = url.length > 60 ? url.substring(0, 57) + '...' : url}
    {@const websiteName = urlObj ? urlObj.hostname.replace(/^www\./, '') : 'External Link'}
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      class="block rounded-lg border p-4 transition-all hover:opacity-90"
      style="background-color: var(--bg-secondary); border-color: var(--border); text-decoration: none;"
    >
      <div class="font-semibold mb-1" style="color: var(--text-primary);">
        {websiteName}
      </div>
      <div class="text-sm break-all underline" style="color: var(--accent);">
        {shortUrl}
      </div>
    </a>
  {/if}
{/if}

