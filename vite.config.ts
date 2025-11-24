import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
      }
    }
  },
  define: {
    __THEME__: JSON.stringify((process as any).env.THEME || 'wikistr'),
    __VERSION__: JSON.stringify(packageJson.version)
  }
};

export default defineConfig(config);
