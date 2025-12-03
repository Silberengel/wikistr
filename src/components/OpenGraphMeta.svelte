<script lang="ts">
  import { cards } from '$lib/state';
  import type { ArticleCard } from '$lib/types';
  import { nip19 } from '@nostr/tools';
  import { getTagOr } from '$lib/utils';
  import { contentCache } from '$lib/contentCache';
  import type { NostrEvent } from '@nostr/tools/pure';
  import { getThemeConfig } from '$lib/themes';

  console.log('[OpenGraphMeta] Component initializing');
  try {
    console.log('[OpenGraphMeta] Checking cards store:', {
      exists: !!cards,
      isObject: typeof cards === 'object',
      hasSubscribe: 'subscribe' in cards,
      subscribeType: typeof (cards as any).subscribe
    });
  } catch (err) {
    console.error('[OpenGraphMeta] ✗ Failed to check cards store:', err);
  }

  // Get theme configuration
  const theme = getThemeConfig();

  /**
   * Normalize d-tag to title case: remove hyphens and capitalize words
   */
  function normalizeDTagToTitle(dTag: string): string {
    if (!dTag) return '';
    return dTag
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Get the first article card (not the last) - only show info for first event if multiple are open
  const currentArticle = $derived(() => {
    try {
      if ($cards.length === 0) return null;
      // Find the first article card in the cards array
      for (const card of $cards) {
        if (card?.type === 'article') {
          return card as ArticleCard;
        }
      }
      return null;
    } catch (err) {
      console.error('[OpenGraphMeta] ✗ Error in currentArticle derived:', err);
      return null;
    }
  });

  // Get the event for the current article
  const currentEvent = $derived(() => {
    try {
      const article = currentArticle();
      if (!article) return null;
      
      // Check if event is already in the card
      if (article.actualEvent) {
        return article.actualEvent;
      }
      
      // Try to get from cache
      const cachedEvents = [
        ...contentCache.getEvents('publications'),
        ...contentCache.getEvents('longform'),
        ...contentCache.getEvents('wikis')
      ];
      const wikiKinds = [30818, 30817, 30040, 30041, 30023];
      const cached = cachedEvents.find(cached => 
        cached.event.pubkey === article.data[1] && 
        getTagOr(cached.event, 'd') === article.data[0] && 
        wikiKinds.includes(cached.event.kind)
      );
      
      return cached?.event || null;
    } catch (err) {
      console.error('[OpenGraphMeta] ✗ Error in currentEvent derived:', err);
      return null;
    }
  });

  // Get user metadata (handle/profile pic) for the event author
  const authorMetadata = $derived(() => {
    try {
      const event = currentEvent();
      if (!event) return null;

      // Try to get from cache
      const cachedEvents = contentCache.getEvents('profile');
      const cachedUserEvent = cachedEvents.find(cached => 
        cached.event.pubkey === event.pubkey && cached.event.kind === 0
      );

      if (cachedUserEvent) {
        try {
          // Try to parse from tags first, then content
          let content: any = {};
          if (cachedUserEvent.event.tags && Array.isArray(cachedUserEvent.event.tags)) {
            for (const tag of cachedUserEvent.event.tags) {
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
          // Fallback to content if tags didn't provide values
          if (!content.display_name && !content.name && !content.picture) {
            content = JSON.parse(cachedUserEvent.event.content);
          }
          return {
            handle: content.display_name || content.name || null,
            picture: content.picture || null
          };
        } catch (e) {
          console.warn('[OpenGraphMeta] Failed to parse cached user metadata:', e);
        }
      }

      return null;
    } catch (err) {
      console.error('[OpenGraphMeta] ✗ Error in authorMetadata derived:', err);
      return null;
    }
  });

  // Generate OG meta tags based on current event
  const ogData = $derived(() => {
    try {
      const event = currentEvent();
      const author = authorMetadata();
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://wikistr.imwald.eu';
      // Use window.location instead of $page to avoid potential subscription issues
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const fullUrl = `${baseUrl}${currentPath}`;

      // Default favicon/icon URL
      const faviconUrl = `${baseUrl}/favicon.svg`;
      // Use larger og-image for better social media display
      // Use theme-specific og-image if available, otherwise fall back to generic
      const themeName = theme.name || 'wikistr';
      const ogImageUrl = `${baseUrl}/og-image-${themeName}.svg`;

      if (!event) {
        // Default OG tags for the homepage
        return {
          title: theme.tagline || 'Wikistr',
          description: theme.description || theme.tagline || 'A decentralized wiki system built on Nostr',
          image: ogImageUrl,
          url: fullUrl,
          type: 'website',
          naddr: null,
          authorHandle: null,
          authorPicture: null,
          siteName: theme.name || 'Wikistr'
        };
      }

      // Get title: title tag -> d-tag normalized -> theme tagline
      let title = event.tags.find(([k]) => k === 'title')?.[1];
      if (!title) {
        const dTag = getTagOr(event, 'd');
        if (dTag) {
          title = normalizeDTagToTitle(dTag);
        }
      }
      if (!title) {
        title = theme.tagline || 'Wikistr';
      }

      // Get description: description/summary tag -> first 250 chars of content
      let description = event.tags.find(([k]) => k === 'description')?.[1] || 
                       event.tags.find(([k]) => k === 'summary')?.[1];
      if (!description && event.content) {
        description = event.content.replace(/\n/g, ' ').trim().substring(0, 250);
      }
      if (!description) {
        description = 'A Nostr article';
      }
      
      // Get image: event image tag -> author picture -> og-image -> favicon
      const imageTag = event.tags.find(([k]) => k === 'image');
      const image = imageTag?.[1] || author?.picture || ogImageUrl;

      // Generate naddr for the event
      let naddr = '';
      try {
        const dTag = getTagOr(event, 'd') || event.id;
        const identifier = { kind: event.kind, pubkey: event.pubkey, identifier: dTag };
        naddr = nip19.naddrEncode(identifier);
      } catch (e) {
        console.warn('Failed to generate naddr for OG tags:', e);
      }

      // Determine article type
      let articleType = 'article';
      if (event.kind === 30040 || event.kind === 30041) {
        articleType = 'book';
      } else if (event.kind === 30023) {
        articleType = 'article';
      }

      return {
        title,
        description,
        image,
        url: naddr ? `${baseUrl}/${naddr}` : fullUrl,
        type: articleType,
        naddr,
        authorHandle: author?.handle || null,
        authorPicture: author?.picture || null,
        siteName: theme.name || 'Wikistr'
      };
    } catch (err) {
      console.error('[OpenGraphMeta] ✗ Error in ogData derived:', err);
      // Return default OG data on error
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://wikistr.imwald.eu';
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      return {
        title: theme.tagline || 'Wikistr',
        description: theme.description || theme.tagline || 'A decentralized wiki system built on Nostr',
        image: `${baseUrl}/og-image.svg`,
        url: `${baseUrl}${currentPath}`,
        type: 'website',
        naddr: null,
        authorHandle: null,
        authorPicture: null,
        siteName: theme.name || 'Wikistr'
      };
    }
  });
</script>

<svelte:head>
  <!-- Primary Meta Tags -->
  <title>{ogData().title}</title>
  <meta name="title" content={ogData().title} />
  <meta name="description" content={ogData().description} />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content={ogData().type} />
  <meta property="og:url" content={ogData().url} />
  <meta property="og:title" content={ogData().title} />
  <meta property="og:description" content={ogData().description} />
  {#if ogData().image}
    <meta property="og:image" content={ogData().image} />
  {/if}
  <meta property="og:site_name" content={ogData().siteName} />
  {#if ogData().authorHandle}
    <meta property="article:author" content={ogData().authorHandle} />
  {/if}

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content={ogData().url} />
  <meta property="twitter:title" content={ogData().title} />
  <meta property="twitter:description" content={ogData().description} />
  {#if ogData().image}
    <meta property="twitter:image" content={ogData().image} />
  {/if}
  <meta property="twitter:site" content={ogData().siteName} />

  <!-- Nostr-specific meta -->
  {#if ogData().naddr}
    <meta name="nostr:naddr" content={ogData().naddr} />
  {/if}
</svelte:head>

