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
import { safeStorage, type SafeStorage } from '@/lib/prefs/preferences';
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
const DB_VERSION = 6;
const STORE = 'messages';
const OUTBOX = 'outbox';
const SCHEDULED = 'scheduled';
const VAULT_META = 'vault_meta';
let cachedEraseEpoch = 0;
let writeReservationSeq = 0;
export const VAULT_KEEP = 400;

function noteCachedEraseEpoch(epoch: number): void {
  if (epoch > cachedEraseEpoch) cachedEraseEpoch = epoch;
}
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
export type ScheduledClaim = { token: string; claimedAt: number };
export type ScheduledVaultRow = { id: string; channel: string; text: string; sendAt: number; owner: DeviceMemoryOwner | null; claim?: ScheduledClaim; generation?: number; clearEpoch?: number };

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
  /** Durable same-origin claim fence. Claims are never silently reclaimed. */
  claim?: { token: string; claimedAt: number };
}

/** Metadata-only outbox invalidation; message text is deliberately excluded. */
export type OutboxChange =
  | Readonly<{ kind: 'queued' }>
  | Readonly<{ kind: 'deleted' }>
  | Readonly<{ kind: 'changed' }>
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
  const opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
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
          if (!db.objectStoreNames.contains(SCHEDULED)) db.createObjectStore(SCHEDULED, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(VAULT_META)) db.createObjectStore(VAULT_META, { keyPath: 'id' });
        } catch {
          try {
            req.transaction?.abort();
          } catch {
            // The request will report the upgrade failure if it is already inactive.
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const invalidate = () => {
          if (dbPromise === opening) dbPromise = null;
        };
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // The browser may have closed it already.
          }
          invalidate();
        };
        db.onclose = invalidate;
        resolve(db);
      };
      req.onerror = () => resolve(null);
      // Keep this single open request pending while another connection owns
      // the upgrade. Once that connection closes, IndexedDB delivers
      // `onsuccess`; resolving null here would poison dbPromise for the rest
      // of the module lifetime and make the vault permanently unavailable.
      req.onblocked = () => {};
    } catch {
      resolve(null);
    }
  });
  dbPromise = opening;
  // A failed open is recoverable state, not a permanent capability decision.
  // Keep concurrent callers on the same attempt, then discard only that failed
  // attempt so a later operation can retry after the browser unblocks storage.
  void opening.then((db) => {
    if (!db && dbPromise === opening) dbPromise = null;
  }, () => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function scheduledOwnerKey(owner: DeviceMemoryOwner | null): string { return owner ? (deviceMemoryOwnerKey(owner) ?? 'legacy') : 'legacy'; }
function scheduledRowKey(row: ScheduledVaultRow): string { return `${scheduledOwnerKey(row.owner)}\u0000${row.id}`; }
function scheduledCopy(row: ScheduledVaultRow): ScheduledVaultRow { return { ...row, owner: row.owner ? { ...row.owner } : null, ...(row.claim ? { claim: { ...row.claim } } : {}) }; }

type ScheduledStoredRow = {
  id: string;
  owner?: DeviceMemoryOwner | null;
  generation?: number;
  clearEpoch?: number;
  claim?: ScheduledClaim;
  channel?: string;
  text?: string;
  sendAt?: number;
  status?: 'canceled' | 'admitted';
  statusAt?: number;
};

function scheduledStoredKey(owner: DeviceMemoryOwner, id: string): string {
  return `${scheduledOwnerKey(owner)}\u0000${id}`;
}

function ownerGenerationKey(owner: DeviceMemoryOwner): string { return `owner-generation:${scheduledOwnerKey(owner)}`; }

function scheduledVisibleRow(raw: ScheduledStoredRow): ScheduledVaultRow | null {
  if (raw.status || typeof raw.channel !== 'string' || typeof raw.text !== 'string' || typeof raw.sendAt !== 'number') return null;
  const separator = raw.id.indexOf('\u0000');
  if (separator < 0) return null;
  return scheduledCopy({ id: raw.id.slice(separator + 1), channel: raw.channel, text: raw.text, sendAt: raw.sendAt, owner: raw.owner ?? null, ...(raw.claim ? { claim: raw.claim } : {}), ...(raw.generation !== undefined ? { generation: raw.generation } : {}), ...(raw.clearEpoch !== undefined ? { clearEpoch: raw.clearEpoch } : {}) });
}

const CLEAR_EPOCH_KEY = 'clear-epoch';
const WRITE_RESERVATION_PREFIX = 'message-write:';
/** Same-origin control metadata only; values never contain vault payloads. */
const SYNC_CLEAR_EPOCH_KEY = 'onyx:vault:clear-epoch';
const SYNC_CLEAR_FENCE_KEY = 'onyx:vault:clear-fence';
const SYNC_CLEAR_PENDING_KEY = 'onyx:vault:clear-pending';
const SYNC_WRITE_INTENT_PREFIX = 'onyx:vault:write-intent:';

export type VaultWriteIntent = Readonly<{
  token: string;
  expectedEraseEpoch: number;
}>;

export type VaultWriteReservation = Readonly<{
  token: string;
  eraseEpoch: number;
}>;

type StoredWriteReservation = {
  id: string;
  kind: 'message-write';
  epoch: number;
};

type SynchronousWriteIntentRecord = Readonly<{
  epoch: number;
  fence: string;
}>;

type SynchronousClearPendingRecord = Readonly<{
  epoch: number;
  fence: string;
}>;

function writeReservationKey(token: string): string {
  return `${WRITE_RESERVATION_PREFIX}${token}`;
}

function syncWriteIntentKey(token: string): string {
  return `${SYNC_WRITE_INTENT_PREFIX}${token}`;
}

function localVaultStorage(): SafeStorage | null {
  return safeStorage();
}

function parseSyncEpoch(raw: string | null): number | null {
  if (raw === null) return 0;
  const epoch = Number(raw);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

function readSynchronousClearEpoch(storage: SafeStorage): number | null {
  const raw = storage.getItem(SYNC_CLEAR_EPOCH_KEY);
  return storage.failed ? null : parseSyncEpoch(raw);
}

function ensureSynchronousClearFence(storage: SafeStorage): string | null {
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const current = readSynchronousControlVersion(storage);
    if (!current) return null;
    if (current.fence) return current.fence;
    const fence = newWriteReservationToken();
    const result = mutateSynchronousControlIfCurrent(
      storage,
      current,
      () => {
        const latest = readSynchronousControlVersion(storage);
        if (!latest || latest.epoch !== current.epoch || latest.fence !== current.fence) return 'superseded';
        return storage.setItem(SYNC_CLEAR_FENCE_KEY, fence);
      },
      (version) => version.fence === fence && version.epoch >= current.epoch,
    );
    if (result === 'applied') return fence;
    if (result === 'failed') return null;
  }
  return null;
}

function encodeSynchronousWriteIntent(record: SynchronousWriteIntentRecord): string {
  return JSON.stringify([record.epoch, record.fence]);
}

function parseSynchronousWriteIntent(raw: string | null): SynchronousWriteIntentRecord | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || !Number.isSafeInteger(parsed[0])
      || parsed[0] < 0
      || typeof parsed[1] !== 'string'
      || parsed[1].length === 0
    ) return null;
    return { epoch: parsed[0], fence: parsed[1] };
  } catch {
    return null;
  }
}

function parseSynchronousClearPending(raw: string | null): SynchronousClearPendingRecord | null {
  const parsed = parseSynchronousWriteIntent(raw);
  return parsed ? { epoch: parsed.epoch, fence: parsed.fence } : null;
}

const SYNCHRONOUS_CONTROL_RETRIES = 4;
type SynchronousControlVersion = Readonly<{ epoch: number; fence: string | null }>;
type SynchronousControlMutation = 'applied' | 'superseded' | 'failed';
type SynchronousControlMutationResult = boolean | 'superseded';

