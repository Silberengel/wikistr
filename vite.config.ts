import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Parse changelog for current version at build time
function parseChangelogForVersion(changelogText: string, version: string): { added?: string[]; changed?: string[]; fixed?: string[] } | null {
  if (!changelogText || !version) {
    return null;
  }
  
  const normalizedVersion = version.trim();
  const escapedVersion = normalizedVersion.replace(/\./g, '\\.');
  
  // Try pattern 1: ## [version] - date
  let pattern = `##\\s*\\[${escapedVersion}\\]`;
  let versionRegex = new RegExp(pattern, 'i');
  let match = changelogText.match(versionRegex);
  
  // If not found, try pattern 2: ## version
  if (!match) {
    pattern = `##\\s*${escapedVersion}`;
    versionRegex = new RegExp(pattern, 'i');
    match = changelogText.match(versionRegex);
  }
  
  if (!match) {
    return null;
  }
  
  const startIndex = match.index! + match[0].length;
  const remainingText = changelogText.substring(startIndex);
  const nextVersionMatch = remainingText.match(/^##\s*\[?[\d.]+\]?/m);
  const endIndex = nextVersionMatch ? startIndex + nextVersionMatch.index! : changelogText.length;
  
  const section = changelogText.substring(startIndex, endIndex).trim();
  
  if (!section) {
    return null;
  }
  
  const result: { added?: string[]; changed?: string[]; fixed?: string[] } = {};
  
  // Extract Added section
  const addedMatch = section.match(/###\s+Added\s*\n([\s\S]*?)(?=###\s+(Changed|Fixed)|$)/i);
  if (addedMatch && addedMatch[1]) {
    result.added = addedMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-\*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }
  
  // Extract Changed section
  const changedMatch = section.match(/###\s+Changed\s*\n([\s\S]*?)(?=###\s+(Added|Fixed)|$)/i);
  if (changedMatch && changedMatch[1]) {
    result.changed = changedMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-\*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }
  
  // Extract Fixed section
  const fixedMatch = section.match(/###\s+Fixed\s*\n([\s\S]*?)(?=###\s+(Added|Changed)|$)/i);
  if (fixedMatch && fixedMatch[1]) {
    result.fixed = fixedMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-\*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }
  
  if (Object.keys(result).length === 0) {
    return null;
  }
  
  return result;
}

// Read and parse changelog from static folder
let changelogData: string = 'null';
try {
  const changelogText = readFileSync('./static/CHANGELOG.md', 'utf-8');
  const changelogEntry = parseChangelogForVersion(changelogText, packageJson.version);
  changelogData = changelogEntry ? JSON.stringify(changelogEntry) : 'null';
} catch (error) {
  console.warn('Failed to parse changelog at build time:', error);
}

const config: UserConfig = {
  plugins: [sveltekit()],
  server: {
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 700
      }
    },
    proxy: {
      '/sites': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path // Keep path as-is - server expects /sites?url=...
      },
      '/asciidoctor': {
        target: 'http://localhost:8091',
        changeOrigin: true,
        rewrite: (path) => {
          // Remove /asciidoctor prefix, server expects paths like /convert/pdf
          const newPath = path.replace(/^\/asciidoctor/, '');
          // Ensure leading slash
          return newPath.startsWith('/') ? newPath : '/' + newPath;
        }
      },
      '/alexandria-catalogue': {
        target: 'http://localhost:8092',
        changeOrigin: true,
        rewrite: (path) => {
          // Remove /alexandria-catalogue prefix (with or without trailing slash)
          let newPath = path.replace(/^\/alexandria-catalogue\/?/, '');
          // Ensure leading slash (empty path becomes /)
          if (!newPath || newPath === '') {
            newPath = '/';
          } else if (!newPath.startsWith('/')) {
            newPath = '/' + newPath;
          }
          console.log(`[Vite Proxy] Rewriting ${path} -> ${newPath}`);
          return newPath;
        }
      }
    }
  },
  build: {
    // Optimize build performance
    target: 'esnext',
    minify: 'esbuild', // Faster than terser
    sourcemap: false, // Disable sourcemaps for faster builds (can enable for debugging)
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Split large dependencies into separate chunks
          if (id.includes('node_modules')) {
            if (id.includes('@asciidoctor')) {
              return 'asciidoctor';
            }
            if (id.includes('epubjs')) {
              return 'epubjs';
            }
            if (id.includes('highlight.js')) {
              return 'highlight';
            }
            if (id.includes('katex')) {
              return 'katex';
            }
            if (id.includes('@nostr')) {
              return 'nostr';
            }
            // All other node_modules
            return 'vendor';
          }
        }
      }
    },
    // Increase chunk size warning limit (default is 500kb)
    chunkSizeWarningLimit: 1000
  },
  define: {
    __THEME__: JSON.stringify((process as any).env.THEME || 'wikistr'),
    __VERSION__: JSON.stringify(packageJson.version),
    __CHANGELOG__: changelogData
  }
};

export default defineConfig(config);
