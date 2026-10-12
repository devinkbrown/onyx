import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Onyx unit-test harness — vitest + jsdom for the TypeScript engine that the Elm
// build bundles (elm/engine: Cadence media engine, E2EE helpers, IRC parser,
// canvas background engine) and the static-site contract tests under tools/.
// The Elm app itself is tested with elm-test and the elm/*.smoke.mjs suites.
export default defineConfig({
  resolve: {
    // `@/` is the engine root, matching tsconfig `paths` and the esbuild bundles.
    alias: { '@': fileURLToPath(new URL('./elm/engine', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['elm/engine/**/*.{test,spec}.ts', 'tools/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'elm/dist-elm/**', '.wt/**'],
    // IDB / WebCrypto cases exceed the default 5s under load.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Cap concurrency so fake-indexeddb + jsdom suites do not thrash each other.
    maxWorkers: 2,
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['elm/engine/lib/**/*.ts'],
      exclude: [
        'elm/engine/**/*.{test,spec}.ts',
        'elm/engine/**/*.d.ts',
        'elm/engine/lib/cadence-media/OpcodecWasm.ts',
        'elm/engine/lib/cadence-media/videoEncodeWorker.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
