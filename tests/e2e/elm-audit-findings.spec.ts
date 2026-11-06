// SPDX-License-Identifier: AGPL-3.0-or-later
// One test per audit finding (ids match fable-audit/REPORT.md). Each asserts
// the CORRECT behaviour, so it fails on 254190c2 and passes once fixed.
// Tests tagged [guard] pass today and protect behaviour the fix pass must keep.
import { expect, test, type Page } from '@playwright/test';
import { audit, boot, collect, focused, isPhone, openComposerTray, openMessageMenu, openRoom, openRoomTool, openRooms, openRoot, sendMessage, settle, viewportWidth, waitLive } from './elm-audit-support';

const box = (page: Page, selector: string) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
const bg = (page: Page, selector: string) => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor);
const ACCENT = /rgb\(232,\s*163,\s*61\)/; // --onyx-accent #e8a33d

// ---------------------------------------------------------------- P0

test('P0-1 /appearance is a styled settings page with 44px chips and a visible selected state', async ({ page }, info) => {
  await page.goto('/appearance/');
  await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
  const main = page.locator('main.ap');
  await expect(main).toBeVisible();
  const pad = await page.locator('.ap-h1').evaluate(el => el.getBoundingClientRect().left);
  expect.soft(pad, 'page has a side gutter (heading not flush to x=0)').toBeGreaterThanOrEqual(12);
  const chip = page.getByRole('radio', { name: 'Medium', exact: true });
  const r = await chip.boundingBox();
  expect.soft(r!.height, 'text-size chips are touch targets').toBeGreaterThanOrEqual(isPhone(info) ? 44 : 32);
  const pressed = await chip.getAttribute('aria-checked');
  expect.soft(pressed, 'selected chip exposes its checked state').toBe('true');
  const [onBg, offBg] = await Promise.all([bg(page, 'button.ap-chip.on'), page.locator('button.ap-chip:not(.on)').first().evaluate(el => getComputedStyle(el).backgroundColor)]);
  expect.soft(onBg, 'selected chip looks different from unselected').not.toBe(offBg);
  const back = page.getByRole('link', { name: /back to app/i });
  const rb = await back.boundingBox();
  expect.soft(rb!.height, 'back link is a 44px target').toBeGreaterThanOrEqual(isPhone(info) ? 44 : 24);
  const report = await audit(page, isPhone(info));
  expect.soft(report.landmarks.h1, 'one h1').toBe(1);
  expect.soft(report.a11y.filter(a => a.startsWith('input-without-label'))).toEqual([]);
  // No stray "This device" fragment glued to the lede.
  await expect.soft(page.getByText(/This device Your account/)).toHaveCount(0);
});

test('P0-2 server notices are not filed as a direct message with yourself', async ({ page }) => {
  await boot(page);
  await waitLive(page);
  await page.getByTestId('nav-messages').locator('visible=true').click();
  await openRooms(page);
  await expect(page.locator('#client-rooms button[title="kai"]'), 'no DM conversation named after our own nick').toHaveCount(0);
  await page.getByTestId('nav-home').locator('visible=true').click();
  await expect(page.locator('.onyx-home-row', { hasText: /^kai/ }), 'Needs you never lists yourself').toHaveCount(0);
  // Server notices live somewhere calm (a server/system conversation or the inbox "Other" filter), not as mentions.
  await page.getByTestId('inbox-bell').click();
  await page.getByRole('button', { name: /Needs you/ }).click();
  await expect(page.getByRole('dialog', { name: 'Notification inbox' }).getByText(/connecting from|CHACHA20|mesh: 2 nodes/)).toHaveCount(0);
});

