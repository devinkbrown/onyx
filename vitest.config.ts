import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { fileURLToPath, URL } from 'node:url';

// Onyx test harness — vitest + SolidJS (vite-plugin-solid + jsdom).
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Critical for Solid reactivity under test.
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'tests/e2e/**', '.wt/**'],
    server: { deps: { inline: [/solid-js/, /@solidjs\/.*/] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.{ts,tsx}', 'src/primitives/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/lib/suimyaku-media/OpcodecWasm.ts',
        'src/lib/suimyaku-media/videoEncodeWorker.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
