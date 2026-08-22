import { test, expect } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

// Headless-Chromium e2e for the Onyx launch site.
test.describe('Onyx landing', () => {
  test('hero loads with the community headline', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('A room for your people.');
  });

  test('kicker + primary CTAs render', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/friends · clubs · rooms/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /join free/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /open onyx/i }).first()).toBeVisible();
  });

  test('the page invites people into a room, not an evidence desk', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: /look inside a room/i })).toBeVisible();
    await expect(page.getByText(/unavailable/i)).toHaveCount(0);
  });

  test('the entry point routes into the app', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /join free/i }).first().click();
    await expect(page).toHaveURL(/\/app/);
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
