// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createPublicIngressBatcher, type PublicIngressFrame } from './public-ingress-batcher';
import { makeAccountGeneration, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, type OwnerSnapshot } from './contracts';

function makeOwner(suffix: string, generation = 1): OwnerSnapshot {
  return {
    networkId: makeNetworkId(`custom:wss://ingress-${suffix}.test/irc`)!,
    accountId: null,
    accountGeneration: makeAccountGeneration(0)!,
    connectionGeneration: makeConnectionGeneration(generation)!,
    physicalRef: makeLocalPhysicalEpoch(`${suffix === 'first' ? '1' : '2'}${suffix === 'first' ? '1' : '2'}`.repeat(16))!,
    ownerRef: makeOwnerRef((suffix === 'first' ? 'a' : 'b').repeat(22))!,
  };
}

function sameOwner(left: OwnerSnapshot, right: OwnerSnapshot): boolean {
  return left.networkId === right.networkId
    && left.accountId === right.accountId
    && left.accountGeneration === right.accountGeneration
    && left.connectionGeneration === right.connectionGeneration
    && left.physicalRef === right.physicalRef
    && left.ownerRef === right.ownerRef;
}

function fixture(emitOverride?: (frames: readonly PublicIngressFrame[], owner: OwnerSnapshot) => void) {
  let owner = makeOwner('first');
  const emitted: Array<{ readonly frames: readonly PublicIngressFrame[]; readonly owner: OwnerSnapshot }> = [];
  const timers: Array<{ readonly callback: () => void; readonly delayMs: number; cancelled: boolean }> = [];
  const batcher = createPublicIngressBatcher({
    ownerSnapshot: () => owner,
    isCurrent: candidate => sameOwner(candidate, owner),
    emit(frames, capturedOwner) {
      emitted.push({ frames, owner: capturedOwner });
      emitOverride?.(frames, capturedOwner);
    },
    schedule(callback, delayMs) {
      const timer = { callback, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(handle) {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  });
  return {
    batcher,
    emitted,
    timers,
    get owner() { return owner; },
    set owner(next: OwnerSnapshot) { owner = next; },
  };
}

const frame = (at: number, ...lines: string[]): PublicIngressFrame => ({ at, lines });

describe('public ingress batching', () => {
  it('preserves frame receipts, line order, and the captured full owner', () => {
    const f = fixture();
    const mutableLines = ['PING :one', 'PONG :two'];
    f.batcher.enqueue({ at: 123, lines: mutableLines }, f.owner);
    mutableLines[0] = 'changed after enqueue';
    f.batcher.enqueue(frame(456, 'NOTICE #room :three'), f.owner);
    f.batcher.flush();

    expect(f.emitted).toEqual([{
      owner: f.owner,
      frames: [
        { at: 123, lines: ['PING :one', 'PONG :two'] },
        { at: 456, lines: ['NOTICE #room :three'] },
      ],
    }]);
  });

  it('flushes at the frame-count and byte bounds before accepting the next frame', () => {
    const f = fixture();
    for (let index = 0; index < 16; index += 1) {
      expect(f.batcher.enqueue(frame(index, `line-${index}`), f.owner)).toBe(true);
    }
    expect(f.batcher.enqueue(frame(16, 'line-16'), f.owner)).toBe(true);
    expect(f.emitted[0]?.frames).toHaveLength(16);
    f.batcher.flush();
    expect(f.emitted[1]?.frames).toEqual([{ at: 16, lines: ['line-16'] }]);

    const second = fixture();
    expect(second.batcher.enqueue(frame(1, 'x'.repeat(21_845)), second.owner)).toBe(true);
    expect(second.batcher.enqueue(frame(2, 'y'), second.owner)).toBe(true);
    expect(second.emitted[0]?.frames).toEqual([{ at: 1, lines: ['x'.repeat(21_845)] }]);
    expect(second.batcher.enqueue(frame(3, 'z'.repeat(21_846)), second.owner)).toBe(false);
    expect(second.emitted[1]?.frames).toEqual([{ at: 2, lines: ['y'] }]);
    second.batcher.flush();
    expect(second.emitted).toHaveLength(2);
  });

  it.each(['frame-count', 'byte-count'] as const)('rejects an overflow frame after a reentrant same-owner %s enqueue and keeps delivery order', mode => {
    const timeline: string[] = [];
    const holder: { current?: ReturnType<typeof fixture> } = {};
    let reentered = false;
    const f = fixture((frames, emittedOwner) => {
      const firstLine = frames[0]?.lines[0] ?? '';
      timeline.push(`emit:${frames.length}:${firstLine.length > 100 ? `long-${firstLine.length}` : firstLine}`);
      const current = holder.current;
      if (current && !reentered && sameOwner(emittedOwner, current.owner)) {
        reentered = true;
        expect(current.batcher.enqueue(frame(100, 'reentrant'), current.owner)).toBe(true);
      }
    });
    holder.current = f;
    if (mode === 'frame-count') {
      for (let index = 0; index < 16; index += 1) {
        expect(f.batcher.enqueue(frame(index, `queued-${index}`), f.owner)).toBe(true);
      }
    } else {
      expect(f.batcher.enqueue(frame(0, 'x'.repeat(21_845)), f.owner)).toBe(true);
    }

    const overflow = frame(mode === 'frame-count' ? 16 : 1, mode === 'frame-count' ? 'overflow' : 'y');
    const accepted = f.batcher.enqueue(overflow, f.owner);
    if (!accepted) timeline.push(`fallback:${overflow.lines[0]}`);
    expect(accepted).toBe(false);
    expect(f.emitted[0]?.frames).toHaveLength(mode === 'frame-count' ? 16 : 1);
    f.batcher.flush();

    expect(timeline).toEqual([
      mode === 'frame-count' ? 'emit:16:queued-0' : 'emit:1:long-21845',
      `fallback:${overflow.lines[0]}`,
      'emit:1:reentrant',
    ]);
    expect(f.emitted[1]?.frames).toEqual([{ at: 100, lines: ['reentrant'] }]);
  });

  it('drops queued frames when the current owner changes', () => {
    const f = fixture();
    const staleOwner = f.owner;
    f.batcher.enqueue(frame(1, 'stale'), staleOwner);
    const nextOwner = makeOwner('second', 2);
    f.owner = nextOwner;

    expect(f.batcher.enqueue(frame(2, 'current'), nextOwner)).toBe(true);
    expect(f.timers[0]?.cancelled).toBe(true);
    f.batcher.flush();
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]?.owner).toBe(nextOwner);
    expect(f.emitted[0]?.frames).toEqual([{ at: 2, lines: ['current'] }]);
  });

  it('uses an eight millisecond timer and fences callbacks after cancellation', () => {
    const f = fixture();
    f.batcher.enqueue(frame(1, 'timer'), f.owner);
    const lateCallback = f.timers[0]?.callback;
    expect(f.timers[0]?.delayMs).toBe(8);
    f.batcher.flush();
    expect(f.timers[0]?.cancelled).toBe(true);
    lateCallback?.();
    expect(f.emitted).toHaveLength(1);
  });

  it('discards on owner change observed by the timer', () => {
    const f = fixture();
    f.batcher.enqueue(frame(1, 'stale'), f.owner);
    const staleTimer = f.timers[0]?.callback;
    f.owner = makeOwner('second', 2);
    staleTimer?.();
    expect(f.emitted).toEqual([]);
  });

  it('does not emit or accept new work after disposal', () => {
    const f = fixture();
    f.batcher.enqueue(frame(1, 'discarded'), f.owner);
    const lateCallback = f.timers[0]?.callback;
    f.batcher.dispose();
    lateCallback?.();
    f.batcher.flush();
    expect(f.batcher.enqueue(frame(2, 'late'), f.owner)).toBe(false);
    expect(f.emitted).toEqual([]);
  });

  it('clears a batch before a throwing emitter and never retries it', () => {
    let calls = 0;
    const f = fixture(() => {
      calls += 1;
      throw new Error('emit failed');
    });
    f.batcher.enqueue(frame(1, 'once'), f.owner);
    expect(() => f.batcher.flush()).toThrow('emit failed');
    f.batcher.flush();
    expect(calls).toBe(1);
  });

  it('abandons a timer batch after an emit throw without retrying or losing reentrant current-owner work', () => {
    const holder: { current?: ReturnType<typeof fixture> } = {};
    let ownerA: OwnerSnapshot | null = null;
    const ownerB = makeOwner('second', 2);
    let failedOnce = false;
    const f = fixture((_frames, emittedOwner) => {
      const current = holder.current;
      if (current && !failedOnce && ownerA !== null && sameOwner(emittedOwner, ownerA)) {
        failedOnce = true;
        current.owner = ownerB;
        expect(current.batcher.enqueue(frame(2, 'owner-b'), ownerB)).toBe(true);
        throw new Error('timed emit failed');
      }
    });
    ownerA = f.owner;
    holder.current = f;
    expect(f.batcher.enqueue(frame(1, 'owner-a'), ownerA)).toBe(true);

    expect(() => f.timers[0]?.callback()).not.toThrow();
    expect(f.emitted).toEqual([{ owner: ownerA, frames: [{ at: 1, lines: ['owner-a'] }] }]);
    expect(f.timers).toHaveLength(2);

    expect(() => f.timers[1]?.callback()).not.toThrow();
    expect(f.emitted).toEqual([
      { owner: ownerA, frames: [{ at: 1, lines: ['owner-a'] }] },
      { owner: ownerB, frames: [{ at: 2, lines: ['owner-b'] }] },
    ]);
    f.batcher.flush();
    expect(f.emitted).toHaveLength(2);
  });

  it('ignores a stale producer without erasing a current owner batch', () => {
    const f = fixture();
    const staleOwner = f.owner;
    const currentOwner = makeOwner('second', 2);
    f.owner = currentOwner;
    expect(f.batcher.enqueue(frame(1, 'current'), currentOwner)).toBe(true);

    expect(f.batcher.enqueue(frame(2, 'stale'), staleOwner)).toBe(false);
    f.batcher.flush();
    expect(f.emitted).toEqual([{
      owner: currentOwner,
      frames: [{ at: 1, lines: ['current'] }],
    }]);
  });

  it.each(['frame-count overflow', 'oversized frame'] as const)('preserves a reentrant new-owner batch after %s', mode => {
    const holder: { current?: ReturnType<typeof fixture> } = {};
    let previousOwner: OwnerSnapshot | null = null;
    const nextOwner = makeOwner('second', 2);
    let reentered = false;
    const f = fixture((_frames, emittedOwner) => {
      const current = holder.current;
      if (current && !reentered && previousOwner !== null && sameOwner(emittedOwner, previousOwner)) {
        reentered = true;
        current.owner = nextOwner;
        expect(current.batcher.enqueue(frame(99, 'owner-b'), nextOwner)).toBe(true);
      }
    });
    const ownerA = f.owner;
    previousOwner = ownerA;
    holder.current = f;

    if (mode === 'frame-count overflow') {
      for (let index = 0; index < 16; index += 1) {
        expect(f.batcher.enqueue(frame(index, 'owner-a-' + index), ownerA)).toBe(true);
      }
      expect(f.batcher.enqueue(frame(16, 'owner-a-overflow'), ownerA)).toBe(false);
      expect(f.emitted[0]?.frames).toHaveLength(16);
    } else {
      expect(f.batcher.enqueue(frame(1, 'owner-a-before-oversize'), ownerA)).toBe(true);
      expect(f.batcher.enqueue(frame(2, 'z'.repeat(21_846)), ownerA)).toBe(false);
      expect(f.emitted[0]?.frames).toEqual([{ at: 1, lines: ['owner-a-before-oversize'] }]);
    }

    expect(f.owner).toBe(nextOwner);
    f.batcher.flush();
    expect(f.emitted[1]).toEqual({
      owner: nextOwner,
      frames: [{ at: 99, lines: ['owner-b'] }],
    });
  });

  it('discards stale captured owners without adding them to the queue', () => {
    const f = fixture();
    const staleOwner = f.owner;
    f.owner = makeOwner('second', 2);
    expect(f.batcher.enqueue(frame(1, 'stale'), staleOwner)).toBe(false);
    expect(f.timers).toHaveLength(0);
    f.batcher.flush();
    expect(f.emitted).toEqual([]);
  });
});
