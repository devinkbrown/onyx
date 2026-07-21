// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * highContrastTheme.test.ts — the per-theme high-contrast derivation must be a
 * mechanical transform of each theme's OWN palette (not one static override),
 * and must never drop a pair below the base palette's AA guarantee.
 */

import { describe, expect, it } from 'vitest';

import { HIGH_CONTRAST_PAIRS, highContrastOverrides } from './highContrastTheme';
import { THEME_IDS, THEMES } from './themes';
import { auditPalette, hexToOklch } from './paletteFactory';
import { contrastRatio, parseHex } from './contrast';

const HEX = /^#[0-9a-f]{6}$/;

function boosted(id: (typeof THEME_IDS)[number]): Record<string, string> {
  return { ...THEMES[id].tokens, ...highContrastOverrides(THEMES[id].tokens) };
}

describe('highContrastOverrides — per-theme derivation', () => {
  it('emits valid hex for every covered foreground in every theme', () => {
    for (const id of THEME_IDS) {
      const overrides = highContrastOverrides(THEMES[id].tokens);
      for (const [prop, value] of Object.entries(overrides)) {
        expect(value, `${id} ${prop}`).toMatch(HEX);
      }
    }
  });

  it('preserves each foreground hue (an L/C transform, not a re-hue)', () => {
    for (const id of THEME_IDS) {
      const base = THEMES[id].tokens;
      const overrides = highContrastOverrides(base);
      for (const [prop, value] of Object.entries(overrides)) {
        const before = hexToOklch(base[prop]!)!;
        const after = hexToOklch(value)!;
        // highContrastFg preserves hue exactly in OKLCH; only 8-bit hex
        // quantization perturbs it. That noise is meaningful only for the
        // chromatic accents (near-neutral text tokens have no stable hue), so
        // assert hue-lock where the brand hue actually lives.
        if (after.c > 0.05 && before.c > 0.05) {
          expect(Math.abs(after.h - before.h), `${id} ${prop} hue`).toBeLessThan(2);
        }
      }
    }
  });

  it('only ever raises contrast against the worst ground (never lowers it)', () => {
    for (const id of THEME_IDS) {
      const base = THEMES[id].tokens;
      const overrides = highContrastOverrides(base);
      for (const { fg, grounds } of HIGH_CONTRAST_PAIRS) {
        const boostedHex = overrides[fg];
        if (!boostedHex) continue;
        const baseFg = parseHex(base[fg]!)!;
        const newFg = parseHex(boostedHex)!;
        for (const ground of grounds) {
          const bg = parseHex(base[ground]!)!;
          expect(
            contrastRatio(newFg, bg) + 1e-6,
            `${id} ${fg} vs ${ground}`,
          ).toBeGreaterThanOrEqual(contrastRatio(baseFg, bg));
        }
      }
    }
  });

  it('keeps the whole base AA audit passing after merging the boost', () => {
    for (const id of THEME_IDS) {
      const rows = auditPalette(boosted(id));
      for (const row of rows) {
        expect(row.pass, `${id} ${row.fg}/${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('lifts every text token to at least AA body (4.5) on all its grounds', () => {
    // In high-contrast mode all body/secondary/metadata text must clear the AA
    // body floor (4.5) on every ground it can sit on — a stronger, per-theme
    // guarantee than the base palette (which only floors --paper-mute at 3:1).
    const TEXT = new Set(['--paper', '--paper-dim', '--paper-mute']);
    for (const id of THEME_IDS) {
      const merged = boosted(id);
      for (const { fg, grounds } of HIGH_CONTRAST_PAIRS) {
        if (!TEXT.has(fg)) continue;
        const newFg = parseHex(merged[fg]!)!;
        for (const ground of grounds) {
          const ratio = contrastRatio(newFg, parseHex(merged[ground]!)!);
          expect(ratio, `${id} ${fg} vs ${ground} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    }
  });

  it('derives DIFFERENT boosted foregrounds per theme (not one static override)', () => {
    // Two dark themes with distinct primary hues must yield distinct boosts —
    // proving the variant follows each palette rather than a shared block.
    const a = highContrastOverrides(THEMES.ocean.tokens);
    const b = highContrastOverrides(THEMES.kohaku.tokens);

    // At least one covered foreground differs between the two themes.
    const differs = Object.keys({ ...a, ...b }).some((prop) => a[prop] !== b[prop]);
    expect(differs).toBe(true);

    // The secondary text token is boosted in both, to DIFFERENT values — the
    // signature of a per-palette derivation rather than one shared override.
    expect(a['--paper-dim']).toBeDefined();
    expect(b['--paper-dim']).toBeDefined();
    expect(a['--paper-dim']).not.toBe(b['--paper-dim']);
  });

  it('spans three distinct themes with three distinct --paper-dim boosts', () => {
    const seen = new Set(
      (['ocean', 'shu', 'frost'] as const).map(
        (id) => highContrastOverrides(THEMES[id].tokens)['--paper-dim'],
      ),
    );
    expect(seen.size).toBe(3);
  });
});