function readSynchronousControlVersion(storage: SafeStorage): SynchronousControlVersion | null {
  const epoch = readSynchronousClearEpoch(storage);
  const fence = storage.getItem(SYNC_CLEAR_FENCE_KEY);
  if (storage.failed || epoch === null) return null;
  return { epoch, fence };
}

/** Read twice so a cross-context replacement between reads is observed. */
function synchronousControlVersionIsCurrent(
  storage: SafeStorage,
  expected: SynchronousControlVersion,
): boolean {
  const first = readSynchronousControlVersion(storage);
  if (!first || first.epoch !== expected.epoch || first.fence !== expected.fence) return false;
  const second = readSynchronousControlVersion(storage);
  return second !== null
    && second.epoch === expected.epoch
    && second.fence === expected.fence;
}

/**
 * localStorage has no native compare-and-swap. Revalidate immediately before
 * each mutation and after it; callers retry from a fresh snapshot when a newer
 * clear supersedes this operation.
 */
function mutateSynchronousControlIfCurrent(
  storage: SafeStorage,
  expected: SynchronousControlVersion,
  mutation: () => SynchronousControlMutationResult,
  verifyAfter: (version: SynchronousControlVersion) => boolean = (version) =>
    version.fence === expected.fence && version.epoch >= expected.epoch,
): SynchronousControlMutation {
  if (!synchronousControlVersionIsCurrent(storage, expected)) return 'superseded';
  let result: SynchronousControlMutationResult;
  try {
    result = mutation();
  } catch {
    return 'failed';
  }
  if (result === 'superseded') return result;
  if (!result || storage.failed) return 'failed';
  const after = readSynchronousControlVersion(storage);
  if (!after) return 'failed';
  return verifyAfter(after) ? 'applied' : 'superseded';
}

function setSynchronousEpochAtLeast(
  storage: SafeStorage,
  expected: SynchronousControlVersion,
  epoch: number,
): SynchronousControlMutationResult {
  const current = readSynchronousControlVersion(storage);
  if (!current || current.fence !== expected.fence || current.epoch < expected.epoch) return 'superseded';
  if (current.epoch >= epoch) return true;
  return storage.setItem(SYNC_CLEAR_EPOCH_KEY, String(epoch));
}

function removeSynchronousClearPendingIfCurrent(
  storage: SafeStorage,
  expected: SynchronousControlVersion,
  fence: string,
  maxEpoch: number,
): SynchronousControlMutation {
  return mutateSynchronousControlIfCurrent(storage, expected, () => {
    const pending = parseSynchronousClearPending(storage.getItem(SYNC_CLEAR_PENDING_KEY));
    if (storage.failed) return false;
    if (!pending || pending.fence !== fence || pending.epoch > maxEpoch) return true;
    const current = readSynchronousControlVersion(storage);
    if (!current || current.fence !== expected.fence || current.epoch < expected.epoch) return 'superseded';
    return storage.removeItem(SYNC_CLEAR_PENDING_KEY);
  });
}

function removeSynchronousWriteIntentsExcept(
  storage: SafeStorage,
  epoch: number,
  fence: string,
): SynchronousControlMutation {
  const expected = { epoch, fence } satisfies SynchronousControlVersion;
  const intentKeys: string[] = [];
  const length = storage.length;
  if (storage.failed) return 'failed';
  if (!synchronousControlVersionIsCurrent(storage, expected)) return 'superseded';
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (storage.failed) return 'failed';
    if (key?.startsWith(SYNC_WRITE_INTENT_PREFIX)) intentKeys.push(key);
  }
  for (const key of intentKeys) {
    const record = parseSynchronousWriteIntent(storage.getItem(key));
    if (storage.failed) return 'failed';
    if (record?.epoch !== epoch || record.fence !== fence) {
      const removed = mutateSynchronousControlIfCurrent(storage, expected, () => {
        const current = readSynchronousControlVersion(storage);
        if (!current || current.fence !== fence || current.epoch < epoch) return 'superseded';
        const latest = parseSynchronousWriteIntent(storage.getItem(key));
        if (storage.failed) return false;
        if (latest?.epoch === epoch && latest.fence === fence) return true;
        return storage.removeItem(key);
      });
      if (removed !== 'applied') return removed;
    }
  }
  return synchronousControlVersionIsCurrent(storage, expected) ? 'applied' : 'superseded';
}

/**
 * The synchronous mirror is a control-plane fence, not a second vault. It is
 * intentionally monotonic when learning a durable epoch so an older async read
 * cannot roll a newer clear back. Clear completion may set the exact durable
 * epoch when concurrent clears have compressed multiple provisional values.
 */
function recordSynchronousClearEpoch(epoch: number): void {
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const storage = localVaultStorage();
    if (!storage) return;
    const current = readSynchronousControlVersion(storage);
    if (!current) return;
    if (current.epoch >= epoch) return;
    const result = mutateSynchronousControlIfCurrent(
      storage,
      current,
      () => setSynchronousEpochAtLeast(storage, current, epoch),
    );
    if (result === 'applied' || result === 'failed') return;
  }
}

function synchronousIntentIsCurrent(intent: VaultWriteIntent): boolean {
  const storage = localVaultStorage();
  if (!storage) return false;
  const currentFence = storage.getItem(SYNC_CLEAR_FENCE_KEY);
  const intentRecord = parseSynchronousWriteIntent(storage.getItem(syncWriteIntentKey(intent.token)));
  if (storage.failed) return false;
  return readSynchronousClearEpoch(storage) === intent.expectedEraseEpoch
    && !storage.failed
    && intentRecord?.epoch === intent.expectedEraseEpoch
    && intentRecord.fence === currentFence;
}

function forgetSynchronousWriteIntent(token: string): boolean {
  const storage = localVaultStorage();
  if (!storage || typeof token !== 'string' || token.length === 0) return false;
  return storage.removeItem(syncWriteIntentKey(token));
}

/**
 * Register the payload's admission intent before any asynchronous database
 * open. The key/value contain only an opaque token and expected epoch. This is
 * the pre-clear linearization point for a pending snapshot: a clear started by
 * another module can synchronously revoke this token before a delayed IDB
 * reservation gets a chance to begin.
 */
export function beginVaultWriteIntent(): VaultWriteIntent | null {
  const storage = localVaultStorage();
  if (!storage) return null;
  const expectedEraseEpoch = readSynchronousClearEpoch(storage);
  const fence = ensureSynchronousClearFence(storage);
  if (expectedEraseEpoch === null || fence === null) return null;
  const intent: VaultWriteIntent = {
    token: newWriteReservationToken(),
    expectedEraseEpoch,
  };
  try {
    storage.setItem(syncWriteIntentKey(intent.token), encodeSynchronousWriteIntent({ epoch: expectedEraseEpoch, fence }));
    if (!synchronousIntentIsCurrent(intent)) {
      forgetSynchronousWriteIntent(intent.token);
      return null;
    }
    return intent;
  } catch {
    forgetSynchronousWriteIntent(intent.token);
    return null;
  }
}

/** Cancel a pre-admission intent without waiting for a possibly delayed IDB open. */
export function cancelVaultWriteIntent(intent: VaultWriteIntent): void {
  if (!intent || typeof intent.token !== 'string') return;
  forgetSynchronousWriteIntent(intent.token);
}

type SynchronousClearFence = Readonly<{
  provisionalEpoch: number;
  fence: string;
}>;

/**
 * Revoke old intents synchronously, before clear opens/queues its IDB
 * transaction. The epoch marker is written first; an old intent that races the
 * key enumeration is still rejected by `synchronousIntentIsCurrent`. New
 * intents created after this point carry the new opaque fence and provisional
 * epoch; they are left alone and can survive a successful clear, but an intent
 * from an older/aborted fence cannot become current when a numeric epoch is
 * reused.
 */
