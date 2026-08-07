// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * historyVault.ts — local-first scrollback (Roadmap Phase 1.1).
 *
 * Persists channel/DM messages to IndexedDB so conversations open INSTANTLY
 * from local memory (before the network answers), survive reloads, and are
 * readable offline. No cloud, no bouncer — the device remembers.
 *
 * Design constraints:
 *  - NEVER block or break the UI: every call feature-detects and swallows
 *    failures (private windows, quota, corrupted DBs).
 *  - Bounded: at most VAULT_KEEP messages per target, oldest pruned.
 *  - Dumb storage: messages serialize flat (Dates → epoch ms); reactions and
 *    reply metadata survive; functions/Sets never enter a ChatMessage.
 */
import type { ChatMessage, MessageReaction } from '@/lib/irc/types';
import {
  isEncryptedWireText,
  sanitizePersistedReplyPreviewText,
} from '@/lib/e2ee/replyPrivacy';
import {
  deviceMemoryOwnerKey,
  normalizeDeviceMemoryOwner,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import { clearDeviceTopicReads } from '@/lib/topics/topicReadLedger';
import { clearDeviceTopicHistory } from '@/lib/topics/topicHistory';
import { clearDeviceDMPins } from '@/lib/dmPins';
import { clearDeviceBookmarks } from '@/lib/bookmarks';
import { effectiveKeep, resolvePolicyForChannel, type RetentionPolicy } from './retentionPolicy';
import { boundedSearchField, boundedSearchQuery } from './searchBounds';
import {
  _resetVaultDmSearchPrivacyForTests,
  beginVaultDmPrivacyClear,
  captureVaultDmPrivacyEpoch,
  commitVaultDmSearchPrivacy,
  finishVaultDmPrivacyClear,
  invalidateVaultDmSearchPrivacy,
  isVaultDmSearchPrivacyTracked,
  type VaultDmSearchPrivacy,
} from './dmSearchPrivacy';

const DB_NAME = 'onyx-vault';
const DB_VERSION = 4;
const STORE = 'messages';
const OUTBOX = 'outbox';
export const VAULT_KEEP = 400;
/**
 * Global work cap for one cross-conversation search pass. Per-target retention
 * alone is not a global bound: a device can remember thousands of targets.
 * Search reads the newest rows first through the v4 owner-time index and never
 * materializes or embeds more than this many rows for one query.
 */
export const VAULT_SEARCH_SCAN_MAX = 4096;
/**
 * Hard device-local ceiling for queued sends. A full queue rejects new work;
 * it never evicts an older message the user is still expecting to send.
 */
export const OUTBOX_MAX_ENTRIES = 100;
/** Queued sends older than this are dropped, not fired into a stale room. */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Hard ceilings that keep a hostile or accidentally-oversized import blob from
 * exhausting CPU/memory before the retention prune ever runs. A legitimate
 * export holds at most VAULT_KEEP rows per target; the raw ceiling adds generous
 * headroom (4x) before `parseVaultExport` stops iterating a single target's
 * message array, `MAX_EXPORT_TARGETS` bounds the conversation count, and the
 * aggregate ceiling prevents the product of those two valid-looking dimensions
 * from becoming millions of row validations. These bound the WORK done parsing
 * untrusted JSON — the real per-target retention cap is still enforced
 * downstream by `saveMessages`/`pruneTarget`.
 */
export const MAX_EXPORT_TARGETS = 4096;
export const MAX_EXPORT_RAW_MESSAGES = 4 * VAULT_KEEP;
/** Global validation-work ceiling across every target in one portable blob. */
export const MAX_EXPORT_TOTAL_RAW_MESSAGES = 16 * 1024;
export const MAX_VAULT_TARGET_LENGTH = 512;
export const MAX_VAULT_MESSAGE_ID_LENGTH = 512;
export const MAX_VAULT_SENDER_LENGTH = 256;
export const MAX_VAULT_MESSAGE_TEXT_LENGTH = 64 * 1024;
export const MAX_VAULT_MESSAGE_TYPE_LENGTH = 16;
export const MAX_VAULT_TIMESTAMP_LENGTH = 64;
export const MAX_VAULT_TOPIC_LENGTH = 512;
export const MAX_VAULT_REACTIONS = 64;
export const MAX_VAULT_REACTION_USERS = 128;
export const MAX_VAULT_REACTION_FIELD_LENGTH = 128;
/** Maximum reaction total accepted from imported/exported data. */
export const MAX_VAULT_REACTION_COUNT = 100_000;
export const MAX_VAULT_REPLY_TEXT_LENGTH = 4096;

/**
 * Fields that hold a DECRYPTED or otherwise transient view of a message and must
 * NEVER reach disk. `plaintext` is the decrypted body of an E2EE DM — view-only.
 *
 * This is an explicit OMIT-at-rest allowlist rather than a strip-by-exclusion
 * destructure: a FUTURE transient field added to `ChatMessage` (e.g. a decrypted
 * attachment) would otherwise ride the `...rest` spread onto disk with no vault
 * change, silently regressing the plaintext-at-rest invariant. Listing the omit
 * set here — plus the compile-time partition guard in the test that forces every
 * `ChatMessage` key to be consciously classified persist-or-omit — makes adding
 * such a field a deliberate decision instead of a silent leak.
 */
export const OMIT_AT_REST = ['plaintext'] as const;
type OmitAtRestKey = (typeof OMIT_AT_REST)[number];

type StoredMessage = Omit<ChatMessage, 'time' | OmitAtRestKey> & {
  time: number;
  /** Physical target namespace. Owned rows never collide with legacy rows. */
  target_key: string;
  /** Present only on v4 owner-aware rows; absent legacy rows stay quarantined. */
  owner_key?: string;
};

export interface VaultExportTarget {
  /** Lowercase conversation key stored in this device vault. */
  target: string;
  /** Chronological, vault-safe messages for the target. */
  messages: ChatMessage[];
}

export interface VaultExportSnapshot {
  kind: 'onyx-vault';
  version: 1;
  exportedAt: string;
  targets: VaultExportTarget[];
}

export { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
export type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
export type OutboxOwner = DeviceMemoryOwner;

function physicalTargetKey(target: string, owner?: DeviceMemoryOwner): string {
  const logical = target.toLowerCase();
  if (owner === undefined) return logical;
  const safe = normalizeDeviceMemoryOwner(owner);
  if (!safe) throw new TypeError('Invalid device-memory owner');
  return JSON.stringify([safe.serverUrl, safe.identity, logical]);
}

function parseOwnedPhysicalTarget(key: string): { owner: DeviceMemoryOwner; target: string } | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      !Array.isArray(parsed)
      || parsed.length !== 3
      || typeof parsed[0] !== 'string'
      || typeof parsed[1] !== 'string'
      || typeof parsed[2] !== 'string'
    ) return null;
    const owner = normalizeDeviceMemoryOwner({ serverUrl: parsed[0], identity: parsed[1] });
    return owner ? { owner, target: parsed[2] } : null;
  } catch {
    return null;
  }
}

