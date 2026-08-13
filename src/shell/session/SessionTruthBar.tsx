// SPDX-License-Identifier: AGPL-3.0-or-later
import './session-truth-bar.css';

import { For, createMemo, createUniqueId, type JSX } from 'solid-js';

import {
  projectSessionTruth,
  type SessionTruthInput,
} from './sessionTruth';

export type SessionTruthBarProps = {
  readonly input: SessionTruthInput;
  readonly label?: string;
};

/** Passive, store-free rendering of independently sourced session facts. */
export function SessionTruthBar(props: SessionTruthBarProps): JSX.Element {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const projection = createMemo(() => projectSessionTruth(props.input));

  return (
    <section
      class="session-truth-bar"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-live="polite"
      aria-atomic="false"
      data-testid="session-truth-bar"
    >
      <header class="session-truth-bar__header">
        <p class="session-truth-bar__kicker" aria-hidden="true">Independent status</p>
        <h2 id={titleId}>{props.label ?? 'Session truth'}</h2>
        <p id={descriptionId} class="session-truth-bar__description">
          Connection, identity, message, and call states are reported separately.
        </p>
      </header>

      <ul class="session-truth-bar__facts">
        <For each={projection().facts}>
          {(entry) => (
            <li
              class="session-truth-bar__fact"
              data-dimension={entry.id}
              data-group={entry.group}
              data-tone={entry.tone}
            >
              <span class="session-truth-bar__marker" aria-hidden="true" />
              <span class="session-truth-bar__label">{entry.label}</span>
              <strong class="session-truth-bar__value">{entry.value}</strong>
              <span class="session-truth-bar__detail">{entry.detail}</span>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
