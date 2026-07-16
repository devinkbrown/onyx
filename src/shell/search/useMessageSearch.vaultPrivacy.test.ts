// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2EE DM server-search privacy across the vault hydration boundary.
 *
 * The physical row exists while hydration is deliberately deferred, reproducing
 * a fresh-page empty live buffer. SEARCH must fail closed while classification
 * is unknown and remain device-only when the vault proves encrypted; a fully
 * scanned plain target becomes server-searchable without waiting for hydration.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import * as vault from '@/lib/vault/historyVault';
import {
  _resetVaultDmSearchPrivacyForTests,
  getVaultDmSearchPrivacy,
} from '@/lib/vault/dmSearchPrivacy';
import { _resetVaultSyncForTests, initVaultSync } from '@/lib/vault/vaultSync';
import {
  closeMessageSearch,
  openMessageSearchWithQuery,
  useMessageSearch,
} from './useMessageSearch';

const initialState = store.getInitialState();

function message(id: string, text: string, encrypted = false): ChatMessage {
  return {
    id,
    from: 'Mika',
    text,
    target: 'Mika',
    type: 'msg',
    time: new Date('2026-07-16T08:00:00.000Z'),
    ...(encrypted ? { encrypted: true } : {}),
  };
}

function mockSearchClient() {
  const sent: string[] = [];
  return {
    sent,
    client: {
      negotiatedCaps: new Set(['draft/search']),
      capValues: new Map<string, string>(),
      isupport: { CHANTYPES: '#&' },
      sendRaw: (...parts: string[]) => sent.push(parts.join(' ')),
      send: vi.fn(),
    } as never,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for vault privacy state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('useMessageSearch vault-only DM privacy', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    resetPreferences();
    vault._resetVaultForTests();
    _resetVaultSyncForTests();
    store.setState(initialState, true);
    closeMessageSearch();
  });

  afterEach(() => {
    closeMessageSearch();
    _resetVaultSyncForTests();
    vi.restoreAllMocks();
  });

  it('never sends a query for a vault-only encrypted DM while hydration is deferred', async () => {
    const encrypted = message('cipher-1', 'TSUMUGI1 opaque-ciphertext', true);
    await vault.saveMessages('Mika', [encrypted]);
    const hydration = deferred<ChatMessage[]>();
    vi.spyOn(vault, 'loadRecent').mockImplementation(() => hydration.promise);

    // Model a reload: physical IndexedDB survives, in-memory privacy proof does not.
    _resetVaultDmSearchPrivacyForTests();
    const { client, sent } = mockSearchClient();
    store.setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      canSearchHistory: true,
      client,
      connectionStatus: 'connected',
      dms: new Map(),
      peerDmKeys: new Map(),
    });
    initVaultSync();
    store.setState({
      dms: new Map([['mika', {
        nick: 'Mika', account: null, unread: 0, highlights: 0, messages: [],
      }]]),
    });

    let dispose!: () => void;
    let search!: ReturnType<typeof useMessageSearch>;
    createRoot((cleanup) => {
      dispose = cleanup;
      search = useMessageSearch();
      openMessageSearchWithQuery('private launch phrase');
    });

    expect(getVaultDmSearchPrivacy('Mika')).toBe('unknown');
    expect(search.canServerSearch()).toBe(false);
    search.runServerSearch();
    store.getState().searchServerHistory('Mika', 'direct private phrase');
    expect(sent).toEqual([]);

    await until(() => getVaultDmSearchPrivacy('Mika') === 'encrypted');
    expect(search.serverSearchBlockedByE2ee()).toBe(true);
    expect(search.canServerSearch()).toBe(false);
    expect(sent).toEqual([]);

    hydration.resolve([encrypted]);
    await until(() => store.getState().dms.get('mika')?.messages.length === 1);
    search.runServerSearch();
    expect(sent).toEqual([]);
    dispose();
  });

  it('enables server search only after the complete vault target is proven plain', async () => {
    const plain = message('plain-1', 'ordinary remembered line');
    await vault.saveMessages('Mika', [plain]);
    const hydration = deferred<ChatMessage[]>();
    vi.spyOn(vault, 'loadRecent').mockImplementation(() => hydration.promise);

    _resetVaultDmSearchPrivacyForTests();
    const { client, sent } = mockSearchClient();
    store.setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      canSearchHistory: true,
      client,
      connectionStatus: 'connected',
      dms: new Map(),
      peerDmKeys: new Map(),
    });
    initVaultSync();
    store.setState({
      dms: new Map([['mika', {
        nick: 'Mika', account: null, unread: 0, highlights: 0, messages: [],
      }]]),
    });

    let dispose!: () => void;
    let search!: ReturnType<typeof useMessageSearch>;
    createRoot((cleanup) => {
      dispose = cleanup;
      search = useMessageSearch();
      openMessageSearchWithQuery('ordinary');
    });

    expect(getVaultDmSearchPrivacy('Mika')).toBe('unknown');
    expect(search.canServerSearch()).toBe(false);
    expect(sent).toEqual([]);

    await until(() => getVaultDmSearchPrivacy('Mika') === 'plain');
    expect(search.canServerSearch()).toBe(true);
    search.runServerSearch();
    expect(sent).toEqual(['SEARCH Mika ordinary']);

    hydration.resolve([plain]);
    dispose();
  });
});
