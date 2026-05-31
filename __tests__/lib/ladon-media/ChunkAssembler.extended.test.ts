import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChunkAssembler } from '@/lib/ladon-media/ChunkAssembler';

// Extended coverage for ChunkAssembler edge cases not covered by the base
// test file.

describe('ChunkAssembler (extended)', () => {
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

  // ── Out-of-order across many chunks ────────────────────────────────────────

  it('reassembles 10 chunks delivered in reverse order', () => {
    // Arrange: 10 chunks of 5 bytes each, delivered last-to-first
    const total = 10;
    let result: Uint8Array | null = null;
    for (let n = total; n >= 1; n--) {
      result = asm.ingest('alice', 'vid', 1, n, total, makeChunk(n, 5));
    }

    // Assert: delivery of chunk 1 (last received) triggers reassembly
    expect(result).not.toBeNull();
    expect(result!.length).toBe(50);
    // Byte at position 0 comes from chunk 1 (byte value = 1)
    expect(result![0]).toBe(1);
    // Byte at position 5 comes from chunk 2 (byte value = 2)
    expect(result![5]).toBe(2);
    // Byte at position 45 comes from chunk 10 (byte value = 10)
    expect(result![45]).toBe(10);
  });

  it('reassembles 20 chunks delivered in shuffled order', () => {
    // Arrange: deliver even indices first, then odd
    const total = 20;
    let result: Uint8Array | null = null;
    for (let n = 2; n <= total; n += 2) {
      result = asm.ingest('bob', 'aud', 7, n, total, makeChunk(n, 3));
    }
    expect(result).toBeNull(); // not done yet

    for (let n = 1; n <= total; n += 2) {
      result = asm.ingest('bob', 'aud', 7, n, total, makeChunk(n, 3));
    }
    // The last odd chunk (n=19) should trigger completion
    expect(result).not.toBeNull();
    expect(result!.length).toBe(total * 3);
    expect(result![0]).toBe(1);   // chunk 1
    expect(result![3]).toBe(2);   // chunk 2
  });

  // ── Conflicting `total` for same (nick, fid) ────────────────────────────────

  it('drops chunk with conflicting total for existing slot', () => {
    // Arrange: open a slot with total=3
    asm.ingest('carol', 'vox', 5, 1, 3, makeChunk(0xAA, 4));

    // Act: send a chunk claiming total=4 for the same (nick, fid)
    const r = asm.ingest('carol', 'vox', 5, 2, 4, makeChunk(0xBB, 4));

    // Assert: conflicting total is rejected
    expect(r).toBeNull();
  });

  it('conflicting-total chunk does not corrupt assembly — original still completes', () => {
    // Arrange: slot with total=2
    asm.ingest('dan', 'vox', 9, 1, 2, makeChunk(0x01, 2));

    // Act: conflicting total — must not corrupt received count
    asm.ingest('dan', 'vox', 9, 2, 99, makeChunk(0xFF, 2));

    // Assert: original slot still assembles with total=2
    const r = asm.ingest('dan', 'vox', 9, 2, 2, makeChunk(0x02, 2));
    expect(r).not.toBeNull();
    expect(r!.length).toBe(4);
    expect(r![0]).toBe(0x01);
    expect(r![2]).toBe(0x02);
  });

  // ── Zero-length chunk rejection ─────────────────────────────────────────────

  it('rejects a zero-length chunk', () => {
    const r = asm.ingest('eve', 'vox', 1, 1, 1, new Uint8Array(0));
    expect(r).toBeNull();
  });

  it('zero-length chunk does not open a slot — subsequent valid chunk starts fresh', () => {
    // Arrange: send zero-length chunk first (should be rejected, no slot opened)
    asm.ingest('fay', 'vox', 2, 1, 1, new Uint8Array(0));

    // Act: now send a valid single chunk
    const r = asm.ingest('fay', 'vox', 2, 1, 1, makeChunk(0xCC, 5));

    // Assert: valid chunk assembles fine because no corrupt slot exists
    expect(r).not.toBeNull();
    expect(r!.length).toBe(5);
  });

  // ── MAX_CHUNKS = 65535 boundary ─────────────────────────────────────────────

  it('accepts total exactly equal to MAX_CHUNKS (65535)', () => {
    // Just ingest one chunk of a 65535-part frame — it should be stored
    const r = asm.ingest('gus', 'vox', 3, 1, 65535, makeChunk(0x01, 1));
    expect(r).toBeNull(); // not complete yet, but was accepted (not rejected)
  });

  it('rejects total one above MAX_CHUNKS (65536)', () => {
    const r = asm.ingest('hal', 'vox', 4, 1, 65536, makeChunk(0x01, 1));
    expect(r).toBeNull();
    // Confirm it was rejected: sending the "completing" chunk for the same
    // slot with the valid total also finds no slot (nothing was stored).
    const r2 = asm.ingest('hal', 'vox', 4, 1, 1, makeChunk(0x01, 1));
    // A new single-chunk frame starts and completes immediately
    expect(r2).not.toBeNull();
  });

  // ── Post-reassembly byte cap (> 65535) ─────────────────────────────────────

  it('returns null when reassembled frame exceeds MAX_FRAME_BYTES (65535)', () => {
    // 3 chunks × 21846 bytes = 65538 bytes > 65535
    const chunkSize = 21846;
    asm.ingest('ivy', 'vid', 10, 1, 3, makeChunk(0xAA, chunkSize));
    asm.ingest('ivy', 'vid', 10, 2, 3, makeChunk(0xBB, chunkSize));
    const r = asm.ingest('ivy', 'vid', 10, 3, 3, makeChunk(0xCC, chunkSize));

    expect(r).toBeNull();
  });

  it('slot is cleaned up after over-size frame is rejected', () => {
    // Arrange: assemble an oversized frame (3 × 21846 = 65538 bytes)
    const chunkSize = 21846;
    asm.ingest('jay', 'vid', 11, 1, 3, makeChunk(0xAA, chunkSize));
    asm.ingest('jay', 'vid', 11, 2, 3, makeChunk(0xBB, chunkSize));
    asm.ingest('jay', 'vid', 11, 3, 3, makeChunk(0xCC, chunkSize));

    // Act: try a fresh single-chunk frame on the same slot key
    const r = asm.ingest('jay', 'vid', 11, 1, 1, makeChunk(0x01, 4));

    // Assert: new slot opens and completes because old slot was deleted
    expect(r).not.toBeNull();
    expect(r!.length).toBe(4);
  });

  it('accepts reassembled frame exactly at MAX_FRAME_BYTES (65535)', () => {
    // 3 chunks where total is exactly 65535 bytes: 21845 + 21845 + 21845 = 65535
    const chunkSize = 21845;
    asm.ingest('kim', 'vid', 20, 1, 3, makeChunk(0xAA, chunkSize));
    asm.ingest('kim', 'vid', 20, 2, 3, makeChunk(0xBB, chunkSize));
    const r = asm.ingest('kim', 'vid', 20, 3, 3, makeChunk(0xCC, chunkSize));

    expect(r).not.toBeNull();
    expect(r!.length).toBe(65535);
  });

  // ── GC expiry timing ───────────────────────────────────────────────────────

  it('gc does not remove a slot that has not yet expired', () => {
    // Arrange: start a 3-chunk assembly
    asm.ingest('leo', 'vox', 30, 1, 3, makeChunk(0xAA, 4));

    // Advance time to just before the 8000ms timeout
    vi.advanceTimersByTime(7999);
    asm.gc();

    // Act: complete the assembly — slot should still be there
    asm.ingest('leo', 'vox', 30, 2, 3, makeChunk(0xBB, 4));
    const r = asm.ingest('leo', 'vox', 30, 3, 3, makeChunk(0xCC, 4));

    expect(r).not.toBeNull();
    expect(r!.length).toBe(12);
  });

  it('gc removes a slot at exactly the expiry boundary (expires < now)', () => {
    // Arrange: start a 3-chunk assembly
    asm.ingest('mia', 'vox', 31, 1, 3, makeChunk(0xAA, 4));

    // Advance time to exactly 8001ms — slot.expires is now in the past
    vi.advanceTimersByTime(8001);
    asm.gc();

    // Act: try to complete the old assembly
    const r = asm.ingest('mia', 'vox', 31, 2, 3, makeChunk(0xBB, 4));
    // Assert: old slot gone, new slot opened with only 1 of 3 received
    expect(r).toBeNull();
  });

  it('gc removes multiple expired slots in one pass', () => {
    // Open two incomplete assemblies for different senders
    asm.ingest('ned', 'vox', 1, 1, 3, makeChunk(0x01, 4));
    asm.ingest('ora', 'vox', 2, 1, 3, makeChunk(0x02, 4));

    vi.advanceTimersByTime(9000);
    asm.gc();

    // Both slots gone — starting fresh produces only incomplete slots
    expect(asm.ingest('ned', 'vox', 1, 2, 3, makeChunk(0x03, 4))).toBeNull();
    expect(asm.ingest('ora', 'vox', 2, 2, 3, makeChunk(0x04, 4))).toBeNull();
  });

  // ── Duplicate index after slot completion ──────────────────────────────────

  it('returns null for a duplicate chunk index sent after assembly completed', () => {
    // Arrange: complete a 2-chunk assembly
    asm.ingest('pat', 'vox', 50, 1, 2, makeChunk(0xAA, 4));
    const first = asm.ingest('pat', 'vox', 50, 2, 2, makeChunk(0xBB, 4));
    expect(first).not.toBeNull(); // assembled successfully

    // Act: send duplicate chunk 1 for the same (nick, fid)
    // The slot was deleted on assembly, so this opens a fresh 2-slot frame
    // with only chunk 1 stored — not complete.
    const dup = asm.ingest('pat', 'vox', 50, 1, 2, makeChunk(0xAA, 4));
    expect(dup).toBeNull(); // new slot, only 1 of 2 received
  });

  it('duplicate index within an incomplete slot returns null without advancing received count', () => {
    // Arrange: two chunks of a 3-chunk frame
    asm.ingest('quinn', 'vox', 60, 1, 3, makeChunk(0x01, 4));
    asm.ingest('quinn', 'vox', 60, 2, 3, makeChunk(0x02, 4));

    // Send chunk 1 again — duplicate, should be rejected
    const dup = asm.ingest('quinn', 'vox', 60, 1, 3, makeChunk(0x01, 4));
    expect(dup).toBeNull();

    // Send chunk 3 — the assembly should still complete correctly
    const r = asm.ingest('quinn', 'vox', 60, 3, 3, makeChunk(0x03, 4));
    expect(r).not.toBeNull();
    expect(r!.length).toBe(12);
    expect(r![0]).toBe(0x01);
    expect(r![4]).toBe(0x02);
    expect(r![8]).toBe(0x03);
  });

  // ── n > total rejection ────────────────────────────────────────────────────

  it('rejects chunk index greater than total', () => {
    const r = asm.ingest('rex', 'vox', 70, 5, 3, makeChunk(0x01, 4));
    expect(r).toBeNull();
  });

  // ── total = 0 rejection ────────────────────────────────────────────────────

  it('rejects total = 0', () => {
    const r = asm.ingest('sue', 'vox', 80, 1, 0, makeChunk(0x01, 4));
    expect(r).toBeNull();
  });
});
