// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CalmModeControl.tsx — segmented notification preset switch for calm mode.
 *
 * Self-contained control only; integration decides where it appears.
 *
 * SOLID IDIOMS: component runs once; never destructure props; For.
 */

import { For, type JSX } from 'solid-js';
import {
  CALM_PRESETS,
  calmPreset,
  setCalmPreset,
  type CalmPreset,
} from '@/lib/notifications/calmMode';
import './CalmModeControl.css';

const CALM_PRESET_LABELS: Record<CalmPreset, string> = {
  calm: 'Calm',
  regular: 'Regular',
  power: 'Power',
};

const CALM_PRESET_DESCRIPTIONS: Record<CalmPreset, string> = {
  calm: 'Only mentions & DMs reach you',
  regular: 'Follows & mentions notify; the rest waits',
  power: 'Notify me about everything',
};

export interface CalmModeControlProps {
  class?: string;
}

export function CalmModeControl(props: CalmModeControlProps = {}): JSX.Element {
  const className = (): string => (props.class ? `calm-control ${props.class}` : 'calm-control');

  // Roving-tabindex radio group (WCAG SC 2.1.1): the group is a single tab stop —
  // only the selected radio carries tabindex=0 — and Arrow keys move both selection
  // and DOM focus per the ARIA radio-group pattern (selection follows focus). Refs let
  // the key handler focus the newly-selected radio.
  const buttons: (HTMLButtonElement | undefined)[] = [];

  function selectAt(index: number): void {
    const option = CALM_PRESETS[index];
    if (option === undefined) return;
    setCalmPreset(option);
    buttons[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const count = CALM_PRESETS.length;
    if (count === 0) return;
    const current = CALM_PRESETS.indexOf(calmPreset());
    const from = current < 0 ? 0 : current;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAt((from + 1) % count);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAt((from - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        break;
      case 'End':
        event.preventDefault();
        selectAt(count - 1);
        break;
    }
  }

  return (
    <section class={className()} aria-labelledby="calm-mode-title">
      <h3 id="calm-mode-title" class="calm-label">Notification mode</h3>
      <div
        class="calm-segments"
        role="radiogroup"
        aria-labelledby="calm-mode-title"
        onKeyDown={onKeyDown}
      >
        <For each={CALM_PRESETS}>
          {(option, index) => {
            const active = (): boolean => calmPreset() === option;
            const labelId = `calm-mode-${option}-label`;
            const descriptionId = `calm-mode-${option}-description`;

            return (
              <button
                ref={(el) => (buttons[index()] = el)}
                type="button"
                class="calm-segment"
                role="radio"
                aria-checked={active()}
                tabindex={active() ? 0 : -1}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onClick={() => setCalmPreset(option)}
              >
                <span id={labelId} class="calm-segment-label">{CALM_PRESET_LABELS[option]}</span>
                <span id={descriptionId} class="calm-segment-desc">{CALM_PRESET_DESCRIPTIONS[option]}</span>
              </button>
            );
          }}
        </For>
      </div>
    </section>
  );
}
