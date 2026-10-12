// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { ambientRms, breathe, rmsToBloom, timeOfDayWarmth, warmthShift } from '../reactivity';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { mix, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Resin — for the amber themes, where gold is legitimately the primary warmth.
 * Routed through the shared signature pipeline: its own amber-depth ground and
 * per-variant grain are retired for the luminance-capped shared ground + paper
 * grain, and its distinctive ink layer — two breathing amber light-pools and the
 * motes suspended in the depth — is composited (in `screen`) over that ground so
 * the warm, luxurious character survives without lifting the legibility floor.
 */
export const resin = {
  id: 'resin',
  label: 'Resin',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      drawAmberPools(ctx, theme, t);
      drawSuspendedMotes(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawAmberPools(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const anchors = [
    { x: 0.3, y: 0.36, phase: 0.6 },
    { x: 0.72, y: 0.64, phase: 3.4 },
  ];

  // Warmth drift: the amber reads a hair warmer by day, cooler by night. Hue
  // only, so the pools never brighten past their tuned envelope.
  const warmth = timeOfDayWarmth(Date.now());
  const gold = warmthShift(theme.gold, warmth, 5);
  const goldDeep = warmthShift(theme.goldDeep, warmth, 5);

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    const pulse = breathe(time, { freq: 0.00013, phase: anchor.phase, base: 0.6, depth: 0.4 });
    // Capped voice-RMS bloom — reaches, but never exceeds, the original alpha.
    const bloom = rmsToBloom({ rms: ambientRms(time, anchor.phase), base: 0.9, gain: 0.1, cap: 1 });
    const x = ctx.width * anchor.x + Math.sin(time * 0.00003 + anchor.phase) * ctx.width * 0.03;
    const y = ctx.height * anchor.y + Math.cos(time * 0.000024 + anchor.phase) * ctx.height * 0.03;
    const radius = Math.max(ctx.width, ctx.height) * (0.24 + i * 0.06) * (0.88 + pulse * 0.16);

    const pool = c.createRadialGradient(x, y, 0, x, y, radius);
    pool.addColorStop(0, rgba(gold, 0.06 * pulse * bloom));
    pool.addColorStop(0.45, rgba(mix(gold, goldDeep, 0.5), 0.032 * pulse * bloom));
    pool.addColorStop(1, rgba(theme.ink, 0));
    c.fillStyle = pool;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  c.restore();
}

function drawSuspendedMotes(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(30, Math.floor(84 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 4 + 9;
    const anchorX = seeded(seed) * ctx.width;
    const anchorY = seeded(seed + 1) * ctx.height;
    const bright = i % 7 === 0;

    // Suspended in resin: each mote circles its anchor by a few pixels,
    // never travelling — only the light moves through.
    const orbit = 3 + seeded(seed + 2) * 8;
    const angle = time * (0.00005 + seeded(seed + 3) * 0.00008) + seed;
    const x = anchorX + Math.sin(angle) * orbit;
    const y = anchorY + Math.cos(angle * 0.7) * orbit * 0.6;

    const shimmer = 0.55 + 0.45 * Math.abs(Math.sin(time * 0.00042 + i * 1.4));
    const radius = (bright ? 0.9 + seeded(seed + 2) * 1.5 : 0.45 + seeded(seed + 2) * 1.05) * (0.8 + shimmer * 0.3);
    const colour = bright ? theme.goldBright : theme.gold;

    c.beginPath();
    c.arc(x, y, radius * 3.1, 0, TAU);
    c.fillStyle = rgba(colour, (bright ? 0.05 : 0.032) * shimmer);
    c.fill();

    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fillStyle = rgba(colour, (bright ? 0.42 : 0.26) * shimmer);
    c.fill();
  }

  c.restore();
}
