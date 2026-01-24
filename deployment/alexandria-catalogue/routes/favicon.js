/**
 * Favicon route handler
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Handle favicon requests
 */
export function handleFavicon(req, res) {
  try {
    // Try multiple possible paths
    const possiblePaths = [
      join(__dirname, '..', '..', '..', 'static', 'favicon_alex-catalogue.png'), // From routes/ -> alexandria-catalogue/ -> deployment/ -> static/
      join(__dirname, '..', '..', 'static', 'favicon_alex-catalogue.png'), // From routes/ -> alexandria-catalogue/ -> static/
      join(process.cwd(), 'static', 'favicon_alex-catalogue.png'), // From app root
      join(process.cwd(), '..', 'static', 'favicon_alex-catalogue.png'), // From deployment/ -> static/
      '/app/static/favicon_alex-catalogue.png', // Docker absolute path
      join(__dirname, '..', '..', '..', '..', 'static', 'favicon_alex-catalogue.png') // Alternative path
    ];
    
    let faviconData = null;
    let faviconPath = null;
    
    for (const path of possiblePaths) {
      try {
        faviconData = readFileSync(path);
        faviconPath = path;
        console.log(`[Favicon] Successfully loaded favicon from: ${faviconPath} (${faviconData.length} bytes)`);
        break;
      } catch (err) {
        // Try next path
        continue;
      }
    }
    
    if (!faviconData) {
      throw new Error('Favicon not found in any expected location');
    }
    
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(faviconData);
  } catch (error) {
    console.error('[Favicon] Error serving favicon:', error);
    console.error('[Favicon] __dirname:', __dirname);
    console.error('[Favicon] process.cwd():', process.cwd());
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Favicon not found');
  }
}
