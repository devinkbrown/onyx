import { expect, test } from '@playwright/test';

test('contains the OnyxOS product route at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/onyxos/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const heading = page.getByRole('heading', { name: /communication,\s*at home in the system/i });
  await expect(heading).toBeVisible();
  await page.locator('.onyxos-close').scrollIntoViewIfNeeded();

  const geometry = await page.evaluate(() => {
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>(
      '.onyxos-nav, .onyxos-hero, .onyxos-native, .onyxos-native__grid, .onyxos-method, .onyxos-console, .onyxos-workbench, .onyxos-close',
    )).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
      };
    });
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      heroFontSize: Number.parseFloat(getComputedStyle(
        document.querySelector<HTMLElement>('.onyxos-hero h1')!,
      ).fontSize),
      nativeCopyFontSize: Number.parseFloat(getComputedStyle(
        document.querySelector<HTMLElement>('.onyxos-native__grid p')!,
      ).fontSize),
      surfaces,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  for (const surface of geometry.surfaces) {
    expect(surface.scrollWidth, surface.className).toBe(surface.clientWidth);
    expect(surface.left, surface.className).toBeGreaterThanOrEqual(0);
    expect(surface.right, surface.className).toBeLessThanOrEqual(320);
  }
  expect(geometry.heroFontSize).toBeLessThanOrEqual(64);
  expect(geometry.nativeCopyFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.nativeCopyFontSize).toBeLessThanOrEqual(24);
});
