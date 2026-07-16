// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { IGNORED_USERS_STORAGE_KEY } from '@/lib/ignoredUsers';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://ignore.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'ignore-test',
  name: 'Ignore',
  network: 'Ignore',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

describe('ignored-user actions', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({ ...initialState, server, ourNick: owner.identity, ignoredUsers: new Set() }, true);
  });

  it('normalizes, persists, and removes only the active owner entries', () => {
    store.getState().ignoreUser('  TroubleMaker ');
    store.getState().ignoreUser('troublemaker');

    expect(store.getState().ignoredUsers).toEqual(new Set(['troublemaker']));
    const key = deviceMemoryStorageKey(IGNORED_USERS_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['troublemaker']);

    store.getState().unignoreUser('TROUBLEMAKER');
    expect(store.getState().ignoredUsers).toEqual(new Set());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('fails closed without a server identity', () => {
    store.setState({ server: null, ignoredUsers: new Set() });
    store.getState().ignoreUser('must-not-persist');

    expect(store.getState().ignoredUsers).toEqual(new Set());
    expect(localStorage.length).toBe(0);
  });
});
