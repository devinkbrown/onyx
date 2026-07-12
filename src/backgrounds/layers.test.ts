// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundFrameContext } from './engine';
import { hexToHsl } from './reactivity';
import {
  applyWashiGrain,
  capLuminance,
  composeSignature,
  GROUND_MAX_L,
  groundLayer,
  WASHI_GRAIN_COUNT_BASE,
  washiGrainCount,
} from './variants/layers';
import type { BackgroundTheme } from './variants/utils';

const THEME: BackgroundTheme = {
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
  washi: '#ece4cf',
  washiDim: '#ada590',
  washiMute: '#6d6f86',
};

describe('capLuminance', () => {
  it('pulls a light colour down to the ground lightness ceiling', () => {
    // A bright, light colour (a light-theme "ground" token) must be clamped so
    // it can never wash the background out and swallow foreground text.
    const capped = capLuminance('#ffffff');
    const hsl = hexToHsl(capped);
    expect(hsl).not.toBeNull();
    // Small epsilon for the hex round-trip.
    expect(hsl!.l).toBeLessThanOrEqual(GROUND_MAX_L + 0.01);
  });

  it('leaves an already-dark colour untouched', () => {
    // Dark themes already sit below the cap — the clamp must be a no-op.
    expect(capLuminance('#07090f')).toBe('#07090f');
  });

  it('preserves hue while clamping lightness', () => {
    const hue = hexToHsl('#3f7bff')!.h;
    const capped = hexToHsl(capLuminance('#bcd4ff', 0.2))!;
    expect(capped.l).toBeLessThanOrEqual(0.21);
    expect(Math.abs(capped.h - hue)).toBeLessThan(4);
  });

  it('passes an unparseable colour through unchanged (fail-safe)', () => {
    expect(capLuminance('not-a-color')).toBe('not-a-color');
  });
});

describe('washiGrainCount', () => {
  it('is a fixed base density at full quality', () => {
    expect(washiGrainCount(1)).toBe(WASHI_GRAIN_COUNT_BASE);
  });

  it('scales only by the quality ladder', () => {
    expect(washiGrainCount(0.52)).toBe(Math.floor(WASHI_GRAIN_COUNT_BASE * 0.52));
    expect(washiGrainCount(0.76)).toBe(Math.floor(WASHI_GRAIN_COUNT_BASE * 0.76));
  });

  it('never returns a negative count', () => {
    expect(washiGrainCount(0)).toBe(0);
    expect(washiGrainCount(-1)).toBe(0);
  });
});

describe('applyWashiGrain', () => {
  it('draws exactly the fixed-density fleck count (one fillRect per fleck)', () => {
    const ctx = createFrameContext();
    applyWashiGrain(ctx, THEME);
    const fillRect = ctx.context.fillRect as unknown as ReturnType<typeof vi.fn>;
    expect(fillRect).toHaveBeenCalledTimes(washiGrainCount(ctx.qualityScale));
  });
});

describe('composeSignature', () => {
  it('clears, then invokes the ink layer exactly once', () => {
    const ctx = createFrameContext();
    const ink = vi.fn();
    composeSignature(ctx, 1234, ink);
    expect(ctx.context.clearRect).toHaveBeenCalled();
    expect(ink).toHaveBeenCalledTimes(1);
  });

  it('runs the whole stack without throwing at a low quality scale', () => {
    const ctx = { ...createFrameContext(), quality: 'low' as const, qualityScale: 0.52 };
    expect(() => {
      groundLayer(ctx, THEME, 0);
      composeSignature(ctx, 0, () => {});
    }).not.toThrow();
  });
});

function createFrameContext(): BackgroundFrameContext {
  return {
    canvas: document.createElement('canvas'),
    context: create2dContext(),
    width: 640,
    height: 360,
    dpr: 1,
    quality: 'high',
    qualityScale: 1,
  };
}

function create2dContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    fillStyle: '#000000',
    strokeStyle: '#ffffff',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D;
}
