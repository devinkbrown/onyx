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
import { _resetVaultSyncForTests, initVaultSync } from './vaultSync';

const { _resetVaultForTests, loadRecent, saveMessages } = vault;

const initialState = store.getInitialState();

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
    store.setState(initialState, true);
  });

  afterEach(() => {
    _resetVaultSyncForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates a fresh channel buffer from the vault', async () => {
    await saveMessages('#room', [msg('v1', 1000), msg('v2', 2000)]);

    initVaultSync();
    setChannel('#room', []); // joining: empty buffer appears

    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 2);
    const buf = store.getState().channels.get('#room')!.messages;
    expect(buf.map((m) => m.id)).toEqual(['v1', 'v2']);
  });

  it('merges hydration UNDER live messages without duplicating ids', async () => {
    await saveMessages('#room', [msg('v1', 1000), msg('live1', 2000)]);

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

    await until(async () => (await loadRecent('#room')).length === 2);
    expect((await loadRecent('#room')).map((m) => m.id)).toEqual(['m1', 'm2']);
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
    expect(await loadRecent('#room')).toEqual([]); // nothing landed

    // A later store update with the SAME tail id must re-attempt the write.
    setChannel('#room', [msg('m1', 1000)]);
    await vi.advanceTimersByTimeAsync(1600); // second flush → real write
    vi.useRealTimers();

    await until(async () => (await loadRecent('#room')).length === 1);
    expect((await loadRecent('#room')).map((m) => m.id)).toEqual(['m1']);
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

    await until(async () => (await loadRecent('#room')).length === 1);
    expect(spy).toHaveBeenCalledTimes(1); // the second, redundant flush is skipped
  });

  it('does nothing in either direction when localHistory is off', async () => {
    await saveMessages('#room', [msg('v1', 1000)]);
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
    expect((await loadRecent('#room')).map((m) => m.id)).toEqual(['v1']);
  });

  it('hydrates DM buffers too', async () => {
    await saveMessages('trev', [msg('d1', 1000, 'trev')]);

    initVaultSync();
    const dms = new Map(store.getState().dms);
    dms.set('trev', { nick: 'trev', account: null, unread: 0, highlights: 0, messages: [] });
    store.setState({ dms });

    await until(() => (store.getState().dms.get('trev')?.messages.length ?? 0) === 1);
    expect(store.getState().dms.get('trev')!.messages[0]!.id).toBe('d1');
  });
});
