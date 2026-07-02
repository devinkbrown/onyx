/**
 * historyVault.test.ts — the IndexedDB persistence layer, driven by
 * fake-indexeddb. Covers serialization round-trips, per-target isolation,
 * pruning, and the "no IndexedDB at all" graceful path.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  VAULT_KEEP,
  _resetVaultForTests,
  clearVault,
  deleteOutboxEntry,
  deserializeMessage,
  loadOutbox,
  loadRecent,
  queueOutbox,
  saveMessages,
  searchVault,
  serializeMessage,
} from './historyVault';

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

describe('historyVault', () => {
  beforeEach(() => {
    // Fresh IndexedDB universe per test; reset the module's cached connection.
    globalThis.indexedDB = new IDBFactory();
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
  });

  describe('saveMessages / loadRecent', () => {
    it('persists and reloads chronologically', async () => {
      const msgs = [msg('m1', 1000), msg('m2', 2000), msg('m3', 3000)];
      await saveMessages('#Room', msgs);
      const loaded = await loadRecent('#room');
      expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
      expect(loaded[0]!.time.getTime()).toBe(1000);
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
    });
  });

  describe('searchVault', () => {
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

    it('returns [] for a blank query', async () => {
      expect(await searchVault('   ')).toEqual([]);
    });
  });

  describe('outbox', () => {
    it('queues, loads oldest-first, and deletes', async () => {
      const first = await queueOutbox('#Room', 'first message');
      const second = await queueOutbox('trev', 'second message');
      expect(first?.target_key).toBe('#room');
      expect(first?.target).toBe('#Room');

      const loaded = await loadOutbox();
      expect(loaded.map((e) => e.text)).toEqual(['first message', 'second message']);

      await deleteOutboxEntry(first!.id);
      expect((await loadOutbox()).map((e) => e.id)).toEqual([second!.id]);
    });

    it('degrades to null/[] without IndexedDB', async () => {
      // @ts-expect-error — deliberately removing the global
      delete globalThis.indexedDB;
      _resetVaultForTests();
      expect(await queueOutbox('#room', 'x')).toBeNull();
      expect(await loadOutbox()).toEqual([]);
      await expect(deleteOutboxEntry('nope')).resolves.toBeUndefined();
    });
  });

  describe('clearVault', () => {
    it('erases every target and the outbox', async () => {
      await saveMessages('#alpha', [msg('a', 1000)]);
      await saveMessages('#beta', [msg('b', 2000)]);
      await queueOutbox('#alpha', 'queued line');
      await clearVault();
      expect(await loadRecent('#alpha')).toEqual([]);
      expect(await loadRecent('#beta')).toEqual([]);
      expect(await loadOutbox()).toEqual([]);
    });
  });

  describe('without IndexedDB', () => {
    it('degrades to a no-op instead of throwing', async () => {
      // Simulate a locked-down environment.
      // @ts-expect-error — deliberately removing the global
      delete globalThis.indexedDB;
      _resetVaultForTests();
      await expect(saveMessages('#room', [msg('x', 1)])).resolves.toBeUndefined();
      await expect(loadRecent('#room')).resolves.toEqual([]);
      await expect(clearVault()).resolves.toBeUndefined();
    });
  });
});
