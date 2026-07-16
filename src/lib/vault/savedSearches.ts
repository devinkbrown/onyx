// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * savedSearches.ts — local-first "saved searches" for the vault.
 *
 * Persists named search queries (label + query + mode + createdAt) so a user's
 * favourite lexical/semantic searches survive reloads and stay on-device.
 *
 * Design constraints (mirroring historyVault.ts):
 *  - NEVER block or break the UI: every call feature-detects IndexedDB and
 *    swallows failures (private windows, quota, corrupt DB) to an empty/null.
 *  - Bounded: at most SAVED_SEARCH_CAP entries, oldest pruned.
 *  - Dumb storage: only the user-entered label/query/mode/createdAt is stored —
 *    never message bodies, authentication credentials, or decrypted E2EE
 *    records automatically. Query text can itself be sensitive and is treated
 *    as part of the user's portable local data.
 *  - Its own sibling database so it is a pure additive layer that never
 *    reshapes or re-versions the primary 'onyx-vault' store.
 */

import { createSavedSearchSync, type SavedSearchSync } from './savedSearchSync';
import { deviceMemoryOwnerKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

const DB_NAME = 'onyx-vault-searches';
const DB_VERSION = 1;
const STORE = 'saved_searches';

/** Max retained saved searches; oldest are pruned beyond this bound. */
export const SAVED_SEARCH_CAP = 50;
/** Reject labels/queries longer than these to keep storage bounded and sane. */
export const MAX_LABEL_LEN = 120;
export const MAX_QUERY_LEN = 512;
/** Opaque ids are local keys, not a place for unbounded imported metadata. */
export const MAX_SAVED_SEARCH_ID_LEN = 128;
/** Inspect at most this many physical values during one bounded read/repair. */
export const SAVED_SEARCH_SCAN_LIMIT = SAVED_SEARCH_CAP * 4;
/** Imports may inspect a bounded invalid prefix while collecting valid rows. */
export const SAVED_SEARCH_IMPORT_SCAN_LIMIT = SAVED_SEARCH_CAP * 4;
/** Ordering metadata beyond this future skew is treated as hostile/corrupt. */
export const MAX_SAVED_SEARCH_FUTURE_MS = 24 * 60 * 60 * 1000;
/** A bounded same-millisecond tiebreaker; larger values cannot dominate sort. */
export const MAX_SAVED_SEARCH_SEQ = 2_147_483_647;
/** Maximum owner databases kept open by one long-lived tab. */
export const SAVED_SEARCH_DB_CACHE_CAP = 8;

// `semantic` is retained as the on-disk token for backwards compatibility. In
// the UI it is described accurately as related-term/token similarity rather
// than model-backed semantic understanding.
export type SavedSearchMode = 'exact' | 'semantic' | 'hybrid';

export interface SavedSearch {
  /** Stable device-local id. */
  id: string;
  /** Human label as typed (trimmed). */
  label: string;
  /** The query string this search runs. */
  query: string;
  /** Which search surface it drives. */
  mode: SavedSearchMode;
  /** Epoch ms the entry was created (or last upserted). */
  createdAt: number;
}

/** On-disk shape adds a monotonic ordering tiebreaker for same-ms creates. */
type StoredSavedSearch = SavedSearch & { seq: number };

export interface SavedSearchInput {
  label: string;
  query: string;
  mode: SavedSearchMode;
}

export interface SavedSearchExport {
  kind: 'onyx-saved-searches';
  version: 1;
  exportedAt: string;
  searches: SavedSearch[];
}

let _seq = 0;
interface SearchDbCacheEntry {
  promise: Promise<IDBDatabase | null>;
  db: IDBDatabase | null;
  settled: boolean;
  retired: boolean;
}

const dbCache = new Map<string, SearchDbCacheEntry>();
let changeRevision = 0;
let crossTabSync: SavedSearchSync | null = null;

export type SavedSearchChangeReason = 'save' | 'delete' | 'clear' | 'import';
export interface SavedSearchChange {
  /** Monotonic in-tab invalidation only; never contains labels or query text. */
  revision: number;
  reason: SavedSearchChangeReason;
  count: number;
}

type SavedSearchChangeListener = (change: SavedSearchChange) => void;
const changeListeners = new Set<SavedSearchChangeListener>();

function dispatchSavedSearchChange(reason: SavedSearchChangeReason, count: number): SavedSearchChange {
  const change: SavedSearchChange = {
    revision: ++changeRevision,
    reason,
    count: Math.max(0, Math.min(SAVED_SEARCH_CAP, Math.trunc(count))),
  };
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch {
      // A UI subscriber must never turn a verified storage commit into a
      // reported failure or prevent other consumers from invalidating.
    }
  }
  return change;
}

