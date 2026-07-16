// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundFrameContext, BackgroundVariant } from './engine';
import { hexToHsl } from './reactivity';
import {
  applyWashiGrain,
  capLuminance,
  composeSignature,
  GROUND_MAX_L,
  groundLayer,
  kintsugiAccent,
  WASHI_GRAIN_COUNT_BASE,
  washiGrainCount,
} from './variants/layers';
import { readBackgroundTheme, type BackgroundTheme } from './variants/utils';
import { aurora } from './variants/aurora';
import { auroraRibbons } from './variants/aurora-ribbons';
import { bioluminescence } from './variants/bioluminescence';
import { caustics } from './variants/caustics';
import { ember } from './variants/ember';
import { forest } from './variants/forest';
import { kintsugiVeins } from './variants/kintsugi-veins';
import { deepCurrent } from './variants/deep-current';
import { mist } from './variants/mist';
import { pyriteField } from './variants/pyrite-field';
import { resin } from './variants/resin';
import { sumiE } from './variants/sumi-e';
import { tideBands } from './variants/tide-bands';
import { washi } from './variants/washi';

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

  it('runs clear → ground → ink → grain → vignette → edge seal in that order', () => {
    // The pipeline contract: the ground is laid before the ink, the ink before
    // the grain/vignette/seal. groundLayer draws the first radial (top glow);
    // applyVignette draws the second radial, and the edge seal draws the third.
    // So the ink must fall between the ground glow and the two finishing layers.
    const ctx = createFrameContext();
    const ink = vi.fn();
    composeSignature(ctx, 1234, ink);

    const context = ctx.context as unknown as {
      clearRect: ReturnType<typeof vi.fn>;
      createRadialGradient: ReturnType<typeof vi.fn>;
    };
    const clearOrder = context.clearRect.mock.invocationCallOrder[0]!;
    const inkOrder = ink.mock.invocationCallOrder[0]!;
    const radialOrders = context.createRadialGradient.mock.invocationCallOrder;
    const groundGlowOrder = radialOrders[0]!; // groundLayer's top glow
    const vignetteOrder = radialOrders[1]!; // applyVignette
    const sealOrder = radialOrders[2]!; // kintsugiAccent's edge glow

    expect(clearOrder).toBeLessThan(inkOrder);
    expect(groundGlowOrder).toBeLessThan(inkOrder);
    expect(inkOrder).toBeLessThan(vignetteOrder);
    expect(vignetteOrder).toBeLessThan(sealOrder);
  });
});

describe('kintsugiAccent', () => {
  it('keeps the vermilion signature at the edge without tracing a foreground path', () => {
    const ctx = createFrameContext();
    kintsugiAccent(ctx, THEME, 1234);

    const context = ctx.context as unknown as {
      createRadialGradient: ReturnType<typeof vi.fn>;
      quadraticCurveTo: ReturnType<typeof vi.fn>;
      stroke: ReturnType<typeof vi.fn>;
    };
    const radialCall = context.createRadialGradient.mock.calls[0];
    expect(radialCall).toBeDefined();
    const [x, y, innerRadius, outerX, outerY, outerRadius] = radialCall as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    expect(x).toBeGreaterThan(ctx.width * 0.9);
    expect(outerX).toBe(x);
    expect(outerY).toBe(y);
    expect(innerRadius).toBeGreaterThanOrEqual(0);
    expect(outerRadius).toBeGreaterThan(innerRadius);
    expect(context.quadraticCurveTo).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });
});

