import { test, expect } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

// Headless-Chromium e2e for the /about deep-dive.
test.describe('Onyx /about', () => {
  test('hero renders the community headline', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1, name: /rooms for people you already like/i })).toBeVisible();
  });

  test('community story is present before operators', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: /a room that stays open/i })).toBeVisible();
    await expect(page.getByText(/no ads/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /friends, clubs, creators/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /open it\. invite people/i })).toBeVisible();
  });

  test('no console errors on load', async ({ page }) => {
    await stubPublicFeeds(page);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
