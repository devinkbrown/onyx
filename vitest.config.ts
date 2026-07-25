import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath, URL } from 'node:url';

// Onyx test harness — vitest + SolidJS (vite-plugin-solid + jsdom).
// fs.allow is computed (not hardcoded to /home/kain/onyx) so vitest runs INSIDE a fleet
// worktree too: the worktree root + the resolved workspace root + the shared pnpm store are
// all served, so jest-dom's realpath resolves within the allow-list wherever the checkout lives.
// This unblocks parallel test-gating across worktrees instead of serializing in the main tree.
export default defineConfig({
  plugins: [solid()],
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        process.cwd(),
        '/home/kain/.local/share/pnpm/store',
      ],
    },
  },
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
    // Full-suite IDB/materialization cases (export bounds, vault prune) and Solid
    // panel journeys exceed 5s under load; default 5s produced load flakes.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Cap concurrency so fake-indexeddb + jsdom suites do not thrash each other
    // when the host is already running a heavy `zig build test`.
    maxWorkers: 4,
    server: { deps: { inline: [/solid-js/, /@solidjs\/.*/] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.{ts,tsx}', 'src/primitives/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/lib/cadence-media/OpcodecWasm.ts',
        'src/lib/cadence-media/videoEncodeWorker.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