function logicalTargetFromPhysical(key: string, owner?: DeviceMemoryOwner): string | null {
  if (owner === undefined) return parseOwnedPhysicalTarget(key) ? null : key;
  const safe = normalizeDeviceMemoryOwner(owner);
  if (!safe) return null;
  const parsed = parseOwnedPhysicalTarget(key);
  return parsed
    && parsed.owner.serverUrl === safe.serverUrl
    && parsed.owner.identity === safe.identity
    ? parsed.target
    : null;
}

/** Privacy-cache namespace used by owner-aware DM vault classification. */
export function deviceMemoryPrivacyTarget(owner: DeviceMemoryOwner, target: string): string | null {
  try {
    return physicalTargetKey(target, owner);
  } catch {
    return null;
  }
}

export interface OutboxEntry {
  /** Stable id; the buffer's pending placeholder reuses it as `outbox:<id>`. */
  id: string;
  /** Conversation key ('#channel' or DM nick, lowercased). */
  target_key: string;
  /** Original-case target for the eventual PRIVMSG. */
  target: string;
  text: string;
  queued_at: number;
  /** Same-millisecond ordering tiebreaker (monotonic within a session). */
  seq: number;
  /** Legacy/malformed rows are preserved as ownerless and never auto-sent. */
  owner: OutboxOwner | null;
  /**
   * True after PRIVMSG was admitted to the wire but durable delete failed.
   * Reload must never re-send these — only retry prune.
   */
  wire_admitted?: true;
}

/** Metadata-only outbox invalidation; message text is deliberately excluded. */
export type OutboxChange =
  | Readonly<{ kind: 'queued' }>
  | Readonly<{ kind: 'deleted' }>
  | Readonly<{ kind: 'cleared' }>;

export type OutboxListener = (change: OutboxChange) => void;

/** Fired only after clearVault physically verifies every history surface empty. */
export type VerifiedDeviceHistoryClearListener = () => void;

let _outboxSeq = 0;
const _outboxListeners = new Set<OutboxListener>();
const _verifiedDeviceHistoryClearListeners = new Set<VerifiedDeviceHistoryClearListener>();

/** Observe a verified whole-device history wipe without coupling the vault to UI state. */
export function subscribeVerifiedDeviceHistoryClear(
  listener: VerifiedDeviceHistoryClearListener,
): () => void {
  _verifiedDeviceHistoryClearListeners.add(listener);
  return () => _verifiedDeviceHistoryClearListeners.delete(listener);
}

function notifyVerifiedDeviceHistoryClear(): void {
  for (const listener of _verifiedDeviceHistoryClearListeners) {
    try {
      listener();
    } catch {
      // A presentation listener cannot roll back an already-verified wipe.
    }
  }
}

const RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Optional retention policy consulted by the save/prune path. When `null` (the
 * default), pruning is byte-for-byte identical to the flat VAULT_KEEP tail-slice:
 * `keep === VAULT_KEEP`, no age cutoff. Setting a policy layers per-channel keep
 * overrides and/or a max-age cutoff on top, without changing any key names or the
 * E2EE-plaintext-never-persisted invariant.
 */
let _retentionPolicy: RetentionPolicy | null = null;

/** Configure (or clear, with `null`) the vault's per-channel/max-age retention. */
export function setRetentionPolicy(policy: RetentionPolicy | null): void {
  _retentionPolicy = policy;
}

/** The currently configured retention policy, or `null` for flat VAULT_KEEP. */
export function getRetentionPolicy(): RetentionPolicy | null {
  return _retentionPolicy;
}

/**
 * Apply a policy to the live vault and immediately prune every stored target.
 * This is the destructive boundary used by startup, Preferences, and portable
 * import; callers can await it before hydrating or reporting completion.
 */
export async function applyRetentionPolicy(policy: RetentionPolicy | null): Promise<boolean> {
  _retentionPolicy = policy;
  const db = await openVault();
  if (!db) return false;
  const physicalTargets = await storedTargetKeys(db);
  for (const physicalTarget of physicalTargets) {
    const owned = parseOwnedPhysicalTarget(physicalTarget);
    const logicalTarget = owned?.target ?? physicalTarget;
    const tracked = isVaultDmSearchPrivacyTracked(physicalTarget);
    if (tracked) invalidateVaultDmSearchPrivacy(physicalTarget);
    await pruneTarget(db, physicalTarget, logicalTarget, policy);
    if (tracked) {
      await classifyVaultDmSearchPrivacy(logicalTarget, owned?.owner);
    }
  }
  return true;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVault(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        let messageStore: IDBObjectStore | null;
        if (!db.objectStoreNames.contains(STORE)) {
          messageStore = db.createObjectStore(STORE, { keyPath: ['target_key', 'id'] });
          messageStore.createIndex('by_target_time', ['target_key', 'time']);
        } else {
          messageStore = req.transaction?.objectStore(STORE) ?? null;
        }
        if (messageStore && !messageStore.indexNames.contains('by_time')) {
          messageStore.createIndex('by_time', 'time');
        }
        if (messageStore && !messageStore.indexNames.contains('by_owner_time')) {
          // Legacy rows have no owner_key and therefore do not enter this index.
          // They remain physically clearable but cannot surface in an owned scan.
          messageStore.createIndex('by_owner_time', ['owner_key', 'time']);
        }
        if (!db.objectStoreNames.contains(OUTBOX)) {
          db.createObjectStore(OUTBOX, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * All `by_target_time` index rows for one conversation key, regardless of time.
 *
 * The index key is `[target_key, time]`. Bounding with a numeric floor like
 * `[key, 0]` would silently drop every NEGATIVE-epoch row (a pre-1970 `Date`,
 * reachable via a bogus server `@time` tag or an imported message), hiding it
 * from loads AND from the prune cursor — an unbounded-retention escape. Bracket
 * by the key prefix instead: `[key]` sorts before any `[key, time]` (shorter
 * arrays sort first), and `[key, []]` sorts after any `[key, <number>]` (a
 * number key precedes an array key), so the range covers every time value.
 */
function targetKeyRange(key: string): IDBKeyRange {
  return IDBKeyRange.bound([key], [key, []]);
}

/** Collect unique conversation keys without materializing stored message rows. */
function storedTargetKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const keys = new Set<string>();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve([...keys]);
          return;
        }
        const primaryKey = cursor.primaryKey;
        if (Array.isArray(primaryKey) && typeof primaryKey[0] === 'string') {
          keys.add(primaryKey[0]);
        }
        cursor.continue();
      };
      req.onerror = () => resolve([...keys]);
    } catch {
      resolve([]);
    }
  });
}

