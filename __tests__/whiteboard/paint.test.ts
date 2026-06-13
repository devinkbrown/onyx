import { describe, test, expect } from 'vitest';
import {
  clampZoom, MIN_ZOOM, MAX_ZOOM,
  screenToWorld, worldToScreen, decimate, nickColor,
  IDENTITY_VIEW, type View,
} from '@/components/whiteboard/paint';

describe('clampZoom', () => {
  test('clamps below the minimum zoom', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
  });

  test('clamps above the maximum zoom', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });

  test('passes through an in-range zoom unchanged', () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe('screen/world coordinate transforms', () => {
  test('round-trips a point through the identity view', () => {
    const cssW = 800;
    const cssH = 600;
    const [wx, wy] = screenToWorld(400, 300, cssW, cssH, IDENTITY_VIEW);
    const [sx, sy] = worldToScreen(wx, wy, cssW, cssH, IDENTITY_VIEW);
    expect(sx).toBeCloseTo(400, 5);
    expect(sy).toBeCloseTo(300, 5);
  });

  test('round-trips under pan and zoom', () => {
    const cssW = 1024;
    const cssH = 768;
    const view: View = { scale: 2, tx: 120, ty: -45 };
    const [wx, wy] = screenToWorld(512, 384, cssW, cssH, view);
    const [sx, sy] = worldToScreen(wx, wy, cssW, cssH, view);
    expect(sx).toBeCloseTo(512, 5);
    expect(sy).toBeCloseTo(384, 5);
  });

  test('maps the canvas center to normalised 0.5,0.5 at identity', () => {
    const [wx, wy] = screenToWorld(400, 300, 800, 600, IDENTITY_VIEW);
    expect(wx).toBeCloseTo(0.5, 5);
    expect(wy).toBeCloseTo(0.5, 5);
  });
});

describe('decimate', () => {
  test('returns short trails untouched', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 1]];
    expect(decimate(pts)).toEqual(pts);
  });

  test('drops samples closer than epsilon but keeps endpoints', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [0.2, 0], [0.4, 0], [10, 0],
    ];
    const out = decimate(pts, 1.5);
    // First and last always survive.
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
    // The near-zero interior samples collapse.
    expect(out.length).toBeLessThan(pts.length);
  });

  test('keeps spaced-out samples', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [5, 0], [10, 0], [15, 0],
    ];
    expect(decimate(pts, 1.5).length).toBe(4);
  });
});

describe('nickColor', () => {
  test('is deterministic for a given nick', () => {
    expect(nickColor('alice')).toBe(nickColor('alice'));
  });

  test('differs between distinct nicks', () => {
    expect(nickColor('alice')).not.toBe(nickColor('bob'));
  });

  test('produces a valid hsl color string', () => {
    expect(nickColor('carol')).toMatch(/^hsl\(\d+, 70%, 65%\)$/);
  });
});
