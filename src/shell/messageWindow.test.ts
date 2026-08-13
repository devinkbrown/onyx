// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  computeMessageWindow,
  DEFAULT_ANCHOR_CONTEXT,
  DEFAULT_WINDOW_SIZE,
  MAX_WINDOW_ROWS,
  planUnreadNavigation,
  selectMessageAnchorIndex,
} from './messageWindow';

function expectConserved(
  w: ReturnType<typeof computeMessageWindow>,
  total: number,
  capacity: number,
): void {
  expect(w.start).toBeGreaterThanOrEqual(0);
  expect(w.end).toBeGreaterThanOrEqual(w.start);
  expect(w.end).toBeLessThanOrEqual(total);
  expect(w.hiddenBefore).toBe(w.start);
  expect(w.hiddenAfter).toBe(total - w.end);
  expect(w.rendered).toBe(w.end - w.start);
  expect(w.hiddenBefore + w.rendered + w.hiddenAfter).toBe(total);
  expect(w.rendered).toBeLessThanOrEqual(capacity);
}

describe('computeMessageWindow', () => {
  it('renders the whole list when it is smaller than the window', () => {
    const w = computeMessageWindow({ total: 10, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(10);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(0);
    expect(w.rendered).toBe(10);
  });

  it('renders the whole list at the exact window boundary', () => {
    const w = computeMessageWindow({ total: 120, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(0);
    expect(w.rendered).toBe(120);
  });

  it('keeps only the trailing window when the list is larger', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120 });
    expect(w.start).toBe(380);
    expect(w.end).toBe(500);
    expect(w.hiddenBefore).toBe(380);
    expect(w.hiddenAfter).toBe(0);
    expect(w.rendered).toBe(120);
  });

  it('handles an empty list', () => {
    const w = computeMessageWindow({ total: 0, windowSize: 120 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(0);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(0);
    expect(w.rendered).toBe(0);
  });

  it('fails closed to the default capacity when windowSize is Infinity', () => {
    const w = computeMessageWindow({ total: 5000, windowSize: Number.POSITIVE_INFINITY });
    expect(w.start).toBe(5000 - DEFAULT_WINDOW_SIZE);
    expect(w.end).toBe(5000);
    expect(w.hiddenBefore).toBe(5000 - DEFAULT_WINDOW_SIZE);
    expect(w.hiddenAfter).toBe(0);
    expect(w.rendered).toBe(DEFAULT_WINDOW_SIZE);
  });

  it('leaves the trailing window untouched when the anchor already falls inside it', () => {
    // trailing window covers 380..499; anchor 450 is already visible.
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 450 });
    expect(w.start).toBe(380);
    expect(w.end).toBe(500);
    expect(w.hiddenBefore).toBe(380);
    expect(w.hiddenAfter).toBe(0);
  });

  it('switches to a two-sided bounded page for an anchor above the trailing slice', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 100 });
    expect(w.start).toBe(100 - DEFAULT_ANCHOR_CONTEXT);
    expect(w.end).toBe(100 - DEFAULT_ANCHOR_CONTEXT + 120);
    expect(w.hiddenBefore).toBe(100 - DEFAULT_ANCHOR_CONTEXT);
    expect(w.hiddenAfter).toBe(500 - w.end);
    expect(w.rendered).toBe(120);
    expect(100).toBeGreaterThanOrEqual(w.start);
    expect(100).toBeLessThan(w.end);
  });

  it('clamps the two-sided page to zero when the anchor is near the top', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 3 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(120);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(380);
    expect(3).toBeGreaterThanOrEqual(w.start);
    expect(3).toBeLessThan(w.end);
  });

  it('honours a custom anchor context without exceeding capacity', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: 50 });
    expect(w.start).toBe(150);
    expect(w.end).toBe(270);
    expect(w.rendered).toBe(120);
    expect(w.hiddenAfter).toBe(230);
  });

  it('ignores a null or negative anchor', () => {
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: null }).start).toBe(380);
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: -1 }).start).toBe(380);
  });

  it('ignores an anchor at or past the end of the list', () => {
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 500 }).start).toBe(380);
    expect(computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 999 }).start).toBe(380);
  });

  it('never shrinks a trailing window to chase an in-tail anchor', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 490 });
    expect(w.start).toBe(380);
    expect(w.end).toBe(500);
    expect(w.hiddenAfter).toBe(0);
  });

  it('fails closed to the default capacity when windowSize is non-positive', () => {
    const w = computeMessageWindow({ total: 500, windowSize: 0 });
    expect(w.rendered).toBe(DEFAULT_WINDOW_SIZE);
    expect(w.start).toBe(500 - DEFAULT_WINDOW_SIZE);
    expect(w.end).toBe(500);
    expect(w.hiddenAfter).toBe(0);
  });

  describe('bounded render cost at scale', () => {
    it('caps rendered rows to the window on a very large channel (no anchor)', () => {
      const total = 100_000;
      const windowSize = 120;
      const w = computeMessageWindow({ total, windowSize });
      expect(w.rendered).toBe(windowSize);
      expect(w.start).toBe(total - windowSize);
      expect(w.hiddenBefore).toBe(total - windowSize);
      expect(w.hiddenAfter).toBe(0);
      expect(w.end).toBe(total);
    });

    it('rendered never exceeds windowSize across a sweep of large totals', () => {
      const windowSize = 200;
      for (const total of [1_000, 10_000, 50_000, 250_000]) {
        const w = computeMessageWindow({ total, windowSize });
        expectConserved(w, total, windowSize);
        expect(w.rendered).toBe(windowSize);
        expect(w.end).toBe(total);
        expect(w.hiddenAfter).toBe(0);
      }
    });

    it('a deep-history anchor stays a bounded two-sided page, not a tail extension', () => {
      const total = 100_000;
      const windowSize = 120;
      const anchorIndex = 40_000;
      const w = computeMessageWindow({ total, windowSize, anchorIndex });
      expect(w.start).toBe(anchorIndex - DEFAULT_ANCHOR_CONTEXT);
      expect(w.end).toBe(anchorIndex - DEFAULT_ANCHOR_CONTEXT + windowSize);
      expect(w.rendered).toBe(windowSize);
      expect(w.hiddenBefore + w.rendered + w.hiddenAfter).toBe(total);
      expect(anchorIndex).toBeGreaterThanOrEqual(w.start);
      expect(anchorIndex).toBeLessThan(w.end);
    });

    it('keeps the rendered ceiling at 10k / 100k / 250k for start, middle, and end anchors', () => {
      const windowSize = 120;
      for (const total of [10_000, 100_000, 250_000]) {
        const anchors = [0, 3, Math.floor(total / 2), total - 1, total - 5];
        for (const anchorIndex of anchors) {
          const w = computeMessageWindow({ total, windowSize, anchorIndex });
          expectConserved(w, total, windowSize);
          expect(anchorIndex).toBeGreaterThanOrEqual(w.start);
          expect(anchorIndex).toBeLessThan(w.end);
        }
        const tail = computeMessageWindow({ total, windowSize });
        expectConserved(tail, total, windowSize);
        expect(tail.end).toBe(total);
        expect(tail.hiddenAfter).toBe(0);
      }
    });

    it('growing the window in steps stays a pure trailing slice until the ceiling', () => {
      const total = 10_000;
      let prevStart = total;
      for (let size = 120; size <= MAX_WINDOW_ROWS; size += 200) {
        const w = computeMessageWindow({ total, windowSize: size });
        expect(w.rendered).toBe(size);
        expect(w.end).toBe(total);
        expect(w.hiddenAfter).toBe(0);
        expect(w.start).toBeLessThanOrEqual(prevStart);
        expect(w.start).toBe(total - size);
        prevStart = w.start;
      }
      const clamped = computeMessageWindow({ total, windowSize: MAX_WINDOW_ROWS + 400 });
      expect(clamped.rendered).toBe(MAX_WINDOW_ROWS);
      expect(clamped.end).toBe(total);
      expect(clamped.hiddenAfter).toBe(0);
    });

    it('reader-start / explicit pageStart is a bounded first page, not the whole list', () => {
      const total = 250_000;
      const w = computeMessageWindow({ total, windowSize: 120, pageStart: 0 });
      expect(w.start).toBe(0);
      expect(w.end).toBe(120);
      expect(w.hiddenBefore).toBe(0);
      expect(w.hiddenAfter).toBe(total - 120);
      expect(w.rendered).toBe(120);
    });

    it('paging earlier from a mid-transcript page stays bounded and contiguous', () => {
      const total = 10_000;
      const first = computeMessageWindow({ total, windowSize: 120, pageStart: 4000 });
      expect(first.start).toBe(4000);
      expect(first.end).toBe(4120);
      expect(first.hiddenAfter).toBe(total - 4120);
      const earlier = computeMessageWindow({
        total,
        windowSize: 120,
        pageStart: Math.max(0, first.start - first.rendered),
      });
      expect(earlier.start).toBe(3880);
      expect(earlier.end).toBe(4000);
      expect(earlier.rendered).toBe(120);
      expect(earlier.end).toBe(first.start);
      expectConserved(earlier, total, 120);
    });

    it('a page that lands on the trailing slice snaps back to the live tail', () => {
      const w = computeMessageWindow({ total: 500, windowSize: 120, pageStart: 400 });
      expect(w.start).toBe(380);
      expect(w.end).toBe(500);
      expect(w.hiddenAfter).toBe(0);
    });

    it('Infinity never mounts a huge list even with a start page requested', () => {
      const total = 250_000;
      const w = computeMessageWindow({
        total,
        windowSize: Number.POSITIVE_INFINITY,
        pageStart: 0,
      });
      expect(w.rendered).toBe(DEFAULT_WINDOW_SIZE);
      expect(w.start).toBe(0);
      expect(w.end).toBe(DEFAULT_WINDOW_SIZE);
      expect(w.hiddenAfter).toBe(total - DEFAULT_WINDOW_SIZE);
    });
  });

  describe('tail-append vs history-prepend signal (aria-live)', () => {
    it('a new tail message keeps the window start flat once the window is full', () => {
      const windowSize = 120;
      const before = computeMessageWindow({ total: 5_000, windowSize });
      const afterTail = computeMessageWindow({ total: 5_001, windowSize });
      expect(afterTail.start).toBe(before.start + 1);
      expect(afterTail.start).toBeGreaterThanOrEqual(before.start);
      expect(afterTail.end).toBe(before.end + 1);
      expect(afterTail.hiddenAfter).toBe(0);
    });

    it('a history prepend (anchor jump) LOWERS start so the effect can suppress it', () => {
      const windowSize = 120;
      const tail = computeMessageWindow({ total: 5_000, windowSize });
      const jumped = computeMessageWindow({ total: 5_000, windowSize, anchorIndex: 100 });
      expect(jumped.start).toBeLessThan(tail.start);
      expect(jumped.end).toBeLessThan(tail.end);
      expect(jumped.hiddenAfter).toBeGreaterThan(0);
    });

    it('a tail append on an anchored page does not grow rendered or move start', () => {
      const before = computeMessageWindow({ total: 5_000, windowSize: 120, anchorIndex: 100 });
      const after = computeMessageWindow({ total: 5_001, windowSize: 120, anchorIndex: 100 });
      expect(after.start).toBe(before.start);
      expect(after.end).toBe(before.end);
      expect(after.rendered).toBe(before.rendered);
      expect(after.hiddenAfter).toBe(before.hiddenAfter + 1);
    });
  });

  describe('input hardening', () => {
    it('renders nothing when total is NaN or non-finite (fail closed)', () => {
      for (const total of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const w = computeMessageWindow({ total, windowSize: 120 });
        expect(w.start).toBe(0);
        expect(w.end).toBe(0);
        expect(w.rendered).toBe(0);
        expect(w.hiddenBefore).toBe(0);
        expect(w.hiddenAfter).toBe(0);
      }
    });

    it('never drops the anchor row when given a negative anchor context', () => {
      const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: -50 });
      expect(w.start).toBeLessThanOrEqual(200);
      expect(w.start).toBe(200);
      expect(w.end).toBe(320);
      expect(w.rendered).toBe(120);
      expect(200).toBeLessThan(w.end);
    });

    it('falls back to the default context when anchorContext is non-finite', () => {
      const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: Number.NaN });
      expect(w.start).toBe(200 - DEFAULT_ANCHOR_CONTEXT);
      expect(w.rendered).toBe(120);
    });

    it('clamps a context larger than the window so the anchor still fits', () => {
      const w = computeMessageWindow({ total: 500, windowSize: 120, anchorIndex: 200, anchorContext: 10_000 });
      expect(w.rendered).toBe(120);
      expect(200).toBeGreaterThanOrEqual(w.start);
      expect(200).toBeLessThan(w.end);
    });

    it('fails closed on negative and non-finite window sizes', () => {
      for (const windowSize of [-1, -50, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
        const w = computeMessageWindow({ total: 10_000, windowSize });
        expect(w.rendered).toBe(DEFAULT_WINDOW_SIZE);
        expect(w.end).toBe(10_000);
        expect(w.hiddenAfter).toBe(0);
      }
    });

    it('ignores a non-finite or negative pageStart and stays on the tail', () => {
      expect(computeMessageWindow({ total: 500, windowSize: 120, pageStart: -8 }).start).toBe(380);
      expect(computeMessageWindow({ total: 500, windowSize: 120, pageStart: Number.NaN }).start).toBe(380);
      expect(computeMessageWindow({ total: 500, windowSize: 120, pageStart: Number.POSITIVE_INFINITY }).start).toBe(380);
    });
  });
});

