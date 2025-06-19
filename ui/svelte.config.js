// import adapter from '@sveltejs/adapter-auto'; // Default
import adapter from '@sveltejs/adapter-static'; // For static hosting with Nginx
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // default options are shown. On some platforms
      // these options are set automatically — see below
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // Important for SPAs with client-side routing
      precompress: false, // Nginx can handle compression
      strict: true,
    }),
    alias: {
      $lib: './src/lib',
      $components: './src/lib/components',
      $stores: './src/lib/stores',
      $utils: './src/lib/utils',
      $types: './src/lib/types',
      $client: './src/lib/client',
    },
    // If serving from a subpath on Nginx, e.g. /ui/, set paths.base
    // paths: {
    //   base: process.env.NODE_ENV === 'production' ? '/ui' : '',
    // }
  },
};

export default config;
