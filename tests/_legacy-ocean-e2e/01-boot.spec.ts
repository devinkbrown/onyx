import { test, expect } from '@playwright/test';

const noise = /favicon|sourcemap|net::ERR|Download the React DevTools|manifest|preload|hydrat|WebSocket|ws:|wss:|ECONNREFUSED|Failed to fetch/i;

test('landing page renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
  expect(errors.filter((e) => !noise.test(e))).toHaveLength(0);
});

test('login page renders without fatal console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/login');
  await expect(page.locator('#login-nick')).toBeVisible();

  const fatal = errors.filter((e) => !noise.test(e));
  expect(fatal, `console errors:\n${fatal.join('\n')}`).toHaveLength(0);
});

test('app shell renders', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('.app-shell')).toBeVisible();
});
