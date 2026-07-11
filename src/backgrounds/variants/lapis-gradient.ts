// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, readBackgroundTheme, rgba, seeded, strokeKintsugiVein } from './utils';

export const lapisGradient = {
  id: 'lapis-gradient',
  label: 'Lapis Gradient',
  kind: 'solid',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;
    const ground = c.createLinearGradient(0, 0, ctx.width, ctx.height);
    ground.addColorStop(0, theme.ink);
    ground.addColorStop(0.24, theme.stone);
    ground.addColorStop(0.58, theme.lapisDeep);
    ground.addColorStop(0.84, theme.stone2);
    ground.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = ground;
    c.fillRect(0, 0, ctx.width, ctx.height);

    c.save();
    c.globalAlpha = 0.28;
    strokeKintsugiVein(ctx, theme, 3, 0, 0.58);
    strokeKintsugiVein(ctx, theme, 8, 0, 0.36);
    c.restore();

    c.save();
    c.fillStyle = rgba(theme.goldBright, 0.72);
    for (let i = 0; i < Math.floor(48 * ctx.qualityScale); i += 1) {
      const x = seeded(i + 900) * ctx.width;
      const y = seeded(i + 901) * ctx.height;
      c.globalAlpha = 0.18 + seeded(i + 902) * 0.38;
      c.fillRect(x, y, 1.2, 1.2);
    }
    c.restore();

    drawGrain(ctx, theme, 0.75);
  },
  dispose() {},
} satisfies BackgroundVariant;