function beginSynchronousClearFence(): SynchronousClearFence | null {
  const storage = localVaultStorage();
  if (!storage) return null;
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const previous = readSynchronousControlVersion(storage);
    if (!previous || previous.epoch === Number.MAX_SAFE_INTEGER) return null;
    const provisionalEpoch = previous.epoch + 1;
    const fence = newWriteReservationToken();

    // Install the opaque fence only if the snapshot that supplied the next
    // epoch is still current. This is the synchronous pre-admission revocation
    // point; a superseded attempt retries with a fresh fence/epoch.
    let result = mutateSynchronousControlIfCurrent(
      storage,
      previous,
      () => {
        const latest = readSynchronousControlVersion(storage);
        if (!latest || latest.epoch !== previous.epoch || latest.fence !== previous.fence) return 'superseded';
        return storage.setItem(SYNC_CLEAR_FENCE_KEY, fence);
      },
      (version) => version.fence === fence && version.epoch >= previous.epoch,
    );
    if (result === 'superseded') continue;
    if (result === 'failed') return null;

    const withFence = readSynchronousControlVersion(storage);
    if (!withFence || withFence.fence !== fence) continue;
    result = mutateSynchronousControlIfCurrent(
      storage,
      withFence,
      () => setSynchronousEpochAtLeast(storage, withFence, provisionalEpoch),
    );
    if (result === 'superseded') continue;
    if (result === 'failed') return null;

    const withEpoch = readSynchronousControlVersion(storage);
    if (!withEpoch || withEpoch.fence !== fence || withEpoch.epoch < provisionalEpoch) continue;
    result = mutateSynchronousControlIfCurrent(
      storage,
      withEpoch,
      () => {
        const latest = readSynchronousControlVersion(storage);
        if (!latest || latest.epoch !== withEpoch.epoch || latest.fence !== fence) return 'superseded';
        return storage.setItem(
          SYNC_CLEAR_PENDING_KEY,
          encodeSynchronousWriteIntent({ epoch: provisionalEpoch, fence }),
        );
      },
    );
    if (result === 'superseded') continue;
    if (result === 'failed') return null;

    // Keep only intents registered after this fence. Each removal revalidates
    // the fence so a newer tab's intent cannot be discarded.
    result = removeSynchronousWriteIntentsExcept(storage, withEpoch.epoch, fence);
    if (result === 'superseded') continue;
    if (result === 'failed') return null;
    const finalVersion = readSynchronousControlVersion(storage);
    if (finalVersion?.fence === fence && finalVersion.epoch >= provisionalEpoch) {
      return { provisionalEpoch, fence };
    }
  }
  return null;
}

/** Set the exact durable epoch only when this clear still owns the marker. */
async function completeSynchronousClearFence(fence: SynchronousClearFence | null, epoch: number): Promise<void> {
  if (!fence) return;
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const storage = localVaultStorage();
    if (!storage) return;
    const current = readSynchronousControlVersion(storage);
    if (!current) return;
    if (current.fence !== fence.fence) {
      // Another clear owns the current fence. This commit is still durable and
      // may advance the numeric mirror, but it must not replace that fence or
      // delete its intents.
      recordSynchronousClearEpoch(epoch);
      return;
    }

    const targetEpoch = Math.max(current.epoch, epoch);
    if (targetEpoch > current.epoch) {
      const updated = mutateSynchronousControlIfCurrent(
        storage,
        current,
        () => setSynchronousEpochAtLeast(storage, current, targetEpoch),
      );
      if (updated === 'superseded') continue;
      if (updated === 'failed') return;
    }

    const afterEpoch = readSynchronousControlVersion(storage);
    if (!afterEpoch || afterEpoch.fence !== fence.fence) continue;
    const cleaned = removeSynchronousWriteIntentsExcept(storage, afterEpoch.epoch, fence.fence);
    if (cleaned === 'superseded') continue;
    if (cleaned === 'failed') return;
    const pending = removeSynchronousClearPendingIfCurrent(
      storage,
      afterEpoch,
      fence.fence,
      afterEpoch.epoch,
    );
    if (pending === 'superseded') continue;
    if (pending === 'failed') return;
    if (synchronousControlVersionIsCurrent(storage, afterEpoch)) return;
  }
}

/**
 * A failed clear must not claim a durable new epoch. Reconcile the provisional
 * epoch from IDB when possible, but keep the new opaque fence nonce. Intents
 * from the failed fence are deliberately not resurrected; a later genuine
 * mutation registers a fresh intent after the durable epoch is known. An
 * already durable reservation remains usable because the clear transaction
 * never reached its linearization point and therefore did not remove its row.
 */
async function reconcileAbortedSynchronousClear(fence: SynchronousClearFence | null): Promise<void> {
  if (!fence) return;
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const storage = localVaultStorage();
    if (!storage) return;
    const before = readSynchronousControlVersion(storage);
    if (!before || before.fence !== fence.fence) return;
    const db = await openVault();
    const durableEpoch = db ? await readClearEpoch(db) : null;
    if (durableEpoch === null) return;

    const current = readSynchronousControlVersion(storage);
    if (!current || current.fence !== fence.fence) continue;
    const rebased = mutateSynchronousControlIfCurrent(
      storage,
      current,
      () => {
        const latest = readSynchronousControlVersion(storage);
        if (!latest || latest.fence !== fence.fence) return 'superseded';
        // Only the provisional marker owned by this failed clear may be
        // lowered. A newer epoch is evidence that another control operation
        // won, so leave it untouched and retry/fail closed.
        if (latest.epoch > durableEpoch && latest.epoch !== fence.provisionalEpoch) return 'superseded';
        return storage.setItem(SYNC_CLEAR_EPOCH_KEY, String(durableEpoch));
      },
      (version) => version.fence === fence.fence && version.epoch >= durableEpoch,
    );
    if (rebased === 'superseded') continue;
    if (rebased === 'failed') return;

    const after = readSynchronousControlVersion(storage);
    if (!after || after.fence !== fence.fence) continue;
    // Intents created under the failed fence are not resurrected. A new
    // mutation registers a fresh intent after this proven durable epoch.
    const cleaned = removeSynchronousWriteIntentsExcept(storage, durableEpoch, fence.fence);
    if (cleaned === 'superseded') continue;
    if (cleaned === 'failed') return;
    const pending = removeSynchronousClearPendingIfCurrent(
      storage,
      after,
      fence.fence,
      Number.MAX_SAFE_INTEGER,
    );
    if (pending === 'superseded') continue;
    if (pending === 'failed') return;
    if (synchronousControlVersionIsCurrent(storage, after)) return;
  }
}

