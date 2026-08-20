import { expect, test } from '@playwright/test';

test('contains the migrated PublicFrame landing route at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const frame = page.locator('.public-frame');
  const header = frame.locator('.public-frame__header');
  const footer = frame.locator('.public-frame__footer');
  const main = frame.getByRole('main', { name: 'Onyx home' });
  const skip = frame.getByRole('link', { name: 'Skip to content' });
  const primaryAction = header.getByRole('link', { name: 'Open Onyx', exact: true });
  const menuToggle = header.locator('.public-frame__menu-toggle');
  const footerNavigation = footer.getByRole('navigation', { name: 'Footer navigation' });

  await expect(main).toHaveCount(1);
  await expect(frame.locator('main#public-main')).toHaveCount(1);
  await expect(skip).toHaveAttribute('href', '#public-main');
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#public-main$/u);
  await expect(main).toBeFocused();
  await expect(primaryAction).toBeVisible();
  await expect(menuToggle).toBeVisible();
  await expect(menuToggle).toHaveAccessibleName('Open navigation menu');
  await primaryAction.scrollIntoViewIfNeeded();
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menuToggle).toBeFocused();
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();
  await footer.scrollIntoViewIfNeeded();
  await expect(footerNavigation).toBeVisible();

  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const geometryFor = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return {
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const primary = document.querySelector<HTMLElement>('.public-frame__open')!;
    const primaryStyle = getComputedStyle(primary);
    const headerStyle = getComputedStyle(document.querySelector<HTMLElement>('.public-frame__header')!);
    return {
      documentClientWidth: viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main').length,
      skipTargetCount: document.querySelectorAll('main#public-main').length,
      headerPosition: headerStyle.position,
      primary: geometryFor('.public-frame__open'),
      menuToggle: geometryFor('.public-frame__menu-toggle'),
      footer: geometryFor('.public-frame__footer'),
      headerControls: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame__header a, .public-frame__header button',
      )).filter((element) => element.getClientRects().length > 0).map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.getAttribute('aria-label') ?? element.textContent ?? '', left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
      footerLinks: Array.from(document.querySelectorAll<HTMLElement>('.public-frame__footer a'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent ?? '', left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }),
      overflowContributors: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: element.className,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        })
        .filter((entry) => entry.left < -0.5 || entry.right > viewportWidth + 0.5)
        .sort((left, right) => Math.max(right.right - viewportWidth, right.scrollWidth - right.clientWidth)
          - Math.max(left.right - viewportWidth, left.scrollWidth - left.clientWidth))
        .slice(0, 20),
      focusOutlineStyle: primaryStyle.outlineStyle,
      focusOutlineWidth: Number.parseFloat(primaryStyle.outlineWidth),
    };
  });

  expect(geometry.documentScrollWidth, JSON.stringify(geometry.overflowContributors, null, 2))
    .toBe(geometry.documentClientWidth);
  expect(geometry.overflowContributors).toEqual([]);
  expect(geometry.mainCount).toBe(1);
  expect(geometry.skipTargetCount).toBe(1);
  expect(geometry.headerPosition).not.toBe('sticky');
  expect(geometry.headerPosition).not.toBe('fixed');
  expect(geometry.menuToggle.width).toBe(44);
  expect(geometry.menuToggle.height).toBe(44);
  for (const control of geometry.headerControls) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.footer.left).toBeGreaterThanOrEqual(0);
  expect(geometry.footer.right).toBeLessThanOrEqual(320);
  expect(geometry.footer.scrollWidth).toBe(geometry.footer.clientWidth);
  for (const link of geometry.footerLinks) {
    expect(link.left, link.text).toBeGreaterThanOrEqual(0);
    expect(link.right, link.text).toBeLessThanOrEqual(320);
    expect(link.width, link.text).toBeGreaterThan(0);
    expect(link.height, link.text).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.focusOutlineStyle).not.toBe('none');
  expect(geometry.focusOutlineWidth).toBeGreaterThanOrEqual(2);
});
