// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * seedTransfer.ts — portable, human-shareable theme seeds.
 *
 * The existing Studio export ships a *resolved* token map (every hex baked in).
 * This module ships the far smaller, forward-compatible thing: the seven-field
 * `PaletteSeed` plus a label. A recipient regenerates the full palette locally
 * through `generatePalette` (which runs `enforceAA`), so the contrast guarantee
 * is re-established by construction instead of trusted from the wire — a seed
 * authored against an older factory still produces an AA-clean palette today.
 *
 * Import is fail-closed: a malformed envelope, a wrong-typed field, or a value
 * outside its documented range is REJECTED (never coerced), so a bad seed can
 * never seat garbage into the palette. Hues in the banned indigo→magenta arc
 * (258–342°) are the one soft case — they are accepted but FLAGGED, because the
 * factory's `avoidBannedHue` will snap them cleanly and the user should know the
 * emitted hue will differ from what they typed.
 *
 * Pure + DOM-free so it unit-tests directly.
 */

import { generatePalette, type PaletteSeed } from './paletteFactory';
import type { TokenMap } from './themes';

/** Wire identifier + version for a portable seed envelope. */
export const SEED_EXPORT_KIND = 'onyx-theme-seed' as const;
export const SEED_EXPORT_VERSION = 1 as const;

/** Max label length accepted on import; longer labels are trimmed on export. */
const MAX_LABEL_LENGTH = 80;
const MAX_SEED_EXPORT_BYTES = 16 * 1024;

/** Banned indigo→violet→purple→magenta arc — mirrors `paletteFactory`. */
const BANNED_HUE = { min: 258, max: 342 } as const;

/** The serialized envelope written by {@link exportThemeSeed}. */
export interface SeedExportEnvelope {
  kind: typeof SEED_EXPORT_KIND;
  version: typeof SEED_EXPORT_VERSION;
  label: string;
  seed: PaletteSeed;
}

/** Inclusive numeric bounds enforced on import, one per seed knob. */
const SEED_RANGES = {
  primaryHue: { min: 0, max: 360 },
  accentHue: { min: 0, max: 360 },
  depth: { min: 0, max: 1 },
  vibrancy: { min: 0, max: 1 },
  warmth: { min: -1, max: 1 },
  contrast: { min: 4.5, max: 21 },
} as const;

export type SeedParseResult =
  | { ok: true; label: string; seed: PaletteSeed; warnings: string[] }
  | { ok: false; error: string };

/**
 * Serialize a seed + label into a pretty portable JSON envelope. The label is
 * trimmed and length-capped so a round-trip cannot smuggle an over-long string
 * past the import guard. Numeric fields pass through unchanged (an out-of-range
 * value is a caller bug, not a wire concern — import re-validates regardless).
 */
export function exportThemeSeed(label: string, seed: PaletteSeed): string {
  const envelope: SeedExportEnvelope = {
    kind: SEED_EXPORT_KIND,
    version: SEED_EXPORT_VERSION,
    label: label.trim().slice(0, MAX_LABEL_LENGTH) || 'Custom',
    seed: {
      scheme: seed.scheme,
      primaryHue: seed.primaryHue,
      accentHue: seed.accentHue,
      depth: seed.depth,
      vibrancy: seed.vibrancy,
      warmth: seed.warmth,
      contrast: seed.contrast,
    },
  };
  return JSON.stringify(envelope, null, 2);
}

/** True when a hue sits inside the banned arc the factory will snap away from. */
function isBannedHue(hue: number): boolean {
  return hue >= BANNED_HUE.min && hue <= BANNED_HUE.max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number strictly within [min, max]. Rejects NaN/Infinity/strings. */
function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Parse + fully validate a portable seed envelope, fail-closed. Returns either a
 * clean seed (with any banned-hue warnings) or a single human-readable error.
 * Nothing here mutates or touches the DOM; the caller decides what to do with a
 * valid seed (typically feed it to {@link paletteFromSeedExport}).
 */
export function parseThemeSeed(json: string): SeedParseResult {
  if (typeof json !== 'string' || json.length > MAX_SEED_EXPORT_BYTES) {
    return { ok: false, error: 'Theme-seed export is too large.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON — could not parse.' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Not a theme-seed export.' };
  }
  if (parsed.kind !== SEED_EXPORT_KIND) {
    return { ok: false, error: 'Not an Onyx theme-seed export.' };
  }
  if (parsed.version !== SEED_EXPORT_VERSION) {
    return { ok: false, error: `Unsupported seed version "${String(parsed.version)}".` };
  }
  if (typeof parsed.label !== 'string' || parsed.label.trim().length === 0) {
    return { ok: false, error: 'Missing theme label.' };
  }
  if (parsed.label.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: 'Theme label is too long.' };
  }

  const seed = parsed.seed;
  if (!isPlainObject(seed)) {
    return { ok: false, error: 'Missing seed.' };
  }
  if (seed.scheme !== 'dark' && seed.scheme !== 'light') {
    return { ok: false, error: 'Seed scheme must be "dark" or "light".' };
  }
  for (const [field, { min, max }] of Object.entries(SEED_RANGES)) {
    if (!inRange(seed[field], min, max)) {
      return { ok: false, error: `Seed "${field}" must be a number in [${min}, ${max}].` };
    }
  }

  const clean: PaletteSeed = {
    scheme: seed.scheme,
    primaryHue: seed.primaryHue as number,
    accentHue: seed.accentHue as number,
    depth: seed.depth as number,
    vibrancy: seed.vibrancy as number,
    warmth: seed.warmth as number,
    contrast: seed.contrast as number,
  };

  const warnings: string[] = [];
  if (isBannedHue(clean.primaryHue)) {
    warnings.push(`Primary hue ${Math.round(clean.primaryHue)}° is in the banned 258–342° arc; it will be snapped to the nearer edge.`);
  }
  if (isBannedHue(clean.accentHue)) {
    warnings.push(`Accent hue ${Math.round(clean.accentHue)}° is in the banned 258–342° arc; it will be snapped to the nearer edge.`);
  }

  return { ok: true, label: parsed.label.trim(), seed: clean, warnings };
}

/**
 * Regenerate a full, AA-clean token map from a validated seed. This is a thin
 * pass-through to `generatePalette` (which already runs `enforceAA`), named for
 * intent at the import call site so the guarantee is legible: every imported
 * seed becomes a palette that satisfies `auditPalette`.
 */
export function paletteFromSeedExport(seed: PaletteSeed): TokenMap {
  return generatePalette(seed);
}
