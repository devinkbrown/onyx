// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * contrast.ts — WCAG contrast math for the Theme Studio's legibility auditor.
 *
 * Theme tokens are stored as hex, and the `<input type=color>` controls emit
 * hex, so hex/rgb parsing covers every editable colour. `resolveCssColor` is a
 * DOM fallback that lets the browser resolve any other format (oklch, named,
 * color-mix) to rgb when a live computed value isn't plain hex.
 *
 * The pure functions (parse, luminance, ratio, rating) carry no DOM dependency
 * so they are unit-tested directly against known WCAG reference values.
 */

export type RGB = { r: number; g: number; b: number };

export type WcagRating = {
  /** Contrast ratio, 1–21, rounded to 2 dp. */
  ratio: number;
  /** Passes AA for normal body text (>= 4.5). */
  passesAA: boolean;
  /** Passes AAA for normal body text (>= 7). */
  passesAAA: boolean;
  /** Passes AA for large text / UI components (>= 3). */
  passesLargeAA: boolean;
  /** Best label this pair earns: 'AAA' | 'AA' | 'AA Large' | 'Fail'. */
  level: 'AAA' | 'AA' | 'AA Large' | 'Fail';
};

const AA_NORMAL = 4.5;
const AAA_NORMAL = 7;
const AA_LARGE = 3;

/** Parse `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa` (alpha ignored). */
export function parseHex(input: string): RGB | null {
  const m = input.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

/** Parse `rgb(r, g, b)` / `rgba(r, g, b, a)` (modern or legacy comma syntax). */
export function parseRgb(input: string): RGB | null {
  const m = input
    .trim()
    .match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
  if (!m) return null;
  const r = Math.round(Number(m[1]));
  const g = Math.round(Number(m[2]));
  const b = Math.round(Number(m[3]));
  if ([r, g, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return { r, g, b };
}

/** Parse a hex or rgb() colour string to RGB. */
export function parseColor(input: string): RGB | null {
  return parseHex(input) ?? parseRgb(input);
}

/** WCAG relative luminance for an 8-bit sRGB colour. */
export function relativeLuminance(rgb: RGB): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG contrast ratio between two colours (1–21), order-independent. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Grade a foreground/background pair against the WCAG thresholds. */
export function wcagRating(fg: RGB, bg: RGB): WcagRating {
  const raw = contrastRatio(fg, bg);
  const ratio = Math.round(raw * 100) / 100;
  const passesAAA = raw >= AAA_NORMAL;
  const passesAA = raw >= AA_NORMAL;
  const passesLargeAA = raw >= AA_LARGE;
  const level: WcagRating['level'] = passesAAA
    ? 'AAA'
    : passesAA
      ? 'AA'
      : passesLargeAA
        ? 'AA Large'
        : 'Fail';
  return { ratio, passesAA, passesAAA, passesLargeAA, level };
}

/**
 * Resolve any CSS colour string (hex, rgb, oklch, named, color-mix) to RGB by
 * letting the browser compute it. Falls back to direct hex/rgb parsing when no
 * document is available (SSR / tests). Returns null if it can't be resolved.
 */
export function resolveCssColor(css: string): RGB | null {
  const direct = parseColor(css);
  if (direct) return direct;
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = 'rgb(1, 2, 3)'; // sentinel so an invalid value is detectable
  probe.style.color = css;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return parseRgb(computed);
}
