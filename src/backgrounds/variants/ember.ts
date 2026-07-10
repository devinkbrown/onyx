import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { ambientRms, breathe, rmsToBloom, timeOfDayWarmth, warmthShift } from '../reactivity';
import type { BackgroundTheme } from './utils';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Ember — for the garnet themes. A dark garnet ground with a shu-deep
 * vignette, slow-rising ember motes and the occasional brighter spark, a
 * whisper of heat-shimmer, and dim glow pools breathing along the bottom.
 * Every point of warmth is the shu accent — no gold anywhere.
 */
export const ember = {
  id: 'ember',
  label: 'Ember',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawGarnetGround(ctx, theme, time);
    drawGlowPools(ctx, theme, time);
    drawHeatShimmer(ctx, theme, time);
    drawEmberMotes(ctx, theme, time);
    drawGrain(ctx, theme, 0.4);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawGarnetGround(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, theme.ink2);
  ground.addColorStop(0.46, theme.ink);
  ground.addColorStop(0.82, mix(theme.stone, theme.ink, 0.4));
  ground.addColorStop(1, mix(theme.shu, theme.ink, 0.86));
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);

  // Shu-deep vignette rising from below — the light of a banked fire.
  const drift = Math.sin(time * 0.00006) * ctx.width * 0.05;
  const vignette = c.createRadialGradient(
    ctx.width * 0.5 + drift,
    ctx.height * 1.12,
    0,
    ctx.width * 0.5 + drift,
    ctx.height * 1.12,
    Math.max(ctx.width, ctx.height) * 0.95,
  );
  vignette.addColorStop(0, rgba(mix(theme.shu, theme.ink, 0.55), 0.34));
  vignette.addColorStop(0.55, rgba(mix(theme.shu, theme.ink, 0.75), 0.14));
  vignette.addColorStop(1, rgba(theme.ink, 0));

  c.save();
  c.globalCompositeOperation = 'screen';
  c.fillStyle = vignette;
  c.fillRect(0, 0, ctx.width, ctx.height);
  c.restore();
}

function drawGlowPools(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const pools = 3;

  // Time-of-day warmth drift: the banked fire glows a touch warmer at midday,
  // cooler in the small hours. Hue-only shift — luminance is untouched, so the
  // legibility contract holds.
  const warmth = timeOfDayWarmth(Date.now());
  const shu = warmthShift(theme.shu, warmth, 5);

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < pools; i += 1) {
    const seed = i * 47 + 13;
    const x = ctx.width * (0.14 + seeded(seed) * 0.72) + Math.sin(time * 0.00004 + i * 2.2) * 26;
    const y = ctx.height * (0.9 + seeded(seed + 1) * 0.08);
    const pulse = breathe(time, { freq: 0.00021, phase: seeded(seed + 2) * TAU, base: 0.62, depth: 0.38 });
    // Voice-RMS bloom, capped at 1 so a loud channel can only reach — never
    // exceed — the original hand-tuned brightness.
    const bloom = rmsToBloom({ rms: ambientRms(time, seed), base: 0.88, gain: 0.12, cap: 1 });
    const radius = ctx.width * (0.1 + seeded(seed + 3) * 0.12) * (0.86 + pulse * 0.2);

    const pool = c.createRadialGradient(x, y, 0, x, y, radius);
    pool.addColorStop(0, rgba(shu, 0.075 * pulse * bloom));
    pool.addColorStop(0.5, rgba(mix(shu, theme.ink, 0.4), 0.035 * pulse * bloom));
    pool.addColorStop(1, rgba(theme.ink, 0));
    c.fillStyle = pool;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  c.restore();
}

function drawHeatShimmer(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < 2; i += 1) {
    const sway = Math.sin(time * (0.00005 + i * 0.00003) + i * 2.6) * ctx.width * 0.12;
    const layer = c.createLinearGradient(sway, ctx.height, ctx.width + sway, ctx.height * 0.3);
    layer.addColorStop(0, rgba(theme.shu, 0));
    layer.addColorStop(0.5, rgba(i === 0 ? theme.shu : theme.shuBright, 0.028));
    layer.addColorStop(1, rgba(theme.shu, 0));
    c.fillStyle = layer;
    c.fillRect(0, ctx.height * 0.4, ctx.width, ctx.height * 0.6);
  }

  c.restore();
}

function drawEmberMotes(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(26, Math.floor(72 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const sx = seeded(i * 3 + 5);
    const sy = seeded(i * 3 + 6);
    const spark = i % 11 === 0;

    // Slow rise with wrap; embers sway sideways as they climb.
    const rise = (sy + time * 0.0000125 * (0.45 + sx * 0.8)) % 1;
    const x = sx * ctx.width + Math.sin(time * 0.00019 + i * 1.9) * (8 + sx * 9);
    const y = (1 - rise) * (ctx.height + 24) - 12;

    // Embers burn brightest near the pools below and fade as they rise.
    const heightFade = 0.3 + 0.7 * Math.min(1, y / Math.max(1, ctx.height));
    const twinkle = 0.5 + 0.5 * Math.abs(Math.sin(time * 0.00082 + i * 2.3));
    const radius = (spark ? 1 + sx * 1.4 : 0.5 + sx * 1.1) * (0.72 + twinkle * 0.4);
    const colour = spark ? theme.shuBright : theme.shu;

    c.beginPath();
    c.arc(x, y, radius * 3.2, 0, TAU);
    c.fillStyle = rgba(colour, (spark ? 0.07 : 0.045) * twinkle * heightFade);
    c.fill();

    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fillStyle = rgba(colour, (spark ? 0.62 : 0.4) * twinkle * heightFade);
    c.fill();
  }

  c.restore();
}
