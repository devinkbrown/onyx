import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import type { BackgroundTheme } from './utils';
import { clearCanvas, mix, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Frost — for the light frost theme, where the ink tokens are near-white
 * paper and washi is deep slate. Pale cool ground, a faint steel-blue
 * caustic shimmer, slow-falling frost crystals, and tiny dark ice-glints.
 * Everything is drawn dark-on-light so it stays visible on paper.
 */
export const frost = {
  id: 'frost',
  label: 'Frost',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawPaperGround(ctx, theme);
    drawCausticShimmer(ctx, theme, time);
    drawFrostCrystals(ctx, theme, time);
    drawIceGlints(ctx, theme, time);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawPaperGround(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, theme.ink);
  ground.addColorStop(0.55, theme.ink2);
  ground.addColorStop(1, mix(theme.stone, theme.ink2, 0.55));
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);

  // A soft cool wash pooling toward the top, like light through ice.
  const wash = c.createRadialGradient(
    ctx.width * 0.5,
    -ctx.height * 0.2,
    0,
    ctx.width * 0.5,
    -ctx.height * 0.2,
    Math.max(ctx.width, ctx.height) * 0.9,
  );
  wash.addColorStop(0, rgba(theme.lapis, 0.06));
  wash.addColorStop(0.6, rgba(theme.lapis, 0.02));
  wash.addColorStop(1, rgba(theme.lapis, 0));
  c.fillStyle = wash;
  c.fillRect(0, 0, ctx.width, ctx.height);

  // Gentle settling shade along the bottom edge.
  const settle = c.createLinearGradient(0, ctx.height * 0.7, 0, ctx.height);
  settle.addColorStop(0, rgba(theme.stoneLine, 0));
  settle.addColorStop(1, rgba(theme.stoneLine, 0.16));
  c.fillStyle = settle;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

function drawCausticShimmer(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const lines = Math.max(4, Math.floor(7 * ctx.qualityScale));
  const step = Math.max(30, Math.round(56 / Math.max(0.5, ctx.qualityScale)));

  c.save();

  for (let i = 0; i < lines; i += 1) {
    const phase = time * 0.0001 + i * 1.1;
    const baseY = ctx.height * (0.12 + (i * 0.8) / lines);
    const glow = 0.03 + 0.028 * Math.abs(Math.sin(phase * 1.4 + i));

    c.beginPath();
    c.moveTo(-24, baseY);
    for (let x = -24; x <= ctx.width + 48; x += step) {
      const y = baseY + Math.sin(x * 0.01 + phase) * 18 + Math.sin(x * 0.027 + phase * 1.6 + i) * 8;
      c.lineTo(x, y);
    }
    c.strokeStyle = rgba(theme.lapis, glow);
    c.lineWidth = 1 + (i % 3 === 0 ? 1.2 : 0.2);
    c.stroke();
  }

  c.restore();
}

function drawFrostCrystals(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(14, Math.floor(34 * ctx.qualityScale));

  c.save();
  c.lineCap = 'round';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 3 + 7;
    const sx = seeded(seed);
    const sy = seeded(seed + 1);
    const large = i % 6 === 0;

    // Crystals fall slowly, wrapped, with a gentle sideways sway and a
    // barely-perceptible spin.
    const fall = (sy + time * 0.0000105 * (0.45 + sx * 0.7)) % 1;
    const x = sx * ctx.width + Math.sin(time * 0.00013 + i * 1.7) * (7 + sx * 8);
    const y = fall * (ctx.height + 28) - 14;
    const spin = time * 0.00009 * (i % 2 === 0 ? 1 : -1) + seed;
    const twinkle = 0.55 + 0.45 * Math.abs(Math.sin(time * 0.0005 + i * 2.2));
    const arm = (large ? 3.4 + sx * 3.6 : 1.8 + sx * 2.2) * (0.8 + twinkle * 0.25);
    const alpha = (large ? 0.2 : 0.3) * twinkle;

    c.save();
    c.translate(x, y);
    c.rotate(spin);
    c.strokeStyle = rgba(theme.lapis, alpha);
    c.lineWidth = large ? 0.9 : 0.7;

    // Six arms — three crossing strokes through the centre.
    for (let spoke = 0; spoke < 3; spoke += 1) {
      c.beginPath();
      c.moveTo(-arm, 0);
      c.lineTo(arm, 0);
      c.stroke();
      c.rotate(Math.PI / 3);
    }

    c.restore();
  }

  c.restore();
}

function drawIceGlints(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(10, Math.floor(26 * ctx.qualityScale));

  c.save();

  for (let i = 0; i < count; i += 1) {
    const seed = i * 9 + 307;
    const x = seeded(seed) * ctx.width;
    const y = seeded(seed + 1) * ctx.height;
    const sparkle = Math.max(0, Math.sin(time * 0.00035 + i * 2.9));
    const radius = 0.5 + seeded(seed + 2) * 0.8;

    c.globalAlpha = 0.06 + sparkle * 0.14;
    c.fillStyle = theme.washi;
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fill();
  }

  c.restore();
}
