import { defineConfig, devices } from '@playwright/test';

// Autonomous E2E harness for Ocean.
// Headless Chromium with FAKE media devices so voice/video paths (getUserMedia,
// SUIMYAKU encode/MEDIAFRAME) can be exercised without real hardware or a human.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Test the real production build via Vite preview (instant serve — avoids dev
  // cold-start). Reuses an already-running preview on :4173 when present.
  webServer: {
    command: 'pnpm preview --port 4173 --host',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
