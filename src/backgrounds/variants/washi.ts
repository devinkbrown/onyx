import type { BackgroundVariant } from '../engine';
import { clearCanvas, readBackgroundTheme, rgba, seeded } from './utils';

export const washi = {
  id: 'washi',
  label: 'Paper Grain',
  kind: 'solid',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;
    const paper = c.createLinearGradient(0, 0, ctx.width, ctx.height);
    paper.addColorStop(0, theme.washi);
    paper.addColorStop(0.56, rgba(theme.goldBright, 0.42));
    paper.addColorStop(1, theme.washiDim);

    clearCanvas(ctx);
    c.fillStyle = paper;
    c.fillRect(0, 0, ctx.width, ctx.height);

    c.save();
    c.strokeStyle = rgba(theme.goldDeep, 0.24);
    c.lineWidth = 0.8;
    for (let i = 0; i < Math.floor(24 * ctx.qualityScale); i += 1) {
      const y = seeded(i + 650) * ctx.height;
      c.globalAlpha = 0.14 + seeded(i + 651) * 0.18;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(ctx.width, y + (seeded(i + 652) - 0.5) * 24);
      c.stroke();
    }
    c.restore();
  },
  dispose() {},
} satisfies BackgroundVariant;
