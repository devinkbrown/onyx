// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseHex, contrastRatio } from './contrast';
import {
  rgbToOklch,
  oklchToRgb,
  hexToOklch,
  generatePalette,
  adjustPalette,
  auditPalette,
  enforceAA,
  randomSeed,
  seedFromTokens,
  DEFAULT_SEED,
  type PaletteSeed,
} from './paletteFactory';

describe('OKLCH ⇄ sRGB', () => {
  it('round-trips primary/secondary colours within 2 levels', () => {
    for (const hex of ['#2bb4f0', '#e0413a', '#17a05c', '#d98a1f', '#ece8e0', '#02060d']) {
      const rgb = parseHex(hex)!;
      const back = oklchToRgb(rgbToOklch(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(2);
    }
  });

  it('clamps out-of-gamut chroma instead of producing garbage', () => {
    // Absurd chroma at mid lightness — must still yield a valid in-range colour.
    const rgb = oklchToRgb({ l: 0.6, c: 0.9, h: 30 });
    for (const ch of [rgb.r, rgb.g, rgb.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
  });

  it('hexToOklch returns null for var()/color-mix values', () => {
    expect(hexToOklch('var(--lapis)')).toBeNull();
    expect(hexToOklch('color-mix(in oklab, red 40%, transparent)')).toBeNull();
  });
});

describe('generatePalette', () => {
  it('produces a full token set with every accent + ground', () => {
    const t = generatePalette(DEFAULT_SEED);
    for (const key of ['--ink', '--stone', '--lapis', '--lapis-bright', '--gold', '--shu', '--washi', '--ok', '--seam']) {
      expect(t[key], key).toBeTruthy();
    }
  });

  it('guarantees washi passes AA on the ground it generates (dark + light)', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const t = generatePalette({ ...DEFAULT_SEED, scheme, primaryHue: 232 });
      const washi = parseHex(t['--washi']!)!;
      const ink = parseHex(t['--ink']!)!;
      const stone = parseHex(t['--stone']!)!;
      expect(contrastRatio(washi, ink)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(washi, stone)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every generated pair passes its AA floor via auditPalette', () => {
    for (const hue of [12, 90, 158, 205, 320]) {
      const t = generatePalette({ ...DEFAULT_SEED, primaryHue: hue, accentHue: hue + 30 });
      const rows = auditPalette(t);
      const fails = rows.filter((r) => !r.pass);
      expect(fails, `hue ${hue}: ${fails.map((f) => `${f.fg}/${f.bg}=${f.ratio}`).join(', ')}`).toHaveLength(0);
    }
  });

  it('never emits a purple/indigo primary or accent', () => {
    for (const hue of [270, 285, 300, 320, 335]) {
      const t = generatePalette({ ...DEFAULT_SEED, primaryHue: hue, accentHue: hue });
      const p = hexToOklch(t['--lapis']!)!;
      const banned = p.h >= 258 && p.h <= 342 && p.c > 0.03;
      expect(banned, `lapis hue ${p.h}`).toBe(false);
    }
  });

  it('never emits a purple/indigo GROUND or TEXT hue, even with warmth near the band edge', () => {
    // The primary/accent snap to the band edge (254 / 346), but the ground and
    // text hues are derived by adding a warmth shift (±12° ground, ±18° text)
    // AFTER the snap — so they must be re-checked against the ban, or a warm
    // seed near the edge drags the neutral grounds/text back into the arc.
    const keys = ['--ink', '--stone', '--stone-2', '--stone-3', '--stone-line', '--washi', '--washi-dim', '--washi-mute'];
    // Worst cases: primary snaps to the band edge, then a strong warmth nudge
    // (±12° ground / ±18° text) would otherwise carry the derived hues 3–11°
    // INTO the arc at chroma well past the 0.03 "meaningful colour" line.
    const seeds: PaletteSeed[] = [
      { ...DEFAULT_SEED, primaryHue: 260, warmth: 1, vibrancy: 1 },
      { ...DEFAULT_SEED, primaryHue: 262, warmth: 0.4, vibrancy: 1 },
      { ...DEFAULT_SEED, primaryHue: 338, warmth: -1, vibrancy: 1 },
      { ...DEFAULT_SEED, primaryHue: 344, warmth: -0.4, vibrancy: 1 },
    ];
    for (const seed of seeds) {
      const t = generatePalette(seed);
      for (const k of keys) {
        const ok = hexToOklch(t[k]!)!;
        const banned = ok.h >= 258 && ok.h <= 342 && ok.c > 0.03;
        expect(banned, `${k} hue ${ok.h.toFixed(1)} c ${ok.c.toFixed(3)}`).toBe(false);
      }
    }
  });

  it('dark scheme grounds are dark, light scheme grounds are light', () => {
    const dark = hexToOklch(generatePalette({ ...DEFAULT_SEED, scheme: 'dark' })['--ink']!)!;
    const light = hexToOklch(generatePalette({ ...DEFAULT_SEED, scheme: 'light' })['--ink']!)!;
    expect(dark.l).toBeLessThan(0.2);
    expect(light.l).toBeGreaterThan(0.9);
  });
});

describe('adjustPalette', () => {
  const base = generatePalette(DEFAULT_SEED);

  it('hue rotation moves accent hues by ~the requested amount', () => {
    // Rotate within the safe (non-purple) arc: green 100° → teal 160°, so the
    // hue-ban snap never clamps the result.
    const green = generatePalette({ ...DEFAULT_SEED, primaryHue: 100, accentHue: 130 });
    const rotated = adjustPalette(green, { hueShift: 60 }, 'dark');
    const before = hexToOklch(green['--lapis']!)!.h;
    const after = hexToOklch(rotated['--lapis']!)!.h;
    const delta = ((after - before + 540) % 360) - 180;
    expect(Math.abs(delta)).toBeGreaterThan(40); // ~60, allowing for gamut snapping
  });

  it('saturation 0 yields near-greyscale accents', () => {
    const grey = adjustPalette(base, { saturation: 0 }, 'dark');
    expect(hexToOklch(grey['--lapis']!)!.c).toBeLessThan(0.02);
  });

  it('leaves var()/color-mix and non-colour tokens untouched', () => {
    const out = adjustPalette({ ...base, '--seam': 'var(--lapis)', '--dur': '260ms' }, { hueShift: 90 }, 'dark');
    expect(out['--seam']).toBe('var(--lapis)');
    expect(out['--dur']).toBe('260ms');
  });

  it('does not push text below AA when raising contrast', () => {
    const out = adjustPalette(base, { contrast: 0.5 }, 'dark');
    const washi = parseHex(out['--washi']!)!;
    const ink = parseHex(out['--ink']!)!;
    expect(contrastRatio(washi, ink)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('enforceAA', () => {
  it('repairs a deliberately low-contrast text token', () => {
    const broken = { ...generatePalette(DEFAULT_SEED), '--washi': '#232a33' }; // too dark on dark ink
    const fixed = enforceAA(broken, 'dark');
    const washi = parseHex(fixed['--washi']!)!;
    const ink = parseHex(fixed['--ink']!)!;
    expect(contrastRatio(washi, ink)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('randomSeed', () => {
  it('is reproducible for a given numeric seed', () => {
    expect(randomSeed(42)).toEqual(randomSeed(42));
  });

  it('avoids the purple/indigo band for primary and accent', () => {
    for (let s = 0; s < 60; s += 1) {
      const seed: PaletteSeed = randomSeed(s);
      for (const h of [seed.primaryHue, seed.accentHue]) {
        expect(h >= 258 && h <= 342, `seed ${s} hue ${h}`).toBe(false);
      }
    }
  });

  it('generates AA-clean palettes for many random seeds', () => {
    for (let s = 0; s < 40; s += 1) {
      const t = generatePalette(randomSeed(s));
      expect(auditPalette(t).every((r) => r.pass), `seed ${s}`).toBe(true);
    }
  });
});

describe('seedFromTokens', () => {
  it('recovers a seed whose regenerated primary hue is close to the source', () => {
    const original = generatePalette({ ...DEFAULT_SEED, primaryHue: 150, accentHue: 180 });
    const seed = seedFromTokens(original, 'dark');
    expect(Math.abs(((seed.primaryHue - 150 + 540) % 360) - 180)).toBeLessThan(12);
  });
});
