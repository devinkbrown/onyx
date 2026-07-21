// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Theme-reactive scene math (roadmap v1.2 "Paper").
 *
 * Pure, DOM-free helpers that let a canvas background variant *react* to its
 * surroundings without any of them re-implementing the same trigonometry:
 *
 *   - a shared **breathe** oscillator (the base + sin(t)·depth pulse that every
 *     bloom/pool already used by hand);
 *   - **voice-RMS → bloom** modulation, hard-capped so a loud channel can never
 *     blow past the legibility ceiling that keeps foreground text readable;
 *   - **channel-accent hue rotation**, bounded to a small arc so a scene tints
 *     *toward* the live accent without inventing a new hue family;
 *   - **time-of-day warmth drift**, a slow warm-at-noon / cool-at-3am nudge.
 *
 * Everything here is deterministic and side-effect-free: given the same inputs
 * it returns the same output, so it is exhaustively unit-testable. Nothing
 * reads the DOM, `Date.now()`, or an audio node — callers pass those in. This
 * mirrors the palette factory's discipline: any input value stays in-family by
 * construction rather than by eyeballing.
 */

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/* ------------------------------------------------------------------ *
 * Breathe — the shared bloom/pool oscillator.
 * ------------------------------------------------------------------ */

export interface BreatheOptions {
  /** Angular speed in radians per millisecond (matches the existing tiny freqs). */
  freq: number;
  /** Phase offset so sibling blooms fall out of sync. */
  phase?: number;
  /** Centre value the oscillation swings around. */
  base?: number;
  /** Half-amplitude of the swing. */
  depth?: number;
}

/**
 * `base + sin(time·freq + phase)·depth`. This is the exact shape every variant
 * open-coded for its blooms; centralising it means one place to reason about
 * amplitude and one place to cap it.
 */
export function breathe(time: number, options: BreatheOptions): number {
  const { freq, phase = 0, base = 0.6, depth = 0.4 } = options;
  return base + Math.sin(time * freq + phase) * depth;
}

/* ------------------------------------------------------------------ *
 * Voice RMS → bloom.
 * ------------------------------------------------------------------ */

/**
 * Deterministic stand-in for a live microphone RMS. Until a real voice level is
 * wired through (out of scope — that belongs to the media layer, not the
 * engine API), variants feed this pseudo-signal in so blooms already pulse like
 * a quiet room. Returns a value in `[0, 1]`.
 */
export function ambientRms(time: number, phase = 0): number {
  // Two detuned sines summed → a gently irregular, never-flat envelope.
  const slow = Math.sin(time * 0.00019 + phase);
  const fast = Math.sin(time * 0.00052 + phase * 1.7);
  return clamp01(0.28 + slow * 0.12 + fast * 0.06);
}

/**
 * Exponential smoothing of a raw RMS sample toward `previous`, with separate
 * attack (rising) and decay (falling) rates so blooms leap toward a loud
 * transient but relax slowly — pure given the previous value.
 */
export function smoothRms(previous: number, sample: number, attack = 0.5, decay = 0.08): number {
  const prev = clamp01(previous);
  const next = clamp01(sample);
  const rate = clamp01(next > prev ? attack : decay);
  return clamp01(prev + (next - prev) * rate);
}

export interface BloomOptions {
  /** Instantaneous level, 0 (silent) … 1 (loud). */
  rms: number;
  /** Multiplier applied at silence — the scene's resting intensity. */
  base?: number;
  /** How much a full-scale level lifts the multiplier above `base`. */
  gain?: number;
  /**
   * Hard ceiling on the returned multiplier — the legibility contract. No
   * amount of voice energy may push a bloom past this, so foreground text stays
   * readable over the darkest theme.
   */
  cap?: number;
}

/**
 * Turn an RMS level into a bloom-intensity multiplier, clamped to `[0, cap]`.
 * The cap is the guarantee: callers multiply their *existing* alphas by this,
 * and because `cap` defaults to 1 the result never exceeds the original
 * hand-tuned brightness.
 */
export function rmsToBloom(options: BloomOptions): number {
  const { rms, base = 0.6, gain = 0.5, cap = 1 } = options;
  const raised = base + clamp01(rms) * gain;
  return clamp(raised, 0, Math.max(0, cap));
}

