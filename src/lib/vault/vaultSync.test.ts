// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * vaultSync.test.ts — the store ⇄ vault wiring.
 *
 * Uses the REAL zustand store (reset between tests) and fake-indexeddb.
 * Verifies: hydration prepends vaulted history into a fresh buffer, buffer
 * changes flush to the vault after the debounce, and the preference gate
 * stops both directions.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import * as vault from './historyVault';
import {
  VAULT_SYNC_TARGET_CACHE_CAP,
  _resetVaultSyncForTests,
  _vaultSyncCacheSizesForTests,
  initVaultSync,
} from './vaultSync';

const { _resetVaultForTests, loadRecent, saveMessages, searchVault } = vault;

const initialState = store.getInitialState();
const ALICE_OWNER = { serverUrl: 'wss://example.test', identity: 'alice' } as const;
const BOB_OWNER = { serverUrl: 'wss://example.test', identity: 'bob' } as const;

function server(account: string) {
  return {
    id: `vault-sync-${account}`,
    name: 'Onyx',
    network: 'Onyx',
    url: ALICE_OWNER.serverUrl,
    icon: '',
    nick: account,
    account,
    connected: true,
  };
}

const saveOwnedMessages = (target: string, messages: readonly ChatMessage[]) =>
  saveMessages(target, messages, ALICE_OWNER);
const loadOwnedRecent = (target: string) => loadRecent(target, undefined, ALICE_OWNER);
const searchOwnedVault = (query: string) => searchVault(query, 80, ALICE_OWNER);

function msg(id: string, time: number, target = '#room'): ChatMessage {
  return { id, time: new Date(time), from: 'kain', text: `hi ${id}`, type: 'msg', target };
}

function makeChannel(name: string, messages: ChatMessage[] = []): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

function setChannel(name: string, messages: ChatMessage[] = []): void {
  const channels = new Map(store.getState().channels);
  channels.set(name.toLowerCase(), makeChannel(name, messages));
  store.setState({ channels });
}

