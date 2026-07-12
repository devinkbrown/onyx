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
import { createSignal, Show, type JSX } from 'solid-js';
import { importVault, VAULT_KEEP } from '@/lib/vault/historyVault';
import type { DiscordPackageFile } from '@/lib/import/discordPackageImport';
import { countLabel } from '@/lib/format/countLabel';
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
  /**
   * Lazily loads the pure parse transform (parsed JSON → vault snapshot, or null
   * if unrecognized). Resolved once per file-pick so the parser module stays out
   * of the initial bundle and only downloads when the user actually imports.
   */
  loadParse: () => Promise<(raw: unknown) => VaultImportResultLike | null>;
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

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const parse = await props.loadParse();
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
      rejectMessage="No Discord export recognized. Export channels from DiscordChatExporter in JSON mode, then choose those .json files."
      loadParse={async () => {
        const { parseDiscordExport } = await import('@/lib/import/discordImport');
        return (raw) => parseDiscordExport(raw);
      }}
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

interface PendingPackageImport {
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

/** A single package file larger than this is skipped rather than read into memory. */
const MAX_PACKAGE_FILE_BYTES = 256 * 1024 * 1024;

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

  async function handleSelect(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const packageFiles: DiscordPackageFile[] = [];
      for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (!isPackageFileName(file.name) || file.size > MAX_PACKAGE_FILE_BYTES) continue;
        packageFiles.push({ path, text: await file.text() });
      }
      const { parseDiscordPackage } = await import('@/lib/import/discordPackageImport');
      const result = parseDiscordPackage(packageFiles);
      if (!result || result.summary.messages === 0) {
        setPending(null);
        setStatus('No Discord data package found. Unzip the package Discord emails you and choose its folder (it contains a "messages" folder).');
        return;
      }
      const s = result.summary;
      setPending({
        snapshot: result.snapshot,
        channels: s.channels,
        messages: s.messages,
        skipped: s.skipped,
        droppedOverCap: s.droppedOverCap,
        guild: s.guild,
        oldest: s.oldest,
        newest: s.newest,
      });
      setStatus(`Ready to import ${countLabel(s.messages, 'message')} across ${countLabel(s.channels, 'channel')}${s.guild ? ` from ${s.guild}` : ''}.`);
    } catch {
      setPending(null);
      setStatus('Could not read that folder as a Discord data package.');
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
      setStatus(`Imported ${countLabel(result.messages, 'message')} into ${countLabel(job.channels, 'channel')}. Open a channel to read the history, or search it from anywhere.`);
    } catch {
      setStatus('Import failed while merging into the local vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="pref-group pref-vault-portable pref-discord-package-import" aria-labelledby="pref-discord-package-import-title">
      <div class="pref-group-head">
        <h3 id="pref-discord-package-import-title" class="pref-label">Import a Discord data package</h3>
      </div>
      <p class="pref-desc">
        No third-party tool? In Discord go to <strong>Settings → Privacy &amp; Safety → Request all of my Data</strong>. When the package arrives, unzip it and choose the folder here. Everything happens on this device — nothing is sent to Discord. Note that Discord's package only contains <em>your own</em> messages. Imported history merges into this device's vault (up to the newest {VAULT_KEEP} messages per channel).
      </p>
      <div class="pref-vault-actions">
        <label class="pref-file">
          <span>Choose package folder</span>
          <input
            type="file"
            multiple
            disabled={busy()}
            ref={(el) => el.setAttribute('webkitdirectory', '')}
            onChange={(event) => void handleSelect(event)}
          />
        </label>
      </div>
      <Show when={pending()}>
        {(job) => (
          <div class="pref-import-review" role="group" aria-labelledby="pref-discord-package-review-title">
            <h4 id="pref-discord-package-review-title">Review import</h4>
            <p>
              {countLabel(job().messages, 'message')} across {countLabel(job().channels, 'channel')}
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
      rejectMessage="No Slack export recognized. Unzip your Slack workspace export and choose its per-channel .json files."
      loadParse={async () => {
        const { parseSlackExport } = await import('@/lib/import/slackImport');
        return (raw) => {
          const result = parseSlackExport(raw);
          if (!result) return null;
          // The generic control speaks `guild`; Slack calls it a workspace.
          return { snapshot: result.snapshot, summary: { ...result.summary, guild: result.summary.workspace } };
        };
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
export function IrcLogImportControls(): JSX.Element {
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
      const { parseIrcLog } = await import('@/lib/import/ircLogImport');
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
      {/* Always-present polite live region (see JsonVaultImportControls). */}
      <p class="pref-status" role="status" aria-live="polite" aria-atomic="true">{status() ?? ''}</p>
    </section>
  );
}
