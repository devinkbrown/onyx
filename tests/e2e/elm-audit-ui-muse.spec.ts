// SPDX-License-Identifier: AGPL-3.0-or-later
// UI audit (MUSE lane): faint/timestamp text and field borders meet WCAG
// contrast floors on a sample of looks that previously failed (tide measured
// 3.44:1, frost 3.14:1, mist 4.32:1 for --onyx-faint before the token raise).
import { expect, test } from '@playwright/test';
import { boot, waitLive } from './elm-audit-support';

const LOOKS = ['tide', 'frost', 'mist'];

type Rgb = [number, number, number];
type Sample = { faint: Rgb; dim: Rgb; bg: Rgb; panel: Rgb; panel2: Rgb; lineStrong: Rgb };

// getComputedStyle reports color-mix() tokens as `color(srgb r g b)` with
// 0-1 channels, so normalise every sample through a 1x1 canvas to 0-255 rgb.
async function sample(page: import('@playwright/test').Page): Promise<Sample> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    const read = (token: string): [number, number, number] => {
      probe.style.color = `var(${token})`;
      const computed = getComputedStyle(probe).color;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const out = {
      faint: read('--onyx-faint'),
      dim: read('--onyx-dim'),
      bg: read('--onyx-bg'),
      panel: read('--onyx-panel'),
      panel2: read('--onyx-panel-2'),
      lineStrong: read('--onyx-line-strong'),
    };
    probe.remove();
    return out;
  });
}

function contrast(a: Rgb, b: Rgb) {
  const lin = (c: Rgb) => { const [r, g, bb] = c.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [lin(a), lin(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test.describe('faint text and field borders (MUSE lane)', () => {
  test.skip(() => !['chromium', 'iphone-13'].includes(test.info().project.name), 'one desktop and one phone project');
  for (const id of LOOKS) {
    test(`UI-MUSE-${id} timestamp/faint text >= 4.5 and field border >= 3`, async ({ page }) => {
      await boot(page, '&nick=kai', {}, { theme: id });
      await waitLive(page);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(id);
      const s = await sample(page);
      expect(contrast(s.faint, s.panel), `${id}: faint on panel >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.faint, s.panel2), `${id}: faint on panel-2 >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.faint, s.bg), `${id}: faint on background >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.dim, s.panel), `${id}: dim on panel >= 4.5`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.faint, s.panel), `${id}: faint stays dimmer than dim`).toBeLessThan(contrast(s.dim, s.panel));
      expect(contrast(s.lineStrong, s.panel), `${id}: field border on panel >= 3`).toBeGreaterThanOrEqual(3);
      expect(contrast(s.lineStrong, s.bg), `${id}: field border on background >= 3`).toBeGreaterThanOrEqual(3);
    });
  }
});