test('P0-3 inbox rows read as sentences with separate kind, context and text, and protocol errors are not notifications', async ({ page }) => {
  await openRoot(page);
  await page.getByTestId('inbox-bell').click();
  const inbox = page.getByRole('dialog', { name: 'Notification inbox' });
  await expect(inbox).toBeVisible();
  await expect.soft(inbox, 'inbox dialog is modal').toHaveAttribute('aria-modal', 'true');
  const row = inbox.getByTestId('inbox-row').filter({ hasText: /call later/ }).first();
  await expect(row).toBeVisible();
  // The parts have CSS: kind/context/text are visually separated (not one run-on line).
  const gaps = await row.evaluate(el => {
    const kind = el.querySelector('.notif-center__kind')!.getBoundingClientRect();
    const context = el.querySelector('.notif-center__context')!.getBoundingClientRect();
    const text = el.querySelector('.notif-center__text')!.getBoundingClientRect();
    const open = el.querySelector('.notif-center__open')!.getBoundingClientRect();
    const dismiss = el.querySelector('.notif-center__dismiss')!.getBoundingClientRect();
    return { kindToContext: Math.abs(context.left - kind.right) >= 4 || context.top >= kind.bottom - 1, contextToText: text.top >= context.bottom - 1 || text.left - context.right >= 4, dismissBeside: Math.abs(dismiss.top - open.top) < open.height, dismissW: dismiss.width, dismissH: dismiss.height, align: getComputedStyle(el.querySelector('.notif-center__body')!).textAlign };
  });
  expect.soft(gaps.kindToContext, 'kind label separated from context').toBeTruthy();
  expect.soft(gaps.contextToText, 'context separated from message text').toBeTruthy();
  expect.soft(gaps.dismissBeside, 'dismiss sits beside the row, not wrapped under it').toBeTruthy();
  expect.soft(gaps.dismissW, 'dismiss is a 44px target').toBeGreaterThanOrEqual(44);
  expect.soft(gaps.align, 'row text is start-aligned').not.toBe('center');
  await expect.soft(inbox.getByText(/^!Error|ErrorError|Unknown command: (METADATA|EVENT)/), 'protocol errors are not user notifications').toHaveCount(0);
  await expect.soft(inbox.getByText(/dmDirect message|Direct messageDirect/), 'no glyph/label run-on').toHaveCount(0);
});

test('P0-4 phone top bar keeps the Inbox button on screen (no clipped tool strip)', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone layout');
  await openRoot(page);
  const bell = await page.getByTestId('inbox-bell').boundingBox();
  expect(bell, 'inbox bell rendered').not.toBeNull();
  expect(bell!.x + bell!.width, 'inbox bell fully inside the viewport').toBeLessThanOrEqual(viewportWidth(page) + 0.5);
  // Chrome budget: top bar + composer leave at least half the screen for messages.
  const [top, comp] = await Promise.all([box(page, '.onyx-topbar'), box(page, '.onyx-composer')]);
  const h = page.viewportSize()!.height;
  expect.soft((top.h + comp.h) / h, 'top bar + composer use at most 35% of the height').toBeLessThanOrEqual(0.35);
});

test('P0-5 the light look actually applies to the app (Pearl theme or prefers-color-scheme: light)', async ({ page }, info) => {
  await boot(page, '&nick=kai', {}, { theme: 'pearl' });
  await waitLive(page);
  const colors = await page.evaluate(() => {
    const parse = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number);
    const bgEl = document.querySelector('.onyx-shell') as HTMLElement;
    const [r, g, b] = parse(getComputedStyle(bgEl).backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : getComputedStyle(bgEl).backgroundColor);
    return { lum: 0.2126 * r + 0.7152 * g + 0.0722 * b, theme: document.documentElement.getAttribute('data-theme'), scheme: getComputedStyle(document.documentElement).colorScheme };
  });
  expect.soft(colors.theme, 'data-theme reflects the stored look').toBe('pearl');
  expect(colors.lum, 'shell background is light when the light look is chosen').toBeGreaterThan(160);
  if (info.project.name.endsWith('-light')) expect.soft(colors.scheme).toContain('light');
});

