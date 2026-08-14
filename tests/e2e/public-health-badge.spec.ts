import { expect, test, type Page } from '@playwright/test';

type HealthScenario = {
  path: '/' | '/about/';
  state: 'current' | 'degraded' | 'stale' | 'future' | 'unavailable';
  label: string;
  selector: string;
};

const scenarios: HealthScenario[] = [
  { path: '/', state: 'current', label: 'operational', selector: '[data-home-evidence]' },
  { path: '/', state: 'degraded', label: 'degraded', selector: '[data-home-evidence]' },
  { path: '/', state: 'stale', label: 'stale', selector: '[data-home-evidence]' },
  { path: '/about/', state: 'future', label: 'status time mismatch', selector: '.ab-feed' },
  { path: '/about/', state: 'unavailable', label: 'status unavailable', selector: '.ab-feed' },
];

async function mockPublicStatus(page: Page, state: HealthScenario['state']): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const generatedAt = state === 'stale'
    ? nowSeconds - 10 * 60
    : state === 'future'
      ? nowSeconds + 10 * 60
      : nowSeconds;
  const payload = state === 'unavailable' ? null : {
    generated_at: generatedAt,
    network: 'Onyx',
    node: 'eshmaki.me',
    uptime_seconds: 60,
    users_online: 2,
    mesh: {
      quorum: state !== 'degraded',
      partitioned: state === 'degraded',
      components: state === 'degraded' ? 2 : 1,
    },
    peers: [],
  };

  await page.route(/\/(?:stats\/data\/status|stats\/status|status)\.json$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }),
  );
}

test.describe('public mesh health badge', () => {
  for (const scenario of scenarios) {
    test(`${scenario.path} renders ${scenario.state} truthfully`, async ({ page }) => {
      await mockPublicStatus(page, scenario.state);
      await page.goto(scenario.path);

      const badge = page.locator(scenario.selector);
      await expect(badge).toHaveAttribute('data-feed-state', scenario.state);
      await expect(badge).toContainText(scenario.label);
      if (scenario.state !== 'current') {
        await expect(badge).not.toContainText('online');
        await expect(badge).not.toContainText('operational');
      }
    });
  }
});
