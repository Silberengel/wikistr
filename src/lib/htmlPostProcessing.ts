/**
 * HTML post-processing utilities
 * Handles wikilink conversion, image styling, and CSS injection for exported HTML
 */

/**
 * Convert wikilink: protocol links to proper HTML links
 */
export function processWikilinks(html: string): string {
  // Handle both link:wikilink:...[...] format and <a href="wikilink:..."> format
  html = html.replace(/link:wikilink:([^\[]+)\[([^\]]+)\]/g, (match, href, text) => {
    const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cleanHref = href.replace(/^wikilink:/, '').replace(/&/g, '&amp;');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${escapedText}</a>`;
  });
  
  html = html.replace(/<a[^>]*href=["']wikilink:([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (match, href, text) => {
    const cleanHref = href.replace(/^wikilink:/, '').replace(/&/g, '&amp;');
    return `<a href="javascript:void(0)" onclick="window.location.href='#wikilink:${cleanHref}'" class="wikilink" data-wikilink="${cleanHref}">${text}</a>`;
  });
  
  return html;
}

/**
 * Add max-width styling to cover images
 */
export function processCoverImages(html: string): string {
  // Process images with cover class
  html = html.replace(/(<img[^>]*class="[^"]*cover[^"]*"[^>]*>)/gi, (match) => {
    if (match.includes('style=')) {
      return match.replace(/style="([^"]*)"/i, (_, existingStyle) => {
        const cleanedStyle = existingStyle.replace(/width:\s*\d+px;?/gi, '').replace(/max-width:\s*\d+px;?/gi, '');
        if (cleanedStyle.includes('max-width')) {
          return `style="${existingStyle}"`;
        }
        return `style="${cleanedStyle.trim()}; max-width: 400px;"`.replace(/;\s*;/g, ';');
      });
    }
    return match.replace(/>$/, ' style="max-width: 400px;">');
  });
  
  // Process images in title-page divs
  html = html.replace(/(<div[^>]*class="[^"]*title-page[^"]*"[^>]*>[\s\S]*?<img[^>]*>)/gi, (match) => {
    return match.replace(/(<img[^>]*>)/i, (imgTag) => {
      if (imgTag.includes('style=')) {
        return imgTag.replace(/style="([^"]*)"/i, (_, existingStyle) => {
          if (existingStyle.includes('max-width')) {
            return `style="${existingStyle}"`;
          }
          return `style="${existingStyle}; max-width: 400px;"`;
        });
      }
      return imgTag.replace(/>$/, ' style="max-width: 400px;">');
    });
  });
  
  return html;
}

/**
 * Ensure all images have proper attributes and responsive styling
 */
export function processAllImages(html: string): string {
  return html.replace(/<img([^>]*?)>/gi, (match, attributes) => {
    // Skip if this is a cover or title-page image (already processed)
    if (attributes.includes('class="') && (attributes.includes('cover') || attributes.includes('title-page'))) {
      return match;
    }
    
    if (!attributes.includes('src=')) {
      return match; // Skip images without src
    }
    
    if (!attributes.includes('loading=')) {
      attributes += ' loading="lazy"';
    }
    
    if (!attributes.includes('alt=')) {
      attributes += ' alt=""';
    }
    
    if (!attributes.includes('style=')) {
      attributes += ' style="max-width: 100%; height: auto;"';
    } else if (!attributes.includes('max-width')) {
      attributes = attributes.replace(/style="([^"]*)"/i, (_match: string, existingStyle: string) => {
        return `style="${existingStyle}; max-width: 100%; height: auto;"`.replace(/;\s*;/g, ';');
      });
    }
    
    return `<img${attributes}>`;
  });
}

/**
 * Get CSS styles for title pages and metadata sections
 */
export function getTitlePageStyles(): string {
  return `
    <style>
      /* General image styling */
      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 1em auto;
        border: none;
        box-shadow: none;
      }
      
      /* Inline images in paragraphs */
      p img, .paragraph img {
        display: inline-block;
        margin: 0.25em 0.5em;
        vertical-align: middle;
        max-width: 100%;
      }
      
      /* Block images */
      .imageblock {
        text-align: center;
        margin: 1.5em 0;
        page-break-inside: avoid;
      }
      .imageblock img {
        display: block;
        margin: 0 auto;
        max-width: 100%;
        height: auto;
      }
      .imageblock .title {
        font-style: italic;
        margin-top: 0.5em;
        font-size: 0.9em;
        color: #666;
      }
      
      /* Ensure images don't overflow containers */
      .content img, .sect1 img, .sect2 img, .sect3 img, .sect4 img, .sect5 img, article img, section img {
        max-width: 100%;
        height: auto;
      }
      
      li img {
        max-width: 100%;
        height: auto;
        margin: 0.5em 0;
      }
      
      table img {
        max-width: 100%;
        height: auto;
        margin: 0.25em;
      }
      
      @media (max-width: 600px) {
        img { max-width: 100%; height: auto; }
        .imageblock { margin: 1em 0; }
      }
      
      /* Cover page styling */
      .cover-page {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .cover-page h2, .cover-page .sect2 > h2 {
        display: none !important;
      }
      .cover-page img {
        margin: 0 auto 0.5em auto;
        display: block;
        max-width: 500px;
        width: 100%;
        height: auto;
      }
      .cover-page p {
        margin: 0.5em 0 0 0;
        font-size: 1.5em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #555;
      }
      .cover-page p:first-of-type {
        font-size: 3em;
        font-weight: 700;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #333;
        margin-top: 0.3em;
        margin-bottom: 0.2em;
      }
      .cover-page p:nth-of-type(2), .cover-page br + p {
        margin-top: 0.2em;
        font-size: 1.5em;
      }
      
      /* Book metadata section */
      .book-metadata {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .book-metadata h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 1em 0 !important;
        font-size: 3.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #000;
      }
      .book-metadata p {
        margin: 0.8em 0;
        font-size: 1em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #333;
        line-height: 1.6;
      }
      .book-metadata strong {
        font-weight: 600;
        color: #000;
      }
      .book-metadata img {
        margin: 2em auto;
        display: block;
        max-width: 500px;
        height: auto;
      }
      
      /* Article metadata section */
      .article-metadata {
        text-align: center;
        margin: 4em 0;
        padding: 4em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .article-metadata h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 1em 0 !important;
        font-size: 3.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #000;
      }
      .article-metadata p {
        margin: 0.8em 0;
        font-size: 1em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        color: #333;
        line-height: 1.6;
      }
      .article-metadata strong {
        font-weight: 600;
        color: #000;
      }
      .article-metadata img {
        margin: 2em auto;
        display: block;
        max-width: 500px;
        height: auto;
      }
      
      /* Title page styling */
      .title-page {
        text-align: center;
        margin: 0;
        padding: 6em 2em;
        page-break-after: always;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        min-height: 85vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .title-page h2 {
        border: none !important;
        padding: 0 !important;
        margin: 0 0 2em 0 !important;
        font-size: 2.5em;
        font-weight: 700;
        font-family: 'Crimson Text', 'Times New Roman', serif;
        line-height: 1.3;
      }
      .title-page img {
        margin: 2em auto 3em auto;
        display: block;
        max-width: 100%;
        height: auto;
      }
      .title-page .author, .title-page .revnumber, .title-page .revdate, .title-page .revremark {
        font-size: 1em;
        margin-top: 0.5em;
        font-weight: 400;
        font-family: 'Crimson Text', 'Times New Roman', serif;
      }
      .title-page .author {
        font-size: 1.3em;
        margin-top: 1em;
      }
    </style>
  `;
}

/**
 * Inject CSS styles into HTML document
 */
export function injectStyles(html: string): string {
  const styles = getTitlePageStyles();
  if (html.includes('</head>')) {
    return html.replace('</head>', styles + '</head>');
  } else if (html.includes('<html')) {
    return html.replace('<html', styles + '<html');
  }
  return html;
}

/**
 * Process all HTML post-processing steps
 */
export function processHTML(html: string): string {
  html = processWikilinks(html);
  html = processCoverImages(html);
  html = processAllImages(html);
  html = injectStyles(html);
  return html;
}

