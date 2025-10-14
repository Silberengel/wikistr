import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 700
      }
    }
  },
  define: {
    __THEME__: JSON.stringify(process.env.THEME || 'wikistr')
  }
});
