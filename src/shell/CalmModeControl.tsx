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

  return (
    <section class={className()}>
      <h3 class="calm-label">Notification mode</h3>
      <div class="calm-segments" role="radiogroup" aria-label="Notification mode">
        <For each={CALM_PRESETS}>
          {(option) => {
            const active = (): boolean => calmPreset() === option;

            return (
              <button
                type="button"
                class="calm-segment"
                role="radio"
                aria-checked={active()}
                onClick={() => setCalmPreset(option)}
              >
                <span class="calm-segment-label">{CALM_PRESET_LABELS[option]}</span>
                <span class="calm-segment-desc">{CALM_PRESET_DESCRIPTIONS[option]}</span>
              </button>
            );
          }}
        </For>
      </div>
    </section>
  );
}
