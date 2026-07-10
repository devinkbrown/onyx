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

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { clearVault, importVault, VAULT_KEEP } from '@/lib/vault/historyVault';
import { parseDiscordExport } from '@/lib/import/discordImport';
import { parseSlackExport } from '@/lib/import/slackImport';
import { parseIrcLog } from '@/lib/import/ircLogImport';
import {
  clearClientExtensionAudit,
  clearClientExtensionActions,
  exportClientExtensionActionManifest,
  parseClientExtensionActionManifest,
  readClientExtensionAudit,
  readClientExtensionActions,
  type ClientExtensionAuditEntry,
} from '@/lib/extensions/clientActions';
import { getState } from '@/lib/store';
import {
  exportPortableTransfer,
  importPortableTransfer,
  parsePortableTransfer,
  type PortableTransferSnapshot,
} from '@/lib/vault/portableTransfer';
import { localTranslationReadiness, preferredTranslationTarget } from '@/lib/intelligence/localLanguage';
import { pwaReadiness } from '@/pwa/readiness';
import { refreshInstalledAppShell } from '@/pwa/updateRecovery';
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

function resetAllPreferences(): void {
  resetPreferences();
  resetSceneMotion();
}

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
    topicDrafts: number;
    accountHandoffs: number;
    preferenceHandoffs: number;
    followedConversations: number;
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
      setStatus(`Exported ${countLabel(messageCount, 'message')}, ${countLabel(snapshot.targets.length, 'target')}, ${countLabel(snapshot.reviewHistory.length, 'review')}, ${countLabel(draftCount, 'room draft')}, ${countLabel(topicDraftCount, 'topic draft')}, ${countLabel(snapshot.followedConversations.length, 'followed conversation')}, ${countLabel(snapshot.accountHandoffs.length, 'account handoff')}, and ${countLabel(snapshot.preferenceHandoff ? 1 : 0, 'preference set')}.`);
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
      const topicDrafts = Object.keys(parsed.channelTopicDrafts).length;
      const accountHandoffs = parsed.accountHandoffs.length;
      const preferenceHandoffs = parsed.preferenceHandoff ? 1 : 0;
      const followedConversations = parsed.followedConversations.length;
      setPendingImport({ fileName: file.name, snapshot: parsed, messages, drafts, topicDrafts, accountHandoffs, preferenceHandoffs, followedConversations });
      setStatus(`Ready to import ${countLabel(messages, 'message')}, ${countLabel(parsed.targets.length, 'target')}, ${countLabel(parsed.reviewHistory.length, 'review')}, ${countLabel(drafts, 'room draft')}, ${countLabel(topicDrafts, 'topic draft')}, ${countLabel(followedConversations, 'followed conversation')}, ${countLabel(accountHandoffs, 'account handoff')}, and ${countLabel(preferenceHandoffs, 'preference set')}.`);
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
      setStatus(`Imported ${countLabel(result.messages, 'message')}, ${countLabel(result.targets, 'target')}, ${countLabel(result.reviews, 'review')}, ${countLabel(result.drafts, 'room draft')}, ${countLabel(result.topicDrafts, 'topic draft')}, ${countLabel(result.followedConversations, 'followed conversation')}, ${countLabel(result.accountHandoffs, 'account handoff')}, and ${countLabel(result.preferenceHandoffs, 'preference set')}.`);
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
        Export or merge this device's local history, reviewed catch-up state, room composer drafts, channel topic drafts, followed rooms/topics, saved sign-in targets, and Preferences switches. Passwords, session tokens, mesh tokens, and encrypted DM plaintext are not included.
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
              {' '}{countLabel(pending().accountHandoffs, 'account handoff')}, and
              {' '}{countLabel(pending().preferenceHandoffs, 'preference set')}. Existing local history, followed rooms/topics, saved sign-in targets, and Preferences switches are merged, not replaced.
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

/** Structural shape shared by every JSON-export importer (Discord, Slack, …). */
interface VaultImportSummaryLike {
  channels: number;
  messages: number;
  skipped: number;
  droppedOverCap: number;
  oldest: string | null;
  newest: string | null;
  guild?: string | null;
}

