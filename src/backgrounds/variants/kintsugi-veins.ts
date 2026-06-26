import type { BackgroundVariant } from '../engine';
import {
  clearCanvas,
  drawGrain,
  drawLapisGround,
  drawPyriteFlecks,
  readBackgroundTheme,
  strokeKintsugiVein,
} from './utils';

export const kintsugiVeins = {
  id: 'kintsugi-veins',
  label: 'Gold Veins',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const veinCount = Math.max(4, Math.floor(9 * ctx.qualityScale));

    clearCanvas(ctx);
    drawLapisGround(ctx, theme, time);

    for (let i = 0; i < veinCount; i += 1) {
      strokeKintsugiVein(ctx, theme, i + 1, time, i < 3 ? 1 : 0.58);
    }

    drawPyriteFlecks(ctx, theme, time, 110);
    drawGrain(ctx, theme, 0.9);
  },
  dispose() {},
} satisfies BackgroundVariant;
