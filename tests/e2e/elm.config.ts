// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ARTIFACTS = path.resolve(process.env.ONYX_TEST_ARTIFACTS_ROOT ?? path.resolve(ROOT, 'test-results'));

// Elm redesign e2e: builds the Elm client site into a staging directory,
// serves it with SPA fallback, and drives the redesigned public pages.
// No backend needed — public routes render without a socket.
// Requires `elm` 0.19.1 on PATH (see elm/README.md); browsers via
// `pnpm exec playwright install chromium`.
export default defineConfig({
  // testDir resolves against the config file, not the cwd.
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: ['elm-*.spec.ts'],
  testIgnore: ['elm-local*.spec.ts', 'elm-performance*.spec.ts', 'elm-stress*.spec.ts', 'elm-audit-*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  outputDir: path.join(ARTIFACTS, 'elm-e2e'),
  use: {
    baseURL: 'http://127.0.0.1:8913',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.ONYX_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium' },
  } },
  // Opt-in stock Firefox over WebDriver BiDi (Playwright's `moz-firefox` channel).
  // Bundled Playwright Firefox builds do not run on musl hosts, so the release
  // binary is supplied explicitly; nothing is downloaded.
  ...(process.env.ONYX_FIREFOX_EXECUTABLE ? [{ name: 'firefox', use: {
    ...devices['Desktop Firefox'],
    channel: 'moz-firefox',
    launchOptions: { executablePath: process.env.ONYX_FIREFOX_EXECUTABLE },
  } }] : [])],
  webServer: {
    // webServer cwd is the config dir — anchor tool paths at the repo root.
    command: `node ${ROOT}/tools/build-elm-site.mjs /tmp/onyx-elm-e2e && node ${ROOT}/tools/serve-dir.mjs /tmp/onyx-elm-e2e 8913`,
    url: 'http://127.0.0.1:8913/',
    reuseExistingServer: false,
    timeout: 180 * 1000,
    stdout: 'pipe',
  },
});
