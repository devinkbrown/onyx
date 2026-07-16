// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * savedSearches.test.ts — the local-first saved-search store, driven by
 * fake-indexeddb. Covers create/list ordering, cap pruning, label dedupe,
 * export→import round-trip, validation rejects, and the "no IndexedDB" path.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SAVED_SEARCH_CAP,
  SAVED_SEARCH_SCAN_LIMIT,
  MAX_LABEL_LEN,
  MAX_QUERY_LEN,
  MAX_SAVED_SEARCH_FUTURE_MS,
  MAX_SAVED_SEARCH_ID_LEN,
  MAX_SAVED_SEARCH_SEQ,
  _resetSavedSearchesForTests,
  clearSavedSearches,
  deleteSearch,
  exportSavedSearches,
  importSavedSearches,
  listSearches,
  normalizeLabel,
  parseSavedSearchExport,
  saveSearch,
  subscribeSavedSearches,
  validateSearchInput,
  type SavedSearchExport,
} from './savedSearches';

const RAW_DB_NAME = 'onyx-vault-searches';
const RAW_STORE = 'saved_searches';

function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RAW_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RAW_STORE)) {
        request.result.createObjectStore(RAW_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRawRows(rows: unknown[]): Promise<void> {
  const db = await openRawDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RAW_STORE, 'readwrite');
    const objectStore = tx.objectStore(RAW_STORE);
    for (const row of rows) objectStore.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function rawRowCount(): Promise<number> {
  const db = await openRawDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RAW_STORE, 'readonly');
    const request = tx.objectStore(RAW_STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Poll an async read until the predicate holds (prune runs post-transaction). */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('savedSearches', () => {
  beforeEach(() => {
    // Fresh IndexedDB universe per test; reset the module's cached connection.
    globalThis.indexedDB = new IDBFactory();
    _resetSavedSearchesForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateSearchInput (pure)', () => {
    it('accepts and trims a valid input', () => {
      expect(validateSearchInput({ label: '  Mentions  ', query: '  hello  ', mode: 'exact' })).toEqual({
        label: 'Mentions',
        query: 'hello',
        mode: 'exact',
      });
    });

    it('accepts the combined hybrid mode', () => {
      expect(validateSearchInput({ label: '  Release recall  ', query: '  rollout  ', mode: 'hybrid' })).toEqual({
        label: 'Release recall',
        query: 'rollout',
        mode: 'hybrid',
      });
    });

    it('rejects empty label', () => {
      expect(validateSearchInput({ label: '   ', query: 'x', mode: 'exact' })).toBeNull();
    });

    it('rejects empty query', () => {
      expect(validateSearchInput({ label: 'x', query: '   ', mode: 'semantic' })).toBeNull();
    });

    it('rejects an invalid mode', () => {
      expect(validateSearchInput({ label: 'x', query: 'y', mode: 'fuzzy' })).toBeNull();
    });

    it('rejects over-length label and query', () => {
      expect(validateSearchInput({ label: 'a'.repeat(MAX_LABEL_LEN + 1), query: 'y', mode: 'exact' })).toBeNull();
      expect(validateSearchInput({ label: 'x', query: 'q'.repeat(MAX_QUERY_LEN + 1), mode: 'exact' })).toBeNull();
    });

    it('accepts label and query values exactly at their length limits after trimming', () => {
      const label = 'a'.repeat(MAX_LABEL_LEN);
      const query = 'q'.repeat(MAX_QUERY_LEN);

      expect(validateSearchInput({ label: ` ${label} `, query: ` ${query} `, mode: 'semantic' })).toEqual({
        label,
        query,
        mode: 'semantic',
      });
    });

    it('rejects object-shaped inputs with non-string label or query fields', () => {
      expect(validateSearchInput({ label: 123, query: 'q', mode: 'exact' })).toBeNull();
      expect(validateSearchInput({ label: 'label', query: { text: 'q' }, mode: 'exact' })).toBeNull();
    });

    it('rejects non-object input', () => {
      expect(validateSearchInput(null)).toBeNull();
      expect(validateSearchInput('nope')).toBeNull();
      expect(validateSearchInput(['a'])).toBeNull();
    });
  });

  describe('normalizeLabel (pure)', () => {
    it('is case- and edge-space-insensitive', () => {
      expect(normalizeLabel('  My Search ')).toBe('my search');
      expect(normalizeLabel('MY SEARCH')).toBe(normalizeLabel('my search'));
    });
  });

  describe('saveSearch / listSearches', () => {
    it('creates a search and reads it back', async () => {
      const created = await saveSearch({ label: 'Mentions', query: 'kain', mode: 'exact' });
      expect(created).not.toBeNull();
      expect(created?.id).toBeTruthy();
      const list = await listSearches();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ label: 'Mentions', query: 'kain', mode: 'exact' });
      expect(typeof list[0]!.createdAt).toBe('number');
    });

    it('persists the combined hybrid mode', async () => {
      await expect(saveSearch({ label: 'Related rollout', query: 'rollout', mode: 'hybrid' }))
        .resolves.toMatchObject({ mode: 'hybrid' });
      await expect(listSearches()).resolves.toEqual([
        expect.objectContaining({ label: 'Related rollout', query: 'rollout', mode: 'hybrid' }),
      ]);
    });

    it('returns null and stores nothing for invalid input', async () => {
      const bad = await saveSearch({ label: '', query: 'x', mode: 'exact' });
      expect(bad).toBeNull();
      expect(await listSearches()).toHaveLength(0);
    });

    it('lists newest first', async () => {
      await saveSearch({ label: 'first', query: 'a', mode: 'exact' });
      await saveSearch({ label: 'second', query: 'b', mode: 'semantic' });
      await saveSearch({ label: 'third', query: 'c', mode: 'exact' });
      const labels = (await listSearches()).map((s) => s.label);
      expect(labels).toEqual(['third', 'second', 'first']);
    });

    it('uses insertion sequence as the newest-first tiebreaker for same-ms saves', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      await saveSearch({ label: 'first', query: 'a', mode: 'exact' });
      await saveSearch({ label: 'second', query: 'b', mode: 'semantic' });
      await saveSearch({ label: 'third', query: 'c', mode: 'exact' });

      expect((await listSearches()).map((s) => s.label)).toEqual(['third', 'second', 'first']);
    });

    it('returns null when the save transaction aborts', async () => {
      const realPut = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        const request = key === undefined
          ? realPut.call(this, value)
          : realPut.call(this, value, key);
        this.transaction.abort();
        return request;
      });

      await expect(saveSearch({ label: 'Lost', query: 'write', mode: 'exact' })).resolves.toBeNull();
      expect(await listSearches()).toEqual([]);
    });

    it('drops hostile stored fields before sorting or returning rows', async () => {
      const now = Date.now();
      await putRawRows([
        { id: 'valid', label: 'Valid', query: 'safe query', mode: 'exact', createdAt: now, seq: 4 },
        { id: 'legacy', label: 'Legacy v1', query: 'still valid', mode: 'hybrid', createdAt: now - 1 },
        { id: 'x'.repeat(MAX_SAVED_SEARCH_ID_LEN + 1), label: 'Huge id', query: 'hidden', mode: 'exact', createdAt: now, seq: 1 },
        { id: 'bad-label', label: 'x'.repeat(MAX_LABEL_LEN + 1), query: 'hidden', mode: 'exact', createdAt: now, seq: 1 },
        { id: 'bad-query', label: 'Bad query', query: 'x'.repeat(MAX_QUERY_LEN + 1), mode: 'exact', createdAt: now, seq: 1 },
        { id: 'bad-mode', label: 'Bad mode', query: 'hidden', mode: 'fuzzy', createdAt: now, seq: 1 },
        { id: 'nan-time', label: 'NaN time', query: 'hidden', mode: 'exact', createdAt: Number.NaN, seq: 1 },
        { id: 'negative-time', label: 'Negative time', query: 'hidden', mode: 'exact', createdAt: -1, seq: 1 },
        { id: 'future-time', label: 'Future time', query: 'hidden', mode: 'exact', createdAt: now + (MAX_SAVED_SEARCH_FUTURE_MS * 2), seq: 1 },
        { id: 'negative-seq', label: 'Negative seq', query: 'hidden', mode: 'exact', createdAt: now, seq: -1 },
        { id: 'future-seq', label: 'Future seq', query: 'hidden', mode: 'exact', createdAt: now, seq: MAX_SAVED_SEARCH_SEQ + 1 },
        { id: 'float-seq', label: 'Float seq', query: 'hidden', mode: 'exact', createdAt: now, seq: 1.5 },
      ]);

      await expect(listSearches()).resolves.toEqual([
        expect.objectContaining({ id: 'valid', label: 'Valid' }),
        expect.objectContaining({ id: 'legacy', label: 'Legacy v1' }),
      ]);
      const exported = await exportSavedSearches();
      expect(exported.searches.map((row) => row.id)).toEqual(['valid', 'legacy']);
      expect(JSON.stringify(exported)).not.toContain('hidden');
    });

    it('bounds physical value reads and refuses writes when corruption exceeds the scan limit', async () => {
      await putRawRows(Array.from({ length: SAVED_SEARCH_SCAN_LIMIT + 1 }, (_, index) => ({
        id: `raw-${String(index).padStart(4, '0')}`,
        label: `Raw ${index}`,
        query: `query ${index}`,
        mode: 'exact',
        createdAt: index,
        seq: index,
      })));
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');

      const rows = await listSearches();
      expect(rows).toHaveLength(SAVED_SEARCH_CAP);
      expect(getAll.mock.calls.some((args) => args[1] === SAVED_SEARCH_SCAN_LIMIT)).toBe(true);
      expect(getAll.mock.calls.some((args) => args[1] === undefined)).toBe(false);
      await expect(saveSearch({ label: 'Refused', query: 'bounded', mode: 'exact' })).resolves.toBeNull();
      expect(await rawRowCount()).toBe(SAVED_SEARCH_SCAN_LIMIT + 1);
    });

    it('does not report a committed save when its row readback cannot be verified', async () => {
      const changes: unknown[] = [];
      subscribeSavedSearches((change) => changes.push(change));
      const realGet = IDBObjectStore.prototype.get;
      vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
        this: IDBObjectStore,
        key: IDBValidKey | IDBKeyRange,
      ): IDBRequest<unknown> {
        const request = realGet.call(this, key);
        this.transaction.abort();
        return request;
      });

      await expect(saveSearch({ label: 'Ambiguous', query: 'readback', mode: 'exact' }))
        .resolves.toBeNull();
      expect(changes).toEqual([]);
      expect((await listSearches()).map((row) => row.label)).toEqual(['Ambiguous']);
    });
  });

  describe('dedupe by normalized label', () => {
    it('upserts instead of duplicating and reuses the id', async () => {
      const a = await saveSearch({ label: 'Mentions', query: 'old', mode: 'exact' });
      const b = await saveSearch({ label: '  mentions ', query: 'new', mode: 'semantic' });
      const list = await listSearches();
      expect(list).toHaveLength(1);
      expect(a?.id).toBe(b?.id);
      expect(list[0]).toMatchObject({ query: 'new', mode: 'semantic' });
    });
  });

  describe('bounded retention', () => {
    it('prunes oldest beyond the cap', async () => {
      for (let i = 0; i < SAVED_SEARCH_CAP + 5; i += 1) {
        await saveSearch({ label: `s${i}`, query: `q${i}`, mode: 'exact' });
      }
      const list = await until(listSearches, (l) => l.length <= SAVED_SEARCH_CAP);
      expect(list).toHaveLength(SAVED_SEARCH_CAP);
      // Newest survive; oldest (s0..s4) are pruned.
      expect(list.some((s) => s.label === `s${SAVED_SEARCH_CAP + 4}`)).toBe(true);
      expect(list.some((s) => s.label === 's0')).toBe(false);
    });
  });

  describe('deleteSearch / clearSavedSearches', () => {
    it('deletes one entry by id', async () => {
      const a = await saveSearch({ label: 'a', query: '1', mode: 'exact' });
      await saveSearch({ label: 'b', query: '2', mode: 'exact' });
      await expect(deleteSearch(a!.id)).resolves.toBe(true);
      const labels = (await listSearches()).map((s) => s.label);
      expect(labels).toEqual(['b']);
    });

    it('clears everything', async () => {
      await saveSearch({ label: 'a', query: '1', mode: 'exact' });
      await saveSearch({ label: 'b', query: '2', mode: 'exact' });
      await expect(clearSavedSearches()).resolves.toBe(true);
      expect(await listSearches()).toHaveLength(0);
    });

    it('reports deletion failure when its transaction aborts and preserves the row', async () => {
      const saved = await saveSearch({ label: 'kept', query: 'decision', mode: 'exact' });
      const realDelete = IDBObjectStore.prototype.delete;
      vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
        this: IDBObjectStore,
        key: IDBValidKey | IDBKeyRange,
      ): IDBRequest<undefined> {
        const request = realDelete.call(this, key);
        this.transaction.abort();
        return request;
      });

      await expect(deleteSearch(saved!.id)).resolves.toBe(false);
      await expect(listSearches()).resolves.toEqual([
        expect.objectContaining({ id: saved!.id, label: 'kept' }),
      ]);
    });
  });

  describe('export / import round-trip', () => {
    it('round-trips saved searches into a fresh vault', async () => {
      await saveSearch({ label: 'Mentions', query: 'kain', mode: 'exact' });
      await saveSearch({ label: 'Ideas', query: 'roadmap', mode: 'semantic' });
      const snapshot = await exportSavedSearches();
      expect(snapshot.kind).toBe('onyx-saved-searches');
      expect(snapshot.version).toBe(1);
      expect(snapshot.searches).toHaveLength(2);

      // Fresh universe: nothing carries over except through the snapshot.
      globalThis.indexedDB = new IDBFactory();
      _resetSavedSearchesForTests();
      expect(await listSearches()).toHaveLength(0);

      const result = await importSavedSearches(snapshot);
      expect(result.imported).toBe(2);
      const list = await listSearches();
      expect(list).toHaveLength(2);
      const byLabel = new Map(list.map((s) => [s.label, s]));
      expect(byLabel.get('Mentions')).toMatchObject({ query: 'kain', mode: 'exact' });
      expect(byLabel.get('Ideas')).toMatchObject({ query: 'roadmap', mode: 'semantic' });
      // createdAt is preserved across the round-trip.
      const original = new Map(snapshot.searches.map((s) => [s.label, s.createdAt]));
      expect(byLabel.get('Mentions')!.createdAt).toBe(original.get('Mentions'));
    });

    it('does not let distinct-label entries sharing an id clobber each other', async () => {
      // A corrupt / hostile export can carry the SAME opaque id on two entries
      // with DIFFERENT labels. Dedupe is by label, not id, so both are distinct
      // searches — neither may silently overwrite the other in IndexedDB.
      const snapshot: SavedSearchExport = {
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [
          { id: 'dup', label: 'Alpha', query: 'a', mode: 'exact', createdAt: 1 },
          { id: 'dup', label: 'Beta', query: 'b', mode: 'exact', createdAt: 2 },
        ],
      };
      await importSavedSearches(snapshot);
      const list = await listSearches();
      expect(list.map((s) => s.label).sort()).toEqual(['Alpha', 'Beta']);
      // Persisted ids must be unique so neither row clobbers the other.
      expect(new Set(list.map((s) => s.id)).size).toBe(2);
    });

    it('regenerates an incoming id that collides with an existing different label', async () => {
      const existing = await saveSearch({ label: 'Alpha', query: 'a', mode: 'exact' });
      const snapshot: SavedSearchExport = {
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [
          { id: existing!.id, label: 'Beta', query: 'b', mode: 'semantic', createdAt: 2 },
        ],
      };

      expect(await importSavedSearches(snapshot)).toEqual({ imported: 1 });

      const list = await listSearches();
      const byLabel = new Map(list.map((s) => [s.label, s]));
      expect(byLabel.get('Alpha')!.id).toBe(existing!.id);
      expect(byLabel.get('Beta')!.id).not.toBe(existing!.id);
      expect(new Set(list.map((s) => s.id)).size).toBe(2);
    });

    it('import dedupes against existing labels', async () => {
      await saveSearch({ label: 'Mentions', query: 'old', mode: 'exact' });
      const snapshot: SavedSearchExport = {
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [{ id: 'x1', label: 'mentions', query: 'new', mode: 'semantic', createdAt: Date.now() }],
      };
      await importSavedSearches(snapshot);
      const list = await listSearches();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ query: 'new', mode: 'semantic' });
    });

    it('bounds and deduplicates typed imports before opening the write transaction', async () => {
      const searches = Array.from({ length: SAVED_SEARCH_CAP * 4 }, (_, index) => ({
        id: `incoming-${index}`,
        label: index % 2 === 0 ? 'Duplicate' : `Search ${index}`,
        query: `query ${index}`,
        mode: 'exact' as const,
        createdAt: index,
      }));
      const snapshot: SavedSearchExport = {
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches,
      };

      const result = await importSavedSearches(snapshot);
      const rows = await listSearches();

      expect(result.imported).toBeLessThanOrEqual(SAVED_SEARCH_CAP);
      expect(rows).toHaveLength(result.imported);
      expect(new Set(rows.map((row) => normalizeLabel(row.label))).size).toBe(rows.length);
    });

    it('reports zero imports when the write transaction aborts', async () => {
      const realPut = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        const request = key === undefined
          ? realPut.call(this, value)
          : realPut.call(this, value, key);
        this.transaction.abort();
        return request;
      });
      const snapshot: SavedSearchExport = {
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [{ id: 'lost', label: 'Lost', query: 'write', mode: 'exact', createdAt: 1 }],
      };

      await expect(importSavedSearches(snapshot)).resolves.toEqual({ imported: 0 });
      expect(await listSearches()).toEqual([]);
    });

    it('does not count an imported row that committed and was then pruned', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      for (let index = 0; index < SAVED_SEARCH_CAP; index += 1) {
        await saveSearch({ label: `Current ${index}`, query: `query ${index}`, mode: 'exact' });
      }
      const changes: unknown[] = [];
      subscribeSavedSearches((change) => changes.push(change));

      await expect(importSavedSearches({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [{ id: 'old-import', label: 'Old import', query: 'prune me', mode: 'exact', createdAt: 1 }],
      })).resolves.toEqual({ imported: 0 });

      expect((await listSearches()).some((row) => row.label === 'Old import')).toBe(false);
      expect(await rawRowCount()).toBe(SAVED_SEARCH_CAP);
      expect(changes).toEqual([]);
    });

    it('publishes metadata-only same-tab invalidations after verified changes', async () => {
      const changes: unknown[] = [];
      subscribeSavedSearches(() => { throw new Error('isolated listener'); });
      const unsubscribe = subscribeSavedSearches((change) => changes.push(change));

      const saved = await saveSearch({ label: 'Private label', query: 'private query text', mode: 'exact' });
      expect(saved).not.toBeNull();
      await deleteSearch(saved!.id);
      await importSavedSearches({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date().toISOString(),
        searches: [{ id: 'portable', label: 'Portable private', query: 'portable secret', mode: 'hybrid', createdAt: 1 }],
      });
      await clearSavedSearches();

      expect(changes).toEqual([
        { revision: 1, reason: 'save', count: 1 },
        { revision: 2, reason: 'delete', count: 1 },
        { revision: 3, reason: 'import', count: 1 },
        { revision: 4, reason: 'clear', count: 0 },
      ]);
      expect(JSON.stringify(changes)).not.toMatch(/Private|private query|portable|secret|ss-/i);
      unsubscribe();
      await saveSearch({ label: 'After unsubscribe', query: 'not published', mode: 'exact' });
      expect(changes).toHaveLength(4);
    });
  });

  describe('parseSavedSearchExport (validation)', () => {
    it('rejects wrong kind/version and non-objects', () => {
      expect(parseSavedSearchExport(null)).toBeNull();
      expect(parseSavedSearchExport({ kind: 'other', version: 1, searches: [] })).toBeNull();
      expect(parseSavedSearchExport({ kind: 'onyx-saved-searches', version: 2, searches: [] })).toBeNull();
      expect(parseSavedSearchExport({ kind: 'onyx-saved-searches', version: 1, searches: 'nope' })).toBeNull();
    });

    it('bounds untrusted arrays before reviving rows', () => {
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        searches: Array.from({ length: SAVED_SEARCH_CAP * 4 }, (_, index) => ({
          id: `s${index}`,
          label: `Search ${index}`,
          query: `query ${index}`,
          mode: 'exact',
          createdAt: index,
        })),
      });

      expect(parsed?.searches).toHaveLength(SAVED_SEARCH_CAP);
    });

    it('drops invalid rows and revives valid ones', () => {
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: 'not-a-date',
        searches: [
          { label: 'ok', query: 'q', mode: 'exact', createdAt: 123 },
          { label: '', query: 'q', mode: 'exact' }, // empty label -> dropped
          { label: 'bad-mode', query: 'q', mode: 'fuzzy' }, // bad mode -> dropped
          { label: 'no-query', query: '   ', mode: 'exact' }, // empty query -> dropped
          'garbage',
        ],
      });
      expect(parsed).not.toBeNull();
      expect(parsed!.searches).toHaveLength(1);
      expect(parsed!.searches[0]).toMatchObject({ label: 'ok', query: 'q', mode: 'exact', createdAt: 123 });
      // Bad exportedAt is replaced with a valid ISO timestamp.
      expect(Number.isNaN(Date.parse(parsed!.exportedAt))).toBe(false);
    });

    it('revives hybrid searches from portable snapshots', () => {
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        searches: [{ id: 'hybrid', label: 'Related rollout', query: 'rollout', mode: 'hybrid', createdAt: 5 }],
      });

      expect(parsed?.searches).toEqual([
        expect.objectContaining({ id: 'hybrid', mode: 'hybrid' }),
      ]);
    });

    it('revives a valid ISO createdAt string to epoch ms', () => {
      const iso = '2026-07-10T00:00:00.000Z';
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        searches: [{ label: 'ok', query: 'q', mode: 'semantic', createdAt: iso }],
      });
      expect(parsed!.searches[0]!.createdAt).toBe(Date.parse(iso));
    });

    it('fills missing ids and non-date createdAt values while preserving safe rows', () => {
      const before = Date.now();
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: '2026-07-10T00:00:00.000Z',
        searches: [{ id: '   ', label: 'ok', query: 'q', mode: 'exact', createdAt: 'not-a-date' }],
      });
      const after = Date.now();

      expect(parsed).not.toBeNull();
      expect(parsed!.searches[0]!.id).toMatch(/^ss-/);
      expect(parsed!.searches[0]!.createdAt).toBeGreaterThanOrEqual(before);
      expect(parsed!.searches[0]!.createdAt).toBeLessThanOrEqual(after);
    });

    it('keeps exact-limit rows and drops rows beyond label or query limits', () => {
      const label = 'a'.repeat(MAX_LABEL_LEN);
      const query = 'q'.repeat(MAX_QUERY_LEN);

      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        searches: [
          { id: 'ok', label, query, mode: 'exact', createdAt: 1 },
          { id: 'long-label', label: `${label}x`, query: 'q', mode: 'exact', createdAt: 2 },
          { id: 'long-query', label: 'label', query: `${query}x`, mode: 'semantic', createdAt: 3 },
        ],
      });

      expect(parsed!.searches.map((s) => s.id)).toEqual(['ok']);
      expect(parsed!.searches[0]).toMatchObject({ label, query });
    });

    it('bounds ids and replaces hostile ordering and export timestamps', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      const parsed = parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: new Date(1_800_000_000_000 + MAX_SAVED_SEARCH_FUTURE_MS + 1).toISOString(),
        searches: [
          { id: 'x'.repeat(MAX_SAVED_SEARCH_ID_LEN), label: 'Exact id', query: 'a', mode: 'exact', createdAt: 0 },
          { id: 'x'.repeat(MAX_SAVED_SEARCH_ID_LEN + 1), label: 'Huge id', query: 'b', mode: 'exact', createdAt: -1 },
          { id: 'bad\u0000id', label: 'Control id', query: 'c', mode: 'exact', createdAt: Number.POSITIVE_INFINITY },
          { id: 'future', label: 'Future', query: 'd', mode: 'exact', createdAt: 1_800_000_000_000 + MAX_SAVED_SEARCH_FUTURE_MS + 1 },
        ],
      });

      expect(parsed?.exportedAt).toBe(new Date(1_800_000_000_000).toISOString());
      expect(parsed?.searches[0]).toMatchObject({
        id: 'x'.repeat(MAX_SAVED_SEARCH_ID_LEN),
        createdAt: 0,
      });
      expect(parsed?.searches.slice(1, 3).every((row) => row.id.startsWith('ss-'))).toBe(true);
      expect(parsed?.searches[3]?.id).toBe('future');
      expect(parsed?.searches.slice(1).every((row) => row.createdAt === 1_800_000_000_000)).toBe(true);
    });
  });

  describe('best-effort with no IndexedDB', () => {
    it('degrades to empty/null without throwing', async () => {
      // @ts-expect-error — simulate a private window / unsupported environment.
      delete globalThis.indexedDB;
      _resetSavedSearchesForTests();
      expect(await saveSearch({ label: 'a', query: 'b', mode: 'exact' })).toBeNull();
      expect(await listSearches()).toEqual([]);
      expect(await importSavedSearches({ kind: 'onyx-saved-searches', version: 1, exportedAt: '', searches: [{ id: 'i', label: 'a', query: 'b', mode: 'exact', createdAt: 1 }] })).toEqual({ imported: 0 });
      await expect(deleteSearch('nope')).resolves.toBe(false);
      await expect(clearSavedSearches()).resolves.toBe(false);
      const snap = await exportSavedSearches();
      expect(snap.searches).toEqual([]);
    });
  });
});
