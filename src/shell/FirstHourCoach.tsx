// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * FirstHourCoach — one quiet, dismissible tip. Never a modal slideshow.
 */
import './first-hour-coach.css';
import { createMemo, Show, type JSX } from 'solid-js';
import type { FirstHourCoachTip } from '@/lib/firstHour/firstHour';

export type FirstHourCoachProps = {
  tip?: FirstHourCoachTip | null;
  onDismiss: () => void;
  placement?: 'home' | 'composer';
};

export function FirstHourCoach(props: FirstHourCoachProps): JSX.Element {
  const tip = createMemo(() => {
    const next = props.tip;
    return next && next.text.trim() && (next.id === 'home-next' || next.id === 'room-say-hi') ? next : null;
  });

  return (
    <Show when={tip()}>
      {(current) => (
        <div
          class={`first-hour-coach${props.placement === 'composer' ? ' first-hour-coach--composer' : ''}`}
          role="note"
          aria-label="A quick start tip"
          data-testid="first-hour-coach"
          data-tip={current().id}
        >
          <span class="first-hour-coach__eyebrow">Quick start</span>
          <p class="first-hour-coach__text" id="first-hour-coach-copy">{current().text}</p>
          <button
            type="button"
            class="first-hour-coach__dismiss"
            aria-label="Dismiss quick start tip"
            aria-describedby="first-hour-coach-copy"
            data-testid="first-hour-coach-dismiss"
            onClick={() => props.onDismiss()}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </Show>
  );
}
