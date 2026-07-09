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

import { createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { clearVault } from '@/lib/vault/historyVault';
import {
  clearClientExtensionAudit,
  readClientExtensionAudit,
  type ClientExtensionAuditEntry,
} from '@/lib/extensions/clientActions';
import { getState } from '@/lib/store';
import {
  exportPortableTransfer,
  importPortableTransfer,
  parsePortableTransfer,
  type PortableTransferSnapshot,
} from '@/lib/vault/portableTransfer';
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

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

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
    note: 'Named shortcuts dialog, labelled close action, grouped live keymap lists, and J/K transcript navigation.',
  },
  {
    surface: 'Command palette',
    status: 'checked',
    note: 'Named command dialog, described grammar examples, live selected-command status, and literal goto/search/time/reader/mute commands.',
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
    surface: 'Message actions',
    status: 'checked',
    note: 'Per-message action groups, named reaction/overflow triggers, labelled menus, and row-specific action names.',
  },
  {
    surface: 'Member list',
    status: 'checked',
    note: 'Channel-scoped member landmark, labelled role groups, named detail dialogs, and target-specific member actions.',
  },
  {
    surface: 'Notification controls',
    status: 'checked',
    note: 'Labelled compact control group, described calm-mode radios, and pressed-state desktop/sound/push/DND toggles.',
  },
  {
    surface: 'Time scrubber',
    status: 'checked',
    note: 'Channel-scoped scrubber region, labelled UTC-hour jump buttons, date jump input, and target-specific moment copy action.',
  },
  {
    surface: 'Mobile drawers',
    status: 'checked',
    note: 'Bottom-nav trigger handoff, drawer-initial focus, Escape close, Tab trap, and trigger focus restore.',
  },
  {
    surface: 'Modals',
    status: 'checked',
    note: 'Sheet focus trap, Escape close, labelled close buttons.',
  },
] as const;

function formatAuditTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

