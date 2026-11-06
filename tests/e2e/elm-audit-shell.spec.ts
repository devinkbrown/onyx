// SPDX-License-Identifier: AGPL-3.0-or-later
// Broad coverage of the signed-in shell: each surface opens, fits the
// viewport, keeps 44px touch targets on phones, passes the axe-like basics,
// and logs no console errors.
import { expect, test, type Page } from '@playwright/test';
import { audit, boot, collect, expectNoHorizontalOverflow, isPhone, openComposerTray, openMessageMenu, openRoom, openRoomTool, openRooms, openRoot, sendMessage, settle, waitLive } from './elm-audit-support';

type Scene = (page: Page) => Promise<void>;
const scenes: Record<string, Scene> = {
  'gate': async p => { await boot(p, ''); await expect(p.getByTestId('connect')).toBeVisible(); },
  'gate-signin': async p => { await boot(p, ''); await p.getByTestId('connect-mode-signin').click(); await expect(p.locator('#connection-password')).toBeVisible(); },
  'gate-register': async p => { await boot(p, ''); await p.getByTestId('connect-mode-register').click(); },
  'home': async p => { await boot(p); await waitLive(p); },
  'home-first-run': async p => { await boot(p, '&nick=kai', {}, { seen: false }); await waitLive(p); },
  'home-services': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-you').locator('visible=true').click(); await p.getByTestId('you-advanced').click(); await settle(p); },
  'rooms': async p => { await boot(p); await waitLive(p); await openRooms(p); },
  'rooms-many': async p => { await boot(p, '&nick=kai', { manyRooms: true }); await waitLive(p); await openRooms(p); },
  'rooms-favorites-empty': async p => { await boot(p); await waitLive(p); await openRooms(p); await p.getByTestId('rail-filter-favorites').click(); },
  'messages': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-messages').locator('visible=true').click(); },
  'room': async p => { await openRoot(p); },
  'room-empty': async p => { await boot(p); await openRoom(p, '#quiet'); },
  'room-longname': async p => { await boot(p); await openRoom(p, '#design-system-working-group-with-an-overlong-name'); },
  'room-huge': async p => { await openRoot(p, { hugeRoot: true }); },
  'room-members': async p => { await openRoot(p); const toggle = p.getByRole('button', { name: 'Members', exact: true }); if (await toggle.isVisible()) await toggle.click(); await expect(p.locator('#client-members')).toBeVisible(); },
  'room-search': async p => { await openRoot(p); await p.getByRole('button', { name: 'Search', exact: true }).click(); await p.getByRole('searchbox', { name: 'Search messages' }).fill('call'); await settle(p); },
  'room-pins': async p => { await openRoot(p); await openRoomTool(p, 'ribbon-pins'); await expect(p.getByRole('dialog', { name: 'Pinned messages', exact: true })).toBeVisible(); },
  'room-media': async p => { await openRoot(p); await openRoomTool(p, 'ribbon-room-media'); await expect(p.getByRole('dialog', { name: 'Pictures, files, and links', exact: true })).toBeVisible(); },
  'room-inbox': async p => { await openRoot(p); await p.getByTestId('inbox-bell').click(); await expect(p.getByRole('dialog', { name: 'Notification inbox' })).toBeVisible(); },
  'room-menu': async p => { await openRoot(p); await openMessageMenu(p, 3); },
  'room-reply': async p => { await openRoot(p); await openMessageMenu(p, 3); await p.getByRole('menuitem', { name: /^Reply to/ }).click(); },
  'room-react': async p => { await openRoot(p); await openMessageMenu(p, 3); await p.getByRole('menuitem', { name: /^Choose reaction/ }).click(); },
  'room-own-menu': async p => { await openRoot(p); await sendMessage(p, 'my own message to edit'); const n = await p.locator('.onyx-msg-menu-trigger').count(); await openMessageMenu(p, n - 1); /* Edit/Delete are server-capability gated; see P2-15 */ },
  'room-profile-card': async p => { await openRoot(p); await p.getByRole('button', { name: /Open profile for mara/ }).first().click(); await settle(p); },
  'composer-slash': async p => { await openRoot(p); await p.getByLabel('Message', { exact: true }).fill('/'); await expect(p.getByTestId('slash-suggestions')).toBeVisible(); },
  'composer-sendlater': async p => { await openRoot(p); await p.getByLabel('Message', { exact: true }).fill('later'); await openComposerTray(p); const later = p.getByRole('button', { name: /Send later|Schedule message/ }); await expect(later).toBeVisible(); if (await later.isEnabled()) await later.click(); },
  'dm': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-messages').locator('visible=true').click(); await openRooms(p); await p.locator('#client-rooms button[title="nova"]').click(); },
  'calls': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-calls').locator('visible=true').click(); await expect(p.locator('.onyx-main-calls')).toBeVisible(); },
  'you': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-you').locator('visible=true').click(); await expect(p.getByTestId('you-dialog')).toBeVisible(); },
  'connection': async p => { await boot(p); await waitLive(p); await p.getByTestId('connection-open').click(); await expect(p.getByTestId('connection-dialog')).toBeVisible(); },
  'connection-offline': async p => { await boot(p, '&nick=kai', { dropAfterMs: 1200 }); await expect(p.getByTestId('connection-open')).toHaveAccessibleName(/Offline|Connecting/, { timeout: 15_000 }); await p.getByTestId('connection-open').click(); },
  'guest-claim': async p => { await boot(p); await waitLive(p); await p.getByTestId('nav-you').locator('visible=true').click(); await p.getByTestId('you-keep-name').click(); await expect(p.getByRole('dialog', { name: 'Keep this name' })).toBeVisible(); },
  'browse-rooms': async p => { await boot(p); await waitLive(p); await p.getByRole('button', { name: 'Browse rooms', exact: true }).first().click(); await expect(p.getByRole('dialog', { name: 'Browse rooms' })).toBeVisible(); },
  'start-room': async p => { await boot(p); await waitLive(p); await p.getByRole('button', { name: 'Start a room', exact: true }).first().click(); await settle(p); },
};

for (const [name, run] of Object.entries(scenes)) {
  test(`shell surface "${name}" fits, is reachable, and is labelled`, async ({ page }, info) => {
    const logs = collect(page);
    await run(page);
    await settle(page, 300);
    await expectNoHorizontalOverflow(page);
    const report = await audit(page, isPhone(info));
    if (isPhone(info)) expect.soft(report.smallTargets, 'touch targets >= 44px').toEqual([]);
    expect.soft(report.a11y.filter(a => !/^(heading-skip|aria-controls-dangling|aria-hidden-contains-focusable)/.test(a)), 'axe-like basics').toEqual([]);
    expect.soft(report.landmarks.main, 'one main landmark').toBe(1);
    expect.soft(report.landmarks.h1, 'one h1').toBe(1);
    expect.soft(logs.errors, 'no console errors').toEqual([]);
    expect.soft(logs.failedRequests, 'no failed requests').toEqual([]);
  });
}
