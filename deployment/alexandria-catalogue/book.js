/**
 * Book operations - hierarchy building, combining events, etc.
 */

import { nip19 } from './nostr.js';
import { fetchEventsByFilters, fetchEventsByIds } from './nostr.js';
import { DEFAULT_RELAYS } from './config.js';

/**
 * Compress image buffer to reduce file size
 * Returns compressed buffer or original if compression fails
 */
export async function compressImage(buffer, contentType) {
  try {
    // Try to use sharp if available (fast, efficient)
    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch (e) {
      // Sharp not available, skip compression
      console.log(`[Image Compression] Sharp not available, skipping compression`);
      return buffer;
    }
    
    const sharpInstance = sharp(buffer);
    
    // Get image metadata
    const metadata = await sharpInstance.metadata();
    const width = metadata.width;
    const height = metadata.height;
    
    // Compression settings based on image type
    let compressed;
    
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      // JPEG: resize if too large, reduce quality
      compressed = sharpInstance.jpeg({ 
        quality: 85, 
        progressive: true,
        mozjpeg: true 
      });
      
      // Resize if image is wider or taller than 1000px (constrain longest dimension)
      if (width > 1000 || height > 1000) {
        compressed = compressed.resize(1000, 1000, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
    } else if (contentType.includes('png')) {
      // PNG: convert to JPEG if large, or optimize PNG
      if (buffer.length > 500 * 1024) { // If PNG > 500KB, convert to JPEG
        compressed = sharpInstance.jpeg({ 
          quality: 85,
          progressive: true,
          mozjpeg: true 
        });
        // Resize if wider or taller than 1000px (constrain longest dimension)
        if (width > 1000 || height > 1000) {
          compressed = compressed.resize(1000, 1000, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
      } else {
        // Optimize PNG
        compressed = sharpInstance.png({ 
          compressionLevel: 9,
          adaptiveFiltering: true
        });
        // Resize if wider or taller than 1000px (constrain longest dimension)
        if (width > 1000 || height > 1000) {
          compressed = compressed.resize(1000, 1000, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
      }
    } else if (contentType.includes('webp')) {
      // WebP: optimize quality
      compressed = sharpInstance.webp({ 
        quality: 85,
        effort: 6
      });
      // Resize if wider than 1000px
      if (width > 1000) {
        compressed = compressed.resize(1000, null, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
    } else {
      // Other formats: just resize if wider or taller than 1000px (constrain longest dimension)
      if (width > 1000 || height > 1000) {
        compressed = sharpInstance.resize(1000, 1000, {
          fit: 'inside',
          withoutEnlargement: true
        });
      } else {
        return buffer; // No compression needed
      }
    }
    
    const compressedBuffer = await compressed.toBuffer();
    const originalSize = buffer.length;
    const compressedSize = compressedBuffer.length;
    const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    
    if (compressedSize < originalSize) {
      console.log(`[Image Compression] Compressed from ${originalSize} to ${compressedSize} bytes (${savings}% reduction)`);
      return compressedBuffer;
    } else {
      console.log(`[Image Compression] Compression didn't reduce size, using original`);
      return buffer;
    }
  } catch (error) {
    console.warn(`[Image Compression] Compression failed, using original:`, error.message);
    return buffer; // Return original on error
  }
}

/**
 * Download media file (image, video, audio) from URL and convert to base64 data URI
 * IMPORTANT: This is a temporary in-memory operation only.
 * Files are downloaded into memory, converted to base64, and embedded in content.
 * No files are written to disk - everything is processed in-memory and discarded after use.
 * Images are compressed before embedding to reduce file size.
 */
async function downloadMediaAsDataURI(url) {
  try {
    // Skip YouTube URLs and other streaming services - they can't be directly downloaded
    if (url.includes('youtube.com') || url.includes('youtu.be') || 
        url.includes('vimeo.com') || url.includes('dailymotion.com') ||
        url.includes('twitch.tv') || url.includes('soundcloud.com')) {
      console.log(`[Media Download] Skipping streaming service URL (cannot download directly): ${url}`);
      return url; // Return original URL
    }
    
    console.log(`[Media Download] Downloading media from: ${url} (temporary, in-memory only)`);
    
    // Add timeout to prevent hanging (10 seconds for images, 30 seconds for videos/audio)
    const isVideoOrAudio = /\.(mp4|webm|mp3|ogg|wav)$/i.test(url);
    const timeoutMs = isVideoOrAudio ? 30000 : 10000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Alexandria-Catalogue/1.0)'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Check content length - skip files larger than 50MB to prevent memory issues
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
        console.warn(`[Media Download] File too large (${contentLength} bytes), skipping: ${url}`);
        return url; // Return original URL
      }
      
      // Detect content type from response or URL
      let contentType = response.headers.get('content-type');
      if (!contentType) {
        // Try to guess from URL extension
        const urlLower = url.toLowerCase();
        if (urlLower.match(/\.(jpg|jpeg)$/)) contentType = 'image/jpeg';
        else if (urlLower.match(/\.png$/)) contentType = 'image/png';
        else if (urlLower.match(/\.gif$/)) contentType = 'image/gif';
        else if (urlLower.match(/\.webp$/)) contentType = 'image/webp';
        else if (urlLower.match(/\.svg$/)) contentType = 'image/svg+xml';
        else if (urlLower.match(/\.mp4$/)) contentType = 'video/mp4';
        else if (urlLower.match(/\.webm$/)) contentType = 'video/webm';
        else if (urlLower.match(/\.mp3$/)) contentType = 'audio/mpeg';
        else if (urlLower.match(/\.ogg$/)) contentType = 'audio/ogg';
        else if (urlLower.match(/\.wav$/)) contentType = 'audio/wav';
        else contentType = 'application/octet-stream';
      }
      
      // Download into memory only (no disk storage)
      const arrayBuffer = await response.arrayBuffer();
      
      // Check actual size after download
      if (arrayBuffer.byteLength > 50 * 1024 * 1024) {
        console.warn(`[Media Download] File too large after download (${arrayBuffer.byteLength} bytes), skipping: ${url}`);
        return url; // Return original URL
      }
      
      let buffer = Buffer.from(arrayBuffer);
      
      // Compress images before embedding (videos/audio are not compressed)
      if (contentType.startsWith('image/')) {
        console.log(`[Media Download] Compressing image before embedding...`);
        buffer = await compressImage(buffer, contentType);
      }
      
      // Convert to base64 data URI (still in memory)
      const base64 = buffer.toString('base64');
      const dataURI = `data:${contentType};base64,${base64}`;
      
      // Buffer and arrayBuffer are automatically garbage collected after this function returns
      // No disk storage occurs - everything is temporary and in-memory
      
      console.log(`[Media Download] Successfully downloaded and encoded: ${url} (${buffer.length} bytes, in-memory only, type: ${contentType})`);
      return dataURI;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error(`Download timeout after ${timeoutMs}ms`);
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`[Media Download] Failed to download from ${url}:`, error);
    // Return original URL if download fails - AsciiDoctor might handle it
    return url;
  }
}

/**
 * Process AsciiDoc content to embed external images only (no videos/audio) as data URIs
 * IMPORTANT: All media downloads are temporary and in-memory only.
 * Files are downloaded, converted to base64, embedded in content, and then
 * the memory is automatically freed. No files are written to disk.
 */
async function embedImagesOnlyInContent(content) {
  if (!content) return content;
  
  // Find all image directives: image::url[] or image:url[]
  const imageRegex = /image::?([^\s\[\n]+)(?:\[([^\]]*)\])?/g;
  const imageMatches = [...content.matchAll(imageRegex)];
  
  if (imageMatches.length === 0) {
    return content;
  }
  
  console.log(`[Image Embedding] Found ${imageMatches.length} image(s) to process (videos/audio skipped)`);
  
  // Create a map of unique URLs to avoid downloading the same file multiple times
  const urlMap = new Map();
  
  // Filter and collect unique HTTP/HTTPS URLs (images only)
  const imageInfos = imageMatches.map(match => ({
    type: 'image',
    fullMatch: match[0],
    url: match[1].trim(),
    attributes: match[2] || '',
    isBlock: match[0].startsWith('image::')
  })).filter(info => 
    info.url.startsWith('http://') || info.url.startsWith('https://')
  );
  
  const uniqueUrls = [...new Set(imageInfos.map(info => info.url))];
  
  if (uniqueUrls.length === 0) {
    return content;
  }
  
  console.log(`[Image Embedding] Downloading ${uniqueUrls.length} unique image(s)`);
  
  const downloadPromises = uniqueUrls.map(async (url) => {
    try {
      const dataURI = await downloadMediaAsDataURI(url);
      urlMap.set(url, dataURI);
      return { url, dataURI, success: true };
    } catch (error) {
      console.error(`[Image Embedding] Failed to download ${url}:`, error);
      urlMap.set(url, url);
      return { url, dataURI: url, success: false };
    }
  });
  
  // Wait for all downloads, but don't fail if some fail
  const results = await Promise.allSettled(downloadPromises);
  let successful = 0;
  let failed = 0;
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      successful++;
    } else {
      failed++;
    }
  }
  
  if (failed > 0) {
    console.warn(`[Image Embedding] ${failed} image(s) failed to download, using original URLs`);
  }
  if (successful > 0) {
    console.log(`[Image Embedding] Successfully downloaded ${successful} image(s)`);
  }
  
  // Replace all image URLs with data URIs
  let processedContent = content;
  
  // Process matches in reverse order to preserve string indices
  for (let i = imageInfos.length - 1; i >= 0; i--) {
    const info = imageInfos[i];
    const dataURI = urlMap.get(info.url);
    
    if (dataURI && dataURI !== info.url) {
      const newDirective = info.isBlock 
        ? `image::${dataURI}[${info.attributes}]`
        : `image:${dataURI}[${info.attributes}]`;
      
      const lastIndex = processedContent.lastIndexOf(info.fullMatch);
      if (lastIndex !== -1) {
        processedContent = processedContent.substring(0, lastIndex) + 
                          newDirective + 
                          processedContent.substring(lastIndex + info.fullMatch.length);
        console.log(`[Image Embedding] Replaced image: ${info.url.substring(0, 50)}...`);
      }
    }
  }
  
  console.log(`[Image Embedding] Finished embedding images`);
  return processedContent;
}

/**
 * Process AsciiDoc content to embed external media (images, videos, audio) as data URIs
 * IMPORTANT: All media downloads are temporary and in-memory only.
 * Files are downloaded, converted to base64, embedded in content, and then
 * the memory is automatically freed. No files are written to disk.
 */
async function embedMediaInContent(content) {
  if (!content) return content;
  
  // Find all image directives: image::url[] or image:url[]
  // Also handle cases without brackets: image::url or image:url
  const imageRegex = /image::?([^\s\[\n]+)(?:\[([^\]]*)\])?/g;
  const imageMatches = [...content.matchAll(imageRegex)];
  
  // Find video directives: video::url[] or video:url[]
  const videoRegex = /video::?([^\s\[\n]+)(?:\[([^\]]*)\])?/g;
  const videoMatches = [...content.matchAll(videoRegex)];
  
  // Find audio directives: audio::url[] or audio:url[]
  const audioRegex = /audio::?([^\s\[\n]+)(?:\[([^\]]*)\])?/g;
  const audioMatches = [...content.matchAll(audioRegex)];
  
  const allMatches = [
    ...imageMatches.map(m => ({ type: 'image', match: m })),
    ...videoMatches.map(m => ({ type: 'video', match: m })),
    ...audioMatches.map(m => ({ type: 'audio', match: m }))
  ];
  
  if (allMatches.length === 0) {
    return content;
  }
  
  console.log(`[Media Embedding] Found ${imageMatches.length} image(s), ${videoMatches.length} video(s), ${audioMatches.length} audio directive(s) to process`);
  
  // Create a map of unique URLs to avoid downloading the same file multiple times
  const urlMap = new Map();
  
  // Filter and collect unique HTTP/HTTPS URLs
  const mediaInfos = allMatches.map(({ type, match }) => ({
    type,
    fullMatch: match[0],
    url: match[1].trim(),
    attributes: match[2] || '',
    isBlock: match[0].startsWith(`${type}::`)
  })).filter(info => 
    info.url.startsWith('http://') || info.url.startsWith('https://')
  );
  
  const uniqueUrls = [...new Set(mediaInfos.map(info => info.url))];
  
  if (uniqueUrls.length === 0) {
    return content;
  }
  
  console.log(`[Media Embedding] Downloading ${uniqueUrls.length} unique media file(s)`);
  
  const downloadPromises = uniqueUrls.map(async (url) => {
    try {
      const dataURI = await downloadMediaAsDataURI(url);
      urlMap.set(url, dataURI);
      return { url, dataURI, success: true };
    } catch (error) {
      console.error(`[Media Embedding] Failed to download ${url}:`, error);
      // Keep original URL if download fails
      urlMap.set(url, url);
      return { url, dataURI: url, success: false };
    }
  });
  
  // Wait for all downloads, but don't fail if some fail
  const results = await Promise.allSettled(downloadPromises);
  let successful = 0;
  let failed = 0;
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      successful++;
    } else {
      failed++;
    }
  }
  
  if (failed > 0) {
    console.warn(`[Media Embedding] ${failed} media file(s) failed to download, using original URLs`);
  }
  if (successful > 0) {
    console.log(`[Media Embedding] Successfully downloaded ${successful} media file(s)`);
  }
  
  // Replace all media URLs with data URIs
  let processedContent = content;
  
  // Process matches in reverse order to preserve string indices
  for (let i = mediaInfos.length - 1; i >= 0; i--) {
    const info = mediaInfos[i];
    const dataURI = urlMap.get(info.url);
    
    if (dataURI && dataURI !== info.url) {
      // Build new directive with data URI
      const newDirective = info.isBlock 
        ? `${info.type}::${dataURI}[${info.attributes}]`
        : `${info.type}:${dataURI}[${info.attributes}]`;
      
      // Find and replace (use lastIndexOf to get the last occurrence if there are duplicates)
      const lastIndex = processedContent.lastIndexOf(info.fullMatch);
      if (lastIndex !== -1) {
        processedContent = processedContent.substring(0, lastIndex) + 
                          newDirective + 
                          processedContent.substring(lastIndex + info.fullMatch.length);
        console.log(`[Media Embedding] Replaced ${info.type}: ${info.url.substring(0, 50)}...`);
      }
    }
  }
  
  console.log(`[Media Embedding] Finished embedding media files`);
  return processedContent;
}

