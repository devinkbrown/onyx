// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerSnapshot } from './contracts';

export interface PublicIngressFrame {
  readonly at: number;
  readonly lines: readonly string[];
}

export interface PublicIngressBatcherDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly emit: (frames: readonly PublicIngressFrame[], owner: OwnerSnapshot) => void;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export interface PublicIngressBatcher {
  enqueue(frame: PublicIngressFrame, capturedOwner: OwnerSnapshot): boolean;
  flush(): void;
  discard(): void;
  dispose(): void;
}

const MAX_FRAMES = 16;
const MAX_BYTES = 64 * 1024;
const MAX_CODE_UNITS = Math.floor(MAX_BYTES / 3);
const MAX_WAIT_MS = 8;

function sameOwner(left: OwnerSnapshot, right: OwnerSnapshot): boolean {
  return left.networkId === right.networkId
    && left.accountId === right.accountId
    && left.accountGeneration === right.accountGeneration
    && left.connectionGeneration === right.connectionGeneration
    && left.physicalRef === right.physicalRef
    && left.ownerRef === right.ownerRef;
}

/** A conservative upper bound: each UTF-16 code unit costs at most three UTF-8 bytes. */
function frameByteUpperBound(frame: PublicIngressFrame): number {
  let codeUnits = 0;
  for (const line of frame.lines) {
    if (line.length > MAX_CODE_UNITS - codeUnits) return MAX_BYTES + 1;
    codeUnits += line.length;
  }
  return codeUnits * 3;
}

export function createPublicIngressBatcher(deps: PublicIngressBatcherDependencies): PublicIngressBatcher {
  if ((deps.schedule === undefined) !== (deps.cancel === undefined)) {
    throw new Error('public ingress scheduler and cancellation must be injected together');
  }

  const schedule = deps.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = deps.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let frames: PublicIngressFrame[] = [];
  let queuedBytes = 0;
  let queuedOwner: OwnerSnapshot | null = null;
  let disposed = false;
  let timerToken = 0;
  let timerScheduled = false;
  let timerHandle: unknown;

  const isCurrentOwner = (owner: OwnerSnapshot): boolean => !disposed
    && deps.isCurrent(owner)
    && sameOwner(deps.ownerSnapshot(), owner);

  function invalidateTimer(): void {
    timerToken += 1;
    if (!timerScheduled) return;
    const handle = timerHandle;
    timerScheduled = false;
    timerHandle = undefined;
    cancel(handle);
  }

  function clearQueue(): void {
    frames = [];
    queuedBytes = 0;
    queuedOwner = null;
    invalidateTimer();
  }

  function discardIfQueuedOwnerIsStale(): void {
    if (queuedOwner !== null && !isCurrentOwner(queuedOwner)) discard();
  }

  function scheduleFlush(): void {
    if (timerScheduled || frames.length === 0) return;
    const token = ++timerToken;
    timerScheduled = true;
    const handle = schedule(() => {
      if (disposed || !timerScheduled || token !== timerToken) return;
      timerScheduled = false;
      timerHandle = undefined;
      try { flush(); } catch { /* timed delivery already cleared this batch; do not retry an observer failure */ }
    }, MAX_WAIT_MS);
    if (timerScheduled && token === timerToken) timerHandle = handle;
  }

  function flush(): void {
    if (disposed || frames.length === 0 || queuedOwner === null) {
      clearQueue();
      return;
    }
    const owner = queuedOwner;
    if (!isCurrentOwner(owner)) {
      clearQueue();
      return;
    }
    const batch = frames;
    clearQueue();
    deps.emit(batch, owner);
  }

  function discard(): void {
    clearQueue();
  }

  function enqueue(frame: PublicIngressFrame, capturedOwner: OwnerSnapshot): boolean {
    if (disposed) return false;
    if (!isCurrentOwner(capturedOwner)) {
      discardIfQueuedOwnerIsStale();
      return false;
    }

    if (queuedOwner !== null && !sameOwner(queuedOwner, capturedOwner)) discard();

    const frameBytes = frameByteUpperBound(frame);
    if (frameBytes > MAX_BYTES) {
      if (frames.length > 0) flush();
      if (!isCurrentOwner(capturedOwner)) discardIfQueuedOwnerIsStale();
      return false;
    }

    if (frames.length > 0 && (frames.length >= MAX_FRAMES || queuedBytes + frameBytes > MAX_BYTES)) {
      flush();
      if (!isCurrentOwner(capturedOwner)) {
        discardIfQueuedOwnerIsStale();
        return false;
      }
      // A synchronous emit observer may have queued more current-owner work.
      // Leave that bounded queue intact and let the caller deliver this frame
      // immediately; appending here would place an older frame after reentrant
      // work and could exceed either queue bound.
      if (frames.length > 0) return false;
    }

    if (queuedOwner === null) queuedOwner = capturedOwner;
    frames.push({ at: frame.at, lines: [...frame.lines] });
    queuedBytes += frameBytes;
    try {
      scheduleFlush();
    } catch (error) {
      discard();
      throw error;
    }
    return true;
  }

  return {
    enqueue,
    flush,
    discard,
    dispose() {
      if (disposed) return;
      disposed = true;
      discard();
    },
  };
}