function PortableVaultControls(): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pendingImport, setPendingImport] = createSignal<{
    fileName: string;
    snapshot: PortableTransferSnapshot;
    messages: number;
    drafts: number;
  } | null>(null);

  async function handleExport(): Promise<void> {
    setBusy(true);
    try {
      const snapshot = await exportPortableTransfer();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `onyx-portable-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      const messageCount = snapshot.targets.reduce((sum, target) => sum + target.messages.length, 0);
      const draftCount = Object.keys(snapshot.composerDrafts).length;
      setStatus(`Exported ${countLabel(messageCount, 'message')}, ${countLabel(snapshot.targets.length, 'target')}, ${countLabel(snapshot.reviewHistory.length, 'review')}, and ${countLabel(draftCount, 'room draft')}.`);
    } catch {
      setStatus('Export failed. Try again after closing private browsing or freeing storage.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parsePortableTransfer(JSON.parse(await file.text()));
      if (!parsed) {
        setStatus('Import rejected. Choose an Onyx portable JSON file.');
        setPendingImport(null);
        return;
      }
      const messages = parsed.targets.reduce((sum, target) => sum + target.messages.length, 0);
      const drafts = Object.keys(parsed.composerDrafts).length;
      setPendingImport({ fileName: file.name, snapshot: parsed, messages, drafts });
      setStatus(`Ready to import ${countLabel(messages, 'message')}, ${countLabel(parsed.targets.length, 'target')}, ${countLabel(parsed.reviewHistory.length, 'review')}, and ${countLabel(drafts, 'room draft')}.`);
    } catch {
      setStatus('Import failed. Choose a readable Onyx portable JSON file.');
      setPendingImport(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const pending = pendingImport();
    if (!pending) return;
    setBusy(true);
    try {
      const result = await importPortableTransfer(pending.snapshot);
      for (const [target, draft] of Object.entries(pending.snapshot.composerDrafts)) {
        getState().setComposerDraft(target, draft);
      }
      setPendingImport(null);
      setStatus(`Imported ${countLabel(result.messages, 'message')}, ${countLabel(result.targets, 'target')}, ${countLabel(result.reviews, 'review')}, and ${countLabel(result.drafts, 'room draft')}.`);
    } catch {
      setStatus('Import failed while merging this portable vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable" aria-labelledby="pref-vault-portable-title">
      <div class="pref-group-head">
        <h3 id="pref-vault-portable-title" class="pref-label">Portable vault</h3>
      </div>
      <p class="pref-desc">
        Export or merge this device's local history, reviewed catch-up state, and room composer drafts; encrypted DM plaintext is not included.
      </p>
      <div class="pref-vault-actions">
        <button type="button" class="pref-reset" disabled={busy()} onClick={() => void handleExport()}>
          Export vault
        </button>
        <label class="pref-file">
          <span>Import portable JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy()}
            onChange={(event) => void handleImport(event)}
          />
        </label>
      </div>
      <Show when={pendingImport()}>
        {(pending) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-import-review-title">
            <h4 id="pref-import-review-title">Review import</h4>
            <p>
              {pending().fileName}: {countLabel(pending().messages, 'message')},
              {' '}{countLabel(pending().snapshot.targets.length, 'target')},
              {' '}{countLabel(pending().snapshot.reviewHistory.length, 'review')}, and
              {' '}{countLabel(pending().drafts, 'room draft')}. Existing local history is merged, not replaced.
            </p>
            <div class="pref-import-review__actions">
              <button type="button" class="pref-reset" disabled={busy()} onClick={() => void confirmImport()}>
                Import reviewed file
              </button>
              <button
                type="button"
                class="pref-reset"
                disabled={busy()}
                onClick={() => {
                  setPendingImport(null);
                  setStatus('Import cancelled.');
                }}
              >
                Cancel import
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={status()}>
        <p class="pref-status" role="status">{status()}</p>
      </Show>
    </section>
  );
}

function ExtensionAuditControls(): JSX.Element {
  const [entries, setEntries] = createSignal<ClientExtensionAuditEntry[]>(readClientExtensionAudit());

  function clearAudit(): void {
    clearClientExtensionAudit();
    setEntries([]);
  }

  return (
    <section class="pref-group pref-extension-audit" aria-labelledby="pref-extension-audit-title">
      <div class="pref-group-head">
        <h3 id="pref-extension-audit-title" class="pref-label">Extension action audit</h3>
        <button type="button" class="pref-a11y-link pref-audit-clear" onClick={clearAudit}>
          Clear
        </button>
      </div>
      <p class="pref-desc">
        Recent capability-scoped extension actions recorded on this device. Payloads are not stored.
      </p>
      <Show
        when={entries().length > 0}
        fallback={<p class="pref-status">No extension actions recorded on this device.</p>}
      >
        <div class="pref-extension-audit__rows" role="list" aria-label="Recent extension actions">
          <For each={entries()}>
            {(entry) => (
              <div class="pref-extension-audit__row" role="listitem">
                <span class="pref-extension-audit__main">
                  <span class="pref-extension-audit__title">{entry.title}</span>
                  <span class="pref-desc">{entry.detail}</span>
                </span>
                <span class="pref-extension-audit__meta">
                  <span>{entry.capability}</span>
                  <span>{formatAuditTime(entry.at)}</span>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
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

        <PortableVaultControls />

        <ExtensionAuditControls />

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

        <Toggle
          legend="Transparency"
          title="Reduce transparency"
          description="Flatten glassy overlays and translucent panels for stronger separation from the background."
          value={() => preferences().reduceTransparency}
          onToggle={(value) => setPreference('reduceTransparency', value)}
        />

        <AccessibilityAuditLedger />

        <button type="button" class="pref-reset" onClick={() => resetPreferences()}>
          Reset to defaults
        </button>
      </div>
    </Sheet>
  );
}
