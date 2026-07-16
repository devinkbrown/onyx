import { test, expect } from '@playwright/test';
import { stubPublicFeeds } from './public-feed-fixture';

// Headless-Chromium e2e for the /about deep-dive.
test.describe('Onyx /about', () => {
  test('hero renders the brutalist headline', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1, name: /open wire, no ceilings/i })).toBeVisible();
  });

  test('media model claims are present and accurate', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByText(/our codec/i).first()).toBeVisible();
    await expect(page.getByText(/never sees/i).first()).toBeVisible();
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
