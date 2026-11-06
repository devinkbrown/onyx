// SPDX-License-Identifier: AGPL-3.0-or-later
// Broad coverage: every public route renders cleanly in every project.
import { expect, test } from '@playwright/test';
import { audit, collect, expectNoHorizontalOverflow, isPhone, settle } from './elm-audit-support';
import { PUBLIC_ROUTES } from './elm-audit-lib.mjs';

const ROUTES: string[] = PUBLIC_ROUTES;

for (const route of ROUTES) {
  test(`route ${route} renders without errors, overflow or a11y basics missing`, async ({ page }, info) => {
    const logs = collect(page);
    const response = await page.goto(route);
    const is404 = route.includes('does-not-exist');
    expect([200, 404].includes(response?.status() ?? 0) && (is404 || response?.status() === 200), 'static status (the local SPA server answers 200; the live origin answers 404 for both 404 routes)').toBeTruthy();
    await expect(page.locator('#onyx-boot-splash')).toHaveCount(0, { timeout: 20_000 });
    await settle(page, 600);
    await expectNoHorizontalOverflow(page);
    const report = await audit(page, isPhone(info));
    expect.soft(report.landmarks.main, 'exactly one <main>').toBe(1);
    expect.soft(report.landmarks.h1, 'exactly one <h1>').toBe(1);
    expect.soft(report.landmarks.lang, 'html[lang]').toBe('en');
    expect.soft(report.a11y.filter(a => !/^(heading-skip|aria-controls-dangling|aria-hidden-contains-focusable)/.test(a)), 'basic a11y rules').toEqual([]);
    if (isPhone(info)) expect.soft(report.smallTargets, 'touch targets >= 44px').toEqual([]);
    expect.soft(logs.failedRequests, 'no failed same-origin requests').toEqual([]);
    expect.soft(logs.errors, 'no console errors').toEqual([]);
  });
}

test('AUD-ROUTE-WIDTHS public pages fit 320/390/768/1280/1920 without horizontal scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'desktop project sweeps widths');
  for (const route of ['/', '/about/', '/guides/', '/download/', '/status/', '/appearance/', '/this-page-does-not-exist/']) {
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 700 : 1000 });
      await page.goto(route);
      await expect(page.locator('#onyx-boot-splash')).toHaveCount(0, { timeout: 20_000 });
      await settle(page, 300);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      expect.soft(scroll, `${route} @ ${width}`).toBeLessThanOrEqual(width);
    }
  }
});
