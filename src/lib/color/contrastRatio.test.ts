import { describe, expect, it } from 'vitest';

import { contrastRatio, meetsAA, meetsAAA, relativeLuminance, type RGB } from './contrastRatio';

const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };

describe('relativeLuminance', () => {
  it('returns WCAG endpoint luminance values for black and white', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBe(1);
  });

  it('clamps out-of-range channels before linearization', () => {
    expect(relativeLuminance({ r: -12, g: 300, b: 0 })).toBeCloseTo(
      relativeLuminance({ r: 0, g: 255, b: 0 }),
      12,
    );
  });

  it('guards non-finite channels to keep output deterministic', () => {
    expect(relativeLuminance({ r: Number.NaN, g: Number.POSITIVE_INFINITY, b: Number.NEGATIVE_INFINITY })).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
  });

  it('returns 1 for white on white', () => {
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
  });

  it('matches known WCAG reference pairs', () => {
    expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio({ r: 0x94, g: 0x94, b: 0x94 }, WHITE)).toBeCloseTo(3.03, 2);
  });

  it('is symmetric', () => {
    const foreground: RGB = { r: 37, g: 98, b: 164 };
    const background: RGB = { r: 244, g: 232, b: 191 };

    expect(contrastRatio(foreground, background)).toBeCloseTo(contrastRatio(background, foreground), 12);
  });

  it('normalizes invalid foreground and background channels', () => {
    expect(contrastRatio({ r: -1, g: -1, b: -1 }, { r: 256, g: 256, b: 256 })).toBe(21);
    expect(contrastRatio({ r: Number.NaN, g: 255, b: 255 }, BLACK)).toBeGreaterThan(16);
  });
});

describe('WCAG threshold helpers', () => {
  it('uses AA thresholds of 4.5 for normal text and 3 for large text', () => {
    const whiteOnMidGray: RGB = { r: 0x94, g: 0x94, b: 0x94 };

    expect(meetsAA(BLACK, WHITE)).toBe(true);
    expect(meetsAA(whiteOnMidGray, WHITE)).toBe(false);
    expect(meetsAA(whiteOnMidGray, WHITE, { large: true })).toBe(true);
  });

  it('uses AAA thresholds of 7 for normal text and 4.5 for large text', () => {
    const aaOnlyGray: RGB = { r: 0x76, g: 0x76, b: 0x76 };

    expect(meetsAAA(BLACK, WHITE)).toBe(true);
    expect(meetsAAA(aaOnlyGray, WHITE)).toBe(false);
    expect(meetsAAA(aaOnlyGray, WHITE, { large: true })).toBe(true);
  });
});
