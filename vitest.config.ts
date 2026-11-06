import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Onyx test harness for the shared src/lib modules and tools (vitest + jsdom).
// fs.allow is computed (not hardcoded to /home/kain/onyx) so vitest runs INSIDE a fleet
// worktree too: the worktree root + the resolved workspace root + the shared pnpm store are
// all served, so jest-dom's realpath resolves within the allow-list wherever the checkout lives.
// This unblocks parallel test-gating across worktrees instead of serializing in the main tree.
export default defineConfig({
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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tools/**/*.test.mjs', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'tests/e2e/**', '.wt/**'],
    // Full-suite IDB/materialization cases (export bounds, vault prune)
    // exceed 5s under load; the default 5s produced load flakes.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Cap concurrency so fake-indexeddb + jsdom suites do not thrash each other
    // (PreferencesPanel toggle/import flaked under full-suite IDB pollution).
    maxWorkers: 2,
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
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
