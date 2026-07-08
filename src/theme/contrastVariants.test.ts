/**
 * contrastVariants.test.ts - behavior coverage for OKLCH contrast variants.
 */

import { describe, expect, it } from 'vitest';
import type { Oklch } from '@/theme';
import { contrastRatio, highContrastFg, needsBoost } from '@/theme/contrastVariants';

const AAA_RATIO = 7;

describe('highContrastFg', () => {
  it('raises a foreground to AAA on a light background', () => {
    const bg: Oklch = { l: 0.95, c: 0.018, h: 210 };
    const fg: Oklch = { l: 0.72, c: 0.12, h: 200 };

    const result = highContrastFg(fg, bg);

    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(AAA_RATIO);
    expect(result.l).toBeLessThan(fg.l);
    expect(result.h).toBe(fg.h);
  });

  it('raises a foreground to AAA on a dark background', () => {
    const bg: Oklch = { l: 0.12, c: 0.025, h: 230 };
    const fg: Oklch = { l: 0.36, c: 0.14, h: 45 };

    const result = highContrastFg(fg, bg);

    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(AAA_RATIO);
    expect(result.l).toBeGreaterThan(fg.l);
    expect(result.h).toBe(fg.h);
  });

  it('does not mutate the input foreground', () => {
    const bg: Oklch = { l: 0.92, c: 0.015, h: 190 };
    const fg: Oklch = { l: 0.6, c: 0.2, h: 82 };
    const original = { ...fg };

    const result = highContrastFg(fg, bg);

    expect(fg).toEqual(original);
    expect(result).not.toBe(fg);
  });

  it('leaves an already high-contrast pair unchanged', () => {
    const bg: Oklch = { l: 0.08, c: 0, h: 240 };
    const fg: Oklch = { l: 0.96, c: 0, h: 240 };

    const result = highContrastFg(fg, bg);

    expect(result).toEqual(fg);
    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(AAA_RATIO);
  });
});

describe('needsBoost', () => {
  it('is false at the exact ratio boundary and true below it', () => {
    const bg: Oklch = { l: 0, c: 0, h: 0 };
    const fg: Oklch = { l: 1, c: 0, h: 0 };
    const ratio = contrastRatio(fg, bg);

    expect(needsBoost(fg, bg, ratio)).toBe(false);
    expect(needsBoost(fg, bg, ratio + 0.01)).toBe(true);
  });
});
