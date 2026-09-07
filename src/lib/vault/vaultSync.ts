// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * vaultSync.ts — wires the history vault to the store.
 *
 *  · HYDRATE: when a channel/DM buffer appears (or is empty on connect), the
 *    vault's copy renders immediately — the server's CHATHISTORY replay then
 *    merges on top (the store's history merge dedupes by msgid, and locally
 *    generated ids never collide with server msgids).
 *  · COLD PAINT: the last-active room is remembered owner-scoped and hydrated
 *    as soon as the device-memory owner appears — before session-sync JOIN or
 *    CHATHISTORY. Live buffers that already exist also paint on init (JOIN may
 *    beat retention.finally), with the active room prioritized.
 *  · PERSIST: buffer changes flush to IndexedDB, debounced per target.
 *
 * Everything is preference-gated (prefs.localHistory) and best-effort.
 */
import {
  captureDeviceMemoryContext,
  getState,
  isDeviceMemoryContextCurrent,
  selectDeviceMemoryOwner,
  store,
  type DeviceMemoryContext,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { preferences } from '@/lib/prefs/preferences';
import {
  classifyVaultDmSearchPrivacy,
  beginVaultWriteIntent,
  cancelVaultWriteIntent,
  deviceMemoryOwnerKey,
  loadRecent,
  releaseVaultWriteReservation,
  reserveVaultWrite,
  saveMessages,
  subscribeVerifiedDeviceHistoryClear,
  type VaultWriteIntent,
  type VaultWriteReservation,
} from './historyVault';
import {
  loadVaultResumeTarget,
  saveVaultResumeTarget,
  type VaultResumeTarget,
} from './vaultResumeMemory';

const FLUSH_MS = 1500;
/** Maximum live owner/target watermarks retained by one long-lived tab. */
export const VAULT_SYNC_TARGET_CACHE_CAP = 512;

type PendingFlush = {
  timer: ReturnType<typeof setTimeout>;
  intent: VaultWriteIntent;
  reservation: Promise<VaultWriteReservation | null>;
};

const _pendingFlush = new Map<string, PendingFlush>();
/** Per-target signature of the last set of rows durably written (see
 *  `bufferSignature`). Replaces a plain tail-id watermark so an in-place
 *  edit/redact/delete/reaction on an EXISTING message re-triggers a flush. */
const _lastPersistedSig = new Map<string, string>();
const _hydrated = new Set<string>();
let _unsubscribers: Array<() => void> = [];
let _eraseGeneration = 0;

function rememberHydratedTarget(key: string): void {
  _hydrated.delete(key);
  _hydrated.add(key);
  while (_hydrated.size > VAULT_SYNC_TARGET_CACHE_CAP) {
    const oldest = _hydrated.values().next().value;
    if (oldest === undefined) break;
    _hydrated.delete(oldest);
  }
}

function wasHydrated(key: string): boolean {
  if (!_hydrated.has(key)) return false;
  rememberHydratedTarget(key);
  return true;
}

function rememberPersistedSignature(key: string, signature: string): void {
  _lastPersistedSig.delete(key);
  _lastPersistedSig.set(key, signature);
  while (_lastPersistedSig.size > VAULT_SYNC_TARGET_CACHE_CAP) {
    const oldest = _lastPersistedSig.keys().next().value;
    if (oldest === undefined) break;
    _lastPersistedSig.delete(oldest);
  }
}

function persistedSignature(key: string): string | undefined {
  const signature = _lastPersistedSig.get(key);
  if (signature !== undefined) rememberPersistedSignature(key, signature);
  return signature;
}

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

function liveOwnedTargetKeys(context: DeviceMemoryContext): Set<string> {
  const state = getState();
  const live = new Set<string>();
  for (const key of state.channels.keys()) live.add(ownedTargetKey(context, key));
  for (const key of state.dms.keys()) live.add(ownedTargetKey(context, key));
  return live;
}

/** Drop room/identity keys once they no longer belong to the live owner buffers. */
function reconcileLiveTargetCaches(context: DeviceMemoryContext): void {
  const live = liveOwnedTargetKeys(context);
  for (const key of _hydrated) {
    if (!live.has(key)) _hydrated.delete(key);
  }
  for (const key of _lastPersistedSig.keys()) {
    // A captured write may still be waiting for its debounce. Keep its watermark
    // until the write settles, then the completion path re-checks live ownership.
    if (!live.has(key) && !_pendingFlush.has(key)) _lastPersistedSig.delete(key);
  }
}

function releasePendingReservation(
  intent: VaultWriteIntent,
  reservation: Promise<VaultWriteReservation | null>,
): void {
  // Revoke the synchronous authority immediately; the promise may be waiting
  // for database opening in another module context.
  cancelVaultWriteIntent(intent);
  void reservation.then((admitted) => {
    if (admitted) void releaseVaultWriteReservation(admitted.token).catch(() => {});
  }).catch(() => {
    // A rejected admission has no durable reservation to release.
  });
}

function isOwnedTargetLive(key: string): boolean {
  const context = captureDeviceMemoryContext();
  return context !== null && liveOwnedTargetKeys(context).has(key);
}

/**
 * Last-active conversation the UI is showing — the cold-start paint target
 * among already-materialized buffers. Home/status/voice-only views are not
 * room buffers and return null.
 */
function activeRoomTarget(
  state: ReturnType<typeof getState> = getState(),
): { target: string; dm: boolean } | null {
  const view = state.activeView;
  if (view.kind === 'channel') {
    const target = view.channel.toLowerCase();
    return state.channels.has(target) ? { target, dm: false } : null;
  }
  if (view.kind === 'dm') {
    const target = view.nick.toLowerCase();
    return state.dms.has(target) ? { target, dm: true } : null;
  }
  return null;
}

function scheduleFlush(
  context: DeviceMemoryContext,
  target: string,
  messages: readonly ChatMessage[],
): void {
  const targetKey = target.toLowerCase();
  const key = ownedTargetKey(context, targetKey);
  // Register the opaque intent before deriving the delayed payload admission.
  // No later async database-open path may invent a replacement token.
  const intent = beginVaultWriteIntent();
  if (!intent) return;
  const rows = persistableRows(messages);
  const nextSig = bufferSignature(rows);
  const capturedEraseGeneration = _eraseGeneration;
  if (persistedSignature(key) === nextSig) {
    cancelVaultWriteIntent(intent);
    return;
  }
  // Admission is a durable metadata transaction, not an epoch observation.
  // The synchronous intent is created before debounce so a clear can revoke it
  // even while the reservation's database open is delayed. The reservation then
  // orders against the clear in IDB; no message payload enters vault_meta.
  const reservation = Promise.resolve(reserveVaultWrite(intent)).catch(() => null);
  const existing = _pendingFlush.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    releasePendingReservation(existing.intent, existing.reservation);
  }
  const timer = setTimeout(() => {
      void (async () => {
        _pendingFlush.delete(key);
        if (capturedEraseGeneration !== _eraseGeneration || !preferences().localHistory) {
          releasePendingReservation(intent, reservation);
          _lastPersistedSig.delete(key);
          return;
        }
        const prevSig = persistedSignature(key);
        if (prevSig === nextSig) {
          releasePendingReservation(intent, reservation);
          // Already durable — but do not let a now-closed owner/target survive only
          // because another coalesced timer observed the same watermark.
          if (!isOwnedTargetLive(key)) _lastPersistedSig.delete(key);
          return;
        }

        const admitted = await reservation;
        if (!admitted || capturedEraseGeneration !== _eraseGeneration || !preferences().localHistory) {
          cancelVaultWriteIntent(intent);
          if (admitted) void releaseVaultWriteReservation(admitted.token).catch(() => {});
          return;
        }

        // Claim the watermark OPTIMISTICALLY so a burst of store updates for this
        // target coalesces onto one in-flight write instead of stampeding the DB.
        // The watermark is a content SIGNATURE, not just a tail id, so in-place
        // edits/redactions/reactions re-flush and become durable at rest.
        // If the write fails (quota / private mode / abort), roll the watermark
        // back — but only if no newer flush has since advanced it — so the SAME
        // rows are retried on the next store change instead of being silently and
        // permanently dropped. System lines (joins/quits) are conversation too;
        // only optimistic outbox placeholders are held back (persistableRows).
        rememberPersistedSignature(key, nextSig);
        const committed = await saveMessages(
          targetKey,
          rows,
          context.owner,
          admitted.eraseEpoch,
          admitted,
        );
        if (capturedEraseGeneration !== _eraseGeneration) return;
        if (!committed && _lastPersistedSig.get(key) === nextSig) {
          if (prevSig === undefined) _lastPersistedSig.delete(key);
          else rememberPersistedSignature(key, prevSig);
        }
        // Owner changes and closed conversations must not leave their private
        // target identifiers resident after this captured write has settled.
        if (!isOwnedTargetLive(key)) _lastPersistedSig.delete(key);
      })();
    }, FLUSH_MS);
  _pendingFlush.set(key, { timer, intent, reservation });
}