function newWriteReservationToken(): string {
  writeReservationSeq += 1;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${crypto.randomUUID()}-${writeReservationSeq.toString(36)}`;
    }
  } catch {
    // The monotonic/random fallback below is sufficient for an opaque fence id.
  }
  return `${Date.now().toString(36)}-${writeReservationSeq.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function readClearEpoch(db: IDBDatabase): Promise<number | null> {
  try {
    const tx = db.transaction(VAULT_META, 'readonly');
    const req = tx.objectStore(VAULT_META).get(CLEAR_EPOCH_KEY);
    return await new Promise(resolve => {
      let value: number | null = null;
      let settled = false;
      const finish = (next: number | null) => { if (!settled) { settled = true; resolve(next); } };
      req.onsuccess = () => { value = Number(req.result?.value) || 0; };
      req.onerror = () => { req.onerror = null; finish(null); };
      tx.oncomplete = () => finish(value);
      tx.onerror = () => finish(null);
      tx.onabort = () => finish(null);
    });
  } catch { return null; }
}

/**
 * Reconcile the same-origin control plane with the durable epoch before a
 * writer is admitted. A numeric marker ahead of IDB is safe to lower only when
 * the matching pending-clear record proves it was provisional; an unmarked
 * mismatch remains fail closed rather than guessing which clear won.
 */
async function reconcileSynchronousControlWithDurable(
  db: IDBDatabase,
  requireSynchronousControl: boolean,
): Promise<number | null> {
  for (let attempt = 0; attempt < SYNCHRONOUS_CONTROL_RETRIES; attempt += 1) {
    const durableEpoch = await readClearEpoch(db);
    if (durableEpoch === null) return null;

    const storage = localVaultStorage();
    if (!storage) return requireSynchronousControl ? null : durableEpoch;

    const control = readSynchronousControlVersion(storage);
    const pendingRaw = storage.getItem(SYNC_CLEAR_PENDING_KEY);
    if (!control || storage.failed) return null;
    const pending = parseSynchronousClearPending(pendingRaw);
    // A non-empty malformed pending marker is evidence we cannot classify the
    // numeric marker. Do not turn corruption into an admission decision.
    if (pendingRaw !== null && pending === null) return null;

    if (pending && pending.fence === control.fence && pending.epoch > durableEpoch) {
      if (control.epoch !== pending.epoch) return null;
      // This is a proven failed/incomplete clear. Rebase to the durable epoch
      // and revoke every token from the failed fence; none may be resurrected.
      const rebased = mutateSynchronousControlIfCurrent(
        storage,
        control,
        () => {
          const latest = readSynchronousControlVersion(storage);
          if (!latest || latest.fence !== control.fence || latest.epoch !== control.epoch) return 'superseded';
          if (storage.getItem(SYNC_CLEAR_PENDING_KEY) !== pendingRaw || storage.failed) return 'superseded';
          return storage.setItem(SYNC_CLEAR_EPOCH_KEY, String(durableEpoch));
        },
        (version) => version.fence === control.fence && version.epoch >= durableEpoch,
      );
      if (rebased === 'superseded') continue;
      if (rebased === 'failed') return null;

      const after = readSynchronousControlVersion(storage);
      if (!after || after.fence !== control.fence) continue;
      const cleaned = removeSynchronousWriteIntentsExcept(storage, durableEpoch, control.fence);
      if (cleaned === 'superseded') continue;
      if (cleaned === 'failed') return null;
      const removed = removeSynchronousClearPendingIfCurrent(
        storage,
        after,
        control.fence,
        Number.MAX_SAFE_INTEGER,
      );
      if (removed === 'superseded') continue;
      if (removed === 'failed') return null;
      if (synchronousControlVersionIsCurrent(storage, after)) return durableEpoch;
      continue;
    }

    // A pending clear with no matching current fence, or one that is still
    // ahead of IDB without the exact proof above, cannot be classified safely.
    if (pending && pending.fence === control.fence && pending.epoch > durableEpoch) return null;
    if (control.epoch > durableEpoch) return null;

    if (durableEpoch > control.epoch) {
      const advanced = mutateSynchronousControlIfCurrent(
        storage,
        control,
        () => {
          if (storage.getItem(SYNC_CLEAR_PENDING_KEY) !== pendingRaw || storage.failed) return 'superseded';
          return setSynchronousEpochAtLeast(storage, control, durableEpoch);
        },
      );
      if (advanced === 'superseded') continue;
      if (advanced === 'failed') return null;
    }

    const after = readSynchronousControlVersion(storage);
    if (!after) return null;
    if (pending && pending.fence === after.fence && pending.epoch <= durableEpoch) {
      const removed = removeSynchronousClearPendingIfCurrent(
        storage,
        after,
        after.fence,
        durableEpoch,
      );
      if (removed === 'superseded') continue;
      if (removed === 'failed') return null;
    }
    if (synchronousControlVersionIsCurrent(storage, after)) return durableEpoch;
  }
  return null;
}

/** Capture the durable erase fence for a delayed writer. */
export async function captureVaultEraseEpoch(): Promise<number | null> {
  const db = await openVault();
  const epoch = db ? await reconcileSynchronousControlWithDurable(db, false) : null;
  if (epoch !== null) {
    noteCachedEraseEpoch(epoch);
    recordSynchronousClearEpoch(epoch);
  }
  return epoch;
}
export function currentVaultEraseEpoch(): number { return cachedEraseEpoch; }

/**
 * Durably admit one delayed message flush without storing its payload. The
 * caller's synchronous intent is mandatory authority: this function never
 * creates a replacement token after an async open. The IDB transaction is the
 * durable admission point. A clear queued first revokes the intent and causes
 * this transaction to abort; a reservation committed first is still removed
 * by the later clear. The delayed payload cannot re-admit by observing a newer
 * epoch alone.
 */
export async function reserveVaultWrite(
  suppliedIntent?: VaultWriteIntent,
): Promise<VaultWriteReservation | null> {
  const intent = suppliedIntent ?? beginVaultWriteIntent();
  if (!intent || !synchronousIntentIsCurrent(intent)) {
    if (intent) forgetSynchronousWriteIntent(intent.token);
    return null;
  }
  const db = await openVault();
  if (!db) {
    forgetSynchronousWriteIntent(intent.token);
    return null;
  }
  const durableControlEpoch = await reconcileSynchronousControlWithDurable(db, true);
  if (
    durableControlEpoch === null
    || !synchronousIntentIsCurrent(intent)
    || durableControlEpoch !== intent.expectedEraseEpoch
  ) {
    forgetSynchronousWriteIntent(intent.token);
    // A caller that did not supply a token may have observed a provisional
    // marker before this recovery read rebased it. Retry once with a genuinely
    // fresh token; supplied tokens are never silently rebased or resurrected.
    if (suppliedIntent === undefined && durableControlEpoch !== null) {
      const freshIntent = beginVaultWriteIntent();
      if (freshIntent) return reserveVaultWrite(freshIntent);
    }
    return null;
  }
  try {
    const tx = db.transaction(VAULT_META, 'readwrite');
    const meta = tx.objectStore(VAULT_META);
    const epochRequest = meta.get(CLEAR_EPOCH_KEY);
    let eraseEpoch: number | null = null;
    const abort = () => {
      try {
        tx.abort();
      } catch {
        // The transaction may already be inactive; txDone still reports its result.
      }
    };
    epochRequest.onsuccess = () => {
      try {
        eraseEpoch = Number(epochRequest.result?.value) || 0;
        noteCachedEraseEpoch(eraseEpoch);
        recordSynchronousClearEpoch(eraseEpoch);
        if (!synchronousIntentIsCurrent(intent) || eraseEpoch !== intent.expectedEraseEpoch) {
          abort();
          return;
        }
        const row: StoredWriteReservation = {
          id: writeReservationKey(intent.token),
          kind: 'message-write',
          epoch: eraseEpoch,
        };
        meta.put(row);
      } catch {
        abort();
      }
    };
    epochRequest.onerror = abort;
    const committed = await txDone(tx);
    if (!committed || eraseEpoch === null) {
      forgetSynchronousWriteIntent(intent.token);
      return null;
    }
    if (!synchronousIntentIsCurrent(intent)) {
      await releaseVaultWriteReservation(intent.token);
      return null;
    }
    noteCachedEraseEpoch(eraseEpoch);
    return { token: intent.token, eraseEpoch };
  } catch {
    forgetSynchronousWriteIntent(intent.token);
    return null;
  }
}

/** Remove an unconsumed opaque admission record after cancellation/failure. */
export async function releaseVaultWriteReservation(token: string): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0) return false;
  // Remove the synchronous authority first. Even if the database connection
  // is closed, a later delayed caller cannot reuse this token to admit a row.
  forgetSynchronousWriteIntent(token);
  const db = await openVault();
  if (!db) return false;
  try {
    const tx = db.transaction(VAULT_META, 'readwrite');
    tx.objectStore(VAULT_META).delete(writeReservationKey(token));
    return txDone(tx);
  } catch {
    return false;
  }
}

