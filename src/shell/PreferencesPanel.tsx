/**
 * PreferencesPanel.tsx — display & behaviour settings, surfaced as a right-hand Sheet.
 *
 * Covers the settings that don't belong in Appearance / Account / Voice / Notifications:
 * message density, font scale, hide join/part/quit events, conversation width, and a
 * force "reduce motion" switch. Every change is written straight to <html> as a data-*
 * attribute (see preferences.ts) and styled by preferences.css — the message components
 * are never touched.
 *
 * SOLID IDIOMS: component runs once; never destructure props; For/Show; createMemo.
 */

import { For, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import '@/lib/prefs/preferences.css';
import {
  DENSITIES,
  FONT_SCALES,
  WIDTHS,
  closePreferences,
  isPreferencesOpen,
  openPreferences,
  preferences,
  resetPreferences,
  setPreference,
  type Density,
  type FontScale,
  type Width,
} from '@/lib/prefs/preferences';

const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', cozy: 'Cozy', roomy: 'Roomy' };
const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const WIDTH_LABELS: Record<Width, string> = { measured: 'Measured', full: 'Full-width' };

type SegmentedProps<T extends string> = {
  legend: string;
  description: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: () => T;
  onSelect: (value: T) => void;
};

function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <section class="pref-group">
      <div class="pref-group-head">
        <h3 class="pref-label">{props.legend}</h3>
      </div>
      <p class="pref-desc">{props.description}</p>
      <div class="pref-segments" role="radiogroup" aria-label={props.legend}>
        <For each={props.options}>
          {(option) => {
            const active = () => props.value() === option;
            return (
              <button
                type="button"
                class="pref-segment"
                role="radio"
                aria-checked={active()}
                aria-pressed={active()}
                onClick={() => props.onSelect(option)}
              >
                {props.labels[option]}
              </button>
            );
          }}
        </For>
      </div>
    </section>
  );
}

type ToggleProps = {
  legend: string;
  title: string;
  description: string;
  value: () => boolean;
  onToggle: (value: boolean) => void;
};

function Toggle(props: ToggleProps): JSX.Element {
  return (
    <section class="pref-group">
      <h3 class="pref-label">{props.legend}</h3>
      <button
        type="button"
        class="pref-toggle"
        role="switch"
        aria-checked={props.value()}
        aria-pressed={props.value()}
        onClick={() => props.onToggle(!props.value())}
      >
        <span class="pref-toggle-text">
          <span class="pref-toggle-title">{props.title}</span>
          <span class="pref-desc">{props.description}</span>
        </span>
        <span class="pref-switch" aria-hidden="true" />
      </button>
    </section>
  );
}

export function PreferencesPanel(): JSX.Element {
  return (
    <Sheet
      open={isPreferencesOpen()}
      title="Preferences"
      description="Display & behaviour — applied live."
      onOpenChange={(next) => (next ? openPreferences() : closePreferences())}
      closeLabel="Close preferences"
    >
      <div class="pref-panel" data-testid="preferences-panel">
        <Segmented
          legend="Message density"
          description="Vertical rhythm of the message feed."
          options={DENSITIES}
          labels={DENSITY_LABELS}
          value={() => preferences().density}
          onSelect={(value) => setPreference('density', value)}
        />

        <Segmented
          legend="Font scale"
          description="Base size for the interface text."
          options={FONT_SCALES}
          labels={FONT_SCALE_LABELS}
          value={() => preferences().fontScale}
          onSelect={(value) => setPreference('fontScale', value)}
        />

        <Segmented
          legend="Conversation width"
          description="Cap the reading measure, or let the feed run edge-to-edge."
          options={WIDTHS}
          labels={WIDTH_LABELS}
          value={() => preferences().width}
          onSelect={(value) => setPreference('width', value)}
        />

        <Toggle
          legend="System events"
          title="Hide join, part & quit"
          description="Removes the quiet system lines from the feed."
          value={() => preferences().hideEvents}
          onToggle={(value) => setPreference('hideEvents', value)}
        />

        <Toggle
          legend="Link previews"
          title="Preview web links"
          description="Unfurl the first link in a message into a title-and-image card (fetched via this server, never your browser)."
          value={() => preferences().linkPreviews}
          onToggle={(value) => setPreference('linkPreviews', value)}
        />

        <Toggle
          legend="Motion"
          title="Reduce motion"
          description="Force-disable animations regardless of your OS setting."
          value={() => preferences().reduceMotion}
          onToggle={(value) => setPreference('reduceMotion', value)}
        />

        <button type="button" class="pref-reset" onClick={() => resetPreferences()}>
          Reset to defaults
        </button>
      </div>
    </Sheet>
  );
}
