// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MarkAllCaughtUp — a one-tap "clear my whole backlog" affordance for the Home
 * catch-up surface.
 *
 * The catch-up list tells you WHERE you have unread activity; this button lets
 * you dismiss ALL of it at once when you don't want to read it — advancing
 * read-state through the store's existing per-target `markRead` action (which
 * also syncs the IRCv3 read marker to the server so sibling sessions agree).
 *
 * Which rooms get advanced + the totals come from the pure {@link planCatchUpAll};
 * this component only wires the store to the render and drives `markRead`. It
 * clears the FULL unread backlog (a superset of any capped catch-up list) and
 * self-hides once nothing is unread, so it is safe to mount unconditionally.
 * When the button vanishes on success, focus moves to the live status line so a
 * keyboard user is not dropped to <body> (WCAG 2.4.3).
 *
 * SOLID IDIOMS: never destructure props; splitProps; derived state in
 * createMemo; Show; the body runs once and reactivity lives in the graph. Store
 * reads go through useStore (reactive); the click handler reads `markRead` via
 * getState() (a non-reactive snapshot — correct for an event handler).
 */

import './mark-all-caught-up.css';

import { createMemo, createSignal, Show, splitProps, type JSX } from 'solid-js';

import { getState, useStore } from '@/lib/store';
import {
  caughtUpAnnounce,
  planCatchUpAll,
  type CaughtUpPlan,
} from '@/lib/catchup/markCaughtUp';

export type MarkAllCaughtUpProps = {
  /** Fired after read-state is advanced, with the plan that was applied. */
  onCaughtUp?: (plan: CaughtUpPlan) => void;
};

export function MarkAllCaughtUp(props: MarkAllCaughtUpProps): JSX.Element {
  const [local] = splitProps(props, ['onCaughtUp']);

  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);

  const plan = createMemo<CaughtUpPlan>(() =>
    planCatchUpAll(channels().values(), dms().values()),
  );

  // The last completed action's announce text, surfaced in an aria-live region
  // so assistive tech confirms the backlog was cleared even though the button
  // itself vanishes on success.
  const [announced, setAnnounced] = createSignal('');
  let statusEl!: HTMLParagraphElement;

  const handleCaughtUp = (): void => {
    const current = plan();
    if (current.rooms === 0) return;
    const { markRead } = getState();
    // Advance read-state one target at a time through the existing store action;
    // each is an immutable set() + read-marker sync. Capture the plan BEFORE the
    // loop: markRead mutates the store, which recomputes plan() to fewer rooms,
    // so we must iterate the pre-mutation snapshot to visit every target.
    for (const t of current.targets) markRead(t.target);
    setAnnounced(caughtUpAnnounce(current));
    // The button just unmounted (<Show> flipped false); park focus on the
    // status line so a keyboard user keeps their place rather than falling to
    // <body>.
    statusEl.focus();
    local.onCaughtUp?.(current);
  };

  return (
    <div class="mark-caught-up">
      <Show when={plan().rooms > 0}>
        <button
          type="button"
          class="mark-caught-up__button"
          onClick={handleCaughtUp}
          aria-label={`Mark all caught up — clears ${plan().unread} unread across ${plan().rooms} ${
            plan().rooms === 1 ? 'room' : 'rooms'
          }`}
        >
          <span class="mark-caught-up__label">Mark all caught up</span>
          <span class="mark-caught-up__count" aria-hidden="true">
            {plan().rooms}
          </span>
        </button>
      </Show>
      <p
        ref={statusEl}
        class="mark-caught-up__status"
        role="status"
        aria-live="polite"
        tabindex={-1}
      >
        {announced()}
      </p>
    </div>
  );
}
