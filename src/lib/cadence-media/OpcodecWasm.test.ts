// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { cadenceVisFrameSize, isCadenceVisKeyframe, normalizeModule, type RawEmModule } from './OpcodecWasm';

// These tests cover the cwrap→ccall normalization that fixes the
// "Codec unavailable" failures: the shipped opcodec Emscripten build exports
// `cwrap` but NOT `ccall`, yet the rest of OpcodecWasm.ts calls `m.ccall(...)`.

const heaps = () => ({
  HEAPU8:  new Uint8Array(8),
  HEAP16:  new Int16Array(8),
  HEAPF32: new Float32Array(8),
});

describe('normalizeModule', () => {
  it('returns the module unchanged when ccall already exists', () => {
    const ccall = vi.fn(() => 42);
    const raw: RawEmModule = { ...heaps(), ccall };
    const m = normalizeModule(raw);
    expect(m).toBe(raw);
    expect(m.ccall('foo', 'number', [], [])).toBe(42);
    expect(ccall).toHaveBeenCalledTimes(1);
  });

  it('synthesizes ccall from cwrap when ccall is missing', () => {
    const wrapped = vi.fn((a: number, b: number) => a + b);
    const cwrap = vi.fn(() => wrapped as unknown as (...args: unknown[]) => unknown);
    const raw: RawEmModule = { ...heaps(), cwrap };

    const m = normalizeModule(raw);
    expect(typeof m.ccall).toBe('function');

    const result = m.ccall('opvox_wasm_enc_create', 'number', ['number', 'number'], [48000, 2]);
    expect(result).toBe(48002);
    expect(cwrap).toHaveBeenCalledWith('opvox_wasm_enc_create', 'number', ['number', 'number']);
    expect(wrapped).toHaveBeenCalledWith(48000, 2);
  });

  it('memoizes wrapped functions per name+signature', () => {
    const cwrap = vi.fn(() => ((x: number) => x * 2) as unknown as (...args: unknown[]) => unknown);
    const m = normalizeModule({ ...heaps(), cwrap });

    m.ccall('opcodec_alloc_u8', 'number', ['number'], [10]);
    m.ccall('opcodec_alloc_u8', 'number', ['number'], [20]);
    // Same name+signature → cwrap invoked once, reused on the second call.
    expect(cwrap).toHaveBeenCalledTimes(1);

    // Different return/arg signature → a distinct wrapper is created.
    m.ccall('opcodec_alloc_u8', null, ['number', 'number'], [1, 2]);
    expect(cwrap).toHaveBeenCalledTimes(2);
  });

  it('passes null return types and void args through to cwrap', () => {
    const wrapped = vi.fn(() => undefined);
    const cwrap = vi.fn(() => wrapped as unknown as (...args: unknown[]) => unknown);
    const m = normalizeModule({ ...heaps(), cwrap });

    const r = m.ccall('opcodec_free', null, ['number'], [123]);
    expect(r).toBeUndefined();
    expect(cwrap).toHaveBeenCalledWith('opcodec_free', null, ['number']);
    expect(wrapped).toHaveBeenCalledWith(123);
  });

  it('throws when the module exposes neither ccall nor cwrap', () => {
    expect(() => normalizeModule(heaps() as RawEmModule)).toThrow(/neither ccall nor cwrap/);
  });
});

// Header bytes captured from the shipped opcodec_wasm.wasm (64x64, q45):
// `01 00 2d 00 40 00 40 00` for a forced intra frame, `01 01` / `01 02` for
// predicted frames. The old 0xFF test flagged every frame as a delta, so no
// receiver ever started a decoder.
describe('isCadenceVisKeyframe', () => {
  it('recognises the current intra header', () => {
    expect(isCadenceVisKeyframe(new Uint8Array([0x01, 0x00, 0x2d, 0x00, 0x40, 0x00, 0x40, 0x00]))).toBe(true);
  });
  it('treats predicted frames as deltas', () => {
    expect(isCadenceVisKeyframe(new Uint8Array([0x01, 0x01, 0x2d, 0x00, 0x40]))).toBe(false);
    expect(isCadenceVisKeyframe(new Uint8Array([0x01, 0x02, 0x2d]))).toBe(false);
  });
  it('keeps the legacy 0xFF marker and rejects empty input', () => {
    expect(isCadenceVisKeyframe(new Uint8Array([0xff, 0x10]))).toBe(true);
    expect(isCadenceVisKeyframe(new Uint8Array([]))).toBe(false);
    expect(isCadenceVisKeyframe(new Uint8Array([0x01]))).toBe(false);
  });
});

// `01 00 2d 01 40 00 b0 00` = 320x176 (u16 big-endian), from the shipped codec.
describe('cadenceVisFrameSize', () => {
  it('reads big-endian width/height from the header', () => {
    expect(cadenceVisFrameSize(new Uint8Array([0x01, 0x00, 0x2d, 0x01, 0x40, 0x00, 0xb0, 0x00]))).toEqual({ width: 320, height: 176 });
    expect(cadenceVisFrameSize(new Uint8Array([0x01, 0x01, 0x2d, 0x05, 0x00, 0x02, 0xd0]))).toEqual({ width: 1280, height: 720 });
  });
  it('rejects legacy, short, and implausible headers', () => {
    expect(cadenceVisFrameSize(new Uint8Array([0xff, 0x00, 0x2d, 0x01, 0x40, 0x00, 0xb0]))).toBeNull();
    expect(cadenceVisFrameSize(new Uint8Array([0x01, 0x00, 0x2d, 0x01]))).toBeNull();
    expect(cadenceVisFrameSize(new Uint8Array([0x01, 0x00, 0x2d, 0x00, 0x08, 0x00, 0x08]))).toBeNull();
  });
});
