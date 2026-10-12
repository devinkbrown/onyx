// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { rgba, seeded, strokeGoldVein } from './utils';

/**
 * Lapis Gradient — a solid still of quiet gold veins and flecks, routed through
 * the shared signature pipeline. Its hand-rolled diagonal lapis ground and
 * per-variant grain are retired for the luminance-capped ground + fixed paper
 * grain; the ink layer keeps the two still gold veins and the scatter of gold
 * flecks. Solid: one frame (time pinned at 0).
 */
export const lapisGradient = {
  id: 'lapis-gradient',
  label: 'Lapis Gradient',
  kind: 'solid',
  init(_ctx) {},
  frame(ctx) {
    composeSignature(ctx, 0, (theme) => {
      drawStillVeins(ctx, theme);
      drawGoldFlecks(ctx, theme);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawStillVeins(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  c.save();
  c.globalAlpha = 0.28;
  strokeGoldVein(ctx, theme, 3, 0, 0.58);
  strokeGoldVein(ctx, theme, 8, 0, 0.36);
  c.restore();
}

function drawGoldFlecks(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  c.save();
  c.fillStyle = rgba(theme.goldBright, 0.72);
  for (let i = 0; i < Math.floor(48 * ctx.qualityScale); i += 1) {
    const x = seeded(i + 900) * ctx.width;
    const y = seeded(i + 901) * ctx.height;
    c.globalAlpha = 0.18 + seeded(i + 902) * 0.38;
    c.fillRect(x, y, 1.2, 1.2);
  }
  c.restore();
}