async function hydrate(
  context: DeviceMemoryContext,
  target: string,
  dm = false,
  activate?: VaultResumeTarget['kind'],
): Promise<void> {
  const targetKey = target.toLowerCase();
  const key = ownedTargetKey(context, targetKey);
  if (wasHydrated(key)) return;
  rememberHydratedTarget(key);
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
  if (local.length === 0) {
    // Cold-resume of an empty vault must not lock out a later JOIN hydrate
    // once rows land (import / first CHATHISTORY flush). Live empty shells
    // keep the watermark so map churn does not thrash IndexedDB.
    if (activate) _hydrated.delete(key);
    return;
  }

  if (activate) {
    // A deep link chosen during the IndexedDB read wins. Merge only when its
    // target now exists; otherwise make normal JOIN hydration retryable.
    if (getState().pendingDeepLinkJoin) {
      const state = getState();
      if (state.channels.has(targetKey) || state.dms.has(targetKey)) {
        getState().hydrateHistory(targetKey, local);
      } else {
        _hydrated.delete(key);
      }
      return;
    }
    getState().hydrateHistory(targetKey, local, { activate });
    return;
  }

  // Buffer may have closed while IndexedDB was in flight — drop the watermark
  // so a later rejoin can paint from the vault again.
  const state = getState();
  const live = dm ? state.dms.has(targetKey) : state.channels.has(targetKey);
  if (!live) {
    _hydrated.delete(key);
    return;
  }
  getState().hydrateHistory(targetKey, local);
}

