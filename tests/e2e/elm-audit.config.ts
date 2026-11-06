// SPDX-License-Identifier: AGPL-3.0-or-later
// Elm UI audit suite (findings, shell surfaces, keyboard journeys, public
// routes) across desktop/phone, dark/light and reduced-motion projects.
// Mirrors tests/e2e/elm.config.ts: builds the Elm site into a staging dir
// and serves it with SPA fallback; every spec talks to a mock WebSocket
// (tests/e2e/elm-audit-wire.mjs) only — no backend needed.
//
//   pnpm test:e2e:elm:audit                 # all projects
//   pnpm test:e2e:elm:audit -- --project iphone-13
//
// Env:
//   ONYX_AUDIT_ORIGIN          reuse an already-served build instead of building
//   ONYX_AUDIT_PORT            port for the built-in server (default 8932)
//   ONYX_AUDIT_STAGE           staging dir for the build (default /tmp/onyx-elm-audit)
//   ONYX_AUDIT_WORKERS         Playwright workers (default 4)
//   ONYX_CHROMIUM_EXECUTABLE   default /usr/bin/chromium
//   ONYX_FIREFOX_EXECUTABLE    adds a stock-Firefox project (channel moz-firefox)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = Number(process.env.ONYX_AUDIT_PORT ?? 8932);
const ORIGIN = process.env.ONYX_AUDIT_ORIGIN ?? `http://127.0.0.1:${PORT}`;
const STAGE = process.env.ONYX_AUDIT_STAGE ?? '/tmp/onyx-elm-audit';
const ARTIFACTS = path.resolve(process.env.ONYX_TEST_ARTIFACTS_ROOT ?? path.resolve(ROOT, 'test-results'));
const chromiumExe = process.env.ONYX_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium';

export default defineConfig({
  testDir: HERE,
  testMatch: ['elm-audit-*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: Number(process.env.ONYX_AUDIT_WORKERS ?? 4),
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: path.join(ARTIFACTS, 'elm-audit', 'results.json') }]],
  outputDir: path.join(ARTIFACTS, 'elm-audit', 'runs'),
  use: { baseURL: ORIGIN, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark', launchOptions: { executablePath: chromiumExe } } },
    { name: 'chromium-light', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'light', launchOptions: { executablePath: chromiumExe } } },
    { name: 'chromium-reduced-motion', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce', launchOptions: { executablePath: chromiumExe } } },
    { name: 'iphone-13', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', colorScheme: 'dark', launchOptions: { executablePath: chromiumExe } } },
    { name: 'iphone-13-light', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', colorScheme: 'light', launchOptions: { executablePath: chromiumExe } } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium', colorScheme: 'dark', launchOptions: { executablePath: chromiumExe } } },
    ...(process.env.ONYX_FIREFOX_EXECUTABLE ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 }, channel: 'moz-firefox', launchOptions: { executablePath: process.env.ONYX_FIREFOX_EXECUTABLE } } }] : []),
  ],
  ...(process.env.ONYX_AUDIT_ORIGIN ? {} : {
    webServer: {
      command: `node ${ROOT}/tools/build-elm-site.mjs ${STAGE} && node ${ROOT}/tools/serve-dir.mjs ${STAGE} ${PORT}`,
      url: `${ORIGIN}/`,
      cwd: ROOT,
      reuseExistingServer: true,
      timeout: 240 * 1000,
      stdout: 'pipe',
    },
  }),
});