function savedSearchSync(): SavedSearchSync {
  crossTabSync ??= createSavedSearchSync((change) => {
    // Remote changes invalidate local readers only. Never republish them: that
    // would turn two open tabs into an echo loop.
    dispatchSavedSearchChange(change.reason, change.count);
  });
  return crossTabSync;
}

export function subscribeSavedSearches(listener: SavedSearchChangeListener): () => void {
  changeListeners.add(listener);
  savedSearchSync();
  return () => {
    changeListeners.delete(listener);
    if (changeListeners.size === 0) {
      crossTabSync?.close();
      crossTabSync = null;
    }
  };
}

function publishSavedSearchChange(reason: SavedSearchChangeReason, count: number): void {
  const change = dispatchSavedSearchChange(reason, count);
  savedSearchSync().publish(change);
}

function physicalDbName(owner?: DeviceMemoryOwner): string | null {
  if (owner === undefined) return DB_NAME;
  const ownerKey = deviceMemoryOwnerKey(owner);
  return ownerKey ? `${DB_NAME}:owner:${encodeURIComponent(ownerKey)}` : null;
}

function retireSearchDb(entry: SearchDbCacheEntry): void {
  entry.retired = true;
  if (!entry.db) return;
  try {
    entry.db.close();
  } catch {
    // Closing an already-closing best-effort persistence handle is harmless.
  }
  entry.db = null;
}

/** Close least-recently-used settled handles; pending opens settle before pruning. */
function pruneSearchDbCache(preserveName: string): void {
  while (dbCache.size > SAVED_SEARCH_DB_CACHE_CAP) {
    let victim: [string, SearchDbCacheEntry] | null = null;
    for (const candidate of dbCache) {
      if (candidate[0] !== preserveName && candidate[1].settled) {
        victim = candidate;
        break;
      }
    }
    if (!victim) return;
    dbCache.delete(victim[0]);
    retireSearchDb(victim[1]);
  }
}

