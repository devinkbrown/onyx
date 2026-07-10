/**
 * savedSearches.ts — local-first "saved searches" for the vault.
 *
 * Persists named search queries (label + query + mode + createdAt) so a user's
 * favourite lexical/semantic searches survive reloads and stay on-device. No
 * cloud, no account — the device remembers.
 *
 * Design constraints (mirroring historyVault.ts):
 *  - NEVER block or break the UI: every call feature-detects IndexedDB and
 *    swallows failures (private windows, quota, corrupt DB) to an empty/null.
 *  - Bounded: at most SAVED_SEARCH_CAP entries, oldest pruned.
 *  - Dumb storage: only the label/query/mode/createdAt of a search is stored —
 *    NEVER any message body or decrypted E2EE plaintext. A saved search is a
 *    query, not content, so nothing sensitive is ever at rest here.
 *  - Its own sibling database so it is a pure additive layer that never
 *    reshapes or re-versions the primary 'onyx-vault' store.
 */

const DB_NAME = 'onyx-vault-searches';
const DB_VERSION = 1;
const STORE = 'saved_searches';

/** Max retained saved searches; oldest are pruned beyond this bound. */
export const SAVED_SEARCH_CAP = 50;
/** Reject labels/queries longer than these to keep storage bounded and sane. */
export const MAX_LABEL_LEN = 120;
export const MAX_QUERY_LEN = 512;

export type SavedSearchMode = 'exact' | 'semantic';

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
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openSearchDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
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
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const mode = input.mode;
  if (!label || label.length > MAX_LABEL_LEN) return null;
  if (!query || query.length > MAX_QUERY_LEN) return null;
  if (mode !== 'exact' && mode !== 'semantic') return null;
  return { label, query, mode };
}

function genId(): string {
  return `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPublic(row: StoredSavedSearch): SavedSearch {
  return { id: row.id, label: row.label, query: row.query, mode: row.mode, createdAt: row.createdAt };
}

/** Newest first: by createdAt desc, monotonic seq breaks same-ms ties. */
function sortNewestFirst(rows: readonly StoredSavedSearch[]): StoredSavedSearch[] {
  return rows.slice().sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
}

function getAllRows(db: IDBDatabase): Promise<StoredSavedSearch[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as StoredSavedSearch[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Create (or upsert-by-label) a saved search. Validation rejects empty
 * label/query and bad mode (returns null); a matching normalized label reuses
 * the existing id so labels never duplicate. Prunes to SAVED_SEARCH_CAP after.
 */
export async function saveSearch(input: SavedSearchInput): Promise<SavedSearch | null> {
  const valid = validateSearchInput(input);
  if (!valid) return null;
  const db = await openSearchDb();
  if (!db) return null;
  try {
    const norm = normalizeLabel(valid.label);
    const existing = await getAllRows(db);
    const prior = existing.find((r) => normalizeLabel(r.label) === norm);
    const record: StoredSavedSearch = {
      id: prior?.id ?? genId(),
      label: valid.label,
      query: valid.query,
      mode: valid.mode,
      createdAt: Date.now(),
      seq: ++_seq,
    };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await txDone(tx);
    void pruneSearches(db);
    return toPublic(record);
  } catch {
    return null;
  }
}

/** List saved searches, newest first. */
export async function listSearches(): Promise<SavedSearch[]> {
  const db = await openSearchDb();
  if (!db) return [];
  try {
    const rows = await getAllRows(db);
    return sortNewestFirst(rows).map(toPublic);
  } catch {
    return [];
  }
}

/** Delete one saved search by id. */
export async function deleteSearch(id: string): Promise<void> {
  const db = await openSearchDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

/** Wipe every saved search (part of "forget this device"). */
export async function clearSavedSearches(): Promise<void> {
  const db = await openSearchDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

/** Export saved searches as a portable, device-safe JSON snapshot. */
export async function exportSavedSearches(): Promise<SavedSearchExport> {
  const snapshot: SavedSearchExport = {
    kind: 'onyx-saved-searches',
    version: 1,
    exportedAt: new Date().toISOString(),
    searches: [],
  };
  const db = await openSearchDb();
  if (!db) return snapshot;
  try {
    const rows = await getAllRows(db);
    snapshot.searches = sortNewestFirst(rows).map(toPublic);
    return snapshot;
  } catch {
    return snapshot;
  }
}

function reviveSavedSearch(raw: unknown): SavedSearch | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  const mode = raw.mode;
  if (!label || label.length > MAX_LABEL_LEN) return null;
  if (!query || query.length > MAX_QUERY_LEN) return null;
  if (mode !== 'exact' && mode !== 'semantic') return null;

  const rawTime = raw.createdAt;
  let createdAt: number;
  if (typeof rawTime === 'number' && Number.isFinite(rawTime)) {
    createdAt = rawTime;
  } else if (typeof rawTime === 'string' && !Number.isNaN(Date.parse(rawTime))) {
    createdAt = Date.parse(rawTime);
  } else {
    createdAt = Date.now();
  }

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : genId(),
    label,
    query,
    mode: mode as SavedSearchMode,
    createdAt,
  };
}

/** Validate untrusted JSON before it can be imported (allowlist mode, drop invalid). */
export function parseSavedSearchExport(raw: unknown): SavedSearchExport | null {
  if (!isRecord(raw) || raw.kind !== 'onyx-saved-searches' || raw.version !== 1 || !Array.isArray(raw.searches)) {
    return null;
  }
  const exportedAt =
    typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt))
      ? raw.exportedAt
      : new Date().toISOString();
  const searches = raw.searches
    .map(reviveSavedSearch)
    .filter((s): s is SavedSearch => s !== null);
  return { kind: 'onyx-saved-searches', version: 1, exportedAt, searches };
}

/**
 * Merge a validated snapshot into the local store: dedupe by normalized label
 * (reusing any existing id), preserve each entry's createdAt, then prune to the
 * cap. Returns how many rows were written.
 */
export async function importSavedSearches(snapshot: SavedSearchExport): Promise<{ imported: number }> {
  if (snapshot.searches.length === 0) return { imported: 0 };
  const db = await openSearchDb();
  if (!db) return { imported: 0 };
  try {
    const existing = await getAllRows(db);
    const byLabel = new Map<string, StoredSavedSearch>();
    for (const row of existing) byLabel.set(normalizeLabel(row.label), row);

    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let imported = 0;
    for (const entry of snapshot.searches) {
      const norm = normalizeLabel(entry.label);
      const prior = byLabel.get(norm);
      const record: StoredSavedSearch = {
        id: prior?.id ?? entry.id ?? genId(),
        label: entry.label,
        query: entry.query,
        mode: entry.mode,
        createdAt: entry.createdAt,
        seq: ++_seq,
      };
      byLabel.set(norm, record);
      store.put(record);
      imported += 1;
    }
    await txDone(tx);
    void pruneSearches(db);
    return { imported };
  } catch {
    return { imported: 0 };
  }
}

/** Delete entries beyond SAVED_SEARCH_CAP, oldest first. */
async function pruneSearches(db: IDBDatabase): Promise<void> {
  try {
    const rows = await getAllRows(db);
    if (rows.length <= SAVED_SEARCH_CAP) return;
    const doomed = sortNewestFirst(rows).slice(SAVED_SEARCH_CAP);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const row of doomed) store.delete(row.id);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Test hook — reset the module's cached connection and seq counter. */
export function _resetSavedSearchesForTests(): void {
  dbPromise = null;
  _seq = 0;
}