export function serializeMessage(
  target: string,
  msg: ChatMessage,
  owner?: DeviceMemoryOwner,
): StoredMessage {
  // Copy the message, then strip every omit-at-rest (decrypted/transient) field
  // so the vault stores only the ciphertext envelope (`text`), never a decrypted
  // body. Mutating the fresh copy — not `msg` — keeps the input immutable.
  const row: Record<string, unknown> = { ...msg };
  for (const key of OMIT_AT_REST) delete row[key];
  if (msg.replyTo) {
    row.replyTo = {
      ...msg.replyTo,
      text: sanitizePersistedReplyPreviewText(msg.replyTo.text),
    };
  }
  row.time = msg.time instanceof Date ? msg.time.getTime() : Number(msg.time) || 0;
  row.target_key = physicalTargetKey(target, owner);
  if (owner !== undefined) {
    const ownerKey = deviceMemoryOwnerKey(owner);
    if (!ownerKey) throw new TypeError('Invalid device-memory owner');
    row.owner_key = ownerKey;
  }
  return row as StoredMessage;
}

export function deserializeMessage(row: StoredMessage): ChatMessage {
  // Strip physical key material AND every omit-at-rest field. A hostile or
  // legacy row that smuggled `plaintext` past serializeMessage must never
  // re-enter the UI/store as decrypted body via loadRecent/loadAround/search.
  const raw = row as StoredMessage & Record<string, unknown>;
  const {
    target_key: _key,
    owner_key: _owner,
    time,
    ...rest
  } = raw;
  for (const key of OMIT_AT_REST) delete rest[key];
  const message = { ...rest, time: new Date(time) } as ChatMessage;
  if (message.replyTo) {
    message.replyTo = {
      ...message.replyTo,
      text: sanitizePersistedReplyPreviewText(message.replyTo.text),
    };
  }
  return message;
}

/**
 * Persist a batch for a target (bulk put; last VAULT_KEEP retained).
 *
 * Returns `true` only when the write transaction actually COMMITTED (an empty
 * batch is a committed no-op), and `false` on every best-effort failure path —
 * no IndexedDB, a rejected/aborted transaction (quota, private mode), or a
 * synchronous `put` throw. Callers that track a persisted watermark (vaultSync)
 * MUST gate on this so a silently-failed write is retried, never treated as
 * durable. The vault stays best-effort: `false` degrades, it never throws.
 */
export async function saveMessages(
  target: string,
  msgs: readonly ChatMessage[],
  owner?: DeviceMemoryOwner,
): Promise<boolean> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return false;
  if (msgs.length === 0) return true;
  const physicalTarget = physicalTargetKey(target, safeOwner ?? undefined);
  const privacyTracked = isVaultDmSearchPrivacyTracked(physicalTarget)
    || msgs.some((message) => message.encrypted || isEncryptedWireText(message.text));
  // Invalidate before the first await. SEARCH is synchronous, so even the small
  // window while a write is opening IndexedDB must not reuse an older `plain`.
  if (privacyTracked) invalidateVaultDmSearchPrivacy(physicalTarget);
  const db = await openVault();
  if (!db) return false;
  try {
    // Pre-trim the batch to the target's effective keep. With no policy this is
    // exactly VAULT_KEEP (identical to before); a per-channel override widens or
    // narrows it so a larger override isn't defeated by the batch pre-trim.
    const keep = _retentionPolicy ? effectiveKeep(_retentionPolicy, target) : VAULT_KEEP;
    // `slice(-0)` is `slice(0)`, so zero needs an explicit empty tail or a
    // zero-retention policy would briefly write the entire input batch.
    const tail = keep === 0 ? [] : msgs.slice(-keep);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const m of tail) store.put(serializeMessage(target, m, safeOwner ?? undefined));
    const committed = await txDone(tx);
    if (!committed) {
      if (privacyTracked) await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
      return false;
    }
    await pruneTarget(db, physicalTarget, target.toLowerCase(), _retentionPolicy);
    if (privacyTracked) await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
    return true;
  } catch {
    /* quota / private mode — the vault is best-effort */
    if (privacyTracked) await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
    return false;
  }
}

/** Load the most recent messages for a target, chronological. */
export async function loadRecent(
  target: string,
  limit = VAULT_KEEP,
  owner?: DeviceMemoryOwner,
): Promise<ChatMessage[]> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return [];
  const db = await openVault();
  if (!db) return [];
  try {
    const key = physicalTargetKey(target, safeOwner ?? undefined);
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = targetKeyRange(key);
    return await new Promise<ChatMessage[]>((resolve) => {
      const out: ChatMessage[] = [];
      // Walk newest-first, stop at limit, reverse to chronological.
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.length >= limit) {
          resolve(out.reverse());
          return;
        }
        out.push(deserializeMessage(cursor.value as StoredMessage));
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out.reverse());
    });
  } catch {
    return [];
  }
}