/** Cleanup is best-effort and must never replace the caller's original failure. */
async function releaseSuppliedReservation(reservation?: VaultWriteReservation): Promise<void> {
  if (!reservation) return;
  try {
    await releaseVaultWriteReservation(reservation.token);
  } catch {
    // Preserve the original false result even if cleanup itself is mocked or blocked.
  }
}

/** Read the erase and owner-generation fences from one durable snapshot. */
export async function captureScheduledFence(owner: DeviceMemoryOwner): Promise<{ clearEpoch: number; generation: number } | null> {
  const db = await openVault(); if (!db) return null;
  try {
    const tx = db.transaction(VAULT_META, 'readonly');
    const meta = tx.objectStore(VAULT_META);
    const epochReq = meta.get(CLEAR_EPOCH_KEY);
    const generationReq = meta.get(ownerGenerationKey(owner));
    return await new Promise(resolve => {
      // A pristine vault has no fence rows yet; absence is the zero fence,
      // not a failed admission. The write transaction remains durable and
      // creates/updates its own row as needed.
      let epoch: number | null = 0;
      let generation: number | null = 0;
      let failed = false;
      const finish = () => resolve(failed || epoch === null || generation === null ? null : { clearEpoch: epoch, generation });
      epochReq.onsuccess = () => { epoch = Number(epochReq.result?.value) || 0; };
      generationReq.onsuccess = () => { generation = Number(generationReq.result?.value) || 0; };
      epochReq.onerror = generationReq.onerror = () => { failed = true; };
      tx.oncomplete = finish;
      tx.onerror = tx.onabort = () => { failed = true; finish(); };
    });
  } catch { return null; }
}

/** Advance the durable fence, invalidating delayed writers in every tab. */
export async function advanceVaultEraseEpoch(): Promise<boolean> {
  const db = await openVault(); if (!db) return false;
  try {
    const tx = db.transaction(VAULT_META, 'readwrite');
    const os = tx.objectStore(VAULT_META);
    const req = os.get(CLEAR_EPOCH_KEY);
    let nextEpoch: number | null = null;
    req.onsuccess = () => {
      nextEpoch = (Number(req.result?.value) || 0) + 1;
      noteCachedEraseEpoch(nextEpoch);
      os.put({ id: CLEAR_EPOCH_KEY, value: nextEpoch });
    };
    const committed = await txDone(tx);
    if (committed && nextEpoch !== null) recordSynchronousClearEpoch(nextEpoch);
    return committed && nextEpoch !== null;
  } catch { return false; }
}

/** Durable scheduled queue operations. IDB transactions are the same-origin CAS fence. */
export async function loadScheduledRows(): Promise<ScheduledVaultRow[]> {
  const db = await openVault(); if (!db) return [];
  try {
    const tx = db.transaction([SCHEDULED, VAULT_META], 'readonly');
    const req = tx.objectStore(SCHEDULED).getAll();
    const epochReq = tx.objectStore(VAULT_META).get(CLEAR_EPOCH_KEY);
    return await new Promise<ScheduledVaultRow[]>(resolve => {
      let rows: ScheduledStoredRow[] = [];
      let epoch = 0;
      let failed = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (failed) { resolve([]); return; }
        resolve(rows.map(scheduledVisibleRow).filter((row): row is ScheduledVaultRow =>
          row !== null && (row.clearEpoch === epoch || (row.clearEpoch === undefined && epoch === 0))));
      };
      req.onsuccess = () => { rows = req.result ?? []; };
      req.onerror = () => { failed = true; };
      epochReq.onsuccess = () => { epoch = Number(epochReq.result?.value) || 0; };
      epochReq.onerror = () => { failed = true; };
      tx.oncomplete = finish;
      tx.onerror = () => { failed = true; finish(); };
      tx.onabort = () => { failed = true; finish(); };
    });
  } catch { return []; }
}

/**
 * Reconcile a localStorage snapshot into the durable queue and return the
 * durable active projection. The whole operation is one read/write
 * transaction: missing rows are added, existing claims/statuses are never
 * overwritten, and rows canceled in another tab are omitted from the result.
 */
export async function reconcileScheduledRows(rows: readonly ScheduledVaultRow[], maxCapacity = Number.POSITIVE_INFINITY): Promise<ScheduledVaultRow[] | null> {
  const db = await openVault(); if (!db) return null;
  try {
    const tx = db.transaction([SCHEDULED, VAULT_META], 'readwrite');
    const os = tx.objectStore(SCHEDULED);
    const meta = tx.objectStore(VAULT_META);
    let index = 0;
    let projection: ScheduledStoredRow[] = [];
    let durableCallerEpoch = 0;
    return await new Promise<ScheduledVaultRow[] | null>((resolve) => {
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
      tx.oncomplete = () => resolve(projection.map(scheduledVisibleRow).filter((candidate): candidate is ScheduledVaultRow => candidate !== null && (candidate.clearEpoch === durableCallerEpoch || (candidate.clearEpoch === undefined && durableCallerEpoch === 0))));
      const epochReq = meta.get('clear-epoch');
      epochReq.onerror = () => tx.abort();
      epochReq.onsuccess = () => {
        durableCallerEpoch = Number(epochReq.result?.value) || 0;
        next();
      };
      const next = () => {
        const row = rows[index++];
        if (!row) {
          const all = os.getAll();
          all.onsuccess = () => {
            projection = all.result ?? [];
          };
          all.onerror = () => { tx.abort(); };
          return;
        }
        const get = os.get(scheduledRowKey(row));
        get.onsuccess = () => {
          if (get.result === undefined) {
            if ((row.clearEpoch !== undefined && row.clearEpoch !== durableCallerEpoch)
              || (row.clearEpoch === undefined && durableCallerEpoch !== 0)) { next(); return; }
            const generationReq = row.owner ? meta.get(ownerGenerationKey(row.owner)) : null;
            const addAtGeneration = (generation: number) => {
              if (row.owner && row.generation !== undefined && row.generation !== generation) { next(); return; }
              const all = os.getAll();
              all.onerror = () => tx.abort();
              all.onsuccess = () => {
                const activeCount = (all.result as ScheduledStoredRow[]).filter(candidate =>
                  !candidate.status
                  && (candidate.clearEpoch === durableCallerEpoch || (candidate.clearEpoch === undefined && durableCallerEpoch === 0)),
                ).length;
                if (activeCount >= maxCapacity) { next(); return; }
                const add = os.add({ ...scheduledCopy(row), id: scheduledRowKey(row), clearEpoch: durableCallerEpoch, generation } satisfies ScheduledStoredRow);
              // A concurrent add can win between get() and add().  It is an
              // add-only migration, so ConstraintError is a successful
              // no-op, not a failed reconciliation.  Stop the error from
              // bubbling to the transaction as well as preventing the
              // request's default abort behavior (fake-indexeddb and
              // browsers differ here).
              add.onerror = (event) => {
                if (add.error?.name === 'ConstraintError') {
                  event.preventDefault();
                  event.stopPropagation();
                  next();
                } else {
                  tx.abort();
                }
              };
              add.onsuccess = next;
              };
            };
            if (!generationReq) addAtGeneration(0);
            else { generationReq.onerror = () => tx.abort(); generationReq.onsuccess = () => addAtGeneration(Number(generationReq.result?.value) || 0); }
          } else next();
        };
        get.onerror = () => { tx.abort(); };
      };
    });
  } catch { return null; }
}

/** Add localStorage rows that are not durable yet; never overwrite a durable row. */
export async function migrateScheduledRows(rows: readonly ScheduledVaultRow[]): Promise<boolean> {
  return (await reconcileScheduledRows(rows)) !== null;
}