/**
 * Filter out nested books (books that are referenced by other 30040 events)
 */
export function filterTopLevelBooks(allBooks) {
  const referencedBookIds = new Set();
  const referencedEventIds = new Set();
  
  // First pass: collect all references
  for (const book of allBooks) {
    for (const tag of book.tags) {
      if (tag[0] === 'a' && tag[1]) {
        const [kindStr, pubkey, dTag] = tag[1].split(':');
        if (kindStr === '30040' && pubkey && dTag) {
          const referencedId = `${pubkey}:${dTag}`;
          referencedBookIds.add(referencedId);
        }
      } else if (tag[0] === 'e' && tag[1]) {
        const referencedEvent = allBooks.find(b => b.id === tag[1] && b.kind === 30040);
        if (referencedEvent) {
          const identifier = referencedEvent.tags.find(([k]) => k === 'd')?.[1] || referencedEvent.id;
          const referencedId = `${referencedEvent.pubkey}:${identifier}`;
          referencedBookIds.add(referencedId);
          referencedEventIds.add(tag[1]);
        }
      }
    }
  }
  
  // Filter to only books that are NOT referenced
  const topLevelBooks = allBooks.filter(book => {
    const identifier = book.tags.find(([k]) => k === 'd')?.[1] || book.id;
    const bookId = `${book.pubkey}:${identifier}`;
    if (referencedBookIds.has(bookId)) {
      return false;
    }
    if (referencedEventIds.has(book.id)) {
      return false;
    }
    return true;
  });
  
  console.log(`[Books] Filtered ${allBooks.length} books to ${topLevelBooks.length} top-level books`);
  return topLevelBooks;
}

