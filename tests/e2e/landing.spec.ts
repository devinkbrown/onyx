import { test, expect } from '@playwright/test';

// Headless-Chromium e2e for the Ruri launch site.
test.describe('Ruri landing', () => {
  test('hero loads with the brutalist headline', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText(/living mesh/i);
  });

  test('capability offerings + mythos render', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Difference you can feel')).toBeVisible();
    await expect(page.getByText(/eshmaki · the gate/i)).toBeVisible();
    await expect(page.getByText(/The server never sees you/i)).toBeVisible();
  });

  test('both mesh nodes are advertised', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/eshmaki\.me : 8080/i)).toBeVisible();
    await expect(page.getByText(/ircx\.us : 8080/i)).toBeVisible();
  });

  test('the entry point routes into the app', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /open ruri/i }).first().click();
    await expect(page).toHaveURL(/\/app/);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
