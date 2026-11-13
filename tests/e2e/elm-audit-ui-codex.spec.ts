// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { boot, openRoom, openRoot, waitLive } from './elm-audit-support';

for (const route of ['/', '/about/', '/stats/']) {
  test(`public skip link transfers focus on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
    await expect(page.locator('#site-main')).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#site-main')).toBeFocused();
  });
}

test('shell skip link transfers focus into main', async ({ page }) => {
  await boot(page);
  await waitLive(page);
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#onyx-main')).toBeFocused();
});

for (const width of [390, 1280]) {
  test(`app destinations have exactly one accessible h1 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openRoot(page);
    // The open conversation is where the brand used to be display:none.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    for (const destination of ['home', 'rooms', 'messages', 'calls']) {
      await page.getByTestId(`nav-${destination}`).locator('visible=true').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      if (destination === 'home' && width === 390) await expect(page.locator('.onyx-topbar .onyx-gem').first()).toBeVisible();
    }
    await openRoom(page, '#root');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}

test('brand gem and wordmark stay visible in the 48-60rem band', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openRoot(page);
  await expect(page.locator('.onyx-topbar > .onyx-brand')).toBeVisible();
  const box = await page.locator('.onyx-topbar > .onyx-brand').boundingBox();
  expect(box!.width).toBeGreaterThan(1);
});

test('desktop rail labels are not clipped by the rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await waitLive(page);
  await page.locator('.onyx-primary-nav [data-testid="nav-rooms"]').first().hover();
  const label = page.locator('.onyx-primary-nav [data-testid="nav-rooms"] .onyx-nav-label').first();
  await expect(label).toHaveCSS('opacity', '1');
  const clipped = await label.evaluate(element => {
    const rail = element.closest('.onyx-primary-nav')!;
    const style = getComputedStyle(rail);
    return style.overflowX !== 'visible' || style.overflowY !== 'visible';
  });
  expect(clipped).toBe(false);
  const box = await label.boundingBox();
  expect(box!.width).toBeGreaterThan(1);
});

test('forced-colors active destination icon uses a system color, not the accent', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ forcedColors: 'active' });
  await boot(page);
  await waitLive(page);
  const [active, highlight] = await page.locator('.onyx-primary-nav .onyx-nav-btn--active .onyx-nav-icon').first().evaluate(element => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'Highlight';
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(element).backgroundColor, value];
  });
  expect(active).toBe(highlight);
});

test('back/forward does not move focus to the page main', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about/');
  await page.locator('.site-foot').getByRole('link', { name: 'Download', exact: true }).click();
  await expect(page.locator('#site-main')).toBeFocused();
  await page.locator('body').evaluate(element => (element as HTMLElement).focus());
  await page.goBack();
  await expect(page.getByTestId('route-announcer')).toHaveText('Rooms for people you already like.');
  await expect(page.locator('#site-main')).not.toBeFocused();
});

test('forced-colors preserves masked navigation icons and active borders', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ forcedColors: 'active' });
  await boot(page);
  await waitLive(page);
  const colors = await page.locator('.onyx-primary-nav .onyx-nav-icon').first().evaluate(element => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'Canvas';
    document.body.append(probe);
    const canvas = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, canvas, adjust: style.forcedColorAdjust };
  });
  expect(colors.background).not.toBe(colors.canvas);
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors.adjust).toBe('none');
  await expect(page.locator('.onyx-primary-nav .onyx-nav-btn--active')).toHaveCSS('border-top-width', '2px');
});

test('public SPA navigation focuses main, resets scroll and updates the persistent announcer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about/');
  const announcer = page.getByTestId('route-announcer');
  await expect(announcer).toHaveText('Rooms for people you already like.');
  await announcer.evaluate(element => element.setAttribute('data-persisted', 'yes'));
  await page.locator('.site-foot').getByRole('link', { name: 'Download', exact: true }).click();
  await expect(page.locator('#site-main')).toBeFocused();
  await expect(announcer).toHaveText('Get Onyx on this device');
  await expect(announcer).toHaveAttribute('data-persisted', 'yes');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.locator('.site-brand').first().click();
  await expect(announcer).toHaveText('Rooms, DMs, and calls for your people.');
  await expect(announcer).toHaveAttribute('data-persisted', 'yes');
});

test('Landing mobile menu closes with Escape and restores its toggle', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Navigation menu', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#public-primary-navigation a').first().focus();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('About and Stats section links focus their destinations', async ({ page }) => {
  for (const [route, fragment] of [['/about/', 'rooms'], ['/stats/', 'network-overview']]) {
    await page.goto(route!);
    await page.locator(`a[href="#${fragment}"]`).first().click();
    await expect(page.locator(`#${fragment}`)).toBeFocused();
  }
});

test('320px conversation retains a readable title and wrapped filters', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openRoot(page);
  await expect(page.getByTestId('connection-open')).toHaveAccessibleName('Connected, connection settings');
  const title = page.getByTestId('page-title');
  await expect(title).toHaveText('#root');
  expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByTestId('room-back').click();
  await expect(page.locator('.onyx-rail-filters')).toHaveCSS('flex-wrap', 'wrap');
});
