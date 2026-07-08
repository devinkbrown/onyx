import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Onyx — Vite + SolidJS static SPA. Output to out/ (gitignored; nginx serves it).
export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist', // build target — deploy.sh syncs this into the live-served out/
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/solid-js/') || id.includes('/node_modules/@solidjs/')) {
            return 'solid';
          }
          if (
            id.includes('/src/lib/suimyaku-media/') ||
            id.includes('/src/media/') ||
            id.includes('/src/lib/store/')
          ) {
            return 'runtime';
          }
        },
      },
    },
  },
  server: { port: 3000, host: true },
  preview: { port: 4173, host: true },
});