function openSearchDb(owner?: DeviceMemoryOwner): Promise<IDBDatabase | null> {
  const dbName = physicalDbName(owner);
  if (!dbName) return Promise.resolve(null);
  const existing = dbCache.get(dbName);
  if (existing) {
    dbCache.delete(dbName);
    dbCache.set(dbName, existing);
    return existing.promise;
  }

  let resolvePending!: (db: IDBDatabase | null) => void;
  const pending = new Promise<IDBDatabase | null>((resolve) => {
    resolvePending = resolve;
  });
  const entry: SearchDbCacheEntry = {
    promise: pending,
    db: null,
    settled: false,
    retired: false,
  };
  dbCache.set(dbName, entry);

  let finished = false;
  const finish = (db: IDBDatabase | null): void => {
    // A blocked request can later succeed. If its caller already degraded to
    // null, close that late handle instead of leaking it outside the cache.
    if (finished) {
      try { db?.close(); } catch {}
      return;
    }
    finished = true;
    entry.settled = true;
    if (entry.retired) {
      try { db?.close(); } catch {}
      resolvePending(null);
      return;
    }
    if (!db) {
      if (dbCache.get(dbName) === entry) dbCache.delete(dbName);
      resolvePending(null);
      return;
    }
    entry.db = db;
    db.onversionchange = () => {
      if (dbCache.get(dbName) === entry) dbCache.delete(dbName);
      retireSearchDb(entry);
    };
    resolvePending(db);
    pruneSearchDbCache(dbName);
  };

  try {
    if (typeof indexedDB === 'undefined') {
      finish(null);
      return pending;
    }
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => finish(req.result);
    req.onerror = () => finish(null);
    req.onblocked = () => finish(null);
  } catch {
    finish(null);
  }
  return pending;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Case/space-insensitive dedupe key for a label. */
export function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

/**
 * Validate untrusted input at the boundary. Returns trimmed, normalized fields
 * or null when the label/query is empty (or over length) or the mode invalid.
 * Pure and DOM-free — safe to unit test without IndexedDB.
 */
export function validateSearchInput(input: unknown): SavedSearchInput | null {
  if (!isRecord(input)) return null;
  if (typeof input.label !== 'string' || input.label.length > MAX_LABEL_LEN + 32) return null;
  if (typeof input.query !== 'string' || input.query.length > MAX_QUERY_LEN + 32) return null;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const mode = input.mode;
  if (!label || label.length > MAX_LABEL_LEN) return null;
  if (!query || query.length > MAX_QUERY_LEN) return null;
  if (mode !== 'exact' && mode !== 'semantic' && mode !== 'hybrid') return null;
  return { label, query, mode };
}

function genId(): string {
  return `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_SAVED_SEARCH_ID_LEN) return null;
  const id = value.trim();
  if (!id || id.length > MAX_SAVED_SEARCH_ID_LEN || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function validStoredTimestamp(value: unknown, now = Date.now()): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= now + MAX_SAVED_SEARCH_FUTURE_MS;
}

function safeImportedTimestamp(value: unknown, now = Date.now()): number {
  let parsed = Number.NaN;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && value.length <= 64) parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && parsed >= 0
    && parsed <= now + MAX_SAVED_SEARCH_FUTURE_MS
    ? parsed
    : now;
}

function validSequence(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_SAVED_SEARCH_SEQ;
}

function nextSequence(rows: readonly StoredSavedSearch[]): number {
  const storedMax = rows.reduce((max, row) => Math.max(max, row.seq), 0);
  _seq = Math.max(_seq, storedMax);
  _seq = _seq >= MAX_SAVED_SEARCH_SEQ ? 1 : _seq + 1;
  return _seq;
}

function uniqueGeneratedId(usedIds: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = genId();
    if (!usedIds.has(candidate)) return candidate;
  }
  const prefix = `ss-${Date.now().toString(36)}-`;
  for (let suffix = 1; suffix <= SAVED_SEARCH_SCAN_LIMIT + 1; suffix += 1) {
    const candidate = `${prefix}${suffix.toString(36)}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  return `${prefix}${Math.max(1, nextSequence([])).toString(36)}`;
}

function reviveStoredSearch(raw: unknown): StoredSavedSearch | null {
  if (!isRecord(raw)) return null;
  const id = sanitizeId(raw.id);
  const input = validateSearchInput(raw);
  if (!id || raw.id !== id || !input || !validStoredTimestamp(raw.createdAt)) return null;
  // Pre-sequence v1 rows remain readable with the neutral tiebreaker. Any
  // present sequence must itself be bounded and integral before it can sort.
  const seq = raw.seq === undefined ? 0 : validSequence(raw.seq) ? raw.seq : null;
  if (seq === null) return null;
  return { id, ...input, createdAt: raw.createdAt, seq };
}

function toPublic(row: StoredSavedSearch): SavedSearch {
  return { id: row.id, label: row.label, query: row.query, mode: row.mode, createdAt: row.createdAt };
}

/** Newest first: by createdAt desc, monotonic seq breaks same-ms ties. */
function sortNewestFirst(rows: readonly StoredSavedSearch[]): StoredSavedSearch[] {
  return rows.slice().sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
}

interface BoundedStoredRows {
  rows: StoredSavedSearch[];
  entries: Array<{ key: IDBValidKey; row: StoredSavedSearch | null }>;
  physicalCount: number;
  truncated: boolean;
}

function getBoundedRows(db: IDBDatabase): Promise<BoundedStoredRows | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const rowsRequest = store.getAll(undefined, SAVED_SEARCH_SCAN_LIMIT);
      const keysRequest = store.getAllKeys(undefined, SAVED_SEARCH_SCAN_LIMIT);
      const countRequest = store.count();
      let rows: unknown[] = [];
      let keys: IDBValidKey[] = [];
      let physicalCount = 0;
      let failed = false;
      rowsRequest.onsuccess = () => { rows = rowsRequest.result ?? []; };
      rowsRequest.onerror = () => { failed = true; };
      keysRequest.onsuccess = () => { keys = keysRequest.result ?? []; };
      keysRequest.onerror = () => { failed = true; };
      countRequest.onsuccess = () => { physicalCount = countRequest.result; };
      countRequest.onerror = () => { failed = true; };
      tx.oncomplete = () => {
        if (failed || rows.length !== keys.length) {
          resolve(null);
          return;
        }
        const entries = rows.map((raw, index) => ({
          key: keys[index]!,
          row: reviveStoredSearch(raw),
        }));
        resolve({
          entries,
          rows: entries.flatMap((entry) => entry.row ? [entry.row] : []),
          physicalCount,
          truncated: physicalCount > SAVED_SEARCH_SCAN_LIMIT,
        });
      };
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function getStoredRow(db: IDBDatabase, id: string): Promise<StoredSavedSearch | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      let row: StoredSavedSearch | null = null;
      req.onsuccess = () => { row = reviveStoredSearch(req.result); };
      req.onerror = () => { row = null; };
      tx.oncomplete = () => resolve(row);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function publicRows(read: BoundedStoredRows): SavedSearch[] {
  const deduped: StoredSavedSearch[] = [];
  const labels = new Set<string>();
  for (const row of sortNewestFirst(read.rows)) {
    const label = normalizeLabel(row.label);
    if (labels.has(label)) continue;
    labels.add(label);
    deduped.push(row);
    if (deduped.length >= SAVED_SEARCH_CAP) break;
  }
  return deduped.map(toPublic);
}

function hasRow(db: IDBDatabase, id: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getKey(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(true);
      tx.onabort = () => resolve(true);
    } catch {
      resolve(true);
    }
  });
}

