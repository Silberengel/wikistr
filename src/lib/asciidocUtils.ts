/**
 * Shared utilities for AsciiDoc content processing and metadata building
 * Consolidates common patterns for date formatting, metadata construction, and content transformation
 */

import type { NostrEvent } from '@nostr/tools/pure';
import { nip19 } from '@nostr/tools';

/**
 * Format date for PDF title page
 * For years < 1000: Format as "original date ca. [rounded year] AD/BC" (rounded to nearest 50)
 * For years >= 1000: Just return the year (assumed AD, more precise)
 */
export function formatDateForTitlePage(year: number): string {
  if (year < 1000) {
    const rounded = Math.round(year / 50) * 50;
    if (rounded < 0) {
      const bcYear = Math.abs(rounded);
      return `original date ca. ${bcYear} BC`;
    } else if (rounded === 0) {
      return 'original date ca. 1 AD';
    } else {
      return `original date ca. ${rounded} AD`;
    }
  }
  return String(year);
}

/**
 * Format publishedOn date string for title page
 */
export function formatPublishedOnForTitlePage(
  publishedOn: string | undefined,
  fallbackYear?: number
): string | undefined {
  if (!publishedOn) {
    if (fallbackYear !== undefined) {
      return formatDateForTitlePage(fallbackYear);
    }
    return undefined;
  }
  
  const yearMatch = publishedOn.match(/(\d{4})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    return formatDateForTitlePage(year);
  }
  
  return undefined;
}

/**
 * Get revdate value for AsciiDoc attributes
 * AsciiDoctor requires a full date format (YYYY-MM-DD), not just a year
 */
