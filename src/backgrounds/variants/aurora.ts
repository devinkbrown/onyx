// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba } from './utils';

export const aurora = {
  id: 'aurora',
  label: 'Mineral Aurora',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;
    const mineralViolet = mix(theme.lapisDeep, theme.shu, 0.16);
    const wash = c.createLinearGradient(0, 0, ctx.width, ctx.height);
    wash.addColorStop(0, theme.ink);
    wash.addColorStop(0.34, theme.stone2);
    wash.addColorStop(0.66, mineralViolet);
    wash.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = wash;
    c.fillRect(0, 0, ctx.width, ctx.height);

    c.save();
    c.globalCompositeOperation = 'screen';
    const bands = Math.max(4, Math.floor(7 * ctx.qualityScale));

    for (let i = 0; i < bands; i += 1) {
      const y = ctx.height * (0.16 + i * 0.13) + Math.sin(time * 0.00018 + i) * 24;
      const amplitude = 28 + i * 4;
      c.beginPath();
      c.moveTo(-24, y);

      for (let x = -24; x <= ctx.width + 48; x += 80) {
        const cpX = x + 36;
        const cpY = y + Math.sin(time * 0.00022 + x * 0.01 + i) * amplitude;
        const nextX = x + 80;
        const nextY = y + Math.cos(time * 0.00018 + x * 0.012 + i) * amplitude * 0.42;
        c.quadraticCurveTo(cpX, cpY, nextX, nextY);
      }

      c.globalAlpha = 0.08 + i * 0.012;
      c.strokeStyle = i % 2 === 0 ? theme.lapisBright : mineralViolet;
      c.lineWidth = 18 + i * 2;
      c.stroke();

      c.globalAlpha = 0.08;
      c.strokeStyle = rgba(theme.gold, 0.72);
      c.lineWidth = 0.9;
      c.stroke();
    }

    c.restore();
    drawGrain(ctx, theme, 0.65);
  },
  dispose() {},
} satisfies BackgroundVariant;
