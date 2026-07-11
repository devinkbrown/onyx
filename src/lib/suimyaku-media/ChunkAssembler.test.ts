// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChunkAssembler } from './ChunkAssembler';

type ChunkAssemblerInternals = {
  slots: Map<string, { stream: string }>;
  streamCounts: Map<string, number>;
  pendingBytes: number;
};

type ChunkAssemblerStatics = Record<string, number>;

function u8(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function patchAssemblerStatics(overrides: Partial<ChunkAssemblerStatics>): () => void {
  const statics = ChunkAssembler as unknown as ChunkAssemblerStatics;
  const previous: Partial<ChunkAssemblerStatics> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = statics[key];
    statics[key] = value!;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      statics[key] = value!;
    }
  };
}

function pendingSlots(assembler: ChunkAssembler): number {
  return (assembler as unknown as ChunkAssemblerInternals).slots.size;
}

function pendingBytes(assembler: ChunkAssembler): number {
  return (assembler as unknown as ChunkAssemblerInternals).pendingBytes;
}

function streamCount(assembler: ChunkAssembler, stream: string): number {
  return (assembler as unknown as ChunkAssemblerInternals).streamCounts.get(stream) ?? 0;
}

describe('ChunkAssembler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reassembles chunks received out of order', () => {
    const assembler = new ChunkAssembler();

    expect(assembler.ingest('Mika', 'AUDIO', 7, 2, 3, u8([3, 4]))).toBeNull();
    expect(assembler.ingest('Mika', 'AUDIO', 7, 1, 3, u8([1, 2]))).toBeNull();

    const frame = assembler.ingest('Mika', 'AUDIO', 7, 3, 3, u8([5]));

    expect(Array.from(frame ?? [])).toEqual([1, 2, 3, 4, 5]);
    expect(pendingSlots(assembler)).toBe(0);
    expect(pendingBytes(assembler)).toBe(0);
  });

  it('ignores duplicate chunks without counting them as received', () => {
    const assembler = new ChunkAssembler();

    expect(assembler.ingest('Mika', 'AUDIO', 8, 1, 2, u8([1]))).toBeNull();
    expect(assembler.ingest('Mika', 'AUDIO', 8, 1, 2, u8([9]))).toBeNull();

    const frame = assembler.ingest('Mika', 'AUDIO', 8, 2, 2, u8([2]));

    expect(Array.from(frame ?? [])).toEqual([1, 2]);
  });

  it('does not complete an assembly from a chunk that arrives after timeout', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const assembler = new ChunkAssembler();
    expect(assembler.ingest('Mika', 'AUDIO', 9, 1, 2, u8([1]))).toBeNull();

    vi.setSystemTime(8_001);
    expect(assembler.ingest('Mika', 'AUDIO', 9, 2, 2, u8([2]))).toBeNull();
  });

  it('keeps frame types isolated even when peers reuse frame ids', () => {
    const assembler = new ChunkAssembler();

    expect(assembler.ingest('Mika', 'AUDIO', 10, 1, 2, u8([1]))).toBeNull();
    expect(assembler.ingest('Mika', 'FRAME', 10, 2, 2, u8([9]))).toBeNull();

    const audioFrame = assembler.ingest('Mika', 'AUDIO', 10, 2, 2, u8([2]));
    const videoFrame = assembler.ingest('Mika', 'FRAME', 10, 1, 2, u8([8]));

    expect(Array.from(audioFrame ?? [])).toEqual([1, 2]);
    expect(Array.from(videoFrame ?? [])).toEqual([8, 9]);
  });

  it('drops over-large assemblies and releases pending byte accounting', () => {
    const restore = patchAssemblerStatics({
      MAX_FRAME_BYTES: 5,
      MAX_PENDING_BYTES: 10,
    });

    try {
      const assembler = new ChunkAssembler();
      expect(assembler.ingest('Mika', 'KEYFRAME', 11, 1, 2, u8([1, 2, 3]))).toBeNull();
      expect(pendingBytes(assembler)).toBe(3);

      expect(assembler.ingest('Mika', 'KEYFRAME', 11, 2, 2, u8([4, 5, 6]))).toBeNull();

      expect(pendingSlots(assembler)).toBe(0);
      expect(pendingBytes(assembler)).toBe(0);
    } finally {
      restore();
    }
  });

  it('reassembles chunks that arrive strictly in order', () => {
    const assembler = new ChunkAssembler();

    expect(assembler.ingest('Mika', 'AUDIO', 20, 1, 3, u8([1]))).toBeNull();
    expect(assembler.ingest('Mika', 'AUDIO', 20, 2, 3, u8([2]))).toBeNull();

    const frame = assembler.ingest('Mika', 'AUDIO', 20, 3, 3, u8([3]));

    expect(Array.from(frame ?? [])).toEqual([1, 2, 3]);
    expect(pendingSlots(assembler)).toBe(0);
  });

  it('resyncs past an unrecoverable gap: a stranded frame is dropped once newer frames pile up', () => {
    const restore = patchAssemblerStatics({ MAX_INFLIGHT_PER_STREAM: 3 });
    const stream = 'mika\0FRAME';

    try {
      const assembler = new ChunkAssembler();

      // Frame 30 is missing its 2nd chunk (an unrecoverable gap): it never completes.
      expect(assembler.ingest('Mika', 'FRAME', 30, 1, 2, u8([1]))).toBeNull();
      expect(streamCount(assembler, stream)).toBe(1);

      // Newer frames start arriving for the same stream. Once the in-flight cap
      // is exceeded, the stalest incomplete frame (30) is evicted — resync.
      expect(assembler.ingest('Mika', 'FRAME', 31, 1, 2, u8([1]))).toBeNull();
      expect(assembler.ingest('Mika', 'FRAME', 32, 1, 2, u8([1]))).toBeNull();
      expect(assembler.ingest('Mika', 'FRAME', 33, 1, 2, u8([1]))).toBeNull();

      // Never more than the per-stream cap of live incomplete frames.
      expect(streamCount(assembler, stream)).toBe(3);
      expect(pendingSlots(assembler)).toBe(3);

      // Frame 30's slot is gone; a late straggler for it cannot complete it,
      // and completing a *live* frame (33) still works normally.
      expect(assembler.ingest('Mika', 'FRAME', 30, 2, 2, u8([2]))).toBeNull();
      const frame = assembler.ingest('Mika', 'FRAME', 33, 2, 2, u8([2]));
      expect(Array.from(frame ?? [])).toEqual([1, 2]);
    } finally {
      restore();
    }
  });

  it('does not evict a live frame from another stream during resync', () => {
    const restore = patchAssemblerStatics({ MAX_INFLIGHT_PER_STREAM: 2 });

    try {
      const assembler = new ChunkAssembler();

      // A single in-flight AUDIO frame from another logical stream.
      expect(assembler.ingest('Mika', 'AUDIO', 40, 1, 2, u8([7]))).toBeNull();

      // Flood the FRAME stream past its cap; AUDIO must be untouched.
      for (let fid = 50; fid < 56; fid++) {
        expect(assembler.ingest('Mika', 'FRAME', fid, 1, 2, u8([fid]))).toBeNull();
      }

      expect(streamCount(assembler, 'mika\0FRAME')).toBe(2);
      expect(streamCount(assembler, 'mika\0AUDIO')).toBe(1);

      const frame = assembler.ingest('Mika', 'AUDIO', 40, 2, 2, u8([8]));
      expect(Array.from(frame ?? [])).toEqual([7, 8]);
    } finally {
      restore();
    }
  });

  it('bounds live slots under a per-stream flood of endless distinct frame ids', () => {
    const restore = patchAssemblerStatics({ MAX_INFLIGHT_PER_STREAM: 4 });

    try {
      const assembler = new ChunkAssembler();

      // Malicious peer opens 500 distinct never-completing frames on one stream.
      for (let fid = 0; fid < 500; fid++) {
        expect(assembler.ingest('Mallory', 'FRAME', fid, 1, 2, u8([1]))).toBeNull();
      }

      expect(streamCount(assembler, 'mallory\0FRAME')).toBe(4);
      expect(pendingSlots(assembler)).toBe(4);
    } finally {
      restore();
    }
  });

  it('evicts oldest incomplete assemblies when the active slot cap is reached', () => {
    const restore = patchAssemblerStatics({
      MAX_ACTIVE_SLOTS: 4,
      MAX_PENDING_PARTS: 64,
      MAX_PENDING_BYTES: 1024,
    });

    try {
      const assembler = new ChunkAssembler();

      for (let fid = 0; fid < 10; fid++) {
        expect(assembler.ingest('Mika', 'AUDIO', fid, 1, 2, u8([fid]))).toBeNull();
      }

      expect(pendingSlots(assembler)).toBe(4);
    } finally {
      restore();
    }
  });
});