describe('selectMessageAnchorIndex', () => {
  it('prefers an active search hit over landing and unread', () => {
    expect(selectMessageAnchorIndex({
      searchIndex: 80,
      landingIndex: 20,
      unreadIndex: 40,
    })).toBe(80);
  });

  it('prefers a time-travel landing over unread when no search hit exists', () => {
    expect(selectMessageAnchorIndex({
      searchIndex: null,
      landingIndex: 20,
      unreadIndex: 40,
    })).toBe(20);
  });

  it('uses unread only while the feed is in live-tail mode', () => {
    expect(selectMessageAnchorIndex({
      searchIndex: null,
      landingIndex: null,
      unreadIndex: 40,
    })).toBe(40);
    expect(selectMessageAnchorIndex({
      searchIndex: null,
      landingIndex: null,
      unreadIndex: 40,
      pageStart: 0,
    })).toBeNull();
  });

  it('lets an explicit unread handoff win over a historical pageStart', () => {
    expect(selectMessageAnchorIndex({
      searchIndex: null,
      landingIndex: null,
      unreadIndex: 850,
      pageStart: 0,
      forceUnread: true,
    })).toBe(850);
    expect(selectMessageAnchorIndex({
      searchIndex: 12,
      landingIndex: null,
      unreadIndex: 850,
      pageStart: 0,
      forceUnread: true,
    })).toBe(12);
  });

  it('skips invalid indices and keeps the priority order', () => {
    expect(selectMessageAnchorIndex({
      searchIndex: -1,
      landingIndex: Number.NaN,
      unreadIndex: 12,
    })).toBe(12);
    expect(selectMessageAnchorIndex({
      searchIndex: Number.POSITIVE_INFINITY,
      landingIndex: 7,
      unreadIndex: 12,
    })).toBe(7);
  });
});