/** Add one newly scheduled row without replacing a newer durable record. */
export async function addScheduledRow(
  row: ScheduledVaultRow,
  expectedEraseEpoch = row.clearEpoch,
  expectedGeneration = row.generation,
  maxCapacity = Number.POSITIVE_INFINITY,
): Promise<boolean> {
  const db = await openVault(); if (!db) return false;
  try {
    const tx = db.transaction([SCHEDULED, VAULT_META], 'readwrite');
    const meta = tx.objectStore(VAULT_META);
    const epochRequest = meta.get(CLEAR_EPOCH_KEY);
    epochRequest.onsuccess = () => {
      const epoch = Number(epochRequest.result?.value) || 0;
      const generationRequest = meta.get(row.owner ? ownerGenerationKey(row.owner) : 'unused');
      generationRequest.onsuccess = () => {
        const generation = row.owner ? (Number(generationRequest.result?.value) || 0) : 0;
        if (expectedEraseEpoch !== undefined && expectedEraseEpoch !== epoch) { tx.abort(); return; }
        if (expectedEraseEpoch === undefined && epoch !== 0) { tx.abort(); return; }
        if (row.owner && expectedGeneration !== undefined && expectedGeneration !== generation) { tx.abort(); return; }
        const os = tx.objectStore(SCHEDULED);
        const key = scheduledRowKey(row);
        const existing = os.get(key);
        existing.onerror = () => tx.abort();
        existing.onsuccess = () => {
          // Reconciliation may have admitted this exact row while the
          // caller's original add was still pending. Treat that race as
          // success, preserving any durable claim/tombstone already present.
          if (existing.result !== undefined) return;
          const all = os.getAll();
          all.onerror = () => tx.abort();
          all.onsuccess = () => {
            const activeCount = (all.result as ScheduledStoredRow[]).filter(candidate =>
              !candidate.status
              && (candidate.clearEpoch === epoch || (candidate.clearEpoch === undefined && epoch === 0)),
            ).length;
            // This count and the insertion are one IndexedDB read/write
            // transaction. IndexedDB serializes competing transactions across
            // tabs, so two independent admissions cannot both pass the fence.
            if (activeCount >= maxCapacity) { tx.abort(); return; }
            const add = os.add({ ...scheduledCopy(row), id: key, clearEpoch: epoch, generation } satisfies ScheduledStoredRow);
            add.onerror = (event) => {
              if (add.error?.name === 'ConstraintError') {
                // Another tab can win between get() and add(). Do not abort the
                // transaction or let the caller's cleanup erase its projection.
                event.preventDefault();
                event.stopPropagation();
              } else {
                tx.abort();
              }
            };
          };
        };
      };
    };
    epochRequest.onerror = () => { tx.abort(); };
    return txDone(tx);
  } catch { return false; }
}

/** Mark cancellation in the durable store, including when the row is not there yet. */
export async function cancelScheduledRow(id: string, owner: DeviceMemoryOwner, canceledAt = Date.now()): Promise<boolean> {
  const db = await openVault(); if (!db) return false;
  try {
    const tx = db.transaction(SCHEDULED, 'readwrite');
    const os = tx.objectStore(SCHEDULED);
    const request = os.get(scheduledStoredKey(owner, id));
    request.onsuccess = () => {
      // Tombstones intentionally contain no channel/text/sendAt: cancellation
      // must not preserve plaintext and wins over a racing migration.
      os.put({ id: scheduledStoredKey(owner, id), owner, status: 'canceled', statusAt: canceledAt });
    };
    return txDone(tx);
  } catch { return false; }
}

/** Tombstone every scheduled row owned by an account during an owner switch. */
export async function cancelScheduledRowsForOwner(owner: DeviceMemoryOwner, canceledAt = Date.now()): Promise<boolean> {
  const db = await openVault(); if (!db) return false;
  try {
    const tx = db.transaction([SCHEDULED, VAULT_META], 'readwrite');
    const os = tx.objectStore(SCHEDULED);
    const meta = tx.objectStore(VAULT_META);
    const generationReq = meta.get(ownerGenerationKey(owner));
    generationReq.onsuccess = () => meta.put({ id: ownerGenerationKey(owner), value: (Number(generationReq.result?.value) || 0) + 1 });
    const prefix = `${scheduledOwnerKey(owner)}\u0000`;
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const cursor = os.openCursor(range);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const row = current.value as ScheduledStoredRow;
      if (row.status !== 'canceled') {
        current.update({ id: row.id, owner, status: 'canceled', statusAt: canceledAt });
      }
      current.continue();
    };
    return txDone(tx);
  } catch { return false; }
}

