import { expect, test } from '@playwright/test';

test('keeps the PublicFrame About route usable at 400% zoom', async ({ page }) => {
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
  const skip = frame.getByRole('link', { name: 'Skip to content' });
  const toggle = header.locator('.public-frame__menu-toggle');

  await expect(frame.locator('main#public-main')).toHaveCount(1);
  await expect(frame.locator('header.public-frame__header')).toHaveCount(1);
  await expect(frame.locator('footer.public-frame__footer')).toHaveCount(1);
  await expect(header.locator('a[href="/about/"]')).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('heading', { level: 1, name: /rooms for people you already like/i })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#public-main$/u);
  await expect(main).toBeFocused();

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Open navigation menu');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  const topics = frame.getByRole('navigation', { name: 'About topics' });
  await topics.scrollIntoViewIfNeeded();
  await expect(topics.getByRole('link', { name: 'Rooms' })).toHaveAttribute('href', '#rooms');
  await expect(topics.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '#join');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const bounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.getAttribute('aria-label') ?? element.textContent ?? '',
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    };
    const visible = (element: HTMLElement) => element.getClientRects().length > 0;
    const toggleElement = document.querySelector<HTMLElement>('.public-frame__menu-toggle')!;
    return {
      documentClientWidth: viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main').length,
      skipTargetCount: document.querySelectorAll('main#public-main').length,
      toggle: bounds(toggleElement),
      controls: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame__header a, .public-frame__header button, .public-frame__footer a, .ab-topics a, .ab-cta a',
      )).filter(visible).map(bounds),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forcedColors: matchMedia('(forced-colors: active)').matches,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.mainCount).toBe(1);
  expect(geometry.skipTargetCount).toBe(1);
  expect(geometry.toggle.width).toBe(44);
  expect(geometry.toggle.height).toBe(44);
  expect(geometry.reducedMotion).toBe(true);
  expect(geometry.forcedColors).toBe(true);
  for (const control of geometry.controls) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
});
