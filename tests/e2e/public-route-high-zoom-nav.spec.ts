import { expect, test } from '@playwright/test';

test('keeps the PublicFrame About route compact and navigable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/about/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const frame = page.locator('.public-frame');
  const header = frame.locator('.public-frame__header');
  const footer = frame.locator('.public-frame__footer');
  const main = frame.getByRole('main', { name: 'About Onyx' });
  const toggle = header.locator('.public-frame__menu-toggle');
  const primaryAction = header.getByRole('link', { name: 'Open Onyx', exact: true });

  await expect(page.locator('.public-frame')).toHaveCount(1);
  await expect(frame.locator('header.public-frame__header')).toHaveCount(1);
  await expect(frame.locator('main#public-main')).toHaveCount(1);
  await expect(main).toHaveCount(1);
  await expect(frame.locator('footer.public-frame__footer')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(header.locator('a[href="/about/"]')).toHaveAttribute('aria-current', 'page');

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Open navigation menu');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(primaryAction).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName('Close navigation menu');

  const primary = header.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primary).toBeVisible();
  const primaryNames = (await primary.getByRole('link').allTextContents()).map((name) => name.trim());
  expect(primaryNames).toEqual(['About', 'Download']);
  expect(primaryNames).not.toContain('Stats');
  await expect(primary.getByRole('link', { name: 'Stats' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAccessibleName('Open navigation menu');

  const topics = frame.getByRole('navigation', { name: 'About topics' });
  await topics.scrollIntoViewIfNeeded();
  await expect(topics).toBeVisible();
  await expect(topics.getByRole('link', { name: 'Rooms' })).toHaveAttribute('href', '#rooms');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toBeVisible();

  await primaryAction.scrollIntoViewIfNeeded();
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();

  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const visible = (element: HTMLElement) => element.getClientRects().length > 0;
    const bounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.getAttribute('aria-label') ?? element.textContent ?? '',
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const headerElement = document.querySelector<HTMLElement>('.public-frame__header')!;
    const headerStyle = getComputedStyle(headerElement);
    const toggleElement = document.querySelector<HTMLElement>('.public-frame__menu-toggle')!;
    const primary = document.querySelector<HTMLElement>('.public-frame__open')!;
    const primaryStyle = getComputedStyle(primary);
    const motionSample = [headerElement, toggleElement, primary].map((element) => {
      const style = getComputedStyle(element);
      return {
        transitionDuration: style.transitionDuration,
        animationDuration: style.animationDuration,
      };
    });
    return {
      documentClientWidth: viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      header: bounds(headerElement),
      headerPosition: headerStyle.position,
      mainCount: document.querySelectorAll('main').length,
      skipTargetCount: document.querySelectorAll('main#public-main').length,
      frameCount: document.querySelectorAll('.public-frame').length,
      headerCount: document.querySelectorAll('header.public-frame__header').length,
      footerCount: document.querySelectorAll('footer.public-frame__footer').length,
      toggle: bounds(toggleElement),
      primary: bounds(primary),
      controls: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame__header a, .public-frame__header button, .public-frame__footer a, .ab-topics a',
      )).filter(visible).map(bounds),
      focusOutlineStyle: primaryStyle.outlineStyle,
      focusOutlineWidth: Number.parseFloat(primaryStyle.outlineWidth),
      motionSample,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forcedColors: matchMedia('(forced-colors: active)').matches,
    };
  });

  expect(geometry.frameCount).toBe(1);
  expect(geometry.headerCount).toBe(1);
  expect(geometry.footerCount).toBe(1);
  expect(geometry.mainCount).toBe(1);
  expect(geometry.skipTargetCount).toBe(1);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.header.scrollWidth).toBe(geometry.header.clientWidth);
  expect(geometry.headerPosition).toBe('relative');
  expect(geometry.toggle.width).toBe(44);
  expect(geometry.toggle.height).toBe(44);
  expect(geometry.primary.width).toBeGreaterThanOrEqual(44);
  expect(geometry.primary.height).toBeGreaterThanOrEqual(44);
  expect(geometry.primary.left).toBeGreaterThanOrEqual(0);
  expect(geometry.primary.right).toBeLessThanOrEqual(320);
  expect(geometry.reducedMotion).toBe(true);
  expect(geometry.forcedColors).toBe(true);
  expect(geometry.focusOutlineStyle).not.toBe('none');
  expect(geometry.focusOutlineWidth).toBeGreaterThanOrEqual(2);
  for (const sample of geometry.motionSample) {
    expect(sample.transitionDuration === '0s' || sample.transitionDuration === '0ms').toBe(true);
    expect(sample.animationDuration === '0s' || sample.animationDuration === '0ms').toBe(true);
  }
  for (const control of geometry.controls) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
});
