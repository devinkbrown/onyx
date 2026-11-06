// SPDX-License-Identifier: AGPL-3.0-or-later
// Profile overlay (P0-6 follow-up from a live report): a member with a
// 60-character unbroken nick and long WHOIS fields opens the profile; every
// descendant stays inside the panel; the close button, Escape and the
// backdrop each close it and hand focus back to the opener. Covers both
// entry points: the member list and an author name in the transcript.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openRoot } from './elm-audit-support';
import { LONG_NICK } from './elm-audit-wire.mjs';

async function expectContained(panel: Locator) {
  const overflow = await panel.evaluate(root => {
    const box = root.getBoundingClientRect();
    const bad: string[] = [];
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 && s.position !== 'sticky' || r.bottom > box.bottom + 1 && s.position !== 'sticky') {
        if (r.right > box.right + 1 || r.left < box.left - 1) bad.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)}`);
      }
    }
    // Horizontal containment is the overflow bug; vertical is scrollable.
    return { bad: bad.slice(0, 6), scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, viewport: innerWidth, right: box.right };
  });
  expect(overflow.bad, 'no descendant pokes out of the profile panel horizontally').toEqual([]);
  expect(overflow.scrollWidth, 'panel does not scroll sideways').toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.right, 'panel stays inside the viewport').toBeLessThanOrEqual(overflow.viewport + 1);
}

async function openMembers(page: Page) {
  const toggle = page.getByRole('button', { name: 'Members', exact: true });
  if (await toggle.isVisible() && !(await page.locator('#client-members').isVisible())) await toggle.click();
  await expect(page.locator('#client-members')).toBeVisible();
}

for (const width of [320, 390, 1280]) {
  test(`PROFILE-${width} long nick: member-list profile stays inside its panel and closes three ways`, async ({ page }, info) => {
    if (isPhone(info) ? width === 1280 : width !== 1280) test.skip(true, 'one width per project family');
    await page.setViewportSize({ width, height: width < 768 ? 844 : 800 });
    await openRoot(page);
    await openMembers(page);
    const opener = page.locator('#client-members').getByRole('button', { name: new RegExp(`View network profile for ${LONG_NICK}`) });
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    const sheet = page.getByRole('dialog', { name: new RegExp(`Profile: ${LONG_NICK}`) });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(sheet.getByText(/WWWWWWWW/)).toBeVisible();
    await expectContained(sheet);
    const close = sheet.getByRole('button', { name: /^Close/ });
    const box = await close.boundingBox();
    expect(box, 'a close control is rendered').not.toBeNull();
    if (width < 768) { expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44); }
    expect(box!.y + box!.height, 'close control is on screen').toBeLessThanOrEqual(page.viewportSize()!.height);
    // 1. Close button.
    await close.click();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    // 2. Escape.
    await opener.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    // 3. Backdrop.
    await opener.click();
    await expect(sheet).toBeVisible();
    await page.locator('.onyx-profile-pop > .onyx-profile-backdrop').click({ position: { x: 8, y: 8 } });
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test(`PROFILE-${width} long nick: author-name card stays inside its panel and restores focus`, async ({ page }, info) => {
    if (isPhone(info) ? width === 1280 : width !== 1280) test.skip(true, 'one width per project family');
    await page.setViewportSize({ width, height: width < 768 ? 844 : 800 });
    await openRoot(page);
    const sender = page.locator('.onyx-message .onyx-sender', { hasText: 'a-very-long-nickname-that-tests-wrapping' }).first();
    await sender.scrollIntoViewIfNeeded();
    await sender.click();
    const card = page.getByRole('dialog', { name: /a-very-long-nickname-that-tests-wrapping/ });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-modal', 'true');
    await expectContained(card);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(sender).toBeFocused();
  });
}
