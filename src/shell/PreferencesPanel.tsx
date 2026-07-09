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
import { clearVault } from '@/lib/vault/historyVault';
import { CalmModeControl } from './CalmModeControl';
import {
  SCENE_MOTIONS,
  sceneMotion,
  setSceneMotion,
  type SceneMotion,
} from '@/lib/prefs/sceneMotion';
import '@/lib/prefs/preferences.css';
import { CLOCKS,
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

const CLOCK_LABELS = { '24h': '24-hour', '12h': '12-hour' } as const;
const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', cozy: 'Cozy', roomy: 'Roomy' };
const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const WIDTH_LABELS: Record<Width, string> = { measured: 'Measured', full: 'Full-width' };
const SCENE_MOTION_LABELS: Record<SceneMotion, string> = {
  animated: 'Animated',
  still: 'Still',
  off: 'Off',
};

const ACCESS_AUDIT_ROWS = [
  {
    surface: 'Connect',
    status: 'checked',
    note: 'Keyboard form flow, labels, status messaging.',
  },
  {
    surface: 'Shell',
    status: 'checked',
    note: 'Landmarks, live log, focusable message actions.',
  },
  {
    surface: 'Composer',
    status: 'checked',
    note: 'Keyboard send/edit paths and visible focus.',
  },
  {
    surface: 'Channel settings',
    status: 'checked',
    note: 'Labelled Sheet, topic form, switch-mode flags, read-only non-op fallbacks.',
  },
  {
    surface: 'Voice controls',
    status: 'checked',
    note: 'Toolbar groups, labelled icon buttons, aria-pressed media states, live timer.',
  },
  {
    surface: 'Appearance',
    status: 'checked',
    note: 'Theme and background radio groups, labelled swatches, Sheet focus trap.',
  },
  {
    surface: 'Home catch-up',
    status: 'checked',
    note: 'Catch-up recaps, reviewed ranges, and channel directory cards expose list semantics and labelled actions.',
  },
  {
    surface: 'Message search',
    status: 'checked',
    note: 'Search landmark, labelled result navigation, and named archived/device-memory result lists.',
  },
  {
    surface: 'Notification center',
    status: 'checked',
    note: 'Named inbox dialog, labelled notification list, and row-specific open/dismiss actions.',
  },
  {
    surface: 'Channel browser',
    status: 'checked',
    note: 'Sheet dialog, named directory search, labelled public-channel list, and target-specific Join/Open actions.',
  },
  {
    surface: 'Account panel',
    status: 'checked',
    note: 'Named account-management regions, alert/status feedback, and target-specific persona actions.',
  },
  {
    surface: 'Channel sidebar',
    status: 'checked',
    note: 'Complementary navigation landmark, roving channel/DM rows, unread/mention names, and target-specific join action.',
  },
  {
    surface: 'Keyboard shortcuts',
    status: 'checked',
    note: 'Named shortcuts dialog, labelled close action, and grouped shortcut lists generated from live keymap descriptors.',
  },
  {
    surface: 'Pinned messages',
    status: 'checked',
    note: 'Named pins dialog, channel-specific pins list, target-specific jump buttons, and real unpin controls.',
  },
  {
    surface: 'Theme import',
    status: 'checked',
    note: 'Named import/share dialog, described theme-code input, target-specific import and copy actions, and invalid-code feedback.',
  },
  {
    surface: 'Thread panel',
    status: 'checked',
    note: 'Named thread Sheet, labelled parent/reply articles, and reply log scoped to the source message.',
  },
  {
    surface: 'Voice settings',
    status: 'checked',
    note: 'Named settings Sheet, labelled device/processing/PTT regions, described selects, and target-specific PTT key actions.',
  },
  {
    surface: 'Call overlays',
    status: 'checked',
    note: 'Named incoming/outgoing call dialogs with target-specific accept, decline, and cancel actions.',
  },
  {
    surface: 'Modals',
    status: 'checked',
    note: 'Sheet focus trap, Escape close, labelled close buttons.',
  },
] as const;

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

function AccessibilityAuditLedger(): JSX.Element {
  return (
    <section class="pref-group pref-a11y-ledger" aria-labelledby="pref-a11y-ledger-title">
      <div class="pref-group-head">
        <h3 id="pref-a11y-ledger-title" class="pref-label">Client access audit</h3>
        <a class="pref-a11y-link" href="/accessibility/">Public ledger</a>
      </div>
      <p class="pref-desc">
        WCAG 2.2 AA / EN 301 549 tracking for the dense app surfaces.
      </p>
      <div class="pref-a11y-rows" role="list">
        <For each={ACCESS_AUDIT_ROWS}>
          {(row) => (
            <div class="pref-a11y-row" role="listitem" data-status={row.status}>
              <span class="pref-a11y-status">{row.status}</span>
              <span class="pref-a11y-main">
                <span class="pref-a11y-surface">{row.surface}</span>
                <span class="pref-desc">{row.note}</span>
              </span>
            </div>
          )}
        </For>
      </div>
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
          legend="Reader mode"
          title="Read as a transcript"
          description="A calm, typographic single-column layout — quiet chrome, the words lead."
          value={() => preferences().readerMode}
          onToggle={(value) => setPreference('readerMode', value)}
        />

        <Segmented
          legend="Clock"
          description="Timestamp format for messages and channel activity."
          options={CLOCKS}
          labels={CLOCK_LABELS}
          value={() => preferences().clock}
          onSelect={(value) => setPreference('clock', value)}
        />

        <CalmModeControl />

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
          legend="Local history"
          title="Remember conversations on this device"
          description="Keeps recent scrollback in this browser so rooms open instantly and read offline. Turning it off erases what's stored here."
          value={() => preferences().localHistory}
          onToggle={(value) => {
            setPreference('localHistory', value);
            if (!value) void clearVault();
          }}
        />

        <Toggle
          legend="Encrypted DMs"
          title="End-to-end encrypt direct messages"
          description="When the other person's app supports it, DMs are sealed on your device — the server relays only ciphertext. A lock marks encrypted messages; ones sent to another device stay locked."
          value={() => preferences().e2eeDms}
          onToggle={(value) => setPreference('e2eeDms', value)}
        />

        <Segmented
          legend="Background motion"
          description="Animate the scene, freeze it on a still frame, or turn it off — independent of your OS motion setting."
          options={SCENE_MOTIONS}
          labels={SCENE_MOTION_LABELS}
          value={() => sceneMotion()}
          onSelect={(value) => setSceneMotion(value)}
        />

        <Toggle
          legend="Motion"
          title="Reduce motion"
          description="Force-disable animations regardless of your OS setting."
          value={() => preferences().reduceMotion}
          onToggle={(value) => setPreference('reduceMotion', value)}
        />

        <AccessibilityAuditLedger />

        <button type="button" class="pref-reset" onClick={() => resetPreferences()}>
          Reset to defaults
        </button>
      </div>
    </Sheet>
  );
}
