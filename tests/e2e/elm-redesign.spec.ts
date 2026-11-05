// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

// Elm redesign smoke: the redesigned public pages render with the right
// copy, links, and interactions, and boot without console errors.
// Runs against tests/e2e/elm.config.ts (staged Elm site, no backend).

test.describe('elm redesign', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    (page as unknown as { __elmErrors: string[] }).__elmErrors = errors;
  });

  test.afterEach(async ({ page }) => {
    const errors = (page as unknown as { __elmErrors: string[] }).__elmErrors ?? [];
    expect(errors, 'console/page errors').toEqual([]);
  });

  test('landing shows every way in with no tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Onyx — good company. Great nights.');
    await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Good company. Great nights.' })).toBeVisible();
    const ledger = page.getByTestId('ways-in-ledger');
    await expect(ledger.getByRole('link', { name: 'Open the public room' })).toHaveAttribute('href', '/invite?join=%23root');
    await expect(ledger.getByRole('link', { name: 'Open Onyx' })).toHaveAttribute('href', '/app/');
    await expect(ledger.getByRole('link', { name: 'Read the first-room guide' })).toHaveAttribute('href', '/guides');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByText('No third-party trackers')).toBeVisible();
  });

  test('masthead menu toggles and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about/');
    const toggle = page.getByRole('button', { name: /navigation menu/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#public-primary-navigation.is-open')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('about renders the story and the statement', async ({ page }) => {
    await page.goto('/about/');
    await expect(page).toHaveTitle('About Onyx — rooms for your people');
    await expect(page.getByRole('heading', { name: 'Rooms for people you already like.' })).toBeVisible();
    await expect(page.locator('.site-who-row')).toHaveCount(3);
    await page.getByText('Read the full accessibility statement').click();
    await expect(page.getByRole('heading', { name: 'Reporting accessibility bugs' })).toBeVisible();
    await expect(page.locator('#a11y-reporting-title').locator('..')).toContainText('#accessibility');
  });

  test('guides renders the plan with live progress', async ({ page }) => {
    await page.goto('/guides/');
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    await expect(page.locator('.guides-progress__count')).toBeVisible();
  });

  test('status renders the honest sentence and a recheck', async ({ page }) => {
    await page.goto('/status/');
    await expect(page.getByRole('heading', { name: 'Are the rooms up tonight?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  });
});
