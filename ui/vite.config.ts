import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // Optional: For dev, proxy API requests to your backend
    proxy: {
      '/api': {
        // Requests to /api/* from the Svelte app
        target: 'http://localhost:3000', // Your backend server
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '/api') // Ensure /api prefix is kept for backend
      },
    },
  },
});
