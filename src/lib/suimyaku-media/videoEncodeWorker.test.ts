import { describe, expect, it, vi } from 'vitest';

import { buildEncoder, tierDimensions } from './videoEncodeWorker';
import type { OpcodecWasm, KaguraVisEncoder } from './OpcodecWasm';

// Covers the encoder fallback ladder added so worker video encoding keeps
// working even when the kaguravis WASM codec rejects the requested resolution
// (it returns a null handle for some sizes, e.g. 1920x1080, making
// KaguraVisEncoder throw "kaguravis encoder init failed").

/** Build a fake OpcodecWasm whose videoEncoder() only accepts the given sizes. */
function fakeWasm(accepted: ReadonlyArray<[number, number]>) {
  const ok = new Set(accepted.map(([w, h]) => `${w}x${h}`));
  const videoEncoder = vi.fn((width: number, height: number) => {
    if (!ok.has(`${width}x${height}`)) {
      throw new Error('kaguravis encoder init failed');
    }
    return { width, height, destroy: vi.fn() } as unknown as KaguraVisEncoder;
  });
  return { wasm: { videoEncoder } as unknown as OpcodecWasm, videoEncoder };
}

describe('tierDimensions', () => {
  it('uses the full profile resolution at tier 0', () => {
    expect(tierDimensions(0, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('caps width and keeps even dimensions at lower tiers', () => {
    expect(tierDimensions(2, 1920, 1080)).toEqual({ width: 1280, height: 720 });
    const t3 = tierDimensions(3, 1920, 1080);
    expect(t3.width % 2).toBe(0);
    expect(t3.height % 2).toBe(0);
  });
});

describe('buildEncoder fallback ladder', () => {
  it('uses the requested size directly when the codec accepts it', () => {
    const { wasm, videoEncoder } = fakeWasm([[1280, 720]]);
    const enc = buildEncoder(wasm, 2, 1920, 1080, 70, 'camera', 60);
    expect(enc.width).toBe(1280);
    expect(enc.height).toBe(720);
    expect(videoEncoder).toHaveBeenCalledTimes(1);
  });

  it('falls back to a known-good size when the requested one is rejected', () => {
    // Tier 0 asks for 1920x1080 (rejected); the ladder steps down to 1280x720.
    const { wasm } = fakeWasm([[1280, 720]]);
    const enc = buildEncoder(wasm, 0, 1920, 1080, 70, 'camera', 60);
    expect(enc.width).toBe(1280);
    expect(enc.height).toBe(720);
  });

  it('walks further down the ladder when larger sizes are also rejected', () => {
    const { wasm } = fakeWasm([[640, 360]]);
    const enc = buildEncoder(wasm, 0, 1920, 1080, 70, 'camera', 60);
    expect(enc.width).toBe(640);
    expect(enc.height).toBe(360);
  });

  it('never upscales past the requested width', () => {
    // Requested 640x480 is rejected; only 320x240 is accepted. Ladder entries
    // wider than the request (1280, 1024) must be skipped.
    const { wasm, videoEncoder } = fakeWasm([[320, 240]]);
    const enc = buildEncoder(wasm, 3, 640, 480, 70, 'camera', 60);
    expect(enc.width).toBe(320);
    expect(enc.height).toBe(240);
    const triedWide = videoEncoder.mock.calls.some(([w]) => (w as number) > 640);
    expect(triedWide).toBe(false);
  });

  it('propagates the error when no size is accepted', () => {
    const { wasm } = fakeWasm([]);
    expect(() => buildEncoder(wasm, 0, 1920, 1080, 70, 'camera', 60)).toThrow(/kaguravis encoder init failed/);
  });
});
