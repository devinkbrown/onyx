import { test, expect } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

// Headless-Chromium e2e for the Onyx launch site.
test.describe('Onyx landing', () => {
  test('hero loads with the finalized company headline and share metadata', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Onyx — good company. Great nights.');
    await expect(page.locator('h1#hero-heading')).toHaveText('Good company. Great nights.');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Good company. Great nights. Rooms, calls, and private DMs for friends and clubs. History stays on this device — about 400 messages per room. No ads.',
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Onyx — good company. Great nights.');
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', 'Onyx — good company. Great nights.');
  });

  test('header and hero keep the Open Onyx actions scoped and actionable', async ({ page }) => {
    await page.goto('/');
    const headerOpen = page.locator('.public-frame__open');
    const heroOpen = page.locator('main a.home-cta-primary');
    await expect(headerOpen).toHaveCount(1);
    await expect(headerOpen).toHaveText('Open Onyx');
    await expect(headerOpen).toHaveAttribute('href', '/app/');
    await expect(heroOpen).toHaveCount(1);
    await expect(heroOpen).toHaveText('Open Onyx');
    await expect(heroOpen).toHaveAttribute('href', '/app/');
    await expect(page.getByRole('link', { name: 'See the public room', exact: true })).toBeVisible();
  });

  test('the page shows a fictional room scene, not a live room or evidence desk', async ({ page }) => {
    await page.goto('/');
    const preview = page.getByRole('region', { name: 'Friday co-op', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByText('Fictional game-night preview', { exact: true })).toBeVisible();
    await expect(preview.getByText('Not a live room. The controls below only change this example.', { exact: true })).toBeVisible();
    await expect(page.getByText(/unavailable/i)).toHaveCount(0);
  });

  test('the entry point routes into the app', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'See the public room', exact: true }).click();
    await expect(page).toHaveURL(/\/invite\/\?join=%23root$/u);
  });

  test('no console errors on load', async ({ page }) => {
    await stubPublicFeeds(page);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
