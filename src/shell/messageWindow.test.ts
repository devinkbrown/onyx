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
});
