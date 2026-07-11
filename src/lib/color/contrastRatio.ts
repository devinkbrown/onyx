// SPDX-License-Identifier: AGPL-3.0-or-later
export type RGB = {
  r: number;
  g: number;
  b: number;
};

export type ContrastOptions = {
  large?: boolean;
};

const AA_NORMAL_THRESHOLD = 4.5;
const AA_LARGE_THRESHOLD = 3;
const AAA_NORMAL_THRESHOLD = 7;
const AAA_LARGE_THRESHOLD = 4.5;

/** WCAG 2.1 relative luminance for an sRGB color. */
export function relativeLuminance(rgb: RGB): number {
  return 0.2126 * linearizeChannel(rgb.r) + 0.7152 * linearizeChannel(rgb.g) + 0.0722 * linearizeChannel(rgb.b);
}

/** WCAG contrast ratio between foreground and background colors, from 1 to 21. */
export function contrastRatio(fg: RGB, bg: RGB): number {
  const fgLuminance = relativeLuminance(fg);
  const bgLuminance = relativeLuminance(bg);
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a foreground/background pair meets WCAG AA contrast. */
export function meetsAA(fg: RGB, bg: RGB, options: ContrastOptions = {}): boolean {
  return contrastRatio(fg, bg) >= (options.large ? AA_LARGE_THRESHOLD : AA_NORMAL_THRESHOLD);
}

/** Whether a foreground/background pair meets WCAG AAA contrast. */
export function meetsAAA(fg: RGB, bg: RGB, options: ContrastOptions = {}): boolean {
  return contrastRatio(fg, bg) >= (options.large ? AAA_LARGE_THRESHOLD : AAA_NORMAL_THRESHOLD);
}

function linearizeChannel(channel: number): number {
  const srgb = clampChannel(channel) / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function clampChannel(channel: number): number {
  if (!Number.isFinite(channel)) return 0;
  return Math.min(255, Math.max(0, channel));
}