/**
 * Create (or upsert-by-label) a saved search. Validation rejects empty
 * label/query and bad mode (returns null); a matching normalized label reuses
 * the existing id so labels never duplicate. Prunes to SAVED_SEARCH_CAP after.
 */
export async function saveSearch(
  input: SavedSearchInput,
  owner?: DeviceMemoryOwner,
): Promise<SavedSearch | null> {
  const valid = validateSearchInput(input);
  if (!valid) return null;
  const db = await openSearchDb(owner);
  if (!db) return null;
  try {
    const norm = normalizeLabel(valid.label);
    const existing = await getBoundedRows(db);
    if (!existing || existing.truncated) return null;
    const prior = sortNewestFirst(existing.rows).find((r) => normalizeLabel(r.label) === norm);
    const usedIds = new Set(existing.entries.flatMap((entry) => {
      const id = sanitizeId(entry.key);
      return id ? [id] : [];
    }));
    const record: StoredSavedSearch = {
      id: prior?.id ?? uniqueGeneratedId(usedIds),
      label: valid.label,
      query: valid.query,
      mode: valid.mode,
      createdAt: Date.now(),
      seq: nextSequence(existing.rows),
    };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    const committed = await txDone(tx);
    if (!committed) return null;
    if (!await pruneSearches(db)) return null;
    const readback = await getStoredRow(db, record.id);
    if (!readback || !sameStoredSearch(readback, record)) return null;
    publishSavedSearchChange('save', 1);
    return toPublic(readback);
  } catch {
    return null;
  }
}

/** List saved searches, newest first. */
export async function listSearches(owner?: DeviceMemoryOwner): Promise<SavedSearch[]> {
  const db = await openSearchDb(owner);
  if (!db) return [];
  try {
    const read = await getBoundedRows(db);
    return read ? publicRows(read) : [];
  } catch {
    return [];
  }
}