test('P0-6 the member profile opens as an overlay/sheet and does not squash the conversation', async ({ page }, info) => {
  await openRoot(page);
  if (isPhone(info)) await page.getByRole('button', { name: 'Members', exact: true }).click();
  const before = await box(page, '.onyx-thread-pane');
  await page.locator('#client-members').getByRole('button', { name: /View network profile for mara/ }).click();
  const sheet = page.getByRole('dialog', { name: /Profile: mara/ });
  await expect(sheet).toBeVisible();
  await expect.soft(sheet, 'profile sheet is a modal dialog').toHaveAttribute('aria-modal', 'true');
  const after = await box(page, '.onyx-thread-pane');
  expect(after.h, 'transcript keeps its height while the profile is open').toBeGreaterThanOrEqual(before.h * 0.7);
  await expect.soft(sheet.getByText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), 'no raw ISO timestamps').toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

// ---------------------------------------------------------------- P1

test('P1-1 grouped (continuation) messages are compact and the actions trigger does not add a row', async ({ page }, info) => {
  await openRoot(page);
  const cont = page.locator('.onyx-continuation', { hasText: 'bring questions' });
  await cont.scrollIntoViewIfNeeded();
  const r = await cont.boundingBox();
  expect(r!.height, 'continuation row height (16px text + small padding)').toBeLessThanOrEqual(isPhone(info) ? 36 : 30);
  const head = page.locator('.onyx-message:not(.onyx-continuation)', { hasText: 'Voice call at six' }).first();
  await head.scrollIntoViewIfNeeded();
  const geom = await head.evaluate(el => {
    const body = el.querySelector('.onyx-body')!.getBoundingClientRect();
    const trigger = el.querySelector('.onyx-msg-menu-trigger')?.getBoundingClientRect();
    return { bodyBottom: body.bottom, triggerTop: trigger?.top ?? 0, triggerLeft: trigger?.left ?? 0, bodyLeft: body.left };
  });
  expect.soft(geom.triggerTop < geom.bodyBottom || geom.triggerLeft > geom.bodyLeft + 40, 'trigger sits on the row (top-right / hover), not on its own line underneath').toBeTruthy();
});

test('P1-2 timestamp and text on grouped rows are separated', async ({ page }) => {
  await openRoot(page);
  const cont = page.locator('.onyx-continuation', { hasText: 'and snacks' });
  await cont.scrollIntoViewIfNeeded();
  const gap = await cont.evaluate(el => {
    const t = el.querySelector('time')!.getBoundingClientRect();
    const b = el.querySelector('.onyx-body')!.getBoundingClientRect();
    return b.left - t.right;
  });
  expect(gap, 'gap between time and body').toBeGreaterThanOrEqual(6);
});

test('P1-3 message author names open the profile card (tap/click and keyboard)', async ({ page }) => {
  await openRoot(page);
  const sender = page.locator('.onyx-message .onyx-sender', { hasText: 'trev' }).first();
  await sender.scrollIntoViewIfNeeded();
  const role = await sender.evaluate(el => el.closest('button, a[href], [role=button]') ? 'interactive' : el.tagName.toLowerCase());
  expect(role, 'author name is a control').toBe('interactive');
  await sender.click();
  await expect(page.getByRole('dialog', { name: /Profile: trev|trev/ })).toBeVisible();
});

test('P1-4 the message menu is not clipped by the transcript and reads plainly', async ({ page }, info) => {
  await openRoot(page);
  await openMessageMenu(page, 3);
  const menu = page.getByRole('menu');
  const r = await menu.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(r!.y, 'menu top is on screen').toBeGreaterThanOrEqual(0);
  expect(r!.y + r!.height, 'menu bottom is on screen').toBeLessThanOrEqual(vh);
  // It is layered, not pushing the transcript: the thread pane keeps its scroll height.
  const clipped = await menu.evaluate(el => { const pane = el.closest('.onyx-thread-pane') as HTMLElement | null; if (!pane) return false; const pr = pane.getBoundingClientRect(); const mr = el.getBoundingClientRect(); return mr.top < pr.top || mr.bottom > pr.bottom; });
  expect.soft(clipped, 'menu not clipped by the scroll container').toBeFalsy();
  const items = await menu.getByRole('menuitem').allTextContents();
  expect.soft(items.length, 'a short primary menu (more behind "More…")').toBeLessThanOrEqual(8);
  expect.soft(items.join(' | '), 'no protocol jargon in the primary menu').not.toMatch(/ledger|moment link|server-history|Start topic from here/i);
  if (!isPhone(info)) {
    const inside = await menu.evaluate(el => el.contains(document.activeElement));
    expect.soft(inside, 'keyboard focus moves into the menu').toBeTruthy();
  }
});

test('P1-5 reply bar: "Replying to <name>" is separated from the preview and cancel is a quiet icon button', async ({ page }) => {
  await openRoot(page);
  await openMessageMenu(page, 3);
  await page.getByRole('menuitem', { name: /^Reply to/ }).click();
  const bar = page.locator('.shell-composer-context');
  await expect(bar).toBeVisible();
  const g = await bar.evaluate(el => {
    const label = el.querySelector('.shell-composer-context-label')!.getBoundingClientRect();
    const text = el.querySelector('.shell-composer-context-text')!.getBoundingClientRect();
    const close = el.querySelector('.shell-composer-context-close') as HTMLElement;
    const cr = close.getBoundingClientRect();
    return { gap: text.left - label.right, closeBg: getComputedStyle(close).backgroundColor, closeName: close.getAttribute('aria-label') || close.textContent, closeBeside: Math.abs(cr.top - label.top) < label.height * 2, barAboveInput: el.getBoundingClientRect().bottom <= (document.querySelector('.onyx-composer input, .onyx-composer textarea') as HTMLElement).getBoundingClientRect().top + 1 };
  });
  expect.soft(g.gap, 'label and preview separated').toBeGreaterThanOrEqual(6);
  expect.soft(g.closeBg, 'cancel is not the accent/primary colour').not.toMatch(ACCENT);
  expect.soft(g.closeName || '', 'cancel has an accessible name').toMatch(/cancel|close|stop replying/i);
  expect.soft(g.closeBeside, 'cancel sits on the same line as the label').toBeTruthy();
  expect.soft(g.barAboveInput, 'reply context sits above the input (like Slack/WhatsApp)').toBeTruthy();
});

test('P1-6 phone Home gives the content most of the screen (no two permanent docked strips)', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone layout');
  await boot(page);
  await waitLive(page);
  const h = page.viewportSize()!.height;
  const used = await page.evaluate(() => ['.guest-claim-chip', '.runtime-services-disclosure'].map(s => document.querySelector(s)).filter(Boolean).reduce((sum, el) => sum + (el as HTMLElement).getBoundingClientRect().height, 0));
  expect(used / h, 'docked strips use at most 8% of the height').toBeLessThanOrEqual(0.08);
});