/**
 * Prove whether one DM target's complete on-device transcript is plain.
 *
 * This intentionally scans every retained row for the target rather than the
 * bounded hydration window: one older encrypted row is enough to keep a query
 * off the server. Cursor/transaction/open failures return `unknown`, never
 * `plain`. Epoch commit prevents a scan racing save/import/clear from publishing
 * a stale proof after that mutation begins.
 */
export async function classifyVaultDmSearchPrivacy(
  target: string,
  owner?: DeviceMemoryOwner,
): Promise<VaultDmSearchPrivacy> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return 'unknown';
  const physicalTarget = physicalTargetKey(target, safeOwner ?? undefined);
  const epoch = captureVaultDmPrivacyEpoch(physicalTarget);
  if (typeof indexedDB === 'undefined') {
    return commitVaultDmSearchPrivacy(epoch, 'plain') ? 'plain' : 'unknown';
  }
  const db = await openVault();
  if (!db) {
    commitVaultDmSearchPrivacy(epoch, 'unknown');
    return 'unknown';
  }

  let privacy: VaultDmSearchPrivacy;
  try {
    privacy = await new Promise<VaultDmSearchPrivacy>((resolve) => {
      let result: VaultDmSearchPrivacy = 'plain';
      let settled = false;
      const finish = (next: VaultDmSearchPrivacy): void => {
        if (settled) return;
        settled = true;
        resolve(next);
      };
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).index('by_target_time').openCursor(targetKeyRange(epoch.target));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const row = cursor.value as StoredMessage;
        if (row.encrypted || isEncryptedWireText(row.text)) {
          result = 'encrypted';
          return;
        }
        cursor.continue();
      };
      req.onerror = () => { result = 'unknown'; };
      tx.oncomplete = () => finish(result);
      tx.onerror = () => finish('unknown');
      tx.onabort = () => finish('unknown');
    });
  } catch {
    privacy = 'unknown';
  }

  return commitVaultDmSearchPrivacy(epoch, privacy) ? privacy : 'unknown';
}

/** Load the local messages nearest a timestamp, returned chronological. */
export async function loadAround(
  target: string,
  at: Date,
  limit = 50,
  owner?: DeviceMemoryOwner,
): Promise<ChatMessage[]> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return [];
  const db = await openVault();
  if (!db) return [];
  try {
    const key = physicalTargetKey(target, safeOwner ?? undefined);
    const anchor = at.getTime();
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = targetKeyRange(key);
    const rows = await new Promise<StoredMessage[]>((resolve) => {
      const out: StoredMessage[] = [];
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.value as StoredMessage);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out);
    });
    return rows
      .filter((r) => !r.deleted && !r.redacted)
      .sort((a, b) => Math.abs(a.time - anchor) - Math.abs(b.time - anchor) || a.time - b.time)
      .slice(0, limit)
      .sort((a, b) => a.time - b.time)
      .map(deserializeMessage);
  } catch {
    return [];
  }
}

/** Export every locally remembered target as a portable, device-safe JSON shape. */
export async function exportVault(owner?: DeviceMemoryOwner): Promise<VaultExportSnapshot> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  const db = await openVault();
  const snapshot: VaultExportSnapshot = {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    targets: [],
  };
  if (!db || (owner !== undefined && !safeOwner)) return snapshot;

  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const ownerKey = safeOwner ? deviceMemoryOwnerKey(safeOwner) : null;
    const rows = await new Promise<unknown[]>((resolve) => {
      const out: unknown[] = [];
      const req = ownerKey
        ? store.index('by_owner_time').openCursor(targetKeyRange(ownerKey), 'prev')
        : store.index('by_time').openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= MAX_EXPORT_TOTAL_RAW_MESSAGES) {
          resolve(out);
          return;
        }
        const row = cursor.value as StoredMessage;
        // The legacy overload remains temporarily for the next wiring commit,
        // but it must never become a back door into newly-owned rows.
        if (ownerKey || row.owner_key === undefined) out.push(row);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    });
    const grouped = new Map<string, ChatMessage[]>();
    for (const row of rows) {
      if (!isRecord(row) || typeof row.target_key !== 'string') continue;
      const logicalTarget = logicalTargetFromPhysical(row.target_key, safeOwner ?? undefined);
      const normalizedTarget = normalizeVaultTarget(logicalTarget, '');
      if (normalizedTarget === null) continue;
      const target = normalizedTarget.toLowerCase();
      const message = reviveExportMessage(row, target);
      if (message === null) continue;
      const group = grouped.get(target) ?? [];
      group.push(message);
      grouped.set(target, group);
    }
    snapshot.targets = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([target, messages]) => ({
        target,
        messages: messages
          .slice()
          .sort((a, b) => a.time.getTime() - b.time.getTime() || a.id.localeCompare(b.id)),
      }));
    return snapshot;
  } catch {
    return snapshot;
  }
}

/**
 * Merge a portable vault snapshot into the local IndexedDB vault.
 *
 * Callers SHOULD pass a `parseVaultExport`-validated snapshot; some importers
 * (Discord/Slack/IRC-log conversions) construct the shape directly. This final
 * storage boundary therefore repeats the same target/row/field/work validation
 * before writing. Success counters are exact surviving imported ids after the
 * destination retention policy prunes, not merely attempted writes.
 */
export interface VaultImportOptions {
  /** Live owner/component guard checked across each target's awaited writes. */
  isCurrent?: () => boolean;
}

export class VaultImportOwnerChangedError extends Error {
  constructor() {
    super('Vault import owner changed');
    this.name = 'VaultImportOwnerChangedError';
  }
}

function assertVaultImportCurrent(options?: VaultImportOptions): void {
  if (options?.isCurrent?.() === false) throw new VaultImportOwnerChangedError();
}

