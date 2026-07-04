/**
 * paletteFactory.ts — the generative engine behind the Theme Studio.
 *
 * The studio used to be a manual per-token editor. This module turns it into a
 * real factory: from a tiny seed (one hue + a few knobs) it derives a full,
 * coherent token map — grounds, accent triads, text, seams — laid out in OKLCH
 * so lightness is perceptually even and text contrast can be guaranteed by
 * construction (AA). It also transforms an existing palette globally (rotate
 * hue, saturate, warm/cool, push contrast) and can auto-repair failing pairs.
 *
 * OKLCH ↔ sRGB uses Björn Ottosson's oklab. Out-of-gamut colours are resolved
 * by reducing chroma until they fit, preserving hue and lightness.
 *
 * Pure + DOM-free so it unit-tests directly. Colours are emitted as #rrggbb.
 */

import { parseHex, contrastRatio, type RGB } from './contrast';
import type { TokenMap } from './themes';

// ---------------------------------------------------------------------------
// sRGB ⇄ OKLCH
// ---------------------------------------------------------------------------

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, 0–~0.37 in sRGB gamut. */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp(s, 0, 1) * 255);
}

/** Linear sRGB → OKLab. */
function linearToOklab(r: number, g: number, b: number): { L: number; a: number; bb: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    bb: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** OKLab → linear sRGB (may be out of [0,1]). */
function oklabToLinear(L: number, a: number, bb: number): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function rgbToOklch(rgb: RGB): Oklch {
  const { L, a, bb } = linearToOklab(srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b));
  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function inGamut(lin: { r: number; g: number; b: number }): boolean {
  const e = 0.0001;
  return lin.r >= -e && lin.r <= 1 + e && lin.g >= -e && lin.g <= 1 + e && lin.b >= -e && lin.b <= 1 + e;
}

/** OKLCH → sRGB, reducing chroma until the colour fits the gamut. */
export function oklchToRgb(color: Oklch): RGB {
  const hr = (color.h * Math.PI) / 180;
  let c = Math.max(0, color.c);
  const L = clamp(color.l, 0, 1);

  // Binary-search the largest chroma that stays in gamut (hue + L preserved).
  let lin = oklabToLinear(L, c * Math.cos(hr), c * Math.sin(hr));
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      lin = oklabToLinear(L, mid * Math.cos(hr), mid * Math.sin(hr));
      if (inGamut(lin)) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklabToLinear(L, c * Math.cos(hr), c * Math.sin(hr));
  }
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) };
}

export function rgbToHex(rgb: RGB): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToOklch(rgb) : null;
}

// ---------------------------------------------------------------------------
// Seed + generation
// ---------------------------------------------------------------------------

export interface PaletteSeed {
  scheme: 'dark' | 'light';
  /** Primary accent hue, degrees. */
  primaryHue: number;
  /** Second accent hue, degrees. */
  accentHue: number;
  /** Ground darkness (dark scheme) / lightness reserve — 0 airy … 1 abyssal. */
  depth: number;
  /** Accent chroma / saturation — 0 muted … 1 electric. */
  vibrancy: number;
  /** Temperature bias of grounds + text, −1 cool … +1 warm. */
  warmth: number;
  /** Text-to-ground contrast target ratio (AA floor 4.5; 7 = AAA). */
  contrast: number;
}

export const DEFAULT_SEED: PaletteSeed = {
  scheme: 'dark',
  primaryHue: 232,
  accentHue: 205,
  depth: 0.72,
  vibrancy: 0.6,
  warmth: 0.05,
  contrast: 8,
};

/**
 * Hue range to avoid per the Onyx identity constraint: the whole indigo →
 * violet → purple → magenta arc (OKLCH ~258°–342°). Blue/cyan/green/amber/red
 * below and rose/pink above stay available. `avoidBannedHue` snaps into range.
 */
const BANNED_HUE = { min: 258, max: 342 };

function avoidBannedHue(h: number): number {
  const hue = ((h % 360) + 360) % 360;
  if (hue < BANNED_HUE.min || hue > BANNED_HUE.max) return hue;
  // Snap to the nearer edge of the banned band.
  return hue - BANNED_HUE.min < BANNED_HUE.max - hue ? BANNED_HUE.min - 4 : BANNED_HUE.max + 4;
}

