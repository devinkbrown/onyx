import { expect, test } from '@playwright/test';

test('previews a living background without applying it', async ({ page }) => {
  await page.goto('/appearance/');

  const picker = page.getByRole('radiogroup', { name: 'Background' });
  const phoenix = picker.getByRole('radio', { name: /Phoenix, scene/i });
  await phoenix.hover();

  await expect(page.locator('.ap > [data-background-canvas][data-background-id="phoenix"]')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('heading', { name: /Set the atmosphere/i }).hover();
  await expect(page.locator('.ap > [data-background-canvas][data-background-id="phoenix"]')).toHaveCount(0);
});

test('stages, cancels, and applies a background choice', async ({ page }) => {
  await page.goto('/appearance/');

  const picker = page.getByRole('radiogroup', { name: 'Background' });
  const auto = picker.getByRole('radio', { name: /Auto — theme-matched background/i });
  const obsidian = picker.getByRole('radio', { name: /Obsidian, solid/i });
  await expect(auto).toHaveAttribute('aria-checked', 'true');

  await obsidian.click();
  await expect(obsidian).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Preview only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await obsidian.click();
  await page.getByRole('button', { name: 'Apply background' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(obsidian).toHaveAttribute('aria-checked', 'true');
});
