import { expect, test } from '@playwright/test';

test('contains the About route body at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/about/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const accessibility = page.locator('#accessibility');
  await accessibility.scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Accessibility statement' })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const selectors = [
      '.ab-hero',
      '.ab-proto-grid',
      '.ab-cap-list',
      '.ab-media-header',
      '.ab-e2ee-split',
      '.ab-mesh-body',
      '.ab-svc-grid',
      '.ab-mythos-grid',
      '.ab-dev-grid',
      '.ab-a11y',
      '.r-footer',
    ];
    const surfaces = selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return {
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
      };
    });
    const heroTitle = document.querySelector<HTMLElement>('.ab-hero h1')!;
    const cardCopy = document.querySelector<HTMLElement>('.ab-proto-item p')!;
    const statementTitle = document.querySelector<HTMLElement>('.a11y-header h2')!;
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      surfaces,
      heroFontSize: Number.parseFloat(getComputedStyle(heroTitle).fontSize),
      cardCopyFontSize: Number.parseFloat(getComputedStyle(cardCopy).fontSize),
      statementTitleFontSize: Number.parseFloat(getComputedStyle(statementTitle).fontSize),
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  for (const surface of geometry.surfaces) {
    expect(surface.scrollWidth, surface.selector).toBe(surface.clientWidth);
    expect(surface.left, surface.selector).toBeGreaterThanOrEqual(0);
    expect(surface.right, surface.selector).toBeLessThanOrEqual(320);
  }
  expect(geometry.heroFontSize).toBeLessThanOrEqual(64);
  expect(geometry.cardCopyFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.cardCopyFontSize).toBeLessThanOrEqual(24);
  expect(geometry.statementTitleFontSize).toBeLessThanOrEqual(48);
});
