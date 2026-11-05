// SPDX-License-Identifier: AGPL-3.0-or-later
export type MediaCounterName = 'audioUnderruns' | 'queuedAudioFrames' | 'lateAudioFrames' | 'droppedAudioFrames' | 'droppedVideoFrames' | 'encodedAudioFrames' | 'decodedAudioFrames' | 'encodedVideoFrames' | 'decodedVideoFrames';
export interface MediaTelemetrySnapshot { readonly sampledAtMonotonicMs: number; readonly counters: Readonly<Record<MediaCounterName, number | null>>; readonly availability: 'observed' | 'partial' | 'unavailable'; readonly reason: 'counter-source-unavailable' | 'counter-read-failed' | null }
export function createMediaTelemetry(source: () => Partial<Record<MediaCounterName, number | null>> | null, now: () => number = () => performance.now()) {
  let disposed = false;
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  let cached: MediaTelemetrySnapshot | null = null;
  const emptyCounters = (): Record<MediaCounterName, number | null> => ({ audioUnderruns: null, queuedAudioFrames: null, lateAudioFrames: null,
    droppedAudioFrames: null, droppedVideoFrames: null, encodedAudioFrames: null, decodedAudioFrames: null, encodedVideoFrames: null, decodedVideoFrames: null });
  const sample = (): MediaTelemetrySnapshot => {
    const at = now();
    if (disposed) return { sampledAtMonotonicMs: at, counters: emptyCounters(), availability: 'unavailable', reason: 'counter-source-unavailable' };
    try {
      const input = source();
      if (!input) return { sampledAtMonotonicMs: at, counters: emptyCounters(), availability: 'unavailable', reason: 'counter-source-unavailable' };
      const names: MediaCounterName[] = ['audioUnderruns', 'queuedAudioFrames', 'lateAudioFrames', 'droppedAudioFrames', 'droppedVideoFrames', 'encodedAudioFrames', 'decodedAudioFrames', 'encodedVideoFrames', 'decodedVideoFrames'];
      const counters = Object.fromEntries(names.map(name => [name, Number.isFinite(input[name]) && input[name]! >= 0 ? Math.floor(input[name]!) : null])) as unknown as Record<MediaCounterName, number | null>;
      const observed = names.filter(name => counters[name] !== null).length;
      const availability = observed === names.length ? 'observed' : observed > 0 ? 'partial' : 'unavailable';
      return { sampledAtMonotonicMs: at, counters, availability, reason: availability === 'observed' ? null : 'counter-read-failed' };
    } catch {
      return { sampledAtMonotonicMs: at, counters: emptyCounters(), availability: 'unavailable', reason: 'counter-read-failed' };
    }
  };
  return {
    snapshot(): MediaTelemetrySnapshot {
      const at = now();
      if (cached && at - lastSampleAt < 1000) return cached;
      cached = sample(); lastSampleAt = at;
      return cached;
    },
    reset() { cached = null; lastSampleAt = Number.NEGATIVE_INFINITY; },
    dispose() { disposed = true; cached = null; },
  };
}
