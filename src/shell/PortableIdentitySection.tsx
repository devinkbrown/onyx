// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PortableIdentitySection — export/import non-secret residence data (Era 3 C10).
 *
 * Exports channel favorites + folders from the store navigation memory and
 * quiet-hours. Never includes device private keys, session tokens, or recovery codes.
 */
import { createSignal, Show, type JSX } from 'solid-js';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { preferences } from '@/lib/prefs/preferences';
import {
  buildPortableIdentity,
  parsePortableIdentity,
  serializePortableIdentity,
} from '@/lib/identity/portableIdentity';
import { getState } from '@/lib/store';
import { Button } from '@/primitives/index';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';

export interface PortableIdentitySectionProps {
  owner: DeviceMemoryOwner | null;
  networkHint?: string;
}

export function PortableIdentitySection(props: PortableIdentitySectionProps): JSX.Element {
  const [importText, setImportText] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  function exportDoc(): string | null {
    if (!props.owner) return null;
    const st = getState();
    const doc = buildPortableIdentity({
      preferences: preferences(),
      // Map store stars → portable bookmark list
      bookmarks: [...st.starredChannels],
      // Map store folders → portable categories
      categories: {
        categories: st.channelFolders
          .filter((f) => f.id !== 'default')
          .map((f, order) => ({
            id: f.id,
            name: f.name,
            channels: [...f.channels],
            collapsed: f.collapsed,
            order,
          })),
      },
      quietHours: {
        startHour: st.dndQuietStart,
        endHour: st.dndQuietEnd,
      },
      networkHint: props.networkHint,
    });
    return serializePortableIdentity(doc);
  }

  async function onExportDownload(): Promise<void> {
    setError(null);
    setStatus(null);
    const raw = exportDoc();
    if (!raw) {
      setError('Sign in before exporting residence data.');
      return;
    }
    try {
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `onyx-residence-${new Date().toISOString().slice(0, 10)}.json`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Residence file downloaded (no secrets included).');
    } catch {
      setError('Could not download the residence file.');
    }
  }

  async function onExportCopy(): Promise<void> {
    setError(null);
    setStatus(null);
    const raw = exportDoc();
    if (!raw) {
      setError('Sign in before exporting residence data.');
      return;
    }
    const ok = await writeClipboardText(raw);
    setStatus(ok ? 'Residence JSON copied to clipboard.' : 'Clipboard copy failed — use Download instead.');
  }

  function onImport(): void {
    setError(null);
    setStatus(null);
    if (!props.owner) {
      setError('Sign in before importing residence data.');
      return;
    }
    setBusy(true);
    try {
      const doc = parsePortableIdentity(importText());
      if (!doc) {
        setError('Invalid residence file — wrong kind, secrets present, or corrupt JSON.');
        return;
      }
      const st = getState();
      // Stars
      for (const ch of [...st.starredChannels]) st.unstarChannel(ch);
      for (const ch of doc.bookmarks) st.starChannel(ch);
      // Folders — replace custom folders (keep default)
      const nextFolders = [
        ...st.channelFolders.filter((f) => f.id === 'default'),
        ...doc.categories.categories.map((c) => ({
          id: c.id,
          name: c.name,
          channels: [...c.channels],
          collapsed: c.collapsed,
        })),
      ];
      st.setChannelFolders(nextFolders);
      st.setDndQuietHours(doc.quietHours.startHour, doc.quietHours.endHour);
      setStatus(
        `Imported ${doc.bookmarks.length} favorite(s) and ${doc.categories.categories.length} folder(s).`,
      );
      setImportText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      class="acct-section"
      aria-labelledby="acct-portable-title"
      aria-describedby="acct-portable-hint"
      data-testid="portable-identity-section"
    >
      <div class="acct-section-head">
        <h3 class="acct-section-title" id="acct-portable-title">
          Portable residence
        </h3>
        <p class="acct-section-hint" id="acct-portable-hint">
          Move favorites, channel folders, and quiet-hours between browsers.
          Never includes passwords, device keys, session tokens, or recovery codes.
        </p>
      </div>
      <div class="acct-section-body">
        <div class="acct-cert-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="portable-export-download"
            disabled={!props.owner}
            onClick={() => void onExportDownload()}
          >
            Download residence file
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="portable-export-copy"
            disabled={!props.owner}
            onClick={() => void onExportCopy()}
          >
            Copy JSON
          </Button>
        </div>
        <label class="acct-section-hint" for="portable-import-json">
          Import residence JSON
        </label>
        <textarea
          id="portable-import-json"
          data-testid="portable-import-json"
          rows={4}
          placeholder='{"kind":"onyx.portable-identity",...}'
          value={importText()}
          onInput={(e) => setImportText(e.currentTarget.value)}
          disabled={!props.owner || busy()}
          style={{
            width: '100%',
            'min-height': '5rem',
            padding: '0.5rem 0.65rem',
            background: 'var(--stone-2)',
            border: '1px solid var(--seam)',
            color: 'var(--paper)',
            'border-radius': 'var(--r-sm)',
            'font-family': 'var(--font-mono)',
            'font-size': '0.78rem',
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="portable-import"
          disabled={!props.owner || busy() || importText().trim().length === 0}
          onClick={() => onImport()}
        >
          Import
        </Button>
        <Show when={status()}>
          {(msg) => (
            <p class="acct-section-hint" role="status" data-testid="portable-status">
              {msg()}
            </p>
          )}
        </Show>
        <Show when={error()}>
          {(msg) => (
            <p class="acct-error" role="alert" data-testid="portable-error">
              {msg()}
            </p>
          )}
        </Show>
      </div>
    </section>
  );
}

export default PortableIdentitySection;