export async function importVault(
  snapshot: VaultExportSnapshot,
  owner?: DeviceMemoryOwner,
  options?: VaultImportOptions,
): Promise<{ targets: number; messages: number }> {
  assertVaultImportCurrent(options);
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return { targets: 0, messages: 0 };
  let targetCount = 0;
  let messageCount = 0;
  if (!Array.isArray(snapshot?.targets)) return { targets: 0, messages: 0 };
  let remainingMessageWork = MAX_EXPORT_TOTAL_RAW_MESSAGES;
  for (const rawEntry of snapshot.targets.slice(0, MAX_EXPORT_TARGETS)) {
    assertVaultImportCurrent(options);
    if (remainingMessageWork <= 0) break;
    if (!isRecord(rawEntry) || !Array.isArray(rawEntry.messages)) continue;
    const normalizedTarget = normalizeVaultTarget(rawEntry.target, '');
    if (normalizedTarget === null) continue;
    const target = normalizedTarget.toLowerCase();
    const targetWork = Math.min(MAX_EXPORT_RAW_MESSAGES, remainingMessageWork);
    const rawMessages = rawEntry.messages.slice(-targetWork);
    remainingMessageWork -= rawMessages.length;
    const revived = dedupMessagesById(
      rawMessages
        .map((message) => reviveExportMessage(message, target))
        .filter((message): message is ChatMessage => message !== null),
    );
    const keep = _retentionPolicy ? effectiveKeep(_retentionPolicy, target) : VAULT_KEEP;
    const retained = keep === 0 ? [] : revived.slice(-keep);
    if (retained.length === 0) continue;
    // Only report rows that actually committed. Import controls surface these
    // counters as a success message, so counting a quota/private-mode failure
    // would tell the user their history was restored when IndexedDB contains
    // nothing.
    assertVaultImportCurrent(options);
    const committed = await saveMessages(target, retained, safeOwner ?? undefined);
    assertVaultImportCurrent(options);
    if (!committed) continue;
    const candidateIds = new Set(retained.map((message) => message.id));
    const survivors = (await loadRecent(target, keep, safeOwner ?? undefined))
      .filter((message) => candidateIds.has(message.id)).length;
    assertVaultImportCurrent(options);
    if (survivors === 0) continue;
    targetCount += 1;
    messageCount += survivors;
  }
  return { targets: targetCount, messages: messageCount };
}

const MESSAGE_TYPES = new Set([
  'msg',
  'action',
  'notice',
  'join',
  'part',
  'quit',
  'kick',
  'mode',
  'topic',
  'nick',
  'system',
  'error',
  'whisper',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeVaultTarget(raw: unknown, fallback: string): string | null {
  let candidate = fallback;
  if (typeof raw === 'string') {
    // Check the raw length before trimming so a hostile multi-megabyte target
    // cannot force an unbounded allocation merely to decide that it is blank.
    if (raw.length > MAX_VAULT_TARGET_LENGTH) return null;
    if (raw.trim()) candidate = raw;
  }
  if (candidate.length === 0 || candidate.length > MAX_VAULT_TARGET_LENGTH) return null;
  const trimmed = candidate.trim();
  if (!trimmed || /[\u0000\r\n\t ]/u.test(trimmed)) return null;
  return trimmed;
}

function isBoundedWireToken(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && value.length <= maxLength
    && !/[\u0000-\u0020\u007f]/u.test(value);
}

function boundedReactionCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
  return Math.min(value, MAX_VAULT_REACTION_COUNT);
}

function reviveExportReaction(raw: unknown): MessageReaction | null {
  if (!isRecord(raw)) return null;
  const emoji = isBoundedWireToken(raw.emoji, MAX_VAULT_REACTION_FIELD_LENGTH)
    ? raw.emoji
    : '';
  if (!emoji) return null;

  const rawUsers = Array.isArray(raw.users) ? raw.users.slice(0, MAX_VAULT_REACTION_USERS) : [];
  const users = rawUsers
    .filter((user): user is string => isBoundedWireToken(user, MAX_VAULT_REACTION_FIELD_LENGTH));
  const explicitCount = boundedReactionCount(raw.count);
  // Older imported snapshots represented anonymous reactors as empty strings.
  // Keep those exports readable while ensuring empty placeholders never return
  // as identities in the current shape.
  const legacyPlaceholderCount = explicitCount === undefined && rawUsers.some((user) => user === '')
    ? rawUsers.length
    : undefined;
  const count = explicitCount ?? legacyPlaceholderCount;
  const total = count === undefined ? undefined : Math.max(count, users.length);

  const reaction: MessageReaction = { emoji, users };
  if (total !== undefined && total > 0) reaction.count = Math.min(total, MAX_VAULT_REACTION_COUNT);
  return reaction;
}

function reviveExportMessage(raw: unknown, fallbackTarget: string): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const from = raw.from;
  const text = raw.text;
  const type = raw.type;
  const target = normalizeVaultTarget(raw.target, fallbackTarget);
  if (
    !isBoundedWireToken(id, MAX_VAULT_MESSAGE_ID_LENGTH) ||
    !isBoundedWireToken(from, MAX_VAULT_SENDER_LENGTH, true) ||
    typeof text !== 'string' ||
    text.length > MAX_VAULT_MESSAGE_TEXT_LENGTH ||
    typeof type !== 'string' ||
    type.length > MAX_VAULT_MESSAGE_TYPE_LENGTH ||
    !MESSAGE_TYPES.has(type) ||
    target === null
  ) {
    return null;
  }

  const rawTime = raw.time;
  const time = rawTime instanceof Date
    ? rawTime
    : new Date(
        typeof rawTime === 'number'
        || (typeof rawTime === 'string' && rawTime.length <= MAX_VAULT_TIMESTAMP_LENGTH)
          ? rawTime
          : NaN,
      );
  if (Number.isNaN(time.getTime())) return null;

  const message: ChatMessage = {
    id,
    time,
    from,
    text,
    type: type as ChatMessage['type'],
    target,
  };
  if (typeof raw.highlight === 'boolean') message.highlight = raw.highlight;
  if (
    raw.topic === null
    || (typeof raw.topic === 'string' && raw.topic.length <= MAX_VAULT_TOPIC_LENGTH)
  ) message.topic = raw.topic;
  if (typeof raw.edited === 'boolean') message.edited = raw.edited;
  if (typeof raw.deleted === 'boolean') message.deleted = raw.deleted;
  if (typeof raw.redacted === 'boolean') message.redacted = raw.redacted;
  if (typeof raw.pending === 'boolean') message.pending = raw.pending;
  if (typeof raw.encrypted === 'boolean') message.encrypted = raw.encrypted;
  if (Array.isArray(raw.reactions)) {
    message.reactions = raw.reactions
      .slice(0, MAX_VAULT_REACTIONS)
      .map(reviveExportReaction)
      .filter((reaction): reaction is MessageReaction => reaction !== null);
  }
  if (
    isRecord(raw.replyTo)
    && isBoundedWireToken(raw.replyTo.id, MAX_VAULT_MESSAGE_ID_LENGTH)
    && isBoundedWireToken(raw.replyTo.from, MAX_VAULT_SENDER_LENGTH, true)
    && typeof raw.replyTo.text === 'string'
    && raw.replyTo.text.length <= MAX_VAULT_REPLY_TEXT_LENGTH
  ) {
    message.replyTo = {
      id: raw.replyTo.id,
      from: raw.replyTo.from,
      text: sanitizePersistedReplyPreviewText(raw.replyTo.text),
    };
  }
  return message;
}

