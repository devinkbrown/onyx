// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { rgba, seeded } from './utils';

/**
 * Bioluminescence — routed through the shared signature pipeline. Its own deep
 * gradient and per-variant grain are retired for the shared luminance-capped
 * ground + fixed paper grain; its distinctive ink layer keeps the slow field of
 * glowing motes drifting up through deep water — azure crests with the odd
 * champagne spark, each twinkling on its own phase over the vermilion seal.
 * Deterministic seeding keeps it stable across frames, and a soft two-ring glow
 * avoids per-particle shadowBlur cost.
 */
export const bioluminescence = {
  id: 'bioluminescence',
  label: 'Bioluminescence',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      drawMotes(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawMotes(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;

  c.save();
  c.globalCompositeOperation = 'screen';

  const count = Math.max(36, Math.floor(150 * ctx.qualityScale));
  for (let i = 0; i < count; i += 1) {
    const sx = seeded(i * 2 + 1);
    const sy = seeded(i * 2 + 2);
    // Slow upward drift, wrapped; horizontal sway on its own phase.
    const drift = (sy + time * 0.000013 * (0.4 + sx)) % 1;
    const x = sx * ctx.width + Math.sin(time * 0.00018 + i * 1.3) * 10;
    const y = (1 - drift) * ctx.height;
    const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * 0.0009 + i * 1.7));
    const r = (0.6 + sx * 1.7) * (0.7 + twinkle);
    const colour = i % 9 === 0 ? theme.goldBright : i % 3 === 0 ? theme.lapisBright : theme.lapis;

    // Soft halo, then bright core.
    c.beginPath();
    c.arc(x, y, r * 3.4, 0, Math.PI * 2);
    c.fillStyle = rgba(colour, 0.05 * twinkle);
    c.fill();

    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = rgba(colour, 0.35 + twinkle * 0.45);
    c.fill();
  }

  c.restore();
}
