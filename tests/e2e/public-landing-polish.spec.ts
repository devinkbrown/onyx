import { expect, test } from '@playwright/test';

for (const viewport of [
  { label: '320px phone', width: 320, height: 720 },
  { label: '390px phone', width: 390, height: 844 },
] as const) {
  test(`${viewport.label}: contains the product aperture and primary path without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const primary = page.locator('.public-frame__open');
    const aperture = page.locator('[data-home-aperture]');
    const current = page.locator('[data-home-current]');
    const evidence = page.locator('[data-home-evidence]');
    await expect(primary).toBeVisible();
    await expect(aperture).toBeVisible();
    await expect(aperture.getByText('Preview').first()).toBeVisible();
    await expect(evidence).toBeVisible();
    await expect(current.locator('li')).toHaveCount(4);

    const geometry = await page.evaluate(() => {
      const cta = document.querySelector<HTMLElement>('.public-frame__open')!;
      const aperture = document.querySelector<HTMLElement>('[data-home-aperture]')!;
      const evidence = document.querySelector<HTMLElement>('[data-home-evidence]')!;
      const ctaRect = cta.getBoundingClientRect();
      const apertureRect = aperture.getBoundingClientRect();
      const evidenceRect = evidence.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        ctaLeft: ctaRect.left,
        ctaRight: ctaRect.right,
        ctaHeight: ctaRect.height,
        apertureLeft: apertureRect.left,
        apertureRight: apertureRect.right,
        evidenceLeft: evidenceRect.left,
        evidenceRight: evidenceRect.right,
      };
    });

    expect(geometry.scrollWidth).toBe(geometry.clientWidth);
    expect(geometry.ctaLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.ctaRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.ctaHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.apertureLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.apertureRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.evidenceLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.evidenceRight).toBeLessThanOrEqual(viewport.width);
  });
}

test('desktop keeps the promise and product aperture in a balanced first view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const geometry = await page.evaluate(() => {
    const copy = document.querySelector<HTMLElement>('.home-hero-copy')!.getBoundingClientRect();
    const aperture = document.querySelector<HTMLElement>('[data-home-aperture]')!.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      copyLeft: copy.left,
      copyRight: copy.right,
      apertureLeft: aperture.left,
      apertureRight: aperture.right,
      apertureBottom: aperture.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.copyLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.copyRight).toBeLessThanOrEqual(geometry.apertureLeft);
  expect(geometry.apertureRight).toBeLessThanOrEqual(1440);
  expect(geometry.apertureBottom).toBeLessThanOrEqual(geometry.viewportHeight);
});
