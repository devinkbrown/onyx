import { test, expect } from '@playwright/test';

// Validates the core theming complaint: selecting a theme must actually change
// the live <html data-theme> AND a real CSS variable (proves the theme exists
// in CSS, not just in the picker list).
test('selecting themes applies data-theme and real CSS vars', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-nick')).toBeVisible();

  // Open the Appearance/Theme modal (ServerBar trigger).
  await page.getByRole('button', { name: /theme|appearance/i }).first().click().catch(() => {});
  const grid = page.locator('[role="radiogroup"][aria-label="Theme"]');
  await expect(grid).toBeVisible();

  const swatches = grid.locator('button');
  const count = await swatches.count();
  expect(count).toBeGreaterThan(3);

  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const btn = swatches.nth(i);
    const label = (await btn.getAttribute('aria-label')) || (await btn.innerText()) || `#${i}`;
    await btn.click();
    // data-theme must reflect a real, non-empty theme value
    const dt = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(dt, `theme "${label}" set data-theme`).toBeTruthy();
    // the chosen theme must define a real background var (i.e. CSS block exists)
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-void').trim(),
    );
    expect(bg, `theme "${label}" defines --bg-void`).not.toBe('');
    seen.add(dt || '');
  }
  // Different themes should produce different data-theme values (not all identical)
  expect(seen.size, `distinct data-theme values across ${count} swatches`).toBeGreaterThan(1);
});
