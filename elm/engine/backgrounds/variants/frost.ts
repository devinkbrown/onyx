// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Frost — cool ice ink over the shared signature pipeline. Its old light-paper
 * ground is retired for the luminance-capped dark ground (legibility holds even
 * when the active theme is a light frost paper); its ink layer is the steel-blue
 * caustic shimmer, falling frost crystals, and tiny ice-glints. Reduced motion
 * freezes the field at t=0 for a calm still.
 */
export const frost = {
  id: 'frost',
  label: 'Frost',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    const currentTime = prefersReducedMotion() ? 0 : time;
    composeSignature(ctx, currentTime, (theme, t) => {
      drawCausticShimmer(ctx, theme, t);
      drawFrostCrystals(ctx, theme, t);
      drawIceGlints(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawCausticShimmer(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const lines = Math.max(4, Math.floor(7 * ctx.qualityScale));
  const step = Math.max(30, Math.round(56 / Math.max(0.5, ctx.qualityScale)));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < lines; i += 1) {
    const phase = time * 0.0001 + i * 1.1;
    const baseY = ctx.height * (0.12 + (i * 0.8) / lines);
    const glow = 0.04 + 0.03 * Math.abs(Math.sin(phase * 1.4 + i));

    c.beginPath();
    c.moveTo(-24, baseY);
    for (let x = -24; x <= ctx.width + 48; x += step) {
      const y = baseY + Math.sin(x * 0.01 + phase) * 18 + Math.sin(x * 0.027 + phase * 1.6 + i) * 8;
      c.lineTo(x, y);
    }
    c.strokeStyle = rgba(theme.lapisBright, glow);
    c.lineWidth = 1 + (i % 3 === 0 ? 1.2 : 0.2);
    c.stroke();
  }

  c.restore();
}

function drawFrostCrystals(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(14, Math.floor(34 * ctx.qualityScale));

  c.save();
  c.lineCap = 'round';
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 3 + 7;
    const sx = seeded(seed);
    const sy = seeded(seed + 1);
    const large = i % 6 === 0;

    // Crystals fall slowly, wrapped, with a gentle sideways sway and a
    // barely-perceptible spin.
    const fall = (sy + time * 0.0000105 * (0.45 + sx * 0.7)) % 1;
    const x = sx * ctx.width + Math.sin(time * 0.00013 + i * 1.7) * (7 + sx * 8);
    const y = fall * (ctx.height + 28) - 14;
    const spin = time * 0.00009 * (i % 2 === 0 ? 1 : -1) + seed;
    const twinkle = 0.55 + 0.45 * Math.abs(Math.sin(time * 0.0005 + i * 2.2));
    const arm = (large ? 3.4 + sx * 3.6 : 1.8 + sx * 2.2) * (0.8 + twinkle * 0.25);
    const alpha = (large ? 0.18 : 0.26) * twinkle;

    c.save();
    c.translate(x, y);
    c.rotate(spin);
    c.strokeStyle = rgba(theme.lapisBright, alpha);
    c.lineWidth = large ? 0.9 : 0.7;

    // Six arms — three crossing strokes through the centre.
    for (let spoke = 0; spoke < 3; spoke += 1) {
      c.beginPath();
      c.moveTo(-arm, 0);
      c.lineTo(arm, 0);
      c.stroke();
      c.rotate(Math.PI / 3);
    }

    c.restore();
  }

  c.restore();
}

function drawIceGlints(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(10, Math.floor(26 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 9 + 307;
    const x = seeded(seed) * ctx.width;
    const y = seeded(seed + 1) * ctx.height;
    const sparkle = Math.max(0, Math.sin(time * 0.00035 + i * 2.9));
    const radius = 0.5 + seeded(seed + 2) * 0.8;

    c.globalAlpha = 0.06 + sparkle * 0.14;
    c.fillStyle = theme.paper;
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fill();
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