/**
 * Build a full token map from a seed. Grounds ramp in lightness (tinted toward
 * the primary at low chroma); accent triads sit at the seed hues; text is
 * placed so its contrast on the ground meets the seed target (AA guaranteed).
 */
export function generatePalette(seedInput: PaletteSeed): TokenMap {
  const seed: PaletteSeed = {
    ...seedInput,
    primaryHue: avoidBannedHue(seedInput.primaryHue),
    accentHue: avoidBannedHue(seedInput.accentHue),
    depth: clamp(seedInput.depth, 0, 1),
    vibrancy: clamp(seedInput.vibrancy, 0, 1),
    warmth: clamp(seedInput.warmth, -1, 1),
    contrast: clamp(seedInput.contrast, 4.5, 21),
  };
  const dark = seed.scheme === 'dark';
  const pHue = seed.primaryHue;
  const aHue = seed.accentHue;
  const warmHueShift = seed.warmth * 12; // nudge grounds/text warm(+)/cool(−)
  const groundHue = ((pHue + warmHueShift) % 360 + 360) % 360;
  const groundChroma = 0.014 + 0.02 * seed.vibrancy; // faint tint in the grounds

  // Ground lightness ramp — deepest → highest surface.
  const inkL = dark ? 0.13 - 0.05 * seed.depth : 0.975 - 0.03 * seed.depth;
  const step = dark ? 0.028 + 0.02 * (1 - seed.depth) : -(0.02 + 0.014 * (1 - seed.depth));
  const ground = (i: number, chromaMul = 1): string =>
    oklchToHex({ l: inkL + step * i, c: groundChroma * chromaMul, h: groundHue });

  // Accent triads.
  const pChroma = 0.09 + 0.15 * seed.vibrancy;
  const aChroma = 0.075 + 0.13 * seed.vibrancy;
  const primary = (l: number, cMul = 1): string => oklchToHex({ l, c: pChroma * cMul, h: pHue });
  const accent = (l: number, cMul = 1): string => oklchToHex({ l, c: aChroma * cMul, h: aHue });

  // Text placed for the contrast target on the ink ground.
  const inkRgb = parseHex(ground(0))!;
  const textHue = ((pHue + warmHueShift * 1.5) % 360 + 360) % 360;
  const textChroma = 0.012 + 0.01 * seed.vibrancy;
  const washiL = solveTextLightness(inkRgb, textHue, textChroma, seed.contrast, dark);

  // Vermilion hot accent — a warm red-orange, nudged by warmth, never purple.
  const shuHue = avoidBannedHue(28 + seed.warmth * 6);

  const tokens: TokenMap = {
    '--ink': ground(0),
    '--ink-2': ground(0.55),
    '--stone': ground(2),
    '--stone-2': ground(3.4),
    '--stone-3': ground(4.8),
    '--stone-line': ground(6, 1.4),

    '--lapis': primary(dark ? 0.62 : 0.5),
    '--lapis-bright': primary(dark ? 0.78 : 0.62, 0.9),
    '--lapis-deep': primary(dark ? 0.42 : 0.36, 0.85),

    '--gold': accent(dark ? 0.7 : 0.52),
    '--gold-bright': accent(dark ? 0.83 : 0.62, 0.9),
    '--gold-deep': accent(dark ? 0.5 : 0.4, 0.85),

    '--shu': oklchToHex({ l: dark ? 0.64 : 0.55, c: 0.19, h: shuHue }),
    '--shu-bright': oklchToHex({ l: dark ? 0.74 : 0.62, c: 0.2, h: shuHue }),

    '--washi': oklchToHex({ l: washiL, c: textChroma, h: textHue }),
    '--washi-dim': oklchToHex({ l: dark ? washiL - 0.22 : washiL + 0.2, c: textChroma, h: textHue }),
    '--washi-mute': oklchToHex({ l: dark ? washiL - 0.4 : washiL + 0.38, c: textChroma * 1.4, h: textHue }),

    '--ok': oklchToHex({ l: dark ? 0.75 : 0.58, c: 0.13, h: 158 }),
    '--warn': oklchToHex({ l: dark ? 0.86 : 0.62, c: 0.09, h: 92 }),
    '--danger': 'var(--shu)',

    // Seams follow the PRIMARY hue (never a hard-coded gold) so the chrome reads
    // as the theme's colour.
    '--seam': 'color-mix(in oklab, var(--lapis) 38%, transparent)',
    '--seam-faint': 'color-mix(in oklab, var(--lapis) 15%, transparent)',
    '--line': 'color-mix(in oklab, var(--washi) 14%, transparent)',
    '--line-faint': 'color-mix(in oklab, var(--washi) 7%, transparent)',
  };

  return enforceAA(tokens, seed.scheme);
}

