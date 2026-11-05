import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const alias = { '@': fileURLToPath(new URL('../src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'elm-runtime-node',
          include: ['elm/runtime/**/*.{test,spec}.ts'],
          exclude: ['elm/runtime/**/*.dom.{test,spec}.ts', 'elm/runtime/**/*.worker.{test,spec}.ts'],
          environment: 'node',
          setupFiles: ['./elm/runtime/test-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 30_000,
          maxWorkers: 2,
        },
      },
      {
        extends: true,
        test: {
          name: 'elm-runtime-dom',
          include: ['elm/runtime/**/*.dom.{test,spec}.ts'],
          environment: 'jsdom',
          setupFiles: ['./elm/runtime/test-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 30_000,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'elm-runtime-worker-isolated',
          include: ['elm/runtime/**/*.worker.{test,spec}.ts'],
          environment: 'node',
          setupFiles: ['./elm/runtime/test-setup.ts'],
          pool: 'forks',
          isolate: true,
          maxWorkers: 1,
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
