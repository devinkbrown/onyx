// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeMarkCaughtUp — presentation-only "mark all caught up" control.
 *
 * Plan and activation live in createHomeController. This tree never reads
 * Zustand, IndexedDB, network, clocks, or security state.
 */
import '../mark-all-caught-up.css';

import { createSignal, Show, type JSX } from 'solid-js';

import { caughtUpAnnounce, type CaughtUpPlan } from '@/lib/catchup/markCaughtUp';

export type HomeMarkCaughtUpProps = {
  plan: () => CaughtUpPlan;
  onMarkCaughtUp: () => void;
};

export function HomeMarkCaughtUp(props: HomeMarkCaughtUpProps): JSX.Element {
  const [announced, setAnnounced] = createSignal('');
  let statusEl!: HTMLParagraphElement;

  const handleCaughtUp = (): void => {
    const current = props.plan();
    if (current.rooms === 0) return;
    props.onMarkCaughtUp();
    setAnnounced(caughtUpAnnounce(current));
    statusEl.focus();
  };

  return (
    <div class="mark-caught-up">
      <Show when={props.plan().rooms > 0}>
        <button
          type="button"
          class="mark-caught-up__button"
          onClick={handleCaughtUp}
          aria-label={`Mark all caught up — clears ${props.plan().unread} unread across ${props.plan().rooms} ${
            props.plan().rooms === 1 ? 'room' : 'rooms'
          }`}
        >
          <span class="mark-caught-up__label">Mark all caught up</span>
          <span class="mark-caught-up__count" aria-hidden="true">
            {props.plan().rooms}
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