/** Persist the active room pointer (metadata only — never message bodies). */
function rememberActiveConversation(): void {
  if (!preferences().localHistory) return;
  const state = getState();
  const owner = selectDeviceMemoryOwner(state);
  if (!owner) return;
  if (state.activeView.kind === 'channel') {
    const target = state.activeView.channel.toLowerCase();
    if (state.channels.has(target)) {
      saveVaultResumeTarget({ kind: 'channel', target }, owner);
    }
  } else if (state.activeView.kind === 'dm') {
    const target = state.activeView.nick.toLowerCase();
    if (state.dms.has(target)) saveVaultResumeTarget({ kind: 'dm', target }, owner);
  }
}

/**
 * Cold resume: materialize the last-active room from the vault before any
 * network buffer exists. Deep links and already-live state win.
 */
function hydrateRememberedConversation(): void {
  if (!preferences().localHistory) return;
  const context = captureDeviceMemoryContext();
  if (!context) return;
  const state = getState();
  if (
    state.pendingDeepLinkJoin
    || state.activeView.kind !== 'home'
    || state.channels.size > 0
    || state.dms.size > 0
  ) return;
  const resume = loadVaultResumeTarget(context.owner);
  if (!resume) return;
  void hydrate(context, resume.target, resume.kind === 'dm', resume.kind);
}