/** Poll until the predicate holds — vault I/O is genuinely async. */
async function until(ok: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('vaultSync', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    resetPreferences();
    _resetVaultForTests();
    _resetVaultSyncForTests();
    store.setState({
      ...initialState,
      ourNick: 'alice',
      server: server('alice'),
    }, true);
  });

  afterEach(() => {
    _resetVaultSyncForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates a fresh channel buffer from the vault', async () => {
    await saveOwnedMessages('#room', [msg('v1', 1000), msg('v2', 2000)]);

    initVaultSync();
    setChannel('#room', []); // joining: empty buffer appears

    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 2);
    const buf = store.getState().channels.get('#room')!.messages;
    expect(buf.map((m) => m.id)).toEqual(['v1', 'v2']);
  });

  it('never hydrates ownerless legacy rows into a signed-in session', async () => {
    await saveMessages('#room', [msg('legacy-secret', 1000)]);

    initVaultSync();
    setChannel('#room', []);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.getState().channels.get('#room')?.messages).toEqual([]);
    expect(await loadOwnedRecent('#room')).toEqual([]);
  });

  it('drops a stale Alice hydration for Bob and retries when Alice returns', async () => {
    await saveOwnedMessages('#room', [msg('alice-owned', 1000)]);
    let resolveAlice: (messages: ChatMessage[]) => void = () => {};
    const pendingAlice = new Promise<ChatMessage[]>((resolve) => {
      resolveAlice = resolve;
    });
    vi.spyOn(vault, 'loadRecent').mockImplementationOnce(() => pendingAlice);

    initVaultSync();
    setChannel('#room', []);
    store.setState({ ourNick: 'bob', server: server('bob') });
    setChannel('#room', []);
    expect(_vaultSyncCacheSizesForTests().hydrated).toBe(1);
    resolveAlice([msg('alice-owned', 1000)]);
    await pendingAlice;
    await Promise.resolve();

    expect(store.getState().channels.get('#room')?.messages).toEqual([]);

    store.setState({ ourNick: 'alice', server: server('alice') });
    setChannel('#room', []);
    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 1);

    expect(store.getState().channels.get('#room')?.messages.map((message) => message.id))
      .toEqual(['alice-owned']);
  });

  it('releases closed-room cache keys while leaving their persisted history intact', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#closed', [msg('remembered', 1000, '#closed')]);
    expect(_vaultSyncCacheSizesForTests()).toEqual({ hydrated: 1, persisted: 0, pending: 1 });

    await vi.advanceTimersByTimeAsync(1600);
    expect(_vaultSyncCacheSizesForTests()).toEqual({ hydrated: 1, persisted: 1, pending: 0 });

    store.setState({ channels: new Map() });
    expect(_vaultSyncCacheSizesForTests()).toEqual({ hydrated: 0, persisted: 0, pending: 0 });
    vi.useRealTimers();
    expect((await loadOwnedRecent('#closed')).map((message) => message.id)).toEqual(['remembered']);
  });

  it('hard-bounds live hydration and persistence watermarks', async () => {
    vi.spyOn(vault, 'loadRecent').mockResolvedValue([]);
    vi.spyOn(vault, 'saveMessages').mockResolvedValue(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();

    const channels = new Map<string, Channel>();
    for (let index = 0; index <= VAULT_SYNC_TARGET_CACHE_CAP; index += 1) {
      const name = `#bounded-${index}`;
      channels.set(name, makeChannel(name, [msg(`m-${index}`, index, name)]));
    }
    store.setState({ channels });
    expect(_vaultSyncCacheSizesForTests().hydrated).toBe(VAULT_SYNC_TARGET_CACHE_CAP);

    await vi.advanceTimersByTimeAsync(1600);
    expect(_vaultSyncCacheSizesForTests().persisted).toBe(VAULT_SYNC_TARGET_CACHE_CAP);
    expect(_vaultSyncCacheSizesForTests().pending).toBe(0);
  });

  it('merges hydration UNDER live messages without duplicating ids', async () => {
    await saveOwnedMessages('#room', [msg('v1', 1000), msg('live1', 2000)]);

    initVaultSync();
    // The server already replayed 'live1' before hydration finished.
    setChannel('#room', [msg('live1', 2000), msg('live2', 3000)]);

    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 3);
    const buf = store.getState().channels.get('#room')!.messages;
    expect(buf.map((m) => m.id)).toEqual(['v1', 'live1', 'live2']);
  });

  it('flushes buffer changes to the vault after the debounce', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#room', [msg('m1', 1000), msg('m2', 2000)]);

    vi.advanceTimersByTime(1600); // past FLUSH_MS
    vi.useRealTimers();

    await until(async () => (await loadOwnedRecent('#room')).length === 2);
    expect((await loadOwnedRecent('#room')).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('persists each account buffer only inside its captured owner namespace', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#room', [msg('alice-row', 1000)]);
    await vi.advanceTimersByTimeAsync(1600);

    store.setState({ ourNick: 'bob', server: server('bob') });
    setChannel('#room', [msg('bob-row', 2000)]);
    await vi.advanceTimersByTimeAsync(1600);
    vi.useRealTimers();

    expect((await loadRecent('#room', undefined, ALICE_OWNER)).map((message) => message.id))
      .toEqual(['alice-row']);
    expect((await loadRecent('#room', undefined, BOB_OWNER)).map((message) => message.id))
      .toEqual(['bob-row']);
    expect(await loadRecent('#room')).toEqual([]);
  });

  it('retries the tail after a failed write instead of dropping it forever', async () => {
    // The persisted-tail watermark must NOT advance durably on a failed write.
    // First flush fails (quota/private-mode); the identical tail must still be
    // written on the next store change rather than being silently skipped.
    const spy = vi.spyOn(vault, 'saveMessages').mockResolvedValueOnce(false);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#room', [msg('m1', 1000)]);
    await vi.advanceTimersByTimeAsync(1600); // first flush → forced failure

    expect(spy).toHaveBeenCalledTimes(1);
    expect(await loadOwnedRecent('#room')).toEqual([]); // nothing landed

    // A later store update with the SAME tail id must re-attempt the write.
    setChannel('#room', [msg('m1', 1000)]);
    await vi.advanceTimersByTimeAsync(1600); // second flush → real write
    vi.useRealTimers();

    await until(async () => (await loadOwnedRecent('#room')).length === 1);
    expect((await loadOwnedRecent('#room')).map((m) => m.id)).toEqual(['m1']);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('coalesces an unchanged tail to a single successful write (no rewrite churn)', async () => {
    const spy = vi.spyOn(vault, 'saveMessages');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#room', [msg('m1', 1000)]);
    await vi.advanceTimersByTimeAsync(1600); // one durable write
    // Same tail arrives again (e.g. an unrelated buffer field changed).
    setChannel('#room', [msg('m1', 1000)]);
    await vi.advanceTimersByTimeAsync(1600);
    vi.useRealTimers();

    await until(async () => (await loadOwnedRecent('#room')).length === 1);
    expect(spy).toHaveBeenCalledTimes(1); // the second, redundant flush is skipped
  });

  it('does nothing in either direction when localHistory is off', async () => {
    await saveOwnedMessages('#room', [msg('v1', 1000)]);
    setPreference('localHistory', false);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();
    setChannel('#room', [msg('m1', 5000)]);
    vi.advanceTimersByTime(1600);
    vi.useRealTimers();

    // No hydration in...
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getState().channels.get('#room')!.messages.map((m) => m.id)).toEqual(['m1']);
    // ...and no persistence out.
    expect((await loadOwnedRecent('#room')).map((m) => m.id)).toEqual(['v1']);
  });

  it('never persists an optimistic outbox placeholder — no stuck-pending ghost', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();

    // Offline: the store holds an optimistic outbox placeholder.
    const placeholder: ChatMessage = {
      id: 'outbox:42',
      time: new Date(1000),
      from: 'kain',
      text: 'sent while offline',
      type: 'msg',
      target: '#room',
      pending: true,
    };
    setChannel('#room', [placeholder]);
    await vi.advanceTimersByTimeAsync(1600);

    // The placeholder must NOT have landed in the vault.
    expect(await loadOwnedRecent('#room')).toEqual([]);

    // Reconnect: flushOutbox drops the placeholder and the real message arrives
    // under a fresh server uid.
    const delivered = msg('srv-99', 1000);
    delivered.text = 'sent while offline';
    setChannel('#room', [delivered]);
    await vi.advanceTimersByTimeAsync(1600);
    vi.useRealTimers();

    await until(async () => (await loadOwnedRecent('#room')).length === 1);
    const rows = await loadOwnedRecent('#room');
    // Exactly one row — the delivered message — and no `outbox:` ghost.
    expect(rows.map((m) => m.id)).toEqual(['srv-99']);
    expect(rows.some((m) => m.id.startsWith('outbox:') || m.pending)).toBe(false);
  });

  it('makes an in-place redaction durable so search no longer surfaces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    initVaultSync();

    const original = msg('m1', 1000);
    original.text = 'secret plans at dawn';
    setChannel('#room', [original]);
    await vi.advanceTimersByTimeAsync(1600); // durable un-redacted row

    // The un-redacted content is searchable at this point.
    expect((await searchOwnedVault('secret plans')).length).toBe(1);

    // Redact IN PLACE: same id, new object, redacted text — the tail id is
    // unchanged, so only a content-signature watermark re-flushes it.
    const redacted: ChatMessage = { ...original, text: '[Message deleted]', redacted: true };
    setChannel('#room', [redacted]);
    await vi.advanceTimersByTimeAsync(1600);
    vi.useRealTimers();

    // The stored row is now the redacted one, and search skips it entirely.
    await until(async () => (await searchOwnedVault('secret plans')).length === 0);
    expect(await searchOwnedVault('secret plans')).toEqual([]);
    const rows = await loadOwnedRecent('#room');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.redacted).toBe(true);
    expect(rows[0]!.text).toBe('[Message deleted]');
  });

  it('hydrates DM buffers too', async () => {
    await saveOwnedMessages('trev', [msg('d1', 1000, 'trev')]);

    initVaultSync();
    const dms = new Map(store.getState().dms);
    dms.set('trev', { nick: 'trev', account: null, unread: 0, highlights: 0, messages: [] });
    store.setState({ dms });

    await until(() => (store.getState().dms.get('trev')?.messages.length ?? 0) === 1);
    expect(store.getState().dms.get('trev')!.messages[0]!.id).toBe('d1');
  });
});
