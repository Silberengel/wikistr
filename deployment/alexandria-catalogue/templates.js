/**
 * HTML template generators for complex pages
 */

import { escapeHtml, formatDate, truncate } from './utils.js';
import { nip19 } from './nostr.js';
import { getCommonStyles } from './styles.js';
import { generateNavigation } from './html.js';

/**
 * Generate book detail page HTML
 */
export function generateBookDetailPage(naddr, bookEvent, hierarchy, threadedComments, groupedHighlights, metadata, hasContent, customRelays) {
  const title = metadata.title || 'Untitled';
  const commentCount = threadedComments.reduce((sum, c) => sum + 1 + (c.children?.length || 0), 0);
  const hasCustomRelays = customRelays && customRelays.length > 0;
  const relayInput = hasCustomRelays ? customRelays.join(',') : '';
  const relayParam = hasCustomRelays ? `?relays=${encodeURIComponent(relayInput)}` : '';
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon_alex-catalogue.png">
  <title>${escapeHtml(title)}</title>
  <style>
    .book-title { font-size: 1.5em; }
    .book-actions { margin-top: 1em; }
    ${getCommonStyles()}
  </style>
</head>
<body>
  ${generateNavigation(relayInput)}
  
  <h1><img src="/favicon_alex-catalogue.png" alt="" style="width: 1.2em; height: 1.2em; vertical-align: middle; margin-right: 0.3em;"> Alexandria Catalogue</h1>
  <p style="color: #000000; margin-bottom: 1em;">The e-book download portal for <a href="https://alexandria.gitcitadel.eu" style="color: #0066cc; text-decoration: underline;">Alexandria</a>.</p>
  
  <div class="search-form">
    <form method="GET" action="/">
      <input type="text" name="naddr" placeholder="Enter book naddr (naddr1...) or d tag..." value="${escapeHtml(naddr)}" required>
      ${hasCustomRelays ? `<input type="hidden" name="relays" value="${escapeHtml(customRelays.join(','))}">` : ''}
      <button type="submit">Search</button>
    </form>
    <div style="margin-top: 0.5em;">
      <a href="/books${relayParam}" style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">← Browse Library</a>
    </div>
  </div>
  
  <div class="book-header">
    <div class="book-title">${escapeHtml(title)}</div>
    <div class="book-meta">
      ${metadata.author ? `Author: ${escapeHtml(metadata.author)}<br>` : ''}
      ${metadata.version ? `Version: ${escapeHtml(metadata.version)}<br>` : ''}
      ${metadata.published_on ? `Published: ${escapeHtml(metadata.published_on)}<br>` : ''}
      Created: ${metadata.created_at}<br>
      ${metadata.description ? `<div style="margin-top: 0.5em; font-style: italic;">${escapeHtml(metadata.description)}</div>` : ''}
      ${metadata.summary ? `<div style="margin-top: 0.5em;">${escapeHtml(metadata.summary)}</div>` : ''}
      ${metadata.image ? `<div style="margin-top: 0.5em;"><img src="${escapeHtml(metadata.image)}" alt="Cover" style="max-width: 200px; max-height: 300px; border: 1px solid #ddd; border-radius: 4px;"></div>` : ''}
      <div style="margin-top: 0.5em; font-size: 0.85em; color: #4a4a4a;">
        Event ID: ${escapeHtml(metadata.event_id.substring(0, 16))}...<br>
        Pubkey: ${metadata.pubkey}<br>
        ${metadata.d ? `D-tag: ${escapeHtml(metadata.d)}<br>` : ''}
      </div>
    </div>
    ${hasContent ? `
    <div class="book-actions">
      <div class="view-buttons">
        <a href="/view?naddr=${encodeURIComponent(naddr)}${relayParam ? '&' + relayParam.substring(1) : ''}">View as HTML</a>
        <a href="/view-epub?naddr=${encodeURIComponent(naddr)}${relayParam ? '&' + relayParam.substring(1) : ''}">View as EPUB</a>
      </div>
      <div class="download-section">
        <form method="GET" action="/download" style="display: flex; gap: 0.5em; align-items: center;">
          <input type="hidden" name="naddr" value="${encodeURIComponent(naddr)}">
          ${hasCustomRelays ? `<input type="hidden" name="relays" value="${escapeHtml(customRelays.join(','))}">` : ''}
          <label for="download-format-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}">Download as:</label>
          <select id="download-format-${naddr.replace(/[^a-zA-Z0-9]/g, '_')}" name="format" required>
            <option value="epub3">EPUB3</option>
            <option value="pdf">PDF</option>
            <option value="html5">HTML5</option>
            <option value="docbook5">DocBook5</option>
            <option value="asciidoc">AsciiDoc</option>
            <optgroup label="Recommended for Kindle">
              <option value="mobi">MOBI</option>
              <option value="azw3">AZW3</option>
            </optgroup>
            <option value="jsonl">JSONL</option>
          </select>
          <button type="submit">Download File</button>
        </form>
      </div>
    </div>
    ` : `
    <div style="margin-top: 1em; padding: 1em; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; color: #856404;">
      <strong>Library Index Card</strong><br>
      This book entry has no content yet. It may be under copyright or not yet imported. Comments and highlights are still available below.
    </div>
    `}
  </div>
  
  <div class="comments-section">
    <h2>Comments (${commentCount} comments)</h2>
`;

  // Render comments (threaded)
  const renderComment = (comment, depth = 0, handleMap) => {
    const npub = nip19.npubEncode(comment.pubkey);
    const npubDisplay = npub.substring(0, 20) + '...';
    const handle = handleMap.get(comment.pubkey);
    const authorDisplay = handle ? `${npubDisplay} (${escapeHtml(handle)})` : npubDisplay;
    
    const date = formatDate(comment.created_at);
    const content = escapeHtml(truncate(comment.content || '', 1000));
    
    let commentHtml = `
    <div class="comment"${depth > 0 ? ' style="margin-left: ' + (depth * 2) + 'em;"' : ''}>
      <div class="comment-author">
        ${escapeHtml(authorDisplay)}
        <span class="comment-type comment">Comment</span>
      </div>
      <div class="comment-date">${date}</div>
      <div class="comment-content">${content}</div>`;
    
    if (comment.children && comment.children.length > 0) {
      commentHtml += '      <div class="thread-replies">\n';
      for (const child of comment.children) {
        commentHtml += renderComment(child, depth + 1, handleMap);
      }
      commentHtml += '      </div>\n';
    }
    
    commentHtml += '    </div>\n';
    return commentHtml;
  };
  
  // Render comments (threaded)
  if (threadedComments.length > 0) {
    html += '<div class="comments-group" style="margin-bottom: 2em;">';
    html += '<h3 style="font-size: 1.1em; font-weight: 600; margin-bottom: 1em; color: #000000;">Comments</h3>';
    for (const comment of threadedComments) {
      html += renderComment(comment, 0, metadata.handleMap);
    }
    html += '</div>';
  }
  
  if (threadedComments.length === 0) {
    html += '<p class="no-comments">No comments yet.</p>';
  }
  
  html += `
  </div>
</body>
</html>
`;
  
  return html;
}
