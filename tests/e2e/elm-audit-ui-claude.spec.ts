// SPDX-License-Identifier: AGPL-3.0-or-later
// UI audit, conversation surface (Claude lane): inline media sizing, the
// transcript list structure, the incoming-message live region and the
// forced-colors focus ring in the message menu.
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openMessageMenu, openRoot, type Wire } from './elm-audit-support';

const pushRoomLine = (wire: Wire, from: string, body: string, msgid: string) =>
  wire.push(`@time=${new Date().toISOString()};msgid=${msgid} :${from}!${from.slice(0, 4)}@onyx.test PRIVMSG #root :${body}`);

async function postBigImage(page: Page, wire: Wire) {
  const url = new URL('/marketing/dm-phone-2x.jpg', page.url()).href;
  pushRoomLine(wire, 'nova', `[file: big.jpg] 120 KB ${url}`, 'ui-claude-big-image');
  const img = page.locator('.onyx-message .shell-msg-media-img').last();
  await expect(img).toBeVisible({ timeout: 10_000 });
  await img.evaluate(el => (el as HTMLImageElement).decode().catch(() => undefined));
  return img;
}

test('inline message images never grow wider than the thread at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const wire = await openRoot(page);
  const img = await postBigImage(page, wire);
  await img.scrollIntoViewIfNeeded();
  const geometry = await img.evaluate(el => {
    const pane = el.closest('.onyx-thread-pane')!.getBoundingClientRect();
    const row = el.closest('.onyx-message')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height, paneLeft: pane.left, paneRight: pane.right, rowRight: row.right, natural: (el as HTMLImageElement).naturalWidth, docWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.natural, 'the fixture image is larger than a phone').toBeGreaterThan(320);
  expect(geometry.width, 'image is laid out (not collapsed)').toBeGreaterThan(40);
  expect(geometry.right, 'image stays inside the thread pane').toBeLessThanOrEqual(geometry.paneRight + 0.5);
  expect(geometry.right, 'image stays inside its message row').toBeLessThanOrEqual(geometry.rowRight + 0.5);
  expect(geometry.left, 'image starts inside the thread pane').toBeGreaterThanOrEqual(geometry.paneLeft - 0.5);
  expect(geometry.height, 'image is capped in height').toBeLessThanOrEqual(421);
  expect(geometry.docWidth, 'no horizontal page scroll').toBeLessThanOrEqual(320);
  await expect(page.getByRole('button', { name: 'Open image big.jpg' }).last()).toBeVisible();
});

test('inline message images stay inside the row on desktop and phone projects', async ({ page }) => {
  const wire = await openRoot(page);
  const img = await postBigImage(page, wire);
  await img.scrollIntoViewIfNeeded();
  const fits = await img.evaluate(el => {
    const row = el.closest('.onyx-message')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.right <= row.right + 0.5 && r.height <= 421;
  });
  expect(fits, 'image fits its row and the height cap').toBeTruthy();
});

test('every direct child of the transcript list is an li', async ({ page }) => {
  await openRoot(page);
  const tags = await page.locator('ul.onyx-thread').first().evaluate(ul => Array.from(ul.children).map(el => el.tagName));
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.filter(tag => tag !== 'LI'), 'non-li children of the transcript list').toEqual([]);
  await expect(page.locator('.onyx-typing[role="status"]'), 'typing status is always mounted').toHaveCount(1);
});

test('a new message from someone else lands in the polite live region; own echoes do not', async ({ page }) => {
  const wire = await openRoot(page);
  const announcer = page.getByTestId('incoming-announcer');
  await expect(announcer).toHaveAttribute('aria-live', 'polite');
  pushRoomLine(wire, 'nova', 'fresh news for the room', 'ui-claude-live-1');
  await expect(announcer).toHaveText('nova: fresh news for the room');
  pushRoomLine(wire, 'kai', 'my own echo', 'ui-claude-live-2');
  await expect(page.locator('.onyx-body', { hasText: 'my own echo' })).toBeVisible();
  await expect(announcer).toHaveText('');
});

test('message menu items keep a visible outline focus ring in forced colors', async ({ page }, info) => {
  test.skip(isPhone(info), 'keyboard focus ring (desktop)');
  await page.emulateMedia({ forcedColors: 'active' });
  await openRoot(page);
  await openMessageMenu(page, 3);
  const menu = page.getByRole('menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const style = getComputedStyle(el);
    return { role: el.getAttribute('role'), inMenu: !!el.closest('[role="menu"]'), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
  });
  await expect(menu).toBeVisible();
  expect(ring?.inMenu, 'focus is inside the menu').toBeTruthy();
  expect(ring?.role).toBe('menuitem');
  expect(ring?.outlineStyle, 'outline survives forced colors').not.toBe('none');
  expect(ring?.outlineWidth ?? 0).toBeGreaterThanOrEqual(2);
});
