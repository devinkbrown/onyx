// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * messageWindow.ts — pure windowing math for the message log.
 *
 * The feed renders only a bounded contiguous slice of the full (sorted)
 * transcript so a large channel cannot build tens of thousands of DOM
 * subtrees. This module is intentionally pure and side-effect free so the
 * boundary math is unit-testable in isolation from SolidJS/DOM.
 *
 * Semantic shift (historical navigation is now genuinely bounded):
 *   Old model always rendered through the tail (`end === total`). A deep
 *   unread / search / time-travel anchor only moved `start` up, so a
 *   100,000-row transcript with an anchor at 40,000 mounted ~60k rows.
 *   `windowSize = Infinity` was a public "show all" escape hatch.
 *
 *   New model always returns a contiguous `[start, end)` whose `rendered`
 *   count is at most the normalized finite capacity. No-anchor stays a
 *   trailing slice ending at `total`. An anchor that sits outside that
 *   trailing slice (or outside an explicit historical page) switches to a
 *   two-sided page around the anchor: `DEFAULT_ANCHOR_CONTEXT` rows above
 *   when possible, remaining capacity below, clamped at both edges.
 *   `hiddenAfter` is truthful for any page that is not on the live tail.
 *
 * There is no public Infinity / show-all path. Malformed, negative, or
 * non-finite window sizes fail closed to `DEFAULT_WINDOW_SIZE`. Finite
 * sizes are clamped to `MAX_WINDOW_ROWS`.
 */

/** Rows kept above an anchor so it does not land flush against the window top. */
export const DEFAULT_ANCHOR_CONTEXT = 12;

/** Safe default (and fail-closed) render capacity. Matches the feed's base page. */
export const DEFAULT_WINDOW_SIZE = 120;

/**
 * Hard ceiling on rendered rows. Limited tail growth ("earlier" while still
 * pinned to the live tail) may raise capacity up to this value; it must never
 * be exceeded, and paging must be used instead of growing past it.
 */
export const MAX_WINDOW_ROWS = 720;

export interface MessageWindowInput {
  /** Length of the full, already-sorted message list. */
  total: number;
  /**
   * Requested render capacity. Non-finite / negative / zero values fail
   * closed to DEFAULT_WINDOW_SIZE. Finite values are floored and clamped
   * to MAX_WINDOW_ROWS.
   */
  windowSize: number;
  /**
   * Index (into the full list) of a single row that MUST be present in the
   * DOM — unread divider, time-travel landing, or active search hit. When
   * it falls outside the trailing slice (or the explicit page) the window
   * becomes a two-sided bounded page around that row. Callers that have
   * several candidate ids must pick one deterministically via
   * {@link selectMessageAnchorIndex}; this function never unions ranges.
   */
  anchorIndex?: number | null;
  /** Context rows to keep above the anchor. Defaults to DEFAULT_ANCHOR_CONTEXT. */
  anchorContext?: number;
  /**
   * Explicit historical page origin (Reader Start / "earlier" paging).
   * Ignored when a valid anchor falls outside the page it would produce —
   * the anchor always wins so search / time-travel stay reachable.
   * A page that lands on or past the trailing start snaps to the tail.
   */
  pageStart?: number | null;
}

export interface MessageWindow {
  /** Inclusive index of the first rendered row. */
  start: number;
  /** Exclusive end index of the rendered slice. */
  end: number;
  /** Count of older rows hidden above the window (drives the "earlier" affordance). */
  hiddenBefore: number;
  /** Count of newer rows hidden below the window. Zero on the live tail. */
  hiddenAfter: number;
  /** Number of rows actually rendered. Never exceeds the normalized capacity. */
  rendered: number;
}

export interface MessageAnchorSelection {
  /** Index of the active in-buffer search hit, if any. */
  searchIndex?: number | null;
  /** Index of the time-travel / focusMessage landing, if any. */
  landingIndex?: number | null;
  /** Index of the unread-divider boundary, if any. */
  unreadIndex?: number | null;
  /**
   * Explicit historical page origin. When this is a finite number, unread
   * is not selected — otherwise Reader Start / earlier paging would be
   * stolen by a catch-up divider that happens to sit elsewhere.
   */
  pageStart?: number | null;
  /**
   * One-shot explicit unread navigation (Reader New / Review). When true,
   * a valid unread index wins over `pageStart` so a historical page can
   * be replaced by a bounded page around the divider. Search and
   * time-travel still take priority.
   */
  forceUnread?: boolean;
}

/**
 * Pick a single transcript anchor.
 *
 * Policy (first present wins; never union disjoint ids into one range):
 *   1. Active search result — the user just chose this hit.
 *   2. Time-travel landing — vault / `?at=` / focusMessage navigation.
 *   3. Unread divider — while the feed is in live-tail mode (`pageStart`
 *      is null / non-finite), or when `forceUnread` is set for an explicit
 *      New / Review handoff. A historical page must not be overridden by a
 *      *passive* catch-up boundary.
 *
 * Invalid (negative / non-finite) indices are skipped.
 */