interface VaultImportResultLike {
  snapshot: import('@/lib/vault/historyVault').VaultExportSnapshot;
  summary: VaultImportSummaryLike;
}

interface PendingJsonImport {
  fileNames: string[];
  snapshots: import('@/lib/vault/historyVault').VaultExportSnapshot[];
  channels: number;
  messages: number;
  skipped: number;
  droppedOverCap: number;
  guild: string | null;
  oldest: string | null;
  newest: string | null;
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

interface JsonVaultImportProps {
  /** Slug used to build unique aria ids (e.g. 'discord', 'slack'). */
  id: string;
  title: string;
  chooseLabel: string;
  /** Shown when no file yields a recognizable export. */
  rejectMessage: string;
  description: JSX.Element;
  /** Pure transform: parsed JSON → vault snapshot, or null if unrecognized. */
  parse: (raw: unknown) => VaultImportResultLike | null;
}

/**
 * Generic on-device "import history from a JSON export" control: choose one or
 * more JSON files, preview an aggregate summary, then merge into the local
 * vault via importVault. Discord and Slack share this body; only the parser and
 * the surrounding copy differ. Everything runs on-device — no upload, no API.
 */
function JsonVaultImportControls(props: JsonVaultImportProps): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<PendingJsonImport | null>(null);

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const snapshots: PendingJsonImport['snapshots'] = [];
      const fileNames: string[] = [];
      const targets = new Set<string>();
      let messages = 0;
      let skipped = 0;
      let droppedOverCap = 0;
      let guild: string | null = null;
      let oldest: string | null = null;
      let newest: string | null = null;
      let rejected = 0;

      for (const file of files) {
        let raw: unknown;
        try {
          raw = JSON.parse(await file.text());
        } catch {
          rejected += 1;
          continue;
        }
        const result = props.parse(raw);
        if (!result) {
          rejected += 1;
          continue;
        }
        const summary = result.summary;
        snapshots.push(result.snapshot);
        fileNames.push(file.name);
        for (const t of result.snapshot.targets) targets.add(t.target);
        messages += summary.messages;
        skipped += summary.skipped;
        droppedOverCap += summary.droppedOverCap;
        if (!guild && summary.guild) guild = summary.guild;
        if (summary.oldest && (!oldest || summary.oldest < oldest)) oldest = summary.oldest;
        if (summary.newest && (!newest || summary.newest > newest)) newest = summary.newest;
      }