/**
 * Hydrate + flush every live buffer. The last-active room runs first so cold
 * return paints local scrollback before CHATHISTORY (or a backlog of other
 * rooms' IDB reads) can delay it.
 */
function syncLiveBuffers(): void {
  if (!preferences().localHistory) return;
  const context = captureDeviceMemoryContext();
  if (!context) return;
  reconcileLiveTargetCaches(context);

  const state = getState();
  const active = activeRoomTarget(state);
  if (active) void hydrate(context, active.target, active.dm);

  for (const [key, ch] of state.channels) {
    if (active && !active.dm && key === active.target) {
      if (ch.messages.length > 0) void scheduleFlush(context, key, ch.messages);
      continue;
    }
    void hydrate(context, key);
    if (ch.messages.length > 0) void scheduleFlush(context, key, ch.messages);
  }
  for (const [key, dm] of state.dms) {
    if (active && active.dm && key === active.target) {
      if (dm.messages.length > 0) void scheduleFlush(context, key, dm.messages);
      continue;
    }
    void hydrate(context, key, true);
    if (dm.messages.length > 0) void scheduleFlush(context, key, dm.messages);
  }
}

/** Start vault sync. Call once at app boot; safe to call in any environment. */
export function initVaultSync(): void {
  if (typeof indexedDB === 'undefined') return;
  if (_unsubscribers.length > 0) return; // already wired

  _unsubscribers = [
    subscribeVerifiedDeviceHistoryClear(() => {
      _eraseGeneration += 1;
      for (const pending of _pendingFlush.values()) {
        clearTimeout(pending.timer);
        releasePendingReservation(pending.intent, pending.reservation);
      }
      _pendingFlush.clear();
      _lastPersistedSig.clear();
      _hydrated.clear();
    }),
    store.subscribe(
      (s) => s.channels,
      () => {
        syncLiveBuffers();
      },
    ),
    store.subscribe(
      (s) => s.dms,
      () => {
        syncLiveBuffers();
      },
    ),
    // Owner identity becomes known at connect (before JOINs). Kick cold resume
    // one microtask later so a brief nick/account alias cannot address the wrong
    // namespace.
    store.subscribe(
      (s) => {
        const owner = selectDeviceMemoryOwner(s);
        return owner ? deviceMemoryOwnerKey(owner) : null;
      },
      () => {
        queueMicrotask(hydrateRememberedConversation);
      },
    ),
    // Navigating to a remembered room must prioritize its vault paint even when
    // the channels/dms maps themselves did not change (e.g. switching between
    // already-joined rooms after a multi-JOIN restore). Also persist the pointer.
    store.subscribe(
      (s) => s.activeView,
      () => {
        if (!preferences().localHistory) return;
        rememberActiveConversation();
        const context = captureDeviceMemoryContext();
        if (!context) return;
        const active = activeRoomTarget();
        if (active) void hydrate(context, active.target, active.dm);
      },
    ),
  ];

  // Cold-start: remember pointer, paint last room before network if blank,
  // then paint whatever buffers JOINs already created while retention applied.
  rememberActiveConversation();
  hydrateRememberedConversation();
  syncLiveBuffers();
}

/** Test hook. */
export function _resetVaultSyncForTests(): void {
  for (const u of _unsubscribers) u();
  _unsubscribers = [];
  for (const pending of _pendingFlush.values()) {
    clearTimeout(pending.timer);
    releasePendingReservation(pending.intent, pending.reservation);
  }
  _pendingFlush.clear();
  _lastPersistedSig.clear();
  _hydrated.clear();
  _eraseGeneration += 1;
}

/** Test hook: expose counts without leaking retained owner/target identifiers. */
export function _vaultSyncCacheSizesForTests(): {
  hydrated: number;
  persisted: number;
  pending: number;
} {
  return {
    hydrated: _hydrated.size,
    persisted: _lastPersistedSig.size,
    pending: _pendingFlush.size,
  };
}
