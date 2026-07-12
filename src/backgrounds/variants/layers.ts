// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * layers — the shared "Ink on Living Paper" signature pipeline (roadmap v1.2
 * "Washi").
 *
 * The consolidation target is ONE layered background composition every preset
 * reuses instead of hand-rolling its own ground/grain/vignette:
 *
 *   groundLayer  → luminance-CAPPED theme-derived dark base (legibility floor)
 *   <ink layer>  → the preset's own distinctive scene drawing
 *   applyWashiGrain → the single mandatory washi grain, fixed density
 *   applyVignette   → edge darkening so foreground text stays legible at the rim
 *   kintsugiAccent  → the ONE hot vermilion --shu seal (kintsugi seam)
 *
 * `composeSignature` runs that stack in order; a preset only supplies its ink
 * layer. The ground/grain/vignette all draw from the dark, low-L theme tokens
 * (`--ink`/`--stone`) — and `groundLayer` additionally *caps* the lightness so
 * even a light theme can never wash the ground out and swallow message text.
 */
import type { BackgroundFrameContext } from '../engine';
import { hexToHsl, hslToHex } from '../reactivity';
import type { BackgroundTheme } from './utils';
import { clearCanvas, readBackgroundTheme, rgba, seeded } from './utils';

/**
 * Hard ceiling on the ground's HSL lightness. The dark themes already sit well
 * below this; the cap only bites on a light theme, pulling its "ground" tokens
 * down so the background never rises to a lightness that erases foreground
 * contrast. This is the legibility guarantee, enforced by construction.
 */
export const GROUND_MAX_L = 0.24;

/** Fixed washi-grain fleck count at full quality — no per-variant density knob. */
export const WASHI_GRAIN_COUNT_BASE = 120;
/** Grain opacity — the whole point is a whisper, never a texture that competes. */
export const WASHI_GRAIN_ALPHA = 0.1;
/** Edge-vignette peak opacity (ink toward the rim). */
export const VIGNETTE_MAX_ALPHA = 0.42;

/**
 * Pure: clamp a colour's HSL lightness to `maxL`, preserving hue + saturation.
 * A colour already at or below the cap is returned unchanged; an unparseable
 * input is passed through untouched.
 */
export function capLuminance(hex: string, maxL: number = GROUND_MAX_L): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  if (hsl.l <= maxL) return hex;
  return hslToHex({ ...hsl, l: maxL });
}

/** Pure: washi grain fleck count for a given quality scale (fixed base density). */
export function washiGrainCount(qualityScale: number): number {
  return Math.floor(WASHI_GRAIN_COUNT_BASE * Math.max(0, qualityScale));
}

/**
 * The luminance-capped theme-derived ground. A calm vertical dark gradient of
 * the ground tokens (each clamped to `GROUND_MAX_L`) with a faint primary-hued
 * top glow — mirroring the factory's primary-tinted neutrals, but capped so it
 * cannot lift the base past the legibility floor.
 */
export function groundLayer(ctx: BackgroundFrameContext, theme: BackgroundTheme, time = 0): void {
  const c = ctx.context;
  const top = capLuminance(theme.ink2);
  const mid = capLuminance(theme.stone);
  const base = capLuminance(theme.ink);
  const drift = Math.sin(time * 0.00006) * ctx.height * 0.03;

  const ground = c.createLinearGradient(0, drift, 0, ctx.height);
  ground.addColorStop(0, top);
  ground.addColorStop(0.5, mid);
  ground.addColorStop(1, base);
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);

  // A faint primary tint pooling at the top — capped source + low alpha so it
  // reads as depth, never as light that competes with foreground text.
  const glow = c.createRadialGradient(
    ctx.width * 0.5,
    -ctx.height * 0.1,
    0,
    ctx.width * 0.5,
    ctx.height * 0.12,
    Math.max(ctx.width, ctx.height) * 0.8,
  );
  glow.addColorStop(0, rgba(capLuminance(theme.lapisDeep, 0.3), 0.1));
  glow.addColorStop(1, rgba(base, 0));
  c.save();
  c.globalCompositeOperation = 'screen';
  c.fillStyle = glow;
  c.fillRect(0, 0, ctx.width, ctx.height);
  c.restore();
}

/**
 * The single mandatory washi grain: a fixed-density scatter of faint washi
 * flecks, scaled only by the quality ladder. Promoted from the old per-variant
 * `drawGrain(density)` so every signature preset gets the exact same paper.
 */