export async function claimScheduledRow(id: string, owner: DeviceMemoryOwner, token: string, claimedAt: number): Promise<ScheduledVaultRow | null> {
  const db = await openVault(); if (!db) return null;
  try { const tx = db.transaction(SCHEDULED, 'readwrite'); const os = tx.objectStore(SCHEDULED); const req = os.get(`${scheduledOwnerKey(owner)}\u0000${id}`);
    return await new Promise(resolve => { let candidate: ScheduledStoredRow | null = null; const finish = (ok: boolean) => resolve(ok && candidate ? scheduledCopy({ id, channel: candidate.channel!, text: candidate.text!, sendAt: candidate.sendAt!, owner: candidate.owner!, generation: candidate.generation, clearEpoch: candidate.clearEpoch, claim: candidate.claim }) : null); req.onsuccess = () => { const row = req.result as ScheduledStoredRow | undefined; if (!row || row.status || row.claim || !row.owner || typeof row.channel !== 'string' || typeof row.text !== 'string' || typeof row.sendAt !== 'number' || scheduledOwnerKey(row.owner) !== scheduledOwnerKey(owner)) { tx.abort(); return; } candidate = { ...row, claim: { token, claimedAt } }; const put = os.put(candidate); put.onerror = () => { tx.abort(); }; }; req.onerror = () => { tx.abort(); }; tx.oncomplete = () => finish(true); tx.onerror = () => finish(false); tx.onabort = () => finish(false); });
  } catch { return null; }
}
export async function settleScheduledClaim(id: string, owner: DeviceMemoryOwner, token: string, admitted: boolean): Promise<boolean> {
  const db = await openVault(); if (!db) return false;
  try { const tx = db.transaction(SCHEDULED, 'readwrite'); const os = tx.objectStore(SCHEDULED); const req = os.get(`${scheduledOwnerKey(owner)}\u0000${id}`); req.onsuccess = () => { const row = req.result as ScheduledStoredRow | undefined; if (!row?.claim || row.claim.token !== token || row.status) { tx.abort(); return; } if (admitted) os.put({ id: row.id, owner: row.owner, generation: row.generation, clearEpoch: row.clearEpoch, status: 'admitted', statusAt: Date.now() }); else { delete row.claim; os.put(row); } }; return txDone(tx); } catch { return false; }
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
  expectedEraseEpoch?: number,
  reservation?: VaultWriteReservation,
): Promise<boolean> {
  const hasReservation = reservation !== undefined && reservation !== null;
  let safeOwner: DeviceMemoryOwner | null = null;
  let physicalTarget: string;
  let privacyTracked = false;
  let transactionCommitted = false;
  if (!Array.isArray(msgs)) {
    await releaseSuppliedReservation(reservation);
    return false;
  }
  try {
    safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
    if (owner !== undefined && !safeOwner) {
      await releaseSuppliedReservation(reservation);
      return false;
    }
    if (msgs.length === 0) {
      await releaseSuppliedReservation(reservation);
      return true;
    }
    physicalTarget = physicalTargetKey(target, safeOwner ?? undefined);
    privacyTracked = isVaultDmSearchPrivacyTracked(physicalTarget)
      || msgs.some((message) => message.encrypted || isEncryptedWireText(message.text));
    // Invalidate before the first await. SEARCH is synchronous, so even the small
    // window while a write is opening IndexedDB must not reuse an older `plain`.
    if (privacyTracked) invalidateVaultDmSearchPrivacy(physicalTarget);
    const db = await openVault();
    if (!db) {
      await releaseSuppliedReservation(reservation);
      return false;
    }
    // A recovered database may be paired with a provisional same-origin
    // marker left by a failed clear. Reconcile it before accepting a direct
    // write; reservation-backed writes require the stronger control proof.
    if (await reconcileSynchronousControlWithDurable(db, hasReservation) === null) {
      await releaseSuppliedReservation(reservation);
      return false;
    }
    // Pre-trim the batch to the target's effective keep. With no policy this is
    // exactly VAULT_KEEP (identical to before); a per-channel override widens or
    // narrows it so a larger override isn't defeated by the batch pre-trim.
    const keep = _retentionPolicy ? effectiveKeep(_retentionPolicy, target) : VAULT_KEEP;
    // `slice(-0)` is `slice(0)`, so zero needs an explicit empty tail or a
    // zero-retention policy would briefly write the entire input batch.
    const tail = keep === 0 ? [] : msgs.slice(-keep);
    const tx = db.transaction([STORE, VAULT_META], 'readwrite');
    const store = tx.objectStore(STORE);
    const meta = tx.objectStore(VAULT_META);
    const epochReq = meta.get(CLEAR_EPOCH_KEY);
    const reservationReq = hasReservation
      ? meta.get(writeReservationKey(reservation.token))
      : null;
    let epochRead = false;
    let reservationRead = !hasReservation;
    let durableEpoch = 0;
    let storedReservation: unknown;
    const abort = () => {
      try {
        tx.abort();
      } catch {
        // The transaction may already be inactive; txDone still reports its result.
      }
    };
    const admit = () => {
      if (!epochRead || !reservationRead) return;
      // With a reservation, the reservation row and message rows are consumed
      // by this same transaction. This is the write linearization point. A
      // clear transaction ordered first has deleted the row, so this aborts;
      // a clear ordered after this transaction removes the committed rows.
      try {
        if (hasReservation) {
          const row = storedReservation as Partial<StoredWriteReservation> | undefined;
          if (
            row?.kind !== 'message-write'
            || row.epoch !== reservation.eraseEpoch
            || durableEpoch !== reservation.eraseEpoch
            || (expectedEraseEpoch !== undefined && expectedEraseEpoch !== durableEpoch)
          ) {
            abort();
            return;
          }
          meta.delete(writeReservationKey(reservation.token));
        } else if (expectedEraseEpoch === undefined ? durableEpoch !== 0 : expectedEraseEpoch !== durableEpoch) {
          // Direct callers retain the old explicit epoch behavior. The sync path
          // always uses the stronger reservation form above.
          abort();
          return;
        }
        for (const m of tail) store.put(serializeMessage(target, m, safeOwner ?? undefined));
      } catch {
        abort();
      }
    };
    epochReq.onsuccess = () => {
      try {
        durableEpoch = Number(epochReq.result?.value) || 0;
        epochRead = true;
        admit();
      } catch {
        abort();
      }
    };
    if (reservationReq) {
      reservationReq.onsuccess = () => {
        try {
          storedReservation = reservationReq.result;
          reservationRead = true;
          admit();
        } catch {
          abort();
        }
      };
      reservationReq.onerror = abort;
    }
    epochReq.onerror = abort;
    const committed = await txDone(tx);
    transactionCommitted = committed;
    if (!committed) {
      await releaseSuppliedReservation(reservation);
      if (privacyTracked) await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
      return false;
    }
    if (hasReservation) forgetSynchronousWriteIntent(reservation.token);
    await pruneTarget(db, physicalTarget, target.toLowerCase(), _retentionPolicy);
    if (privacyTracked) await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
    return true;
  } catch {
    /* quota / private mode — the vault is best-effort */
    if (!transactionCommitted) await releaseSuppliedReservation(reservation);
    if (privacyTracked) {
      try {
        await classifyVaultDmSearchPrivacy(target, safeOwner ?? undefined);
      } catch {
        // Privacy reclassification cannot mask the original failed write.
      }
    }
    return false;
  }
}

/** Load the most recent messages for a target, chronological. */
export type RecentHistoryStatus = 'complete' | 'unavailable' | 'partial';

export interface RecentHistoryResult {
  messages: ChatMessage[];
  status: RecentHistoryStatus;
}

/**
 * Load recent messages with enough truth for UI callers to distinguish an
 * empty history from a storage failure. Rows already read remain available on
 * a cursor/transaction failure.
 */
export async function loadRecentWithStatus(
  target: string,
  limit = VAULT_KEEP,
  owner?: DeviceMemoryOwner,
): Promise<RecentHistoryResult> {
  const safeOwner = owner === undefined ? null : normalizeDeviceMemoryOwner(owner);
  if (owner !== undefined && !safeOwner) return { messages: [], status: 'unavailable' };
  const db = await openVault();
  if (!db) return { messages: [], status: 'unavailable' };
  try {
    const key = physicalTargetKey(target, safeOwner ?? undefined);
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = targetKeyRange(key);
    return await new Promise<RecentHistoryResult>((resolve) => {
      const out: ChatMessage[] = [];
      let settled = false;
      let cursorFinished = false;
      let cursorFailed = false;
      const finish = (status: RecentHistoryStatus) => {
        if (settled) return;
        settled = true;
        resolve({ messages: out.reverse(), status });
      };
      const fail = () => finish(out.length > 0 ? 'partial' : 'unavailable');
      // Cursor exhaustion/limit only proves that the request has finished. The
      // readonly transaction still has to commit successfully before an empty
      // or bounded read can be called complete.
      tx.oncomplete = () => {
        if (cursorFailed || !cursorFinished) {
          fail();
          return;
        }
        finish('complete');
      };
      tx.onerror = fail;
      tx.onabort = fail;
      // Walk newest-first, stop at limit, reverse to chronological.
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.length >= limit) {
          cursorFinished = true;
          return;
        }
        out.push(deserializeMessage(cursor.value as StoredMessage));
        cursor.continue();
      };
      cursorReq.onerror = () => {
        cursorFailed = true;
        fail();
      };
    });
  } catch {
    return { messages: [], status: 'unavailable' };
  }
}

/** Legacy best-effort API retained for all existing consumers. */
export async function loadRecent(
  target: string,
  limit = VAULT_KEEP,
  owner?: DeviceMemoryOwner,
): Promise<ChatMessage[]> {
  return (await loadRecentWithStatus(target, limit, owner)).messages;
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
  expectedEraseEpoch?: number,
): Promise<{ targets: number; messages: number }> {
  assertVaultImportCurrent(options);
  // Establish the fail-closed boundary synchronously before the first await;
  // callers may inspect privacy while the durable import is pending.
  if (Array.isArray(snapshot?.targets)) {
    for (const rawEntry of snapshot.targets.slice(0, MAX_EXPORT_TARGETS)) {
      if (!isRecord(rawEntry)) continue;
      const normalizedTarget = normalizeVaultTarget(rawEntry.target, '');
      if (normalizedTarget !== null) {
        invalidateVaultDmSearchPrivacy(physicalTargetKey(normalizedTarget, owner));
      }
    }
  }
  if (expectedEraseEpoch === undefined) expectedEraseEpoch = await captureVaultEraseEpoch() ?? undefined;
  if (expectedEraseEpoch === undefined) return { targets: 0, messages: 0 };
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
    // Import is an asynchronous write boundary. Invalidate any previous
    // plain proof before the first await so SEARCH remains fail-closed until
    // the imported rows have committed and been reclassified.
    invalidateVaultDmSearchPrivacy(physicalTargetKey(target, safeOwner ?? undefined));
    const committed = await saveMessages(target, retained, safeOwner ?? undefined, expectedEraseEpoch);
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
    ...(isRecord(raw.claim)
      && typeof raw.claim.token === 'string'
      && raw.claim.token.length > 0
      && raw.claim.token.length <= 256
      && raw.claim.token === raw.claim.token.trim()
      && typeof raw.claim.claimedAt === 'number'
      && Number.isSafeInteger(raw.claim.claimedAt)
      && raw.claim.claimedAt >= 0
      ? { claim: { token: raw.claim.token, claimedAt: raw.claim.claimedAt } }
      : {}),
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
  expectedEraseEpoch?: number,
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
    const tx = db.transaction([OUTBOX, VAULT_META], 'readwrite');
    const store = tx.objectStore(OUTBOX);
    const meta = tx.objectStore(VAULT_META);
    let inserted = false;
    const epochReq = meta.get(CLEAR_EPOCH_KEY);
    epochReq.onsuccess = () => {
      const epoch = Number(epochReq.result?.value) || 0;
      if (expectedEraseEpoch === undefined ? epoch !== 0 : expectedEraseEpoch !== epoch) { tx.abort(); return; }
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
    };
    epochReq.onerror = () => tx.abort();
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
        if (entry.claim) {
          const { claim: _claim, ...settled } = entry;
          store.put(settled);
        }
        marked = true;
        return;
      }
      try {
        const { claim: _claim, ...unclaimed } = entry;
        store.put({ ...unclaimed, wire_admitted: true as const });
        marked = true;
      } catch {
        // Transaction will abort or commit without the mark.
      }
    };
    const committed = await txDone(tx);
    if (committed && marked) notifyOutbox({ kind: 'changed' });
    return committed && marked;
  } catch {
    return false;
  }
}

