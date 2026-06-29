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
    outDir: 'out',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { port: 3000, host: true },
  preview: { port: 4173, host: true },
});
