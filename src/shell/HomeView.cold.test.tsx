// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.cold.test.tsx — vault-first / cold-return Home paint.
 *
 * While reconnecting (or otherwise not fully connected), Home must still paint
 * catch-up from local store buffers and Device memory from the vault when data
 * is already on this device. Never invent server unreads.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { saveMessages, _resetVaultForTests } from '@/lib/vault/historyVault';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

const OWNER = {
  serverUrl: 'wss://example.test',
  identity: 'me',
} as const;

const server = {
  id: 'home-cold',
  name: 'Onyx',
  network: 'Onyx',
  url: OWNER.serverUrl,
  icon: '',
  nick: 'me',
  account: 'me',
  connected: false,
};

function makeChannel(name: string, unread: number, highlights: number): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set() });
  return {
    name,
    topic: '',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread,
    highlights,
    createdAt: null,
    messages: [],
  };
}

function makeMsg(
  id: string,
  from: string,
  text: string,
  time: Date,
): ChatMessage {
  return {
    id,
    time,
    from,
    text,
    type: 'msg',
    target: '#archive',
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetVaultForTests();
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
  _resetVaultForTests();
});

describe('HomeView — cold / vault-first paint', () => {
  it('paints catch-up from local buffers while reconnecting (before network)', async () => {
    const channels = new Map<string, Channel>();
    channels.set('#ops', makeChannel('#ops', 4, 1));
    store.setState(
      {
        ...initialState,
        channels,
        ourNick: 'me',
        connectionStatus: 'reconnecting',
        autoReconnect: true,
        activeView: { kind: 'home' },
        server,
        firstUnreadId: new Map([['#ops', 'ops-1']]),
      },
      true,
    );

    render(() => <HomeView />);

    expect(
      screen.getByRole('region', { name: 'Catch up on what you missed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open #ops at your first unread message, 4 unread, 1 mention/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Explore' })).not.toBeInTheDocument();
    expect(screen.getByText(/On this device:/i)).toBeInTheDocument();
  });

  it('paints Device memory from vault auto-join targets before rooms are live', async () => {
    setPreference('localHistory', true);
    await saveMessages(
      '#archive',
      [
        makeMsg('a-1', 'alice', 'cold vault line', new Date('2026-07-18T12:00:00.000Z')),
        makeMsg('a-2', 'bob', 'newest remembered line', new Date('2026-07-18T13:00:00.000Z')),
      ],
      OWNER,
    );

    store.setState(
      {
        ...initialState,
        channels: new Map(),
        // Cold reload: join history is empty; auto-join is the durable source.
        joinHistory: [],
        autoJoinChannels: ['#archive'],
        ourNick: 'me',
        connectionStatus: 'reconnecting',
        autoReconnect: true,
        activeView: { kind: 'home' },
        server,
      },
      true,
    );

    render(() => <HomeView />);

    await waitFor(() => {
      const memory = document.querySelector('[data-home-stratum="memory"]');
      expect(memory).not.toBeNull();
      expect(memory).toHaveAttribute('aria-label', 'Device-local catch-up');
      expect(
        screen.getByRole('button', {
          name: /Open #archive from this device, 2 remembered messages/,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/newest remembered line/)).toBeInTheDocument();
    });
  });

  it('does not invent catch-up when the store has no rooms yet', () => {
    store.setState(
      {
        ...initialState,
        channels: new Map(),
        dms: new Map(),
        ourNick: 'me',
        connectionStatus: 'reconnecting',
        autoReconnect: true,
        activeView: { kind: 'home' },
        server,
      },
      true,
    );

    render(() => <HomeView />);

    expect(
      screen.queryByRole('region', { name: 'Catch up on what you missed' }),
    ).not.toBeInTheDocument();
  });
});
