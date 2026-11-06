// SPDX-License-Identifier: AGPL-3.0-or-later
// The brand mark appears once: the icon rail's gem on wide screens (it is the
// Home link), the top bar's gem on phones where there is no rail.
import { expect, test } from '@playwright/test';
import { boot, waitLive } from './elm-audit-support';

for (const width of [1280, 390]) {
  test(`BRAND-${width} exactly one brand mark is visible`, async ({ page }, info) => {
    if (info.project.name !== (width === 1280 ? 'chromium' : 'iphone-13')) test.skip(true, 'one project per width');
    await page.setViewportSize({ width, height: width < 768 ? 844 : 800 });
    await boot(page);
    await waitLive(page);
    for (const section of ['nav-home', 'nav-rooms']) {
      await page.getByTestId(section).locator('visible=true').click();
      const gems = await page.locator('.onyx-shell .onyx-gem').evaluateAll(els => els.filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }).length);
      expect(gems, `${section}: one gem`).toBe(1);
      const wordmarks = await page.locator('.onyx-shell .onyx-brand h1').evaluateAll(els => els.filter(el => el.getBoundingClientRect().width > 0).length);
      expect(wordmarks, `${section}: at most one visible wordmark`).toBeLessThanOrEqual(1);
    }
    if (width === 1280) {
      const mark = page.locator('[data-brand-mark="rail"]');
      await expect(mark).toHaveAccessibleName(/Onyx home/);
      await expect(mark).toHaveAttribute('href', '/app/');
    }
  });
}
