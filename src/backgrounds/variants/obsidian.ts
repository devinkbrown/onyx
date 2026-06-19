import type { BackgroundVariant } from '../engine';
import { clearCanvas, readBackgroundTheme } from './utils';

export const obsidian = {
  id: 'obsidian',
  label: 'Obsidian',
  kind: 'solid',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx) {
    const theme = readBackgroundTheme(ctx.canvas);
    clearCanvas(ctx);
    ctx.context.fillStyle = theme.ink;
    ctx.context.fillRect(0, 0, ctx.width, ctx.height);
  },
  dispose() {},
} satisfies BackgroundVariant;
