// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * historyVault.test.ts — the IndexedDB persistence layer, driven by
 * fake-indexeddb. Covers serialization round-trips, per-target isolation,
 * pruning, and the "no IndexedDB at all" graceful path.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
import {
  markTopicRead,
  readTopicReadLedger,
} from '@/lib/topics/topicReadLedger';
import type { VaultExportSnapshot } from './historyVault';
import {
  OMIT_AT_REST,
  MAX_EXPORT_TOTAL_RAW_MESSAGES,
  MAX_VAULT_MESSAGE_TEXT_LENGTH,
  OUTBOX_MAX_ENTRIES,
  VAULT_KEEP,
  VAULT_SEARCH_SCAN_MAX,
  _resetVaultForTests,
  applyRetentionPolicy,
  beginVaultWriteIntent,
  clearOutbox,
  clearVault,
  addScheduledRow,
  cancelScheduledRow,
  claimScheduledRow,
  deleteOutboxEntry,
  deserializeMessage,
  exportVault,
  getRetentionPolicy,
  importVault,
  loadAround,
  loadOutbox,
  loadRecent,
  loadRecentWithStatus,
  loadScheduledRows,
  migrateScheduledRows,
  markOutboxWireAdmitted,
  parseVaultExport,
  queueOutbox,
  readAllVaultHits,
  releaseVaultWriteReservation,
  reserveVaultWrite,
  saveMessages,
  searchVault,
  settleScheduledClaim,
  serializeMessage,
  setRetentionPolicy,
  subscribeOutbox,
  VaultImportOwnerChangedError,
} from './historyVault';
import { SEARCH_CORPUS_TEXT_MAX } from './searchBounds';

const OUTBOX_OWNER = { serverUrl: 'wss://example.test', identity: 'alice' } as const;
const BOB_OWNER = { serverUrl: 'wss://example.test', identity: 'bob' } as const;
const OTHER_SERVER_OWNER = { serverUrl: 'wss://other.test', identity: 'alice' } as const;
const queueOwnedOutbox = (target: string, text: string) => queueOutbox(target, text, OUTBOX_OWNER);

// ── Compile-time plaintext-at-rest partition guard ───────────────────────────
// Every ChatMessage field must be consciously classified as either PERSISTED
// (safe at rest) or omitted (OMIT_AT_REST). PersistedKey is an explicit ledger,
// NOT `Exclude<keyof ChatMessage, ...>`, so adding a NEW field to ChatMessage
// (e.g. a decrypted attachment) makes `keyof ChatMessage` no longer equal the
// classified union below — a TYPE ERROR here that `pnpm typecheck` catches. That
// forces a deliberate persist-or-omit decision instead of letting a transient
// field silently ride the serialize spread onto disk.
type PersistedKey =
  | 'id'
  | 'time'
  | 'from'
  | 'text'
  | 'type'
  | 'highlight'
  | 'target'
  | 'topic'
  | 'reactions'
  | 'replyTo'
  | 'edited'
  | 'deleted'
  | 'redacted'
  | 'pending'
  | 'encrypted'
  | 'e2ee';
type ClassifiedKey = PersistedKey | (typeof OMIT_AT_REST)[number];
type AssertMutualExtends<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// If this line errors, a ChatMessage field is unclassified: add it to
// PersistedKey (safe at rest) or to OMIT_AT_REST (decrypted/transient).
const _classifiedCoversChatMessage: AssertMutualExtends<ClassifiedKey, keyof ChatMessage> = true;
void _classifiedCoversChatMessage;

function msg(id: string, time: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    time: new Date(time),
    from: 'kain',
    text: `hello ${id}`,
    type: 'msg',
    target: '#room',
    ...over,
  } as ChatMessage;
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