export function applyWashiGrain(
  ctx: BackgroundFrameContext,
  theme: BackgroundTheme = readBackgroundTheme(ctx.canvas),
): void {
  const c = ctx.context;
  const count = washiGrainCount(ctx.qualityScale);

  c.save();
  c.globalAlpha = WASHI_GRAIN_ALPHA;
  c.fillStyle = theme.washiDim;
  for (let i = 0; i < count; i += 1) {
    const x = seeded(i + 17) * ctx.width;
    const y = seeded(i + 71) * ctx.height;
    const w = 1 + seeded(i + 131) * 1.8;
    c.fillRect(x, y, w, 0.7);
  }
  c.restore();
}

/**
 * Edge vignette: transparent at the centre, darkening toward `--ink` at the
 * rim. Source-over (a darken), so it only ever *protects* legibility at the
 * corners — it can never lift the ground.
 */
export function applyVignette(
  ctx: BackgroundFrameContext,
  theme: BackgroundTheme = readBackgroundTheme(ctx.canvas),
): void {
  const c = ctx.context;
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  const inner = Math.min(ctx.width, ctx.height) * 0.4;
  const outer = Math.max(ctx.width, ctx.height) * 0.75;

  const vignette = c.createRadialGradient(cx, cy, inner, cx, cy, outer);
  vignette.addColorStop(0, rgba(theme.ink, 0));
  vignette.addColorStop(1, rgba(theme.ink, VIGNETTE_MAX_ALPHA));

  c.save();
  c.fillStyle = vignette;
  c.fillRect(0, 0, ctx.width, ctx.height);
  c.restore();
}

/**
 * The one hot accent: a single vermilion `--shu` seam — the kintsugi seal.
 * Deliberately just ONE stroke at modest alpha, so the brand's single hot
 * accent is present without ever competing with foreground text. Its gentle
 * sway is time-driven, so a frozen static frame simply holds a still seam.
 */
export function kintsugiAccent(ctx: BackgroundFrameContext, theme: BackgroundTheme, time = 0): void {
  const c = ctx.context;
  const xStart = ctx.width * 0.5;
  const yStart = -ctx.height * 0.06;
  const segments = 6;
  const yStep = (ctx.height * 1.2) / segments;
  const sway = Math.sin(time * 0.00011) * 14 * ctx.qualityScale;

  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(xStart, yStart);

  let x = xStart;
  let y = yStart;
  for (let segment = 0; segment < segments; segment += 1) {
    const seed = segment * 13 + 3;
    const nextX = x + (seeded(seed) - 0.5) * ctx.width * 0.16 + sway;
    const nextY = y + yStep * (0.8 + seeded(seed + 1) * 0.4);
    const controlX = x + (seeded(seed + 2) - 0.5) * ctx.width * 0.18 - sway * 0.5;
    const controlY = y + yStep * 0.52;
    c.quadraticCurveTo(controlX, controlY, nextX, nextY);
    x = nextX;
    y = nextY;
  }

  // Dark under-stroke for depth, then the vermilion core, then a bright filament.
  c.globalAlpha = 0.2;
  c.strokeStyle = rgba(theme.ink, 0.8);
  c.lineWidth = 4;
  c.stroke();

  c.globalAlpha = 0.46;
  c.strokeStyle = theme.shu;
  c.lineWidth = 1.6;
  c.stroke();

  c.globalAlpha = 0.66;
  c.strokeStyle = theme.shuBright;
  c.lineWidth = 0.7;
  c.stroke();

  c.restore();
}

/** The ink layer a preset supplies to `composeSignature`. */
export type InkLayer = (theme: BackgroundTheme, time: number) => void;

/**
 * Run the full signature stack: clear → capped ground → the preset's ink layer
 * → washi grain → vignette → the single vermilion seal. The theme is read once
 * (from the shared epoch cache) and threaded through every layer, so a live
 * theme switch repaints the whole stack on the next frame.
 */
export function composeSignature(ctx: BackgroundFrameContext, time: number, inkLayer: InkLayer): void {
  const theme = readBackgroundTheme(ctx.canvas);
  clearCanvas(ctx);
  groundLayer(ctx, theme, time);
  inkLayer(theme, time);
  applyWashiGrain(ctx, theme);
  applyVignette(ctx, theme);
  kintsugiAccent(ctx, theme, time);
}