/**
 * Build book event hierarchy (tree structure)
 */
export async function buildBookEventHierarchy(indexEvent, visitedIds = new Set(), customRelays = null) {
  if (visitedIds.has(indexEvent.id)) {
    return [];
  }
  visitedIds.add(indexEvent.id);

  const nodes = [];
  
  // Collect all 'a' and 'e' tags in their original order
  const aTags = [];
  const eTags = [];
  const tagOrder = [];
  
  indexEvent.tags.forEach((tag, index) => {
    if (tag[0] === 'a' && tag[1]) {
      aTags.push(tag[1]);
      tagOrder.push({ type: 'a', value: tag[1], index });
    } else if (tag[0] === 'e' && tag[1] && tag[1] !== indexEvent.id && !visitedIds.has(tag[1])) {
      eTags.push(tag[1]);
      tagOrder.push({ type: 'e', value: tag[1], index });
    }
  });

  // Fetch all events in parallel - OPTIMIZED: fetch a-tags and e-tags simultaneously
  const aTagEvents = new Map();
  const eTagEvents = new Map();

  // Calculate timeout based on number of events to fetch (more events = longer timeout)
  const eventCount = aTags.length + eTags.length;
  const timeout = Math.min(Math.max(5000, eventCount * 200), 30000); // 5s minimum, 200ms per event, 30s maximum

  // Fetch events by 'a' tags and 'e' tags in parallel
  const fetchPromises = [];

  if (aTags.length > 0) {
    fetchPromises.push((async () => {
      try {
        const aTagFilters = [];
        for (const aTag of aTags) {
          const [kindStr, pubkey, dTag] = aTag.split(':');
          if (kindStr && pubkey && dTag) {
            const kind = parseInt(kindStr, 10);
            if (kind === 30040 || kind === 30041) {
              aTagFilters.push({
                kinds: [kind],
                authors: [pubkey],
                '#d': [dTag]
              });
            }
          }
        }

        if (aTagFilters.length > 0) {
          const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
          const foundEvents = await fetchEventsByFilters(aTagFilters, relays, timeout);
          
          // Map events by their a-tag identifier, deduplicating by d-tag (keep newest)
          const dTagMap = new Map();
          for (const event of foundEvents) {
            if (event.kind === 30040 || event.kind === 30041) {
              const dTag = event.tags.find(([k]) => k === 'd')?.[1];
              if (dTag) {
                const dTagKey = `${event.kind}:${event.pubkey}:${dTag}`;
                const existing = dTagMap.get(dTagKey);
                if (!existing || event.created_at > existing.created_at) {
                  dTagMap.set(dTagKey, event);
                }
              }
            }
          }
          // Convert dTagMap to aTagEvents format
          for (const [dTagKey, event] of dTagMap.entries()) {
            aTagEvents.set(dTagKey, event);
          }
        }
      } catch (error) {
        console.error('[Book] Error processing a-tags:', error);
      }
    })());
  }

  // Fetch events by 'e' tags in parallel with a-tags
  if (eTags.length > 0) {
    fetchPromises.push((async () => {
      try {
        const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_RELAYS;
        const foundEvents = await fetchEventsByIds(eTags, relays, timeout);
        
        for (const event of foundEvents) {
          eTagEvents.set(event.id, event);
        }
      } catch (error) {
        console.error('[Book] Error fetching events by e-tags:', error);
      }
    })());
  }

  // Wait for both a-tag and e-tag fetches to complete in parallel
  if (fetchPromises.length > 0) {
    await Promise.all(fetchPromises);
  }

  // Build nodes in original tag order - parallelize recursive calls
  const nodePromises = [];
  const branchNodes = [];
  
  for (const tagInfo of tagOrder) {
    if (tagInfo.type === 'a') {
      const [kindStr, pubkey, dTag] = tagInfo.value.split(':');
      if (kindStr && pubkey && dTag) {
        const aTagKey = `${kindStr}:${pubkey}:${dTag}`;
        const event = aTagEvents.get(aTagKey);
        if (event) {
          const node = {
            event,
            children: []
          };
          
          // If this is a 30040 event (branch), recursively fetch its children
          if (event.kind === 30040 && !visitedIds.has(event.id)) {
            const promiseIndex = nodePromises.length;
            nodePromises.push(buildBookEventHierarchy(event, visitedIds, customRelays));
            branchNodes.push({ node, promiseIndex });
            nodes.push(node);
          } else {
            nodes.push(node);
          }
        }
      }
    } else if (tagInfo.type === 'e') {
      const event = eTagEvents.get(tagInfo.value);
      if (event) {
        nodes.push({
          event,
          children: []
        });
      }
    }
  }
  
  // Wait for all recursive calls to complete in parallel
  if (nodePromises.length > 0) {
    const allChildren = await Promise.all(nodePromises);
    for (const { node, promiseIndex } of branchNodes) {
      node.children = allChildren[promiseIndex];
    }
  }

  return nodes;
}