/* ------------------------------------------------------------------ *
 * Colour math — hex ⇄ HSL, hue rotation.
 * ------------------------------------------------------------------ */

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  if (!normalized.startsWith('#')) return null;
  const body = normalized.slice(1);

  if (body.length === 3) {
    const r = Number.parseInt(body[0]! + body[0]!, 16);
    const g = Number.parseInt(body[1]! + body[1]!, 16);
    const b = Number.parseInt(body[2]! + body[2]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }

  if (body.length !== 6) return null;
  const value = Number.parseInt(body, 16);
  if (Number.isNaN(value)) return null;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function toHexByte(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToHex(hsl: Hsl): string {
  const h = normalizeHue(hsl.h);
  const s = clamp01(hsl.s);
  const l = clamp01(hsl.l);

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));

  const [r, g, b] = rgbFromSector(hp, chroma, x);
  const m = l - chroma / 2;
  return `#${toHexByte((r + m) * 255)}${toHexByte((g + m) * 255)}${toHexByte((b + m) * 255)}`;
}

function rgbFromSector(hp: number, chroma: number, x: number): [number, number, number] {
  if (hp < 1) return [chroma, x, 0];
  if (hp < 2) return [x, chroma, 0];
  if (hp < 3) return [0, chroma, x];
  if (hp < 4) return [0, x, chroma];
  if (hp < 5) return [x, 0, chroma];
  return [chroma, 0, x];
}

export function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  return ((hue % 360) + 360) % 360;
}

export function hueOf(hex: string): number | null {
  return hexToHsl(hex)?.h ?? null;
}

/**
 * Signed shortest angular distance from `fromHex` to `toHex` in degrees,
 * `(-180, 180]`. Positive turns counter-clockwise (toward higher hue).
 */
export function accentHueDelta(fromHex: string, toHex: string): number {
  const from = hueOf(fromHex);
  const to = hueOf(toHex);
  if (from === null || to === null) return 0;
  let diff = (to - from) % 360;
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return diff;
}

/** Rotate a colour's hue by `degrees`, preserving S and L. Achromatic in → in. */
export function rotateHue(hex: string, degrees: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  if (hsl.s === 0) return hex; // no hue to rotate
  return hslToHex({ ...hsl, h: normalizeHue(hsl.h + degrees) });
}

/**
 * Tint `baseHex` *toward* the live channel accent, but only within a bounded
 * arc (`maxDegrees`) scaled by `strength` (0..1). Because the rotation is
 * clamped to a few degrees around the scene's own colour, it breathes with the
 * accent instead of manufacturing a brand-new — possibly banned — hue.
 */
export function reactiveAccentTint(
  baseHex: string,
  accentHex: string,
  strength: number,
  maxDegrees = 12,
): string {
  const delta = accentHueDelta(baseHex, accentHex);
  const bounded = clamp(delta, -maxDegrees, maxDegrees) * clamp01(strength);
  return rotateHue(baseHex, bounded);
}

/* ------------------------------------------------------------------ *
 * Time-of-day warmth drift.
 * ------------------------------------------------------------------ */

/**
 * A slow warmth signal in `[-1, 1]` from a wall-clock timestamp (ms since
 * epoch) using the *local* hour. Peaks warm (+1) around 14:00 and cools
 * (-1) around 02:00 — a smooth cosine, no step at midnight.
 */
export function timeOfDayWarmth(msOrDate: number | Date): number {
  const date = typeof msOrDate === 'number' ? new Date(msOrDate) : msOrDate;
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  // Warmest at 14:00 → shift so cos peaks there; period = 24h.
  const phase = ((hours - 14) / 24) * TAU;
  return Math.cos(phase);
}

/**
 * Nudge a colour's hue by a bounded amount driven by a warmth signal
 * (`-1`=cool … `+1`=warm). Warm turns toward orange/red (lower hue for the
 * blue-through-yellow arc), cool turns toward blue. `maxDegrees` keeps the
 * drift subtle so the accent never wanders into a foreign family.
 */
export function warmthShift(hex: string, warmth: number, maxDegrees = 8): string {
  const w = clamp(warmth, -1, 1);
  // Positive warmth → rotate toward warm hues (negative degrees on the HSL wheel
  // where 0°=red, 60°=yellow, 240°=blue). Cool → toward blue (positive degrees).
  return rotateHue(hex, -w * maxDegrees);
}