async function openTestVault(): Promise<IDBDatabase> {
  // Initialize the current schema through the production path, then open the same DB
  // for deliberate raw-row corruption tests.
  await loadOutbox();
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('onyx-vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRawOutboxRows(rows: readonly Record<string, unknown>[]): Promise<void> {
  const db = await openTestVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      for (const row of rows) tx.objectStore('outbox').put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readRawVaultMeta(): Promise<Record<string, unknown>[]> {
  const db = await openTestVault();
  try {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const tx = db.transaction('vault_meta', 'readonly');
      const request = tx.objectStore('vault_meta').getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function synchronousWriteIntentKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith('onyx:vault:write-intent:')) keys.push(key);
  }
  return keys;
}

async function readWriteReservations(): Promise<Record<string, unknown>[]> {
  return (await readRawVaultMeta()).filter((row) => row.kind === 'message-write');
}

describe('historyVault', () => {
  beforeEach(() => {
    // Fresh IndexedDB universe per test; reset the module's cached connection.
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    _resetVaultForTests();
  });

  describe('serializeMessage / deserializeMessage', () => {
    it('round-trips a message, converting Date ⇄ epoch ms', () => {
      const original = msg('a1', 1_700_000_000_000, {
        highlight: true,
        reactions: [{ emoji: '🔥', users: ['trev'] }],
        replyTo: { id: 'z9', from: 'trev', text: 'earlier' },
      });
      const stored = serializeMessage('#Room', original);
      expect(stored.time).toBe(1_700_000_000_000);
      expect(stored.target_key).toBe('#room');

      const back = deserializeMessage(stored);
      expect(back.time).toBeInstanceOf(Date);
      expect(back.time.getTime()).toBe(1_700_000_000_000);
      expect(back).toEqual(original);
      expect('target_key' in back).toBe(false);
    });

    it('round-trips an explicit reaction count while keeping named users', () => {
      const original = msg('reaction-count', 1000, {
        reactions: [{ emoji: '🔥', users: ['trev'], count: 50 }],
      });
      const back = deserializeMessage(serializeMessage('#room', original));
      expect(back.reactions).toEqual([{ emoji: '🔥', users: ['trev'], count: 50 }]);
    });

    it('strips every OMIT_AT_REST field, and the set includes plaintext', () => {
      // plaintext is the load-bearing case today; assert the allowlist covers it
      // so a future rename/removal of the constant fails loudly here.
      expect([...OMIT_AT_REST]).toContain('plaintext');

      // Build a message carrying a value for every omit-at-rest key, then prove
      // none survive serialization — the plaintext-at-rest invariant, enforced by
      // the allowlist rather than by an exclusion destructure.
      const withTransient = msg('e1', 1000, {
        encrypted: true,
        text: 'onyxdm.ciphertext',
      }) as ChatMessage & Record<string, unknown>;
      for (const key of OMIT_AT_REST) withTransient[key] = `secret-${key}`;

      const stored = serializeMessage('Trev', withTransient) as Record<string, unknown>;
      for (const key of OMIT_AT_REST) {
        expect(key in stored).toBe(false);
      }
      // The ciphertext envelope still persists; only the decrypted view is gone.
      expect(stored.text).toBe('onyxdm.ciphertext');
      expect(stored.encrypted).toBe(true);
      // The input message is not mutated by the strip.
      expect((withTransient as Record<string, unknown>).plaintext).toBe('secret-plaintext');
    });

    it('sanitizes legacy reply envelopes on both serialization and hydration', () => {
      const envelope = 'ONYXDM1 legacy-reply-envelope';
      const original = msg('reply-envelope', 1000, {
        replyTo: { id: 'parent', from: 'trev', text: envelope },
      });

      const stored = serializeMessage('Trev', original);
      expect(stored.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
      expect(original.replyTo?.text).toBe(envelope);

      const hydrated = deserializeMessage({
        ...stored,
        replyTo: { id: 'parent', from: 'trev', text: envelope },
      });
      expect(hydrated.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
    });

    it('deserializeMessage strips smuggled OMIT_AT_REST fields (fail-closed load)', () => {
      // A hostile/legacy row that somehow carried plaintext past serialize must
      // still never re-enter the UI via loadRecent / loadAround / search.
      const smuggled = {
        ...serializeMessage('trev', msg('cipher', 1000, {
          target: 'trev',
          text: 'ONYXDM1 opaque-ciphertext',
          encrypted: true,
        })),
        plaintext: 'must-not-hydrate',
      } as ReturnType<typeof serializeMessage> & { plaintext: string };

      const back = deserializeMessage(smuggled);
      expect(back.text).toBe('ONYXDM1 opaque-ciphertext');
      expect(back.plaintext).toBeUndefined();
      expect('plaintext' in back).toBe(false);
    });
  });

  describe('saveMessages / loadRecent', () => {
    it('reports complete empty reads separately from unavailable storage', async () => {
      expect(await loadRecentWithStatus('#room')).toEqual({ messages: [], status: 'complete' });
      // @ts-expect-error deliberate unavailable-storage boundary
      delete globalThis.indexedDB;
      _resetVaultForTests();
      expect(await loadRecentWithStatus('#room')).toEqual({ messages: [], status: 'unavailable' });
    });

    it('preserves rows already read when the cursor fails', async () => {
      await saveMessages('#room', [msg('m1', 1000), msg('m2', 2000)]);
      const realOpenCursor = IDBIndex.prototype.openCursor;
      const openCursor = vi.spyOn(IDBIndex.prototype, 'openCursor').mockImplementation(function (this: IDBIndex, ...args) {
        const request = Reflect.apply(realOpenCursor, this, args) as IDBRequest;
        queueMicrotask(() => {
          const original = request.onsuccess;
          request.onsuccess = (event) => {
            original?.call(request, event);
            if (request.result) request.onerror?.call(request, new Event('error'));
          };
        });
        return request;
      });
      try {
        const result = await loadRecentWithStatus('#room');
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.status).toBe('partial');
      } finally {
        openCursor.mockRestore();
      }
    });

    it('does not report complete when the transaction aborts after cursor exhaustion', async () => {
      await saveMessages('#room', [msg('m1', 1000)]);
      const realOpenCursor = IDBIndex.prototype.openCursor;
      const openCursor = vi.spyOn(IDBIndex.prototype, 'openCursor').mockImplementation(function (this: IDBIndex, ...args) {
        const request = Reflect.apply(realOpenCursor, this, args) as IDBRequest;
        queueMicrotask(() => {
          const original = request.onsuccess;
          request.onsuccess = (event) => {
            original?.call(request, event);
            if (!request.result) request.transaction?.abort();
          };
        });
        return request;
      });
      try {
        const result = await loadRecentWithStatus('#room');
        expect(result).toEqual({ messages: [expect.objectContaining({ id: 'm1' })], status: 'partial' });
      } finally {
        openCursor.mockRestore();
      }
    });
    it('persists and reloads chronologically', async () => {
      const msgs = [msg('m1', 1000), msg('m2', 2000), msg('m3', 3000)];
      await saveMessages('#Room', msgs);
      const loaded = await loadRecent('#room');
      expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
      expect(loaded[0]!.time.getTime()).toBe(1000);
    });

    it('isolates the same target and message id by server identity', async () => {
      await saveMessages('#room', [msg('shared-id', 1000, { text: 'Alice history' })], OUTBOX_OWNER);
      await saveMessages('#room', [msg('shared-id', 2000, { text: 'Bob history' })], BOB_OWNER);
      await saveMessages('#room', [msg('shared-id', 3000, { text: 'Other server history' })], OTHER_SERVER_OWNER);

      await expect(loadRecent('#room', VAULT_KEEP, OUTBOX_OWNER)).resolves.toMatchObject([
        { id: 'shared-id', text: 'Alice history' },
      ]);
      await expect(loadRecent('#room', VAULT_KEEP, BOB_OWNER)).resolves.toMatchObject([
        { id: 'shared-id', text: 'Bob history' },
      ]);
      await expect(loadRecent('#room', VAULT_KEEP, OTHER_SERVER_OWNER)).resolves.toMatchObject([
        { id: 'shared-id', text: 'Other server history' },
      ]);
      // The temporary legacy overload cannot read newly-owned rows either.
      await expect(loadRecent('#room')).resolves.toEqual([]);
    });

    it('rejects malformed owners instead of falling back to the legacy namespace', async () => {
      const invalid = { serverUrl: ' wss://example.test', identity: 'alice' };
      await expect(saveMessages('#room', [msg('secret', 1000)], invalid)).resolves.toBe(false);
      await expect(loadRecent('#room', VAULT_KEEP, invalid)).resolves.toEqual([]);
      await expect(searchVault('secret', 80, invalid)).resolves.toEqual([]);
      await expect(exportVault(invalid)).resolves.toMatchObject({ targets: [] });
    });

    it('reports commit success so callers can track a durable watermark', async () => {
      expect(await saveMessages('#room', [msg('m1', 1000)])).toBe(true);
      // An empty batch is a committed no-op, not a failure.
      expect(await saveMessages('#room', [])).toBe(true);
    });

    it('admits message writes with opaque metadata only and consumes the reservation', async () => {
      const reservation = await reserveVaultWrite();
      expect(reservation).toEqual({
        token: expect.any(String),
        eraseEpoch: 0,
      });

      const pending = (await readRawVaultMeta()).find((row) => row.kind === 'message-write');
      expect(pending).toMatchObject({ kind: 'message-write', epoch: 0 });
      expect(pending).not.toHaveProperty('text');
      expect(JSON.stringify(pending)).not.toContain('#room');
      expect(JSON.stringify(pending)).not.toContain('hello');

      expect(await saveMessages('#room', [msg('reserved', 1000)], undefined, reservation!.eraseEpoch, reservation!))
        .toBe(true);
      expect((await readRawVaultMeta()).some((row) => row.kind === 'message-write')).toBe(false);
      expect((await loadRecent('#room')).map((message) => message.id)).toEqual(['reserved']);

      // The explicit cleanup path is idempotent after the consuming write.
      expect(await releaseVaultWriteReservation(reservation!.token)).toBe(true);
    });

    it('accepts a fresh intent registered after a committed clear', async () => {
      expect(await clearVault()).toBe(true);

      // Clear-before-intent: the new intent reads the committed epoch and is a
      // legitimate post-clear admission, not a reuse of the old epoch.
      const intent = beginVaultWriteIntent();
      expect(intent).toMatchObject({ token: expect.any(String), expectedEraseEpoch: 1 });
      const reservation = await reserveVaultWrite(intent!);
      expect(reservation).toEqual({ token: intent!.token, eraseEpoch: 1 });
      expect(await saveMessages('#room', [msg('after-clear', 1000)], undefined, reservation!.eraseEpoch, reservation!))
        .toBe(true);
      expect((await loadRecent('#room')).map((message) => message.id)).toEqual(['after-clear']);
    });

    it('rejects a reservation bound to an old erase epoch after clear commits', async () => {
      const reservation = await reserveVaultWrite();
      expect(reservation).not.toBeNull();
      expect(await clearVault()).toBe(true);

      // Clear-after-reservation: the reservation row and any rows admitted by
      // it are ordered before the clear and cannot be consumed afterward.
      await expect(saveMessages(
        '#room',
        [msg('old-epoch', 1000)],
        undefined,
        reservation!.eraseEpoch,
        reservation!,
      )).resolves.toBe(false);
      expect(await readWriteReservations()).toEqual([]);
      expect(await loadRecent('#room')).toEqual([]);
    });

    it('releases a supplied reservation at invalid and empty input boundaries', async () => {
      const invalidOwnerReservation = await reserveVaultWrite();
      expect(invalidOwnerReservation).not.toBeNull();
      await expect(saveMessages(
        '#room',
        [msg('invalid-owner', 1000)],
        { serverUrl: ' wss://example.test', identity: 'alice' },
        invalidOwnerReservation!.eraseEpoch,
        invalidOwnerReservation!,
      )).resolves.toBe(false);
      expect(await readWriteReservations()).toEqual([]);
      expect(synchronousWriteIntentKeys()).toEqual([]);

      const emptyReservation = await reserveVaultWrite();
      expect(emptyReservation).not.toBeNull();
      await expect(saveMessages('#room', [], undefined, emptyReservation!.eraseEpoch, emptyReservation!))
        .resolves.toBe(true);
      expect(await readWriteReservations()).toEqual([]);
      expect(synchronousWriteIntentKeys()).toEqual([]);

      const invalidInputReservation = await reserveVaultWrite();
      expect(invalidInputReservation).not.toBeNull();
      await expect(saveMessages(
        '#room',
        null as unknown as readonly ChatMessage[],
        undefined,
        invalidInputReservation!.eraseEpoch,
        invalidInputReservation!,
      )).resolves.toBe(false);
      expect(await readWriteReservations()).toEqual([]);
      expect(synchronousWriteIntentKeys()).toEqual([]);
    });

    it('releases a supplied reservation when IndexedDB is unavailable', async () => {
      const reservation = await reserveVaultWrite();
      expect(reservation).not.toBeNull();
      const realIndexedDB = globalThis.indexedDB;
      vi.stubGlobal('indexedDB', undefined);
      _resetVaultForTests();

      try {
        await expect(saveMessages('#room', [msg('unavailable', 1000)], undefined, reservation!.eraseEpoch, reservation!))
          .resolves.toBe(false);
        // The durable row cannot be deleted while IndexedDB is absent, but the
        // synchronous authority is removed immediately and cannot admit later.
        expect(synchronousWriteIntentKeys()).toEqual([]);
      } finally {
        vi.stubGlobal('indexedDB', realIndexedDB);
        _resetVaultForTests();
        await releaseVaultWriteReservation(reservation!.token);
      }
    });

    it('releases a supplied reservation after synchronous transaction, request, or put throws', async () => {
      const realGet = IDBObjectStore.prototype.get;
      const realPut = IDBObjectStore.prototype.put;
      const cases: Array<{
        label: string;
        install: () => { mockRestore: () => void };
      }> = [
        {
          label: 'closed transaction',
          install: () => vi.spyOn(IDBDatabase.prototype, 'transaction')
            .mockImplementationOnce(() => { throw new DOMException('closed', 'InvalidStateError'); }),
        },
        {
          label: 'request',
          install: () => vi.spyOn(IDBObjectStore.prototype, 'get')
            .mockImplementationOnce(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange): IDBRequest {
              if (this.name === 'vault_meta') throw new DOMException('closed', 'InvalidStateError');
              return realGet.call(this, query);
            }),
        },
        {
          label: 'put',
          install: () => vi.spyOn(IDBObjectStore.prototype, 'put')
            .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
              if (this.name === 'messages') throw new DOMException('closed', 'InvalidStateError');
              return key === undefined
                ? realPut.call(this, value)
                : realPut.call(this, value, key);
            }),
        },
      ];

      for (const testCase of cases) {
        const reservation = await reserveVaultWrite();
        expect(reservation, testCase.label).not.toBeNull();
        const installed = testCase.install();
        try {
          await expect(saveMessages('#room', [msg(`throw-${testCase.label}`, 1000)], undefined, reservation!.eraseEpoch, reservation!))
            .resolves.toBe(false);
        } finally {
          installed.mockRestore();
        }
        expect(await readWriteReservations(), testCase.label).toEqual([]);
        expect(synchronousWriteIntentKeys(), testCase.label).toEqual([]);
      }
    });

    it('releases a supplied reservation after an asynchronous write abort', async () => {
      const reservation = await reserveVaultWrite();
      expect(reservation).not.toBeNull();
      const realPut = IDBObjectStore.prototype.put;
      const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest {
        const request = key === undefined
          ? realPut.call(this, value)
          : realPut.call(this, value, key);
        if (this.name === 'messages') this.transaction.abort();
        return request;
      });

      try {
        await expect(saveMessages('#room', [msg('async-abort', 1000)], undefined, reservation!.eraseEpoch, reservation!))
          .resolves.toBe(false);
      } finally {
        put.mockRestore();
      }
      expect(await readWriteReservations()).toEqual([]);
      expect(synchronousWriteIntentKeys()).toEqual([]);
    });

    it('returns false (never throws) when IndexedDB is unavailable', async () => {
      // @ts-expect-error — simulate a private window with no IndexedDB
      delete globalThis.indexedDB;
      _resetVaultForTests();
      await expect(saveMessages('#room', [msg('m1', 1000)])).resolves.toBe(false);
    });

    it('retries a failed IndexedDB open instead of poisoning later writes', async () => {
      _resetVaultForTests();
      const indexedDb = globalThis.indexedDB;
      const open = vi.spyOn(indexedDb, 'open').mockImplementationOnce(() => {
        throw new Error('temporary IndexedDB failure');
      });

      try {
        expect(await saveMessages('#recovered', [msg('retry', 1000)])).toBe(false);
        expect(await saveMessages('#recovered', [msg('retry', 1000)])).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
        expect((await loadRecent('#recovered')).map((row) => row.id)).toEqual(['retry']);
      } finally {
        open.mockRestore();
      }
    });

    it('reconciles a provisional clear marker before admitting a post-recovery reservation', async () => {
      // Establish durable epoch zero, then force both the clear and its abort
      // reconciliation reads to fail. This leaves only a provisional marker in
      // localStorage; a later recovered open must prove/rebase it before a write.
      await loadOutbox();
      _resetVaultForTests();
      const indexedDb = globalThis.indexedDB;
      const open = vi.spyOn(indexedDb, 'open').mockImplementation(() => {
        throw new Error('temporarily blocked IndexedDB');
      });

      try {
        await expect(clearVault()).resolves.toBe(false);
        expect(localStorage.getItem('onyx:vault:clear-pending')).not.toBeNull();
      } finally {
        open.mockRestore();
      }

      const reservation = await reserveVaultWrite();
      expect(reservation).toEqual({ token: expect.any(String), eraseEpoch: 0 });
      expect(await saveMessages(
        '#recovered',
        [msg('after-recovery', 1000)],
        undefined,
        reservation!.eraseEpoch,
        reservation!,
      )).toBe(true);
      expect(localStorage.getItem('onyx:vault:clear-epoch')).toBe('0');
      expect(localStorage.getItem('onyx:vault:clear-pending')).toBeNull();
      expect((await loadRecent('#recovered')).map((row) => row.id)).toEqual(['after-recovery']);
    });

    it('fails closed when a synchronous epoch ahead of IndexedDB has no provisional proof', async () => {
      await loadOutbox();
      localStorage.setItem('onyx:vault:clear-epoch', '1');
      _resetVaultForTests();

      expect(await saveMessages('#unproven', [msg('must-not-write', 1000)])).toBe(false);
      expect(await loadRecent('#unproven')).toEqual([]);
      expect(localStorage.getItem('onyx:vault:clear-epoch')).toBe('1');
    });

    it('keeps targets isolated from each other', async () => {
      await saveMessages('#alpha', [msg('a', 1000, { target: '#alpha' })]);
      await saveMessages('#beta', [msg('b', 2000, { target: '#beta' })]);
      expect((await loadRecent('#alpha')).map((m) => m.id)).toEqual(['a']);
      expect((await loadRecent('#beta')).map((m) => m.id)).toEqual(['b']);
    });

    it('upserts by id instead of duplicating (repeated flushes)', async () => {
      await saveMessages('#room', [msg('m1', 1000), msg('m2', 2000)]);
      await saveMessages('#room', [msg('m1', 1000), msg('m2', 2000), msg('m3', 3000)]);
      const loaded = await loadRecent('#room');
      expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('honors the limit argument, returning the newest tail', async () => {
      const msgs = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, 1000 + i));
      await saveMessages('#room', msgs);
      const loaded = await loadRecent('#room', 3);
      expect(loaded.map((m) => m.id)).toEqual(['m7', 'm8', 'm9']);
    });

    it('loads the nearest local window around a timestamp', async () => {
      await saveMessages('#room', [
        msg('m1150', Date.parse('2026-06-30T11:50:00.000Z')),
        msg('m1159', Date.parse('2026-06-30T11:59:00.000Z')),
        msg('m1202', Date.parse('2026-06-30T12:02:00.000Z')),
        msg('m1210', Date.parse('2026-06-30T12:10:00.000Z')),
        msg('m1220', Date.parse('2026-06-30T12:20:00.000Z')),
      ]);

      const loaded = await loadAround('#room', new Date('2026-06-30T12:00:00.000Z'), 3);

      expect(loaded.map((m) => m.id)).toEqual(['m1150', 'm1159', 'm1202']);
    });

    it('loadAround returns ciphertext only — never decrypted DM plaintext', async () => {
      await saveMessages('trev', [{
        ...msg('dm-cipher', Date.parse('2026-06-30T12:00:00.000Z'), {
          target: 'trev',
          text: 'ONYXDM1 opaque-ciphertext',
          encrypted: true,
        }),
        plaintext: 'must never reach IndexedDB or time-travel hydrate',
      }]);

      const loaded = await loadAround('trev', new Date('2026-06-30T12:00:00.000Z'), 5);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.text).toBe('ONYXDM1 opaque-ciphertext');
      expect(loaded[0]!.plaintext).toBeUndefined();
      expect(JSON.stringify(loaded)).not.toContain('must never reach');
    });

    it('returns [] for an unknown target', async () => {
      expect(await loadRecent('#nowhere')).toEqual([]);
    });

    it('prunes each target down to VAULT_KEEP, dropping the oldest', async () => {
      // Two overlapping saves that together exceed the cap.
      const first = Array.from({ length: 300 }, (_, i) => msg(`p${i}`, 1000 + i));
      const second = Array.from({ length: 200 }, (_, i) => msg(`p${300 + i}`, 1300 + i));
      await saveMessages('#room', first);
      await saveMessages('#room', second);
      const kept = await until(
        () => loadRecent('#room', 1000),
        (v) => v.length === VAULT_KEEP,
      );
      expect(kept.length).toBe(VAULT_KEEP);
      // The newest survive; the oldest 100 are gone.
      expect(kept[0]!.id).toBe('p100');
      expect(kept[kept.length - 1]!.id).toBe('p499');
    }, 30_000);
  });

  describe('pre-epoch (negative) timestamps', () => {
    // A pre-1970 Date carries a NEGATIVE epoch ms. Such times are reachable
    // through parseVaultExport (which accepts any valid Date) or a bogus server
    // @time tag. The stored index key is [target_key, time], so a lower bound of
    // [key, 0] would silently hide every negative-time row — invisible to loads
    // AND uncounted by the prune cursor, escaping the VAULT_KEEP bound forever.
    const PRE_EPOCH = Date.parse('1955-05-15T00:00:00.000Z'); // < 0

    it('loadRecent returns pre-1970 messages, chronological', async () => {
      await saveMessages('#room', [
        msg('old', PRE_EPOCH),
        msg('now', 1_700_000_000_000),
      ]);
      const loaded = await loadRecent('#room');
      expect(loaded.map((m) => m.id)).toEqual(['old', 'now']);
      expect(loaded[0]!.time.getTime()).toBe(PRE_EPOCH);
    });

    it('loadAround surfaces a pre-1970 message near the anchor', async () => {
      await saveMessages('#room', [
        msg('old', PRE_EPOCH),
        msg('now', 1_700_000_000_000),
      ]);
      const loaded = await loadAround('#room', new Date(PRE_EPOCH), 1);
      expect(loaded.map((m) => m.id)).toEqual(['old']);
    });

    it('prunes negative-time targets down to VAULT_KEEP (bound still holds)', async () => {
      // All rows pre-1970: before the fix they are invisible to both the load
      // cursor (→ loadRecent returns []) and the prune cursor (→ unbounded).
      const count = VAULT_KEEP + 25;
      const msgs = Array.from({ length: count }, (_, i) => msg(`n${i}`, PRE_EPOCH + i));
      await saveMessages('#room', msgs);
      const kept = await until(
        () => loadRecent('#room', 1000),
        (v) => v.length === VAULT_KEEP,
      );
      expect(kept.length).toBe(VAULT_KEEP);
      // Newest survive; the oldest 25 are pruned.
      expect(kept[0]!.id).toBe('n25');
      expect(kept[kept.length - 1]!.id).toBe(`n${count - 1}`);
    }, 30_000);
  });

  describe('searchVault', () => {
    it('searches and exports only the explicit owner namespace', async () => {
      await saveMessages('#same', [msg('alice-owned', 1000, {
        target: '#same',
        text: 'alice migration phrase',
      })], OUTBOX_OWNER);
      await saveMessages('#same', [msg('bob-owned', 2000, {
        target: '#same',
        text: 'bob migration phrase',
      })], BOB_OWNER);

      expect((await searchVault('migration', 80, OUTBOX_OWNER)).map((hit) => hit.message.id))
        .toEqual(['alice-owned']);
      expect((await readAllVaultHits(VAULT_SEARCH_SCAN_MAX, BOB_OWNER)).map((hit) => hit.message.id))
        .toEqual(['bob-owned']);
      expect((await exportVault(OUTBOX_OWNER)).targets).toMatchObject([
        { target: '#same', messages: [{ id: 'alice-owned' }] },
      ]);
    });

    beforeEach(async () => {
      await saveMessages('#alpha', [
        msg('a1', 1000, { text: 'the serpent stirs', target: '#alpha' }),
        msg('a2', 3000, { text: 'unrelated chatter', target: '#alpha' }),
      ]);
      await saveMessages('trev', [
        msg('d1', 2000, { text: 'SERPENT sighting in the DM', target: 'trev' }),
      ]);
    });

    it('matches across every target, case-insensitively, newest first', async () => {
      const hits = await searchVault('serpent');
      expect(hits.map((h) => [h.target, h.message.id])).toEqual([
        ['trev', 'd1'],
        ['#alpha', 'a1'],
      ]);
    });

    it('matches on the sender too', async () => {
      const hits = await searchVault('kain');
      expect(hits.length).toBe(3);
    });

    it('respects the limit', async () => {
      expect((await searchVault('kain', 1)).length).toBe(1);
    });

    it('skips deleted and redacted messages', async () => {
      await saveMessages('#alpha', [
        msg('a3', 4000, { text: 'serpent but deleted', deleted: true, target: '#alpha' }),
      ]);
      const hits = await searchVault('serpent');
      expect(hits.map((h) => h.message.id)).not.toContain('a3');
    });

    it('never searches ciphertext-only encrypted vault rows', async () => {
      await saveMessages('mika', [
        msg('encrypted-vault', 4500, {
          target: 'mika',
          text: 'ONYXDM1 searchable-looking-ciphertext',
          encrypted: true,
        }),
      ]);

      expect(await searchVault('searchable-looking-ciphertext')).toEqual([]);
      expect((await readAllVaultHits()).map((hit) => hit.message.id)).not.toContain(
        'encrypted-vault',
      );
    });

    it('returns [] for a blank query', async () => {
      expect(await searchVault('   ')).toEqual([]);
    });

    it('does not lowercase or scan an unbounded stored message field', async () => {
      await saveMessages('#bounded', [
        msg('inside-bound', 5000, {
          target: '#bounded',
          text: `needle ${'x'.repeat(SEARCH_CORPUS_TEXT_MAX)}`,
        }),
        msg('past-bound', 6000, {
          target: '#bounded',
          text: `${'x'.repeat(SEARCH_CORPUS_TEXT_MAX)} hidden-tail-needle`,
        }),
      ]);

      expect((await searchVault('needle')).map((hit) => hit.message.id)).toEqual(['inside-bound']);
      expect(await searchVault('hidden-tail-needle')).toEqual([]);
    });

    it('uses the global newest-first search index added by the v3 schema', async () => {
      const db = await openTestVault();
      try {
        const tx = db.transaction('messages', 'readonly');
        expect(tx.objectStore('messages').indexNames.contains('by_time')).toBe(true);
        expect(tx.objectStore('messages').indexNames.contains('by_owner_time')).toBe(true);
      } finally {
        db.close();
      }
    });

    it('migrates an existing v2 vault to the bounded global time index without data loss', async () => {
      // This describe's seed hook already opened v3; switch to a fresh factory
      // so this case can deliberately construct the legacy schema first.
      globalThis.indexedDB = new IDBFactory();
      _resetVaultForTests();
      const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('onyx-vault', 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          const messages = db.createObjectStore('messages', { keyPath: ['target_key', 'id'] });
          messages.createIndex('by_target_time', ['target_key', 'time']);
          db.createObjectStore('outbox', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = legacy.transaction('messages', 'readwrite');
        tx.objectStore('messages').put(serializeMessage(
          '#legacy',
          msg('legacy-search-row', 1234, { target: '#legacy', text: 'migrated recall' }),
        ));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      legacy.close();
      _resetVaultForTests();

      await expect(searchVault('migrated')).resolves.toMatchObject([
        { target: '#legacy', message: { id: 'legacy-search-row' } },
      ]);
      const upgraded = await openTestVault();
      try {
        const tx = upgraded.transaction('messages', 'readonly');
        expect(tx.objectStore('messages').indexNames.contains('by_time')).toBe(true);
        expect(tx.objectStore('messages').indexNames.contains('by_owner_time')).toBe(true);
      } finally {
        upgraded.close();
      }

    });

    it('upgrades v3 in place while quarantining ownerless rows from signed-in owners', async () => {
      globalThis.indexedDB = new IDBFactory();
      _resetVaultForTests();
      const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('onyx-vault', 3);
        request.onupgradeneeded = () => {
          const db = request.result;
          const messages = db.createObjectStore('messages', { keyPath: ['target_key', 'id'] });
          messages.createIndex('by_target_time', ['target_key', 'time']);
          messages.createIndex('by_time', 'time');
          db.createObjectStore('outbox', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const legacyMessage = serializeMessage(
        '#root',
        msg('same-id', 1000, { target: '#root', text: 'legacy ownerless secret' }),
      );
      const legacyOutbox = {
        id: 'legacy-outbox',
        target_key: '#root',
        target: '#root',
        text: 'held queue row',
        queued_at: 1000,
        seq: 1,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = legacy.transaction(['messages', 'outbox'], 'readwrite');
        tx.objectStore('messages').put(legacyMessage);
        tx.objectStore('outbox').put(legacyOutbox);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      legacy.close();
      _resetVaultForTests();

      await expect(loadRecent('#root', VAULT_KEEP, OUTBOX_OWNER)).resolves.toEqual([]);
      await expect(searchVault('legacy ownerless secret', 80, OUTBOX_OWNER)).resolves.toEqual([]);
      await expect(exportVault(OUTBOX_OWNER)).resolves.toMatchObject({ targets: [] });

      await saveMessages('#root', [msg('same-id', 2000, {
        target: '#root',
        text: 'Alice owned secret',
      })], OUTBOX_OWNER);
      await expect(loadRecent('#root', VAULT_KEEP, OUTBOX_OWNER)).resolves.toMatchObject([
        { id: 'same-id', text: 'Alice owned secret' },
      ]);

      const upgraded = await openTestVault();
      try {
        const tx = upgraded.transaction(['messages', 'outbox'], 'readonly');
        const messages = tx.objectStore('messages');
        expect(messages.indexNames.contains('by_owner_time')).toBe(true);
        await expect(new Promise<number>((resolve, reject) => {
          const request = messages.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })).resolves.toBe(2);
        const rawLegacy = await new Promise<unknown>((resolve, reject) => {
          const request = messages.get(['#root', 'same-id']);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        expect(rawLegacy).toMatchObject({ text: 'legacy ownerless secret' });
        expect(rawLegacy).not.toHaveProperty('owner_key');
        await expect(new Promise<number>((resolve, reject) => {
          const request = tx.objectStore('outbox').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })).resolves.toBe(1);
      } finally {
        upgraded.close();
      }

      await expect(clearVault()).resolves.toBe(true);
      const cleared = await openTestVault();
      try {
        await expect(new Promise<[number, number]>((resolve, reject) => {
          const tx = cleared.transaction(['messages', 'outbox'], 'readonly');
          const messages = tx.objectStore('messages').count();
          const outbox = tx.objectStore('outbox').count();
          tx.oncomplete = () => resolve([messages.result, outbox.result]);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })).resolves.toEqual([0, 0]);
      } finally {
        cleared.close();
      }
    });

    it('bounds a global search read before materializing an oversized multi-target vault', async () => {
      const db = await openTestVault();
      const total = VAULT_SEARCH_SCAN_MAX + 2;
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('messages', 'readwrite');
          const store = tx.objectStore('messages');
          for (let index = 0; index < total; index += 1) {
            const target = `#scan-${index}`;
            store.put(serializeMessage(target, msg(`scan-${index}`, index, { target })));
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }

      const hits = await readAllVaultHits();
      expect(hits).toHaveLength(VAULT_SEARCH_SCAN_MAX);
      expect(hits[0]?.message.id).toBe(`scan-${total - 1}`);
      expect(hits.some((hit) => hit.message.id === 'scan-0')).toBe(false);
      expect(hits.some((hit) => hit.message.id === 'scan-1')).toBe(false);
    }, 30_000);
  });

  describe('portable vault import/export', () => {
    it('exports every target chronologically without decrypted DM plaintext', async () => {
      await saveMessages('#Alpha', [
        msg('a2', 2000, { target: '#Alpha', text: 'second' }),
        msg('a1', 1000, { target: '#Alpha', text: 'first' }),
      ]);
      await saveMessages('Trev', [
        msg('d1', 1500, {
          target: 'Trev',
          encrypted: true,
          text: 'onyxdm.ciphertext',
          plaintext: 'never store this',
        }),
      ]);

      const snapshot = await exportVault();

      expect(snapshot.kind).toBe('onyx-vault');
      expect(snapshot.version).toBe(1);
      expect(snapshot.targets.map((entry) => entry.target)).toEqual(['#alpha', 'trev']);
      expect(snapshot.targets[0]!.messages.map((m) => m.id)).toEqual(['a1', 'a2']);
      expect(snapshot.targets[1]!.messages[0]).toMatchObject({
        id: 'd1',
        encrypted: true,
        text: 'onyxdm.ciphertext',
      });
      expect('plaintext' in snapshot.targets[1]!.messages[0]!).toBe(false);
    });

    it('bounds export materialization globally and keeps the newest rows', async () => {
      const db = await openTestVault();
      const total = MAX_EXPORT_TOTAL_RAW_MESSAGES + 2;
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('messages', 'readwrite');
          const store = tx.objectStore('messages');
          for (let index = 0; index < total; index += 1) {
            store.put(serializeMessage('#export', msg(`export-${index}`, index, { target: '#export' })));
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }

      const snapshot = await exportVault();
      const exported = snapshot.targets[0]!.messages;

      expect(exported).toHaveLength(MAX_EXPORT_TOTAL_RAW_MESSAGES);
      expect(exported[0]!.id).toBe('export-2');
      expect(exported.at(-1)!.id).toBe(`export-${total - 1}`);
      expect(exported.some((item) => item.id === 'export-0' || item.id === 'export-1')).toBe(false);
    }, 90_000);

    it('imports a validated JSON round trip into the local vault', async () => {
      await saveMessages('#Alpha', [msg('a1', 1000, { target: '#Alpha' })]);
      await saveMessages('Trev', [msg('d1', 2000, { target: 'Trev' })]);
      const exported = await exportVault();
      const parsed = parseVaultExport(JSON.parse(JSON.stringify(exported)));

      await clearVault();
      expect(parsed).not.toBeNull();
      const result = await importVault(parsed!);

      expect(result).toEqual({ targets: 2, messages: 2 });
      expect((await loadRecent('#alpha')).map((m) => m.id)).toEqual(['a1']);
      expect((await loadRecent('trev')).map((m) => m.id)).toEqual(['d1']);
    });

    it('imports a portable snapshot into only the explicit destination owner', async () => {
      const snapshot: VaultExportSnapshot = {
        kind: 'onyx-vault',
        version: 1,
        exportedAt: new Date().toISOString(),
        targets: [{
          target: '#private',
          messages: [msg('owned-import', 1000, { target: '#private', text: 'Alice import' })],
        }],
      };

      await expect(importVault(snapshot, OUTBOX_OWNER)).resolves.toEqual({ targets: 1, messages: 1 });
      await expect(loadRecent('#private', VAULT_KEEP, OUTBOX_OWNER)).resolves.toMatchObject([
        { id: 'owned-import', text: 'Alice import' },
      ]);
      await expect(loadRecent('#private', VAULT_KEEP, BOB_OWNER)).resolves.toEqual([]);
      await expect(exportVault(BOB_OWNER)).resolves.toMatchObject({ targets: [] });
    });

    it('stops later target writes when the captured import owner retires', async () => {
      const snapshot: VaultExportSnapshot = {
        kind: 'onyx-vault',
        version: 1,
        exportedAt: '2026-07-16T00:00:00.000Z',
        targets: [
          { target: '#first', messages: [msg('first', 1_000, { target: '#first' })] },
          { target: '#must-not-continue', messages: [msg('second', 2_000, { target: '#must-not-continue' })] },
        ],
      };
      let ownerIsCurrent = true;
      queueMicrotask(() => {
        ownerIsCurrent = false;
      });

      await expect(importVault(snapshot, OUTBOX_OWNER, {
        isCurrent: () => ownerIsCurrent,
      })).rejects.toBeInstanceOf(VaultImportOwnerChangedError);

      expect(await loadRecent('#must-not-continue', VAULT_KEEP, OUTBOX_OWNER)).toEqual([]);
    });

    it('rejects unknown portable vault documents', () => {
      expect(parseVaultExport({ kind: 'not-onyx', version: 1, targets: [] })).toBeNull();
      expect(parseVaultExport({ kind: 'onyx-vault', version: 2, targets: [] })).toBeNull();
      expect(parseVaultExport({ kind: 'onyx-vault', version: 1, targets: 'nope' })).toBeNull();
    });

    it('degrades to an empty result instead of throwing on a non-array targets', async () => {
      // Importers that bypass parseVaultExport (Discord/Slack/IRC-log converters)
      // can hand importVault an unvalidated shape. A missing/wrong `targets` must
      // NOT throw a TypeError into the UI — the vault is best-effort.
      const bad = [
        { targets: undefined },
        { targets: null },
        { targets: 'nope' },
        { targets: 42 },
        {},
        null,
        undefined,
      ] as unknown as VaultExportSnapshot[];
      for (const snapshot of bad) {
        await expect(importVault(snapshot)).resolves.toEqual({ targets: 0, messages: 0 });
      }
      expect(await loadRecent('#room')).toEqual([]);
    });

    it('skips malformed entries without throwing and still imports valid ones', async () => {
      // A hand-built snapshot with junk entries interleaved must not throw on the
      // `entry.messages.length` read; valid entries still land.
      const snapshot = {
        kind: 'onyx-vault',
        version: 1,
        exportedAt: new Date().toISOString(),
        targets: [
          null,
          { target: '#bad' },
          { target: '#bad2', messages: 'nope' },
          { target: '#good', messages: [msg('g1', 1000, { target: '#good' })] },
        ],
      } as unknown as VaultExportSnapshot;

      const result = await importVault(snapshot);
      expect(result).toEqual({ targets: 1, messages: 1 });
      expect((await loadRecent('#good')).map((m) => m.id)).toEqual(['g1']);
    });

    it('revalidates direct-import rows and reports only retention survivors', async () => {
      const rawMessages = [
        { ...msg('oversized', 1, { target: '#direct' }), text: 'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH + 1) },
        ...Array.from({ length: VAULT_KEEP + 2 }, (_, index) => (
          msg(`direct-${index}`, index + 2, { target: '#direct' })
        )),
      ];
      const snapshot = {
        kind: 'onyx-vault',
        version: 1,
        exportedAt: new Date().toISOString(),
        targets: [{ target: '#direct', messages: rawMessages }],
      } as VaultExportSnapshot;

      const result = await importVault(snapshot);
      const stored = await loadRecent('#direct');

      expect(result).toEqual({ targets: 1, messages: VAULT_KEEP });
      expect(stored).toHaveLength(VAULT_KEEP);
      expect(stored[0]!.id).toBe('direct-2');
      expect(stored.at(-1)!.id).toBe(`direct-${VAULT_KEEP + 1}`);
      expect(stored.some((item) => item.id === 'oversized')).toBe(false);
    }, 30_000);

    it('does not report imports that could not commit to IndexedDB', async () => {
      // A privacy mode / unsupported browser can remove IndexedDB after the
      // user has already selected a valid archive. The success counters must
      // describe durable rows, not merely rows we attempted to write.
      // @ts-expect-error -- deliberately removing the browser API
      delete globalThis.indexedDB;
      _resetVaultForTests();
      const snapshot: VaultExportSnapshot = {
        kind: 'onyx-vault',
        version: 1,
        exportedAt: new Date().toISOString(),
        targets: [{ target: '#room', messages: [msg('a1', 1000)] }],
      };

      await expect(importVault(snapshot)).resolves.toEqual({ targets: 0, messages: 0 });
    });
  });

  describe('outbox', () => {
    it('queues, loads oldest-first, and deletes', async () => {
      const first = await queueOwnedOutbox('#Room', 'first message');
      const second = await queueOwnedOutbox('trev', 'second message');
      expect(first?.target_key).toBe('#room');
      expect(first?.target).toBe('#Room');
      expect(first?.owner).toEqual(OUTBOX_OWNER);

      const loaded = await loadOutbox();
      expect(loaded.map((e) => e.text)).toEqual(['first message', 'second message']);

      await expect(deleteOutboxEntry(first!.id)).resolves.toBe(true);
      expect((await loadOutbox()).map((e) => e.id)).toEqual([second!.id]);
    });

    it('marks wire admission durably so a reload cannot re-send', async () => {
      const entry = await queueOwnedOutbox('#room', 'already on the wire');
      expect(entry).not.toBeNull();
      expect(entry!.wire_admitted).toBeUndefined();

      await expect(markOutboxWireAdmitted(entry!.id)).resolves.toBe(true);
      const [marked] = await loadOutbox();
      expect(marked).toMatchObject({ id: entry!.id, wire_admitted: true, text: 'already on the wire' });

      // Idempotent — a second mark must not fail or clear the flag.
      await expect(markOutboxWireAdmitted(entry!.id)).resolves.toBe(true);
      await expect(markOutboxWireAdmitted('missing-id')).resolves.toBe(false);
    });

    it('rejects new entries at the hard cap without evicting existing messages', async () => {
      await putRawOutboxRows(Array.from({ length: OUTBOX_MAX_ENTRIES - 1 }, (_, i) => ({
        id: `seed-${i}`,
        target_key: '#room',
        target: '#room',
        text: `message ${i}`,
        queued_at: 1000 + i,
        seq: i,
      })));
      const finalSlot = await queueOwnedOutbox('#room', 'fills the final slot');
      expect(finalSlot).not.toBeNull();

      const listener = vi.fn();
      subscribeOutbox(listener);
      await expect(queueOwnedOutbox('#room', 'must not displace anything')).resolves.toBeNull();

      const loaded = await loadOutbox();
      expect(loaded).toHaveLength(OUTBOX_MAX_ENTRIES);
      expect(loaded.some((entry) => entry.id === 'seed-0')).toBe(true);
      expect(loaded.some((entry) => entry.id === finalSlot!.id)).toBe(true);
      expect(loaded.some((entry) => entry.text === 'must not displace anything')).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('validates raw rows fail-closed, strips unknown fields, and orders deterministically', async () => {
      await putRawOutboxRows([
        { id: 'good', target_key: '#room', target: '#Room', text: 'keep', queued_at: 200, seq: 2, secret: 'strip-me' },
        { id: 'z', target_key: '#room', target: '#room', text: 'third', queued_at: 100, seq: 2 },
        { id: 'b', target_key: '#room', target: '#room', text: 'second', queued_at: 100, seq: 1 },
        { id: 'a', target_key: '#room', target: '#room', text: 'first', queued_at: 100, seq: 1 },
        { id: 'bad-target-key', target_key: '#elsewhere', target: '#room', text: 'drop', queued_at: 1, seq: 1 },
        { id: 'bad-target', target_key: '#room', target: '#room\r\nJOIN #other', text: 'drop', queued_at: 1, seq: 1 },
        { id: 'bad-text', target_key: '#room', target: '#room', text: 42, queued_at: 1, seq: 1 },
        { id: 'bad-time', target_key: '#room', target: '#room', text: 'drop', queued_at: Number.NaN, seq: 1 },
        { id: 'bad-seq', target_key: '#room', target: '#room', text: 'drop', queued_at: 1, seq: '1' },
      ]);

      const loaded = await loadOutbox();
      expect(loaded.map((entry) => entry.id)).toEqual(['a', 'b', 'z', 'good']);
      expect(loaded.find((entry) => entry.id === 'good')).toEqual({
        id: 'good',
        target_key: '#room',
        target: '#Room',
        text: 'keep',
        queued_at: 200,
        seq: 2,
        owner: null,
      });
      expect('secret' in (loaded.find((entry) => entry.id === 'good') as unknown as Record<string, unknown>)).toBe(false);
    });

    it('publishes metadata-only notifications after commits and supports unsubscribe', async () => {
      const throwing = vi.fn(() => {
        throw new Error('listener failure');
      });
      const heard = vi.fn();
      const stopThrowing = subscribeOutbox(throwing);
      const stopHeard = subscribeOutbox(heard);

      const first = await queueOwnedOutbox('#room', 'sensitive queued text');
      expect(first).not.toBeNull();
      expect(await loadOutbox()).toHaveLength(1); // listener failure did not undo persistence
      await deleteOutboxEntry(first!.id);
      await deleteOutboxEntry(first!.id); // deleting a missing id is not a change
      await queueOwnedOutbox('#room', 'another secret');
      await clearVault();

      expect(heard.mock.calls.map(([change]) => change)).toEqual([
        { kind: 'queued' },
        { kind: 'deleted' },
        { kind: 'queued' },
        { kind: 'cleared' },
      ]);
      expect(JSON.stringify(heard.mock.calls)).not.toContain('sensitive queued text');
      expect(JSON.stringify(heard.mock.calls)).not.toContain('another secret');
      expect(throwing).toHaveBeenCalledTimes(4);

      stopHeard();
      stopHeard(); // cleanup is idempotent
      stopThrowing();
      await queueOwnedOutbox('#room', 'after unsubscribe');
      expect(heard).toHaveBeenCalledTimes(4);
      expect(throwing).toHaveBeenCalledTimes(4);
    });

    it('clears only the committed outbox and publishes a metadata-only invalidation', async () => {
      await queueOwnedOutbox('#private', 'queued plaintext must not publish');
      await putRawOutboxRows([{
        id: 'corrupt-hidden-row',
        target_key: '#wrong',
        target: '#private',
        text: 'hidden corrupt plaintext',
        queued_at: 1,
        seq: 1,
      }]);
      await saveMessages('#private', [msg('vault-kept', Date.now())]);
      const listener = vi.fn();
      const stop = subscribeOutbox(listener);

      await expect(clearOutbox()).resolves.toBe(true);

      expect(await loadOutbox()).toEqual([]);
      expect((await loadRecent('#private')).map((message) => message.id)).toEqual(['vault-kept']);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith({ kind: 'cleared' });
      expect(JSON.stringify(listener.mock.calls)).not.toContain('plaintext');
      stop();
    });

    it('does not publish or claim an outbox clear when its transaction aborts', async () => {
      const entry = await queueOwnedOutbox('#room', 'keep after bulk clear failure');
      const listener = vi.fn();
      const stop = subscribeOutbox(listener);
      const realClear = IDBObjectStore.prototype.clear;
      vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        const request = realClear.call(this);
        if (this.name === 'outbox') this.transaction.abort();
        return request;
      });

      await expect(clearOutbox()).resolves.toBe(false);
      expect((await loadOutbox()).map((row) => row.id)).toEqual([entry!.id]);
      expect(listener).not.toHaveBeenCalled();
      stop();
    });

    it('degrades to null/[] without IndexedDB', async () => {
      // @ts-expect-error — deliberately removing the global
      delete globalThis.indexedDB;
      _resetVaultForTests();
      expect(await queueOwnedOutbox('#room', 'x')).toBeNull();
      expect(await loadOutbox()).toEqual([]);
      await expect(deleteOutboxEntry('nope')).resolves.toBe(false);
      await expect(clearOutbox()).resolves.toBe(false);
    });

    it('returns null when the outbox write transaction aborts', async () => {
      const listener = vi.fn();
      subscribeOutbox(listener);
      const realAdd = IDBObjectStore.prototype.add;
      const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        const request = key === undefined
          ? realAdd.call(this, value)
          : realAdd.call(this, value, key);
        this.transaction.abort();
        return request;
      });

      try {
        await expect(queueOwnedOutbox('#room', 'not durable')).resolves.toBeNull();
        expect(await loadOutbox()).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
      } finally {
        add.mockRestore();
      }
    });

    it('does not publish or lose the row when a delete transaction aborts', async () => {
      const entry = await queueOwnedOutbox('#room', 'keep after failed delete');
      const listener = vi.fn();
      subscribeOutbox(listener);
      const realDelete = IDBObjectStore.prototype.delete;
      const del = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
        this: IDBObjectStore,
        query: IDBValidKey | IDBKeyRange,
      ): IDBRequest<undefined> {
        const request = realDelete.call(this, query);
        this.transaction.abort();
        return request;
      });

      try {
        await expect(deleteOutboxEntry(entry!.id)).resolves.toBe(false);
        expect((await loadOutbox()).map((row) => row.id)).toEqual([entry!.id]);
        expect(listener).not.toHaveBeenCalled();
      } finally {
        del.mockRestore();
      }
    });

    it('does not publish or partially clear when the clear transaction aborts', async () => {
      const entry = await queueOwnedOutbox('#room', 'keep after failed clear');
      await saveMessages('#room', [msg('keep', 1000)]);
      const preClearIntent = beginVaultWriteIntent();
      expect(preClearIntent).not.toBeNull();
      const listener = vi.fn();
      subscribeOutbox(listener);
      const realClear = IDBObjectStore.prototype.clear;
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        const request = realClear.call(this);
        if (this.name === 'outbox') this.transaction.abort();
        return request;
      });

      try {
        await expect(clearVault()).resolves.toBe(false);
        expect((await loadOutbox()).map((row) => row.id)).toEqual([entry!.id]);
        expect((await loadRecent('#room')).map((row) => row.id)).toEqual(['keep']);
        expect(listener).not.toHaveBeenCalled();

        // Clear abort: the provisional synchronous fence is reconciled to the
        // unchanged durable epoch. The old intent is still revoked, while a
        // genuinely new post-abort intent can make progress.
        expect(await reserveVaultWrite(preClearIntent!)).toBeNull();
        const freshIntent = beginVaultWriteIntent();
        const freshReservation = await reserveVaultWrite(freshIntent!);
        expect(freshReservation).not.toBeNull();
        expect(await saveMessages(
          '#fresh',
          [msg('after-abort', 2000, { target: '#fresh' })],
          undefined,
          freshReservation!.eraseEpoch,
          freshReservation!,
        )).toBe(true);
        expect((await loadRecent('#fresh')).map((row) => row.id)).toEqual(['after-abort']);
      } finally {
        clear.mockRestore();
      }
    });

    it('does not reuse an intent created during an aborted clear when the epoch repeats', async () => {
      let duringAbortedClear: ReturnType<typeof beginVaultWriteIntent> = null;
      const realClear = IDBObjectStore.prototype.clear;
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        const request = realClear.call(this);
        if (this.name === 'outbox') {
          // Register after this clear's synchronous fence but before its IDB
          // transaction aborts. A later clear reuses numeric epoch one, so the
          // opaque fence nonce is what must keep this intent from resurfacing.
          duringAbortedClear = beginVaultWriteIntent();
          this.transaction.abort();
        }
        return request;
      });

      try {
        await expect(clearVault()).resolves.toBe(false);
        expect(duringAbortedClear).not.toBeNull();
      } finally {
        clear.mockRestore();
      }

      expect(await clearVault()).toBe(true);
      expect(await reserveVaultWrite(duringAbortedClear!)).toBeNull();

      const freshIntent = beginVaultWriteIntent();
      const freshReservation = await reserveVaultWrite(freshIntent!);
      expect(freshReservation).not.toBeNull();
      expect(await saveMessages(
        '#fresh-after-retry',
        [msg('fresh-after-retry', 1000, { target: '#fresh-after-retry' })],
        undefined,
        freshReservation!.eraseEpoch,
        freshReservation!,
      )).toBe(true);
      expect((await loadRecent('#fresh-after-retry')).map((row) => row.id)).toEqual(['fresh-after-retry']);
    });
  });

  describe('clearVault', () => {
    it('converges concurrent clears when committed completion callbacks resolve in reverse order', async () => {
      type HeldCompletion = { release: () => void };
      const heldCompletions: HeldCompletion[] = [];
      const realClear = IDBObjectStore.prototype.clear;
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        const request = realClear.call(this);
        if (this.name !== 'messages') return request;

        const tx = this.transaction;
        let completion: IDBTransaction['oncomplete'] = null;
        Object.defineProperty(tx, 'oncomplete', {
          configurable: true,
          enumerable: true,
          get: () => {
            const callback = completion;
            return callback
              ? (event: Event) => {
                heldCompletions.push({ release: () => callback.call(tx, event) });
              }
              : null;
          },
          set: (next: IDBTransaction['oncomplete']) => { completion = next; },
        });
        return request;
      });

      const firstClear = clearVault();
      const secondClear = clearVault();
      const currentFence = localStorage.getItem('onyx:vault:clear-fence');
      expect(currentFence).not.toBeNull();

      try {
        await until(
          async () => heldCompletions.length,
          (count) => count === 2,
        );
        expect(heldCompletions).toHaveLength(2);

        // Both durable transactions have committed, but the second promise's
        // completion callback is deliberately delivered first.
        heldCompletions[1]!.release();
        await expect(secondClear).resolves.toBe(true);
        heldCompletions[0]!.release();
        await expect(firstClear).resolves.toBe(true);
      } finally {
        clear.mockRestore();
      }

      const durableEpoch = (await readRawVaultMeta()).find((row) => row.id === 'clear-epoch')?.value;
      expect(durableEpoch).toBe(2);
      expect(localStorage.getItem('onyx:vault:clear-epoch')).toBe('2');
      expect(localStorage.getItem('onyx:vault:clear-fence')).toBe(currentFence);
      expect(localStorage.getItem('onyx:vault:clear-pending')).toBeNull();
      expect(synchronousWriteIntentKeys()).toEqual([]);
    });

    it('preserves a newer control fence interposed between completion read and mutation', async () => {
      await saveMessages('#interleave', [msg('before-interleave', 1000)]);
      const storage = window.localStorage;
      const realGet = storage.getItem.bind(storage);
      const realSet = storage.setItem.bind(storage);
      let armInterleaving = false;
      let interposed = false;
      const getItem = vi.spyOn(storage, 'getItem').mockImplementation((key) => {
        const value = realGet(key);
        if (armInterleaving && !interposed && key === 'onyx:vault:clear-fence') {
          interposed = true;
          // Model the other context committing a newer control marker after
          // this context read the old fence but before its following mutation.
          realSet('onyx:vault:clear-fence', 'newer-context-fence');
          realSet('onyx:vault:clear-epoch', '9');
          realSet('onyx:vault:clear-pending', JSON.stringify([9, 'newer-context-fence']));
          realSet(
            'onyx:vault:write-intent:newer-context',
            JSON.stringify([9, 'newer-context-fence']),
          );
        }
        return value;
      });
      const realClear = IDBObjectStore.prototype.clear;
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        const request = realClear.call(this);
        if (this.name === 'messages') armInterleaving = true;
        return request;
      });

      try {
        await expect(clearVault()).resolves.toBe(true);
      } finally {
        clear.mockRestore();
        getItem.mockRestore();
      }

      expect(interposed).toBe(true);
      expect(storage.getItem('onyx:vault:clear-fence')).toBe('newer-context-fence');
      expect(storage.getItem('onyx:vault:clear-epoch')).toBe('9');
      expect(storage.getItem('onyx:vault:clear-pending')).toBe(
        JSON.stringify([9, 'newer-context-fence']),
      );
      expect(storage.getItem('onyx:vault:write-intent:newer-context')).toBe(
        JSON.stringify([9, 'newer-context-fence']),
      );
    });

    it('resolves false when a clear-related localStorage getter or operation throws', async () => {
      const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      try {
        await expect(clearVault()).resolves.toBe(false);
      } finally {
        getter.mockRestore();
      }

      markTopicRead('#clear-storage', 'topic', { id: 'cursor', time: new Date(1_000) });
      const storage = window.localStorage;
      const realRemove = storage.removeItem.bind(storage);
      const removeItem = vi.spyOn(storage, 'removeItem').mockImplementation((key) => {
        if (key.startsWith('onyx:')) throw new DOMException('blocked', 'SecurityError');
        realRemove(key);
      });
      try {
        await expect(clearVault()).resolves.toBe(false);
      } finally {
        removeItem.mockRestore();
      }
    });

    it('does not report a verified device wipe when an available IndexedDB cannot be opened', async () => {
      const realIndexedDB = globalThis.indexedDB;
      _resetVaultForTests();
      vi.stubGlobal('indexedDB', {
        open: () => {
          throw new Error('blocked storage');
        },
      } as unknown as IDBFactory);

      try {
        await expect(clearVault()).resolves.toBe(false);
      } finally {
        vi.stubGlobal('indexedDB', realIndexedDB);
        _resetVaultForTests();
      }
    });

    it('erases every target, the outbox, and device-local topic read state', async () => {
      await saveMessages('#alpha', [msg('a', 1000)]);
      await saveMessages('#beta', [msg('b', 2000)]);
      await queueOwnedOutbox('#alpha', 'queued line');
      markTopicRead('#alpha', 'roadmap', { id: 'a', time: new Date(1000) });
      // Clear-after-write: the single IDB clear transaction owns the durable
      // linearization point and removes rows committed before it.
      await expect(clearVault()).resolves.toBe(true);
      expect(await loadRecent('#alpha')).toEqual([]);
      expect(await loadRecent('#beta')).toEqual([]);
      expect(await loadOutbox()).toEqual([]);
      expect(readTopicReadLedger()).toEqual([]);
    });

    it('does not report success when a committed clear leaves physical message rows behind', async () => {
      await saveMessages('#alpha', [msg('keep', 1000)]);
      await queueOwnedOutbox('#alpha', 'discarded independently');
      const realClear = IDBObjectStore.prototype.clear;
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
        this: IDBObjectStore,
      ): IDBRequest<undefined> {
        if (this.name === 'messages') {
          // Keep the transaction valid and committed while deliberately doing
          // no write to the message store. Post-commit physical readback must
          // catch the retained row instead of trusting transaction completion.
          return this.count() as unknown as IDBRequest<undefined>;
        }
        return realClear.call(this);
      });

      try {
        await expect(clearVault()).resolves.toBe(false);
        expect((await loadRecent('#alpha')).map((item) => item.id)).toEqual(['keep']);
        expect(await loadOutbox()).toEqual([]);
      } finally {
        clear.mockRestore();
      }
    });
  });

  describe('retention policy wiring', () => {
    it('defaults to no policy (flat VAULT_KEEP)', () => {
      expect(getRetentionPolicy()).toBeNull();
    });

    it('prunes at VAULT_KEEP identically when a null policy is set', async () => {
      // Explicitly clearing to null must reproduce today's behavior exactly.
      setRetentionPolicy(null);
      const first = Array.from({ length: 300 }, (_, i) => msg(`p${i}`, 1000 + i));
      const second = Array.from({ length: 200 }, (_, i) => msg(`p${300 + i}`, 1300 + i));
      await saveMessages('#room', first);
      await saveMessages('#room', second);
      const kept = await until(
        () => loadRecent('#room', 1000),
        (v) => v.length === VAULT_KEEP,
      );
      expect(kept.length).toBe(VAULT_KEEP);
      expect(kept[0]!.id).toBe('p100');
      expect(kept[kept.length - 1]!.id).toBe('p499');
    }, 90_000);

    it('prunes at VAULT_KEEP identically when a default-count policy is set', async () => {
      // A policy whose keep === VAULT_KEEP and no cutoff must equal the default.
      setRetentionPolicy({ keep: VAULT_KEEP });
      const first = Array.from({ length: 300 }, (_, i) => msg(`p${i}`, 1000 + i));
      const second = Array.from({ length: 200 }, (_, i) => msg(`p${300 + i}`, 1300 + i));
      await saveMessages('#room', first);
      await saveMessages('#room', second);
      const kept = await until(
        () => loadRecent('#room', 1000),
        (v) => v.length === VAULT_KEEP,
      );
      expect(kept.length).toBe(VAULT_KEEP);
      expect(kept[0]!.id).toBe('p100');
      expect(kept[kept.length - 1]!.id).toBe('p499');
    }, 90_000);

    it('honors a per-channel keep override on the real prune path', async () => {
      // #small caps at 5; the default (VAULT_KEEP) applies to everyone else.
      setRetentionPolicy({ keep: VAULT_KEEP, perChannel: { '#small': 5 } });
      const msgs = Array.from({ length: 20 }, (_, i) => msg(`s${i}`, 1000 + i, { target: '#small' }));
      await saveMessages('#small', msgs);
      const kept = await until(
        () => loadRecent('#small', 1000),
        (v) => v.length === 5,
      );
      expect(kept.length).toBe(5);
      // The 5 newest survive; the oldest 15 are pruned.
      expect(kept[0]!.id).toBe('s15');
      expect(kept[kept.length - 1]!.id).toBe('s19');
    }, 30_000);

    it('leaves non-overridden targets at the default keep', async () => {
      setRetentionPolicy({ keep: VAULT_KEEP, perChannel: { '#small': 5 } });
      const msgs = Array.from({ length: 12 }, (_, i) => msg(`o${i}`, 1000 + i, { target: '#other' }));
      await saveMessages('#other', msgs);
      const kept = await loadRecent('#other', 1000);
      expect(kept.length).toBe(12);
    });

    it('prunes messages older than the max-age cutoff', async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const now = Date.now();
      // Keep is generous; the age cutoff (2 days) is what culls the old rows.
      setRetentionPolicy({ keep: VAULT_KEEP, maxAgeDays: 2 });
      const fresh = Array.from({ length: 4 }, (_, i) => msg(`f${i}`, now - i * 1000));
      const stale = Array.from({ length: 6 }, (_, i) => msg(`stale${i}`, now - (5 + i) * dayMs));
      await saveMessages('#aged', [...stale, ...fresh]);
      const kept = await until(
        () => loadRecent('#aged', 1000),
        (v) => v.length === 4,
      );
      expect(kept.length).toBe(4);
      // Only the fresh (within 2 days) messages remain.
      expect(kept.every((m) => m.id.startsWith('f'))).toBe(true);
    }, 30_000);

    it('immediately prunes dormant targets when a stricter policy is applied', async () => {
      await saveMessages('#dormant', Array.from(
        { length: 8 },
        (_, i) => msg(`d${i}`, 1000 + i, { target: '#dormant' }),
      ));

      await expect(applyRetentionPolicy({ keep: 2 })).resolves.toBe(true);

      expect((await loadRecent('#dormant', 100)).map((message) => message.id)).toEqual(['d6', 'd7']);
    });

    it('never writes an input batch when retention keep is zero', async () => {
      setRetentionPolicy({ keep: 0 });

      await expect(saveMessages('#none', [
        msg('n1', 1000, { target: '#none' }),
        msg('n2', 2000, { target: '#none' }),
      ])).resolves.toBe(true);

      expect(await loadRecent('#none')).toEqual([]);
    });
  });

  describe('scheduled durable claims', () => {
    const owner = { serverUrl: 'wss://example.test', identity: 'alice' } as const;
    const otherOwner = { serverUrl: 'wss://example.test', identity: 'bob' } as const;
    const row = (id = 'scheduled-1') => ({
      id,
      channel: '#room',
      text: 'hello later',
      sendAt: 1_000,
      owner,
    });

    it('migrates local rows add-only and preserves newer durable state', async () => {
      await expect(addScheduledRow({ ...row(), text: 'durable newer' })).resolves.toBe(true);
      await expect(migrateScheduledRows([row()])).resolves.toBe(true);
      const rows = await loadScheduledRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.text).toBe('durable newer');
    });

    it('fails closed on an asynchronous non-constraint add error', async () => {
      const realAdd = IDBObjectStore.prototype.add;
      const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
        if (this.name === 'scheduled') {
          const request = {
            error: new DOMException('quota', 'QuotaExceededError'),
            onsuccess: null,
            onerror: null,
          } as unknown as IDBRequest;
          queueMicrotask(() => {
            request.onerror?.call(request, new Event('error'));
          });
          return request;
        }
        return Reflect.apply(realAdd, this, args) as IDBRequest;
      });
      try {
        await expect(addScheduledRow({ ...row(), id: 'quota-add' })).resolves.toBe(false);
        await expect(migrateScheduledRows([{ ...row(), id: 'quota-reconcile' }])).resolves.toBe(false);
        expect(await loadScheduledRows()).toEqual([]);
      } finally {
        add.mockRestore();
      }
    });

    it('reopens an upgrade after the old connection releases the block', async () => {
      const old = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('onyx-vault', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('legacy');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const opening = loadOutbox();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      old.close();
      await expect(opening).resolves.toEqual([]);
      await expect(addScheduledRow({ ...row(), id: 'after-unblock' })).resolves.toBe(true);
      expect((await loadScheduledRows()).map((entry) => entry.id)).toEqual(['after-unblock']);
    });

    it('allows only one independent claimer to win the durable CAS', async () => {
      await addScheduledRow(row());
      const [first, second] = await Promise.all([
        claimScheduledRow('scheduled-1', owner, 'tab-a', 2_000),
        claimScheduledRow('scheduled-1', owner, 'tab-b', 2_000),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect((await loadScheduledRows())[0]?.claim?.token).toBe(first?.claim?.token ?? second?.claim?.token);
    });

    it('enforces scheduled capacity atomically across independent admission paths', async () => {
      const capacity = 256;
      for (let index = 0; index < capacity - 1; index += 1) {
        await expect(addScheduledRow(row(`capacity-${index}`), undefined, undefined, capacity)).resolves.toBe(true);
      }

      const results = await Promise.all([
        addScheduledRow(row('capacity-a'), undefined, undefined, capacity),
        addScheduledRow(row('capacity-b'), undefined, undefined, capacity),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await loadScheduledRows()).toHaveLength(capacity);
    });

    it('cancellation tombstone wins when it races migration and blocks a stale claim', async () => {
      const stale = row('cancel-race');
      await Promise.all([
        migrateScheduledRows([stale]),
        cancelScheduledRow(stale.id, owner, 2_000),
      ]);
      expect((await loadScheduledRows()).some((candidate) => candidate.id === stale.id)).toBe(false);
      expect(await claimScheduledRow(stale.id, owner, 'late', 3_000)).toBeNull();
    });

    it('does not allow an owner switch to claim another account row', async () => {
      await addScheduledRow(row('owner-switch'));
      expect(await claimScheduledRow('owner-switch', otherOwner, 'bob', 2_000)).toBeNull();
      expect((await loadScheduledRows())[0]?.claim).toBeUndefined();
    });

    it('keeps an unknown claim visible and settles only with its token', async () => {
      await addScheduledRow(row('unknown-outcome'));
      expect(await claimScheduledRow('unknown-outcome', owner, 'crashed-tab', 2_000)).not.toBeNull();
      expect(await settleScheduledClaim('unknown-outcome', owner, 'other-token', false)).toBe(false);
      expect((await loadScheduledRows())[0]?.claim?.token).toBe('crashed-tab');
      expect(await settleScheduledClaim('unknown-outcome', owner, 'crashed-tab', false)).toBe(true);
      expect((await loadScheduledRows())[0]?.claim).toBeUndefined();
    });
  });

  describe('without IndexedDB', () => {
    it('degrades to a no-op instead of throwing', async () => {
      // Simulate a locked-down environment.
      // @ts-expect-error — deliberately removing the global
      delete globalThis.indexedDB;
      _resetVaultForTests();
      // No IndexedDB → the write cannot commit, so it reports failure (false)
      // rather than throwing; callers treat this as a non-durable no-op.
      await expect(saveMessages('#room', [msg('x', 1)])).resolves.toBe(false);
      await expect(loadRecent('#room')).resolves.toEqual([]);
      await expect(clearVault()).resolves.toBe(true);
    });
  });
});