/** Delete one saved search by id and verify the privacy-affecting write. */
export async function deleteSearch(id: string, owner?: DeviceMemoryOwner): Promise<boolean> {
  const safeId = sanitizeId(id);
  if (!safeId || safeId !== id) return false;
  const db = await openSearchDb(owner);
  if (!db) return false;
  try {
    const existed = await hasRow(db, safeId);
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(safeId);
    if (!await txDone(tx)) return false;
    if (await hasRow(db, safeId)) return false;
    if (existed) publishSavedSearchChange('delete', 1);
    return true;
  } catch {
    return false;
  }
}

/** Wipe every saved search and verify that no row remains. */
export async function clearSavedSearches(owner?: DeviceMemoryOwner): Promise<boolean> {
  const db = await openSearchDb(owner);
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    if (!await txDone(tx)) return false;
    const readback = await getBoundedRows(db);
    if (!readback || readback.physicalCount !== 0) return false;
    publishSavedSearchChange('clear', 0);
    return true;
  } catch {
    return false;
  }
}

/** Export saved searches, including user-entered query text, as portable JSON. */
export async function exportSavedSearches(owner?: DeviceMemoryOwner): Promise<SavedSearchExport> {
  const snapshot: SavedSearchExport = {
    kind: 'onyx-saved-searches',
    version: 1,
    exportedAt: new Date().toISOString(),
    searches: [],
  };
  const db = await openSearchDb(owner);
  if (!db) return snapshot;
  try {
    const read = await getBoundedRows(db);
    snapshot.searches = read ? publicRows(read) : [];
    return snapshot;
  } catch {
    return snapshot;
  }
}

function reviveSavedSearch(raw: unknown): SavedSearch | null {
  if (!isRecord(raw)) return null;
  const input = validateSearchInput(raw);
  if (!input) return null;

  return {
    id: sanitizeId(raw.id) ?? genId(),
    ...input,
    createdAt: safeImportedTimestamp(raw.createdAt),
  };
}

/** Validate untrusted JSON before it can be imported (allowlist mode, drop invalid). */
export function parseSavedSearchExport(raw: unknown): SavedSearchExport | null {
  if (!isRecord(raw) || raw.kind !== 'onyx-saved-searches' || raw.version !== 1 || !Array.isArray(raw.searches)) {
    return null;
  }
  const exportedAt = new Date(safeImportedTimestamp(raw.exportedAt)).toISOString();
  const searches = raw.searches
    .slice(0, SAVED_SEARCH_IMPORT_SCAN_LIMIT)
    .map(reviveSavedSearch)
    .filter((s): s is SavedSearch => s !== null)
    .slice(0, SAVED_SEARCH_CAP);
  return { kind: 'onyx-saved-searches', version: 1, exportedAt, searches };
}

/**
 * Merge a validated snapshot into the local store: dedupe by normalized label
 * (reusing any existing id), preserve each entry's createdAt, then prune to the
 * cap. Returns how many rows were written.
 */
