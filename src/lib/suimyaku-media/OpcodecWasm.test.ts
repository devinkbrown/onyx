import { describe, expect, it, vi } from 'vitest';

import { normalizeModule, type RawEmModule } from './OpcodecWasm';

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