/** Find a text lightness that clears the contrast target against the ground. */
function solveTextLightness(bg: RGB, hue: number, chroma: number, target: number, dark: boolean): number {
  // Text is light on dark schemes, dark on light schemes. Walk L toward the
  // extreme until the ratio clears the target (or we hit the rail).
  let l = dark ? 0.9 : 0.28;
  const dir = dark ? 0.01 : -0.01;
  for (let i = 0; i < 30; i += 1) {
    const rgb = oklchToRgb({ l, c: chroma, h: hue });
    if (contrastRatio(rgb, bg) >= target) return l;
    l = clamp(l + dir, 0, 1);
  }
  return l;
}

// ---------------------------------------------------------------------------
// AA enforcement + audit
// ---------------------------------------------------------------------------

/**
 * Foreground/ground pairs the factory guarantees, mirroring the studio's live
 * ContrastAudit exactly so a generated palette always reads "all pass".
 * Body/secondary text at AA 4.5; de-emphasised metadata and UI accents (links,
 * status, danger) at the 3:1 UI-component / large-text bar. [fg, bg, minRatio]
 */
export const AA_PAIRS: ReadonlyArray<[string, string, number]> = [
  ['--washi', '--ink', 4.5],
  ['--washi', '--stone', 4.5],
  ['--washi', '--stone-2', 4.5],
  ['--washi-dim', '--ink', 4.5],
  ['--washi-mute', '--ink', 3],
  ['--lapis-bright', '--ink', 3],
  ['--gold-bright', '--ink', 3],
  ['--ok', '--ink', 3],
  ['--shu-bright', '--ink', 3],
];

/**
 * Nudge text-token lightness until every AA_PAIR passes. Only text tokens move
 * (washi/dim/mute); accents get a large-text (3:1) floor. Non-hex/var tokens
 * are left untouched.
 */
export function enforceAA(tokens: TokenMap, scheme: 'dark' | 'light'): TokenMap {
  const out: TokenMap = { ...tokens };
  const dark = scheme === 'dark';

  for (const [fg, bg, min] of AA_PAIRS) {
    const bgHex = out[bg];
    const fgHex = out[fg];
    if (!bgHex || !fgHex) continue;
    const bgRgb = parseHex(bgHex);
    const fgOk = hexToOklch(fgHex);
    if (!bgRgb || !fgOk) continue; // skip var()/color-mix tokens

    // Only push the text tokens (washi*) toward the contrast extreme; accents
    // keep their hue and just need the large-text floor, handled the same way.
    let { l } = fgOk;
    const dir = dark ? 0.015 : -0.015;
    for (let i = 0; i < 40; i += 1) {
      if (contrastRatio(oklchToRgb({ ...fgOk, l }), bgRgb) >= min) break;
      l = clamp(l + dir, 0, 1);
    }
    out[fg] = oklchToHex({ ...fgOk, l });
  }
  return out;
}

