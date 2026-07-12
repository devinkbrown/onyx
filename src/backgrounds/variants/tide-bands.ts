// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { rgba } from './utils';

/**
 * Tide Bands — slow, wide horizontal bands with a sheen that sweeps across each,
 * routed through the shared signature pipeline. Its ink layer is a small stack of
 * soft, vertically-feathered bands (primary accent, screen-blend) each crossed by
 * a slow horizontal highlight — the tide. The luminance-capped dark ground, grain,
 * vignette and vermilion seal all come from the shared pipeline, so foreground
 * text stays legible over any theme by construction.
 *
 * Bands are pure fills (no per-band shadow blur), keeping the frame cheap so the
 * FPS guard rarely fires.
 */
export const tideBands = {
  id: 'tide-bands',
  label: 'Tide Bands',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    // Reduced motion / staticMode holds the tide at its t=0 phase: the bands and
    // their sheen freeze at a fixed, legible position rather than mid-sweep.
    const currentTime = prefersReducedMotion() ? 0 : time;
    composeSignature(ctx, currentTime, (theme, t) => {
      drawTide(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

/**
 * The band layout, hoisted to module scope so no array/object is allocated per
 * frame. `y`/`height` are fractions of the canvas height; `speed` scales the
 * sheen sweep; `strength` scales the band opacity. Length is the full-quality
 * band count — the drawn count scales down off `qualityScale`.
 */
const BAND_LAYOUT = [
  { y: 0.22, height: 0.14, speed: 0.6, strength: 0.9 },
  { y: 0.38, height: 0.18, speed: 0.9, strength: 1.0 },
  { y: 0.54, height: 0.16, speed: 0.5, strength: 0.85 },
  { y: 0.68, height: 0.2, speed: 1.1, strength: 1.0 },
  { y: 0.82, height: 0.16, speed: 0.7, strength: 0.9 },
  { y: 0.93, height: 0.12, speed: 0.4, strength: 0.8 },
] as const;

/** Half-width of the horizontal sheen highlight, in px. */
const SHEEN_HALF = 220;

function drawTide(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  // Element count = how many bands are drawn, scaled off the quality ladder so
  // `low` (0.52) genuinely thins the stack (never below a legible floor of 3).
  const count = Math.min(BAND_LAYOUT.length, Math.max(3, Math.floor(BAND_LAYOUT.length * ctx.qualityScale)));
  const sweepSpan = ctx.width + SHEEN_HALF * 2;

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const band = BAND_LAYOUT[i]!;
    const h = ctx.height * band.height;
    // A gentle vertical bob keeps the band alive without shifting its lane.
    const yCentre = ctx.height * band.y + Math.sin(time * 0.00006 + i * 1.3) * ctx.height * 0.015;
    const top = yCentre - h / 2;
    const colour = i % 2 === 0 ? theme.lapisDeep : theme.lapis;

    // Band body — a soft vertical feather so edges dissolve into the ground.
    const body = c.createLinearGradient(0, top, 0, top + h);
    body.addColorStop(0, rgba(colour, 0));
    body.addColorStop(0.5, rgba(colour, 0.16 * band.strength));
    body.addColorStop(1, rgba(colour, 0));
    c.fillStyle = body;
    c.fillRect(0, top, ctx.width, h);

    // The tide sheen — a bright highlight sliding horizontally and wrapping.
    const sweep = (((time * band.speed * 0.00004) % 1) + 1) % 1;
    const cx = sweep * sweepSpan - SHEEN_HALF;
    const sheen = c.createLinearGradient(cx - SHEEN_HALF, 0, cx + SHEEN_HALF, 0);
    sheen.addColorStop(0, rgba(theme.lapisBright, 0));
    sheen.addColorStop(0.5, rgba(theme.lapisBright, 0.12 * band.strength));
    sheen.addColorStop(1, rgba(theme.lapisBright, 0));
    c.fillStyle = sheen;
    c.fillRect(0, top, ctx.width, h);
  }

  c.restore();
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
