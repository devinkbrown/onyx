import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import type { BackgroundTheme } from './utils';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Grove — for the jade themes, where the lapis tokens carry the green. Deep
 * forest ground under a faint canopy-dapple, slow slanted light-shafts, and
 * drifting spores in the theme's primary accent. Calm and mineral — no gold.
 */
export const forest = {
  id: 'forest',
  label: 'Grove',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawForestGround(ctx, theme);
    drawCanopyDapple(ctx, theme, time);
    drawLightShafts(ctx, theme, time);
    drawSpores(ctx, theme, time);
    drawGrain(ctx, theme, 0.5);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawForestGround(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, mix(theme.stone2, theme.ink, 0.45));
  ground.addColorStop(0.4, mix(theme.stone, theme.ink, 0.55));
  ground.addColorStop(0.78, theme.ink);
  ground.addColorStop(1, theme.ink2);
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

function drawCanopyDapple(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const patches = 4;

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < patches; i += 1) {
    const seed = i * 53 + 29;
    const x =
      ctx.width * (0.1 + seeded(seed) * 0.8) +
      Math.sin(time * 0.000055 + seeded(seed + 1) * TAU) * ctx.width * 0.06;
    const y =
      ctx.height * (0.04 + seeded(seed + 2) * 0.3) +
      Math.cos(time * 0.000042 + seeded(seed + 3) * TAU) * ctx.height * 0.04;
    const breathe = 0.66 + Math.sin(time * 0.00017 + i * 1.8) * 0.34;
    const radius = Math.max(ctx.width, ctx.height) * (0.14 + seeded(seed + 4) * 0.12);

    const patch = c.createRadialGradient(x, y, 0, x, y, radius);
    patch.addColorStop(0, rgba(theme.lapisBright, 0.05 * breathe));
    patch.addColorStop(0.55, rgba(theme.lapisDeep, 0.025 * breathe));
    patch.addColorStop(1, rgba(theme.ink, 0));
    c.fillStyle = patch;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  c.restore();
}

function drawLightShafts(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(3, Math.floor(5 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 41 + 7;
    const anchorX =
      ctx.width * (0.08 + seeded(seed) * 0.84) +
      Math.sin(time * 0.000038 + seeded(seed + 1) * TAU) * ctx.width * 0.05;
    const tilt = 0.1 + seeded(seed + 2) * 0.14;
    const width = ctx.width * (0.05 + seeded(seed + 3) * 0.07);
    const glow = 0.55 + Math.sin(time * 0.00012 + seeded(seed + 4) * TAU) * 0.45;

    c.save();
    c.translate(anchorX, -ctx.height * 0.1);
    c.rotate(tilt);

    const shaft = c.createLinearGradient(-width, 0, width, 0);
    shaft.addColorStop(0, rgba(theme.lapisBright, 0));
    shaft.addColorStop(0.5, rgba(theme.lapisBright, 0.03 * glow));
    shaft.addColorStop(1, rgba(theme.lapisBright, 0));
    c.fillStyle = shaft;
    c.fillRect(-width, 0, width * 2, ctx.height * 1.45);
    c.restore();
  }

  c.restore();
}

function drawSpores(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(28, Math.floor(68 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const sx = seeded(i * 2 + 3);
    const sy = seeded(i * 2 + 4);
    const bright = i % 5 === 0;

    // Spores settle slowly downward, wrapped, with a lazy sideways waft.
    const fall = (sy + time * 0.0000095 * (0.4 + sx * 0.7)) % 1;
    const x = sx * ctx.width + Math.sin(time * 0.00014 + i * 1.6) * (10 + sx * 8);
    const y = fall * (ctx.height + 20) - 10;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(time * 0.0006 + i * 2.1));
    const radius = (bright ? 0.9 + sx * 1.3 : 0.5 + sx * 1) * (0.75 + twinkle * 0.35);
    const colour = bright ? theme.lapisBright : theme.lapis;

    c.beginPath();
    c.arc(x, y, radius * 3, 0, TAU);
    c.fillStyle = rgba(colour, 0.04 * twinkle);
    c.fill();

    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fillStyle = rgba(colour, (bright ? 0.5 : 0.34) * twinkle);
    c.fill();
  }

  c.restore();
}
