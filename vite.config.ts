import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';

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
        rewrite: (path) => path // Keep /sites/ prefix
      }
    }
  },
  define: {
    __THEME__: JSON.stringify((process as any).env.THEME || 'wikistr')
  }
};

export default defineConfig(config);
