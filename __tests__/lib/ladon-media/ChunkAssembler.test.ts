import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChunkAssembler } from '@/lib/ladon-media/ChunkAssembler';

// ─────────────────────────────────────────────────────────────────────────────
// ChunkAssembler
// ─────────────────────────────────────────────────────────────────────────────

describe('ChunkAssembler', () => {
  let asm: ChunkAssembler;

  beforeEach(() => {
    vi.useFakeTimers();
    asm = new ChunkAssembler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeChunk(byte: number, len: number): Uint8Array {
    return new Uint8Array(len).fill(byte);
  }

  // ── Single chunk (total=1) ───────────────────────────────────────────────

  it('returns reassembled data immediately when total=1', () => {
    const chunk = makeChunk(0xAA, 10);
    const result = asm.ingest('alice', 'vox', 1, 1, 1, chunk);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(10);
    expect(result![0]).toBe(0xAA);
  });

  // ── Multi-chunk in order ─────────────────────────────────────────────────

  it('reassembles three chunks in order', () => {
    const a = makeChunk(0x01, 4);
    const b = makeChunk(0x02, 4);
    const c = makeChunk(0x03, 4);

    expect(asm.ingest('bob', 'vox', 42, 1, 3, a)).toBeNull();
    expect(asm.ingest('bob', 'vox', 42, 2, 3, b)).toBeNull();
    const result = asm.ingest('bob', 'vox', 42, 3, 3, c);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(12);
    // First 4 bytes are 0x01
    expect(result![0]).toBe(0x01);
    // Next 4 bytes are 0x02
    expect(result![4]).toBe(0x02);
    // Last 4 bytes are 0x03
    expect(result![8]).toBe(0x03);
  });

  // ── Multi-chunk out of order ─────────────────────────────────────────────

  it('reassembles chunks received out of order', () => {
    const a = makeChunk(0x11, 3);
    const b = makeChunk(0x22, 3);
    const c = makeChunk(0x33, 3);

    asm.ingest('carol', 'vox', 7, 3, 3, c);
    asm.ingest('carol', 'vox', 7, 1, 3, a);
    const result = asm.ingest('carol', 'vox', 7, 2, 3, b);

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0x11);
    expect(result![3]).toBe(0x22);
    expect(result![6]).toBe(0x33);
  });

  // ── Duplicate chunk is rejected ──────────────────────────────────────────

  it('rejects duplicate chunk index', () => {
    asm.ingest('dave', 'vox', 99, 1, 2, makeChunk(0x01, 5));
    const dup = asm.ingest('dave', 'vox', 99, 1, 2, makeChunk(0x01, 5));
    expect(dup).toBeNull();
  });

  // ── Different NIDs are independent ──────────────────────────────────────

  it('tracks separate assembly slots per (nick, fid)', () => {
    asm.ingest('alice', 'vox', 1, 1, 2, makeChunk(0xA0, 2));
    asm.ingest('bob',   'vox', 1, 1, 2, makeChunk(0xB0, 2));

    const r1 = asm.ingest('alice', 'vox', 1, 2, 2, makeChunk(0xA1, 2));
    const r2 = asm.ingest('bob',   'vox', 1, 2, 2, makeChunk(0xB1, 2));

    expect(r1).not.toBeNull();
    expect(r1![0]).toBe(0xA0);

    expect(r2).not.toBeNull();
    expect(r2![0]).toBe(0xB0);
  });

  // ── Safety limits ────────────────────────────────────────────────────────

  it('rejects chunk exceeding MAX_CHUNK_BYTES (65536)', () => {
    const huge = new Uint8Array(65537);
    const result = asm.ingest('eve', 'vox', 1, 1, 1, huge);
    expect(result).toBeNull();
  });

  it('rejects assembly with total > MAX_CHUNKS (65535)', () => {
    const result = asm.ingest('eve', 'vox', 2, 1, 65536, makeChunk(0x00, 10));
    expect(result).toBeNull();
  });

  it('accepts a many-chunk frame within the byte cap (real video keyframe)', () => {
    // 200 chunks × 120 bytes = 24000 bytes — a realistic keyframe size that
    // the old MAX_CHUNKS=32 cap would have silently dropped.
    const total = 200;
    let result: Uint8Array | null = null;
    for (let n = 1; n <= total; n++) {
      result = asm.ingest('vic', 'kf', 3, n, total, makeChunk(0x7F, 120));
    }
    expect(result).not.toBeNull();
    expect(result!.length).toBe(total * 120);
  });

  it('rejects out-of-range chunk index (n=0)', () => {
    const result = asm.ingest('frank', 'vox', 10, 0, 2, makeChunk(0x00, 4));
    expect(result).toBeNull();
  });

  // ── GC removes expired slots ─────────────────────────────────────────────

  it('gc removes expired incomplete assemblies', () => {
    // Start a 3-chunk assembly, only send 1
    asm.ingest('ghost', 'vox', 55, 1, 3, makeChunk(0xFF, 4));

    // Advance time past the 8000ms timeout
    vi.advanceTimersByTime(9000);
    asm.gc();

    // Now try to finish the assembly — result should come back since slot is gone
    // (it will create a new fresh slot with total=3, but only 2 of 3 received)
    const r = asm.ingest('ghost', 'vox', 55, 2, 3, makeChunk(0xFE, 4));
    expect(r).toBeNull(); // new slot, still not complete
  });
});
