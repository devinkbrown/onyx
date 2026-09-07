import { test, expect } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

// Headless-Chromium e2e for the Onyx launch site.
test.describe('Onyx landing', () => {
  test('hero loads with the community headline', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Come for the conversation. Return to the room.');
  });

  test('kicker + primary CTAs render', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('A room for your people', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start in the public room' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the app' })).toBeVisible();
  });

  test('the page invites people into a room, not an evidence desk', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: /look inside a room/i })).toBeVisible();
    await expect(page.getByText(/unavailable/i)).toHaveCount(0);
  });

  test('the entry point routes into the app', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start in the public room' }).click();
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
