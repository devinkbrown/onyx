// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { ReplayGuard, REPLAY_WINDOW_BITS } from './replayWindow';

/** Build a 12-byte IV: 8-byte prefix + 4-byte big-endian counter. */
function iv(prefix: number, counter: number): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = prefix & 0xff;
  new DataView(b.buffer).setUint32(8, counter >>> 0, false);
  return b;
}

describe('ReplayGuard — bounded sliding-window anti-replay', () => {
  it('accepts a fresh IV via mayAccept and only records it on commit', () => {
    const g = new ReplayGuard();
    const a = iv(1, 0);
    expect(g.mayAccept(a)).toBe(true);
    // mayAccept must be pure: repeated calls before commit still accept.
    expect(g.mayAccept(a)).toBe(true);
    g.commit(a);
    expect(g.mayAccept(a)).toBe(false);
  });

  it('rejects an exact replay (same prefix + counter) after commit', () => {
    const g = new ReplayGuard();
    g.commit(iv(1, 5));
    expect(g.mayAccept(iv(1, 5))).toBe(false);
  });

  it('separates senders by prefix — same counter from another sender is fresh', () => {
    const g = new ReplayGuard();
    g.commit(iv(1, 7));
    expect(g.mayAccept(iv(1, 7))).toBe(false);
    expect(g.mayAccept(iv(2, 7))).toBe(true);
  });

  it('accepts monotonic counters and always rejects re-delivery of each', () => {
    const g = new ReplayGuard();
    for (let c = 0; c < 500; c++) {
      expect(g.mayAccept(iv(3, c))).toBe(true);
      g.commit(iv(3, c));
      expect(g.mayAccept(iv(3, c))).toBe(false);
    }
    // A random earlier counter is still rejected.
    expect(g.mayAccept(iv(3, 250))).toBe(false);
  });

  it('tolerates in-window out-of-order delivery yet rejects duplicates', () => {
    const g = new ReplayGuard();
    g.commit(iv(4, 10));
    // Older-but-in-window arrivals are accepted once...
    expect(g.mayAccept(iv(4, 8))).toBe(true);
    g.commit(iv(4, 8));
    expect(g.mayAccept(iv(4, 8))).toBe(false); // ...then rejected as replay
    expect(g.mayAccept(iv(4, 9))).toBe(true);
    g.commit(iv(4, 9));
    expect(g.mayAccept(iv(4, 9))).toBe(false);
    // The high-water counter is unchanged and still rejected.
    expect(g.mayAccept(iv(4, 10))).toBe(false);
  });

  it('rejects counters that fall before the window (too old to prove non-replay)', () => {
    const g = new ReplayGuard({ windowBits: 8 });
    g.commit(iv(5, 100));
    // Advance the high-water well past the window.
    expect(g.mayAccept(iv(5, 92))).toBe(false); // exactly windowBits back
    expect(g.mayAccept(iv(5, 50))).toBe(false); // far behind
    expect(g.mayAccept(iv(5, 99))).toBe(true);  // still inside the window
  });

  it('does not create sender state on mayAccept alone (forged prefixes cannot fill the table)', () => {
    const g = new ReplayGuard({ maxSenders: 4 });
    for (let p = 0; p < 100; p++) g.mayAccept(iv(p, 0));
    expect(g.senderCount).toBe(0);
  });

  it('bounds tracked senders and evicts least-recently-used', () => {
    const g = new ReplayGuard({ maxSenders: 3 });
    g.commit(iv(1, 0));
    g.commit(iv(2, 0));
    g.commit(iv(3, 0));
    expect(g.senderCount).toBe(3);
    // Touch prefix 1 to make it most-recently-used.
    g.commit(iv(1, 1));
    // Adding a 4th evicts the LRU (prefix 2), not prefix 1.
    g.commit(iv(4, 0));
    expect(g.senderCount).toBe(3);
    expect(g.mayAccept(iv(1, 1))).toBe(false); // still remembered
    expect(g.mayAccept(iv(2, 0))).toBe(true);  // evicted → looks fresh again
    expect(g.mayAccept(iv(4, 0))).toBe(false); // remembered
  });

  it('handles a full default window without leaking unbounded memory', () => {
    const g = new ReplayGuard();
    // Commit far more counters than the window width for one sender.
    for (let c = 0; c < REPLAY_WINDOW_BITS * 4; c++) g.commit(iv(6, c));
    expect(g.senderCount).toBe(1); // still exactly one sender's fixed-size window
    // The most recent counter is remembered; a within-window replay is rejected.
    const top = REPLAY_WINDOW_BITS * 4 - 1;
    expect(g.mayAccept(iv(6, top))).toBe(false);
    expect(g.mayAccept(iv(6, top - 10))).toBe(false);
  });

  it('handles a large forward counter jump without huge BigInt work', () => {
    const g = new ReplayGuard({ windowBits: 64 });
    g.commit(iv(8, 0));
    // Jump far past the window (simulating heavy packet loss / attacker cannot
    // reach here without the key, but must not DoS the guard regardless).
    const far = 0x7fffffff;
    expect(g.mayAccept(iv(8, far))).toBe(true);
    g.commit(iv(8, far));
    expect(g.mayAccept(iv(8, far))).toBe(false);     // now remembered
    expect(g.mayAccept(iv(8, far - 1))).toBe(true);  // in-window neighbour fresh
    expect(g.mayAccept(iv(8, 0))).toBe(false);       // pre-window → rejected
  });

  it('clear() forgets all sender state', () => {
    const g = new ReplayGuard();
    g.commit(iv(7, 3));
    expect(g.mayAccept(iv(7, 3))).toBe(false);
    g.clear();
    expect(g.senderCount).toBe(0);
    expect(g.mayAccept(iv(7, 3))).toBe(true);
  });

  it('rejects a mis-sized IV', () => {
    const g = new ReplayGuard();
    expect(() => g.mayAccept(new Uint8Array(11))).toThrow();
    expect(() => g.commit(new Uint8Array(13))).toThrow();
  });
});
