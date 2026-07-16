// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { mix, rgba } from './utils';

/**
 * Caustic Tide — routed through the shared signature pipeline. Its own deep
 * gradient and per-variant grain are retired for the shared luminance-capped
 * ground + fixed washi grain; its distinctive ink layer keeps the rippling net
 * of light that plays across a seabed — layered sine-warped bright lines in
 * screen-blend, drifting with two interfering frequencies so the pattern never
 * obviously repeats, bright crests sinking toward the deep primary accent as the
 * lines descend, over the pipeline's single vermilion seal.
 */
export const caustics = {
  id: 'caustics',
  label: 'Caustic Tide',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      drawCausticLines(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawCausticLines(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;

  c.save();
  c.globalCompositeOperation = 'screen';

  const lines = Math.max(7, Math.floor(16 * ctx.qualityScale));
  const step = Math.max(28, Math.round(54 / Math.max(0.5, ctx.qualityScale)));
  for (let i = 0; i < lines; i += 1) {
    const phase = time * 0.00016 + i * 0.9;
    const baseY = ctx.height * (0.08 + (i * 0.84) / lines);
    c.beginPath();
    c.moveTo(-24, baseY);
    for (let x = -24; x <= ctx.width + 48; x += step) {
      const y =
        baseY +
        Math.sin(x * 0.012 + phase) * 26 +
        Math.sin(x * 0.031 + phase * 1.7 + i) * 12;
      c.lineTo(x, y);
    }
    const t = i / lines;
    const glow = 0.04 + 0.05 * Math.abs(Math.sin(phase * 1.3));
    c.strokeStyle = rgba(mix(theme.lapisBright, theme.lapisDeep, t * 0.6), glow);
    c.lineWidth = 1.1 + (i % 3 === 0 ? 1.6 : 0.2);
    c.stroke();
  }

  c.restore();
}
