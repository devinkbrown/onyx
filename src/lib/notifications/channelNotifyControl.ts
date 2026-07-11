// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * channelNotifyControl.ts — pure presentation + keyboard model for the
 * per-channel notification-level segmented control.
 *
 * The store owns the state (`channelNotify` map, mutated only through the
 * existing `setChannelNotifyMode` action). This module holds only the pure,
 * DOM-free bits the control needs so they are exhaustively unit-testable and
 * counted under the `src/lib/**` coverage floor: the ordered option table, the
 * mode → segment-index lookup, and the roving-radiogroup arrow-key navigation
 * (WCAG SC 2.1.1 — the group is one tab stop and Arrow/Home/End move both
 * selection and focus, per the ARIA radio-group pattern).
 *
 * All functions are total and side-effect-free.
 */

import type { NotifyMode } from './channelNotifyMode';

/** A single segment in the control, in display order. */
export interface ChannelNotifyOption {
  /** The public notification mode this segment selects. */
  readonly mode: NotifyMode;
  /** Compact label shown inside the ribbon segment. */
  readonly label: string;
  /** Full accessible name (screen-reader label for the radio). */
  readonly title: string;
}

/**
 * Ordered segment table. Order is load-bearing: it defines the visual left→right
 * order AND the Arrow-key traversal order, and each index maps 1:1 to a mode.
 */
export const CHANNEL_NOTIFY_OPTIONS: readonly ChannelNotifyOption[] = [
  { mode: 'all', label: 'All', title: 'All messages' },
  { mode: 'mentions', label: '@', title: 'Mentions only' },
  { mode: 'mute', label: 'Mute', title: 'Mute' },
];

/**
 * Segment index for a mode. Defaults to 0 (the `'all'` segment) for any value
 * outside the table, so a caller never focuses a nonexistent radio.
 */
export function channelNotifyIndex(mode: NotifyMode): number {
  const index = CHANNEL_NOTIFY_OPTIONS.findIndex((option) => option.mode === mode);
  return index < 0 ? 0 : index;
}

/**
 * Roving-radiogroup keyboard navigation. Given the currently-selected segment
 * index and a `KeyboardEvent.key`, return the index that should become selected
 * (selection follows focus), or `null` when the key is not a navigation key and
 * the event should be ignored.
 *
 *   - ArrowRight / ArrowDown → next (wraps to first past the end)
 *   - ArrowLeft  / ArrowUp   → previous (wraps to last before the start)
 *   - Home                   → first
 *   - End                    → last
 *
 * An out-of-range `current` is treated as the first segment so navigation is
 * always well-defined.
 */
export function nextChannelNotifyIndex(current: number, key: string): number | null {
  const count = CHANNEL_NOTIFY_OPTIONS.length;
  const from = current < 0 || current >= count ? 0 : current;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (from + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (from - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
