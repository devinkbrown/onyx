import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChunkAssembler } from './ChunkAssembler';

type ChunkAssemblerInternals = {
  slots: Map<string, unknown>;
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
