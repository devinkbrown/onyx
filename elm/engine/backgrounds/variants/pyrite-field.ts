// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { drawPyriteFlecks, rgba, seeded } from './utils';

/**
 * Pyrite Field — routed through the shared signature pipeline. Its own
 * diagonal-ramp ground and per-variant grain are retired for the shared
 * luminance-capped ground + paper grain; the distinctive ink layer is the drift
 * of faint lapis diagonals with the shimmering pyrite flecks scattered across
 * them, composited over the capped ground.
 */
export const pyriteField = {
  id: 'pyrite-field',
  label: 'Pyrite Field',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      drawDiagonals(ctx, theme, t);
      drawPyriteFlecks(ctx, theme, t, 180);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawDiagonals(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;

  c.save();
  c.strokeStyle = rgba(theme.lapisBright, 0.16);
  c.lineWidth = 1;
  c.globalAlpha = 0.4;

  const diagonalCount = Math.floor(12 * ctx.qualityScale);
  for (let i = 0; i < diagonalCount; i += 1) {
    const offset = ((seeded(i) * ctx.width + time * 0.007) % (ctx.width + 180)) - 120;
    c.beginPath();
    c.moveTo(offset, 0);
    c.lineTo(offset + ctx.height * 0.32, ctx.height);
    c.stroke();
  }

  c.restore();
}
