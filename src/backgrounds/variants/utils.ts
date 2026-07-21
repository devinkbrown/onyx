// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext } from '../engine';
import { createEpochMemo, themeEpoch } from '../theme-epoch';

export interface BackgroundTheme {
  ink: string;
  ink2: string;
  stone: string;
  stone2: string;
  stone3: string;
  stoneLine: string;
  lapis: string;
  lapisBright: string;
  lapisDeep: string;
  gold: string;
  goldBright: string;
  goldDeep: string;
  shu: string;
  shuBright: string;
  paper: string;
  paperDim: string;
  paperMute: string;
}

const FALLBACK_THEME: BackgroundTheme = {
  ink: '#07090f',
  ink2: '#0a0d16',
  stone: '#0d1631',
  stone2: '#122051',
  stone3: '#18306e',
  stoneLine: '#20356f',
  lapis: '#2f5bf0',
  lapisBright: '#4f7bff',
  lapisDeep: '#1d3aa8',
  gold: '#c9a24a',
  goldBright: '#ecc873',
  goldDeep: '#9a7a30',
  shu: '#e0452f',
  shuBright: '#ff5a40',
  paper: '#ece4cf',
  paperDim: '#ada590',
  paperMute: '#6d6f86',
};

const TOKEN_MAP: Record<keyof BackgroundTheme, string> = {
  ink: '--ink',
  ink2: '--ink-2',
  stone: '--stone',
  stone2: '--stone-2',
  stone3: '--stone-3',
  stoneLine: '--stone-line',
  lapis: '--lapis',
  lapisBright: '--lapis-bright',
  lapisDeep: '--lapis-deep',
  gold: '--gold',
  goldBright: '--gold-bright',
  goldDeep: '--gold-deep',
  shu: '--shu',
  shuBright: '--shu-bright',
  paper: '--paper',
  paperDim: '--paper-dim',
  paperMute: '--paper-mute',
};

/** A source of resolved CSS custom-property values (`--ink` → `#07090f`). */
export type TokenReader = (name: string) => string;

/**
 * Pure: map the theme tokens through `read`, falling back to the built-in
 * defaults for any token the reader returns empty. DOM-free so the token→theme
 * projection is unit-testable without a live document.
 */
export function computeBackgroundTheme(read: TokenReader): BackgroundTheme {
  const theme = { ...FALLBACK_THEME };

  for (const key of Object.keys(TOKEN_MAP) as Array<keyof BackgroundTheme>) {
    const value = read(TOKEN_MAP[key]).trim();
    if (value) theme[key] = value;
  }

  return theme;
}

function readThemeFromDocument(): BackgroundTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return FALLBACK_THEME;
  }

  // Backgrounds always render in the main document, so tokens come from its
  // documentElement — a single getComputedStyle per (re)read, not per frame.
  const styles = getComputedStyle(document.documentElement);
  return computeBackgroundTheme((name) => styles.getPropertyValue(name));
}

const cachedTheme = createEpochMemo(readThemeFromDocument, themeEpoch);

/**
 * The active background theme tokens. Cached against the shared theme epoch: the
 * expensive `getComputedStyle` read happens once per theme switch, not once per
 * animation frame. The engine's theme `MutationObserver` bumps the epoch when a
 * switch mutates the tokens, so live theme changes still take effect on the next
 * frame. The `canvas` argument is retained for call-site compatibility.
 */
export function readBackgroundTheme(_canvas?: HTMLCanvasElement): BackgroundTheme {
  return cachedTheme();
}

export function clearCanvas(ctx: BackgroundFrameContext): void {
  ctx.context.clearRect(0, 0, ctx.width, ctx.height);
}

