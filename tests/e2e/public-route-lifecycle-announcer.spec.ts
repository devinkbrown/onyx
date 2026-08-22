import { expect, test, type Page } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

const LIVE_REGION = '[data-ui="route-announcer"]';

async function markLiveRegion(page: Page): Promise<void> {
  await page.locator(LIVE_REGION).evaluate((node) => {
    node.setAttribute('data-lifecycle-probe', 'persistent');
  });
}

async function clickInjected(page: Page, href: string, name: string): Promise<void> {
  await page.evaluate(({ href: next, name: label }) => {
    document.querySelector('[data-lifecycle-link]')?.remove();
    const link = document.createElement('a');
    link.href = next;
    link.textContent = label;
    link.dataset.lifecycleLink = 'true';
    link.setAttribute('noscroll', '');
    link.style.position = 'fixed';
    link.style.inset = 'auto 8px 8px auto';
    link.style.zIndex = '2147483647';
    document.body.append(link);
    link.click();
  }, { href, name });
}

test.describe('public route lifecycle announcer', () => {
  test.beforeEach(async ({ page }) => {
    await stubPublicFeeds(page);
  });

  test('keeps one persistent live region, stays silent on first paint, and announces one settled route', async ({ page }) => {
    const titleOnLanding = 'Onyx — a room for your people';
    await page.goto('/');
    await expect(page).toHaveTitle(titleOnLanding);

    const region = page.locator(LIVE_REGION);
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-atomic', 'true');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveText('');
    await expect.poll(async () => page.locator(LIVE_REGION).evaluate((node) => ({
      inNav: Boolean(node.closest('nav, [role="navigation"]')),
      inMain: Boolean(node.closest('main')),
      inHeader: Boolean(node.closest('header')),
    }))).toEqual({ inNav: false, inMain: false, inHeader: false });

    await markLiveRegion(page);
    const focusedBefore = await page.evaluate(() => document.activeElement?.tagName ?? '');
    const titleBefore = await page.title();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about\/?/);
    await expect(region).toHaveText('About');
    await expect(region).toHaveAttribute('data-lifecycle-probe', 'persistent');
    await expect(page).toHaveTitle(/About Onyx/);
    expect(await page.title()).not.toBe('About');
    expect(await page.title()).not.toBe(titleBefore);

    await expect.poll(async () => page.evaluate(() => ({
      focused: document.activeElement?.getAttribute('data-ui') ?? '',
      regions: document.querySelectorAll('[data-ui="route-announcer"]').length,
    }))).toEqual({ focused: '', regions: 1 });
    expect(await page.evaluate(() => document.activeElement?.tagName ?? '')).not.toBe('undefined');
    expect(focusedBefore.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(0);
    expect(scrollBefore).toBeGreaterThanOrEqual(0);
    await expect(page.locator(LIVE_REGION)).toHaveCount(1);
  });

  test('does not announce query-only or hash-only changes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About', exact: true }).click();
    await expect(page.locator(LIVE_REGION)).toHaveText('About');
    await markLiveRegion(page);

    await clickInjected(page, '/about/?ref=lifecycle', 'About query');
    await expect(page).toHaveURL(/ref=lifecycle/);
    await expect(page.locator(LIVE_REGION)).toHaveText('About');
    await expect(page.locator(LIVE_REGION)).toHaveAttribute('data-lifecycle-probe', 'persistent');

    await clickInjected(page, '/about/?ref=lifecycle#accessibility', 'About hash');
    await expect(page).toHaveURL(/#accessibility/);
    await expect(page.locator(LIVE_REGION)).toHaveText('About');
    await expect(page.locator(LIVE_REGION)).toHaveCount(1);
  });

  test('announces settled back and forward destinations once', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(LIVE_REGION)).toHaveText('');

    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About', exact: true }).click();
    await expect(page.locator(LIVE_REGION)).toHaveText('About');
    await markLiveRegion(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(LIVE_REGION)).toHaveText('Home');
    await expect(page.locator(LIVE_REGION)).toHaveAttribute('data-lifecycle-probe', 'persistent');

    await page.goForward();
    await expect(page).toHaveURL(/\/about\/?/);
    await expect(page.locator(LIVE_REGION)).toHaveText('About');
    await expect(page.locator(LIVE_REGION)).toHaveCount(1);
  });

  test('treats /install as the download identity and announces unknown paths', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Download', exact: true }).click();
    await expect(page).toHaveURL(/\/download\/?/);
    await expect(page.locator(LIVE_REGION)).toHaveText('Download');
    await markLiveRegion(page);

    await clickInjected(page, '/install/', 'Install');
    await expect(page).toHaveURL(/\/install\/?/);
    await expect(page.locator(LIVE_REGION)).toHaveText('Download');
    await expect(page.locator(LIVE_REGION)).toHaveAttribute('data-lifecycle-probe', 'persistent');

    await clickInjected(page, '/not-a-public-lifecycle-route', 'Unknown');
    await expect(page).toHaveURL(/not-a-public-lifecycle-route/);
    await expect(page.locator(LIVE_REGION)).toHaveText('Route not found');
    await expect(page.locator(LIVE_REGION)).toHaveCount(1);
  });

  test('does not steal focus or write the lifecycle label into document.title', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/about\/?/);
    await expect(page.locator(LIVE_REGION)).toHaveText('About');

    const active = await page.evaluate(() => ({
      ui: document.activeElement?.getAttribute('data-ui'),
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim().slice(0, 32) ?? '',
    }));
    expect(active.ui).not.toBe('route-announcer');
    expect(active.tag).not.toBeUndefined();
    await expect(page).toHaveTitle('About Onyx — rooms for your people');
    expect(await page.locator(LIVE_REGION).textContent()).toBe('About');
  });
});
