// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './contrast';
import {
  DEFAULT_SEED,
  auditPalette,
  enforceAA,
  generatePalette,
  hexToOklch,
  type PaletteSeed,
} from './paletteFactory';
import type { TokenMap } from './themes';

const BANNED_HUE_MIN = 258;
const BANNED_HUE_MAX = 342;
const MEANINGFUL_CHROMA = 0.03;

function expectNoMeaningfulBannedHues(tokens: TokenMap): void {
  for (const [key, value] of Object.entries(tokens)) {
    const ok = hexToOklch(value);
    if (!ok || ok.c <= MEANINGFUL_CHROMA) continue;

    const isBanned = ok.h >= BANNED_HUE_MIN && ok.h <= BANNED_HUE_MAX;
    expect(isBanned, `${key} emitted banned hue ${ok.h.toFixed(2)} at chroma ${ok.c.toFixed(3)}`).toBe(false);
  }
}

function auditFailures(tokens: TokenMap): string[] {
  return auditPalette(tokens)
    .filter((row) => !row.pass)
    .map((row) => `${row.fg} on ${row.bg}: ${row.ratio} < ${row.min}`);
}

describe('paletteFactory adversarial contracts', () => {
  it('generated edge palettes pass auditPalette for both schemes', () => {
    const seeds: PaletteSeed[] = [
      {
        ...DEFAULT_SEED,
        scheme: 'dark',
        primaryHue: 258,
        accentHue: 342,
        depth: 1,
        vibrancy: 1,
        warmth: 1,
        contrast: 21,
      },
      {
        ...DEFAULT_SEED,
        scheme: 'light',
        primaryHue: 300,
        accentHue: 318,
        depth: 0,
        vibrancy: 1,
        warmth: -1,
        contrast: 4.5,
      },
      {
        ...DEFAULT_SEED,
        scheme: 'dark',
        primaryHue: -102,
        accentHue: 702,
        depth: -4,
        vibrancy: 5,
        warmth: 9,
        contrast: 1,
      },
      {
        ...DEFAULT_SEED,
        scheme: 'light',
        primaryHue: 660,
        accentHue: -42,
        depth: 4,
        vibrancy: -2,
        warmth: -9,
        contrast: 99,
      },
    ];

    for (const seed of seeds) {
      const palette = generatePalette(seed);
      expect(auditFailures(palette), `${seed.scheme} ${seed.primaryHue}/${seed.accentHue}`).toEqual([]);
    }
  });

  it('normalizes banned-hue seeds before emitting meaningful generated colors', () => {
    const bannedSeeds: PaletteSeed[] = [
      { ...DEFAULT_SEED, primaryHue: 258, accentHue: 258, vibrancy: 1, warmth: 1 },
      { ...DEFAULT_SEED, primaryHue: 300, accentHue: 320, vibrancy: 1, warmth: -1 },
      { ...DEFAULT_SEED, primaryHue: 342, accentHue: 342, vibrancy: 1, warmth: -1 },
      { ...DEFAULT_SEED, scheme: 'light', primaryHue: 286, accentHue: 334, vibrancy: 1, warmth: 1 },
    ];

    for (const seed of bannedSeeds) {
      expectNoMeaningfulBannedHues(generatePalette(seed));
    }
  });

  it('enforceAA raises a failing audited pair to its AA floor', () => {
    const broken: TokenMap = {
      ...generatePalette(DEFAULT_SEED),
      '--washi': '#1d232b',
    };
    const washiBefore = parseHex(broken['--washi']!)!;
    const ink = parseHex(broken['--ink']!)!;
    const beforeRatio = contrastRatio(washiBefore, ink);

    expect(beforeRatio).toBeLessThan(4.5);

    const fixed = enforceAA(broken, 'dark');
    const washiAfter = parseHex(fixed['--washi']!)!;
    const afterRatio = contrastRatio(washiAfter, ink);
    const auditRow = auditPalette(fixed).find((row) => row.fg === '--washi' && row.bg === '--ink');

    expect(afterRatio).toBeGreaterThan(beforeRatio);
    expect(auditRow).toMatchObject({ min: 4.5, pass: true });
    expect(afterRatio).toBeGreaterThanOrEqual(4.5);
  });
});
