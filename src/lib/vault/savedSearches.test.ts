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
  MAX_LABEL_LEN,
  MAX_QUERY_LEN,
  _resetSavedSearchesForTests,
  clearSavedSearches,
  deleteSearch,
  exportSavedSearches,
  importSavedSearches,
  listSearches,
  normalizeLabel,
  parseSavedSearchExport,
  saveSearch,
  validateSearchInput,
  type SavedSearchExport,
} from './savedSearches';

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
      await deleteSearch(a!.id);
      const labels = (await listSearches()).map((s) => s.label);
      expect(labels).toEqual(['b']);
    });

    it('clears everything', async () => {
      await saveSearch({ label: 'a', query: '1', mode: 'exact' });
      await saveSearch({ label: 'b', query: '2', mode: 'exact' });
      await clearSavedSearches();
      expect(await listSearches()).toHaveLength(0);
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
  });

  describe('parseSavedSearchExport (validation)', () => {
    it('rejects wrong kind/version and non-objects', () => {
      expect(parseSavedSearchExport(null)).toBeNull();
      expect(parseSavedSearchExport({ kind: 'other', version: 1, searches: [] })).toBeNull();
      expect(parseSavedSearchExport({ kind: 'onyx-saved-searches', version: 2, searches: [] })).toBeNull();
      expect(parseSavedSearchExport({ kind: 'onyx-saved-searches', version: 1, searches: 'nope' })).toBeNull();
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
  });

  describe('best-effort with no IndexedDB', () => {
    it('degrades to empty/null without throwing', async () => {
      // @ts-expect-error — simulate a private window / unsupported environment.
      delete globalThis.indexedDB;
      _resetSavedSearchesForTests();
      expect(await saveSearch({ label: 'a', query: 'b', mode: 'exact' })).toBeNull();
      expect(await listSearches()).toEqual([]);
      expect(await importSavedSearches({ kind: 'onyx-saved-searches', version: 1, exportedAt: '', searches: [{ id: 'i', label: 'a', query: 'b', mode: 'exact', createdAt: 1 }] })).toEqual({ imported: 0 });
      await expect(deleteSearch('nope')).resolves.toBeUndefined();
      await expect(clearSavedSearches()).resolves.toBeUndefined();
      const snap = await exportSavedSearches();
      expect(snap.searches).toEqual([]);
    });
  });
});