describe('signature presets route through the shared pipeline', () => {
  // Every preset routed onto composeSignature must delegate its ground to the
  // shared luminance-capped groundLayer instead of painting its own. groundLayer
  // is the FIRST linear gradient in the stack (ink layers only stroke or draw
  // radials/later gradients), so the first linear gradient a preset produces must
  // be exactly the capped ink2 → stone → ink ramp. This catches any bright
  // custom ground creeping back and proves the luminance cap holds by
  // construction for each preset.
  const routed: Array<{ id: string; variant: BackgroundVariant }> = [
    { id: 'kintsugi-veins', variant: kintsugiVeins },
    { id: 'deep-current', variant: deepCurrent },
    { id: 'sumi-e', variant: sumiE },
    { id: 'washi', variant: washi },
    { id: 'mist', variant: mist },
    { id: 'ember', variant: ember },
    { id: 'forest', variant: forest },
    { id: 'aurora', variant: aurora },
    { id: 'bioluminescence', variant: bioluminescence },
    { id: 'caustics', variant: caustics },
    { id: 'resin', variant: resin },
    { id: 'pyrite-field', variant: pyriteField },
    { id: 'aurora-ribbons', variant: auroraRibbons },
    { id: 'tide-bands', variant: tideBands },
  ];

  it.each(routed)('$id paints the shared luminance-capped ground', ({ variant }) => {
    const theme = readBackgroundTheme();
    const expectedGround = [
      capLuminance(theme.ink2),
      capLuminance(theme.stone),
      capLuminance(theme.ink),
    ];
    // Sanity: with the default dark theme every ground stop already sits at or
    // below the cap.
    for (const stop of expectedGround) {
      expect(hexToHsl(stop)!.l).toBeLessThanOrEqual(GROUND_MAX_L + 0.01);
    }

    const { ctx, linearStops } = createRecordingContext();
    variant.init(ctx);
    variant.frame(ctx, 4321);

    expect(linearStops.length).toBeGreaterThan(0);
    const groundStops = linearStops[0]!.map((s) => s.color);
    expect(groundStops).toEqual(expectedGround);
  });

  it.each(routed)('$id renders static (a single frozen frame) without throwing', ({ variant }) => {
    // staticMode / reduced motion renders one frame at an arbitrary timestamp —
    // it must be a legible still, never a throw or a blank.
    const { ctx } = createRecordingContext();
    expect(() => {
      variant.init(ctx);
      variant.frame(ctx, performance.now());
    }).not.toThrow();
  });

  it.each(routed)('$id honours the quality ladder without throwing at the low scale', ({ variant }) => {
    // The FPS guard steps quality down to `low` (qualityScale 0.52); every
    // element count in the ink layer must scale off it cleanly.
    const { ctx } = createRecordingContext();
    const lowCtx = { ...ctx, quality: 'low' as const, qualityScale: 0.52 };
    expect(() => {
      variant.init(lowCtx);
      variant.frame(lowCtx, 9999);
    }).not.toThrow();
  });
});

describe('drifting scenes thin their element counts by qualityScale', () => {
  // The FPS-guard contract: stepping quality down to `low` (0.52) must genuinely
  // reduce the drawn element count, not just detail — otherwise a starved `low`
  // loop keeps thrashing the guard. Each new scene's sole element loop (ribbons /
  // bands) must scale off qualityScale, so `low` paints strictly fewer.

  it('aurora-ribbons strokes strictly fewer ribbons at low quality', () => {
    const high = createRecordingContext();
    auroraRibbons.frame(high.ctx, 1000);
    const low = createRecordingContext();
    auroraRibbons.frame({ ...low.ctx, quality: 'low', qualityScale: 0.52 }, 1000);

    const highStrokes = (high.ctx.context.stroke as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const lowStrokes = (low.ctx.context.stroke as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(lowStrokes).toBeLessThan(highStrokes);
  });

  it('tide-bands draws strictly fewer bands at low quality', () => {
    // Each band paints two linear gradients (body + sheen); groundLayer paints
    // one. Fewer bands ⇒ fewer linear gradients recorded.
    const high = createRecordingContext();
    tideBands.frame(high.ctx, 1000);
    const low = createRecordingContext();
    tideBands.frame({ ...low.ctx, quality: 'low', qualityScale: 0.52 }, 1000);

    expect(low.linearStops.length).toBeLessThan(high.linearStops.length);
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

interface GradientStop {
  offset: number;
  color: string;
}

/**
 * A frame context whose gradients each record their own stops, so a test can
 * inspect exactly which colours a preset painted into (say) its first linear
 * gradient — impossible with the shared single-gradient mock above.
 */
function createRecordingContext(): {
  ctx: BackgroundFrameContext;
  linearStops: GradientStop[][];
} {
  const linearStops: GradientStop[][] = [];
  const makeGradient = (sink?: GradientStop[]): CanvasGradient =>
    ({
      addColorStop: (offset: number, color: string) => sink?.push({ offset, color }),
    }) as unknown as CanvasGradient;

  const context = {
    fillStyle: '#000000',
    strokeStyle: '#ffffff',
    shadowColor: 'transparent',
    shadowBlur: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDashOffset: 0,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => {
      const stops: GradientStop[] = [];
      linearStops.push(stops);
      return makeGradient(stops);
    }),
    createRadialGradient: vi.fn(() => makeGradient()),
  } as unknown as CanvasRenderingContext2D;

  const ctx: BackgroundFrameContext = {
    canvas: document.createElement('canvas'),
    context,
    width: 640,
    height: 360,
    dpr: 1,
    quality: 'high',
    qualityScale: 1,
  };
  return { ctx, linearStops };
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
