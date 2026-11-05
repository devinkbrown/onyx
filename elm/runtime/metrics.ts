// SPDX-License-Identifier: AGPL-3.0-or-later
export type MetricName = 'inputP50' | 'inputP95' | 'ingestDuration' | 'maxLongTask' | 'heapUsed' | 'heapGrowth' | 'idbReadP95' | 'idbWriteP95' | 'audioUnderruns' | 'queuedAudioFrames' | 'droppedVideoFrames';
export type MetricUnit = 'ms' | 'bytes' | 'count' | 'percent';
export type MetricUnavailableReason = 'not-started' | 'api-unavailable' | 'no-samples' | 'not-instrumented' | 'sampling-failed';
export interface MetricValue { readonly name: MetricName; readonly value: number | null; readonly unit: MetricUnit; readonly sampleCount: number; readonly availability: 'observed' | 'unavailable'; readonly reason: MetricUnavailableReason | null }
export interface MetricSnapshot { readonly schemaVersion: 1; readonly contextRef: string; readonly startedAtMonotonicMs: number; readonly sampledAtMonotonicMs: number; readonly metrics: readonly MetricValue[] }
export interface MetricsContext { readonly contextRef: string }
export interface MetricsDependencies { readonly window?: Window | null; readonly document?: Document | null; readonly now?: () => number; readonly readCounters?: () => Partial<Record<'audioUnderruns' | 'queuedAudioFrames' | 'droppedVideoFrames', number>> }
export interface IngestObservation { readonly contextRef: string; readonly startMonotonicMs: number; readonly endMonotonicMs: number; readonly ownerRef?: string; readonly requestRef?: string }

const units: Record<MetricName, MetricUnit> = {
  inputP50: 'ms', inputP95: 'ms', ingestDuration: 'ms', maxLongTask: 'ms', heapUsed: 'bytes', heapGrowth: 'percent',
  idbReadP95: 'ms', idbWriteP95: 'ms', audioUnderruns: 'count', queuedAudioFrames: 'count', droppedVideoFrames: 'count',
};

