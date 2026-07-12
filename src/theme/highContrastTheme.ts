// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * highContrastTheme.ts — derive a per-theme high-contrast foreground variant.
 *
 * When the OS signals `prefers-contrast: more` we do NOT swap in one static
 * override block shared by every theme. Instead each theme's OWN foreground
 * tokens are run through the OKLCH contrast solver (`highContrastFg`) against
 * the ground(s) they sit on, boosting lightness — hue preserved, chroma kept
 * gamut-safe — until the pair clears a stricter, one-WCAG-level-up target.
 *
 * The result is a mechanically-derived variant of the theme's own palette (an
 * L/C transform of its hues), not a redesign: a warm theme stays warm, a teal
 * theme stays teal, and every boosted pair only ever gains contrast, so the
 * base palette's AA guarantee is preserved by construction.
 *
 * Pure + DOM-free: values in are hex, values out are hex, so it unit-tests
 * directly and produces only trusted `#rrggbb` (never a CSS-injection sink).
 */

import { hexToOklch, oklchToHex, type Oklch } from './paletteFactory';
import { contrastRatio, highContrastFg } from './contrastVariants';
import type { TokenMap } from './themes';

/** WCAG rungs used as high-contrast targets (one level above the base floor). */
const AAA = 7;
const AA_BODY = 4.5;

/**
 * The full ground ramp a body/secondary/metadata text token can be painted on.
 * A text token is boosted against whichever of these it contrasts WORST with,
 * so the derived value clears its target on every surface at once (the other,
 * better-contrasting grounds pass with margin in the same lightness direction).
 */
const TEXT_GROUNDS = ['--ink', '--stone', '--stone-2', '--stone-3'] as const;

/** Interactive accents are read as foreground on the deepest ground (`--ink`). */
const ACCENT_GROUND = ['--ink'] as const;

interface HighContrastPair {
  /** Foreground token to boost. */
  readonly fg: string;
  /** Candidate grounds; the worst-contrast one drives the boost. */
  readonly grounds: readonly string[];
  /** Contrast ratio the boosted foreground must clear against that ground. */
  readonly target: number;
}

/**
 * The high-contrast derivation contract. Foregrounds mirror `AA_PAIRS` in
 * paletteFactory (the tokens the palette already guarantees), each lifted one
 * WCAG rung: body/secondary text to AAA, metadata and UI accents to body AA.
 */
export const HIGH_CONTRAST_PAIRS: readonly HighContrastPair[] = [
  { fg: '--washi', grounds: TEXT_GROUNDS, target: AAA },
  { fg: '--washi-dim', grounds: TEXT_GROUNDS, target: AAA },
  { fg: '--washi-mute', grounds: TEXT_GROUNDS, target: AA_BODY },
  { fg: '--lapis-bright', grounds: ACCENT_GROUND, target: AAA },
  { fg: '--gold-bright', grounds: ACCENT_GROUND, target: AA_BODY },
  { fg: '--ok', grounds: ACCENT_GROUND, target: AA_BODY },
  { fg: '--shu-bright', grounds: ACCENT_GROUND, target: AA_BODY },
];

/**
 * Resolve the worst-contrast ground for `fg` among `grounds`, as OKLCH. Tokens
 * that are absent or not plain hex (var()/color-mix) are skipped; returns null
 * when no ground resolves so the caller can fail closed (leave the base value).
 */
function worstGround(fg: Oklch, grounds: readonly string[], tokens: TokenMap): Oklch | null {
  let worst: Oklch | null = null;
  let worstRatio = Infinity;
  for (const ground of grounds) {
    const hex = tokens[ground];
    if (!hex) continue;
    const ok = hexToOklch(hex);
    if (!ok) continue;
    const ratio = contrastRatio(fg, ok);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = ok;
    }
  }
  return worst;
}

/**
 * Derive the high-contrast foreground overrides for a resolved token map. Only
 * covered foreground tokens that a boost actually CHANGES are emitted; a token
 * already clearing its target (e.g. near-white body text on a near-black ground)
 * is left alone, as is every non-covered token (grounds, seams, var()/color-mix,
 * radii, motion) — those fall back to the base theme and the static
 * `a11y-media.css` block. Boosting only raises contrast, so merging these over
 * the base keeps every base AA pair passing.
 */
export function highContrastOverrides(tokens: TokenMap): TokenMap {
  const out: TokenMap = {};
  for (const { fg, grounds, target } of HIGH_CONTRAST_PAIRS) {
    const hex = tokens[fg];
    if (!hex) continue;
    const fgOk = hexToOklch(hex);
    if (!fgOk) continue;
    const ground = worstGround(fgOk, grounds, tokens);
    if (!ground) continue;
    const boosted = oklchToHex(highContrastFg(fgOk, ground, target));
    if (boosted.toLowerCase() !== hex.toLowerCase()) out[fg] = boosted;
  }
  return out;
}
