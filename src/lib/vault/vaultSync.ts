// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * vaultSync.ts — wires the history vault to the store.
 *
 *  · HYDRATE: when a channel/DM buffer appears (or is empty on connect), the
 *    vault's copy renders immediately — the server's CHATHISTORY replay then
 *    merges on top (the store's history merge dedupes by msgid, and locally
 *    generated ids never collide with server msgids).
 *  · PERSIST: buffer changes flush to IndexedDB, debounced per target.
 *
 * Everything is preference-gated (prefs.localHistory) and best-effort.
 */
import { store, getState } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { preferences } from '@/lib/prefs/preferences';
import { loadRecent, saveMessages } from './historyVault';

const FLUSH_MS = 1500;

const _pendingFlush = new Map<string, ReturnType<typeof setTimeout>>();
const _lastPersistedTail = new Map<string, string>();
const _hydrated = new Set<string>();
let _unsubscribers: Array<() => void> = [];

function scheduleFlush(target: string, messages: readonly ChatMessage[]): void {
  const key = target.toLowerCase();
  const tailId = messages[messages.length - 1]?.id ?? '';
  if (_lastPersistedTail.get(key) === tailId) return;
  const existing = _pendingFlush.get(key);
  if (existing) clearTimeout(existing);
  _pendingFlush.set(
    key,
    setTimeout(() => {
      _pendingFlush.delete(key);
      const state = getState();
      const buf =
        state.channels.get(key)?.messages ?? state.dms.get(key)?.messages ?? null;
      if (!buf || buf.length === 0) return;
      _lastPersistedTail.set(key, buf[buf.length - 1]?.id ?? '');
      // System lines (joins/quits) are noise worth remembering too — they keep
      // the restored scrollback coherent — but skip pure-local placeholder ids?
      // No: everything in the buffer is the conversation as seen. Store it all.
      void saveMessages(key, buf);
    }, FLUSH_MS),
  );
}

async function hydrate(target: string): Promise<void> {
  const key = target.toLowerCase();
  if (_hydrated.has(key)) return;
  _hydrated.add(key);
  const local = await loadRecent(key);
  if (local.length === 0) return;
  getState().hydrateHistory(key, local);
}

/** Start vault sync. Call once at app boot; safe to call in any environment. */
export function initVaultSync(): void {
  if (typeof indexedDB === 'undefined') return;
  if (_unsubscribers.length > 0) return; // already wired

  _unsubscribers = [
    store.subscribe(
      (s) => s.channels,
      (channels) => {
        if (!preferences().localHistory) return;
        for (const [key, ch] of channels) {
          if (!_hydrated.has(key)) void hydrate(key);
          if (ch.messages.length > 0) scheduleFlush(key, ch.messages);
        }
      },
    ),
    store.subscribe(
      (s) => s.dms,
      (dms) => {
        if (!preferences().localHistory) return;
        for (const [key, dm] of dms) {
          if (!_hydrated.has(key)) void hydrate(key);
          if (dm.messages.length > 0) scheduleFlush(key, dm.messages);
        }
      },
    ),
  ];
}

/** Test hook. */
export function _resetVaultSyncForTests(): void {
  for (const u of _unsubscribers) u();
  _unsubscribers = [];
  for (const t of _pendingFlush.values()) clearTimeout(t);
  _pendingFlush.clear();
  _lastPersistedTail.clear();
  _hydrated.clear();
}