      if (snapshots.length === 0) {
        setPending(null);
        setStatus(props.rejectMessage);
        return;
      }
      setPending({ fileNames, snapshots, channels: targets.size, messages, skipped, droppedOverCap, guild, oldest, newest });
      const rejectedNote = rejected > 0 ? ` ${countLabel(rejected, 'file')} skipped as unreadable.` : '';
      setStatus(`Ready to import ${countLabel(messages, 'message')} across ${countLabel(targets.size, 'channel')}${guild ? ` from ${guild}` : ''}.${rejectedNote}`);
    } catch {
      setPending(null);
      setStatus(props.rejectMessage);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    setBusy(true);
    try {
      let imported = 0;
      for (const snapshot of job.snapshots) {
        const result = await importVault(snapshot);
        imported += result.messages;
      }
      setPending(null);
      setStatus(`Imported ${countLabel(imported, 'message')} into ${countLabel(job.channels, 'channel')}. Open a channel to read the history, or search it from anywhere.`);
    } catch {
      setStatus('Import failed while merging into the local vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class={`pref-group pref-vault-portable pref-${props.id}-import`} aria-labelledby={`pref-${props.id}-import-title`}>
      <div class="pref-group-head">
        <h3 id={`pref-${props.id}-import-title`} class="pref-label">{props.title}</h3>
      </div>
      <p class="pref-desc">{props.description}</p>
      <div class="pref-vault-actions">
        <label class="pref-file">
          <span>{props.chooseLabel}</span>
          <input
            type="file"
            accept="application/json,.json"
            multiple
            disabled={busy()}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby={`pref-${props.id}-review-title`}>
            <h4 id={`pref-${props.id}-review-title`}>Review import</h4>
            <p>
              {countLabel(job().fileNames.length, 'file')}: {countLabel(job().messages, 'message')} across {countLabel(job().channels, 'channel')}
              {job().guild ? ` from ${job().guild}` : ''}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'system/empty message')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-channel limit dropped.` : ''}
              {' '}Existing local history is merged, not replaced.
            </p>
            <div class="pref-import-review__actions">
              <button type="button" class="pref-reset" disabled={busy()} onClick={() => void confirmImport()}>
                Import into vault
              </button>
              <button
                type="button"
                class="pref-reset"
                disabled={busy()}
                onClick={() => {
                  setPending(null);
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

/** Import Discord history from a DiscordChatExporter JSON export. */
function DiscordImportControls(): JSX.Element {
  return (
    <JsonVaultImportControls
      id="discord"
      title="Import from Discord"
      chooseLabel="Choose Discord JSON"
      rejectMessage="No Discord export recognized. Export channels from DiscordChatExporter in JSON mode, then choose those .json files."
      parse={(raw) => parseDiscordExport(raw)}
      description={
        <>
          Leaving Discord? Export your channels with{' '}
          <a href="https://github.com/Tyrrrz/DiscordChatExporter" target="_blank" rel="noreferrer noopener">DiscordChatExporter</a>{' '}
          in <strong>JSON</strong> mode, then choose the files here. Everything happens on this device — no bot token, no upload, nothing sent to Discord. Imported history becomes searchable, time-travellable scrollback merged into this device's vault (up to the newest {VAULT_KEEP} messages per channel).
        </>
      }
    />
  );
}

/** Import Slack history from an unzipped workspace export (channel JSON). */
function SlackImportControls(): JSX.Element {
  return (
    <JsonVaultImportControls
      id="slack"
      title="Import from Slack"
      chooseLabel="Choose Slack JSON"
      rejectMessage="No Slack export recognized. Unzip your Slack workspace export and choose its per-channel .json files."
      parse={(raw) => {
        const result = parseSlackExport(raw);
        if (!result) return null;
        // The generic control speaks `guild`; Slack calls it a workspace.
        return { snapshot: result.snapshot, summary: { ...result.summary, guild: result.summary.workspace } };
      }}
      description={
        <>
          Leaving Slack? Request your workspace export (Slack → Settings & administration → Workspace settings → Import/Export Data), unzip it, and choose the per-channel <strong>JSON</strong> files here. Everything happens on this device — nothing is uploaded. Imported history merges into this device's vault (up to the newest {VAULT_KEEP} messages per channel).
        </>
      }
    />
  );
}

interface PendingIrcLogImport {
  fileName: string;
  snapshot: import('@/lib/vault/historyVault').VaultExportSnapshot;
  channel: string;
  messages: number;
  skipped: number;
  droppedOverCap: number;
  oldest: string | null;
  newest: string | null;
}

/**
 * Import a plain-text IRC log (weechat / irssi / mIRC) into one channel. Unlike
 * the JSON importers, a raw log names no channel, so the operator supplies it.
 */
function IrcLogImportControls(): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [channel, setChannel] = createSignal('');
  const [pending, setPending] = createSignal<PendingIrcLogImport | null>(null);

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    const chan = channel().trim();
    if (!chan) {
      setStatus('Enter the channel these logs belong to first (e.g. #dev).');
      return;
    }
    setBusy(true);
    try {
      const result = parseIrcLog(await file.text(), { channel: chan });
      if (!result || result.summary.messages === 0) {
        setPending(null);
        setStatus('No recognizable log lines found. Supported: weechat, irssi, and mIRC text logs.');
        return;
      }
      const s = result.summary;
      setPending({ fileName: file.name, snapshot: result.snapshot, channel: chan, messages: s.messages, skipped: s.skipped, droppedOverCap: s.droppedOverCap, oldest: s.oldest, newest: s.newest });
      setStatus(`Ready to import ${countLabel(s.messages, 'message')} into ${chan}.`);
    } catch {
      setPending(null);
      setStatus('Could not read that log file.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    setBusy(true);
    try {
      const result = await importVault(job.snapshot);
      setPending(null);
      setStatus(`Imported ${countLabel(result.messages, 'message')} into ${job.channel}. Open it to read the history, or search from anywhere.`);
    } catch {
      setStatus('Import failed while merging into the local vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable pref-irclog-import" aria-labelledby="pref-irclog-import-title">
      <div class="pref-group-head">
        <h3 id="pref-irclog-import-title" class="pref-label">Import an IRC log</h3>
      </div>
      <p class="pref-desc">
        Have a plain-text log from another client (weechat, irssi, mIRC)? Name the channel it belongs to, then choose the log file. It's parsed on-device and merged into this device's vault (up to the newest {VAULT_KEEP} messages).
      </p>
      <div class="pref-vault-actions">
        <label class="pref-file pref-irclog-channel">
          <span>Channel</span>
          <input
            type="text"
            inputmode="text"
            placeholder="#dev"
            value={channel()}
            disabled={busy()}
            onInput={(event) => setChannel(event.currentTarget.value)}
          />
        </label>
        <label class="pref-file">
          <span>Choose log file</span>
          <input
            type="file"
            accept="text/plain,.log,.txt,.weechatlog"
            disabled={busy()}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-irclog-review-title">
            <h4 id="pref-irclog-review-title">Review import</h4>
            <p>
              {job().fileName}: {countLabel(job().messages, 'message')} into {job().channel}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'unparseable/filtered line')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-channel limit dropped.` : ''}
              {' '}Existing local history is merged, not replaced.
            </p>
            <div class="pref-import-review__actions">
              <button type="button" class="pref-reset" disabled={busy()} onClick={() => void confirmImport()}>
                Import into vault
              </button>
              <button
                type="button"
                class="pref-reset"
                disabled={busy()}
                onClick={() => {
                  setPending(null);
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

function ExtensionActionManifestControls(): JSX.Element {
  const [actionCount, setActionCount] = createSignal(readClientExtensionActions().length);
  const [manifestText, setManifestText] = createSignal('');
  const [status, setStatus] = createSignal('');

  function importManifest(): void {
    const imported = parseClientExtensionActionManifest(manifestText());
    if (!imported) {
      setStatus('Manifest was not valid JSON with an actions array.');
      return;
    }
    setActionCount(imported.length);
    setStatus(`Imported ${countLabel(imported.length, 'safe action')}.`);
  }

  function exportManifest(): void {
    setManifestText(exportClientExtensionActionManifest());
    setStatus(`Exported ${countLabel(actionCount(), 'safe action')}.`);
  }

  function clearManifest(): void {
    clearClientExtensionActions();
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
        onInput={(event) => setManifestText(event.currentTarget.value)}
      />
      <div class="pref-import-review__actions">
        <button type="button" class="pref-reset" onClick={importManifest} disabled={!manifestText().trim()}>
          Import actions
        </button>
        <button type="button" class="pref-reset" onClick={exportManifest}>
          Export actions
        </button>
        <button type="button" class="pref-reset" onClick={clearManifest} disabled={actionCount() === 0}>
          Clear actions
        </button>
      </div>
      <Show when={status()}>
        <p class="pref-status" role="status">{status()}</p>
      </Show>
    </section>
  );
}

function LocalLanguageTools(): JSX.Element {
  const targetLanguage = createMemo(() => preferredTranslationTarget());
  const translation = createMemo(() => localTranslationReadiness(targetLanguage()));

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
    </section>
  );
}

function PwaReadinessPanel(): JSX.Element {
  const items = createMemo(() => pwaReadiness());
  const [updateStatus, setUpdateStatus] = createSignal<string | null>(null);
  const [updateBusy, setUpdateBusy] = createSignal(false);

  async function recoverUpdate(): Promise<void> {
    setUpdateBusy(true);
    try {
      const result = await refreshInstalledAppShell();
      setUpdateStatus(result.detail);
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
      <Show when={updateStatus()}>
        <p class="pref-status" role="status">{updateStatus()}</p>
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

        <DiscordImportControls />

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