/**
 * Combine book events into AsciiDoc content
 * Downloads and embeds external images as data URIs
 */
export async function combineBookEvents(indexEvent, hierarchy) {
  const title = indexEvent.tags.find(([k]) => k === 'title')?.[1] || 
                indexEvent.tags.find(([k]) => k === 'T')?.[1] ||
                indexEvent.id.slice(0, 8);
  
  let author = indexEvent.tags.find(([k]) => k === 'author')?.[1];
  if (!author) {
    author = nip19.npubEncode(indexEvent.pubkey);
  }

  let doc = `= ${title}\n`;
  if (author) {
    doc += `${author}\n`;
  }
  doc += `:doctype: book\n`;
  doc += `:toc:\n`;
  doc += `:toclevels: 1\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  doc += `:sectnums!:\n`; // Disable section numbering
  // Constrain images and media to 1000px max width for all formats
  // Note: imagesdir set to empty to prevent relative path issues
  // Images should use absolute URLs (http:// or https://) or be embedded
  doc += `:imagesdir:\n`;
  doc += `:image-width: 1000px\n`;
  doc += `:max-width: 1000px\n`;
  // Constrain tables to prevent overflow
  doc += `:table-width: 100%\n`;
  doc += `:table-max-width: 100%\n`;
  // Constrain verbatim blocks (listing, literal, source) to prevent overflow
  doc += `:source-width: 100%\n`;
  doc += `:source-max-width: 100%\n`;
  // Note: prewrap disabled to preserve formatting - CSS handles overflow with horizontal scroll
  
  if (author) {
    doc += `:author: ${author}\n`;
  }

  const version = indexEvent.tags.find(([k]) => k === 'version')?.[1] || 'first edition';
  doc += `:version: ${version}\n`;
  doc += `:revnumber: ${version}\n`;

  // Embed cover image if it's an external URL
  const image = indexEvent.tags.find(([k]) => k === 'image')?.[1];
  let embeddedCoverImage = image;
  if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
    console.log(`[Cover Image] Embedding cover image from: ${image}`);
    embeddedCoverImage = await downloadMediaAsDataURI(image);
    if (embeddedCoverImage !== image) {
      console.log(`[Cover Image] Successfully embedded cover image (${embeddedCoverImage.length} chars)`);
    }
  }
  if (embeddedCoverImage) {
    doc += `:front-cover-image: ${embeddedCoverImage}\n`;
    doc += `:epub-cover-image: ${embeddedCoverImage}\n`;
    // Note: Cover image is handled by :front-cover-image: and :epub-cover-image: attributes
    // for PDF and EPUB. For HTML, we'll add it separately in the HTML generation.
  }

  doc += `\n\n`;

  // Render hierarchy recursively
  function renderNode(node, level = 2) {
    const event = node.event;
    const sectionTitle = event.tags.find(([k]) => k === 'title')?.[1] || 
                        event.tags.find(([k]) => k === 'T')?.[1];
    
    if (sectionTitle) {
      const headingLevel = '='.repeat(Math.min(level, 6));
      doc += `${headingLevel} ${sectionTitle}\n\n`;
    }
    
    if (event.content && event.content.trim().length > 0) {
      doc += `${event.content}\n\n`;
    }
    
    for (const child of node.children) {
      renderNode(child, level + 1);
    }
  }

  for (const node of hierarchy) {
    renderNode(node, 2);
  }

  // Embed external media (images, videos, audio) as data URIs
  // Embed external media (images, videos, audio) as data URIs
  let contentWithEmbeddedMedia = await embedMediaInContent(doc);
  
  // Check content size - if too large (over 50MB), retry with images only
  const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB
  const contentSize = Buffer.byteLength(contentWithEmbeddedMedia, 'utf8');
  
  if (contentSize > MAX_CONTENT_SIZE) {
    console.warn(`[Book Content] Content size (${contentSize} bytes) exceeds limit (${MAX_CONTENT_SIZE} bytes), retrying without video/audio embedding`);
    // Rebuild doc without video/audio embedding
    contentWithEmbeddedMedia = await embedImagesOnlyInContent(doc);
    const retrySize = Buffer.byteLength(contentWithEmbeddedMedia, 'utf8');
    console.log(`[Book Content] Retry size: ${retrySize} bytes (${((retrySize / MAX_CONTENT_SIZE) * 100).toFixed(1)}% of limit)`);
  }

  // Return embedded cover image if it was embedded (for HTML view)
  const embeddedCoverImageForHTML = embeddedCoverImage && embeddedCoverImage.startsWith('data:') ? embeddedCoverImage : null;
  
  return { content: contentWithEmbeddedMedia, title, author, embeddedCoverImage: embeddedCoverImageForHTML };
}

/**
 * Collect all events from book hierarchy (recursive)
 */
export function collectAllEventsFromHierarchy(indexEvent, hierarchy) {
  const events = [indexEvent];
  
  function collectFromNode(node) {
    events.push(node.event);
    for (const child of node.children) {
      collectFromNode(child);
    }
  }
  
  for (const node of hierarchy) {
    collectFromNode(node);
  }
  
  return events;
}
