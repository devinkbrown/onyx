// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOKMARKS_STORAGE_KEY,
  loadBookmarks,
  saveBookmarks,
} from '@/lib/bookmarks';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { parseIRCMessage } from '@/lib/irc/parser';
import type { ChatMessage } from '@/lib/irc/types';
import { _resetVaultForTests, clearVault } from '@/lib/vault/historyVault';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://bookmarks.example/ws';

function server(account: string | null, nick = account ?? 'guest42'): Server {
  return {
    id: 'bookmarks-test',
    name: 'Bookmarks',
    network: 'Bookmarks',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function bookmark(id: string, text = `${id} private text`): ChatMessage {
  return {
    id,
    time: new Date('2026-07-16T12:00:00.000Z'),
    from: 'trev',
    text,
    type: 'msg',
    target: '#private',
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('private bookmark ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetVaultForTests();
    store.setState(initialState, true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetVaultForTests();
  });

  it('fails closed without an owner and never writes ownerless plaintext', () => {
    store.setState({ server: null, ourNick: '', bookmarks: [] });
    store.getState().addBookmark(bookmark('private'));

    expect(store.getState().bookmarks).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('persists only a sanitized snapshot for the active owner', () => {
    const alice = { serverUrl, identity: 'alice' } as const;
    store.setState({ server: server('alice'), ourNick: 'alice', bookmarks: [] });
    store.getState().addBookmark({
      ...bookmark('encrypted', 'ONYXDM1 bookmark-ciphertext'),
      encrypted: true,
      plaintext: 'bookmark decrypted plaintext',
      replyTo: { id: 'reply', from: 'trev', text: 'bookmark decrypted reply' },
    });

    expect(store.getState().bookmarks[0]).not.toHaveProperty('plaintext');
    const raw = localStorage.getItem(deviceMemoryStorageKey(BOOKMARKS_STORAGE_KEY, alice)!) ?? '';
    expect(raw).toContain('bookmark-ciphertext');
    expect(raw).not.toContain('bookmark decrypted plaintext');
    expect(raw).not.toContain('bookmark decrypted reply');

    store.getState().removeBookmark('encrypted');
    expect(loadBookmarks(alice)).toEqual([]);
  });

  it('hydrates Bob and guest bookmarks on 900/901 without carrying Alice text', () => {
    const bob = { serverUrl, identity: 'bob' } as const;
    const guest = { serverUrl, identity: 'guest42' } as const;
    saveBookmarks([bookmark('bob-private')], bob);
    saveBookmarks([bookmark('guest-private')], guest);
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      bookmarks: [bookmark('alice-private')],
      showBookmarks: true,
    });

    feed(':bookmarks.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['bob-private']);
    expect(store.getState().showBookmarks).toBe(false);

    store.setState({ server: server('bob', 'guest42'), ourNick: 'guest42' });
    feed(':bookmarks.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['guest-private']);
  });

  it('replaces guest bookmarks on ordinary NICK and ACCOUNT owner changes', () => {
    const mika = { serverUrl, identity: 'mika' } as const;
    const bob = { serverUrl, identity: 'bob' } as const;
    saveBookmarks([bookmark('mika-private')], mika);
    saveBookmarks([bookmark('bob-private')], bob);
    store.setState({
      server: server(null, 'kain'),
      ourNick: 'kain',
      bookmarks: [bookmark('kain-private')],
    });

    feed(':kain!webchat@example NICK mika');
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['mika-private']);

    feed(':mika!webchat@example ACCOUNT bob');
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['bob-private']);
  });

  it('evicts all live transcript snapshots only after a verified history clear', async () => {
    const privateBookmark = bookmark('live-private');
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      bookmarks: [privateBookmark],
      showBookmarks: true,
      dmPinnedMessages: new Map([['trev', [privateBookmark]]]),
      showDMPins: true,
      dmPinsNick: 'trev',
      topicHistory: { '#private': ['private topic'] },
    });
    vi.stubGlobal('indexedDB', undefined);

    await expect(clearVault()).resolves.toBe(true);
    expect(store.getState()).toMatchObject({
      bookmarks: [],
      showBookmarks: false,
      dmPinnedMessages: new Map(),
      showDMPins: false,
      dmPinsNick: null,
      topicHistory: {},
    });
  });

  it('retains live transcript snapshots when the physical history clear cannot verify', async () => {
    const privateBookmark = bookmark('must-remain-on-failure');
    store.setState({
      bookmarks: [privateBookmark],
      showBookmarks: true,
      dmPinnedMessages: new Map([['trev', [privateBookmark]]]),
      showDMPins: true,
      dmPinsNick: 'trev',
      topicHistory: { '#private': ['must remain'] },
    });
    vi.stubGlobal('indexedDB', {
      open: () => { throw new Error('blocked'); },
    } as unknown as IDBFactory);

    await expect(clearVault()).resolves.toBe(false);
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['must-remain-on-failure']);
    expect(store.getState().showBookmarks).toBe(true);
    expect(store.getState().dmPinnedMessages.has('trev')).toBe(true);
    expect(store.getState().showDMPins).toBe(true);
    expect(store.getState().dmPinsNick).toBe('trev');
    expect(store.getState().topicHistory).toEqual({ '#private': ['must remain'] });
  });
});
