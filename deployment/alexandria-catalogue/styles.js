/**
 * CSS styles for Alexandria Catalogue
 */

export function getCommonStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; background: #ffffff; color: #000000; }
    nav { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 2px solid #000000; }
    nav a { margin-right: 1em; color: #0066cc; text-decoration: underline; }
    nav a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    a { color: #0066cc; text-decoration: underline; }
    a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    h1, h2, h3 { color: #000000; }
    button { padding: 0.5em 1em; font-size: 1em; background: #000000; color: #ffffff; border: 2px solid #000000; cursor: pointer; font-weight: bold; }
    button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    input[type="text"] { padding: 0.5em; font-size: 1em; border: 2px solid #000000; border-radius: 4px; color: #000000; background: #ffffff; }
    input[type="text"]:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    textarea { padding: 0.5em; font-size: 0.9em; font-family: monospace; border: 2px solid #000000; border-radius: 4px; background: #ffffff; color: #000000; }
    textarea:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    select { padding: 0.5em; font-size: 1em; border: 2px solid #000000; border-radius: 4px; background: #ffffff; color: #000000; }
    select:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .search-form { margin-bottom: 2em; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .search-form form { display: block; }
    .search-form > form > div { display: flex; gap: 0.5em; align-items: stretch; }
    .search-form input[type="text"] { flex: 1 1 auto; min-width: 300px; width: 100%; }
    .search-form button { flex-shrink: 0; }
    .book-result { margin: 1.5em 0; padding: 1em; border: 2px solid #000000; border-radius: 4px; background: #ffffff; }
    .book-title { font-size: 1.2em; font-weight: bold; margin-bottom: 0.5em; }
    .book-meta { color: #1a1a1a; font-size: 0.9em; margin: 0.5em 0; }
    .book-actions { margin-top: 0.5em; display: flex; flex-wrap: wrap; gap: 1em; align-items: center; }
    .book-header { margin-bottom: 2em; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .view-buttons { display: flex; gap: 0.5em; }
    .view-buttons a { display: inline-block; padding: 0.5em 1em; color: #ffffff; background: #000000; text-decoration: none; border-radius: 4px; border: 2px solid #000000; }
    .view-buttons a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .download-section { display: flex; gap: 0.5em; align-items: center; }
    .download-section label { font-weight: bold; color: #000000; }
    .download-section button { padding: 0.5em 1em; color: #ffffff; background: #000000; border: 2px solid #000000; cursor: pointer; border-radius: 4px; font-weight: bold; }
    .download-section button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .message-box { margin: 1em 0; padding: 1em; border-radius: 4px; border-left: 4px solid; }
    .message-box.error { background: #ffffff; border-color: #cc0000; color: #000000; border: 2px solid #cc0000; }
    .message-box.warning { background: #ffffff; border-color: #cc6600; color: #000000; border: 2px solid #cc6600; }
    .message-box.info { background: #ffffff; border-color: #0066cc; color: #000000; border: 2px solid #0066cc; }
    .message-box-header { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; }
    .message-box-icon { font-size: 1.2em; }
    .message-box-title { font-size: 1.1em; font-weight: bold; }
    .message-box-content p { margin: 0; color: #000000; }
    .message-box-details { margin-top: 0.5em; }
    .message-box-details summary { cursor: pointer; font-weight: bold; margin-bottom: 0.5em; color: #000000; }
    .message-box-details summary:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .message-box-details pre { background: #f0f0f0; border: 1px solid #000000; padding: 0.5em; border-radius: 3px; overflow-x: auto; font-size: 0.9em; color: #000000; }
    .error { color: #000000; margin: 1em 0; padding: 1em; background: #ffffff; border: 2px solid #cc0000; }
    .no-results { color: #1a1a1a; font-style: italic; margin: 2em 0; text-align: center; }
    .no-comments { color: #1a1a1a; font-style: italic; margin: 1em 0; }
    .info { color: #1a1a1a; margin: 1em 0; }
    .comment, .highlight { margin: 1.5em 0; padding: 1em; border-left: 4px solid #000000; background: #ffffff; border: 1px solid #000000; }
    .highlight { border-left-color: #cc6600; border-color: #cc6600; }
    .comment-author, .highlight-author { font-weight: bold; color: #000000; margin-bottom: 0.5em; }
    .comment-date, .highlight-date { color: #1a1a1a; font-size: 0.85em; }
    .comment-content, .highlight-content { margin-top: 0.5em; white-space: pre-wrap; word-wrap: break-word; color: #000000; }
    .comment-type.comment { background: #ffffff; border: 2px solid #0066cc; color: #000000; }
    .comment-type.highlight { background: #ffffff; border: 2px solid #cc6600; color: #000000; }
    .comment-type { display: inline-block; padding: 0.2em 0.5em; font-size: 0.75em; border-radius: 3px; margin-left: 0.5em; }
    .thread-reply { margin-left: 2em; margin-top: 1em; border-left: 2px solid #ccc; padding-left: 1em; }
    .thread-reply .comment, .thread-reply .highlight { border-left-width: 2px; }
    .comments-section { margin-top: 2em; }
    .status-section { margin: 1em 0; padding: 1em; background: #ffffff; border: 2px solid #000000; border-radius: 4px; }
    .status-section h2 { margin-top: 0; color: #000000; }
    .status-item { margin: 0.5em 0; color: #000000; }
    .status-label { font-weight: bold; display: inline-block; width: 200px; }
    .results-header { margin: 1.5em 0; }
  `;
}

export function getTableStyles() {
  return `
    table { width: 100%; border-collapse: collapse; margin-top: 1em; border: 2px solid #000000; }
    th, td { padding: 0.75em; text-align: left; border-bottom: 1px solid #000000; border-right: 1px solid #000000; }
    th { background: #000000; color: #ffffff; font-weight: bold; }
    th a { color: #ffffff; text-decoration: underline; }
    th a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    td { background: #ffffff; color: #000000; }
    .book-link { color: #0066cc; text-decoration: underline; }
    .book-link:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .book-author { color: #1a1a1a; font-size: 0.9em; }
    .book-date { color: #1a1a1a; font-size: 0.85em; white-space: nowrap; }
    .pagination { margin-top: 2em; text-align: center; }
    .pagination a, .pagination span { display: inline-block; padding: 0.5em 1em; margin: 0 0.25em; text-decoration: underline; border: 2px solid #000000; border-radius: 4px; color: #0066cc; }
    .pagination a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .pagination .current { background: #000000; color: #ffffff; border-color: #000000; }
    .pagination .disabled { color: #4a4a4a; cursor: not-allowed; pointer-events: none; }
    .expand-button { margin: 1em 0; padding: 0.75em 1.5em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-size: 1em; text-decoration: none; display: inline-block; font-weight: bold; }
    .expand-button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .controls { margin: 1em 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1em; }
    .loading { text-align: center; color: #000000; padding: 2em; }
    .book-count { color: #1a1a1a; margin-bottom: 1em; }
  `;
}

export function getEPUBViewerStyles() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #ffffff; color: #000000; height: 100vh; display: flex; flex-direction: column; }
    .header { background: #ffffff; border-bottom: 2px solid #000000; padding: 1em; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .header h1 { font-size: 1.2em; font-weight: 600; color: #000000; margin: 0; }
    .header .book-info { color: #1a1a1a; font-size: 0.9em; }
    .header .actions { display: flex; gap: 0.5em; }
    .header .actions a { padding: 0.5em 1em; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 0.9em; border: 2px solid #000000; }
    .header .actions a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .navigation-controls { background: #ffffff; border-bottom: 2px solid #000000; padding: 0.5em 1em; display: flex; justify-content: space-between; align-items: center; gap: 1em; flex-shrink: 0; }
    .navigation-controls button { padding: 0.5em 1em; background: #000000; color: #ffffff; border: 2px solid #000000; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; }
    .navigation-controls button:hover { opacity: 0.9; }
    .navigation-controls button:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    .navigation-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    .viewer-container { flex: 1; overflow: hidden; position: relative; background: white; }
    #viewer { width: 100%; height: 100%; border: none; }
    .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #000000; }
    .loading-spinner { border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1em; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .error { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #000000; padding: 2em; background: #ffffff; border: 3px solid #cc0000; border-radius: 8px; max-width: 500px; }
    .error h2 { margin-bottom: 0.5em; color: #cc0000; }
    .error a { color: #0066cc; text-decoration: underline; margin-top: 1em; display: inline-block; }
    .error a:focus { outline: 3px solid #0066cc; outline-offset: 2px; }
    /* Admonition icon styling for EPUB viewer */
    .admonitionblock .title .icon,
    .admonitionblock .title i.icon,
    .admonition .title .icon,
    .admonition .title i.icon {
      display: inline !important;
      font-size: 1.2em !important;
      line-height: 1 !important;
      font-style: normal !important;
      margin-right: 0.5rem !important;
      vertical-align: middle !important;
    }
    .admonitionblock.note .title .icon,
    .admonitionblock.note .title i.icon,
    .admonition.note .title .icon { content: "ℹ" !important; }
    .admonitionblock.tip .title .icon,
    .admonitionblock.tip .title i.icon,
    .admonition.tip .title .icon { content: "💡" !important; }
    .admonitionblock.warning .title .icon,
    .admonitionblock.warning .title i.icon,
    .admonition.warning .title .icon { content: "⚠" !important; }
    .admonitionblock.caution .title .icon,
    .admonitionblock.caution .title i.icon,
    .admonition.caution .title .icon { content: "⚡" !important; }
    .admonitionblock.important .title .icon,
    .admonitionblock.important .title i.icon,
    .admonition.important .title .icon { content: "⚠" !important; }
    @media (max-width: 768px) {
      .header { flex-direction: column; align-items: flex-start; gap: 0.5em; }
      .header .actions { width: 100%; flex-direction: column; }
      .header .actions a { text-align: center; }
      .navigation-controls { flex-direction: column; gap: 0.5em; }
      .navigation-controls button { width: 100%; }
    }
  `;
}
