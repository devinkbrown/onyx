// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { computeMessageWindow, DEFAULT_ANCHOR_CONTEXT } from './messageWindow';

describe('computeMessageWindow', () => {
  it('renders the whole list when it is smaller than the window', () => {
    const w = computeMessageWindow({ total: 10, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(10);
    expect(w.hiddenBefore).toBe(0);
    expect(w.rendered).toBe(10);
  });

  it('renders the whole list at the exact window boundary', () => {
    const w = computeMessageWindow({ total: 120, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.hiddenBefore).toBe(0);
    expect(w.rendered).toBe(120);
  });

  it('keeps only the trailing window when the list is larger', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120 });
    expect(w.start).toBe(380);
    expect(w.end).toBe(500);
    expect(w.hiddenBefore).toBe(380);
    expect(w.rendered).toBe(120);
  });

  it('handles an empty list', () => {
    const w = computeMessageWindow({ total: 0, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(0);
    expect(w.hiddenBefore).toBe(0);
    expect(w.rendered).toBe(0);
  });

  it('renders everything when windowSize is Infinity (show-all)', () => {
    const w = computeMessageWindow({ total: 5000, windowSize: Number.POSITIVE_INFINITY });
    expect(w.start).toBe(0);
    expect(w.hiddenBefore).toBe(0);
    expect(w.rendered).toBe(5000);
  });

  it('leaves the window untouched when the anchor already falls inside it', () => {
    // trailing window covers 380..499; anchor 450 is already visible.
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 450 });
    expect(w.start).toBe(380);
    expect(w.hiddenBefore).toBe(380);
  });

  it('extends the window downward to include an anchor above the trailing slice', () => {
    // anchor 100 is far above the trailing window (380). Window grows to
    // include it plus the default context above.
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 100 });
    expect(w.start).toBe(100 - DEFAULT_ANCHOR_CONTEXT);
    expect(w.hiddenBefore).toBe(100 - DEFAULT_ANCHOR_CONTEXT);
    expect(w.end).toBe(500);
  });

  it('clamps the extended start to zero when the anchor is near the top', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 3 });
    expect(w.start).toBe(0);
    expect(w.hiddenBefore).toBe(0);
  });

  it('honours a custom anchor context', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: 50 });
    expect(w.start).toBe(150);
  });

  it('ignores a null or negative anchor', () => {
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: null }).start).toBe(380);
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: -1 }).start).toBe(380);
  });

  it('ignores an anchor at or past the end of the list', () => {
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 500 }).start).toBe(380);
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 999 }).start).toBe(380);
  });

  it('never extends the window upward past a smaller trailing start', () => {
    // anchor is BELOW the natural trailing start — must not shrink the window.
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 490 });
    expect(w.start).toBe(380);
  });

  it('treats a non-positive window size as rendering only the tail-safe minimum', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 0 });
    // Defensive: never render a negative count; start clamps to total.
    expect(w.start).toBe(500);
    expect(w.rendered).toBe(0);
  });

  // ── frame-budget guard: rendered DOM rows must stay bounded no matter how
  // large the underlying transcript grows. Each rendered row builds a message
  // subtree (~8 memos + a signal), so `rendered` is the proxy for per-frame
  // render cost. These pin that cost to the window, not to `total`. ──
  describe('bounded render cost at scale', () => {
    it('caps rendered rows to the window on a very large channel (no anchor)', () => {
      const total = 100_000;
      const windowSize = 120;
      const w = computeMessageWindow({ total, windowSize });
      // Render cost is O(windowSize), NOT O(total).
      expect(w.rendered).toBe(windowSize);
      expect(w.start).toBe(total - windowSize);
      expect(w.hiddenBefore).toBe(total - windowSize);
      expect(w.end).toBe(total);
    });

    it('rendered never exceeds windowSize across a sweep of large totals', () => {
      const windowSize = 200;
      for (const total of [1_000, 10_000, 50_000, 250_000]) {
        const w = computeMessageWindow({ total, windowSize });
        expect(w.rendered).toBeLessThanOrEqual(windowSize);
        expect(w.rendered).toBe(windowSize);
        // start + rendered always reconstructs the tail exactly.
        expect(w.start + w.rendered).toBe(total);
        expect(w.hiddenBefore).toBe(w.start);
      }
    });

    it('an anchor near the top of a huge list extends render cost by a bounded, known amount', () => {
      const total = 100_000;
      const windowSize = 120;
      const anchorIndex = 40_000; // deep-history time-travel landing
      const w = computeMessageWindow({ total, windowSize, anchorIndex });
      // Extension is exactly (anchorIndex - context) .. total — bounded and
      // predictable, never the whole list unless the anchor is at the very top.
      expect(w.start).toBe(anchorIndex - DEFAULT_ANCHOR_CONTEXT);
      expect(w.rendered).toBe(total - (anchorIndex - DEFAULT_ANCHOR_CONTEXT));
      expect(w.end).toBe(total);
      // The anchor row itself is always inside the rendered slice.
      expect(anchorIndex).toBeGreaterThanOrEqual(w.start);
      expect(anchorIndex).toBeLessThan(w.end);
    });

    it('growing the window in steps stays a pure trailing slice (show-earlier)', () => {
      const total = 10_000;
      // Simulate BASE_WINDOW_ROWS(120) + n * WINDOW_STEP_ROWS(200) growth.
      let prevStart = total;
      for (let size = 120; size <= 120 + 200 * 5; size += 200) {
        const w = computeMessageWindow({ total, windowSize: size });
        expect(w.rendered).toBe(size);
        expect(w.end).toBe(total);
        // Each growth step only ever moves the top edge UP (older rows in),
        // never past 0 — so "show earlier" is monotonic and prepend-only.
        expect(w.start).toBeLessThanOrEqual(prevStart);
        expect(w.start).toBe(total - size);
        prevStart = w.start;
      }
    });

    it('show-all (Infinity) renders the whole huge list exactly once', () => {
      const total = 250_000;
      const w = computeMessageWindow({ total, windowSize: Number.POSITIVE_INFINITY });
      expect(w.start).toBe(0);
      expect(w.hiddenBefore).toBe(0);
      expect(w.rendered).toBe(total);
      expect(w.end).toBe(total);
    });
  });

  // ── aria-live integrity proxy: the log suppresses announcements by watching
  // `start`. A pure tail arrival must keep `start` flat or RISING (never a
  // decrease), or the feed would mis-detect a prepend and silence a real new
  // message. These pin the tail-append vs prepend signal the effect relies on. ──
  describe('tail-append vs history-prepend signal (aria-live)', () => {
    it('a new tail message keeps the window start flat once the window is full', () => {
      const windowSize = 120;
      const before = computeMessageWindow({ total: 5_000, windowSize });
      const afterTail = computeMessageWindow({ total: 5_001, windowSize });
      // Tail append: start advances by exactly one (window slides down), so the
      // effect sees start NOT decreasing → stays announced. Never a prepend.
      expect(afterTail.start).toBe(before.start + 1);
      expect(afterTail.start).toBeGreaterThanOrEqual(before.start);
    });

    it('a history prepend (anchor jump) LOWERS start so the effect can suppress it', () => {
      const windowSize = 120;
      const tail = computeMessageWindow({ total: 5_000, windowSize });
      const jumped = computeMessageWindow({ total: 5_000, windowSize, anchorIndex: 100 });
      // Time-travel landing pulls the top edge up → start decreases → the effect
      // flips aria-live off, so the injected older rows are never re-announced.
      expect(jumped.start).toBeLessThan(tail.start);
    });
  });

  // ── input hardening: fail closed on malformed input rather than propagate
  // NaN into `messages().slice(start)` or drop the anchor row. ──
  describe('input hardening', () => {
    it('renders nothing when total is NaN or non-finite (fail closed)', () => {
      for (const total of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const w = computeMessageWindow({ total, windowSize: 120 });
        expect(w.start).toBe(0);
        expect(w.end).toBe(0);
        expect(w.rendered).toBe(0);
        expect(w.hiddenBefore).toBe(0);
      }
    });

    it('never drops the anchor row when given a negative anchor context', () => {
      // A negative context would push `desired` above the anchor; the clamp must
      // keep the anchor inside the window. Behaves like zero context.
      const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: -50 });
      expect(w.start).toBeLessThanOrEqual(200);
      expect(w.start).toBe(200); // clamped context 0 → start lands on the anchor
      expect(w.rendered).toBe(300);
    });

    it('falls back to the default context when anchorContext is non-finite', () => {
      const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: Number.NaN });
      expect(w.start).toBe(200 - DEFAULT_ANCHOR_CONTEXT);
    });
  });
});