/**
 * Collapse duplicate ids within one target deterministically: last occurrence
 * wins, matching the IndexedDB `put` semantics a re-import would produce (a
 * later row for the same `['target_key','id']` overwrites the earlier one).
 * Insertion order follows first appearance, so a clean export round-trips in
 * place while a tampered blob with repeated ids cannot smuggle in phantom rows.
 * A `Map` (not a plain object) is used so a literal `__proto__`/`constructor`
 * message id is treated as an ordinary key, never a prototype write.
 */
function dedupMessagesById(messages: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()];
}

/** Validate and normalize unknown JSON before it can be imported into the vault. */
export function parseVaultExport(raw: unknown): VaultExportSnapshot | null {
  if (!isRecord(raw) || raw.kind !== 'onyx-vault' || raw.version !== 1 || !Array.isArray(raw.targets)) {
    return null;
  }
  const exportedAt = typeof raw.exportedAt === 'string'
    && raw.exportedAt.length <= MAX_VAULT_TIMESTAMP_LENGTH
    && !Number.isNaN(Date.parse(raw.exportedAt))
    ? raw.exportedAt
    : new Date().toISOString();
  const targets: VaultExportTarget[] = [];
  let remainingMessageWork = MAX_EXPORT_TOTAL_RAW_MESSAGES;
  // Bound the conversation count so a blob with millions of target entries can
  // never force unbounded work before the per-target validation even begins.
  const rawTargets = raw.targets.slice(0, MAX_EXPORT_TARGETS);
  for (const targetRaw of rawTargets) {
    if (remainingMessageWork <= 0) break;
    const normalizedTarget = isRecord(targetRaw)
      ? normalizeVaultTarget(targetRaw.target, '')
      : null;
    if (!isRecord(targetRaw) || normalizedTarget === null || !Array.isArray(targetRaw.messages)) {
      continue;
    }
    const target = normalizedTarget.toLowerCase();
    // Keep only the newest-tail slice of the raw rows before reviving. An export
    // is chronological (see exportVault), so the tail is the most recent history
    // — exactly what retention keeps — and the ceiling caps revive work per
    // target regardless of how the untrusted array is ordered.
    const targetWork = Math.min(MAX_EXPORT_RAW_MESSAGES, remainingMessageWork);
    const rawMessages = targetRaw.messages.slice(-targetWork);
    // Invalid rows still consume validation work; a blob cannot place garbage
    // first to make the parser inspect an unbounded number of later rows.
    remainingMessageWork -= rawMessages.length;
    const revived = rawMessages
      .map((message) => reviveExportMessage(message, target))
      .filter((message): message is ChatMessage => message !== null);
    targets.push({ target, messages: dedupMessagesById(revived) });
  }
  return {
    kind: 'onyx-vault',
    version: 1,
    exportedAt,
    targets,
  };
}

