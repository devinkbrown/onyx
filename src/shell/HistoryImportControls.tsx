// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HistoryImportControls.tsx — on-device "import your history" controls.
 *
 * Extracted from PreferencesPanel so the panel stays focused and the import
 * flow is independently testable. Three importers, all credential-free and
 * fully on-device (no upload, no third-party API): Discord and Slack share the
 * generic JSON control; IRC logs use a bespoke control because a raw text log
 * names no channel. Every importer transforms its export into the vault
 * snapshot shape and merges it via importVault.
 *
 * SOLID IDIOMS: component runs once; never destructure props; For/Show.
 */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { selectDeviceMemoryOwner, useStore } from '@/lib/store';
import {
  deviceMemoryOwnerKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import { importVault, VAULT_KEEP } from '@/lib/vault/historyVault';
import type { DiscordPackageFile } from '@/lib/import/discordPackageImport';
import { countLabel } from '@/lib/format/countLabel';
import {
  DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
  DISCORD_PACKAGE_MAX_FILE_BYTES,
  DISCORD_PACKAGE_MAX_SELECTED_FILES,
  formatImportMib,
  GENERIC_JSON_MAX_AGGREGATE_BYTES,
  GENERIC_JSON_MAX_FILE_BYTES,
  GENERIC_JSON_MAX_FILES,
  IRC_LOG_MAX_AGGREGATE_BYTES,
  IRC_LOG_MAX_FILE_BYTES,
  IRC_LOG_MAX_FILES,
  validateImportFileSelection,
  type ImportFileLimitFailure,
} from './importFileLimits';
import '@/lib/prefs/preferences.css';

// The per-platform parsers (~1.6k LOC of Discord/Slack/IRC log-format logic) are
// only ever exercised when a user actually picks a file to import, yet this panel
// rides in the always-loaded app chunk. They're dynamically imported at file-pick
// so their weight stays out of the initial app bundle. Type-only imports above are
// erased at build and carry no runtime cost.

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

interface ImportOwnerScope {
  owner: DeviceMemoryOwner;
  ownerKey: string;
  epoch: number;
}

interface PendingJsonImport {
  ownerScope: ImportOwnerScope;
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

const GENERIC_JSON_LIMITS = {
  maxFiles: GENERIC_JSON_MAX_FILES,
  maxFileBytes: GENERIC_JSON_MAX_FILE_BYTES,
  maxAggregateBytes: GENERIC_JSON_MAX_AGGREGATE_BYTES,
} as const;

function jsonLimitMessage(failure: ImportFileLimitFailure): string {
  if (failure.kind === 'count') {
    return `Choose no more than ${failure.maxFiles} JSON files at once. Split this import into smaller batches.`;
  }
  if (failure.kind === 'file') {
    return `${failure.fileName} exceeds the ${formatImportMib(failure.maxFileBytes)} per-file JSON limit. Split or export it as smaller JSON files, then try again.`;
  }
  return `Those JSON files exceed the ${formatImportMib(failure.maxAggregateBytes)} total import limit. Choose a smaller batch.`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Defer focus until Solid has mounted or removed the conditional review UI. */
function focusSoon(target: () => HTMLElement | undefined): void {
  queueMicrotask(() => {
    const element = target();
    if (element?.isConnected) element.focus();
  });
}

const IMPORT_OWNER_REQUIRED = 'Connect to an account or guest session before importing history into this device vault.';

/**
 * Bind temporary import material and async completions to one vault owner.
 * Preferences stays mounted across account changes, so component lifetime is
 * not an ownership boundary by itself.
 */
function useImportOwner(onOwnerChange: () => void): {
  capture: () => ImportOwnerScope | null;
  isActive: (scope: ImportOwnerScope) => boolean;
} {
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  const initialOwner = memoryOwner();
  let activeOwnerKey = initialOwner ? deviceMemoryOwnerKey(initialOwner) : null;
  let epoch = 0;
  let disposed = false;

  createEffect(() => {
    const owner = memoryOwner();
    const nextOwnerKey = owner ? deviceMemoryOwnerKey(owner) : null;
    if (nextOwnerKey === activeOwnerKey) return;
    activeOwnerKey = nextOwnerKey;
    epoch += 1;
    onOwnerChange();
  });

  onCleanup(() => {
    disposed = true;
    activeOwnerKey = null;
    epoch += 1;
  });

  return {
    capture: () => {
      const owner = memoryOwner();
      const ownerKey = owner ? deviceMemoryOwnerKey(owner) : null;
      return !disposed && owner && ownerKey && ownerKey === activeOwnerKey
        ? { owner, ownerKey, epoch }
        : null;
    },
    isActive: (scope) => !disposed
      && scope.epoch === epoch
      && scope.ownerKey === activeOwnerKey,
  };
}

interface JsonVaultImportProps {
  /** Slug used to build unique aria ids (e.g. 'discord', 'slack'). */
  id: string;
  title: string;
  chooseLabel: string;
  /** Shown when no file yields a recognizable export. */
  rejectMessage: string;
  description: JSX.Element;
  /**
   * Lazily loads the pure parse transform (parsed JSON → vault snapshot, or null
   * if unrecognized). Resolved once per file-pick so the parser module stays out
   * of the initial bundle and only downloads when the user actually imports.
   */
  loadParse: () => Promise<(raw: unknown) => VaultImportResultLike | null>;
}

async function loadDiscordExportParser(): Promise<(raw: unknown) => VaultImportResultLike | null> {
  const { parseDiscordExport } = await import('@/lib/import/discordImport');
  return (raw) => parseDiscordExport(raw);
}

async function loadSlackExportParser(): Promise<(raw: unknown) => VaultImportResultLike | null> {
  const { parseSlackExport } = await import('@/lib/import/slackImport');
  return (raw) => {
    const result = parseSlackExport(raw);
    if (!result) return null;
    // The generic control speaks `guild`; Slack calls it a workspace.
    return { snapshot: result.snapshot, summary: { ...result.summary, guild: result.summary.workspace } };
  };
}

/**
 * Generic on-device "import history from a JSON export" control: choose one or
 * more JSON files, preview an aggregate summary, then merge into the local
 * vault via importVault. Discord and Slack share this body; only the parser and
 * the surrounding copy differ. Everything runs on-device — no upload, no API.
 */
export function JsonVaultImportControls(props: JsonVaultImportProps): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<PendingJsonImport | null>(null);
  let fileInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  const importOwner = useImportOwner(() => {
    setPending(null);
    setStatus(null);
    setBusy(false);
  });

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    const limitFailure = validateImportFileSelection(files, GENERIC_JSON_LIMITS);
    if (limitFailure) {
      setPending(null);
      setStatus(jsonLimitMessage(limitFailure));
      return;
    }
    const ownerScope = importOwner.capture();
    if (!ownerScope) {
      setPending(null);
      setStatus(IMPORT_OWNER_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      const parse = await props.loadParse();
      if (!importOwner.isActive(ownerScope)) return;
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
        if (!importOwner.isActive(ownerScope)) return;
        const result = parse(raw);
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
      setPending({ ownerScope, fileNames, snapshots, channels: targets.size, messages, skipped, droppedOverCap, guild, oldest, newest });
      const rejectedNote = rejected > 0 ? ` ${countLabel(rejected, 'file')} skipped as unreadable.` : '';
      setStatus(`Ready to import ${countLabel(messages, 'message')} across ${countLabel(targets.size, 'room')}${guild ? ` from ${guild}` : ''}.${rejectedNote}`);
      focusSoon(() => reviewHeading);
    } catch {
      if (!importOwner.isActive(ownerScope)) return;
      setPending(null);
      setStatus(props.rejectMessage);
    } finally {
      if (importOwner.isActive(ownerScope)) setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    if (!importOwner.isActive(job.ownerScope)) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      let imported = 0;
      for (const snapshot of job.snapshots) {
        const result = await importVault(snapshot, job.ownerScope.owner, {
          isCurrent: () => importOwner.isActive(job.ownerScope),
        });
        if (!importOwner.isActive(job.ownerScope)) return;
        imported += result.messages;
      }
      setPending(null);
      setStatus(`Imported ${countLabel(imported, 'message')} into ${countLabel(job.channels, 'room')}. Open a room to read the history, or search it from anywhere.`);
      focusSoon(() => fileInput);
    } catch {
      if (!importOwner.isActive(job.ownerScope)) return;
      setStatus('Import failed while merging into the local vault.');
    } finally {
      if (importOwner.isActive(job.ownerScope)) setBusy(false);
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
            ref={fileInput}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby={`pref-${props.id}-review-title`}>
            <h4 id={`pref-${props.id}-review-title`} tabindex={-1} ref={reviewHeading}>Review import</h4>
            <p>
              {countLabel(job().fileNames.length, 'file')}: {countLabel(job().messages, 'message')} across {countLabel(job().channels, 'room')}
              {job().guild ? ` from ${job().guild}` : ''}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'system/empty message')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-room limit dropped.` : ''}
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
                  focusSoon(() => fileInput);
                }}
              >
                Cancel import
              </button>
            </div>
          </div>
        )}
      </Show>
      {/* Always-present polite live region: a status node created together with
          its text is often NOT announced (the region must pre-exist in the DOM),
          so keep it mounted and let its text change announce import progress. */}
      <p class="pref-status" role="status" aria-live="polite" aria-atomic="true">{status() ?? ''}</p>
    </section>
  );
}

/** Import Discord history from a DiscordChatExporter JSON export. */
export function DiscordImportControls(): JSX.Element {
  return (
    <JsonVaultImportControls
      id="discord"
      title="Import from Discord"
      chooseLabel="Choose Discord JSON"
      rejectMessage="No Discord export recognized. Export with DiscordChatExporter in JSON mode, then choose those .json files."
      loadParse={loadDiscordExportParser}
      description={
        <>
          Leaving Discord? Export your Discord rooms with{' '}
          <a href="https://github.com/Tyrrrz/DiscordChatExporter" target="_blank" rel="noreferrer noopener">DiscordChatExporter</a>{' '}
          in <strong>JSON</strong> mode, then choose the files here. Everything happens on this device — no bot token, no upload, nothing sent to Discord. Imported history becomes searchable, time-travellable scrollback merged into this device's vault (up to the newest {VAULT_KEEP} messages per room).
        </>
      }
    />
  );
}

interface PendingPackageImport {
  ownerScope: ImportOwnerScope;
  snapshot: import('@/lib/vault/historyVault').VaultExportSnapshot;
  channels: number;
  messages: number;
  skipped: number;
  droppedOverCap: number;
  guild: string | null;
  oldest: string | null;
  newest: string | null;
}

/** Only these files in a Discord package carry channel identity or messages. */
function isPackageFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'channel.json' ||
    lower === 'messages.json' ||
    lower === 'messages.csv' ||
    lower === 'index.json' ||
    lower === 'user.json'
  );
}

const DISCORD_PACKAGE_LIMITS = {
  maxFiles: DISCORD_PACKAGE_MAX_SELECTED_FILES,
  maxFileBytes: DISCORD_PACKAGE_MAX_FILE_BYTES,
  maxAggregateBytes: DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
} as const;

function discordPackageLimitMessage(failure: ImportFileLimitFailure): string {
  if (failure.kind === 'count') {
    return `That folder contains more than ${failure.maxFiles} selected files. Choose a smaller unzipped Discord package folder.`;
  }
  if (failure.kind === 'file') {
    return `${failure.fileName} exceeds the ${formatImportMib(failure.maxFileBytes)} per-file Discord package limit. Remove that Discord export file or choose a smaller package.`;
  }
  return `Recognized Discord package files exceed the ${formatImportMib(failure.maxAggregateBytes)} total import limit. Choose a smaller package folder.`;
}

/**
 * Import Discord's OFFICIAL self-serve data package — the export every user can
 * request themselves (Settings → Privacy & Safety → "Request all of my Data"),
 * with no third-party tool. The package is a folder tree, so this uses a
 * directory picker and correlates channel.json / index.json / messages.json|csv
 * on-device via {@link parseDiscordPackage}. Only the requesting user's own
 * messages exist in this export — surfaced honestly in the copy and summary.
 */
export function DiscordPackageImportControls(): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<PendingPackageImport | null>(null);
  let packageInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  const importOwner = useImportOwner(() => {
    setPending(null);
    setStatus(null);
    setBusy(false);
  });

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    if (files.length > DISCORD_PACKAGE_MAX_SELECTED_FILES) {
      setPending(null);
      setStatus(discordPackageLimitMessage({ kind: 'count', maxFiles: DISCORD_PACKAGE_MAX_SELECTED_FILES }));
      return;
    }
    // Only recognized package payloads are read or charged to the byte budget.
    // Unrelated account-package files are ignored before aggregate accounting.
    const recognizedFiles = files.filter(file => isPackageFileName(file.name));
    const limitFailure = validateImportFileSelection(
      recognizedFiles.map(file => ({
        name: file.webkitRelativePath || file.name,
        size: file.size,
      })),
      DISCORD_PACKAGE_LIMITS,
    );
    if (limitFailure) {
      setPending(null);
      setStatus(discordPackageLimitMessage(limitFailure));
      return;
    }
    const ownerScope = importOwner.capture();
    if (!ownerScope) {
      setPending(null);
      setStatus(IMPORT_OWNER_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      const packageFiles: DiscordPackageFile[] = [];
      for (const file of recognizedFiles) {
        const path = file.webkitRelativePath || file.name;
        packageFiles.push({ path, text: await file.text() });
        if (!importOwner.isActive(ownerScope)) return;
      }
      const { parseDiscordPackage } = await import('@/lib/import/discordPackageImport');
      if (!importOwner.isActive(ownerScope)) return;
      const result = parseDiscordPackage(packageFiles);
      if (!result || result.summary.messages === 0) {
        setPending(null);
        setStatus('No Discord data package found. Unzip the package Discord emails you and choose its folder (it contains a "messages" folder).');
        return;
      }
      const s = result.summary;
      setPending({
        ownerScope,
        snapshot: result.snapshot,
        channels: s.channels,
        messages: s.messages,
        skipped: s.skipped,
        droppedOverCap: s.droppedOverCap,
        guild: s.guild,
        oldest: s.oldest,
        newest: s.newest,
      });
      setStatus(`Ready to import ${countLabel(s.messages, 'message')} across ${countLabel(s.channels, 'room')}${s.guild ? ` from ${s.guild}` : ''}.`);
      focusSoon(() => reviewHeading);
    } catch {
      if (!importOwner.isActive(ownerScope)) return;
      setPending(null);
      setStatus('Could not read that folder as a Discord data package.');
    } finally {
      if (importOwner.isActive(ownerScope)) setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    if (!importOwner.isActive(job.ownerScope)) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      const result = await importVault(job.snapshot, job.ownerScope.owner, {
        isCurrent: () => importOwner.isActive(job.ownerScope),
      });
      if (!importOwner.isActive(job.ownerScope)) return;
      setPending(null);
      setStatus(`Imported ${countLabel(result.messages, 'message')} into ${countLabel(job.channels, 'room')}. Open a room to read the history, or search it from anywhere.`);
      focusSoon(() => packageInput);
    } catch {
      if (!importOwner.isActive(job.ownerScope)) return;
      setStatus('Import failed while merging into the local vault.');
    } finally {
      if (importOwner.isActive(job.ownerScope)) setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable pref-discord-package-import" aria-labelledby="pref-discord-package-import-title">
      <div class="pref-group-head">
        <h3 id="pref-discord-package-import-title" class="pref-label">Import a Discord data package</h3>
      </div>
      <p class="pref-desc">
        No third-party tool? In Discord go to <strong>Settings → Privacy &amp; Safety → Request all of my Data</strong>. When the package arrives, unzip it and choose the folder here. Everything happens on this device — nothing is sent to Discord. Note that Discord's package only contains <em>your own</em> messages. Imported history merges into this device's vault (up to the newest {VAULT_KEEP} messages per room).
      </p>
      <div class="pref-vault-actions">
        <label class="pref-file">
          <span>Choose package folder</span>
          <input
            type="file"
            multiple
            disabled={busy()}
            ref={(element) => {
              packageInput = element;
              element.setAttribute('webkitdirectory', '');
            }}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-discord-package-review-title">
            <h4 id="pref-discord-package-review-title" tabindex={-1} ref={reviewHeading}>Review import</h4>
            <p>
              {countLabel(job().messages, 'message')} across {countLabel(job().channels, 'room')}
              {job().guild ? ` from ${job().guild}` : ''}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'system/empty message')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-room limit dropped.` : ''}
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
                  focusSoon(() => packageInput);
                }}
              >
                Cancel import
              </button>
            </div>
          </div>
        )}
      </Show>
      {/* Always-present polite live region (see JsonVaultImportControls). */}
      <p class="pref-status" role="status" aria-live="polite" aria-atomic="true">{status() ?? ''}</p>
    </section>
  );
}

