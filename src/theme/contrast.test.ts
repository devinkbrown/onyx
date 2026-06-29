import { describe, expect, it } from 'vitest';
import {
  parseHex,
  parseRgb,
  parseColor,
  relativeLuminance,
  contrastRatio,
  wcagRating,
} from './contrast';

describe('parseHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#02060d')).toEqual({ r: 2, g: 6, b: 13 });
    expect(parseHex('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('expands 3-digit shorthand', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#0a0')).toEqual({ r: 0, g: 170, b: 0 });
  });
  it('ignores 8-digit alpha', () => {
    expect(parseHex('#0102030f')).toEqual({ r: 1, g: 2, b: 3 });
  });
  it('rejects non-hex', () => {
    expect(parseHex('oklch(50% 0.1 250)')).toBeNull();
    expect(parseHex('not-a-color')).toBeNull();
    expect(parseHex('#12')).toBeNull();
  });
});

describe('parseRgb', () => {
  it('parses modern + legacy rgb()', () => {
    expect(parseRgb('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseRgb('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseRgb('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });
  it('rejects out-of-range / garbage', () => {
    expect(parseRgb('rgb(300, 0, 0)')).toBeNull();
    expect(parseRgb('hsl(1,2,3)')).toBeNull();
  });
});

describe('parseColor', () => {
  it('falls through hex then rgb', () => {
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor('rgb(255 255 255)')).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };

  it('black vs white is the 21:1 maximum', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 2);
  });
  it('is symmetric (order-independent)', () => {
    expect(contrastRatio(black, white)).toBe(contrastRatio(white, black));
  });
  it('identical colours are 1:1', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });
  it('matches the classic #767676-on-white AA boundary (~4.54)', () => {
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, white)).toBeCloseTo(4.54, 1);
  });
});

describe('wcagRating', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };

  it('rates max contrast AAA', () => {
    const r = wcagRating(white, black);
    expect(r.level).toBe('AAA');
    expect(r.passesAA).toBe(true);
    expect(r.passesAAA).toBe(true);
    expect(r.ratio).toBeCloseTo(21, 1);
  });

  it('rates a low-contrast pair Fail', () => {
    const r = wcagRating({ r: 80, g: 80, b: 80 }, black);
    expect(r.level).toBe('Fail');
    expect(r.passesAA).toBe(false);
  });

  it('rates a UI-only pass as AA Large (>=3, <4.5)', () => {
    // gray 103 on black is ~3.7 — between the large-text (3) and normal (4.5) bars
    const r = wcagRating({ r: 103, g: 103, b: 103 }, black);
    expect(r.passesLargeAA).toBe(true);
    expect(r.passesAA).toBe(false);
    expect(r.level).toBe('AA Large');
  });

  it('rounds the ratio to two decimals', () => {
    const r = wcagRating(white, black);
    expect(Number.isFinite(r.ratio)).toBe(true);
    expect(r.ratio).toBe(Math.round(r.ratio * 100) / 100);
  });
});
