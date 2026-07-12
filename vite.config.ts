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
          // The media engine (voice/video, wasm codec) is NOT needed on first
          // paint — only inside the lazy /app route once a call starts. Keep it
          // in its own `media` chunk so it stays out of the eager `runtime`
          // (store) chunk that the landing page pulls in via vaultSync.
          if (id.includes('/src/lib/suimyaku-media/') || id.includes('/src/media/')) {
            return 'media';
          }
          // Theme token data (themes/customThemes/themeStorage) is a small, pure
          // leaf cluster the eager ThemeProvider needs on first paint. store.ts
          // ALSO imports themes.ts (DEFAULT_THEME_ID/THEME_IDS), so without an
          // explicit split Rollup folds the trio INTO the ~58kB `runtime` (store
          // + irc + e2ee + notifications) chunk — which then becomes a static
          // dependency of the marketing landing entry purely to read theme
          // tokens. Give it its own tiny `theme` chunk so the landing entry pulls
          // only that; `runtime` re-imports it (cheap) and stays lazy to /app.
          if (
            id.includes('/src/theme/themes') ||
            id.includes('/src/theme/customThemes') ||
            id.includes('/src/theme/themeStorage')
          ) {
            return 'theme';
          }
          if (id.includes('/src/lib/store/')) {
            return 'runtime';
          }
        },
      },
    },
  },
  server: { port: 3000, host: true },
  preview: { port: 4173, host: true },
});