test('P1-7 no protocol jargon in the everyday UI (guest, first screen, empty room, after sending)', async ({ page }) => {
  await boot(page);
  await waitLive(page);
  // Home: developer tooling is not offered to a guest on the first screen.
  for (const phrase of ['Reconcile notification registration', 'trusted-device directory', 'List saved attachments', 'authenticator']) {
    await expect.soft(page.getByText(phrase, { exact: false }).locator('visible=true'), `"${phrase}" not visible on Home`).toHaveCount(0);
  }
  const services = page.locator('summary[aria-label="Local services and recovery"]');
  if (await services.count()) await expect.soft(services, 'local services is an "Advanced" door, not a docked panel').toHaveText(/Advanced/i);
  await openRoom(page, '#quiet');
  await expect.soft(page.getByText(/Server replay retention|retention policy is unknown|local history is a separate cache/), 'empty room explains itself in plain words').toHaveCount(0);
  await expect.soft(page.getByRole('button', { name: /Request history between loaded bounds|Catch up after latest message/ }), 'history paging controls are not primary UI').toHaveCount(0);
  await openRoom(page, '#root');
  await sendMessage(page, 'plain send');
  await expect.soft(page.getByText(/handed to this connection|will not be resent automatically/), 'no delivery-protocol copy after a normal send').toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('draft');
  await expect.soft(page.getByText(/only in this tab's memory/), 'no alarming draft-memory copy while typing').toHaveCount(0);
});

test('P1-8 a failed send shows an error next to the composer', async ({ page }) => {
  await openRoot(page);
  await page.getByLabel('Message', { exact: true }).fill('/msg nobody hello');
  await page.keyboard.press('Enter');
  const alert = page.locator('.onyx-composer [role=alert], .onyx-composer [role=status], .onyx-toaster [role=alert], .onyx-toaster [role=status]').filter({ hasText: /nobody|No such|could not|not delivered/i });
  await expect(alert.first()).toBeVisible({ timeout: 5_000 });
});

test('P1-9 a failed sign-in at the gate shows an error and lets you try again', async ({ page }) => {
  await boot(page, '');
  await page.getByTestId('connect-mode-signin').click();
  await page.getByLabel('Account name').fill('kai');
  await page.locator('#connection-password').fill('wrong');
  await page.getByTestId('connect-submit').click();
  await expect(page.locator('#connect-error'), 'error shown').toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('connect-submit'), 'submit re-enabled').toBeEnabled({ timeout: 8_000 });
  await expect(page.getByTestId('connect-mode-guest'), 'other modes re-enabled').toBeEnabled();
});

test('P1-10 search shows its results in a readable list and does not flip the transcript into "reading earlier" mode', async ({ page }, info) => {
  await openRoot(page);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('search', { name: 'Message search' });
  await expect(search).toBeVisible();
  await settle(page, 300);
  await expect.soft(page.getByText('Reading earlier messages'), 'no reading-earlier bar just from opening search').toHaveCount(0);
  await search.getByRole('searchbox').fill('call');
  await settle(page, 600);
  await expect(search.getByText(/of \d+/).first()).toBeVisible();
  const runon = await search.evaluate(el => /Saved on this device\d/.test(el.textContent || '') || /searchesTHIS/.test(el.textContent || ''));
  expect.soft(runon, 'saved-search header text is not run together').toBeFalsy();
  const matches = search.locator('[role=listbox], [role=list], ol, ul').first();
  if (await matches.count()) {
    const r = await matches.boundingBox();
    expect.soft(r!.height, 'result list is readable, not a clipped strip').toBeGreaterThan(isPhone(info) ? 80 : 60);
  }
});

test('P1-11 every sheet is a modal dialog: aria-modal, Escape closes, focus returns to the opener', async ({ page }, info) => {
  await boot(page);
  await waitLive(page);
  const cases: Array<{ id: string; open: () => Promise<void>; opener: () => import('@playwright/test').Locator; name: RegExp | string }> = [
    { id: 'inbox', open: async () => { await page.getByTestId('inbox-bell').focus(); await page.keyboard.press('Enter'); }, opener: () => page.getByTestId('inbox-bell'), name: 'Notification inbox' },
    { id: 'browse', open: async () => { const b = page.getByRole('button', { name: 'Browse rooms', exact: true }).first(); await b.focus(); await page.keyboard.press('Enter'); }, opener: () => page.getByRole('button', { name: 'Browse rooms', exact: true }).first(), name: 'Browse rooms' },
    { id: 'start', open: async () => { const b = page.getByRole('button', { name: 'Start a room', exact: true }).first(); await b.focus(); await page.keyboard.press('Enter'); }, opener: () => page.getByRole('button', { name: 'Start a room', exact: true }).first(), name: 'Start a room' },
  ];
  for (const c of cases) {
    if (isPhone(info) && c.id !== 'inbox') await page.getByTestId('nav-home').locator('visible=true').click();
    await c.open();
    const dialog = page.getByRole('dialog', { name: c.name });
    await expect(dialog, `${c.id} opens`).toBeVisible();
    expect.soft(await dialog.getAttribute('aria-modal'), `${c.id} aria-modal`).toBe('true');
    expect.soft(await dialog.evaluate(el => el.contains(document.activeElement)), `${c.id} takes focus`).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(dialog, `${c.id} closes on Escape`).toBeHidden();
    await expect.soft(c.opener(), `${c.id} returns focus`).toBeFocused();
  }
});

test('P1-12 the room topic is visible on phones (room header)', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone layout');
  await openRoot(page);
  await expect(page.getByText(/Welcome to #root — the front door/).locator('visible=true').first()).toBeVisible();
});

test('P1-13 desktop empty state never offers "Connect" while connected; composer explains itself', async ({ page }, info) => {
  test.skip(isPhone(info), 'desktop layout');
  await boot(page);
  await waitLive(page);
  await page.getByTestId('nav-rooms').locator('visible=true').click();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect.soft(page.getByPlaceholder('Select a channel')).toHaveCount(0);
});

test('P1-14 "Back online" does not appear on the first connection', async ({ page }) => {
  await boot(page);
  for (let i = 0; i < 8; i += 1) { await expect(page.getByText('Back online'), `sample ${i}`).toHaveCount(0); await settle(page, 400); }
  await waitLive(page);
  await expect(page.getByText('Back online')).toHaveCount(0);
});

test('P1-15 roster rows are one 44px control per member, without a repeated "Profile" word', async ({ page }, info) => {
  await openRoot(page);
  if (isPhone(info)) await page.getByRole('button', { name: 'Members', exact: true }).click();
  const member = page.locator('#client-members .onyx-member', { hasText: 'mara' }).first();
  await expect(member).toBeVisible();
  const n = await member.locator('button, a[href]').count();
  expect.soft(n, 'one interactive control per member row').toBeLessThanOrEqual(1);
  const r = await member.locator('button, a[href]').first().boundingBox();
  if (isPhone(info)) expect.soft(r!.width, 'member control is wide enough to tap').toBeGreaterThanOrEqual(44);
  await expect.soft(page.locator('#client-members').getByRole('button', { name: 'Profile', exact: true })).toHaveCount(0);
  await expect.soft(page.locator('#client-members').getByText(/HALF-OPS|^OPS\b|VOICE \(/i), 'role groups use plain names (Moderators, Members…)').toHaveCount(0);
});

test('P1-16 composer: compact on phones and a growing multiline field', async ({ page }, info) => {
  await openRoot(page);
  const field = page.locator('.onyx-composer textarea[aria-label="Message"], .onyx-composer [contenteditable][aria-label="Message"]');
  await expect(field, 'message field is multiline (textarea/contenteditable)').toHaveCount(1);
  if (isPhone(info)) {
    const r = await box(page, '.onyx-composer');
    expect(r.h, 'idle composer height on a phone').toBeLessThanOrEqual(120);
  }
});

test('P1-17 slash-command suggestions look like a list, with name and description apart', async ({ page }) => {
  await openRoot(page);
  await page.getByLabel('Message', { exact: true }).fill('/');
  const list = page.getByTestId('slash-suggestions');
  await expect(list).toBeVisible();
  const first = list.getByRole('option').first();
  const color = await first.locator('button').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect.soft(color, 'options are not primary buttons').not.toMatch(ACCENT);
  const parts = await first.evaluate(el => el.querySelectorAll('button > *').length);
  expect.soft(parts, 'name and description are separate elements').toBeGreaterThanOrEqual(2);
});

test('P1-18 audience selector always shows a human label (never a bare prefix character)', async ({ page }) => {
  await openRoot(page);
  await openComposerTray(page);
  const toggle = page.locator('.onyx-audience-toggle');
  await expect(toggle).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    const label = (await toggle.textContent())!.trim();
    expect(label.length, `label "${label}" is a word`).toBeGreaterThan(1);
    expect(label).not.toMatch(/^[~&@%+]$/);
    await toggle.click();
  }
});

test('P1-19 Calls page has one main and one h1', async ({ page }, info) => {
  await boot(page);
  await waitLive(page);
  await page.getByTestId('nav-calls').locator('visible=true').click();
  const report = await audit(page, isPhone(info));
  expect(report.landmarks.main).toBe(1);
  expect(report.landmarks.h1).toBe(1);
});

test('P1-20 nav You button does not reference a missing dialog id while closed', async ({ page }) => {
  await boot(page);
  await waitLive(page);
  const dangling = await page.evaluate(() => [...document.querySelectorAll('[aria-controls]')].filter(el => !document.getElementById(el.getAttribute('aria-controls')!)).map(el => el.getAttribute('data-testid') || el.className));
  expect(dangling).toEqual([]);
});

test('P1-21 opening a mention from the inbox lands focus on that message', async ({ page }) => {
  await openRoot(page);
  await page.getByTestId('inbox-bell').click();
  const inbox = page.getByRole('dialog', { name: 'Notification inbox' });
  const row = inbox.getByRole('button', { name: /Open notification from trev in #root/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(inbox).toBeHidden();
  const f = await focused(page);
  expect(f.path, 'focus on the message row').toContain('onyx-message');
  expect(f.inViewport, 'message scrolled into view').toBeTruthy();
});

test('P1-22 the channel topic is not rendered as a primary button in the composer', async ({ page }) => {
  await boot(page);
  await openRoom(page, '#quiet');
  const btn = page.locator('.onyx-composer button', { hasText: 'nothing happens here' });
  if (await btn.count()) {
    const color = await btn.first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(color, 'topic chip is not styled as the Send button').not.toMatch(ACCENT);
  }
});

test('P1-23 collection filters are visible and usable at 320px', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-se', '320px layout');
  await boot(page);
  await waitLive(page);
  await openRooms(page);
  const unread = page.getByTestId('rail-filter-unread');
  await expect(unread).toBeVisible();
  await expect(unread).toBeInViewport();
  await unread.click();
  await expect(unread).toHaveAttribute('aria-pressed', 'true');
});

test('P1-24 light scheme: the shell honours prefers-color-scheme like the public site does', async ({ page }, info) => {
  test.skip(!info.project.name.endsWith('-light'), 'light projects');
  await page.goto('/');
  const siteLum = await page.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; });
  await boot(page);
  await waitLive(page);
  const appLum = await page.evaluate(() => { const el = document.querySelector('.onyx-shell') as HTMLElement; const c = getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : getComputedStyle(el).backgroundColor; const [r, g, b] = c.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; });
  expect(Math.sign(siteLum - 128), 'site and app agree on light vs dark').toBe(Math.sign(appLum - 128));
});

// ---------------------------------------------------------------- P2

test('P2-1 transcript line length is capped on wide screens', async ({ page }, info) => {
  test.skip(isPhone(info), 'desktop');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openRoot(page);
  const w = await page.locator('.onyx-body', { hasText: 'A long message to test wrapping' }).first().evaluate(el => el.getBoundingClientRect().width);
  expect(w, 'measure <= ~90ch').toBeLessThanOrEqual(900);
});

test('P2-2 offline copy pluralises ("in 1 second")', async ({ page }) => {
  await boot(page, '&nick=kai', { dropAfterMs: 800 });
  await expect(page.getByTestId('connection-open')).toHaveAccessibleName(/Offline|Connecting/, { timeout: 15_000 });
  await page.getByTestId('connection-open').click();
  const dialog = page.getByTestId('connection-dialog');
  await expect(dialog).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 16; i += 1) { seen.push((await dialog.textContent()) || ''); await settle(page, 400); }
  expect(seen.join('\n')).not.toMatch(/in 1 seconds/);
});

