// SPDX-License-Identifier: AGPL-3.0-or-later
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
  exportVault,
  getRetentionPolicy,
  importVault,
  loadAround,
  loadOutbox,
  loadRecent,
  parseVaultExport,
  queueOutbox,
  saveMessages,
  searchVault,
  serializeMessage,
  setRetentionPolicy,
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
          text: 'tsumugi.ciphertext',
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
        text: 'tsumugi.ciphertext',
      });
      expect('plaintext' in snapshot.targets[1]!.messages[0]!).toBe(false);
    });

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

    it('rejects unknown portable vault documents', () => {
      expect(parseVaultExport({ kind: 'not-onyx', version: 1, targets: [] })).toBeNull();
      expect(parseVaultExport({ kind: 'onyx-vault', version: 2, targets: [] })).toBeNull();
      expect(parseVaultExport({ kind: 'onyx-vault', version: 1, targets: 'nope' })).toBeNull();
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
    }, 30_000);

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
    }, 30_000);

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
