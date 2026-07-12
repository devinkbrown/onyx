// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * home-catchup-label.contrast.test.ts — locks the contrast token used by
 * `.home-catchup-tier-label` (src/shell/home-view.css).
 *
 * The tier-group headings ("Rooms", "Direct messages") are 0.72rem uppercase
 * text — small text under WCAG 2.2 SC 1.4.3, so they need >= 4.5:1 on the
 * Catch-up surface (--stone / --ink). The label previously used
 * `color-mix(in oklab, var(--ink) 55%, transparent)`, which composited the
 * near-black --ink token to ~1:1 and dodged auditPalette (var()/color-mix are
 * skipped). It now uses `var(--washi-dim)`, asserted below to clear 4.5:1 on
 * both surfaces in every shipped theme. --washi-mute would NOT qualify: it
 * only carries a 3:1 floor and measures < 4.5:1 on stone/ink in most themes.
 */
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/theme/themes';
import { parseHex, contrastRatio } from '@/theme/contrast';
import { hexToOklch } from '@/theme/paletteFactory';
import { highContrastFg, contrastRatio as oklchContrastRatio } from '@/theme/contrastVariants';

const AA_NORMAL = 4.5;

/** The token the tier-label CSS resolves to. Change here if the CSS changes. */
const LABEL_TOKEN = '--washi-dim';
const SURFACES = ['--stone', '--ink'] as const;

describe('.home-catchup-tier-label token clears AA on the Catch-up surface', () => {
  for (const [id, meta] of Object.entries(THEMES)) {
    const tokens = meta.tokens;
    const fg = parseHex(tokens[LABEL_TOKEN] ?? '');
    it(`${id} (${meta.scheme}): ${LABEL_TOKEN} >= 4.5:1 on stone + ink`, () => {
      expect(fg).not.toBeNull();
      for (const surface of SURFACES) {
        const bg = parseHex(tokens[surface] ?? '');
        expect(bg, `${surface} must be resolvable hex`).not.toBeNull();
        const ratio = contrastRatio(fg!, bg!);
        expect(
          ratio,
          `${LABEL_TOKEN} on ${surface} in "${id}" = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    });
  }

  it('prefers-contrast: more only raises the ratio (light + dark sample)', () => {
    for (const id of ['pearl', 'ocean'] as const) {
      const tokens = THEMES[id].tokens;
      const fg = hexToOklch(tokens[LABEL_TOKEN] ?? '');
      const bg = hexToOklch(tokens['--stone'] ?? '');
      expect(fg).not.toBeNull();
      expect(bg).not.toBeNull();
      const boosted = highContrastFg(fg!, bg!, 7);
      const base = oklchContrastRatio(fg!, bg!);
      const high = oklchContrastRatio(boosted, bg!);
      expect(high).toBeGreaterThanOrEqual(base);
      expect(high).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
