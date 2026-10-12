// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { mix, rgba, seeded } from './utils';

/**
 * Aurora Ribbons — a drifting field of tall, translucent light curtains, routed
 * through the shared signature pipeline. It supplies only its ink layer: vertical
 * wavy ribbons that undulate and slide sideways in screen-blend, drawn from the
 * primary accent (a warm gold-tinted minority) over the pipeline's luminance-
 * capped dark ground. The ground/grain/vignette/vermilion seal are the shared
 * layers, so legibility holds by construction for any theme.
 *
 * Distinct from `aurora` (Mineral Aurora, horizontal bands) and the DOM
 * `aurora-borealis` scene: here the motif is vertical drifting ribbons.
 */
export const auroraRibbons = {
  id: 'aurora-ribbons',
  label: 'Aurora Ribbons',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    // Reduced motion / staticMode freezes the field at its calm t=0 phase — a
    // deterministic, legible still rather than an arbitrary mid-drift snapshot.
    const currentTime = prefersReducedMotion() ? 0 : time;
    composeSignature(ctx, currentTime, (theme, t) => {
      drawRibbons(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

/** Vertical trace step (px). Path smoothness, not an element count. */
const RIBBON_STEP = 48;
/** Horizontal wrap margin so a ribbon slides fully off one edge and back on. */
const WRAP_MARGIN = 160;

/** Pure: a ribbon's horizontal offset at height `y` — its sideways undulation. */
function ribbonX(y: number, baseX: number, amplitude: number, frequency: number, phase: number): number {
  return (
    baseX +
    Math.sin(y * frequency + phase) * amplitude +
    Math.cos(y * frequency * 0.5 - phase * 0.8) * amplitude * 0.4
  );
}

function drawRibbons(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  // The sole element count — every ribbon scales off the quality ladder so the
  // FPS guard's step down to `low` (0.52) genuinely thins the field.
  const ribbons = Math.max(3, Math.floor(9 * ctx.qualityScale));
  const span = ctx.height + 120;
  const wrap = ctx.width + WRAP_MARGIN * 2;
  // Shadow softness tracks quality so `low` sheds the expensive blur first.
  const glow = 20 * ctx.qualityScale;

  c.save();
  c.globalCompositeOperation = 'screen';
  c.lineCap = 'round';
  c.lineJoin = 'round';

  for (let i = 0; i < ribbons; i += 1) {
    const seed = i * 41 + 7;
    const drift = time * (0.006 + seeded(seed) * 0.01);
    // Slide sideways and wrap (double-mod keeps it positive for any drift).
    const baseX = (((seeded(seed + 1) * wrap + drift) % wrap) + wrap) % wrap - WRAP_MARGIN;
    const amplitude = ctx.width * (0.03 + seeded(seed + 2) * 0.05);
    const frequency = 0.006 + seeded(seed + 3) * 0.004;
    const phase = time * (0.00016 + seeded(seed + 4) * 0.00016) + i * 1.7;
    // A warm gold-tinted minority against the cool primary curtains.
    const warm = i % 3 === 0;
    const colour = warm ? mix(theme.lapisBright, theme.gold, 0.4) : theme.lapisBright;

    c.beginPath();
    c.moveTo(ribbonX(-60, baseX, amplitude, frequency, phase), -60);
    for (let y = -60; y <= span; y += RIBBON_STEP) {
      const nextY = y + RIBBON_STEP;
      const midY = y + RIBBON_STEP * 0.5;
      c.quadraticCurveTo(
        ribbonX(midY, baseX, amplitude, frequency, phase),
        midY,
        ribbonX(nextY, baseX, amplitude, frequency, phase),
        nextY,
      );
    }

    // Wide translucent body — the curtain glow.
    c.globalAlpha = 0.05 + seeded(seed + 5) * 0.04;
    c.strokeStyle = rgba(colour, 0.85);
    c.lineWidth = 24 + seeded(seed + 6) * 20;
    c.shadowColor = rgba(colour, 0.18);
    c.shadowBlur = glow;
    c.stroke();

    // A thin pale filament threading the curtain — no shadow, a crisp highlight.
    c.globalAlpha = 0.12 + seeded(seed + 7) * 0.1;
    c.strokeStyle = rgba(theme.paper, 0.72);
    c.lineWidth = 0.85;
    c.shadowBlur = 0;
    c.stroke();
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
