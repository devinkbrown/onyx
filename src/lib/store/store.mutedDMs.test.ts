// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { MUTED_DMS_STORAGE_KEY } from '@/lib/mutedDMs';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://mute.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'mute-test',
  name: 'Mute',
  network: 'Mute',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

describe('muted-DM actions', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({ ...initialState, server, ourNick: owner.identity, mutedDMs: new Set() }, true);
  });

  it('normalizes, persists, and removes only the active owner entries', () => {
    store.getState().muteDM('  TroubleMaker ');
    store.getState().muteDM('troublemaker');

    expect(store.getState().mutedDMs).toEqual(new Set(['troublemaker']));
    const key = deviceMemoryStorageKey(MUTED_DMS_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['troublemaker']);

    store.getState().unmuteDM('TROUBLEMAKER');
    expect(store.getState().mutedDMs).toEqual(new Set());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('fails closed without a server identity', () => {
    store.setState({ server: null, mutedDMs: new Set() });
    store.getState().muteDM('must-not-persist');

    expect(store.getState().mutedDMs).toEqual(new Set());
    expect(localStorage.length).toBe(0);
  });
});
