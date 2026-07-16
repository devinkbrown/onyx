// SPDX-License-Identifier: AGPL-3.0-or-later
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

import { createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import {
  VAULT_KEEP,
  applyRetentionPolicy,
  clearOutbox,
  clearVault,
  getRetentionPolicy,
  loadOutbox,
  setRetentionPolicy,
  subscribeOutbox,
} from '@/lib/vault/historyVault';
import {
  readRetentionPolicy,
  sanitizeRetentionPolicy,
  subscribeRetentionPolicy,
  writeRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/vault/retentionPolicy';
import { countLabel } from '@/lib/format/countLabel';
import {
  VAULT_SEARCH_MODES,
  defaultVaultSearchMode,
  setDefaultVaultSearchMode,
} from '@/lib/prefs/vaultSearchMode';
import { setVaultMode, type VaultSearchMode } from './search/useMessageSearch';
import { DiscordImportControls, DiscordPackageImportControls, DiscordBotImportControls, SlackImportControls, IrcLogImportControls } from './HistoryImportControls';
import {
  formatImportMib,
  PORTABLE_JSON_MAX_AGGREGATE_BYTES,
  PORTABLE_JSON_MAX_FILE_BYTES,
  PORTABLE_JSON_MAX_FILES,
  validateImportFileSelection,
} from './importFileLimits';
import {
  clearClientExtensionAudit,
  clearClientExtensionActions,
  exportClientExtensionActionManifest,
  normalizeClientExtensionActions,
  parseClientExtensionActionManifest,
  previewClientExtensionAction,
  readClientExtensionAudit,
  readClientExtensionActions,
  saveClientExtensionActions,
  type ClientExtensionAction,
  type ClientExtensionAuditEntry,
} from '@/lib/extensions/clientActions';
import { getState } from '@/lib/store';
import {
  clearReviewHistory,
  readReviewHistory,
  subscribeReviewHistory,
} from '@/lib/notifications/reviewHistory';
import { clearFollowed, followed } from '@/lib/notifications/followed';
import {
  exportPortableTransfer,
  importPortableTransfer,
  parsePortableTransfer,
  type PortableTransferSnapshot,
} from '@/lib/vault/portableTransfer';
import {
  clearSavedSearches,
  listSearches,
  subscribeSavedSearches,
} from '@/lib/vault/savedSearches';
import {
  clearRoomComposerDrafts,
  loadComposerDrafts,
  type ComposerDrafts,
} from '@/lib/composer/drafts';
import {
  clearChannelTopicDrafts,
  loadChannelTopicDrafts,
  saveChannelTopicDrafts,
  type ChannelTopicDrafts,
} from '@/lib/channel/topicDrafts';
import {
  clearAllTopicReads,
  readTopicReadLedger,
  subscribeTopicReadLedger,
} from '@/lib/topics/topicReadLedger';
import { localTranslationReadiness, preferredTranslationTarget } from '@/lib/intelligence/localLanguage';
import {
  TRANSLATION_TARGETS,
  languageLabel,
  resolveTranslationTarget,
  setTranslationTarget,
  translationTarget,
} from '@/lib/intelligence/translateMessage';
import { pwaReadiness } from '@/pwa/readiness';
import {
  refreshInstalledAppShell,
  type PwaUpdateRecoveryResult,
} from '@/pwa/updateRecovery';
import { CalmModeControl } from './CalmModeControl';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  SCENE_MOTIONS,
  resetSceneMotion,
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
const VAULT_SEARCH_MODE_LABELS: Record<VaultSearchMode, string> = {
  hybrid: 'Text + related',
  exact: 'Exact',
  semantic: 'Related terms',
};
const VAULT_KEEP_OPTIONS = ['200', '400', '1000', '5000'] as const;
type VaultKeepOption = (typeof VAULT_KEEP_OPTIONS)[number];
const VAULT_KEEP_LABELS: Record<VaultKeepOption, string> = {
  '200': '200',
  '400': '400',
  '1000': '1,000',
  '5000': '5,000',
};
const VAULT_AGE_OPTIONS = ['none', '7', '30', '90', '365'] as const;
type VaultAgeOption = (typeof VAULT_AGE_OPTIONS)[number];
const VAULT_AGE_LABELS: Record<VaultAgeOption, string> = {
  none: 'Any age',
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  '365': '1 year',
};

function resetAllPreferences(): void {
  resetPreferences();
  resetSceneMotion();
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
  const descId = createUniqueId();
  // Roving-tabindex radio group: one tab stop, arrow keys move (and select, per the
  // ARIA radio-group pattern where selection follows focus). Refs let the key handler
  // move DOM focus to the newly-selected radio.
  const buttons: (HTMLButtonElement | undefined)[] = [];

  function selectAt(index: number): void {
    const option = props.options[index];
    if (option === undefined) return;
    props.onSelect(option);
    buttons[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const count = props.options.length;
    if (count === 0) return;
    const current = props.options.indexOf(props.value());
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAt(((current < 0 ? 0 : current) + 1) % count);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAt(((current < 0 ? 0 : current) - 1 + count) % count);
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
    <section class="pref-group">
      <div class="pref-group-head">
        <h3 class="pref-label">{props.legend}</h3>
      </div>
      <p class="pref-desc" id={descId}>{props.description}</p>
      <div
        class="pref-segments"
        role="radiogroup"
        aria-label={props.legend}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
        <For each={props.options}>
          {(option, index) => {
            const active = () => props.value() === option;
            return (
              <button
                ref={(el) => (buttons[index()] = el)}
                type="button"
                class="pref-segment"
                role="radio"
                aria-checked={active()}
                tabindex={active() ? 0 : -1}
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
  // Keep the switch's accessible name to the concise title (aria-label overrides
  // the folded-in body text) and expose the help paragraph as a description —
  // mirroring Segmented / CalmModeControl so ATs announce a name, not a paragraph.
  const descId = createUniqueId();
  return (
    <section class="pref-group">
      <h3 class="pref-label">{props.legend}</h3>
      <button
        type="button"
        class="pref-toggle"
        role="switch"
        aria-checked={props.value()}
        aria-label={props.title}
        aria-describedby={descId}
        onClick={() => props.onToggle(!props.value())}
      >
        <span class="pref-toggle-text">
          <span class="pref-toggle-title">{props.title}</span>
          <span class="pref-desc" id={descId}>{props.description}</span>
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
    topicDrafts: number;
    accountHandoffs: number;
    preferenceHandoffs: number;
    followedConversations: number;
    topicReadCursors: number;
    savedSearches: number;
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
      const topicDraftCount = Object.keys(snapshot.channelTopicDrafts).length;
      setStatus(`Exported ${countLabel(messageCount, 'message')}, ${countLabel(snapshot.targets.length, 'target')}, ${countLabel(snapshot.reviewHistory.length, 'review')}, ${countLabel(draftCount, 'room draft')}, ${countLabel(topicDraftCount, 'topic draft')}, ${countLabel(snapshot.followedConversations.length, 'followed conversation')}, ${countLabel(snapshot.topicReadCursors.length, 'topic read cursor')}, ${countLabel(snapshot.savedSearches.length, 'saved search', 'saved searches')}, ${countLabel(snapshot.accountHandoffs.length, 'account handoff')}, and ${countLabel(snapshot.preferenceHandoff ? 1 : 0, 'preference set')}.`);
    } catch {
      setStatus('Export failed. Try again after closing private browsing or freeing storage.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const limitFailure = validateImportFileSelection(files, {
      maxFiles: PORTABLE_JSON_MAX_FILES,
      maxFileBytes: PORTABLE_JSON_MAX_FILE_BYTES,
      maxAggregateBytes: PORTABLE_JSON_MAX_AGGREGATE_BYTES,
    });
    if (limitFailure) {
      setPendingImport(null);
      if (limitFailure.kind === 'count') {
        setStatus('Choose one Onyx portable JSON file at a time.');
      } else if (limitFailure.kind === 'file') {
        setStatus(`${limitFailure.fileName} exceeds the ${formatImportMib(limitFailure.maxFileBytes)} portable JSON limit. Choose a smaller portable vault file.`);
      } else {
        setStatus(`That portable JSON exceeds the ${formatImportMib(limitFailure.maxAggregateBytes)} total import limit. Choose a smaller portable vault file.`);
      }
      return;
    }
    const file = files[0] ?? null;
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
      const topicDrafts = Object.keys(parsed.channelTopicDrafts).length;
      const accountHandoffs = parsed.accountHandoffs.length;
      const preferenceHandoffs = parsed.preferenceHandoff ? 1 : 0;
      const followedConversations = parsed.followedConversations.length;
      const topicReadCursors = parsed.topicReadCursors.length;
      const savedSearches = parsed.savedSearches.length;
      setPendingImport({ fileName: file.name, snapshot: parsed, messages, drafts, topicDrafts, accountHandoffs, preferenceHandoffs, followedConversations, topicReadCursors, savedSearches });
      setStatus(`Ready to import ${countLabel(messages, 'message')}, ${countLabel(parsed.targets.length, 'target')}, ${countLabel(parsed.reviewHistory.length, 'review')}, ${countLabel(drafts, 'room draft')}, ${countLabel(topicDrafts, 'topic draft')}, ${countLabel(followedConversations, 'followed conversation')}, ${countLabel(topicReadCursors, 'topic read cursor')}, ${countLabel(savedSearches, 'saved search', 'saved searches')}, ${countLabel(accountHandoffs, 'account handoff')}, and ${countLabel(preferenceHandoffs, 'preference set')}.`);
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
      setStatus(`Imported ${countLabel(result.messages, 'message')}, ${countLabel(result.targets, 'target')}, ${countLabel(result.reviews, 'review')}, ${countLabel(result.drafts, 'room draft')}, ${countLabel(result.topicDrafts, 'topic draft')}, ${countLabel(result.followedConversations, 'followed conversation')}, ${countLabel(result.topicReadCursors, 'topic read cursor')}, ${countLabel(result.savedSearches, 'saved search', 'saved searches')}, ${countLabel(result.accountHandoffs, 'account handoff')}, and ${countLabel(result.preferenceHandoffs, 'preference set')}.`);
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
        Export or merge this device's local history, reviewed catch-up state, room composer drafts, channel topic drafts, followed rooms/topics, named-conversation read cursors, saved searches, saved sign-in targets, retention policy, and Preferences switches. Read cursors contain only room/topic, message ID, and timestamp metadata. Saved query text is included. Passwords, session tokens, mesh tokens, and decrypted DM plaintext are not exported automatically.
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
              {' '}{countLabel(pending().snapshot.reviewHistory.length, 'review')},
              {' '}{countLabel(pending().drafts, 'room draft')},
              {' '}{countLabel(pending().topicDrafts, 'topic draft')},
              {' '}{countLabel(pending().followedConversations, 'followed conversation')},
              {' '}{countLabel(pending().topicReadCursors, 'topic read cursor')},
              {' '}{countLabel(pending().savedSearches, 'saved search', 'saved searches')},
              {' '}{countLabel(pending().accountHandoffs, 'account handoff')}, and
              {' '}{countLabel(pending().preferenceHandoffs, 'preference set')}. Existing local history, followed rooms/topics, topic read cursors, saved searches, saved sign-in targets, and Preferences switches are merged, not replaced.
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

function ClearReviewedAnchorsControls(): JSX.Element {
  const [anchorCount, setAnchorCount] = createSignal(readReviewHistory().length);
  const [confirming, setConfirming] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);

  onCleanup(subscribeReviewHistory((entries) => setAnchorCount(entries.length)));

  function clearNow(): void {
    const result = clearReviewHistory();
    setAnchorCount(result.remaining);
    setConfirming(false);
    if (result.success) {
      setStatus({
        message: result.cleared > 0
          ? `Cleared ${countLabel(result.cleared, 'reviewed anchor')} from this device.`
          : 'No reviewed anchors were stored on this device.',
        failure: false,
      });
      return;
    }
    setStatus({
      message: 'Could not verify that reviewed anchors were cleared on this device. Message history and other local data were not erased.',
      failure: true,
    });
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-clear-reviewed-title">
      <div class="pref-group-head">
        <h3 id="pref-clear-reviewed-title" class="pref-label">Reviewed catch-up anchors</h3>
        <span class="pref-count">{countLabel(anchorCount(), 'reviewed anchor')}</span>
      </div>
      <p class="pref-desc">
        These metadata-only anchors reopen exact catch-up points reviewed on this device. Clearing
        them does not erase vault messages, named-topic read cursors, saved searches, or server history.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={() => {
                setStatus(null);
                setConfirming(true);
              }}
            >
              Clear reviewed anchors
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm clear reviewed anchors">
          <p class="pref-desc">
            Remove {countLabel(anchorCount(), 'reviewed anchor')} from this device only?
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={clearNow}
            >
              Erase reviewed anchors
            </button>
            <button
              type="button"
              class="pref-reset"
              onClick={() => setConfirming(false)}
            >
              Keep reviewed anchors
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
      </Show>
    </section>
  );
}

function ClearSavedSearchesControls(): JSX.Element {
  const [searchCount, setSearchCount] = createSignal<number | null>(null);
  const [stagedCount, setStagedCount] = createSignal<number | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let clearTrigger: HTMLButtonElement | undefined;

  async function refreshCount(): Promise<number> {
    const count = (await listSearches()).length;
    setSearchCount(count);
    return count;
  }

  onMount(() => {
    void refreshCount();
  });
  onCleanup(subscribeSavedSearches(() => {
    void refreshCount();
  }));

  async function beginClear(trigger: HTMLButtonElement): Promise<void> {
    clearTrigger = trigger;
    setBusy(true);
    setStatus(null);
    const count = await refreshCount();
    setStagedCount(count);
    setConfirming(true);
    setBusy(false);
  }

  function cancelClear(): void {
    setConfirming(false);
    setStagedCount(null);
    setStatus({ message: 'Saved searches kept on this device.', failure: false });
    queueMicrotask(() => clearTrigger?.focus());
  }

  async function confirmClear(): Promise<void> {
    const expected = stagedCount();
    if (expected === null) return;
    setBusy(true);
    const current = (await listSearches()).length;
    setSearchCount(current);
    if (current !== expected) {
      setStagedCount(current);
      setStatus({
        message: `Saved search count changed to ${current}. Review the updated count and confirm again.`,
        failure: false,
      });
      setBusy(false);
      return;
    }

    const cleared = await clearSavedSearches();
    const remaining = (await listSearches()).length;
    if (!cleared || remaining > 0) {
      // A false clear result means the empty readback is not authoritative.
      // Keep the disclosed count when verification failed without retained rows.
      setSearchCount(remaining > 0 ? remaining : current);
      setStagedCount(remaining > 0 ? remaining : current);
      setStatus({
        message: 'Could not verify that all saved searches and query text were cleared. The confirmation remains open; free storage or retry.',
        failure: true,
      });
      setBusy(false);
      return;
    }

    setSearchCount(0);
    setStagedCount(null);
    setConfirming(false);
    setStatus({
      message: `Cleared ${countLabel(current, 'saved search', 'saved searches')} and removed the saved query text from this device.`,
      failure: false,
    });
    setBusy(false);
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-clear-saved-searches-title">
      <div class="pref-group-head">
        <h3 id="pref-clear-saved-searches-title" class="pref-label">Saved searches</h3>
        <span class="pref-count">
          {searchCount() === null
            ? 'Checking saved searches…'
            : countLabel(searchCount()!, 'saved search', 'saved searches')}
        </span>
      </div>
      <p class="pref-desc">
        Saved search names, modes, and query text stay on this device. Clear them independently
        without erasing vault messages, reviewed anchors, or named-topic read cursors.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              ref={clearTrigger}
              type="button"
              class="pref-reset pref-reset--danger"
              disabled={busy() || searchCount() === null}
              onClick={(event) => void beginClear(event.currentTarget)}
            >
              Clear all saved searches
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm clear all saved searches">
          <p class="pref-desc">
            Permanently erase {countLabel(stagedCount() ?? 0, 'saved search', 'saved searches')}
            {' '}and their saved query text from this device?
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              disabled={busy()}
              onClick={() => void confirmClear()}
            >
              Erase all saved searches
            </button>
            <button
              type="button"
              class="pref-reset"
              disabled={busy()}
              onClick={cancelClear}
            >
              Keep saved searches
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
      </Show>
    </section>
  );
}

function ClearTopicReadPositionsControls(): JSX.Element {
  const [cursorCount, setCursorCount] = createSignal(readTopicReadLedger().length);
  const [stagedCount, setStagedCount] = createSignal<number | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let clearTrigger: HTMLButtonElement | undefined;

  onCleanup(subscribeTopicReadLedger((markers) => setCursorCount(markers.length)));

  function beginClear(trigger: HTMLButtonElement): void {
    clearTrigger = trigger;
    const count = readTopicReadLedger().length;
    setCursorCount(count);
    setStagedCount(count);
    setStatus(null);
    setConfirming(true);
  }

  function cancelClear(): void {
    setConfirming(false);
    setStagedCount(null);
    setStatus({ message: 'Topic read positions kept on this device.', failure: false });
    queueMicrotask(() => clearTrigger?.focus());
  }

  function confirmClear(): void {
    const expected = stagedCount();
    if (expected === null) return;
    const current = readTopicReadLedger().length;
    setCursorCount(current);
    if (current !== expected) {
      setStagedCount(current);
      setStatus({
        message: `Topic read position count changed to ${current}. Review the updated count and confirm again.`,
        failure: false,
      });
      return;
    }

    const cleared = clearAllTopicReads();
    const remaining = readTopicReadLedger().length;
    if (!cleared || remaining > 0) {
      setCursorCount(remaining > 0 ? remaining : current);
      setStagedCount(remaining > 0 ? remaining : current);
      setStatus({
        message: 'Could not verify that all topic read positions were cleared. The confirmation remains open; retry after checking browser storage.',
        failure: true,
      });
      return;
    }

    setCursorCount(0);
    setStagedCount(null);
    setConfirming(false);
    setStatus({
      message: `Cleared ${countLabel(current, 'topic read position')} from this device.`,
      failure: false,
    });
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-clear-topic-reads-title">
      <div class="pref-group-head">
        <h3 id="pref-clear-topic-reads-title" class="pref-label">Topic read positions</h3>
        <span class="pref-count">{countLabel(cursorCount(), 'topic read position')}</span>
      </div>
      <p class="pref-desc">
        Clear only the per-topic navigation positions remembered on this device. Messages, vault
        rows, followed topics, saved searches, reviewed anchors, and server history remain unchanged.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              ref={clearTrigger}
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={(event) => beginClear(event.currentTarget)}
            >
              Clear topic read positions
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm clear topic read positions">
          <p class="pref-desc">
            Remove {countLabel(stagedCount() ?? 0, 'topic read position')} from this device only?
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={confirmClear}
            >
              Erase topic read positions
            </button>
            <button
              type="button"
              class="pref-reset"
              onClick={cancelClear}
            >
              Keep topic read positions
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
      </Show>
    </section>
  );
}

function ClearFollowedConversationsControls(): JSX.Element {
  const followCount = createMemo(() => followed().size);
  const [stagedCount, setStagedCount] = createSignal<number | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let clearTrigger: HTMLButtonElement | undefined;

  function beginClear(trigger: HTMLButtonElement): void {
    clearTrigger = trigger;
    setStagedCount(followed().size);
    setStatus(null);
    setConfirming(true);
  }

  function cancelClear(): void {
    setConfirming(false);
    setStagedCount(null);
    setStatus({ message: 'Followed conversations kept on this device.', failure: false });
    queueMicrotask(() => clearTrigger?.focus());
  }

  function confirmClear(): void {
    const expected = stagedCount();
    if (expected === null) return;
    const current = followed().size;
    if (current !== expected) {
      setStagedCount(current);
      setStatus({
        message: `Followed conversation count changed to ${current}. Review the updated count and confirm again.`,
        failure: false,
      });
      return;
    }

    const result = clearFollowed();
    if (!result.success || result.remaining > 0) {
      setStagedCount(result.remaining > 0 ? result.remaining : current);
      setStatus({
        message: 'Could not verify that followed conversations were cleared. The confirmation remains open; notification and catch-up metadata may still be stored.',
        failure: true,
      });
      return;
    }

    setStagedCount(null);
    setConfirming(false);
    setStatus({
      message: `Cleared ${countLabel(current, 'followed conversation')} from this device.`,
      failure: false,
    });
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-clear-followed-title">
      <div class="pref-group-head">
        <h3 id="pref-clear-followed-title" class="pref-label">Followed conversations</h3>
        <span class="pref-count">{countLabel(followCount(), 'followed conversation')}</span>
      </div>
      <p class="pref-desc">
        Clear the room and named-topic keys this device uses for calm notifications and Home
        catch-up ranking. No message text or notification payload is stored in these keys.
      </p>
      <p class="pref-desc">
        Messages, queued sends, drafts, reviewed anchors, topic positions, saved searches,
        sign-in data, notification preferences, translation preferences, and room-wide watch
        activity remain unchanged.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              ref={clearTrigger}
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={(event) => beginClear(event.currentTarget)}
            >
              Clear followed conversations
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm clear followed conversations">
          <p class="pref-desc">
            Remove {countLabel(stagedCount() ?? 0, 'followed conversation')} from this device only?
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={confirmClear}
            >
              Erase followed conversations
            </button>
            <button
              type="button"
              class="pref-reset"
              onClick={cancelClear}
            >
              Keep followed conversations
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
      </Show>
    </section>
  );
}

interface LocalDraftSnapshot {
  roomDrafts: ComposerDrafts;
  topicDrafts: ChannelTopicDrafts;
  roomCount: number;
  topicCount: number;
}

function readLocalDraftSnapshot(): LocalDraftSnapshot {
  const roomDrafts = Object.fromEntries(
    Object.entries(loadComposerDrafts()).filter(([target]) => (
      target.startsWith('#') || target.startsWith('&')
    )),
  );
  const topicDrafts = loadChannelTopicDrafts();
  return {
    roomDrafts,
    topicDrafts,
    roomCount: Object.keys(roomDrafts).length,
    topicCount: Object.keys(topicDrafts).length,
  };
}

function localDraftCountLabel(roomCount: number, topicCount: number): string {
  return `${countLabel(roomCount, 'room draft')} · ${countLabel(topicCount, 'topic draft')}`;
}

function DiscardLocalDraftsControls(): JSX.Element {
  const initial = readLocalDraftSnapshot();
  const [counts, setCounts] = createSignal({
    roomCount: initial.roomCount,
    topicCount: initial.topicCount,
  });
  const [stagedCounts, setStagedCounts] = createSignal<{
    roomCount: number;
    topicCount: number;
  } | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let discardTrigger: HTMLButtonElement | undefined;

  function refreshCounts(): LocalDraftSnapshot {
    const snapshot = readLocalDraftSnapshot();
    setCounts({ roomCount: snapshot.roomCount, topicCount: snapshot.topicCount });
    return snapshot;
  }

  function beginDiscard(trigger: HTMLButtonElement): void {
    discardTrigger = trigger;
    const snapshot = refreshCounts();
    setStagedCounts({ roomCount: snapshot.roomCount, topicCount: snapshot.topicCount });
    setStatus(null);
    setConfirming(true);
  }

  function cancelDiscard(): void {
    setConfirming(false);
    setStagedCounts(null);
    setStatus({ message: 'Local room and topic drafts kept on this device.', failure: false });
    queueMicrotask(() => discardTrigger?.focus());
  }

  function restoreRoomDrafts(drafts: ComposerDrafts): void {
    for (const [target, text] of Object.entries(drafts)) {
      getState().setComposerDraft(target, text);
    }
  }

  function discardNow(): void {
    const expected = stagedCounts();
    if (!expected) return;

    const current = refreshCounts();
    if (current.roomCount !== expected.roomCount || current.topicCount !== expected.topicCount) {
      setStagedCounts({ roomCount: current.roomCount, topicCount: current.topicCount });
      setStatus({
        message: `Draft counts changed to ${localDraftCountLabel(current.roomCount, current.topicCount)}. Review the updated counts and confirm again.`,
        failure: false,
      });
      return;
    }

    const roomResult = clearRoomComposerDrafts();
    if (!roomResult.success) {
      const retained = refreshCounts();
      setStagedCounts({ roomCount: retained.roomCount, topicCount: retained.topicCount });
      setStatus({
        message: 'Could not verify that room drafts were discarded. The confirmation remains open; topic drafts and other local data were not erased.',
        failure: true,
      });
      return;
    }

    for (const target of Object.keys(current.roomDrafts)) {
      getState().setComposerDraft(target, '');
    }
    const persistedRoomsCleared = readLocalDraftSnapshot().roomCount === 0;
    const storedRoomsCleared = Object.keys(getState().composerDrafts).every((target) => (
      !target.startsWith('#') && !target.startsWith('&')
    ));
    if (!persistedRoomsCleared || !storedRoomsCleared) {
      restoreRoomDrafts(current.roomDrafts);
      const retained = refreshCounts();
      setStagedCounts({ roomCount: retained.roomCount, topicCount: retained.topicCount });
      setStatus({
        message: 'Could not verify that room drafts were removed from storage and the active session. The confirmation remains open; retry after checking browser storage.',
        failure: true,
      });
      return;
    }

    const topicResult = clearChannelTopicDrafts();
    if (!topicResult.success) {
      restoreRoomDrafts(current.roomDrafts);
      const retained = refreshCounts();
      setStagedCounts({ roomCount: retained.roomCount, topicCount: retained.topicCount });
      setStatus({
        message: 'Could not verify that topic drafts were discarded. Room drafts were restored and the confirmation remains open.',
        failure: true,
      });
      return;
    }

    const verified = readLocalDraftSnapshot();
    const verifiedStore = Object.keys(getState().composerDrafts).every((target) => (
      !target.startsWith('#') && !target.startsWith('&')
    ));
    if (verified.roomCount > 0 || verified.topicCount > 0 || !verifiedStore) {
      restoreRoomDrafts(current.roomDrafts);
      saveChannelTopicDrafts(current.topicDrafts);
      const retained = refreshCounts();
      setStagedCounts({ roomCount: retained.roomCount, topicCount: retained.topicCount });
      setStatus({
        message: 'Could not verify an empty draft readback. Drafts were restored where possible and the confirmation remains open.',
        failure: true,
      });
      return;
    }

    setCounts({ roomCount: 0, topicCount: 0 });
    setStagedCounts(null);
    setConfirming(false);
    setStatus({
      message: `Discarded ${localDraftCountLabel(current.roomCount, current.topicCount)} from this device. Direct-message drafts were not changed.`,
      failure: false,
    });
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-discard-local-drafts-title">
      <div class="pref-group-head">
        <h3 id="pref-discard-local-drafts-title" class="pref-label">Local drafts</h3>
        <span class="pref-count">
          {localDraftCountLabel(counts().roomCount, counts().topicCount)}
        </span>
      </div>
      <p class="pref-desc">
        Discard unsent room composer drafts and channel-topic drafts stored on this device. This
        does not change messages, vault history, queued sends, reviewed anchors, topic read
        positions, saved searches, followed topics, or sign-in data.
      </p>
      <p class="pref-desc">
        Direct-message draft plaintext is excluded from portable transfer, is not counted here,
        and will remain on this device.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              ref={discardTrigger}
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={(event) => beginDiscard(event.currentTarget)}
            >
              Discard local drafts
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm discard local drafts">
          <p class="pref-desc">
            Discard {localDraftCountLabel(
              stagedCounts()?.roomCount ?? 0,
              stagedCounts()?.topicCount ?? 0,
            )}? Their unsent text will be removed from this device. Direct-message drafts remain.
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={discardNow}
            >
              Discard room and topic drafts
            </button>
            <button
              type="button"
              class="pref-reset"
              onClick={cancelDiscard}
            >
              Keep local drafts
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
      </Show>
    </section>
  );
}

function DiscardQueuedSendsControls(): JSX.Element {
  const [queueCount, setQueueCount] = createSignal<number | null>(null);
  const [stagedCount, setStagedCount] = createSignal<number | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let discardTrigger: HTMLButtonElement | undefined;

  async function refreshCount(): Promise<number> {
    const count = (await loadOutbox()).length;
    setQueueCount(count);
    return count;
  }

  onMount(() => {
    void refreshCount();
  });
  onCleanup(subscribeOutbox(() => {
    void refreshCount();
  }));

  async function beginDiscard(trigger: HTMLButtonElement): Promise<void> {
    discardTrigger = trigger;
    setBusy(true);
    setStatus(null);
    const count = await refreshCount();
    setStagedCount(count);
    setConfirming(true);
    setBusy(false);
  }

  function cancelDiscard(): void {
    setConfirming(false);
    setStagedCount(null);
    setStatus({ message: 'Queued sends kept on this device.', failure: false });
    queueMicrotask(() => discardTrigger?.focus());
  }

  async function confirmDiscard(): Promise<void> {
    const expected = stagedCount();
    if (expected === null) return;
    setBusy(true);
    const current = (await loadOutbox()).length;
    setQueueCount(current);
    if (current !== expected) {
      setStagedCount(current);
      setStatus({
        message: `Queued send count changed to ${current}. Review the updated count and confirm again.`,
        failure: false,
      });
      setBusy(false);
      return;
    }

    const cleared = await clearOutbox();
    const remaining = (await loadOutbox()).length;
    if (!cleared || remaining > 0) {
      setQueueCount(remaining > 0 ? remaining : current);
      setStagedCount(remaining > 0 ? remaining : current);
      setStatus({
        message: 'Could not verify that all queued sends were discarded. The confirmation remains open; nothing will be reported as removed until device storage confirms it.',
        failure: true,
      });
      setBusy(false);
      return;
    }

    setQueueCount(0);
    setStagedCount(null);
    setConfirming(false);
    setStatus({
      message: `Discarded ${countLabel(current, 'queued send')}. Their unsent message text was removed from this device and will not be sent.`,
      failure: false,
    });
    setBusy(false);
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-discard-queued-title">
      <div class="pref-group-head">
        <h3 id="pref-discard-queued-title" class="pref-label">Queued sends</h3>
        <span class="pref-count">
          {queueCount() === null
            ? 'Checking queued sends…'
            : countLabel(queueCount()!, 'queued send')}
        </span>
      </div>
      <p class="pref-desc">
        Discard messages composed while offline without sending them. This removes only queued
        unsent text; vault history, drafts, reviewed anchors, topic positions, and saved searches remain.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              ref={discardTrigger}
              type="button"
              class="pref-reset pref-reset--danger"
              disabled={busy() || queueCount() === null}
              onClick={(event) => void beginDiscard(event.currentTarget)}
            >
              Discard queued sends
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm discard queued sends">
          <p class="pref-desc">
            Discard {countLabel(stagedCount() ?? 0, 'queued send')}? Their unsent message text will
            {' '}be removed from this device and will not be sent.
          </p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              disabled={busy()}
              onClick={() => void confirmDiscard()}
            >
              Discard all queued sends
            </button>
            <button
              type="button"
              class="pref-reset"
              disabled={busy()}
              onClick={cancelDiscard}
            >
              Keep queued sends
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        {(current) => (
          <p class="pref-status" role={current().failure ? 'alert' : 'status'}>
            {current().message}
          </p>
        )}
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

function ExtensionActionManifestControls(): JSX.Element {
  const [actionCount, setActionCount] = createSignal(readClientExtensionActions().length);
  const [manifestText, setManifestText] = createSignal('');
  const [pendingActions, setPendingActions] = createSignal<ClientExtensionAction[] | null>(null);
  const [status, setStatus] = createSignal('');

  function replaceManifestText(value: string): void {
    setManifestText(value);
    setPendingActions(null);
    setStatus('');
  }

  function reviewManifest(): void {
    const reviewed = parseClientExtensionActionManifest(manifestText());
    if (!reviewed) {
      setPendingActions(null);
      setStatus('Manifest must be a version 1 object or a legacy action array.');
      return;
    }
    if (reviewed.length === 0) {
      setPendingActions(null);
      setStatus('Manifest does not contain any supported safe actions.');
      return;
    }
    setPendingActions(reviewed);
    setStatus(`Ready to import ${countLabel(reviewed.length, 'safe action')}. Review each capability and detail.`);
  }

  function confirmManifest(): void {
    const staged = pendingActions();
    if (!staged) return;

    // Revalidate the normalized stage at the persistence boundary and require it
    // to describe exactly the same actions the preview displayed.
    const revalidated = normalizeClientExtensionActions(staged);
    if (revalidated.length === 0 || JSON.stringify(revalidated) !== JSON.stringify(staged)) {
      setPendingActions(null);
      setStatus('Reviewed actions changed before import. Review the manifest again.');
      return;
    }

    const committed = saveClientExtensionActions(revalidated);
    if (!committed || JSON.stringify(committed) !== JSON.stringify(revalidated)) {
      setStatus('Could not save reviewed actions on this device.');
      return;
    }

    setActionCount(committed.length);
    setPendingActions(null);
    setStatus(`Imported ${countLabel(committed.length, 'safe action')}.`);
  }

  function exportManifest(): void {
    setPendingActions(null);
    setManifestText(exportClientExtensionActionManifest());
    setStatus(`Exported ${countLabel(actionCount(), 'safe action')}.`);
  }

  function clearManifest(): void {
    clearClientExtensionActions();
    setPendingActions(null);
    setActionCount(0);
    setManifestText('');
    setStatus('Extension actions cleared on this device.');
  }

  return (
    <section class="pref-group pref-extension-actions" aria-labelledby="pref-extension-actions-title">
      <div class="pref-group-head">
        <h3 id="pref-extension-actions-title" class="pref-label">Extension actions</h3>
        <span class="pref-count">{countLabel(actionCount(), 'safe action')}</span>
      </div>
      <p class="pref-desc">
        Import reviewed action manifests for the command palette. Onyx accepts only open-url and copy-text capabilities.
      </p>
      <label class="pref-label" for="pref-extension-manifest">Action manifest JSON</label>
      <textarea
        id="pref-extension-manifest"
        class="pref-json-input"
        rows={5}
        spellcheck={false}
        value={manifestText()}
        onInput={(event) => replaceManifestText(event.currentTarget.value)}
      />
      <div class="pref-import-review__actions">
        <button type="button" class="pref-reset" onClick={reviewManifest} disabled={!manifestText().trim()}>
          Review actions
        </button>
        <button type="button" class="pref-reset" onClick={exportManifest}>
          Export actions
        </button>
        <button type="button" class="pref-reset" onClick={clearManifest} disabled={actionCount() === 0}>
          Clear actions
        </button>
      </div>
      <Show when={pendingActions()}>
        {(actions) => (
          <div class="pref-extension-review" role="group" aria-labelledby="pref-extension-review-title">
            <h4 id="pref-extension-review-title">Review extension actions</h4>
            <p>
              Only these normalized actions will be stored. Payload values remain hidden during review.
            </p>
            <div
              class="pref-extension-review__rows"
              role="list"
              aria-label="Reviewed extension actions"
            >
              <For each={actions()}>
                {(action) => {
                  const preview = previewClientExtensionAction(action);
                  return (
                    <div class="pref-extension-review__row" role="listitem">
                      <span class="pref-extension-review__title">{preview.title}</span>
                      <span class="pref-extension-review__capability">{preview.capability}</span>
                      <span class="pref-extension-review__detail">{preview.detail}</span>
                    </div>
                  );
                }}
              </For>
            </div>
            <div class="pref-import-review__actions">
              <button type="button" class="pref-reset" onClick={confirmManifest}>
                Import reviewed actions
              </button>
              <button
                type="button"
                class="pref-reset"
                onClick={() => {
                  setPendingActions(null);
                  setStatus('Reviewed actions cancelled.');
                }}
              >
                Cancel reviewed actions
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

function LocalLanguageTools(): JSX.Element {
  const effectiveTarget = createMemo(() =>
    resolveTranslationTarget(translationTarget(), preferredTranslationTarget()),
  );
  const translation = createMemo(() => localTranslationReadiness(effectiveTarget()));
  // Keep the controlled <select> value honest: if the resolved target (e.g. a browser
  // locale like `sv`) isn't in the curated list, surface it as an extra option so the
  // shown selection always matches the language captions actually translate to.
  const targetOptions = createMemo<readonly string[]>(() => {
    const current = effectiveTarget();
    return (TRANSLATION_TARGETS as readonly string[]).includes(current)
      ? TRANSLATION_TARGETS
      : [current, ...TRANSLATION_TARGETS];
  });

  return (
    <section class="pref-group pref-local-language" aria-labelledby="pref-local-language-title">
      <div class="pref-group-head pref-local-language__head">
        <h3 id="pref-local-language-title" class="pref-label">Local language tools</h3>
        <ProvenanceBadge scope="device" subject="Local language tools" />
      </div>
      <p class="pref-desc">
        Caption and translation handoffs stay local-first. Onyx labels what can
        run on this device and refuses hidden external translation.
      </p>
      <div class="pref-local-language__rows" role="list" aria-label="Local language tool readiness">
        <div class="pref-local-language__row" role="listitem">
          <span class="pref-local-language__status">Ready</span>
          <span class="pref-local-language__main">
            <span class="pref-local-language__title">Caption transcript copy</span>
            <span class="pref-desc">Live caption overlays can copy the current transcript from local client state.</span>
          </span>
        </div>
        <div class="pref-local-language__row" role="listitem" data-state={translation().state}>
          <span class="pref-local-language__status">{translation().state}</span>
          <span class="pref-local-language__main">
            <span class="pref-local-language__title">{translation().label}</span>
            <span class="pref-desc">{translation().detail}</span>
          </span>
        </div>
      </div>
      <Show when={translation().state === 'available'}>
        <div class="pref-local-language__target">
          <label class="pref-label" for="pref-translation-target">Translation language</label>
          <select
            id="pref-translation-target"
            class="pref-select"
            value={effectiveTarget()}
            onChange={(event) => setTranslationTarget(event.currentTarget.value)}
          >
            <For each={targetOptions()}>
              {(code) => <option value={code}>{languageLabel(code)}</option>}
            </For>
          </select>
          <p class="pref-desc">
            On-device target for the caption Translate action. Text is translated in this
            browser and never sent to an external endpoint.
          </p>
        </div>
      </Show>
    </section>
  );
}

function PwaReadinessPanel(): JSX.Element {
  const items = createMemo(() => pwaReadiness());
  const [updateResult, setUpdateResult] = createSignal<PwaUpdateRecoveryResult | null>(null);
  const [updateBusy, setUpdateBusy] = createSignal(false);

  async function recoverUpdate(): Promise<void> {
    setUpdateBusy(true);
    try {
      const result = await refreshInstalledAppShell();
      setUpdateResult(result);
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <section class="pref-group pref-pwa-readiness" aria-labelledby="pref-pwa-readiness-title">
      <div class="pref-group-head">
        <h3 id="pref-pwa-readiness-title" class="pref-label">Installed app readiness</h3>
        <a class="pref-a11y-link" href="/install/">Install guide</a>
      </div>
      <p class="pref-desc">
        Browser PWA and wrapper health on this device. Desktop shells should
        reuse these same routes, storage, update, and notification contracts.
      </p>
      <div class="pref-pwa-readiness__actions">
        <button type="button" class="pref-reset" disabled={updateBusy()} onClick={() => void recoverUpdate()}>
          Refresh app shell
        </button>
      </div>
      <Show when={updateResult()}>
        {(result) => (
          <p class="pref-status" role={result().state === 'failed' ? 'alert' : 'status'}>
            {result().detail}
          </p>
        )}
      </Show>
      <div class="pref-pwa-readiness__rows" role="list" aria-label="Installed app readiness checks">
        <For each={items()}>
          {(item) => (
            <div class="pref-pwa-readiness__row" role="listitem" data-state={item.state}>
              <span class="pref-pwa-readiness__status">{item.state}</span>
              <span class="pref-pwa-readiness__main">
                <span class="pref-pwa-readiness__title">{item.label}</span>
                <span class="pref-desc">{item.detail}</span>
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function VaultRetentionCard(): JSX.Element {
  const initial = sanitizeRetentionPolicy(getRetentionPolicy() ?? readRetentionPolicy());
  setRetentionPolicy(initial);
  const [policy, setPolicy] = createSignal<RetentionPolicy>(initial);
  const [status, setStatus] = createSignal<string | null>(null);

  onCleanup(subscribeRetentionPolicy((next) => setPolicy(next)));

  function keepOption(): VaultKeepOption {
    const value = String(policy().keep);
    return VAULT_KEEP_OPTIONS.includes(value as VaultKeepOption)
      ? (value as VaultKeepOption)
      : String(VAULT_KEEP) as VaultKeepOption;
  }

  function ageOption(): VaultAgeOption {
    const value = policy().maxAgeDays;
    if (value === undefined) return 'none';
    const key = String(value);
    return VAULT_AGE_OPTIONS.includes(key as VaultAgeOption) ? (key as VaultAgeOption) : 'none';
  }

  function applyPolicy(next: RetentionPolicy): void {
    const safe = sanitizeRetentionPolicy(next);
    setPolicy(safe);
    const saved = writeRetentionPolicy(safe);
    setStatus('Applying local history limit…');
    void applyRetentionPolicy(safe).then((pruned) => {
      setStatus(
        saved && pruned
          ? 'Local history limit saved and existing messages pruned for this device.'
          : saved
            ? 'Local history limit saved; the vault is unavailable in this browser session.'
            : 'Limit applied for this session, but this browser could not save it.',
      );
    });
  }

  function setKeep(value: VaultKeepOption): void {
    applyPolicy({ ...policy(), keep: Number(value) });
  }

  function setAge(value: VaultAgeOption): void {
    const current = policy();
    if (value === 'none') {
      const next: RetentionPolicy = { keep: current.keep };
      if (current.perChannel) next.perChannel = current.perChannel;
      applyPolicy(next);
      return;
    }
    applyPolicy({ ...current, maxAgeDays: Number(value) });
  }

  return (
    <section class="pref-group pref-vault-retention" aria-labelledby="pref-vault-retention-title">
      <div class="pref-group-head">
        <h3 id="pref-vault-retention-title" class="pref-label">On-device history</h3>
        <span class="pref-vault-retention__scope">This device</span>
      </div>
      <p class="pref-desc">
        Choose how much recent history this browser keeps for fast opening, offline reading, and
        device-memory search. Older messages are pruned automatically. Encrypted DM plaintext is
        never stored.
      </p>
      <div class="pref-vault-retention__controls">
        <Segmented
          legend="Messages per conversation"
          description="The newest messages retained for each room or DM on this device."
          options={VAULT_KEEP_OPTIONS}
          labels={VAULT_KEEP_LABELS}
          value={keepOption}
          onSelect={setKeep}
        />
        <Segmented
          legend="Maximum local age"
          description="Also prune messages older than this age, even when the message limit has room."
          options={VAULT_AGE_OPTIONS}
          labels={VAULT_AGE_LABELS}
          value={ageOption}
          onSelect={setAge}
        />
      </div>
      <p class="pref-vault-retention__boundary">
        This changes only Onyx's private vault in this browser. It does not change server history
        or a room's EPHEMERAL retention setting.
      </p>
      <Show when={status()}>
        <p class="pref-status" role="status">{status()}</p>
      </Show>
    </section>
  );
}

function ClearLocalHistoryControls(): JSX.Element {
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);

  async function clearNow(): Promise<void> {
    setBusy(true);
    try {
      const cleared = await clearVault();
      setStatus(cleared
        ? 'Local history cleared on this device.'
        : 'Could not clear all local history. Try again after freeing storage.');
    } catch {
      setStatus('Could not clear local history. Try again after freeing storage.');
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-clear-history" aria-labelledby="pref-clear-history-title">
      <div class="pref-group-head">
        <h3 id="pref-clear-history-title" class="pref-label">Clear local history</h3>
      </div>
      <p class="pref-desc">
        Erase every message stored in this browser's vault and its pending outbox. This does not
        affect other devices or the server; rooms refill as new messages arrive.
      </p>
      <Show
        when={confirming()}
        fallback={
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              onClick={() => {
                setStatus(null);
                setConfirming(true);
              }}
            >
              Clear local history
            </button>
          </div>
        }
      >
        <div class="pref-clear-history__confirm" role="group" aria-label="Confirm clear local history">
          <p class="pref-desc">This permanently erases stored history on this device.</p>
          <div class="pref-clear-history__actions">
            <button
              type="button"
              class="pref-reset pref-reset--danger"
              disabled={busy()}
              onClick={() => void clearNow()}
            >
              Erase history
            </button>
            <button
              type="button"
              class="pref-reset"
              disabled={busy()}
              onClick={() => setConfirming(false)}
            >
              Keep history
            </button>
          </div>
        </div>
      </Show>
      <Show when={status()}>
        <p class="pref-status" role="status">{status()}</p>
      </Show>
    </section>
  );
}

function PreferenceSection(props: { title: string; description: string }): JSX.Element {
  return (
    <div class="pref-section">
      <h3 class="pref-section-title">{props.title}</h3>
      <p class="pref-desc">{props.description}</p>
    </div>
  );
}

function AppearanceLauncher(): JSX.Element {
  function openAppearanceFromPreferences(): void {
    closePreferences();
    getState().openAppearance();
  }

  return (
    <section class="pref-group pref-appearance-entry" aria-labelledby="pref-appearance-entry-title">
      <button
        type="button"
        class="pref-action-card"
        aria-haspopup="dialog"
        onClick={openAppearanceFromPreferences}
      >
        <span class="pref-action-card__icon" aria-hidden="true">◐</span>
        <span class="pref-action-card__body">
          <span id="pref-appearance-entry-title" class="pref-action-card__title">Theme and background</span>
          <span class="pref-desc">
            Open Appearance for themes, room atmosphere, shared theme import, and background selection.
          </span>
        </span>
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
        <AppearanceLauncher />

        <PreferenceSection
          title="Display"
          description="Reading rhythm, type scale, and transcript behavior."
        />

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

        <PreferenceSection
          title="Feature switches"
          description="Turn off optional channel surfaces on this device. Core chat stays available."
        />

        <Toggle
          legend="Time scrubber"
          title="Show 24-hour activity strip"
          description="Shows the channel activity bars and moment jump affordance above the transcript."
          value={() => preferences().timeScrubber}
          onToggle={(value) => setPreference('timeScrubber', value)}
        />

        <Toggle
          legend="Voice and video"
          title="Show join voice/video controls"
          description="Keeps media available in the app, but removes the channel header voice/video controls when off."
          value={() => preferences().voiceEntry}
          onToggle={(value) => setPreference('voiceEntry', value)}
        />

        <Toggle
          legend="Topic tools"
          title="Show topic, forum, and follow controls"
          description="Removes the topic creation row and forum/follow buttons above channel messages."
          value={() => preferences().topicTools}
          onToggle={(value) => setPreference('topicTools', value)}
        />

        <Toggle
          legend="Watch together"
          title="Show shared watch activity"
          description="Hides the synchronized watch activity strip when a room has one."
          value={() => preferences().watchTogether}
          onToggle={(value) => setPreference('watchTogether', value)}
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

        <ClearReviewedAnchorsControls />

        <PreferenceSection
          title="Search & history"
          description="How on-device search matches, what this browser keeps, and how to erase it."
        />

        <Segmented
          legend="Default search mode"
          description="Which matching a device-memory search starts in: Text + related (literal matches, then token-similar terms), Exact (literal substring), or Related terms (token similarity only). All run in this browser — nothing is sent anywhere."
          options={VAULT_SEARCH_MODES}
          labels={VAULT_SEARCH_MODE_LABELS}
          value={() => defaultVaultSearchMode()}
          onSelect={(value) => {
            setDefaultVaultSearchMode(value);
            setVaultMode(value);
          }}
        />

        <DiscardQueuedSendsControls />

        <DiscardLocalDraftsControls />

        <ClearFollowedConversationsControls />

        <ClearSavedSearchesControls />

        <ClearTopicReadPositionsControls />

        <VaultRetentionCard />

        <ClearLocalHistoryControls />

        <DiscordImportControls />

        <DiscordPackageImportControls />

        <DiscordBotImportControls />

        <SlackImportControls />

        <IrcLogImportControls />

        <PwaReadinessPanel />

        <ExtensionActionManifestControls />

        <ExtensionAuditControls />

        <LocalLanguageTools />

        <PreferenceSection
          title="Accessibility"
          description="Motion, transparency, and verified access surfaces."
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

        <Toggle
          legend="Transparency"
          title="Reduce transparency"
          description="Flatten glassy overlays and translucent panels for stronger separation from the background."
          value={() => preferences().reduceTransparency}
          onToggle={(value) => setPreference('reduceTransparency', value)}
        />

        <Toggle
          legend="Contrast"
          title="Raise interface contrast"
          description="Strengthens text, borders, focus outlines, and panel separation across the active theme."
          value={() => preferences().highContrast}
          onToggle={(value) => setPreference('highContrast', value)}
        />

        <AccessibilityAuditLedger />

        <button type="button" class="pref-reset" onClick={() => resetAllPreferences()}>
          Reset to defaults
        </button>
      </div>
    </Sheet>
  );
}