export async function importSavedSearches(
  snapshot: SavedSearchExport,
  owner?: DeviceMemoryOwner,
): Promise<{ imported: number }> {
  const parsed = parseSavedSearchExport(snapshot);
  if (!parsed || parsed.searches.length === 0) return { imported: 0 };
  const db = await openSearchDb(owner);
  if (!db) return { imported: 0 };
  try {
    const existing = await getBoundedRows(db);
    if (!existing || existing.truncated) return { imported: 0 };
    const byLabel = new Map<string, StoredSavedSearch>();
    const usedIds = new Set(existing.entries.flatMap((entry) => {
      const id = sanitizeId(entry.key);
      return id ? [id] : [];
    }));
    for (const row of sortNewestFirst(existing.rows)) {
      if (byLabel.has(normalizeLabel(row.label))) continue;
      byLabel.set(normalizeLabel(row.label), row);
    }

    // Treat the typed snapshot as untrusted too: callers outside the portable
    // parser must not be able to trigger unbounded validation or writes.
    const boundedEntries: SavedSearch[] = [];
    const incomingLabels = new Set<string>();
    for (const rawEntry of parsed.searches) {
      if (boundedEntries.length >= SAVED_SEARCH_CAP) break;
      const input = validateSearchInput(rawEntry);
      if (!input) continue;
      const norm = normalizeLabel(input.label);
      if (incomingLabels.has(norm)) continue;
      incomingLabels.add(norm);
      boundedEntries.push({
        id: sanitizeId(rawEntry.id) ?? genId(),
        ...input,
        createdAt: safeImportedTimestamp(rawEntry.createdAt),
      });
    }

    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const records: StoredSavedSearch[] = [];
    for (const entry of boundedEntries) {
      const norm = normalizeLabel(entry.label);
      const prior = byLabel.get(norm);
      // Reuse the prior id on a label match (stable, idempotent re-import). For a
      // NEW label, keep the incoming id only when no other label has already
      // claimed it — otherwise a corrupt/hostile export sharing one id across
      // distinct labels would silently overwrite an unrelated row (data loss).
      let id = prior?.id ?? entry.id;
      if (!prior && usedIds.has(id)) {
        id = uniqueGeneratedId(usedIds);
      }
      usedIds.add(id);
      const record: StoredSavedSearch = {
        id,
        label: entry.label,
        query: entry.query,
        mode: entry.mode,
        createdAt: entry.createdAt,
        seq: nextSequence([...existing.rows, ...records]),
      };
      byLabel.set(norm, record);
      store.put(record);
      records.push(record);
    }
    const committed = await txDone(tx);
    if (!committed) return { imported: 0 };
    if (!await pruneSearches(db)) return { imported: 0 };
    let imported = 0;
    for (const record of records) {
      const readback = await getStoredRow(db, record.id);
      if (readback && sameStoredSearch(readback, record)) imported += 1;
    }
    if (imported > 0) publishSavedSearchChange('import', imported);
    return { imported };
  } catch {
    return { imported: 0 };
  }
}

/** Delete entries beyond SAVED_SEARCH_CAP, oldest first. */
async function pruneSearches(db: IDBDatabase): Promise<boolean> {
  try {
    const read = await getBoundedRows(db);
    if (!read || read.truncated) return false;
    const keepIds = new Set<string>();
    const labels = new Set<string>();
    for (const row of sortNewestFirst(read.rows)) {
      const label = normalizeLabel(row.label);
      if (labels.has(label) || keepIds.size >= SAVED_SEARCH_CAP) continue;
      labels.add(label);
      keepIds.add(row.id);
    }
    const doomed = read.entries.filter((entry) => !entry.row || !keepIds.has(entry.row.id));
    if (doomed.length === 0) {
      return read.physicalCount <= SAVED_SEARCH_CAP;
    }
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const entry of doomed) store.delete(entry.key);
    if (!await txDone(tx)) return false;
    const verified = await getBoundedRows(db);
    return verified !== null
      && !verified.truncated
      && verified.physicalCount <= SAVED_SEARCH_CAP
      && verified.entries.every((entry) => entry.row !== null)
      && publicRows(verified).length === verified.physicalCount;
  } catch {
    return false;
  }
}

function sameStoredSearch(left: StoredSavedSearch, right: StoredSavedSearch): boolean {
  return left.id === right.id
    && left.label === right.label
    && left.query === right.query
    && left.mode === right.mode
    && left.createdAt === right.createdAt
    && left.seq === right.seq;
}

function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Test hook — reset the module's cached connection and seq counter. */
export function _resetSavedSearchesForTests(): void {
  crossTabSync?.close();
  crossTabSync = null;
  for (const entry of dbCache.values()) retireSearchDb(entry);
  dbCache.clear();
  _seq = 0;
  changeRevision = 0;
  changeListeners.clear();
}

/** Test hook: inspect the owner-handle bound without exposing database names. */
export function _savedSearchDbCacheSizeForTests(): number {
  return dbCache.size;
}
