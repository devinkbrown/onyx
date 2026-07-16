import { expect, test } from '@playwright/test';

test('keeps the public route header compact and navigable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/about/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const header = page.locator('.r-status');
  const nav = page.getByRole('navigation', { name: 'About page navigation' });
  const accessibility = nav.getByRole('link', { name: 'Accessibility', exact: true });
  const enter = nav.getByRole('link', { name: 'Open Onyx', exact: true });

  await expect(header).toBeVisible();
  await accessibility.scrollIntoViewIfNeeded();
  await accessibility.focus();
  await expect(accessibility).toBeFocused();
  await enter.scrollIntoViewIfNeeded();
  await enter.focus();
  await expect(enter).toBeFocused();

  const geometry = await header.evaluate((element) => {
    const headerRect = element.getBoundingClientRect();
    const navElement = element.querySelector<HTMLElement>('nav')!;
    const navRect = navElement.getBoundingClientRect();
    const enterElement = navElement.querySelector<HTMLElement>('.enter')!;
    const enterRect = enterElement.getBoundingClientRect();
    const focusedStyle = getComputedStyle(enterElement);
    return {
      headerClientWidth: element.clientWidth,
      headerScrollWidth: element.scrollWidth,
      headerHeight: headerRect.height,
      navClientWidth: navElement.clientWidth,
      navScrollWidth: navElement.scrollWidth,
      navLeft: navRect.left,
      navRight: navRect.right,
      enterLeft: enterRect.left,
      enterRight: enterRect.right,
      enterHeight: enterRect.height,
      focusOutlineStyle: focusedStyle.outlineStyle,
      focusOutlineWidth: focusedStyle.outlineWidth,
    };
  });

  expect(geometry.headerScrollWidth).toBe(geometry.headerClientWidth);
  expect(geometry.headerHeight).toBeLessThanOrEqual(72);
  expect(geometry.navScrollWidth).toBeGreaterThan(geometry.navClientWidth);
  expect(geometry.enterLeft).toBeGreaterThanOrEqual(geometry.navLeft - 1);
  expect(geometry.enterRight).toBeLessThanOrEqual(geometry.navRight + 1);
  expect(geometry.enterHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.enterHeight).toBeLessThanOrEqual(60);
  expect(geometry.focusOutlineStyle).not.toBe('none');
  expect(Number.parseFloat(geometry.focusOutlineWidth)).toBeGreaterThanOrEqual(2);
});