async function pruneTarget(
  db: IDBDatabase,
  physicalKey: string,
  logicalKey = physicalKey,
  policy: RetentionPolicy | null = _retentionPolicy,
): Promise<void> {
  // Resolve the bound for this target. With no policy: keep === VAULT_KEEP and no
  // cutoff, so the cursor loop below is byte-for-byte the flat tail-slice prune.
  let keep = VAULT_KEEP;
  let cutoffMs: number | null = null;
  if (policy) {
    const resolved = resolvePolicyForChannel(policy, logicalKey);
    keep = resolved.keep;
    if (resolved.maxAgeDays !== undefined) {
      cutoffMs = Date.now() - resolved.maxAgeDays * RETENTION_DAY_MS;
    }
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = targetKeyRange(physicalKey);
    let seen = 0;
    await new Promise<void>((resolve) => {
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        seen += 1;
        // Stricter-wins: drop past the count cap OR older than the age cutoff.
        const tooOld = cutoffMs !== null && (cursor.value as StoredMessage).time < cutoffMs;
        if (seen > keep || tooOld) cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

export interface VaultSearchHit {
  /** Conversation key the message lives in ('#channel' or a DM nick, lowercased). */
  target: string;
  message: ChatMessage;
}

/** Read a globally bounded newest-first slice without materializing the full DB. */
async function readRecentSearchRows(
  db: IDBDatabase,
  requestedLimit = VAULT_SEARCH_SCAN_MAX,
  owner?: DeviceMemoryOwner,
): Promise<StoredMessage[]> {
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(VAULT_SEARCH_SCAN_MAX, Math.max(0, Math.floor(requestedLimit)))
    : VAULT_SEARCH_SCAN_MAX;
  if (limit === 0) return [];
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return [];
  const ownerKey = safeOwner ? deviceMemoryOwnerKey(safeOwner) : null;
  return await new Promise<StoredMessage[]>((resolve) => {
    try {
      const rows: StoredMessage[] = [];
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = ownerKey
        ? store.index('by_owner_time').openCursor(targetKeyRange(ownerKey), 'prev')
        : store.index('by_time').openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || rows.length >= limit) {
          resolve(rows);
          return;
        }
        const row = cursor.value as StoredMessage;
        if (ownerKey || row.owner_key === undefined) rows.push(row);
        cursor.continue();
      };
      req.onerror = () => resolve(rows);
      tx.onabort = () => resolve(rows);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Search EVERY remembered conversation on this device (Roadmap Phase 1.3).
 * Case-insensitive substring match on message text and sender, newest first.
 * Search is globally capped in addition to per-target retention; the newest
 * remembered rows are scanned first.
 */
export async function searchVault(
  query: string,
  limit = 80,
  owner?: DeviceMemoryOwner,
): Promise<VaultSearchHit[]> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return [];
  const q = boundedSearchQuery(query).toLocaleLowerCase();
  if (!q) return [];
  const db = await openVault();
  if (!db) return [];
  try {
    const rows = await readRecentSearchRows(db, VAULT_SEARCH_SCAN_MAX, safeOwner ?? undefined);
    return rows
      .filter((r) => {
        // Encrypted vault rows contain ciphertext envelopes only. They cannot
        // produce a useful local-text match and must not be passed onward to an
        // optional embedding provider; loaded transient plaintext is searched
        // separately by the live conversation surface.
        if (r.deleted || r.redacted || r.encrypted) return false;
        return (
          boundedSearchField(r.text).toLocaleLowerCase().includes(q)
          || boundedSearchField(r.from).toLocaleLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map((r) => ({
        target: logicalTargetFromPhysical(r.target_key, safeOwner ?? undefined) ?? '',
        message: deserializeMessage(r),
      }))
      .filter((hit) => hit.target.length > 0);
  } catch {
    return [];
  }
}

/**
 * Read a globally bounded newest-first slice of non-tombstoned messages on this
 * device as VaultSearchHits (semantic/hybrid search reuse this scan). Deleted,
 * redacted, and ciphertext-only encrypted rows are excluded, matching
 * {@link searchVault}.
 */
export async function readAllVaultHits(
  limit = VAULT_SEARCH_SCAN_MAX,
  owner?: DeviceMemoryOwner,
): Promise<VaultSearchHit[]> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return [];
  const db = await openVault();
  if (!db) return [];
  try {
    const rows = await readRecentSearchRows(db, limit, safeOwner ?? undefined);
    return rows
      .filter((r) => !r.deleted && !r.redacted && !r.encrypted)
      .map((r) => ({
        target: logicalTargetFromPhysical(r.target_key, safeOwner ?? undefined) ?? '',
        message: deserializeMessage(r),
      }))
      .filter((hit) => hit.target.length > 0);
  } catch {
    return [];
  }
}

// ── Offline outbox (Roadmap Phase 2.5) ───────────────────────────────────────

function isSafeOutboxTarget(target: unknown): target is string {
  return (
    typeof target === 'string' &&
    target.length > 0 &&
    target === target.trim() &&
    !/[\u0000\r\n\t ]/.test(target)
  );
}

function parseOutboxOwner(value: unknown): OutboxOwner | null {
  return normalizeDeviceMemoryOwner(value);
}

/**
 * Rebuild an entry from an untrusted IndexedDB row. Returning a fresh object
 * strips unknown fields; invalid routing/order metadata is rejected rather than
 * guessed, because replaying a damaged row to the wrong target is worse than
 * leaving it unsent.
 */
function parseOutboxEntry(raw: unknown): OutboxEntry | null {
  if (!isRecord(raw)) return null;
  const { id, target_key: targetKey, target, text, queued_at: queuedAt, seq } = raw;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id !== id.trim() ||
    !isSafeOutboxTarget(target) ||
    typeof targetKey !== 'string' ||
    targetKey !== target.toLowerCase() ||
    typeof text !== 'string' ||
    text.length === 0 ||
    typeof queuedAt !== 'number' ||
    !Number.isSafeInteger(queuedAt) ||
    queuedAt < 0 ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 0
  ) {
    return null;
  }
  return {
    id,
    target_key: targetKey,
    target,
    text,
    queued_at: queuedAt,
    seq,
    owner: parseOutboxOwner(raw.owner),
    // Only the explicit true flag survives — never invent admission state.
    ...(raw.wire_admitted === true ? { wire_admitted: true as const } : {}),
  };
}

function notifyOutbox(change: OutboxChange): void {
  // Snapshot so a listener can safely subscribe/unsubscribe during delivery.
  for (const listener of [..._outboxListeners]) {
    try {
      listener(change);
    } catch {
      // Observers are advisory. A broken view must never turn a committed write
      // into an apparent persistence failure or prevent other views refreshing.
    }
  }
}

/** Subscribe to committed outbox invalidations. Returns an idempotent cleanup. */
export function subscribeOutbox(listener: OutboxListener): () => void {
  _outboxListeners.add(listener);
  return () => {
    _outboxListeners.delete(listener);
  };
}

/** Queue a message composed while offline; it sends on reconnect. */
export async function queueOutbox(
  target: string,
  text: string,
  owner?: OutboxOwner,
): Promise<OutboxEntry | null> {
  if (!isSafeOutboxTarget(target) || typeof text !== 'string' || text.length === 0) return null;
  const safeOwner = owner === undefined ? null : parseOutboxOwner(owner);
  if (owner !== undefined && !safeOwner) return null;
  const db = await openVault();
  if (!db) return null;
  const entry: OutboxEntry = {
    id: `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    target_key: target.toLowerCase(),
    target,
    text,
    queued_at: Date.now(),
    seq: ++_outboxSeq,
    owner: safeOwner,
  };
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    let inserted = false;
    const count = store.count();
    count.onsuccess = () => {
      // Count every physical row, including a corrupt one loadOutbox would hide:
      // corruption must not become an escape hatch around the hard bound.
      if (count.result >= OUTBOX_MAX_ENTRIES) return;
      try {
        // `add`, not `put`: even an astronomically unlikely id collision cannot
        // overwrite an existing user's queued message.
        store.add(entry);
        inserted = true;
      } catch {
        // The transaction will either abort or commit without the entry.
      }
    };
    const committed = await txDone(tx);
    if (!committed || !inserted) return null;
    notifyOutbox({ kind: 'queued' });
    return entry;
  } catch {
    return null;
  }
}

/** All queued sends, oldest first. */
export async function loadOutbox(): Promise<OutboxEntry[]> {
  const db = await openVault();
  if (!db) return [];
  try {
    const tx = db.transaction(OUTBOX, 'readonly');
    const store = tx.objectStore(OUTBOX);
    const rows = await new Promise<OutboxEntry[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(
        (req.result ?? [])
          .map(parseOutboxEntry)
          .filter((entry): entry is OutboxEntry => entry !== null),
      );
      req.onerror = () => resolve([]);
    });
    return rows.sort((a, b) => (
      a.queued_at - b.queued_at ||
      a.seq - b.seq ||
      a.id.localeCompare(b.id)
    ));
  } catch {
    return [];
  }
}

function physicalStoreCount(db: IDBDatabase, storeName: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function physicalOutboxCount(db: IDBDatabase): Promise<number | null> {
  return physicalStoreCount(db, OUTBOX);
}

/**
 * Discard every queued send without touching remembered message history.
 * Success requires the clear transaction to commit, the physical object store
 * to be empty (including corrupt rows hidden by `loadOutbox`), and a sanitized
 * empty read-back. Only then is the metadata-only invalidation published.
 */
export async function clearOutbox(): Promise<boolean> {
  const db = await openVault();
  if (!db) return false;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    tx.objectStore(OUTBOX).clear();
    if (!await txDone(tx)) return false;
    if (await physicalOutboxCount(db) !== 0) return false;
    if ((await loadOutbox()).length !== 0) return false;
    notifyOutbox({ kind: 'cleared' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist wire-admission so a reload cannot double-send after a prune failure.
 * Returns true only when the row is confirmed marked (or already marked).
 */
export async function markOutboxWireAdmitted(id: string): Promise<boolean> {
  if (typeof id !== 'string' || id.length === 0 || id !== id.trim()) return false;
  const db = await openVault();
  if (!db) return false;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    let marked = false;
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const entry = parseOutboxEntry(lookup.result);
      if (!entry) return;
      if (entry.wire_admitted) {
        marked = true;
        return;
      }
      try {
        store.put({ ...entry, wire_admitted: true as const });
        marked = true;
      } catch {
        // Transaction will abort or commit without the mark.
      }
    };
    const committed = await txDone(tx);
    return committed && marked;
  } catch {
    return false;
  }
}

/**
 * Remove one queued send (after it was fired, or expired).
 * Returns true only when the durable row is confirmed gone (already absent or
 * the delete transaction committed). Callers that already admitted the message
 * to the wire MUST treat false as "do not re-admit" and retry prune later —
 * never as permission to send again.
 */
export async function deleteOutboxEntry(id: string): Promise<boolean> {
  const db = await openVault();
  if (!db) return false;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    let existed = false;
    const lookup = store.getKey(id);
    lookup.onsuccess = () => {
      existed = lookup.result !== undefined;
    };
    store.delete(id);
    const committed = await txDone(tx);
    if (!committed) return false;
    if (existed) notifyOutbox({ kind: 'deleted' });
    return true;
  } catch {
    return false;
  }
}

/** Wipe the whole vault (preferences "forget this device"). */
export async function clearVault(): Promise<boolean> {
  // SEARCH must fail closed for the entire clear/verification window. Only a
  // physically verified empty store promotes every target back to plain.
  const privacyGeneration = beginVaultDmPrivacyClear();
  // Topic cursors, topic text history, pinned DMs, and bookmarks are device-local
  // transcript memory too. Clear
  // them even when IndexedDB is unavailable so "forget this device" has one
  // consistent privacy boundary across the vault and localStorage.
  const topicReadsCleared = clearDeviceTopicReads();
  const topicHistoryCleared = clearDeviceTopicHistory();
  const dmPinsCleared = clearDeviceDMPins();
  const bookmarksCleared = clearDeviceBookmarks();
  const indexedDbAvailable = typeof indexedDB !== 'undefined';
  const db = await openVault();
  // An unavailable/blocked IndexedDB handle is not evidence that persisted
  // message rows are absent. A browser with no IndexedDB implementation has no
  // vault to wipe and remains a successful no-op; an implementation that was
  // present but failed to open cannot be verified.
  if (!db) {
    const cleared = !indexedDbAvailable
      && topicReadsCleared
      && topicHistoryCleared
      && dmPinsCleared
      && bookmarksCleared;
    finishVaultDmPrivacyClear(privacyGeneration, cleared);
    if (cleared) notifyVerifiedDeviceHistoryClear();
    return cleared;
  }
  try {
    const tx = db.transaction([STORE, OUTBOX], 'readwrite');
    const outbox = tx.objectStore(OUTBOX);
    let outboxHadRows = false;
    const count = outbox.count();
    count.onsuccess = () => {
      outboxHadRows = count.result > 0;
    };
    tx.objectStore(STORE).clear();
    outbox.clear();
    const committed = await txDone(tx);
    if (!committed) {
      finishVaultDmPrivacyClear(privacyGeneration, false);
      return false;
    }
    const [messageCount, outboxCount, sanitizedOutbox] = await Promise.all([
      physicalStoreCount(db, STORE),
      physicalOutboxCount(db),
      loadOutbox(),
    ]);
    const outboxVerified = outboxCount === 0 && sanitizedOutbox.length === 0;
    if (outboxHadRows && outboxVerified) notifyOutbox({ kind: 'cleared' });
    const cleared = messageCount === 0
      && outboxVerified
      && topicReadsCleared
      && topicHistoryCleared
      && dmPinsCleared
      && bookmarksCleared;
    finishVaultDmPrivacyClear(privacyGeneration, cleared);
    if (cleared) notifyVerifiedDeviceHistoryClear();
    return cleared;
  } catch {
    finishVaultDmPrivacyClear(privacyGeneration, false);
    return false;
  }
}

/**
 * Resolve when a transaction settles: `true` on commit, `false` on error/abort.
 * Never rejects — the vault swallows IndexedDB failures into a degraded return
 * rather than throwing into the UI.
 */
function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Test hook — reset the module's cached connection and retention policy. */
export function _resetVaultForTests(): void {
  dbPromise = null;
  _retentionPolicy = null;
  _outboxSeq = 0;
  _outboxListeners.clear();
  _resetVaultDmSearchPrivacyForTests();
}
