import { expect, test } from '@playwright/test';

test('contains the landing route at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const primaryAction = page.locator('.r-hero').getByRole('link', { name: /Open Onyx/ });
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();
  await page.locator('.r-footer').scrollIntoViewIfNeeded();

  const geometry = await page.evaluate(() => {
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>(
      '.r-hero, .r-live, .r-community, .r-rooms, .r-join, .r-culture, .r-sovereign, .r-built, .r-footer, .r-live-grid, .r-board, .grid2, .r-strip',
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
    const heroTitle = document.querySelector<HTMLElement>('.r-hero h1')!;
    const cardCopy = document.querySelector<HTMLElement>('.r-card p')!;
    const primary = document.querySelector<HTMLElement>('.r-hero .r-btn.primary')!;
    const primaryStyle = getComputedStyle(primary);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      heroFontSize: Number.parseFloat(getComputedStyle(heroTitle).fontSize),
      cardCopyFontSize: Number.parseFloat(getComputedStyle(cardCopy).fontSize),
      primaryHeight: primary.getBoundingClientRect().height,
      focusOutlineStyle: primaryStyle.outlineStyle,
      focusOutlineWidth: Number.parseFloat(primaryStyle.outlineWidth),
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
  expect(geometry.cardCopyFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.cardCopyFontSize).toBeLessThanOrEqual(24);
  expect(geometry.primaryHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.primaryHeight).toBeLessThanOrEqual(60);
  expect(geometry.focusOutlineStyle).not.toBe('none');
  expect(geometry.focusOutlineWidth).toBeGreaterThanOrEqual(2);
});