test('P2-3 disabled "Send later" explains why', async ({ page }) => {
  await openRoot(page);
  await page.getByLabel('Message', { exact: true }).fill('later');
  await openComposerTray(page);
  const later = page.getByRole('button', { name: /Send later|Schedule message/ });
  if (await later.isDisabled()) {
    const why = await later.evaluate(el => el.getAttribute('title') || (el.getAttribute('aria-describedby') && document.getElementById(el.getAttribute('aria-describedby')!)?.textContent) || '');
    expect(why.trim().length, 'a reason is attached to the disabled control').toBeGreaterThan(0);
  }
});

test('P2-4 connection pill reads as a status, not a verb, while connected', async ({ page }, info) => {
  test.skip(isPhone(info), 'desktop pill');
  await boot(page);
  await waitLive(page);
  const words = await page.getByTestId('connection-open').locator('span').allInnerTexts();
  expect(words.map(w => w.trim()), 'pill words never include the bare verb "Connect"').not.toContain('Connect');
});

test('P2-5 small targets: dialog close buttons, facepile faces and the room-creation checkbox are 44px on phones', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone targets');
  await openRoot(page);
  await openRoomTool(page, 'ribbon-pins');
  const close = await page.getByRole('button', { name: 'Close pinned messages' }).boundingBox();
  expect.soft(close!.width, 'pins close width').toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-home').locator('visible=true').click();
  await page.getByRole('button', { name: 'Start a room', exact: true }).first().click();
  const cb = page.getByRole('checkbox').first();
  const cr = await cb.evaluate(el => { const l = el.closest('label') || el; const r = l.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  expect.soft(cr.h, 'checkbox hit area height').toBeGreaterThanOrEqual(44);
});

// ---------------------------------------------------------------- guards (pass today)

test('[guard] G-1 connect gate: guest join lands in the room; pins/media dialogs are modal and restore focus', async ({ page }) => {
  const logs = collect(page);
  const wire = await boot(page, '', { noAutoJoin: true });
  await page.getByLabel('Display name').fill('kai');
  await page.getByLabel('Room').fill('#root');
  await page.getByTestId('connect-submit').click();
  await expect(page.locator('.onyx-thread-pane')).toHaveAttribute('data-conversation', '#root', { timeout: 15_000 });
  await expect.poll(() => wire.sent).toContain('JOIN #root');
  for (const [testid, name] of [['ribbon-pins', 'Pinned messages'], ['ribbon-room-media', 'Pictures, files, and links']] as const) {
    const tool = page.getByTestId(testid);
    if (!(await tool.isVisible())) await page.locator('#room-tools-more').click();
    await tool.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(testid)).toBeFocused();
  }
  expect(logs.errors.filter(e => !/Service Worker/.test(e))).toEqual([]);
});

