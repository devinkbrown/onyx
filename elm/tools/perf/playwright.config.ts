// SPDX-License-Identifier: AGPL-3.0-or-later
import base from '../../../tests/e2e/elm.config';
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const ARTIFACTS = path.resolve(process.env.ONYX_TEST_ARTIFACTS_ROOT ?? path.resolve(ROOT, 'test-results'));
const STAGE = process.env.ONYX_PERF_STAGE ?? '/tmp/onyx-elm-perf-stage';
const PORT = process.env.ONYX_PERF_PORT ?? '8914';

// Isolated runner port/stage so Elm performance runs do not reuse the general
// e2e server's output directory.
export default defineConfig({
  ...base,
  testDir: path.resolve(ROOT, 'tests/e2e'),
  testIgnore: [],
  testMatch: ['elm-performance*.spec.ts', 'elm-stress*.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  outputDir: path.join(ARTIFACTS, 'elm-perf'),
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}`, trace: 'off', launchOptions: { executablePath: process.env.ONYX_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium' } },
  webServer: {
    command: `node ${ROOT}/tools/serve-dir.mjs ${STAGE} ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
});
