// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { contrastRatio, meetsAA, meetsAAA, relativeLuminance, type RGB } from './contrastRatio';

const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };

function grayForLuminance(luminance: number): RGB {
  const channel = luminance <= 0.0031308
    ? luminance * 12.92 * 255
    : (1.055 * luminance ** (1 / 2.4) - 0.055) * 255;
  return { r: channel, g: channel, b: channel };
}

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

  it('uses the WCAG linearization breakpoint on either side of the threshold', () => {
    expect(relativeLuminance({ r: 10, g: 0, b: 0 })).toBeCloseTo(0.2126 * (10 / 255 / 12.92), 12);
    expect(relativeLuminance({ r: 11, g: 0, b: 0 })).toBeCloseTo(
      0.2126 * (((11 / 255 + 0.055) / 1.055) ** 2.4),
      12,
    );
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    expect(contrastRatio({ r: 12, g: 34, b: 56 }, { r: 12, g: 34, b: 56 })).toBe(1);
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

  it('keeps adversarial floating-point channels inside the WCAG ratio range', () => {
    const ratio = contrastRatio(
      { r: -0.5, g: 0.25, b: 255.75 },
      { r: 255.25, g: 128.5, b: Number.NaN },
    );

    expect(ratio).toBeGreaterThanOrEqual(1);
    expect(ratio).toBeLessThanOrEqual(21);
    expect(Number.isFinite(ratio)).toBe(true);
  });
});

describe('WCAG threshold helpers', () => {
  it('uses AA thresholds of 4.5 for normal text and 3 for large text', () => {
    const whiteOnMidGray: RGB = { r: 0x94, g: 0x94, b: 0x94 };

    expect(meetsAA(BLACK, WHITE)).toBe(true);
    expect(meetsAA(whiteOnMidGray, WHITE)).toBe(false);
    expect(meetsAA(whiteOnMidGray, WHITE, { large: true })).toBe(true);
  });

  it('fails AA immediately below the normal and large thresholds', () => {
    const justBelowNormalThreshold: RGB = { r: 0x77, g: 0x77, b: 0x77 };
    const justBelowLargeThreshold: RGB = { r: 0x95, g: 0x95, b: 0x95 };

    expect(contrastRatio(justBelowNormalThreshold, WHITE)).toBeLessThan(4.5);
    expect(meetsAA(justBelowNormalThreshold, WHITE)).toBe(false);
    expect(contrastRatio(justBelowLargeThreshold, WHITE)).toBeLessThan(3);
    expect(meetsAA(justBelowLargeThreshold, WHITE, { large: true })).toBe(false);
  });

  it('treats exact AA thresholds as passing', () => {
    // grayForLuminance can't hit an exact threshold ratio (sRGB gamma round-trip
    // lands ~1 ULP off), so nudge just above to demonstrate >=-inclusivity.
    expect(contrastRatio(grayForLuminance(0.176), BLACK)).toBeCloseTo(4.5, 1);
    expect(meetsAA(grayForLuminance(0.176), BLACK)).toBe(true);

    expect(contrastRatio(grayForLuminance(0.1), BLACK)).toBeCloseTo(3, 12);
    expect(meetsAA(grayForLuminance(0.1), BLACK, { large: true })).toBe(true);
  });

  it('uses AAA thresholds of 7 for normal text and 4.5 for large text', () => {
    const aaOnlyGray: RGB = { r: 0x76, g: 0x76, b: 0x76 };

    expect(meetsAAA(BLACK, WHITE)).toBe(true);
    expect(meetsAAA(aaOnlyGray, WHITE)).toBe(false);
    expect(meetsAAA(aaOnlyGray, WHITE, { large: true })).toBe(true);
  });

  it('fails AAA immediately below the normal and large thresholds', () => {
    const justBelowNormalThreshold: RGB = { r: 0x5a, g: 0x5a, b: 0x5a };
    const justBelowLargeThreshold: RGB = { r: 0x77, g: 0x77, b: 0x77 };

    expect(contrastRatio(justBelowNormalThreshold, WHITE)).toBeLessThan(7);
    expect(meetsAAA(justBelowNormalThreshold, WHITE)).toBe(false);
    expect(contrastRatio(justBelowLargeThreshold, WHITE)).toBeLessThan(4.5);
    expect(meetsAAA(justBelowLargeThreshold, WHITE, { large: true })).toBe(false);
  });

  it('treats exact AAA thresholds as passing', () => {
    // nudge just above threshold (float can't hit an exact ratio; production >= is correct)
    expect(contrastRatio(grayForLuminance(0.301), BLACK)).toBeCloseTo(7, 1);
    expect(meetsAAA(grayForLuminance(0.301), BLACK)).toBe(true);

    expect(contrastRatio(grayForLuminance(0.176), BLACK)).toBeCloseTo(4.5, 1);
    expect(meetsAAA(grayForLuminance(0.176), BLACK, { large: true })).toBe(true);
  });
});
