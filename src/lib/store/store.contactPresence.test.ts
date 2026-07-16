// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FRIENDS_STORAGE_KEY,
  WATCH_LIST_STORAGE_KEY,
} from '@/lib/contactPresenceMemory';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://contacts.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'contacts-test',
  name: 'Contacts',
  network: 'Contacts',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

function client() {
  return { sendRaw: vi.fn() };
}

describe('friend and WATCH actions', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({
      ...initialState,
      server,
      ourNick: owner.identity,
      connectionStatus: 'connected',
      friends: new Map(),
      watchList: [],
      monitoredNicks: new Set(),
    }, true);
  });

  it('persists the active owner and shares one MONITOR subscription per nick', () => {
    const irc = client();
    store.setState({ client: irc as never });

    store.getState().addFriend(' AliceContact ');
    store.getState().addToWatchList('alicecontact');

    expect([...store.getState().friends.keys()]).toEqual(['alicecontact']);
    expect(store.getState().watchList).toEqual([{ nick: 'alicecontact', online: false }]);
    expect(store.getState().monitoredNicks).toEqual(new Set(['alicecontact']));
    expect(irc.sendRaw).toHaveBeenCalledTimes(1);
    expect(irc.sendRaw).toHaveBeenCalledWith('MONITOR', '+', 'AliceContact');

    const friendsKey = deviceMemoryStorageKey(FRIENDS_STORAGE_KEY, owner)!;
    const watchKey = deviceMemoryStorageKey(WATCH_LIST_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(friendsKey) ?? '[]')).toEqual([{ nick: 'AliceContact' }]);
    expect(JSON.parse(localStorage.getItem(watchKey) ?? '[]')).toEqual([
      { nick: 'alicecontact', online: false },
    ]);

    store.getState().removeFriend('alicecontact');
    expect(irc.sendRaw).toHaveBeenCalledTimes(1);
    store.getState().removeFromWatchList('alicecontact');
    expect(irc.sendRaw).toHaveBeenLastCalledWith('MONITOR', '-', 'alicecontact');
    expect(store.getState().monitoredNicks).toEqual(new Set());
    expect(localStorage.getItem(friendsKey)).toBeNull();
    expect(localStorage.getItem(watchKey)).toBeNull();
  });

  it('fails closed without an owner and rejects wire-unsafe nicknames', () => {
    const irc = client();
    store.setState({ client: irc as never, server: null, ourNick: '' });

    store.getState().addFriend('private-contact');
    store.getState().addToWatchList('private-contact');
    store.setState({ server, ourNick: owner.identity });
    store.getState().addFriend('bad\r\nMONITOR C');
    store.getState().addToWatchList('bad,nick');

    expect(store.getState().friends).toEqual(new Map());
    expect(store.getState().watchList).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(irc.sendRaw).not.toHaveBeenCalled();
  });
});
