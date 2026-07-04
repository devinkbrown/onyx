import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import type { BackgroundTheme } from './utils';
import { clearCanvas, mix, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

/**
 * Mist — for the slate themes. Warm graphite fog: a near-solid ground with
 * two or three very soft mist bands counter-drifting across it, and a scatter
 * of faint mineral flecks. Almost still, but alive. The only warmth is an
 * occasional bronze fleck — never more.
 */
export const mist = {
  id: 'mist',
  label: 'Mist',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);

    clearCanvas(ctx);
    drawGraphiteGround(ctx, theme);
    drawMistBands(ctx, theme, time);
    drawMineralFlecks(ctx, theme, time);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawGraphiteGround(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  const ground = c.createLinearGradient(0, 0, 0, ctx.height);
  ground.addColorStop(0, mix(theme.stone, theme.ink, 0.5));
  ground.addColorStop(0.5, theme.ink2);
  ground.addColorStop(1, theme.ink);
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

function drawMistBands(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const bands = [
    { y: 0.26, direction: 1, speed: 0.008, phase: 0.9 },
    { y: 0.54, direction: -1, speed: 0.0058, phase: 3.1 },
    { y: 0.8, direction: 1, speed: 0.0044, phase: 5.2 },
  ];
  const blobsPerBand = Math.max(3, Math.floor(5 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const band = bands[bandIndex]!;
    const travel = ctx.width * 1.6;
    const drift = time * band.speed * band.direction;
    const swell = 0.72 + Math.sin(time * 0.00007 + band.phase) * 0.28;

    for (let i = 0; i < blobsPerBand; i += 1) {
      const seed = bandIndex * 97 + i * 31 + 11;
      const x = (((seeded(seed) * travel + drift) % travel) + travel) % travel - ctx.width * 0.3;
      const y =
        ctx.height * band.y +
        Math.sin(time * 0.00005 + seeded(seed + 1) * TAU) * ctx.height * 0.024;
      const radius = ctx.width * (0.16 + seeded(seed + 2) * 0.14);

      // Squash each blob into a lens so the fog reads as horizontal drift.
      c.save();
      c.translate(x, y);
      c.scale(1, 0.3);

      const blob = c.createRadialGradient(0, 0, 0, 0, 0, radius);
      blob.addColorStop(0, rgba(theme.washiDim, 0.028 * swell));
      blob.addColorStop(0.55, rgba(theme.washiMute, 0.014 * swell));
      blob.addColorStop(1, rgba(theme.ink, 0));
      c.fillStyle = blob;
      c.fillRect(-radius, -radius, radius * 2, radius * 2);
      c.restore();
    }
  }

  c.restore();
}

function drawMineralFlecks(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(16, Math.floor(44 * ctx.qualityScale));

  c.save();

  for (let i = 0; i < count; i += 1) {
    const seed = i * 6 + 211;
    const bronze = i % 17 === 0;
    const x = seeded(seed) * ctx.width + Math.sin(time * 0.00003 + i * 2.2) * 4;
    const y = seeded(seed + 1) * ctx.height;
    const glimmer = 0.5 + 0.5 * Math.sin(time * 0.00024 + i * 1.9);
    const radius = 0.4 + seeded(seed + 2) * 0.85;

    c.globalAlpha = bronze ? 0.05 + glimmer * 0.05 : 0.05 + glimmer * 0.075;
    c.fillStyle = bronze ? theme.gold : theme.washiDim;
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fill();
  }

  c.restore();
}