export interface AuditRow {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Grade every AA pair for a resolved token map (values must be hex). */
export function auditPalette(tokens: TokenMap): AuditRow[] {
  return AA_PAIRS.map(([fg, bg, min]) => {
    const f = parseHex(tokens[fg] ?? '');
    const b = parseHex(tokens[bg] ?? '');
    const ratio = f && b ? Math.round(contrastRatio(f, b) * 100) / 100 : 0;
    return { fg, bg, ratio, min, pass: ratio >= min };
  });
}

// ---------------------------------------------------------------------------
// Global transforms (operate on an existing palette)
// ---------------------------------------------------------------------------

export interface PaletteTransform {
  /** Degrees to rotate every hue. */
  hueShift?: number;
  /** Multiply every chroma (0 = greyscale, 1 = unchanged, >1 = more saturated). */
  saturation?: number;
  /** −1 cool … +1 warm — nudges hue toward orange(+)/blue(−). */
  warmth?: number;
  /** Push text away from / toward the ground: >0 raises contrast, <0 lowers. */
  contrast?: number;
}

const TEXT_TOKENS = new Set(['--washi', '--washi-dim', '--washi-mute']);

/**
 * Apply a global transform to every hex colour token. var()/color-mix/font/
 * numeric tokens pass through untouched. Contrast pushes text lightness only.
 */
export function adjustPalette(tokens: TokenMap, t: PaletteTransform, scheme: 'dark' | 'light'): TokenMap {
  const out: TokenMap = {};
  const dark = scheme === 'dark';
  for (const [key, value] of Object.entries(tokens)) {
    const ok = hexToOklch(value);
    if (!ok) {
      out[key] = value;
      continue;
    }
    let { l, c, h } = ok;
    if (t.hueShift) h = ((h + t.hueShift) % 360 + 360) % 360;
    if (t.warmth) {
      // Rotate toward 40° (amber) for warm, 250° (blue) for cool, weighted.
      const targetHue = t.warmth > 0 ? 40 : 250;
      h = lerpHue(h, targetHue, Math.abs(t.warmth) * 0.25);
    }
    if (t.saturation !== undefined) c = c * t.saturation;
    if (t.contrast && TEXT_TOKENS.has(key)) {
      // Positive contrast pushes text toward its rail (lighter on dark, darker on light).
      l = clamp(l + t.contrast * (dark ? 0.12 : -0.12), 0, 1);
    }
    h = avoidBannedHue(h);
    out[key] = oklchToHex({ l, c, h });
  }
  return out;
}

function lerpHue(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) % 360 + 360) % 360;
}

// ---------------------------------------------------------------------------
// Randomisation
// ---------------------------------------------------------------------------

/** Tiny deterministic PRNG so a numeric seed reproduces a palette (testable). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A tasteful random seed. Pass a number for reproducibility; omit for a fresh
 * one. Hues avoid the purple/indigo band; the accent sits in analogous or
 * complementary harmony to the primary.
 */
export function randomSeed(rngSeed?: number): PaletteSeed {
  const rng = mulberry32(rngSeed ?? Math.floor((Date.now() % 1e9) + Math.random() * 1e6));
  const primaryHue = avoidBannedHue(Math.floor(rng() * 360));
  const harmony = rng();
  const offset = harmony < 0.5 ? 26 + rng() * 30 : 150 + rng() * 60; // analogous | complementary
  const accentHue = avoidBannedHue(primaryHue + (rng() < 0.5 ? offset : -offset));
  return {
    scheme: rng() < 0.82 ? 'dark' : 'light',
    primaryHue,
    accentHue,
    depth: 0.5 + rng() * 0.45,
    vibrancy: 0.4 + rng() * 0.55,
    warmth: (rng() - 0.5) * 0.8,
    contrast: 7 + rng() * 3,
  };
}

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Recover an approximate seed from a palette (for "seed from current theme"). */
export function seedFromTokens(tokens: TokenMap, scheme: 'dark' | 'light'): PaletteSeed {
  const primary = hexToOklch(tokens['--lapis'] ?? '') ?? { l: 0.6, c: 0.16, h: DEFAULT_SEED.primaryHue };
  const accent = hexToOklch(tokens['--gold'] ?? '') ?? { l: 0.6, c: 0.14, h: DEFAULT_SEED.accentHue };
  const ink = hexToOklch(tokens['--ink'] ?? '') ?? { l: 0.1, c: 0.01, h: primary.h };
  const dark = scheme === 'dark';
  return {
    scheme,
    primaryHue: primary.h,
    accentHue: accent.h,
    depth: clamp(dark ? (0.13 - ink.l) / 0.05 : (0.975 - ink.l) / 0.03, 0, 1),
    vibrancy: clamp((primary.c - 0.09) / 0.15, 0, 1),
    warmth: 0,
    contrast: 8,
  };
}
