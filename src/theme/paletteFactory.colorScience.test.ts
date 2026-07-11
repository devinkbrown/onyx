// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './contrast';
import {
  AA_PAIRS,
  DEFAULT_SEED,
  auditPalette,
  enforceAA,
  generatePalette,
  oklchToRgb,
  rgbToHex,
  rgbToOklch,
  type Oklch,
  type PaletteSeed,
} from './paletteFactory';
import type { TokenMap } from './themes';

const BANNED_HUE_MIN = 258;
const BANNED_HUE_MAX = 342;
const MEANINGFUL_CHROMA = 0.03;

function hueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function expectRgbInRange(rgb: { r: number; g: number; b: number }): void {
  for (const channel of [rgb.r, rgb.g, rgb.b]) {
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(channel).toBeLessThanOrEqual(255);
  }
}

function requiredHex(tokens: TokenMap, key: string): string {
  const value = tokens[key];
  expect(value, `${key} should be present`).toBeTruthy();
  return value!;
}

function requiredRgb(tokens: TokenMap, key: string) {
  const rgb = parseHex(requiredHex(tokens, key));
  expect(rgb, `${key} should be a resolved hex color`).not.toBeNull();
  return rgb!;
}

describe('paletteFactory color science invariants', () => {
  it('round-trips low-chroma OKLCH samples through sRGB within quantization tolerance', () => {
    const samples: Oklch[] = [
      { l: 0.18, c: 0.018, h: 18 },
      { l: 0.32, c: 0.026, h: 84 },
      { l: 0.48, c: 0.035, h: 156 },
      { l: 0.64, c: 0.032, h: 218 },
      { l: 0.78, c: 0.024, h: 352 },
      { l: 0.92, c: 0.012, h: 44 },
    ];

    for (const sample of samples) {
      const rgb = oklchToRgb(sample);
      const roundTripped = rgbToOklch(rgb);

      expectRgbInRange(rgb);
      expect(Math.abs(roundTripped.l - sample.l), `L for ${JSON.stringify(sample)}`).toBeLessThanOrEqual(0.006);
      expect(Math.abs(roundTripped.c - sample.c), `C for ${JSON.stringify(sample)}`).toBeLessThanOrEqual(0.01);
      expect(hueDistance(roundTripped.h, sample.h), `H for ${JSON.stringify(sample)}`).toBeLessThanOrEqual(15);
    }
  });

  it('clamps out-of-gamut and extreme lightness inputs to valid sRGB colors', () => {
    const highChroma = oklchToRgb({ l: 0.58, c: 1.4, h: 34 });
    const belowBlack = oklchToRgb({ l: -0.5, c: 0, h: 120 });
    const aboveWhite = oklchToRgb({ l: 1.5, c: 0, h: 240 });

    expectRgbInRange(highChroma);
    expect(rgbToHex(belowBlack)).toBe('#000000');
    expect(rgbToHex(aboveWhite)).toBe('#ffffff');
    expect(rgbToOklch(highChroma).c).toBeLessThan(1.4);
  });

  it('keeps zero-chroma colors grayscale regardless of hue', () => {
    for (const hue of [0, 90, 180, 270, 359]) {
      const rgb = oklchToRgb({ l: 0.55, c: 0, h: hue });
      expect(Math.abs(rgb.r - rgb.g), `red/green at hue ${hue}`).toBeLessThanOrEqual(1);
      expect(Math.abs(rgb.g - rgb.b), `green/blue at hue ${hue}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('paletteFactory AA enforcement and audit contracts', () => {
  it('enforceAA repairs every audited pair to its declared contrast floor', () => {
    const base = generatePalette(DEFAULT_SEED);
    const lowContrast: TokenMap = {
      ...base,
      '--washi': requiredHex(base, '--ink'),
      '--washi-dim': requiredHex(base, '--ink'),
      '--washi-mute': requiredHex(base, '--ink'),
      '--lapis-bright': requiredHex(base, '--ink'),
      '--gold-bright': requiredHex(base, '--ink'),
      '--ok': requiredHex(base, '--ink'),
      '--shu-bright': requiredHex(base, '--ink'),
    };

    const fixed = enforceAA(lowContrast, 'dark');

    for (const [fg, bg, min] of AA_PAIRS) {
      const ratio = contrastRatio(requiredRgb(fixed, fg), requiredRgb(fixed, bg));
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('auditPalette fails a deliberately low-contrast palette and passes a generated good palette', () => {
    const good = generatePalette(DEFAULT_SEED);
    const bad: TokenMap = {
      ...good,
      '--washi': requiredHex(good, '--ink'),
      '--washi-dim': requiredHex(good, '--ink'),
      '--washi-mute': requiredHex(good, '--ink'),
      '--lapis-bright': requiredHex(good, '--ink'),
      '--gold-bright': requiredHex(good, '--ink'),
      '--ok': requiredHex(good, '--ink'),
      '--shu-bright': requiredHex(good, '--ink'),
    };

    expect(auditPalette(good).every((row) => row.pass)).toBe(true);

    const failedRows = auditPalette(bad).filter((row) => !row.pass);
    expect(failedRows.map((row) => `${row.fg}/${row.bg}`)).toEqual(AA_PAIRS.map(([fg, bg]) => `${fg}/${bg}`));
  });
});

describe('paletteFactory deterministic generation and hue bans', () => {
  it('generates identical token maps from identical seeds', () => {
    const seed: PaletteSeed = {
      scheme: 'light',
      primaryHue: 310,
      accentHue: 286,
      depth: 0.35,
      vibrancy: 0.82,
      warmth: -0.3,
      contrast: 9.25,
    };

    expect(generatePalette(seed)).toEqual(generatePalette(seed));
  });

  it('keeps meaningful generated hex colors out of the banned indigo-purple band', () => {
    const palette = generatePalette({
      ...DEFAULT_SEED,
      primaryHue: 300,
      accentHue: 318,
      vibrancy: 1,
      warmth: 1,
    });

    for (const [key, value] of Object.entries(palette)) {
      const rgb = parseHex(value);
      if (!rgb) continue;

      const ok = rgbToOklch(rgb);
      const isBannedHue = ok.h >= BANNED_HUE_MIN && ok.h <= BANNED_HUE_MAX;
      expect(isBannedHue && ok.c > MEANINGFUL_CHROMA, `${key} hue ${ok.h} chroma ${ok.c}`).toBe(false);
    }
  });
});
