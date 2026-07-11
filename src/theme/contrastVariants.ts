// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * contrastVariants.ts - pure OKLCH foreground contrast variant helpers.
 */

import { contrastRatio as rgbContrastRatio } from '@/theme/contrast';
import { oklchToRgb, rgbToOklch, type Oklch } from '@/theme/paletteFactory';

const DEFAULT_TARGET_RATIO = 7;
const DEFAULT_MIN_RATIO = 4.5;
const MIN_LIGHTNESS = 0;
const MAX_LIGHTNESS = 1;
const SEARCH_STEPS = 32;
const GAMUT_STEPS = 24;
const CHROMA_EPSILON = 0.002;

export function contrastRatio(a: Oklch, b: Oklch): number {
  return rgbContrastRatio(oklchToRgb(a), oklchToRgb(b));
}

export function highContrastFg(fg: Oklch, bg: Oklch, targetRatio = DEFAULT_TARGET_RATIO): Oklch {
  const target = normalizeRatio(targetRatio, DEFAULT_TARGET_RATIO);
  const base = colorAtLightness(fg, fg.l);
  const baseRatio = contrastRatio(base, bg);
  if (baseRatio >= target) return base;

  const darkEndpoint = colorAtLightness(fg, MIN_LIGHTNESS);
  const lightEndpoint = colorAtLightness(fg, MAX_LIGHTNESS);
  const darkRatio = contrastRatio(darkEndpoint, bg);
  const lightRatio = contrastRatio(lightEndpoint, bg);
  const shouldLighten = lightRatio >= darkRatio;
  const endpoint = shouldLighten ? lightEndpoint : darkEndpoint;
  const endpointRatio = shouldLighten ? lightRatio : darkRatio;

  if (endpointRatio < target) return endpoint;

  const l = shouldLighten
    ? searchLighterLightness(fg, bg, base.l, target)
    : searchDarkerLightness(fg, bg, base.l, target);
  return colorAtLightness(fg, l);
}

export function needsBoost(fg: Oklch, bg: Oklch, minRatio = DEFAULT_MIN_RATIO): boolean {
  return contrastRatio(fg, bg) < normalizeRatio(minRatio, DEFAULT_MIN_RATIO);
}

function searchLighterLightness(fg: Oklch, bg: Oklch, startL: number, target: number): number {
  let lo = clamp(startL, MIN_LIGHTNESS, MAX_LIGHTNESS);
  let hi = MAX_LIGHTNESS;
  let passing = hi;

  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(colorAtLightness(fg, mid), bg) >= target) {
      passing = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return passing;
}

function searchDarkerLightness(fg: Oklch, bg: Oklch, startL: number, target: number): number {
  let lo = MIN_LIGHTNESS;
  let hi = clamp(startL, MIN_LIGHTNESS, MAX_LIGHTNESS);
  let passing = lo;

  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(colorAtLightness(fg, mid), bg) >= target) {
      passing = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return passing;
}

function colorAtLightness(color: Oklch, l: number): Oklch {
  const lightness = clamp(l, MIN_LIGHTNESS, MAX_LIGHTNESS);
  return {
    l: lightness,
    c: gamutSafeChroma(lightness, color.c, color.h),
    h: color.h,
  };
}

function gamutSafeChroma(l: number, c: number, h: number): number {
  const chroma = Math.max(0, c);
  if (chroma === 0) return 0;
  if (isChromaRepresentable({ l, c: chroma, h })) return chroma;

  let lo = 0;
  let hi = chroma;
  for (let i = 0; i < GAMUT_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (isChromaRepresentable({ l, c: mid, h })) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function isChromaRepresentable(color: Oklch): boolean {
  const roundTripped = rgbToOklch(oklchToRgb(color));
  return roundTripped.c + CHROMA_EPSILON >= color.c;
}

function normalizeRatio(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
