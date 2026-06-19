import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, readBackgroundTheme, rgba } from './utils';

export const deepCurrent = {
  id: 'deep-current',
  label: 'Deep Current',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;
    const ground = c.createLinearGradient(0, 0, 0, ctx.height);
    ground.addColorStop(0, theme.ink);
    ground.addColorStop(0.28, theme.stone2);
    ground.addColorStop(0.62, theme.lapisDeep);
    ground.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = ground;
    c.fillRect(0, 0, ctx.width, ctx.height);

    c.save();
    c.globalCompositeOperation = 'screen';
    const bandCount = Math.max(8, Math.floor(16 * ctx.qualityScale));

    for (let i = 0; i < bandCount; i += 1) {
      const baseY = (i / bandCount) * ctx.height;
      const phase = time * (0.00018 + i * 0.000006) + i * 1.3;
      c.beginPath();
      c.moveTo(-20, baseY);

      for (let x = -20; x <= ctx.width + 40; x += 54) {
        const y = baseY + Math.sin(x * 0.011 + phase) * 26 + Math.cos(x * 0.006 - phase) * 14;
        c.lineTo(x, y);
      }

      c.globalAlpha = 0.05 + (i % 3) * 0.018;
      c.strokeStyle = i % 4 === 0 ? rgba(theme.gold, 0.54) : rgba(theme.lapisBright, 0.74);
      c.lineWidth = i % 4 === 0 ? 0.9 : 5.8;
      c.stroke();
    }

    c.restore();
    drawGrain(ctx, theme, 0.88);
  },
  dispose() {},
} satisfies BackgroundVariant;
