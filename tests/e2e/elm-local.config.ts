// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const baseURL = process.env.ONYX_ELM_LAB_BASE;
const localWs = process.env.ONYX_ELM_LAB_WS;
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ARTIFACTS = path.resolve(process.env.ONYX_TEST_ARTIFACTS_ROOT ?? path.resolve(ROOT, 'test-results'));
function validEndpoint(value: string | undefined, protocol: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === protocol && url.hostname === '127.0.0.1' && Number(url.port) > 0 && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
if (!baseURL || !localWs || !validEndpoint(baseURL, 'https:') || !validEndpoint(localWs, 'wss:')) {
  throw new Error('local_lab_requires_explicit_loopback_endpoints');
}

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testIgnore: [],
  testMatch: 'elm-local-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: path.join(ARTIFACTS, 'elm-local'),
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.ONYX_ELM_LAB_CERT_BYPASS === '1',
    serviceWorkers: 'block',
    headless: true,
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: '/usr/bin/chromium' },
  },
});
