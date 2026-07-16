import type { Page } from '@playwright/test';

/** Keep production-preview route tests deterministic without a composite stats export. */
export async function stubPublicFeeds(page: Page): Promise<void> {
  await page.route('**/stats/data/status.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: Math.floor(Date.now() / 1000),
        network: 'Onyx test mesh',
        node: 'preview',
        uptime_seconds: 1,
        users_online: 0,
        mesh: { quorum: true, partitioned: false, components: 1 },
        peers: [],
      }),
    });
  });
  await page.route('**/stats/data/index.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: Math.floor(Date.now() / 1000),
        network: 'Onyx test mesh',
        node: 'preview',
        users_online: 0,
        network_days: [],
        channels: [],
      }),
    });
  });
}
