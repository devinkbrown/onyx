import { describe, expect, it } from 'vitest';
import { createMediaTelemetry, type MediaCounterName } from './media-telemetry';

describe('media telemetry snapshot sampling', () => {
  it('retains measured counters independently and samples at most once per second', () => {
    let now = 10;
    let reads = 0;
    const telemetry = createMediaTelemetry(() => {
      reads++;
      return { audioUnderruns: 2, queuedAudioFrames: 5, encodedAudioFrames: 9 };
    }, () => now);
    const first = telemetry.snapshot();
    expect(first.availability).toBe('partial');
    expect(first.counters.audioUnderruns).toBe(2);
    expect(first.counters.queuedAudioFrames).toBe(5);
    expect(first.counters.encodedAudioFrames).toBe(9);
    const second = telemetry.snapshot();
    expect(second).toBe(first);
    expect(reads).toBe(1);
    now += 1000;
    expect(telemetry.snapshot()).not.toBe(first);
    expect(reads).toBe(2);
    telemetry.dispose();
  });

  it('reports absent and invalid counters as null without erasing independent values', () => {
    const telemetry = createMediaTelemetry(() => ({ audioUnderruns: 1, droppedVideoFrames: Number.NaN } as Partial<Record<MediaCounterName, number | null>>), () => 42);
    const snapshot = telemetry.snapshot();
    expect(snapshot.availability).toBe('partial');
    expect(snapshot.counters.audioUnderruns).toBe(1);
    expect(snapshot.counters.droppedVideoFrames).toBeNull();
    expect(snapshot.counters.decodedVideoFrames).toBeNull();
    telemetry.dispose();
  });
});
