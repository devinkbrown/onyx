import { test, expect } from '@playwright/test';

// Boots the real app in a real browser and asserts it renders with no fatal
// console errors. Catches hydration/runtime breakage that unit tests miss.
test('app boots and login renders without fatal console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.locator('#login-nick')).toBeVisible();

  const noise = /favicon|sourcemap|net::ERR|Download the React DevTools|manifest|preload/i;
  const fatal = errors.filter((e) => !noise.test(e));
  expect(fatal, `console errors:\n${fatal.join('\n')}`).toHaveLength(0);
});