describe('planUnreadNavigation', () => {
  it('returns null when the unread index cannot be resolved', () => {
    expect(planUnreadNavigation({ total: 1000, unreadIndex: null })).toBeNull();
    expect(planUnreadNavigation({ total: 1000, unreadIndex: -1 })).toBeNull();
    expect(planUnreadNavigation({ total: 1000, unreadIndex: 1000 })).toBeNull();
    expect(planUnreadNavigation({ total: Number.NaN, unreadIndex: 10 })).toBeNull();
  });

  it('selects a bounded page that contains a near-tail unread outside the start page', () => {
    const planned = planUnreadNavigation({
      total: 1000,
      unreadIndex: 850,
      windowSize: DEFAULT_WINDOW_SIZE,
    });
    expect(planned).not.toBeNull();
    expect(planned!.unreadIndex).toBe(850);
    expectConserved(planned!.window, 1000, DEFAULT_WINDOW_SIZE);
    expect(planned!.window.rendered).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);
    expect(850).toBeGreaterThanOrEqual(planned!.window.start);
    expect(850).toBeLessThan(planned!.window.end);
    expect(planned!.window.start).toBeGreaterThan(0);
  });

  it('keeps a trailing unread on the live tail without exceeding capacity', () => {
    const planned = planUnreadNavigation({
      total: 1000,
      unreadIndex: 900,
      windowSize: DEFAULT_WINDOW_SIZE,
    });
    expect(planned).not.toBeNull();
    expect(planned!.window.end).toBe(1000);
    expect(planned!.window.hiddenAfter).toBe(0);
    expect(planned!.window.rendered).toBe(DEFAULT_WINDOW_SIZE);
    expect(900).toBeGreaterThanOrEqual(planned!.window.start);
    expect(900).toBeLessThan(planned!.window.end);
  });
});
