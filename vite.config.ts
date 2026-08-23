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
    // AppShell is the connected-client route (172 kB gzip), not landing-page
    // startup work. Keep a deliberate 600 kB uncompressed ceiling so Vite
    // warns on real growth instead of warning on the current routed shell.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/solid-js/') || id.includes('/node_modules/@solidjs/')) {
            return 'solid';
          }
          // Rollup's own preload-helper virtual module is a shared leaf that
          // Vite otherwise folds into whatever chunk happens to reference it
          // first. Pin it to `solid` (loaded eagerly everywhere anyway) so it
          // can't drag an unrelated chunk into the landing entry's static
          // import graph.
          if (id.includes('preload-helper')) {
            return 'solid';
          }
          // The media engine (voice/video, wasm codec) is NOT needed on first
          // paint — only inside the lazy /app route once a call starts. Keep it
          // in its own `media` chunk so it stays out of the eager `runtime`
          // (store) chunk that the landing page pulls in via vaultSync.
          if (id.includes('/src/lib/cadence-media/') || id.includes('/src/media/')) {
            return 'media';
          }
          // Theme token data (themes/customThemes/themeStorage) is a small, pure
          // leaf cluster the eager ThemeProvider needs on first paint. store.ts
          // ALSO imports themes.ts (DEFAULT_THEME_ID/THEME_IDS), so without an
          // explicit split Rollup folds the trio INTO the ~482kB `runtime`
          // (store + irc + e2ee + historyVault) chunk — which then becomes a
          // static dependency of the marketing landing entry purely to read
          // theme tokens. Give it its own tiny `theme` chunk so the landing
          // entry pulls only that; `runtime` re-imports it (cheap) and stays
          // lazy to /app.
          if (
            id.includes('/src/theme/themes') ||
            id.includes('/src/theme/customThemes') ||
            id.includes('/src/theme/themeStorage')
          ) {
            return 'theme';
          }
          // Two more shared leaves reached eagerly from the landing route
          // (src/index.tsx → theme/ThemeProvider.tsx and routes/Landing.tsx)
          // that would otherwise pull `runtime` in transitively alongside
          // them. Route into `theme` — it's already an eager landing chunk,
          // small, and these are equally small pure leaves.
          if (
            id.includes('/src/lib/prefs/preferences') ||
            id.includes('/src/lib/stats/fetchPublicJson')
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
  // Desktop host (Native SDK) allowlists http://127.0.0.1:3000 — bind all
  // interfaces in browser dev, but prefer 127.0.0.1 when spawned by `native dev`.
  server: { port: 3000, strictPort: true, host: true },
  preview: { port: 4173, host: true },
});
