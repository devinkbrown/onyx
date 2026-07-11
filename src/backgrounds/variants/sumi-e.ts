// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { breathe } from '../reactivity';
import type { BackgroundTheme } from './utils';
import { clearCanvas, readBackgroundTheme, rgba, seeded } from './utils';

/**
 * Sumi-e — for the ink themes. Pure monochrome ink-wash: a near-black ground,
 * slow diagonal ink-rain, and a couple of soft ink-bloom clouds — everything
 * drawn in washi greys at low alpha. No colour at all; minimal and refined.
 */
export const sumiE = {
  id: 'sumi-e',
  label: 'Sumi-e',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawInkGround(ctx, theme);
    drawInkBlooms(ctx, theme, time);
    drawInkRain(ctx, theme, time);
    drawPaperFlecks(ctx, theme, time);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawInkGround(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, theme.ink2);
  ground.addColorStop(0.6, theme.ink);
  ground.addColorStop(1, theme.ink);
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

function drawInkBlooms(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const blooms = 3;

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < blooms; i += 1) {
    const seed = i * 61 + 19;
    const x =
      ctx.width * (0.16 + seeded(seed) * 0.68) +
      Math.sin(time * 0.000037 + seeded(seed + 1) * 6.28) * ctx.width * 0.05;
    const y =
      ctx.height * (0.16 + seeded(seed + 2) * 0.6) +
      Math.cos(time * 0.000029 + seeded(seed + 3) * 6.28) * ctx.height * 0.05;
    // Shared reactive oscillator (drop-in for the old base + sin·depth pulse).
    const pulse = breathe(time, { freq: 0.0001, phase: i * 2.4, base: 0.6, depth: 0.4 });
    const radius = Math.max(ctx.width, ctx.height) * (0.16 + seeded(seed + 4) * 0.14);

    // Bloom: a soft grey heart with a slightly denser inner ring, the way
    // wet ink feathers outward on paper.
    const bloom = c.createRadialGradient(x, y, 0, x, y, radius);
    bloom.addColorStop(0, rgba(theme.washi, 0.026 * pulse));
    bloom.addColorStop(0.32, rgba(theme.washi, 0.018 * pulse));
    bloom.addColorStop(0.7, rgba(theme.washiDim, 0.008 * pulse));
    bloom.addColorStop(1, rgba(theme.ink, 0));
    c.fillStyle = bloom;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  c.restore();
}

function drawInkRain(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(18, Math.floor(42 * ctx.qualityScale));

  // A consistent brush angle for the whole sheet — steep, slightly leaning.
  const dirX = 0.28;
  const dirY = 0.96;
  const span = ctx.height + 220;

  c.save();
  c.lineCap = 'round';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 5 + 3;
    const progress = (seeded(seed) + time * 0.000021 * (0.5 + seeded(seed + 1) * 0.8)) % 1;
    const along = progress * span - 110;
    const x = seeded(seed + 2) * (ctx.width + 160) - 80 + along * dirX;
    const y = along * dirY;
    const length = 34 + seeded(seed + 3) * 96;

    // Streaks fade in and out across their fall so they never pop at the wrap.
    const life = Math.sin(progress * Math.PI);
    const alpha = (0.022 + seeded(seed + 4) * 0.04) * life;

    c.strokeStyle = rgba(theme.washi, alpha);
    c.lineWidth = 0.5 + seeded(seed + 5) * 0.8;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + dirX * length, y + dirY * length);
    c.stroke();
  }

  c.restore();
}

function drawPaperFlecks(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.floor(70 * ctx.qualityScale);

  c.save();

  for (let i = 0; i < count; i += 1) {
    const seed = i * 7 + 401;
    const x = seeded(seed) * ctx.width;
    const y = seeded(seed + 1) * ctx.height;
    const glimmer = 0.5 + 0.5 * Math.sin(time * 0.00019 + i * 2.7);

    c.globalAlpha = 0.035 + glimmer * 0.03;
    c.fillStyle = theme.washiDim;
    c.fillRect(x, y, 0.9 + seeded(seed + 2) * 1.4, 0.7);
  }

  c.restore();
}
