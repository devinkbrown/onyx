// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * replayWindow.ts — Bounded anti-replay guard for TSUMUGI media IVs.
 *
 * TSUMUGI IVs are structured as an 8-byte random per-sender prefix followed by
 * a 4-byte big-endian u32 counter that is strictly monotonic per sender. A
 * grow-forever `Set<ivHex>` therefore leaks memory across a long call (every
 * authentic received frame permanently adds a string).
 *
 * This replaces the unbounded Set with a classic sliding-window (RFC 2401 /
 * IPsec-style) replay guard, kept PER sender-prefix:
 *   - `highest` = the highest counter committed for that prefix,
 *   - `bitmap`  = a WINDOW_BITS-wide bitmask recording which of the counters
 *                 in `[highest - WINDOW_BITS + 1, highest]` have been committed.
 * Bit i of `bitmap` corresponds to counter `highest - i`.
 *
 * Memory is O(distinct senders) — bounded by MAX_SENDERS — with a fixed cost
 * per sender, independent of call duration.
 *
 * Replay semantics are preserved and NOT weakened:
 *   - A counter already committed is rejected (in-window duplicate).
 *   - A counter equal to a committed `highest` is rejected.
 *   - A counter older than the window (`highest - counter >= WINDOW_BITS`) is
 *     rejected — it cannot be proven non-replayed, so it is dropped (standard
 *     anti-replay behaviour).
 *   - IVs are only recorded via `commit()`, which callers MUST invoke ONLY
 *     after a successful decrypt/authentication, so a forged IV whose GCM tag
 *     fails can never poison the window.
 *
 * `mayAccept()` is a pure read (no state mutation), so a forged frame with a
 * random prefix never creates sender state; only authentic senders (whose
 * frames decrypt) ever allocate a window. The MAX_SENDERS cap is thus not
 * attacker-amplifiable.
 */

const IV_LEN = 12;
const IV_PREFIX_LEN = 8;

/** Sliding-window width, in counters, tolerated for out-of-order delivery. */
export const REPLAY_WINDOW_BITS = 1024;

/** Upper bound on distinct sender-prefixes tracked at once. */
export const REPLAY_MAX_SENDERS = 256;

interface SenderState {
  highest: number;
  bitmap: bigint;
}

export class ReplayGuard {
  private readonly windowBits: number;
  private readonly windowMask: bigint;
  private readonly maxSenders: number;
  /** Insertion/most-recently-used order is preserved by Map iteration order. */
  private readonly senders = new Map<string, SenderState>();

  constructor(opts: { windowBits?: number; maxSenders?: number } = {}) {
    this.windowBits = opts.windowBits ?? REPLAY_WINDOW_BITS;
    this.maxSenders = opts.maxSenders ?? REPLAY_MAX_SENDERS;
    if (this.windowBits < 1) throw new Error('ReplayGuard: windowBits must be >= 1');
    if (this.maxSenders < 1) throw new Error('ReplayGuard: maxSenders must be >= 1');
    this.windowMask = (1n << BigInt(this.windowBits)) - 1n;
  }

  /**
   * Pure predicate: would this IV be accepted right now? Does NOT mutate state.
   * Returns false for any IV that has already been committed or that falls
   * before the replay window.
   */
  mayAccept(iv: Uint8Array): boolean {
    const { prefix, counter } = splitIv(iv);
    const state = this.senders.get(prefix);
    if (!state) return true;
    if (counter > state.highest) return true;
    const diff = state.highest - counter;
    if (diff >= this.windowBits) return false;
    return (state.bitmap & (1n << BigInt(diff))) === 0n;
  }

  /**
   * Record an IV as seen. MUST be called only after the frame has been
   * successfully authenticated (decrypted). Idempotent for an already-recorded
   * counter; silently ignores a counter that has fallen out of the window.
   */
  commit(iv: Uint8Array): void {
    const { prefix, counter } = splitIv(iv);
    const existing = this.senders.get(prefix);
    if (!existing) {
      this.touch(prefix, { highest: counter, bitmap: 1n });
      return;
    }
    if (counter > existing.highest) {
      const gap = counter - existing.highest;
      // When the jump exceeds the window, every prior bit shifts out anyway;
      // avoid materialising a multi-billion-bit BigInt for a huge gap.
      const bitmap = gap >= this.windowBits
        ? 1n
        : ((existing.bitmap << BigInt(gap)) | 1n) & this.windowMask;
      this.touch(prefix, { highest: counter, bitmap });
      return;
    }
    const diff = existing.highest - counter;
    if (diff >= this.windowBits) return; // too old to record; already rejected by mayAccept
    this.touch(prefix, {
      highest: existing.highest,
      bitmap: (existing.bitmap | (1n << BigInt(diff))) & this.windowMask,
    });
  }

  /** Forget all sender state. */
  clear(): void {
    this.senders.clear();
  }

  /** Number of distinct sender-prefixes currently tracked (for tests/introspection). */
  get senderCount(): number {
    return this.senders.size;
  }

  /** Move `prefix` to most-recently-used position and evict the oldest if over cap. */
  private touch(prefix: string, state: SenderState): void {
    this.senders.delete(prefix);
    this.senders.set(prefix, state);
    while (this.senders.size > this.maxSenders) {
      const oldest = this.senders.keys().next().value;
      if (oldest === undefined) break;
      this.senders.delete(oldest);
    }
  }
}

function splitIv(iv: Uint8Array): { prefix: string; counter: number } {
  if (iv.length !== IV_LEN) throw new Error('ReplayGuard: IV must be 12 bytes');
  let prefix = '';
  for (let i = 0; i < IV_PREFIX_LEN; i++) prefix += iv[i]!.toString(16).padStart(2, '0');
  const counter =
    ((iv[8]! << 24) | (iv[9]! << 16) | (iv[10]! << 8) | iv[11]!) >>> 0;
  return { prefix, counter };
}
