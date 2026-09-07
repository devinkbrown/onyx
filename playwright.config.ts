import { defineConfig, devices } from '@playwright/test';

const previewPort = Number(process.env.ONYX_PLAYWRIGHT_PORT ?? 4173);
const previewUrl = `http://localhost:${previewPort}`;

// Autonomous E2E harness for Onyx.
// Headless Chromium with FAKE media devices so voice/video paths (getUserMedia,
// CADENCE encode/MEDIAFRAME) can be exercised without real hardware or a human.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: previewUrl,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio',
          ],
        },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Test the real production build via Vite preview (instant serve — avoids dev
  // cold-start). Never reuse another process: that could test a different checkout.
  webServer: {
    command: `pnpm preview --port ${previewPort} --host`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
