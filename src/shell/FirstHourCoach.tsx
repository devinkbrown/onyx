// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * FirstHourCoach — one quiet, dismissible tip. Never a modal slideshow.
 */
import './first-hour-coach.css';
import type { JSX } from 'solid-js';
import type { FirstHourCoachTip } from '@/lib/firstHour/firstHour';

export type FirstHourCoachProps = {
  tip: FirstHourCoachTip;
  onDismiss: () => void;
  placement?: 'home' | 'composer';
};

export function FirstHourCoach(props: FirstHourCoachProps): JSX.Element {
  return (
    <div
      class={`first-hour-coach${props.placement === 'composer' ? ' first-hour-coach--composer' : ''}`}
      role="status"
      data-testid="first-hour-coach"
      data-tip={props.tip.id}
    >
      <p class="first-hour-coach__text">{props.tip.text}</p>
      <button
        type="button"
        class="first-hour-coach__dismiss"
        aria-label="Dismiss tip"
        data-testid="first-hour-coach-dismiss"
        onClick={() => props.onDismiss()}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