/** Atomically claim one owned, unadmitted row. Existing claims are never stale-reclaimed. */
export async function claimOutboxEntry(
  id: string,
  token: string,
  owner: OutboxOwner,
): Promise<OutboxEntry | null> {
  if (typeof id !== 'string' || id.length === 0 || id !== id.trim()) return null;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256 || token !== token.trim()) return null;
  const safeOwner = parseOutboxOwner(owner);
  if (!safeOwner) return null;
  const db = await openVault();
  if (!db) return null;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    let claimed: OutboxEntry | null = null;
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const entry = parseOutboxEntry(lookup.result);
      if (!entry || entry.wire_admitted || !entry.owner
        || deviceMemoryOwnerKey(entry.owner) !== deviceMemoryOwnerKey(safeOwner)
        || entry.claim) return;
      claimed = { ...entry, claim: { token, claimedAt: Date.now() } };
      store.put(claimed);
    };
    if (!await txDone(tx)) return null;
    if (claimed) notifyOutbox({ kind: 'changed' });
    return claimed;
  } catch {
    return null;
  }
}

/** Release only this caller's claim, and only while admission is unproven. */
export async function releaseOutboxClaim(id: string, token: string): Promise<boolean> {
  if (typeof id !== 'string' || typeof token !== 'string' || !id || !token) return false;
  const db = await openVault();
  if (!db) return false;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    let released = false;
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const entry = parseOutboxEntry(lookup.result);
      if (!entry || entry.wire_admitted || entry.claim?.token !== token) return;
      const { claim: _claim, ...unclaimed } = entry;
      store.put(unclaimed);
      released = true;
    };
    const committed = await txDone(tx);
    if (committed && released) notifyOutbox({ kind: 'changed' });
    return committed && released;
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
  // Revoke pre-admission intents synchronously, before any database-open await.
  // This closes the cross-context sequence where a delayed reservation would
  // otherwise read the new epoch and accidentally turn a pre-clear snapshot
  // into a fresh post-clear write.
  const synchronousClearFence = beginSynchronousClearFence();
  // Topic cursors, topic text history, pinned DMs, and bookmarks are device-local
  // transcript memory too. Clear
  // them even when IndexedDB is unavailable so "forget this device" has one
  // consistent privacy boundary across the vault and localStorage.
  const topicReadsCleared = tryClearDeviceSurface(clearDeviceTopicReads);
  const topicHistoryCleared = tryClearDeviceSurface(clearDeviceTopicHistory);
  const dmPinsCleared = tryClearDeviceSurface(clearDeviceDMPins);
  const bookmarksCleared = tryClearDeviceSurface(clearDeviceBookmarks);
  const legacyScheduledCleared = clearLegacyScheduledStorage();
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
      && bookmarksCleared
      && legacyScheduledCleared;
    if (!cleared) await reconcileAbortedSynchronousClear(synchronousClearFence);
    finishVaultDmPrivacyClear(privacyGeneration, cleared);
    if (cleared) notifyVerifiedDeviceHistoryClear();
    return cleared;
  }
  try {
    const tx = db.transaction([STORE, OUTBOX, SCHEDULED, VAULT_META], 'readwrite');
    const outbox = tx.objectStore(OUTBOX);
    let outboxHadRows = false;
    const count = outbox.count();
    count.onsuccess = () => {
      outboxHadRows = count.result > 0;
    };
    tx.objectStore(STORE).clear();
    outbox.clear();
    tx.objectStore(SCHEDULED).clear();
    const meta = tx.objectStore(VAULT_META);
    const epoch = meta.get(CLEAR_EPOCH_KEY);
    let committedEraseEpoch: number | null = null;
    epoch.onsuccess = () => {
      // Read before clear inside the same readwrite transaction. The
      // transaction's ordering is the clear linearization point: reservations
      // committed before it are removed, and delayed writes ordered after it
      // cannot find their reservation.
      committedEraseEpoch = (Number(epoch.result?.value) || 0) + 1;
      noteCachedEraseEpoch(committedEraseEpoch);
      meta.clear();
      meta.put({ id: CLEAR_EPOCH_KEY, value: committedEraseEpoch });
    };
    epoch.onerror = () => tx.abort();
    const committed = await txDone(tx);
    if (!committed || committedEraseEpoch === null) {
      await reconcileAbortedSynchronousClear(synchronousClearFence);
      finishVaultDmPrivacyClear(privacyGeneration, false);
      return false;
    }
    // The IDB commit is the durable clear linearization point. Align the
    // provisional synchronous epoch to the actual epoch (important when two
    // clears started concurrently and their provisional numbers compressed).
    await completeSynchronousClearFence(synchronousClearFence, committedEraseEpoch);
    const [messageCount, outboxCount, scheduledCount, sanitizedOutbox] = await Promise.all([
      physicalStoreCount(db, STORE),
      physicalOutboxCount(db),
      physicalStoreCount(db, SCHEDULED),
      loadOutbox(),
    ]);
    const outboxVerified = outboxCount === 0 && sanitizedOutbox.length === 0;
    const scheduledVerified = scheduledCount === 0;
    if (outboxHadRows && outboxVerified) notifyOutbox({ kind: 'cleared' });
    const cleared = messageCount === 0
      && outboxVerified
      && scheduledVerified
      && topicReadsCleared
      && topicHistoryCleared
      && dmPinsCleared
      && bookmarksCleared
      && legacyScheduledCleared;
    finishVaultDmPrivacyClear(privacyGeneration, cleared);
    if (cleared) {
      notifyVerifiedDeviceHistoryClear();
    }
    return cleared;
  } catch {
    await reconcileAbortedSynchronousClear(synchronousClearFence);
    finishVaultDmPrivacyClear(privacyGeneration, false);
    return false;
  }
}

/** A hostile localStorage getter/operation must degrade the whole wipe. */
function tryClearDeviceSurface(clear: () => boolean): boolean {
  try {
    return clear();
  } catch {
    return false;
  }
}

/** Clear the legacy scheduled-message mirror without letting storage throw. */
function clearLegacyScheduledStorage(): boolean {
  if (typeof window === 'undefined') return true;
  const storage = localVaultStorage();
  if (!storage || !storage.removeItem('onyx:scheduled')) return false;
  storage.getItem('onyx:scheduled');
  return !storage.failed;
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
  cachedEraseEpoch = 0;
  writeReservationSeq = 0;
  _retentionPolicy = null;
  _outboxSeq = 0;
  _outboxListeners.clear();
  _resetVaultDmSearchPrivacyForTests();
}
