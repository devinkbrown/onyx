import { expect, test } from '@playwright/test';

for (const viewport of [
  { label: '320px phone', width: 320, height: 720 },
  { label: '390px phone', width: 390, height: 844 },
] as const) {
  test(`${viewport.label}: contains the product preview and primary path without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const primary = page.locator('.public-frame__open');
    const preview = page.locator('[data-product-preview]');
    const current = page.locator('[data-home-current]');
    const trust = page.locator('[data-home-trust]');
    await expect(primary).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(preview.getByText('Preview', { exact: true }).first()).toBeVisible();
    await expect(trust).toBeVisible();
    await expect(current.locator('li')).toHaveCount(4);
    await expect(page.locator('[data-home-evidence]')).toHaveCount(0);

    const geometry = await page.evaluate(() => {
      const cta = document.querySelector<HTMLElement>('.public-frame__open')!;
      const preview = document.querySelector<HTMLElement>('[data-product-preview]')!;
      const trust = document.querySelector<HTMLElement>('[data-home-trust]')!;
      const ctaRect = cta.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const trustRect = trust.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        ctaLeft: ctaRect.left,
        ctaRight: ctaRect.right,
        ctaHeight: ctaRect.height,
        previewLeft: previewRect.left,
        previewRight: previewRect.right,
        trustLeft: trustRect.left,
        trustRight: trustRect.right,
      };
    });

    expect(geometry.scrollWidth).toBe(geometry.clientWidth);
    expect(geometry.ctaLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.ctaRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.ctaHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.previewLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.previewRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.trustLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.trustRight).toBeLessThanOrEqual(viewport.width);
  });
}

test('desktop keeps the promise and product preview in a balanced first view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const geometry = await page.evaluate(() => {
    const copy = document.querySelector<HTMLElement>('.home-hero-copy')!.getBoundingClientRect();
    const preview = document.querySelector<HTMLElement>('[data-product-preview]')!.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      copyLeft: copy.left,
      copyRight: copy.right,
      previewLeft: preview.left,
      previewRight: preview.right,
      previewBottom: preview.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.copyLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.copyRight).toBeLessThanOrEqual(geometry.previewLeft);
  expect(geometry.previewRight).toBeLessThanOrEqual(1440);
  expect(geometry.previewBottom).toBeLessThanOrEqual(geometry.viewportHeight);
});
