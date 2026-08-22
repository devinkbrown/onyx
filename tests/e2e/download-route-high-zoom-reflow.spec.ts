import { expect, test } from '@playwright/test';

test('keeps the PublicFrame Download route usable at 400% zoom', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/download/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });

  const frame = page.locator('.public-frame');
  const header = frame.locator('.public-frame__header');
  const footer = frame.locator('.public-frame__footer');
  const main = frame.getByRole('main', { name: 'Get Onyx' });
  const skip = frame.getByRole('link', { name: 'Skip to content' });
  const menuToggle = header.locator('.public-frame__menu-toggle');
  const primaryAction = header.getByRole('link', { name: 'Open Onyx', exact: true });

  await expect(frame.locator('main#public-main')).toHaveCount(1);
  await expect(frame.locator('header.public-frame__header')).toHaveCount(1);
  await expect(frame.locator('footer.public-frame__footer')).toHaveCount(1);
  await expect(header.locator('a[href="/download/"]')).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('heading', { name: /Get Onyx on this device/i })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'What this is — and is not' })).toBeVisible();
  await expect(main.getByTestId('dl-card-windows')).toBeVisible();
  await expect(main.getByTestId('dl-card-macos')).toHaveAttribute('data-state', 'coming-soon');
  await expect(main.getByText(/Download DMG/i)).toHaveCount(0);

  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#public-main$/u);
  await expect(main).toBeFocused();

  await expect(primaryAction).toBeVisible();
  await expect(menuToggle).toBeVisible();
  await expect(menuToggle).toHaveAccessibleName('Open navigation menu');
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menuToggle).toHaveAccessibleName('Close navigation menu');
  await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menuToggle).toBeFocused();

  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toBeVisible();
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
    const primary = document.querySelector<HTMLElement>('.public-frame__open')!;
    const primaryStyle = getComputedStyle(primary);
    const headerStyle = getComputedStyle(document.querySelector<HTMLElement>('.public-frame__header')!);
    return {
      documentClientWidth: viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main').length,
      skipTargetCount: document.querySelectorAll('main#public-main').length,
      headerPosition: headerStyle.position,
      menuToggle: bounds(document.querySelector<HTMLElement>('.public-frame__menu-toggle')!),
      controls: Array.from(document.querySelectorAll<HTMLElement>(
        '.public-frame__header a, .public-frame__header button, .public-frame__footer a',
      )).filter(visible).map(bounds),
      routeActions: Array.from(document.querySelectorAll<HTMLElement>(
        '.dl-page .dl-actions .r-btn, .dl-page .dl-copy',
      )).filter(visible).map(bounds),
      overflowContributors: Array.from(document.querySelectorAll<HTMLElement>('.public-frame *'))
        .filter(visible)
        .map((element) => ({ tag: element.tagName, className: element.className, ...bounds(element) }))
        .filter((entry) => entry.left < -0.5 || entry.right > viewportWidth + 0.5 || entry.scrollWidth > entry.clientWidth + 1)
        .sort((left, right) => Math.max(right.right - viewportWidth, right.scrollWidth - right.clientWidth)
          - Math.max(left.right - viewportWidth, left.scrollWidth - left.clientWidth))
        .slice(0, 20),
      focusOutlineStyle: primaryStyle.outlineStyle,
      focusOutlineWidth: Number.parseFloat(primaryStyle.outlineWidth),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forcedColors: matchMedia('(forced-colors: active)').matches,
    };
  });

  expect(geometry.documentScrollWidth, JSON.stringify(geometry.overflowContributors, null, 2))
    .toBe(geometry.documentClientWidth);
  expect(geometry.mainCount).toBe(1);
  expect(geometry.skipTargetCount).toBe(1);
  expect(geometry.headerPosition).not.toBe('sticky');
  expect(geometry.headerPosition).not.toBe('fixed');
  expect(geometry.menuToggle.width).toBe(44);
  expect(geometry.menuToggle.height).toBe(44);
  expect(geometry.reducedMotion).toBe(true);
  expect(geometry.forcedColors).toBe(true);
  for (const control of geometry.controls) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
  for (const control of geometry.routeActions) {
    expect(control.left, control.text).toBeGreaterThanOrEqual(0);
    expect(control.right, control.text).toBeLessThanOrEqual(320);
    expect(control.width, control.text).toBeGreaterThanOrEqual(44);
    expect(control.height, control.text).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.focusOutlineStyle).not.toBe('none');
  expect(geometry.focusOutlineWidth).toBeGreaterThanOrEqual(2);

  const copyAction = main.locator('.dl-copy').first();
  await copyAction.scrollIntoViewIfNeeded();
  await copyAction.focus();
  await expect(copyAction).toBeFocused();
  const copyFocus = await copyAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
    };
  });
  expect(copyFocus.outlineStyle).not.toBe('none');
  expect(copyFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(copyFocus.outlineOffset).toBeGreaterThanOrEqual(2);
});

test('keeps the /install/ alias on the same PublicFrame download surface', async ({ page }) => {
  await page.goto('/install/');

  await expect(page).toHaveTitle(/Get Onyx on this device/);
  await expect(page.getByRole('main', { name: 'Get Onyx' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Get Onyx on this device' })).toBeVisible();
  await expect(page.locator('.public-frame__header a[href="/download/"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('dl-card-linux')).toBeVisible();
  await expect(page.getByTestId('dl-install-linux')).toContainText('install.sh');
});