export function selectMessageAnchorIndex(input: MessageAnchorSelection): number | null {
  if (isValidIndex(input.searchIndex)) return Math.floor(input.searchIndex);
  if (isValidIndex(input.landingIndex)) return Math.floor(input.landingIndex);
  if (isValidIndex(input.unreadIndex) && (input.forceUnread || !isFinitePageStart(input.pageStart))) {
    return Math.floor(input.unreadIndex);
  }
  return null;
}

/**
 * Resolve an explicit unread handoff before any review clear.
 *
 * Returns a bounded page that contains `unreadIndex`, or null when the
 * index cannot be placed inside the finite render ceiling.
 */
export function planUnreadNavigation(input: {
  total: number;
  unreadIndex: number | null | undefined;
  windowSize?: number;
}): { unreadIndex: number; window: MessageWindow } | null {
  const total = Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0;
  if (!isValidIndex(input.unreadIndex) || input.unreadIndex >= total) return null;
  const unreadIndex = Math.floor(input.unreadIndex);
  const window = computeMessageWindow({
    total,
    windowSize: input.windowSize ?? DEFAULT_WINDOW_SIZE,
    anchorIndex: unreadIndex,
    pageStart: null,
  });
  if (unreadIndex < window.start || unreadIndex >= window.end) return null;
  if (window.rendered > MAX_WINDOW_ROWS) return null;
  return { unreadIndex, window };
}

export function computeMessageWindow(input: MessageWindowInput): MessageWindow {
  // Fail closed on a non-finite length (NaN/Infinity): render nothing rather
  // than propagate NaN through the boundary math into `slice()`.
  const total = Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0;
  const capacity = normalizeCapacity(input.windowSize);
  const rawContext = input.anchorContext ?? DEFAULT_ANCHOR_CONTEXT;
  // Context must never be negative (that would push start above the anchor)
  // and must leave at least one slot for the anchor row itself.
  const maxContext = Math.max(0, capacity - 1);
  const anchorContext = Number.isFinite(rawContext)
    ? Math.min(maxContext, Math.max(0, Math.floor(rawContext)))
    : Math.min(maxContext, DEFAULT_ANCHOR_CONTEXT);

  if (total === 0) return emptyWindow();

  const trailingStart = total <= capacity ? 0 : total - capacity;
  const trailing = slice(trailingStart, total, total, capacity);

  const pageOrigin = isFinitePageStart(input.pageStart) ? Math.floor(input.pageStart) : null;
  const paged = pageOrigin != null ? pageSlice(pageOrigin, total, capacity, trailingStart) : trailing;
  const base = paged;

  const rawAnchor = input.anchorIndex;
  const validAnchor = isValidIndex(rawAnchor) && rawAnchor < total ? Math.floor(rawAnchor) : null;

  const chosen = validAnchor != null && (validAnchor < base.start || validAnchor >= base.end)
    ? twoSidedSlice(validAnchor, anchorContext, total, capacity)
    : base;

  return toWindow(chosen, total);
}

function emptyWindow(): MessageWindow {
  return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0, rendered: 0 };
}

function toWindow(range: { start: number; end: number }, total: number): MessageWindow {
  return {
    start: range.start,
    end: range.end,
    hiddenBefore: range.start,
    hiddenAfter: total - range.end,
    rendered: range.end - range.start,
  };
}

function normalizeCapacity(windowSize: number): number {
  if (!Number.isFinite(windowSize) || windowSize < 1) return DEFAULT_WINDOW_SIZE;
  return Math.min(MAX_WINDOW_ROWS, Math.floor(windowSize));
}

function isValidIndex(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function isFinitePageStart(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function slice(start: number, end: number, total: number, capacity: number): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, total));
  let e = Math.max(s, Math.min(end, total));
  if (e - s > capacity) e = s + capacity;
  if (e - s < capacity) {
    if (s === 0) e = Math.min(total, capacity);
    else if (e === total) s = Math.max(0, e - capacity);
    else e = Math.min(total, s + capacity);
  }
  return { start: s, end: e };
}

function pageSlice(
  pageStart: number,
  total: number,
  capacity: number,
  trailingStart: number,
): { start: number; end: number } {
  if (pageStart >= trailingStart) return { start: trailingStart, end: total };
  return slice(pageStart, pageStart + capacity, total, capacity);
}

function twoSidedSlice(
  anchorIndex: number,
  anchorContext: number,
  total: number,
  capacity: number,
): { start: number; end: number } {
  const desiredStart = Math.max(0, anchorIndex - anchorContext);
  const ranged = slice(desiredStart, desiredStart + capacity, total, capacity);
  if (anchorIndex >= ranged.start && anchorIndex < ranged.end) return ranged;
  // Edge clamp must still contain the anchor. Prefer keeping context above
  // when there is room; otherwise pin the anchor inside a tail-aligned page.
  if (anchorIndex < ranged.start) {
    return slice(anchorIndex, anchorIndex + capacity, total, capacity);
  }
  const end = Math.min(total, anchorIndex + 1);
  return slice(Math.max(0, end - capacity), end, total, capacity);
}
