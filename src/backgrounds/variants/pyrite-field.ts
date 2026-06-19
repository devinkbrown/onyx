import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, drawPyriteFlecks, readBackgroundTheme, rgba, seeded } from './utils';

export const pyriteField = {
  id: 'pyrite-field',
  label: 'Pyrite Field',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;
    const ground = c.createLinearGradient(0, 0, ctx.width, ctx.height);
    ground.addColorStop(0, theme.ink);
    ground.addColorStop(0.48, theme.stone);
    ground.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = ground;
    c.fillRect(0, 0, ctx.width, ctx.height);

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
    drawPyriteFlecks(ctx, theme, time, 180);
    drawGrain(ctx, theme, 0.72);
  },
  dispose() {},
} satisfies BackgroundVariant;
