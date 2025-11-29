<script lang="ts">
  import { onMount } from 'svelte';
  import { nip19 } from '@nostr/tools';
  import { relayService } from '$lib/relayService';
  import { extractNostrIdentifier } from '$lib/ogUtils';
  import { getTagOr } from '$lib/utils';
  import type { NostrEvent } from '@nostr/tools/pure';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();
  
  let nostrId = $state<{ type: 'npub' | 'nprofile' | 'nevent' | 'note' | 'naddr' | null; value: string } | null>(null);
  let event = $state<NostrEvent | null>(null);
  let profileData = $state<{ pubkey: string; display_name?: string; name?: string; picture?: string } | null>(null);
  let loading = $state(true);

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
      
      if (!nostrId) {
        loading = false;
        return;
      }

      // Handle npub/nprofile - fetch profile
      if (nostrId.type === 'npub' || nostrId.type === 'nprofile') {
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
          const { contentCache } = await import('$lib/contentCache');
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
              await contentCache.storeEvents('profile', result.events.map(event => ({ event, relays: result.relays })));
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
      // Handle nevent/note/naddr/hex ID - fetch event
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
            } else {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ ids: [eventId], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              if (result.events.length > 0) {
                event = result.events[0];
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
            } else {
              const result = await relayService.queryEvents(
                'anonymous',
                'wiki-read',
                [{ kinds: [kind], authors: [author], '#d': [dTag], limit: 1 }],
                { excludeUserContent: false, currentUserPubkey: undefined }
              );
              if (result.events.length > 0) {
                event = result.events[0];
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
  <div class="rounded-lg border p-4" style="background-color: var(--bg-secondary); border-color: var(--border);">
    <div class="h-4 rounded mb-2" style="background-color: var(--bg-tertiary); width: 60%;"></div>
    <div class="h-3 rounded" style="background-color: var(--bg-tertiary); width: 80%;"></div>
  </div>
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
        
        <!-- T tags (topics) -->
        {@const tTags = event.tags.filter(([t]) => t === 't' || t === 'T').map(([, v]) => v).filter(Boolean)}
        {#if tTags.length > 0}
          <div class="flex flex-wrap gap-2 mb-2">
            {#each tTags as topic}
              <span class="text-xs px-2 py-1 rounded" style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
                #{topic}
              </span>
            {/each}
          </div>
        {/if}
      {/if}
      
      <!-- Author -->
      <div class="flex items-center space-x-2 mt-2">
        <UserBadge pubkey={event.pubkey} />
        {#if getTagOr(event, 'author')}
          <span class="text-xs" style="color: var(--text-secondary);">
            via {getTagOr(event, 'author')}
          </span>
        {/if}
      </div>
    </div>
  </a>
{:else}
  <!-- Generic fallback -->
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
    <div class="text-sm break-all" style="color: var(--text-secondary);">
      {shortUrl}
    </div>
  </a>
{/if}

