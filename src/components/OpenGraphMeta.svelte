<script lang="ts">
  import { cards } from '$lib/state';
  import { page } from '$app/state';
  import type { ArticleCard } from '$lib/types';
  import { nip19 } from '@nostr/tools';
  import { getTagOr } from '$lib/utils';
  import { contentCache } from '$lib/contentCache';
  import { getTitleFromEvent } from '$lib/contentQualityControl';
  import type { NostrEvent } from '@nostr/tools/pure';

  // Get the current article card (last card if it's an article)
  const currentArticle = $derived(() => {
    if ($cards.length === 0) return null;
    const lastCard = $cards[$cards.length - 1];
    if (lastCard?.type === 'article') {
      return lastCard as ArticleCard;
    }
    return null;
  });

  // Get the event for the current article
  const currentEvent = $derived(() => {
    const article = currentArticle();
    if (!article) return null;
    
    // Check if event is already in the card
    if (article.actualEvent) {
      return article.actualEvent;
    }
    
    // Try to get from cache
    const cachedEvents = contentCache.getEvents('wiki');
    const wikiKinds = [30818, 30817, 30040, 30041, 30023];
    const cached = cachedEvents.find(cached => 
      cached.event.pubkey === article.data[1] && 
      getTagOr(cached.event, 'd') === article.data[0] && 
      wikiKinds.includes(cached.event.kind)
    );
    
    return cached?.event || null;
  });

  // Generate OG meta tags based on current event
  const ogData = $derived(() => {
    const event = currentEvent();
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://wikistr.imwald.eu';
    const currentPath = $page.url.pathname;
    const fullUrl = `${baseUrl}${currentPath}`;

    if (!event) {
      // Default OG tags for the homepage
      return {
        title: 'Wikistr - A decentralized book study and wiki system built on Nostr',
        description: 'Biblestr - A decentralized Bible study and wiki system built on Nostr',
        image: `${baseUrl}/favicon.png`,
        url: fullUrl,
        type: 'website'
      };
    }

    // Get event metadata
    const title = getTitleFromEvent(event, true);
    const description = event.tags.find(([k]) => k === 'description')?.[1] || 
                       event.tags.find(([k]) => k === 'summary')?.[1] ||
                       (event.content ? event.content.substring(0, 200).replace(/\n/g, ' ').trim() : '') ||
                       'A Nostr article';
    
    // Get image if available
    const imageTag = event.tags.find(([k]) => k === 'image');
    const image = imageTag?.[1] || `${baseUrl}/favicon.png`;

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
      title: `${title} - Wikistr`,
      description: description.length > 200 ? description.substring(0, 197) + '...' : description,
      image,
      url: naddr ? `${baseUrl}/naddr/${naddr}` : fullUrl,
      type: articleType,
      naddr
    };
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
  <meta property="og:image" content={ogData().image} />
  <meta property="og:site_name" content="Wikistr" />

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content={ogData().url} />
  <meta property="twitter:title" content={ogData().title} />
  <meta property="twitter:description" content={ogData().description} />
  <meta property="twitter:image" content={ogData().image} />

  <!-- Nostr-specific meta -->
  {#if ogData().naddr}
    <meta name="nostr:naddr" content={ogData().naddr} />
  {/if}
</svelte:head>