export function getRevdateValue(
  event: NostrEvent,
  publishedOn?: string
): string {
  // If publishedOn is provided and is a valid date, use it
  if (publishedOn) {
    // Try to parse as ISO date (YYYY-MM-DD)
    const isoDateMatch = publishedOn.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDateMatch) {
      return publishedOn.substring(0, 10); // Return YYYY-MM-DD portion
    }
    
    // Try to extract year and create a date
    const yearMatch = publishedOn.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      // Use January 1st as default date for year-only values
      return `${year}-01-01`;
    }
  }
  
  // Fallback to event created_at date
  if (event.created_at) {
    const date = new Date(event.created_at * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Final fallback: current date
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert d-tag to title case
 */
export function dTagToTitleCase(dTag: string): string {
  if (!dTag || dTag.trim().length === 0) return '';
  
  return dTag
    .split(/[-_\s]+/)
    .map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Get title from event tags with fallbacks
 */
export function getTitleFromEventTags(event: NostrEvent): string {
  const titleTag = event.tags.find(([k]) => k === 'title')?.[1];
  if (titleTag) return titleTag;
  
  const tTag = event.tags.find(([k]) => k === 'T')?.[1];
  if (tTag) return tTag;
  
  const dTag = event.tags.find(([k]) => k === 'd')?.[1];
  if (dTag) return dTagToTitleCase(dTag);
  
  return event.id.slice(0, 8);
}

/**
 * Build base AsciiDoc attributes header
 */
export function buildBaseAsciiDocAttributes(
  title: string,
  author: string,
  options: {
    version?: string;
    publishedOn?: string;
    source?: string;
    topicTags?: string[];
    summary?: string;
    image?: string;
    exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf';
    event?: NostrEvent;
  }
): string {
  let doc = `= ${title}\n`;
  
  if (author && author.trim()) {
    doc += `:author: ${author}\n`;
  }
  
  doc += `:toc:\n`;
  doc += `:stem:\n`;
  doc += `:page-break-mode: auto\n`;
  
  const { version, publishedOn, source, topicTags, summary, image, exportFormat, event } = options;
  
  // For PDF/EPUB, always set revnumber and revdate
  if (exportFormat === 'pdf' || exportFormat === 'epub') {
    const versionValue = version || 'first edition';
    doc += `:version: ${versionValue}\n`;
    doc += `:revnumber: ${versionValue}\n`;
    
    if (event) {
      const revdateValue = getRevdateValue(event, publishedOn);
      doc += `:pubdate: ${revdateValue}\n`;
      doc += `:revdate: ${revdateValue}\n`;
    } else if (publishedOn) {
      const yearMatch = publishedOn.match(/(\d{4})/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const revdateValue = formatDateForTitlePage(year);
        doc += `:pubdate: ${revdateValue}\n`;
        doc += `:revdate: ${revdateValue}\n`;
      }
    }
  } else {
    // For other formats, only set if values exist
    if (version) {
      doc += `:version: ${version}\n`;
    }
    if (publishedOn) {
      doc += `:pubdate: ${publishedOn}\n`;
    }
  }
  
  if (source) {
    doc += `:source: ${source}\n`;
  }
  
  if (topicTags && topicTags.length > 0) {
    doc += `:keywords: ${topicTags.join(', ')}\n`;
  }
  
  if (summary) {
    doc += `:summary: ${summary}\n`;
  }
  
  if (image && (exportFormat === 'pdf' || exportFormat === 'epub' || !exportFormat)) {
    doc += `:front-cover-image: ${image}\n`;
  }
  
  return doc.trimEnd() + '\n\n';
}

/**
 * Build metadata section for articles
 */
export function buildArticleMetadataSection(
  event: NostrEvent,
  displayTitle: string,
  author: string,
  image?: string,
  exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf'
): string {
  // Skip article-metadata for books (30040)
  if (event.kind === 30040) {
    return '';
  }
  
  const isArticleKind = event.kind === 30023 || event.kind === 30041 || 
                        event.kind === 30817 || event.kind === 30818;
  if (!isArticleKind) {
    return '';
  }
  
  const metadataFields: Array<{ label: string; value: string }> = [];
   
  if (event.pubkey) {
    const npub = nip19.npubEncode(event.pubkey);
    metadataFields.push({ label: 'Author Pubkey', value: npub });
  }
  
  if (author && author.trim()) {
    metadataFields.push({ label: 'Author', value: author });
  }
  
  const topicTags = event.tags.filter(([k]) => k === 't').map(([, v]) => v);
  if (topicTags.length > 0) {
    metadataFields.push({ label: 'Topics', value: topicTags.join(', ') });
  }
  
  const publishedAt = event.tags.find(([k]) => k === 'published_at')?.[1] || 
                      event.tags.find(([k]) => k === 'published_on')?.[1];
  if (publishedAt) {
    try {
      const publishedDate = new Date(parseInt(publishedAt) * 1000);
      metadataFields.push({ label: 'Published', value: publishedDate.toLocaleDateString() });
    } catch (e) {
      metadataFields.push({ label: 'Published', value: publishedAt });
    }
  }
  
  if (event.created_at) {
    try {
      const createdDate = new Date(event.created_at * 1000);
      metadataFields.push({ 
        label: 'Created', 
        value: createdDate.toLocaleDateString('en-GB', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }) 
      });
    } catch (e) {
      // Ignore if date parsing fails
    }
  }
  
  if (metadataFields.length === 0) {
    return '';
  }
  
  let doc = '\n';
  
  doc += '[.article-metadata]\n== Article Information\n\n';
  
  // Display the title in a classic title style within the section
  const cleanTitle = displayTitle.replace(/\n/g, ' ').trim();
  
  // For PDF, use a simpler format (PDF has title page, no special styling needed)
  if (exportFormat === 'pdf') {
    doc += `${cleanTitle}\n\n`;
  } else {
    // For HTML/EPUB, use role syntax for CSS styling
    doc += `[.book-title]\n${cleanTitle}\n\n`;
  }
  
  // Only show image for HTML/AsciiDoc (EPUB/PDF have cover pages)
  if ((exportFormat === 'html' || exportFormat === 'asciidoc' || !exportFormat) && image) {
    doc += `image::${image}[Cover Image]\n\n`;
  }
  
  for (const field of metadataFields) {
    if (field.value && field.value.trim()) {
      doc += `*${field.label}:* ${field.value}\n\n`;
    }
  }
  
  doc += '__This document was published with a GitCitadel app.__\n\n';
  
  return doc;
}

/**
 * Build metadata section for books (30040)
 */
export function buildBookMetadataSection(
  title: string,
  author: string,
  options: {
    version?: string;
    source?: string;
    publishedOn?: string;
    topicTags?: string[];
    image?: string;
    exportFormat?: 'html' | 'epub' | 'asciidoc' | 'pdf';
  },
  isTopLevel: boolean = true
): string {
  if (!isTopLevel) {
    return '';
  }
  
  const metadataFields: Array<{ label: string; value: string }> = [];
  
  if (author) metadataFields.push({ label: 'Author', value: author });
  if (options.version) metadataFields.push({ label: 'Version', value: options.version });
  if (options.source) metadataFields.push({ label: 'Source', value: options.source });
  if (options.publishedOn) metadataFields.push({ label: 'Published On', value: options.publishedOn });
  if (options.topicTags && options.topicTags.length > 0) {
    metadataFields.push({ label: 'Topics', value: options.topicTags.join(', ') });
  }
  
  if (metadataFields.length === 0) {
    return '';
  }
  
  let doc = '\n';
  
  doc += '[.book-metadata]\n== Book Information\n\n';
  
  // Display the title in a classic title style within the section
  const cleanTitle = title.replace(/\n/g, ' ').trim();
  
  // For PDF, use a simpler format (PDF has title page, no special styling needed)
  if (options.exportFormat === 'pdf') {
    doc += `${cleanTitle}\n\n`;
  } else {
    // For HTML/EPUB, use role syntax for CSS styling
    doc += `[.book-title]\n${cleanTitle}\n\n`;
  }
  
  // Only show image for HTML/AsciiDoc (EPUB/PDF have cover pages)
  const showImage = (options.exportFormat === 'html' || 
                     options.exportFormat === 'asciidoc' || 
                     !options.exportFormat);
  
  if (showImage && options.image) {
    doc += `image::${options.image}[Cover Image]\n\n`;
  }
  
  for (const field of metadataFields) {
    if (field.value && field.value.trim()) {
      doc += `*${field.label}:* ${field.value}\n\n`;
    }
  }
  
  doc += '__This document was published with a GitCitadel app.__\n\n';
  
  return doc;
}

/**
 * Add abstract section if description/summary exists
 */
export function addAbstractSection(
  description?: string,
  summary?: string
): string {
  if (description && description.trim()) {
    return `\n== Abstract\n\n${description}\n\n`;
  } else if (summary && summary.trim()) {
    return `\n== Abstract\n\n${summary}\n\n`;
  }
  return '';
}

