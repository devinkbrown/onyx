// SPDX-License-Identifier: AGPL-3.0-or-later
// Keyboard-only journey: connect gate → join a room → send → open inbox →
// jump to a mention → open You → Appearance. Focus must be visible at every
// stop and restored to the opener after every dialog.
import { expect, test } from '@playwright/test';
import { boot, collect, focused, isPhone, settle, waitLive } from './elm-audit-support';

async function tabUntil(page: import('@playwright/test').Page, predicate: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 60, key = 'Tab') {
  for (let i = 0; i < max; i += 1) {
    const f = await focused(page);
    if (predicate(f)) return f;
    await page.keyboard.press(key);
  }
  return null;
}

test('AUD-KEY-1 keyboard-only: gate → room → send → inbox → mention → You → Appearance, focus visible and restored', async ({ page }, info) => {
  const logs = collect(page);
  const wire = await boot(page, '', { noAutoJoin: true });
  await expect(page.getByTestId('connect-status')).toContainText(/Connected|ready/i, { timeout: 15_000 });

  // Gate: Tab reaches the name field first, then room, then Join.
  await page.keyboard.press('Tab');
  let f = await focused(page);
  expect.soft(f.path, 'first Tab lands in the gate (not browser chrome / hidden nodes)').toContain('connect-name');
  expect.soft(f.ring, 'focus ring on name field').toBeTruthy();
  await page.keyboard.type('kai');
  await page.keyboard.press('Tab');
  await page.keyboard.type('#root');
  await page.keyboard.press('Enter');
  await expect(page.locator('.onyx-thread-pane')).toHaveAttribute('data-conversation', '#root', { timeout: 15_000 });
  await expect(page.getByText('Voice call at six, I will set it up.', { exact: true })).toBeVisible();

  // After the gate closes, focus must be somewhere meaningful (composer or heading), not body.
  f = await focused(page);
  expect.soft(f.tag, 'focus is placed after the gate closes').not.toBe('body');

  // Reach the composer by keyboard and send.
  const composer = await tabUntil(page, x => x.path.includes('onyx-composer') && (x.tag === 'textarea' || x.tag === 'input'));
  expect(composer, 'composer reachable by Tab').not.toBeNull();
  expect.soft(composer?.ring, 'composer has a visible focus style').toBeTruthy();
  await page.keyboard.type('hello from the keyboard');
  await page.keyboard.press('Enter');
  await expect.poll(() => wire.sent.some(l => l.startsWith('PRIVMSG #root :hello from the keyboard'))).toBeTruthy();

  // Inbox: open, Escape, focus returns to the bell.
  const bell = page.getByTestId('inbox-bell');
  await bell.focus();
  await page.keyboard.press('Enter');
  const inbox = page.getByRole('dialog', { name: 'Notification inbox' });
  await expect(inbox).toBeVisible();
  f = await focused(page);
  expect.soft(await inbox.evaluate((el, path) => el.contains(document.activeElement), f.path), 'focus moves into the inbox').toBeTruthy();
  // Jump to a mention through the inbox row.
  const mentionRow = inbox.getByRole('button', { name: /Open notification from #root/ }).first();
  if (await mentionRow.count()) {
    await mentionRow.focus();
    await page.keyboard.press('Enter');
    await expect(inbox).toBeHidden();
    f = await focused(page);
    expect.soft(f.path, 'focus lands on the mentioned message row').toContain('onyx-message');
  } else {
    test.info().annotations.push({ type: 'note', description: 'no mention row in inbox (see AUD-INBOX findings)' });
    await page.keyboard.press('Escape');
    await expect(inbox).toBeHidden();
    await expect(bell).toBeFocused();
  }

  // You dialog: open via nav button, Escape, focus returns.
  const you = page.locator(isPhone(info) ? '.onyx-mobile-nav' : '.onyx-primary-nav').getByTestId('nav-you').locator('visible=true');
  await you.focus();
  f = await focused(page);
  expect.soft(f.ring, 'nav You button has a visible focus ring').toBeTruthy();
  await page.keyboard.press('Enter');
  const youDialog = page.getByRole('dialog', { name: 'You', exact: true });
  await expect(youDialog).toBeFocused();
  await page.keyboard.press('Tab');
  f = await focused(page);
  expect.soft(await youDialog.evaluate(el => el.contains(document.activeElement)), 'Tab stays inside You dialog').toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(youDialog).toBeHidden();
  await expect(you).toBeFocused();

  // Appearance via You → link, keyboard only.
  await page.keyboard.press('Enter');
  await expect(youDialog).toBeVisible();
  const appearance = youDialog.getByTestId('you-appearance');
  await appearance.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/appearance/);
  await settle(page, 500);
  f = await focused(page);
  expect.soft(f.tag, 'focus is managed on route change (heading or main)').not.toBe('body');
  await page.keyboard.press('Tab');
  f = await focused(page);
  expect.soft(f.ring, 'visible focus on appearance page').toBeTruthy();
  expect.soft(logs.errors).toEqual([]);
});

test('AUD-KEY-2 Escape closes every sheet and returns focus to its opener', async ({ page }) => {
  await boot(page);
  await waitLive(page);
  const openers: Array<[string, () => import('@playwright/test').Locator, RegExp | string]> = [
    ['connection', () => page.getByTestId('connection-open'), 'Your connection'],
    ['you', () => page.getByTestId('nav-you').locator('visible=true').first(), 'You'],
  ];
  for (const [name, opener, dialogName] of openers) {
    const el = opener();
    await el.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    await expect(dialog, `${name} dialog opens`).toBeVisible();
    await expect.soft(dialog, `${name} dialog is modal`).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog, `${name} closes on Escape`).toBeHidden();
    await expect(el, `${name} opener regains focus`).toBeFocused();
  }
});

test('AUD-KEY-3 message rows and the message menu are keyboard operable', async ({ page }) => {
  const wire = await boot(page);
  await waitLive(page);
  await page.getByTestId('nav-rooms').locator('visible=true').click().catch(() => {});
  await page.locator('#client-rooms button[title="#root"]').click();
  await expect(page.getByText('Voice call at six, I will set it up.', { exact: true })).toBeVisible();
  const trigger = page.locator('.onyx-msg-menu-trigger').nth(3);
  await trigger.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " onyx-message ")][1]').scrollIntoViewIfNeeded();
  await trigger.focus();
  const before = await focused(page);
  expect.soft(before.ring, 'menu trigger shows focus').toBeTruthy();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const inside = await menu.evaluate(el => el.contains(document.activeElement));
  expect.soft(inside, 'focus moves into the menu when opened by keyboard').toBeTruthy();
  await page.keyboard.press('ArrowDown');
  const afterArrow = await menu.evaluate(el => el.contains(document.activeElement) && document.activeElement?.getAttribute('role') === 'menuitem');
  expect.soft(afterArrow, 'ArrowDown moves between menu items').toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect.soft(trigger, 'Escape returns focus to the trigger').toBeFocused();
  expect(wire.sent.length).toBeGreaterThan(0);
});
