// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * messageWindow.ts — pure windowing math for the message log.
 *
 * The feed renders only a trailing slice of the full (sorted) message list so a
 * large channel does not build thousands of DOM subtrees at once. This module is
 * intentionally pure and side-effect free so the boundary math is unit-testable
 * in isolation from SolidJS/DOM.
 *
 * Model: we ALWAYS render to the tail (end === total) so the newest lines and
 * autoscroll behave exactly as before. `windowSize` is the *minimum* number of
 * trailing rows to keep live; an optional `anchorIndex` (an unread divider, a
 * time-travel landing, or a search hit that must be reachable in the DOM) can
 * extend the window downward so that row — plus a little context above it — is
 * always rendered. Set `windowSize` to Infinity for an explicit "show all".
 */

/** Rows kept above an anchor so it does not land flush against the window top. */
export const DEFAULT_ANCHOR_CONTEXT = 12;

export interface MessageWindowInput {
  /** Length of the full, already-sorted message list. */
  total: number;
  /** Minimum trailing rows to render. Use Infinity to render everything. */
  windowSize: number;
  /**
   * Index (into the full list) of a row that MUST be present in the DOM —
   * unread divider, time-travel landing, or active search hit. When it falls
   * above the trailing window the window is extended down to include it.
   */
  anchorIndex?: number | null;
  /** Context rows to keep above the anchor. Defaults to DEFAULT_ANCHOR_CONTEXT. */
  anchorContext?: number;
}

export interface MessageWindow {
  /** Inclusive index of the first rendered row. */
  start: number;
  /** Exclusive end index — always equals `total` (we render to the tail). */
  end: number;
  /** Count of older rows hidden above the window (drives the "earlier" affordance). */
  hiddenBefore: number;
  /** Number of rows actually rendered. */
  rendered: number;
}

export function computeMessageWindow(input: MessageWindowInput): MessageWindow {
  // Fail closed on a non-finite length (NaN/Infinity): render nothing rather
  // than propagate NaN through the boundary math into `slice()`.
  const total = Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0;
  // A finite non-negative window, or Infinity for explicit show-all. Anything
  // else (negative / NaN) collapses to the tail-safe minimum.
  const windowSize = input.windowSize >= 0 ? input.windowSize : 0;
  // Context must never be negative: a negative context would push `desired`
  // ABOVE the anchor, so the anchor row could fall outside the window — the one
  // thing the anchor path exists to prevent. Clamp to keep the invariant below.
  const rawContext = input.anchorContext ?? DEFAULT_ANCHOR_CONTEXT;
  const anchorContext = Number.isFinite(rawContext) ? Math.max(0, rawContext) : DEFAULT_ANCHOR_CONTEXT;

  // Base trailing window.
  let start = total <= windowSize ? 0 : total - windowSize;

  // Extend downward to keep a required anchor row (and some context) rendered.
  // Invariant: after this block, when the anchor is in range, start <= anchorIndex
  // so the anchor row is always present in the [start, total) slice.
  const anchorIndex = input.anchorIndex;
  if (anchorIndex != null && anchorIndex >= 0 && anchorIndex < total) {
    const desired = Math.max(0, anchorIndex - anchorContext);
    if (desired < start) start = desired;
  }

  // Clamp defensively.
  if (start < 0) start = 0;
  if (start > total) start = total;

  return {
    start,
    end: total,
    hiddenBefore: start,
    rendered: total - start,
  };
}