test('[guard] G-2 no horizontal overflow in the room on any project; nav buttons are 44px on phones', async ({ page }, info) => {
  await openRoot(page);
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  if (isPhone(info)) {
    for (const b of await page.locator('.onyx-mobile-nav button').all()) {
      const r = await b.boundingBox();
      expect(r!.width).toBeGreaterThanOrEqual(44);
      expect(r!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('[guard] G-3 day and new-message separators, mention rows and live regions are exposed to assistive tech', async ({ page }) => {
  await openRoot(page);
  await expect(page.getByRole('separator', { name: 'Today' })).toHaveCount(1);
  await expect(page.getByRole('separator', { name: 'New messages' })).toHaveCount(1);
  await expect(page.getByRole('article', { name: /trev \(mention\)/ })).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Notifications' })).toHaveCount(1);
  await expect(page.getByTestId('connection-open')).toHaveAccessibleName(/^Connection\. Live/);
});

test('[guard] G-4 reduced motion: no long transitions on the connect gate and shell', async ({ page }, info) => {
  test.skip(!info.project.name.includes('reduced'), 'reduced-motion project');
  await boot(page, '');
  const longest = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('button, a, .onyx-gate-card')].map(el => parseFloat(getComputedStyle(el).transitionDuration) || 0)));
  expect(longest).toBeLessThanOrEqual(0.2);
});