interface PendingBotImport {
  ownerScope: ImportOwnerScope;
  snapshot: import('@/lib/vault/historyVault').VaultExportSnapshot;
  channels: number;
  messages: number;
  skipped: number;
  droppedOverCap: number;
  guild: string | null;
  oldest: string | null;
  newest: string | null;
  fetched: number;
  pins: number;
  rolesSkipped: number;
  categoriesSkipped: number;
  channelsFailed: number;
}

/** Only pull messages newer than this many days over the bot-token path. */
const BOT_IMPORT_SINCE_DAYS = 365;

/**
 * Import a whole Discord SERVER's history over a bot token (Roadmap v1.0
 * "product entry"). Unlike the file-based Discord importers, this walks the guild LIVE
 * via the same-origin read-only proxy (`/discord-import/…` → discord.com/api/v10):
 * it enumerates the server's text/announcement/forum channels and pulls each
 * one's scrollback + pins. The bot token is SESSION-ONLY: it lives in a Solid
 * signal for the run and is zeroed at end-of-run and on unmount — never
 * persisted, never logged, never placed in the exported snapshot.
 */
export function DiscordBotImportControls(): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [token, setToken] = createSignal('');
  const [guildId, setGuildId] = createSignal('');
  const [proxyAcknowledged, setProxyAcknowledged] = createSignal(false);
  const [pending, setPending] = createSignal<PendingBotImport | null>(null);
  const [abort, setAbort] = createSignal<AbortController | null>(null);
  let tokenInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  const importOwner = useImportOwner(() => {
    abort()?.abort();
    setAbort(null);
    setToken('');
    setGuildId('');
    setProxyAcknowledged(false);
    setPending(null);
    setStatus(null);
    setBusy(false);
  });

  // Token contract: on unmount, abort any in-flight fetch (so the run's
  // finally disposes the client and releases its token copy immediately) and
  // zero the signal — the only two retained handles to the token.
  onCleanup(() => {
    abort()?.abort();
    setToken('');
    setProxyAcknowledged(false);
  });

  async function handleFetch(): Promise<void> {
    if (!proxyAcknowledged()) {
      setStatus('Acknowledge the import proxy disclosure before fetching history.');
      return;
    }
    const tok = token().trim();
    const guild = guildId().trim();
    if (!tok) {
      setStatus('Paste your bot token first.');
      return;
    }
    if (!/^\d{1,20}$/.test(guild)) {
      setStatus('Enter the numeric Server ID (turn on Developer Mode, then right-click the server icon → Copy Server ID).');
      return;
    }
    const ownerScope = importOwner.capture();
    if (!ownerScope) {
      setPending(null);
      setStatus(IMPORT_OWNER_REQUIRED);
      return;
    }
    const controller = new AbortController();
    setAbort(controller);
    setPending(null);
    setBusy(true);
    setStatus('Connecting to Discord…');
    try {
      const { runDiscordGuildImport } = await import('@/lib/import/discordSnapshotImport');
      if (!importOwner.isActive(ownerScope)) return;
      const res = await runDiscordGuildImport({
        token: tok,
        guildId: guild,
        sinceDays: BOT_IMPORT_SINCE_DAYS,
        signal: controller.signal,
        onProgress: (p) => {
          if (importOwner.isActive(ownerScope)) {
            setStatus(
              `Importing ${p.channelName} (room ${p.channelIndex} of ${p.channelCount})… ${countLabel(p.fetched, 'message')} so far.`,
            );
          }
        },
      });
      if (!importOwner.isActive(ownerScope)) return;
      const s = res.result.summary;
      setPending({
        ownerScope,
        snapshot: res.result.snapshot,
        channels: s.channels,
        messages: s.messages,
        skipped: s.skipped,
        droppedOverCap: s.droppedOverCap,
        guild: s.guild,
        oldest: s.oldest,
        newest: s.newest,
        fetched: res.fetched,
        pins: res.pinsImported,
        rolesSkipped: res.rolesSkipped,
        categoriesSkipped: res.categoriesSkipped,
        channelsFailed: res.channelsFailed,
      });
      setStatus(
        `Ready to import ${countLabel(s.messages, 'message')} across ${countLabel(s.channels, 'room')}${s.guild ? ` from ${s.guild}` : ''}.`,
      );
      focusSoon(() => reviewHeading);
    } catch (err) {
      if (!importOwner.isActive(ownerScope)) return;
      setPending(null);
      // DiscordImportError.message is already user-safe and never contains the token.
      setStatus(err instanceof Error && err.message ? err.message : 'Discord import failed.');
    } finally {
      // Zero the token at end-of-run: fetching is done, the vault merge below
      // never needs it. Consent is per-request, so a retry re-pastes and
      // explicitly acknowledges the proxy disclosure again.
      if (importOwner.isActive(ownerScope)) {
        setToken('');
        setProxyAcknowledged(false);
        setAbort(null);
        setBusy(false);
        if (!pending()) focusSoon(() => tokenInput);
      }
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    if (!importOwner.isActive(job.ownerScope)) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      const result = await importVault(job.snapshot, job.ownerScope.owner, {
        isCurrent: () => importOwner.isActive(job.ownerScope),
      });
      if (!importOwner.isActive(job.ownerScope)) return;
      setPending(null);
      setStatus(`Imported ${countLabel(result.messages, 'message')} into ${countLabel(job.channels, 'room')}. Open a room to read the history, or search it from anywhere.`);
      focusSoon(() => tokenInput);
    } catch {
      if (!importOwner.isActive(job.ownerScope)) return;
      setStatus('Import failed while merging into the local vault.');
    } finally {
      if (importOwner.isActive(job.ownerScope)) setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable pref-discord-bot-import" aria-labelledby="pref-discord-bot-import-title">
      <div class="pref-group-head">
        <h3 id="pref-discord-bot-import-title" class="pref-label">Import from a Discord server (bot token)</h3>
      </div>
      <p class="pref-desc">
        Own a Discord server? Create a bot, invite it, and pull the <strong>whole server's</strong> history straight in — every text, announcement, and forum room, plus pins.
      </p>
      <p class="pref-desc" id="pref-discord-bot-proxy-disclosure">
        Your bot token is sent to this Onyx deployment's same-origin import proxy, which contacts Discord's API on your behalf. The token is used only for this request and is not stored in the portable vault or local history.
      </p>
      <ol class="pref-discord-bot-steps">
        <li>Create an application at <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer noopener">discord.com/developers</a>, then add a <strong>Bot</strong> to it.</li>
        <li><strong>Enable the “MESSAGE CONTENT INTENT” toggle</strong> under Bot → Privileged Gateway Intents. Without it, Discord returns messages with no text.</li>
        <li>Under Bot, <strong>Reset Token</strong> and copy the token.</li>
        <li>Invite the bot to your server (OAuth2 → URL Generator) with Discord's <strong>View Channels</strong> and <strong>Read Message History</strong> permissions.</li>
        <li>Paste the token and the numeric Server ID below, then fetch. Categories and roles have no home here and are skipped.</li>
      </ol>
      <div class="pref-vault-actions pref-discord-bot-inputs">
        <label class="pref-file pref-discord-bot-token">
          <span>Bot token</span>
          <input
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            placeholder="Bot token (used once, never saved)"
            value={token()}
            disabled={busy()}
            ref={tokenInput}
            onInput={(event) => setToken(event.currentTarget.value)}
          />
        </label>
        <label class="pref-file pref-discord-bot-channel">
          <span>Server ID</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="123456789012345678"
            value={guildId()}
            disabled={busy()}
            onInput={(event) => setGuildId(event.currentTarget.value)}
          />
        </label>
        <label class="pref-discord-bot-consent">
          <input
            type="checkbox"
            checked={proxyAcknowledged()}
            disabled={busy()}
            aria-describedby="pref-discord-bot-proxy-disclosure"
            onChange={(event) => setProxyAcknowledged(event.currentTarget.checked)}
          />
          <span>I understand that my bot token will be sent to this deployment's import proxy.</span>
        </label>
        <button
          type="button"
          class="pref-reset"
          disabled={busy() || !proxyAcknowledged()}
          aria-describedby="pref-discord-bot-proxy-disclosure"
          onClick={() => void handleFetch()}
        >
          Fetch history
        </button>
        <Show when={busy() && abort()}>
          <button
            type="button"
            class="pref-reset"
            onClick={() => {
              abort()?.abort();
              setStatus('Cancelling…');
            }}
          >
            Cancel
          </button>
        </Show>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-discord-bot-review-title">
            <h4 id="pref-discord-bot-review-title" tabindex={-1} ref={reviewHeading}>Review import</h4>
            <p>
              {countLabel(job().messages, 'message')} across {countLabel(job().channels, 'room')}
              {job().guild ? ` from ${job().guild}` : ''}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().pins > 0 ? ` ${countLabel(job().pins, 'pinned message')} included.` : ''}
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'system/empty message')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-room limit dropped.` : ''}
              {job().rolesSkipped > 0 || job().categoriesSkipped > 0
                ? ` ${countLabel(job().rolesSkipped, 'role')} and ${countLabel(job().categoriesSkipped, 'category')} have no home here and were skipped.`
                : ''}
              {job().channelsFailed > 0 ? ` ${countLabel(job().channelsFailed, 'room')} could not be read and was skipped.` : ''}
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
                  focusSoon(() => tokenInput);
                }}
              >
                Cancel import
              </button>
            </div>
          </div>
        )}
      </Show>
      {/* Always-present polite live region (see JsonVaultImportControls). */}
      <p class="pref-status" role="status" aria-live="polite" aria-atomic="true">{status() ?? ''}</p>
    </section>
  );
}

/** Import Slack history from an unzipped workspace export (channel JSON). */
export function SlackImportControls(): JSX.Element {
  return (
    <JsonVaultImportControls
      id="slack"
      title="Import from Slack"
      chooseLabel="Choose Slack JSON"
      rejectMessage="No Slack export recognized. Unzip your Slack workspace export and choose its channel .json files (Slack's layout)."
      loadParse={loadSlackExportParser}
      description={
        <>
          Leaving Slack? Request your workspace export (Slack → Settings & administration → Workspace settings → Import/Export Data), unzip it, and choose the channel <strong>JSON</strong> files Slack exports here. Everything happens on this device — nothing is uploaded. Imported history merges into this device's vault (up to the newest {VAULT_KEEP} messages per room).
        </>
      }
    />
  );
}

interface PendingIrcLogImport {
  ownerScope: ImportOwnerScope;
  fileName: string;
  snapshot: import('@/lib/vault/historyVault').VaultExportSnapshot;
  requestedChannel: string;
  target: string;
  targetChanged: boolean;
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
export function IrcLogImportControls(): JSX.Element {
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [channel, setChannel] = createSignal('');
  const [pending, setPending] = createSignal<PendingIrcLogImport | null>(null);
  let fileInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  const importOwner = useImportOwner(() => {
    setChannel('');
    setPending(null);
    setStatus(null);
    setBusy(false);
  });

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const limitFailure = validateImportFileSelection(files, {
      maxFiles: IRC_LOG_MAX_FILES,
      maxFileBytes: IRC_LOG_MAX_FILE_BYTES,
      maxAggregateBytes: IRC_LOG_MAX_AGGREGATE_BYTES,
    });
    if (limitFailure) {
      setPending(null);
      if (limitFailure.kind === 'count') {
        setStatus('Choose one classic client log at a time.');
      } else if (limitFailure.kind === 'file') {
        setStatus(`${limitFailure.fileName} exceeds the ${formatImportMib(limitFailure.maxFileBytes)} classic log limit. Split the log and import each part separately.`);
      } else {
        setStatus(`That classic log exceeds the ${formatImportMib(limitFailure.maxAggregateBytes)} total import limit. Split it and import each part separately.`);
      }
      return;
    }
    const file = files[0] ?? null;
    if (!file) return;
    const requestedChannel = channel();
    if (!requestedChannel.trim()) {
      setStatus('Enter the room these logs belong to first (e.g. #dev).');
      return;
    }
    const ownerScope = importOwner.capture();
    if (!ownerScope) {
      setPending(null);
      setStatus(IMPORT_OWNER_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      const { normalizeIrcChannelTarget, parseIrcLogFile } = await import('@/lib/import/ircLogImport');
      if (!importOwner.isActive(ownerScope)) return;
      const normalizedTarget = normalizeIrcChannelTarget(requestedChannel);
      if (!normalizedTarget) {
        setPending(null);
        setStatus(`The requested room "${requestedChannel}" does not normalize to a safe destination. Enter a room name containing letters or numbers (for example, #dev).`);
        return;
      }
      const result = await parseIrcLogFile(file, { channel: requestedChannel });
      if (!importOwner.isActive(ownerScope)) return;
      if (!result || result.summary.messages === 0) {
        setPending(null);
        setStatus('No recognizable log lines found. Supported: weechat, irssi, and mIRC text logs.');
        return;
      }
      const snapshotTarget = result.snapshot.targets[0];
      const actualTarget = snapshotTarget?.target ?? '';
      const targetIsConsistent = result.snapshot.targets.length === 1
        && actualTarget === normalizedTarget
        && normalizeIrcChannelTarget(actualTarget) === actualTarget
        && snapshotTarget?.messages.every(message => message.target === actualTarget);
      if (!targetIsConsistent) {
        setPending(null);
        setStatus('Import rejected because the classic log did not produce one safe, consistent destination. Enter a different room and try again.');
        return;
      }
      const s = result.summary;
      setPending({
        ownerScope,
        fileName: file.name,
        snapshot: result.snapshot,
        requestedChannel,
        target: actualTarget,
        targetChanged: requestedChannel !== actualTarget,
        messages: s.messages,
        skipped: s.skipped,
        droppedOverCap: s.droppedOverCap,
        oldest: s.oldest,
        newest: s.newest,
      });
      const changed = requestedChannel !== actualTarget
        ? ` Requested "${requestedChannel}"; exact destination ${actualTarget}. Review and confirm that destination.`
        : '';
      setStatus(`Ready to import ${countLabel(s.messages, 'message')} into ${actualTarget}.${changed}`);
      focusSoon(() => reviewHeading);
    } catch {
      if (!importOwner.isActive(ownerScope)) return;
      setPending(null);
      setStatus('Could not read that log file.');
    } finally {
      if (importOwner.isActive(ownerScope)) setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    const job = pending();
    if (!job) return;
    if (!importOwner.isActive(job.ownerScope)) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      const result = await importVault(job.snapshot, job.ownerScope.owner, {
        isCurrent: () => importOwner.isActive(job.ownerScope),
      });
      if (!importOwner.isActive(job.ownerScope)) return;
      setPending(null);
      setStatus(`Imported ${countLabel(result.messages, 'message')} into ${job.target}. Open it to read the history, or search from anywhere.`);
      focusSoon(() => fileInput);
    } catch {
      if (!importOwner.isActive(job.ownerScope)) return;
      setStatus('Import failed while merging into the local vault.');
    } finally {
      if (importOwner.isActive(job.ownerScope)) setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable pref-irclog-import" aria-labelledby="pref-irclog-import-title">
      <div class="pref-group-head">
        <h3 id="pref-irclog-import-title" class="pref-label">Import a classic client log</h3>
      </div>
      <p class="pref-desc">
        Have a plain-text log from another client (weechat, irssi, mIRC)? Name the room it belongs to, then choose the log file. It's parsed on-device and merged into this device's vault (up to the newest {VAULT_KEEP} messages).
      </p>
      <div class="pref-vault-actions">
        <label class="pref-file pref-irclog-channel">
          <span>Room</span>
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
            ref={fileInput}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-irclog-review-title">
            <h4 id="pref-irclog-review-title" tabindex={-1} ref={reviewHeading}>Review import</h4>
            <p>
              {job().fileName}: {countLabel(job().messages, 'message')} into {job().target}
              {job().oldest && job().newest ? ` (${shortDate(job().oldest)} → ${shortDate(job().newest)})` : ''}.
              {job().skipped > 0 ? ` ${countLabel(job().skipped, 'unparseable/filtered line')} skipped.` : ''}
              {job().droppedOverCap > 0 ? ` ${countLabel(job().droppedOverCap, 'older message')} beyond the per-room limit dropped.` : ''}
              {' '}Existing local history is merged, not replaced.
            </p>
            <Show when={job().targetChanged}>
              <p class="pref-status" role="alert">
                Room destination changed. Requested "{job().requestedChannel}"; import destination: {job().target}. Confirm only if this is the intended room.
              </p>
            </Show>
            <div class="pref-import-review__actions">
              <button type="button" class="pref-reset" disabled={busy()} onClick={() => void confirmImport()}>
                Import into {job().target}
              </button>
              <button
                type="button"
                class="pref-reset"
                disabled={busy()}
                onClick={() => {
                  setPending(null);
                  setStatus('Import cancelled.');
                  focusSoon(() => fileInput);
                }}
              >
                Cancel import
              </button>
            </div>
          </div>
        )}
      </Show>
      {/* Always-present polite live region (see JsonVaultImportControls). */}
      <p class="pref-status" role="status" aria-live="polite" aria-atomic="true">{status() ?? ''}</p>
    </section>
  );
}
