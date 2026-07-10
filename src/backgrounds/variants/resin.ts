import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { ambientRms, breathe, rmsToBloom, timeOfDayWarmth, warmthShift } from '../reactivity';
import type { BackgroundTheme } from './utils';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Resin — for the amber themes, where gold is legitimately the primary
 * warmth. Fossilized amber: motes hang suspended in the depth, circling
 * their anchors almost imperceptibly, while two large light-pools breathe
 * through the resin. Slow, warm, luxurious.
 */
export const resin = {
  id: 'resin',
  label: 'Resin',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawAmberDepth(ctx, theme);
    drawAmberPools(ctx, theme, time);
    drawSuspendedMotes(ctx, theme, time);
    drawGrain(ctx, theme, 0.85);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawAmberDepth(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, theme.ink2);
  ground.addColorStop(0.42, mix(theme.stone, theme.ink, 0.4));
  ground.addColorStop(0.8, theme.ink);
  ground.addColorStop(1, mix(theme.goldDeep, theme.ink, 0.88));
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);

  const warmth = c.createRadialGradient(
    ctx.width * 0.5,
    ctx.height * 0.52,
    0,
    ctx.width * 0.5,
    ctx.height * 0.52,
    Math.max(ctx.width, ctx.height) * 0.85,
  );
  warmth.addColorStop(0, rgba(theme.goldDeep, 0.1));
  warmth.addColorStop(0.6, rgba(theme.goldDeep, 0.04));
  warmth.addColorStop(1, rgba(theme.ink, 0));

  c.save();
  c.globalCompositeOperation = 'screen';
  c.fillStyle = warmth;
  c.fillRect(0, 0, ctx.width, ctx.height);
  c.restore();
}

function drawAmberPools(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const anchors = [
    { x: 0.3, y: 0.36, phase: 0.6 },
    { x: 0.72, y: 0.64, phase: 3.4 },
  ];

  // Warmth drift: the amber reads a hair warmer by day, cooler by night. Hue
  // only, so the pools never brighten past their tuned envelope.
  const warmth = timeOfDayWarmth(Date.now());
  const gold = warmthShift(theme.gold, warmth, 5);
  const goldDeep = warmthShift(theme.goldDeep, warmth, 5);

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    const pulse = breathe(time, { freq: 0.00013, phase: anchor.phase, base: 0.6, depth: 0.4 });
    // Capped voice-RMS bloom — reaches, but never exceeds, the original alpha.
    const bloom = rmsToBloom({ rms: ambientRms(time, anchor.phase), base: 0.9, gain: 0.1, cap: 1 });
    const x = ctx.width * anchor.x + Math.sin(time * 0.00003 + anchor.phase) * ctx.width * 0.03;
    const y = ctx.height * anchor.y + Math.cos(time * 0.000024 + anchor.phase) * ctx.height * 0.03;
    const radius = Math.max(ctx.width, ctx.height) * (0.24 + i * 0.06) * (0.88 + pulse * 0.16);

    const pool = c.createRadialGradient(x, y, 0, x, y, radius);
    pool.addColorStop(0, rgba(gold, 0.06 * pulse * bloom));
    pool.addColorStop(0.45, rgba(mix(gold, goldDeep, 0.5), 0.032 * pulse * bloom));
    pool.addColorStop(1, rgba(theme.ink, 0));
    c.fillStyle = pool;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  c.restore();
}

function drawSuspendedMotes(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(30, Math.floor(84 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 4 + 9;
    const anchorX = seeded(seed) * ctx.width;
    const anchorY = seeded(seed + 1) * ctx.height;
    const bright = i % 7 === 0;

    // Suspended in resin: each mote circles its anchor by a few pixels,
    // never travelling — only the light moves through.
    const orbit = 3 + seeded(seed + 2) * 8;
    const angle = time * (0.00005 + seeded(seed + 3) * 0.00008) + seed;
    const x = anchorX + Math.sin(angle) * orbit;
    const y = anchorY + Math.cos(angle * 0.7) * orbit * 0.6;

    const shimmer = 0.55 + 0.45 * Math.abs(Math.sin(time * 0.00042 + i * 1.4));
    const radius = (bright ? 0.9 + seeded(seed + 2) * 1.5 : 0.45 + seeded(seed + 2) * 1.05) * (0.8 + shimmer * 0.3);
    const colour = bright ? theme.goldBright : theme.gold;

    c.beginPath();
    c.arc(x, y, radius * 3.1, 0, TAU);
    c.fillStyle = rgba(colour, (bright ? 0.05 : 0.032) * shimmer);
    c.fill();

    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fillStyle = rgba(colour, (bright ? 0.42 : 0.26) * shimmer);
    c.fill();
  }

  c.restore();
}
