// SPDX-License-Identifier: AGPL-3.0-or-later
// Theme chain, end to end: every built-in look restyles the shell through the
// shared tokens, passes WCAG AA on body / muted / accent text, persists
// across reloads, applies before first paint, and can be picked from the
// Appearance page. "Match device" (nothing saved) follows prefers-color-scheme.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, settle, waitLive } from './elm-audit-support';

const LOOKS: Array<[string, 'dark' | 'light']> = [
  ['ocean', 'dark'], ['tide', 'dark'], ['abyss', 'dark'], ['reef', 'dark'], ['onyx', 'dark'], ['obsidian', 'dark'], ['pearl', 'light'], ['ink', 'dark'],
  ['shu', 'dark'], ['hisui', 'dark'], ['pine', 'dark'], ['kohaku', 'dark'], ['terracotta', 'dark'], ['vermillion', 'dark'], ['sapphire', 'dark'], ['teal', 'dark'],
  ['slate', 'dark'], ['frost', 'light'], ['graphite', 'dark'], ['sepia', 'light'], ['mist', 'light'], ['plum', 'dark'], ['contrast', 'dark'],
];
const SHOTS = process.env.ONYX_AUDIT_SHOTS ?? path.resolve(process.env.ONYX_TEST_ARTIFACTS_ROOT ?? 'test-results', 'elm-audit', 'themes');

type Palette = { bg: string; panel: string; text: string; dim: string; accent: string; accentInk: string; lum: number };

/** Resolve the shell tokens to rgb strings and the shell's background luminance. */
async function palette(page: import('@playwright/test').Page): Promise<Palette> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const read = (token: string) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    const out = { bg: read('--onyx-bg'), panel: read('--onyx-panel'), text: read('--onyx-text'), dim: read('--onyx-dim'), accent: read('--onyx-accent'), accentInk: read('--onyx-accent-ink'), lum: 0 };
    probe.remove();
    const shell = document.querySelector('.onyx-shell') as HTMLElement | null;
    const bg = shell ? getComputedStyle(shell).backgroundColor : getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = (bg === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : bg).match(/\d+/g)!.map(Number);
    out.lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return out;
  });
}

function contrast(a: string, b: string) {
  const lin = (c: string) => { const [r, g, bb] = c.match(/\d+/g)!.slice(0, 3).map(Number).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [lin(a), lin(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test.describe('every built-in look', () => {
  test.skip(() => !['chromium', 'iphone-13'].includes(test.info().project.name), 'one desktop and one phone project');
  for (const [id, scheme] of LOOKS) {
    test(`THEME-${id} applies to the shell, passes AA, persists and paints before Elm boots`, async ({ page }, info) => {
      mkdirSync(SHOTS, { recursive: true });
      await boot(page, '&nick=kai', {}, { theme: id });
      await waitLive(page);
      // The head script paints the saved look before Elm boots.
      const early = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(early, 'data-theme reflects the saved look').toBe(id);
      const p = await palette(page);
      if (scheme === 'light') expect(p.lum, 'light look paints a light shell').toBeGreaterThan(160); else expect(p.lum, 'dark look paints a dark shell').toBeLessThan(90);
      expect(contrast(p.text, p.bg), `${id}: body text on background >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dim, p.bg), `${id}: muted text on background >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.panel), `${id}: body text on raised panel >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accentInk, p.accent), `${id}: text on accent buttons >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.bg), `${id}: accent (links, focus) on background >= 3`).toBeGreaterThanOrEqual(3);
      // The look is distinguishable from the default.
      if (id !== 'ocean') {
        const ocean = { bg: 'rgb(14, 21, 24)' };
        expect(p.bg, `${id}: not the Ocean background`).not.toBe(ocean.bg);
      }
      // Open a room for a representative screenshot.
      await page.getByTestId('nav-rooms').locator('visible=true').click();
      await page.locator('#client-rooms button[title="#root"]').click();
      await settle(page, 400);
      await page.screenshot({ path: path.join(SHOTS, `${id}-${info.project.name}.png`), fullPage: false });
      // Persists across a reload.
      await page.reload();
      await page.waitForFunction(() => (window as any).__onyxBooted === true);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(id);
      const again = await palette(page);
      expect(again.bg).toBe(p.bg);
    });
  }
});

test('THEME-system nothing saved follows prefers-color-scheme (Pearl tokens in the light)', async ({ page }, info) => {
  await boot(page);
  await waitLive(page);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('system');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('color-scheme'))).toBe('');
  const p = await palette(page);
  if (info.project.name.endsWith('-light')) { expect(p.lum).toBeGreaterThan(160); expect(p.bg).toBe('rgb(246, 243, 236)'); }
  else { expect(p.lum).toBeLessThan(90); expect(p.bg).toBe('rgb(14, 21, 24)'); }
});

test('THEME-appearance picking a look on /appearance restyles the page and the app, and survives reload', async ({ page }, info) => {
  test.skip(!['chromium', 'iphone-13', 'chromium-light'].includes(info.project.name), 'representative projects');
  await page.goto('/appearance/');
  await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
  const apBg = () => page.locator('main.ap').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.getByRole('radio', { name: 'Pearl · Light look' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('pearl');
  await expect.poll(apBg).toBe('rgb(246, 243, 236)');
  await page.getByRole('radio', { name: 'Ocean · Dark look' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ocean');
  await expect.poll(apBg).toBe('rgb(14, 21, 24)');
  // Advanced: all looks, including the curated ones.
  await page.getByTestId('appearance-advanced').locator('summary').click();
  await page.getByRole('radio', { name: 'Plum', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('plum');
  await expect.poll(apBg).toBe('rgb(27, 18, 32)');
  await page.reload();
  await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('onyx:theme'))).toBe('plum');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('plum');
  // Into the app through the page's own link.
  await page.getByRole('link', { name: /back to app/i }).click();
  await page.waitForFunction(() => (window as any).__onyxBooted === true);
  await expect.poll(async () => (await palette(page)).bg).toBe('rgb(27, 18, 32)');
});

test('THEME-you picking a look from inside the app (You > Appearance) applies immediately', async ({ page }, info) => {
  test.skip(!['chromium', 'iphone-13'].includes(info.project.name), 'representative projects');
  await boot(page);
  await waitLive(page);
  await page.getByTestId('nav-you').locator('visible=true').click();
  await page.getByTestId('you-appearance').click();
  await expect(page).toHaveURL(/\/appearance/);
  await page.getByRole('radio', { name: 'Pearl · Light look' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('pearl');
  await page.getByRole('link', { name: /back to app/i }).click();
  await expect(page.locator('.onyx-shell')).toBeVisible();
  const p = await palette(page);
  expect(p.lum).toBeGreaterThan(160);
});
