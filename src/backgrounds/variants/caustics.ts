// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba } from './utils';

/**
 * Caustic Tide — the rippling net of light that plays across a seabed. Layered
 * sine-warped bright lines in screen-blend over a deep gradient, drifting slowly
 * with two interfering frequencies so the pattern never obviously repeats. Bright
 * crests sinking toward the deep primary accent as the lines descend.
 */
export const caustics = {
  id: 'caustics',
  label: 'Caustic Tide',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;

    const ground = c.createLinearGradient(0, 0, ctx.width, ctx.height);
    ground.addColorStop(0, theme.ink);
    ground.addColorStop(0.5, mix(theme.stone, theme.ink, 0.42));
    ground.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = ground;
    c.fillRect(0, 0, ctx.width, ctx.height);

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
    drawGrain(ctx, theme, 0.5);
  },
  dispose() {},
} satisfies BackgroundVariant;