export function rgba(color: string, alpha: number): string {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

export function mix(colorA: string, colorB: string, amount: number): string {
  const a = parseHexColor(colorA);
  const b = parseHexColor(colorB);
  if (!a || !b) return colorA;

  const ratio = clamp(amount, 0, 1);
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bl = Math.round(a.b + (b.b - a.b) * ratio);
  // Hex output keeps mixed colors composable with rgba() above.
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`;
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

export function seeded(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function drawLapisGround(ctx: BackgroundFrameContext, theme: BackgroundTheme, time = 0): void {
  const c = ctx.context;
  const drift = Math.sin(time * 0.00008) * ctx.width * 0.03;
  const ground = c.createLinearGradient(0, 0, ctx.width, ctx.height);
  ground.addColorStop(0, theme.ink);
  ground.addColorStop(0.42, theme.stone);
  ground.addColorStop(0.74, theme.lapisDeep);
  ground.addColorStop(1, theme.ink2);
  c.fillStyle = ground;
  c.fillRect(0, 0, ctx.width, ctx.height);

  const depth = c.createLinearGradient(0, 0, ctx.width + drift, 0);
  depth.addColorStop(0, rgba(theme.ink, 0.58));
  depth.addColorStop(0.28, rgba(theme.stone2, 0.32));
  depth.addColorStop(0.52, rgba(theme.lapis, 0.2));
  depth.addColorStop(0.78, rgba(theme.stone3, 0.22));
  depth.addColorStop(1, rgba(theme.ink, 0.7));
  c.fillStyle = depth;
  c.fillRect(0, 0, ctx.width, ctx.height);
}

export function drawGrain(ctx: BackgroundFrameContext, theme: BackgroundTheme, density = 1): void {
  const c = ctx.context;
  const count = Math.floor(120 * density * ctx.qualityScale);
  c.save();
  c.globalAlpha = 0.1;
  c.fillStyle = theme.paperDim;

  for (let i = 0; i < count; i += 1) {
    const x = seeded(i + 17) * ctx.width;
    const y = seeded(i + 71) * ctx.height;
    const w = 1 + seeded(i + 131) * 1.8;
    c.fillRect(x, y, w, 0.7);
  }

  c.restore();
}

export function drawPyriteFlecks(ctx: BackgroundFrameContext, theme: BackgroundTheme, time: number, countBase = 86): void {
  const c = ctx.context;
  const count = Math.floor(countBase * ctx.qualityScale);

  c.save();
  c.fillStyle = theme.goldBright;
  c.shadowColor = rgba(theme.goldBright, 0.24);
  c.shadowBlur = 4;

  for (let i = 0; i < count; i += 1) {
    const seed = i + 200;
    const drift = time * (0.004 + seeded(seed) * 0.009);
    const x = (seeded(seed + 1) * ctx.width + drift) % (ctx.width + 18) - 9;
    const y = (seeded(seed + 2) * ctx.height + Math.sin(time * 0.00034 + i) * 8) % ctx.height;
    const radius = 0.45 + seeded(seed + 3) * 1.35;
    const alpha = 0.24 + Math.sin(time * 0.0012 + i * 1.7) * 0.12 + seeded(seed + 4) * 0.22;

    c.globalAlpha = alpha;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();
}

export function strokeGoldVein(
  ctx: BackgroundFrameContext,
  theme: BackgroundTheme,
  index: number,
  time: number,
  alpha = 1,
): void {
  const c = ctx.context;
  const xStart = ctx.width * (0.08 + seeded(index) * 0.82);
  const yStart = ctx.height * (-0.1 + seeded(index + 1) * 0.26);
  const segments = 5 + Math.floor(seeded(index + 2) * 4);
  const yStep = (ctx.height * 1.2) / segments;
  const sway = Math.sin(time * 0.00011 + index * 3.1) * 16 * ctx.qualityScale;

  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(xStart, yStart);

  let x = xStart;
  let y = yStart;
  for (let segment = 0; segment < segments; segment += 1) {
    const seed = index * 31 + segment * 11;
    const nextX = x + (seeded(seed) - 0.5) * ctx.width * 0.18 + sway;
    const nextY = y + yStep * (0.74 + seeded(seed + 1) * 0.48);
    const controlX = x + (seeded(seed + 2) - 0.5) * ctx.width * 0.2 - sway * 0.5;
    const controlY = y + yStep * 0.52;
    c.quadraticCurveTo(controlX, controlY, nextX, nextY);
    x = nextX;
    y = nextY;
  }

  c.globalAlpha = 0.28 * alpha;
  c.strokeStyle = rgba(theme.ink, 0.8);
  c.lineWidth = 4.8;
  c.stroke();

  c.globalAlpha = 0.56 * alpha;
  c.strokeStyle = theme.goldDeep;
  c.lineWidth = 2.2;
  c.stroke();

  c.globalAlpha = 0.86 * alpha;
  c.strokeStyle = theme.goldBright;
  c.lineWidth = 0.82;
  c.setLineDash([3, 8]);
  c.lineDashOffset = -time * 0.006 - index * 4;
  c.stroke();

  c.restore();
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim();
  if (!normalized.startsWith('#')) return null;

  const hex = normalized.slice(1);
  if (hex.length === 3) {
    const [r, g, b] = hex.split('').map((part) => Number.parseInt(part + part, 16));
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b };
  }

  if (hex.length !== 6) return null;
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) return null;

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
