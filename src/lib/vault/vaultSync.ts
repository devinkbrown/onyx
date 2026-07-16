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
import {
  captureDeviceMemoryContext,
  getState,
  isDeviceMemoryContextCurrent,
  store,
  type DeviceMemoryContext,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { preferences } from '@/lib/prefs/preferences';
import {
  classifyVaultDmSearchPrivacy,
  deviceMemoryOwnerKey,
  loadRecent,
  saveMessages,
} from './historyVault';

const FLUSH_MS = 1500;

const _pendingFlush = new Map<string, ReturnType<typeof setTimeout>>();
/** Per-target signature of the last set of rows durably written (see
 *  `bufferSignature`). Replaces a plain tail-id watermark so an in-place
 *  edit/redact/delete/reaction on an EXISTING message re-triggers a flush. */
const _lastPersistedSig = new Map<string, string>();
const _hydrated = new Set<string>();
let _unsubscribers: Array<() => void> = [];

/**
 * Rows we actually persist: everything EXCEPT the optimistic offline outbox
 * placeholder (`pending`, id `outbox:<id>`). That placeholder is dropped from
 * the store the instant flushOutbox delivers the real message under a fresh
 * uid; persisting it would leave a permanent stuck-`pending` ghost plus a
 * duplicate of the delivered line on the next hydrate. Optimistic rows never
 * go to disk — only settled conversation does.
 */
function persistableRows(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.pending && !m.id.startsWith('outbox:'));
}

/** FNV-1a 32-bit string mix — cheap, allocation-free, deterministic. */
function mix(h: number, s: string): number {
  let acc = h;
  for (let i = 0; i < s.length; i++) {
    acc ^= s.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193);
  }
  return acc >>> 0;
}

/**
 * Cheap content signature over the mutation-relevant fields of the persistable
 * rows. A tail-id watermark alone misses in-place mutations — a redact/edit/
 * delete/reaction changes an EXISTING message (same id, often same length) but
 * not the tail id, so the un-redacted row would survive at rest and keep
 * surfacing in search/time-travel. Hashing id + text + flags + reactions makes
 * those mutations dirty the watermark and become durable. One linear pass over
 * ≤ VAULT_KEEP rows, no allocation, no re-serialize — safe on the store hot path.
 */
function bufferSignature(rows: readonly ChatMessage[]): string {
  let h = 0x811c9dc5;
  for (const m of rows) {
    h = mix(h, m.id);
    h = mix(h, m.text);
    let flags = 0;
    if (m.edited) flags |= 1;
    if (m.deleted) flags |= 2;
    if (m.redacted) flags |= 4;
    h = (Math.imul(h, 0x01000193) ^ flags) >>> 0;
    if (m.reactions) {
      for (const r of m.reactions) {
        h = mix(h, r.emoji);
        for (const u of r.users) h = mix(h, u);
      }
    }
  }
  return `${rows.length}:${h.toString(36)}`;
}

function ownedTargetKey(context: DeviceMemoryContext, target: string): string {
  return `${deviceMemoryOwnerKey(context.owner) ?? ''}\n${target.toLowerCase()}`;
}

function scheduleFlush(
  context: DeviceMemoryContext,
  target: string,
  messages: readonly ChatMessage[],
): void {
  const targetKey = target.toLowerCase();
  const key = ownedTargetKey(context, targetKey);
  const rows = persistableRows(messages);
  const nextSig = bufferSignature(rows);
  if (_lastPersistedSig.get(key) === nextSig) return;
  const existing = _pendingFlush.get(key);
  if (existing) clearTimeout(existing);
  _pendingFlush.set(
    key,
    setTimeout(() => {
      _pendingFlush.delete(key);
      const prevSig = _lastPersistedSig.get(key);
      if (prevSig === nextSig) return; // already durable — nothing new to write

      // Claim the watermark OPTIMISTICALLY so a burst of store updates for this
      // target coalesces onto one in-flight write instead of stampeding the DB.
      // The watermark is a content SIGNATURE, not just a tail id, so in-place
      // edits/redactions/reactions re-flush and become durable at rest.
      // If the write fails (quota / private mode / abort), roll the watermark
      // back — but only if no newer flush has since advanced it — so the SAME
      // rows are retried on the next store change instead of being silently and
      // permanently dropped. System lines (joins/quits) are conversation too;
      // only optimistic outbox placeholders are held back (persistableRows).
      _lastPersistedSig.set(key, nextSig);
      void saveMessages(targetKey, rows, context.owner).then((committed) => {
        if (committed) return;
        if (_lastPersistedSig.get(key) === nextSig) {
          if (prevSig === undefined) _lastPersistedSig.delete(key);
          else _lastPersistedSig.set(key, prevSig);
        }
      });
    }, FLUSH_MS),
  );
}

async function hydrate(context: DeviceMemoryContext, target: string, dm = false): Promise<void> {
  const targetKey = target.toLowerCase();
  const key = ownedTargetKey(context, targetKey);
  if (_hydrated.has(key)) return;
  _hydrated.add(key);
  // DM classification covers the complete retained target, independent of the
  // bounded rows hydration returns. Run both together; privacy remains unknown
  // (and server SEARCH stays blocked) until the full scan proves it plain.
  const [local] = await Promise.all([
    loadRecent(targetKey, undefined, context.owner),
    dm ? classifyVaultDmSearchPrivacy(targetKey, context.owner) : Promise.resolve(),
  ]);
  if (!isDeviceMemoryContextCurrent(context)) {
    // This owner was never hydrated. Make a later return to the same account
    // retryable instead of leaving a permanent false-positive watermark.
    _hydrated.delete(key);
    return;
  }
  if (local.length === 0) return;
  getState().hydrateHistory(targetKey, local);
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
        const context = captureDeviceMemoryContext();
        if (!context) return;
        for (const [key, ch] of channels) {
          const ownedKey = ownedTargetKey(context, key);
          if (!_hydrated.has(ownedKey)) void hydrate(context, key);
          if (ch.messages.length > 0) scheduleFlush(context, key, ch.messages);
        }
      },
    ),
    store.subscribe(
      (s) => s.dms,
      (dms) => {
        if (!preferences().localHistory) return;
        const context = captureDeviceMemoryContext();
        if (!context) return;
        for (const [key, dm] of dms) {
          const ownedKey = ownedTargetKey(context, key);
          if (!_hydrated.has(ownedKey)) void hydrate(context, key, true);
          if (dm.messages.length > 0) scheduleFlush(context, key, dm.messages);
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
  _lastPersistedSig.clear();
  _hydrated.clear();
}
