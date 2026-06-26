import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import type { BackgroundTheme } from './utils';
import { clearCanvas, drawGrain, readBackgroundTheme, rgba, seeded } from './utils';

const TAU = Math.PI * 2;

export const deepCurrent = {
  id: 'deep-current',
  label: 'Deep Current',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const currentTime = prefersReducedMotion() ? 0 : time;

    clearCanvas(ctx);
    drawDepthField(ctx, theme, currentTime);
    drawCausticBands(ctx, theme, currentTime);
    drawCurrentPaths(ctx, theme, currentTime);
    drawBioluminescence(ctx, theme, currentTime);
    drawGrain(ctx, theme, 0.72);
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawDepthField(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const slowDrift = Math.sin(time * 0.000055) * ctx.width * 0.04;
  const depth = c.createLinearGradient(0, 0, 0, ctx.height);
  depth.addColorStop(0, theme.stone3);
  depth.addColorStop(0.16, theme.stone2);
  depth.addColorStop(0.46, theme.stone);
  depth.addColorStop(0.76, theme.ink2);
  depth.addColorStop(1, theme.ink);

  c.fillStyle = depth;
  c.fillRect(0, 0, ctx.width, ctx.height);

  c.save();
  c.globalCompositeOperation = 'screen';

  const surfaceGlow = c.createRadialGradient(
    ctx.width * 0.5 + slowDrift,
    -ctx.height * 0.18,
    0,
    ctx.width * 0.5 + slowDrift,
    ctx.height * 0.04,
    Math.max(ctx.width, ctx.height) * 0.92,
  );
  surfaceGlow.addColorStop(0, rgba(theme.lapisBright, 0.2));
  surfaceGlow.addColorStop(0.26, rgba(theme.lapisDeep, 0.15));
  surfaceGlow.addColorStop(0.62, rgba(theme.stone2, 0.08));
  surfaceGlow.addColorStop(1, rgba(theme.ink, 0));
  c.fillStyle = surfaceGlow;
  c.fillRect(0, 0, ctx.width, ctx.height);

  const leftBloom = c.createRadialGradient(
    ctx.width * 0.1 - slowDrift * 0.4,
    ctx.height * 0.34,
    0,
    ctx.width * 0.1 - slowDrift * 0.4,
    ctx.height * 0.34,
    Math.max(ctx.width, ctx.height) * 0.62,
  );
  leftBloom.addColorStop(0, rgba(theme.lapisDeep, 0.12));
  leftBloom.addColorStop(0.48, rgba(theme.stoneLine, 0.06));
  leftBloom.addColorStop(1, rgba(theme.ink, 0));
  c.fillStyle = leftBloom;
  c.fillRect(0, 0, ctx.width, ctx.height);

  c.restore();

  const abyss = c.createLinearGradient(0, ctx.height * 0.48, 0, ctx.height);
  abyss.addColorStop(0, rgba(theme.ink, 0));
  abyss.addColorStop(0.66, rgba(theme.ink, 0.28));
  abyss.addColorStop(1, rgba(theme.ink, 0.68));
  c.fillStyle = abyss;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

function drawCausticBands(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(3, Math.floor(5 * ctx.qualityScale));
  const topLimit = ctx.height * 0.34;

  c.save();
  c.globalCompositeOperation = 'screen';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = rgba(theme.lapisBright, 0.58);
  c.shadowColor = rgba(theme.lapisBright, 0.18);
  c.shadowBlur = 10;

  for (let i = 0; i < count; i += 1) {
    const seed = i * 23 + 11;
    const y = topLimit * (0.12 + i * 0.17) + Math.sin(time * 0.00012 + seed) * 7;
    const amplitude = 5 + seeded(seed) * 8;

    c.globalAlpha = 0.028 + seeded(seed + 1) * 0.026;
    c.lineWidth = 0.7 + seeded(seed + 2) * 0.75;
    c.setLineDash([70 + seeded(seed + 3) * 70, 46 + seeded(seed + 4) * 54]);
    c.lineDashOffset = -time * (0.006 + seeded(seed + 5) * 0.004) - i * 38;
    traceWave(ctx, y, amplitude, time * 0.00011 + i * 1.4, 0.0045, 92);
    c.stroke();
  }

  c.restore();
}

function drawCurrentPaths(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(6, Math.floor(10 * ctx.qualityScale));

  c.save();
  c.globalCompositeOperation = 'screen';
  c.lineCap = 'round';
  c.lineJoin = 'round';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 37 + 101;
    const depth = seeded(seed);
    const baseY = ctx.height * (0.16 + depth * 0.72);
    const amplitude = (16 + seeded(seed + 1) * 32) * (0.74 + ctx.qualityScale * 0.28);
    const phase = time * (0.000045 + seeded(seed + 2) * 0.000045) + i * 1.87;
    const frequency = 0.0028 + seeded(seed + 3) * 0.003;
    const step = Math.max(96, ctx.width / (4.5 + seeded(seed + 4) * 2.5));
    const depthFade = 1 - depth * 0.34;

    c.shadowColor = rgba(theme.lapisBright, 0.13);
    c.shadowBlur = 16 + seeded(seed + 5) * 14;
    c.globalAlpha = (0.05 + seeded(seed + 6) * 0.045) * depthFade;
    c.strokeStyle = rgba(i % 3 === 0 ? theme.lapisBright : theme.lapisDeep, 0.72);
    c.lineWidth = 14 + seeded(seed + 7) * 22;
    c.setLineDash([]);
    traceWave(ctx, baseY, amplitude, phase, frequency, step);
    c.stroke();

    c.shadowBlur = 8;
    c.globalAlpha = (0.14 + seeded(seed + 8) * 0.11) * depthFade;
    c.strokeStyle = theme.lapis;
    c.lineWidth = 0.9 + seeded(seed + 9) * 1.5;
    c.setLineDash([110 + seeded(seed + 10) * 70, 150 + seeded(seed + 11) * 120]);
    c.lineDashOffset = -time * (0.009 + seeded(seed + 12) * 0.007) - i * 53;
    traceWave(ctx, baseY, amplitude * 0.92, phase + 0.34, frequency, step);
    c.stroke();
  }

  c.restore();
}

function drawBioluminescence(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number): void {
  const c = ctx.context;
  const count = Math.max(28, Math.floor(58 * ctx.qualityScale));
  const travelWidth = ctx.width + 180;
  const travelHeight = ctx.height + 52;

  c.save();
  c.globalCompositeOperation = 'screen';

  for (let i = 0; i < count; i += 1) {
    const seed = i * 19 + 503;
    const warm = i % 23 === 0;
    const color = warm ? theme.goldBright : theme.lapisBright;
    const driftX = time * (0.002 + seeded(seed + 1) * 0.006);
    const driftY = time * (0.0004 + seeded(seed + 2) * 0.0016);
    const x =
      (seeded(seed + 3) * travelWidth + driftX + Math.sin(time * 0.00012 + seed) * 18) % travelWidth -
      90;
    const y =
      (seeded(seed + 4) * travelHeight - driftY + Math.cos(time * 0.00009 + seed) * 14 + travelHeight) %
        travelHeight -
      26;
    const radius = 0.42 + seeded(seed + 5) * (warm ? 1.2 : 1.65);
    const pulse = 0.66 + Math.sin(time * (0.00055 + seeded(seed + 6) * 0.00042) + seed) * 0.26;
    const depthFade = 1 - Math.min(0.42, y / Math.max(1, ctx.height) * 0.34);

    c.globalAlpha = (0.1 + seeded(seed + 7) * 0.24) * pulse * depthFade * (warm ? 0.48 : 1);
    c.fillStyle = color;
    c.shadowColor = rgba(color, warm ? 0.22 : 0.3);
    c.shadowBlur = 5 + radius * 4;
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.fill();
  }

  c.restore();
}

function traceWave(
  ctx: BackgroundFrameContext,
  baseY: number,
  amplitude: number,
  phase: number,
  frequency: number,
  step: number,
): void {
  const c = ctx.context;
  const padding = Math.max(120, ctx.width * 0.16);
  const startX = -padding;
  const startY = waveY(startX, baseY, amplitude, phase, frequency);

  c.beginPath();
  c.moveTo(startX, startY);

  for (let x = startX; x <= ctx.width + padding; x += step) {
    const nextX = x + step;
    const controlX = x + step * 0.52;
    const controlY = waveY(controlX, baseY, amplitude, phase + 0.18, frequency);
    const nextY = waveY(nextX, baseY, amplitude, phase, frequency);
    c.quadraticCurveTo(controlX, controlY, nextX, nextY);
  }
}

function waveY(x: number, baseY: number, amplitude: number, phase: number, frequency: number): number {
  return (
    baseY +
    Math.sin(x * frequency + phase) * amplitude +
    Math.cos(x * frequency * 0.48 - phase * 0.74) * amplitude * 0.34
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