/** Records browser-observable aggregates; unsupported APIs remain explicitly unavailable. */
export function createMetrics(deps: MetricsDependencies = {}): {
  start(context: MetricsContext): void;
  recordIngest(observation: IngestObservation): void;
  recordIdb(kind: 'read' | 'write', durationMs: number): void;
  snapshot(): MetricSnapshot;
  stop(): void;
  dispose(): void;
} {
  const win = deps.window === undefined ? (typeof window === 'undefined' ? null : window) : deps.window;
  const doc = deps.document === undefined ? (typeof document === 'undefined' ? null : document) : deps.document;
  const now = deps.now ?? (() => win?.performance.now() ?? 0);
  const samples = new Map<MetricName, number[]>();
  const unavailable = new Map<MetricName, MetricUnavailableReason>();
  let contextRef = 'uninitialized';
  let startedAt = 0;
  let running = false;
  let inputStarted = new WeakMap<EventTarget, number>();
  let longTaskObserver: PerformanceObserver | null = null;
  let inputListener: ((event: Event) => void) | null = null;
  let nextFrameIds = new Set<number>();
  let initialHeap: number | null = null;
  let generation = 0;

  const add = (name: MetricName, value: number): void => {
    if (Number.isFinite(value) && value >= 0) samples.set(name, [...(samples.get(name) ?? []), value].slice(-2048));
  };
  const percentile = (values: readonly number[], p: number): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
  };
  const heap = (): number | null => {
    const performanceWithMemory = win?.performance as (Performance & { memory?: { usedJSHeapSize?: number } }) | undefined;
    const value = performanceWithMemory?.memory?.usedJSHeapSize;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const onInput = (event: Event): void => {
    const target = event.target;
    if (!target || typeof target !== 'object') return;
    inputStarted.set(target, now());
    const started = inputStarted.get(target);
    const currentGeneration = generation;
    if (started === undefined || !win) return;
    let secondFrame = 0;
    const firstFrame = win.requestAnimationFrame(() => {
      nextFrameIds.delete(firstFrame);
      if (!running || currentGeneration !== generation) return;
      secondFrame = win.requestAnimationFrame(() => {
        nextFrameIds.delete(secondFrame);
        if (!running || currentGeneration !== generation) return;
        add('inputP95', now() - started);
      });
      nextFrameIds.add(secondFrame);
    });
    nextFrameIds.add(firstFrame);
  };
  const start = (context: MetricsContext): void => {
    stop();
    generation++;
    contextRef = typeof context.contextRef === 'string' && context.contextRef.length <= 128 ? context.contextRef : 'invalid-context';
    startedAt = now();
    running = true;
    samples.clear(); unavailable.clear();
    if (doc && win) {
      inputStarted = new WeakMap<EventTarget, number>();
      inputListener = onInput;
      doc.addEventListener('input', inputListener, true);
    } else {
      unavailable.set('inputP50', 'api-unavailable');
      unavailable.set('inputP95', 'api-unavailable');
    }
    const Observer = (win as (Window & { PerformanceObserver?: typeof PerformanceObserver }) | null)?.PerformanceObserver;
    if (Observer) {
      try {
        longTaskObserver = new Observer(list => {
          if (!running) return;
          for (const entry of list.getEntries()) if (entry.startTime >= startedAt) add('maxLongTask', entry.duration);
        });
        longTaskObserver.observe({ type: 'longtask' });
      } catch { unavailable.set('maxLongTask', 'api-unavailable'); }
    } else unavailable.set('maxLongTask', 'api-unavailable');
    initialHeap = heap();
    if (initialHeap === null) unavailable.set('heapUsed', 'api-unavailable');
    for (const name of ['idbReadP95', 'idbWriteP95'] as const) unavailable.set(name, 'no-samples');
    if (typeof deps.readCounters !== 'function') {
      for (const name of ['audioUnderruns', 'queuedAudioFrames', 'droppedVideoFrames'] as const) unavailable.set(name, 'not-instrumented');
    }
  };
  const makeMetric = (name: MetricName, value: number | null, count: number, reason: MetricUnavailableReason | null): MetricValue => ({
    name, value, unit: units[name], sampleCount: count, availability: value === null ? 'unavailable' : 'observed', reason: value === null ? (reason ?? 'no-samples') : null,
  });
  const snapshot = (): MetricSnapshot => {
    const input = samples.get('ingestDuration') ?? [];
    const currentHeap = heap();
    const heapDelta = initialHeap !== null && currentHeap !== null && initialHeap > 0 ? ((currentHeap - initialHeap) / initialHeap) * 100 : null;
    const metrics: MetricValue[] = [
      makeMetric('inputP50', percentile(samples.get('inputP95') ?? [], .5), samples.get('inputP95')?.length ?? 0, samples.get('inputP95')?.length ? null : (unavailable.get('inputP50') ?? 'no-samples')),
      makeMetric('inputP95', percentile(samples.get('inputP95') ?? [], .95), samples.get('inputP95')?.length ?? 0, samples.get('inputP95')?.length ? null : (unavailable.get('inputP95') ?? 'no-samples')),
      makeMetric('ingestDuration', percentile(input, .95), input.length, input.length ? null : 'not-instrumented'),
      makeMetric('maxLongTask', (samples.get('maxLongTask') ?? []).length ? Math.max(...(samples.get('maxLongTask') ?? [])) : null, samples.get('maxLongTask')?.length ?? 0, unavailable.get('maxLongTask') ?? 'no-samples'),
      makeMetric('heapUsed', currentHeap, currentHeap === null ? 0 : 1, unavailable.get('heapUsed') ?? 'no-samples'),
      makeMetric('heapGrowth', heapDelta, heapDelta === null ? 0 : 1, heapDelta === null ? 'no-samples' : null),
      makeMetric('idbReadP95', percentile(samples.get('idbReadP95') ?? [], .95), samples.get('idbReadP95')?.length ?? 0, unavailable.get('idbReadP95') ?? 'no-samples'),
      makeMetric('idbWriteP95', percentile(samples.get('idbWriteP95') ?? [], .95), samples.get('idbWriteP95')?.length ?? 0, unavailable.get('idbWriteP95') ?? 'no-samples'),
    ];
    let counters: Partial<Record<'audioUnderruns' | 'queuedAudioFrames' | 'droppedVideoFrames', number>> = {};
    try { counters = deps.readCounters?.() ?? {}; } catch { /* report below as unavailable */ }
    for (const name of ['audioUnderruns', 'queuedAudioFrames', 'droppedVideoFrames'] as const) {
      const value = counters[name];
      metrics.push(makeMetric(name, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null, typeof value === 'number' ? 1 : 0, unavailable.get(name) ?? (value === undefined ? 'not-instrumented' : null)));
    }
    return { schemaVersion: 1, contextRef, startedAtMonotonicMs: startedAt, sampledAtMonotonicMs: now(), metrics };
  };
  const recordIngest = (observation: IngestObservation): void => {
    if (!running || !observation || observation.contextRef !== contextRef || typeof observation.startMonotonicMs !== 'number' || typeof observation.endMonotonicMs !== 'number') return;
    const end = observation.endMonotonicMs;
    if (!Number.isFinite(end) || !Number.isFinite(observation.startMonotonicMs) || end < observation.startMonotonicMs) return;
    const contextStartedAt = startedAt;
    if (observation.startMonotonicMs < contextStartedAt) return;
    add('ingestDuration', end - observation.startMonotonicMs);
  };
  const recordIdb = (kind: 'read' | 'write', durationMs: number): void => {
    if (!running || !Number.isFinite(durationMs) || durationMs < 0) return;
    const name = kind === 'read' ? 'idbReadP95' : 'idbWriteP95';
    add(name, durationMs); unavailable.delete(name);
  };
  const stop = (): void => {
    generation++;
    if (inputListener && doc) doc.removeEventListener('input', inputListener, true);
    inputListener = null;
    longTaskObserver?.disconnect(); longTaskObserver = null;
    if (win) for (const id of nextFrameIds) win.cancelAnimationFrame(id);
    nextFrameIds.clear();
    running = false;
  };
  return { start, recordIngest, recordIdb, snapshot, stop, dispose() { stop(); samples.clear(); unavailable.clear(); contextRef = 'disposed'; } };
}
