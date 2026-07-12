// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { mix, rgba } from './utils';

/**
 * Mineral Aurora — routed through the shared signature pipeline. Its own wash
 * ground and per-variant grain are retired for the shared luminance-capped
 * ground + fixed washi grain; its distinctive ink layer keeps the screen-blended
 * aurora bands (primary accent crests sinking toward a mineral tint) with their
 * fine gold filament, over the pipeline's single vermilion seal.
 */
export const aurora = {
  id: 'aurora',
  label: 'Mineral Aurora',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      drawAuroraBands(ctx, theme, t);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawAuroraBands(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  // A cool mineral tint — mostly the deep primary with a whisper of shu warmth.
  const mineralViolet = mix(theme.lapisDeep, theme.shu, 0.16);

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
}
