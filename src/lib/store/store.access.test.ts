// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.access.test.ts — IRCX ACCESS LIST / ADD / DELETE fold + actions.
 *
 * Pins the Era 2 B4 room-settings contract: ACCESS roles ride 801–805, not
 * service notices alone, and only joined channels accept list state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import {
  _resetAccessListTransportForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();

function makeUser(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function channel(name: string, users: ChannelUser[] = []): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function makeClient() {
  return {
    sendRaw: vi.fn((..._args: string[]) => true),
    send: vi.fn((_line: string) => true),
    destroy: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    prefixToMode: {} as Record<string, string>,
    modeToPrefix: {} as Record<string, string>,
  };
}

function connect(room = '#room'): ReturnType<typeof makeClient> {
  const client = makeClient();
  const server: Server = {
    id: 'access-test',
    name: 'Access',
    network: 'Access',
    url: 'wss://access.test',
    icon: '',
    nick: 'me',
    account: 'alice',
    connected: true,
  };
  store.setState({
    ...initialState,
    client: client as never,
    server,
    ourNick: 'me',
    connectionStatus: 'connected',
    channels: new Map([[room.toLowerCase(), channel(room, [makeUser('me', ['o'])])]]),
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  _resetAccessListTransportForTests();
  store.setState(initialState, true);
});

afterEach(() => {
  _resetAccessListTransportForTests();
  vi.restoreAllMocks();
});

describe('ACCESS actions', () => {
  it('fetchChannelAccess sends ACCESS LIST and marks loading', () => {
    const client = connect();
    store.getState().fetchChannelAccess('#room');
    expect(client.sendRaw).toHaveBeenCalledWith('ACCESS', '#room', 'LIST');
    expect(store.getState().channelAccessLoading.has('#room')).toBe(true);
  });

  it('addChannelAccess expands bare nicks and sends optional timeout', () => {
    const client = connect();
    store.getState().addChannelAccess('#room', 'HOST', 'bob', 3600);
    expect(client.sendRaw).toHaveBeenCalledWith(
      'ACCESS',
      '#room',
      'ADD',
      'HOST',
      'bob!*@*',
      '3600',
    );
  });

  it('deleteChannelAccess sends DELETE with normalized mask', () => {
    const client = connect();
    store.getState().deleteChannelAccess('#Room', 'DENY', 'bad!*@spam.example');
    expect(client.sendRaw).toHaveBeenCalledWith(
      'ACCESS',
      '#Room',
      'DELETE',
      'DENY',
      'bad!*@spam.example',
    );
  });

  it('rejects malformed add inputs without touching the wire', () => {
    const client = connect();
    store.getState().addChannelAccess('#room', 'HOST', '!*@*', 1);
    store.getState().addChannelAccess('#room', 'HOST', 'bob', -5);
    expect(client.sendRaw).not.toHaveBeenCalled();
  });
});

describe('ACCESS numerics 801–805', () => {
  it('commits a LIST burst (803/804/805) for a joined channel', () => {
    connect();
    feed(':access.test 803 me #room :ACCESS list begins');
    feed(':access.test 804 me #room HOST bob!*@* oper 25');
    feed(':access.test 804 me #room DENY *!*@spam.example oper');
    feed(':access.test 805 me #room :End of ACCESS list');

    const entries = store.getState().channelAccess.get('#room');
    expect(entries).toEqual([
      { level: 'HOST', mask: 'bob!*@*', setBy: 'oper', duration: 25 },
      { level: 'DENY', mask: '*!*@spam.example', setBy: 'oper' },
    ]);
    expect(store.getState().channelAccessLoading.has('#room')).toBe(false);
  });

  it('ignores LIST entries for channels outside the live session', () => {
    connect('#room');
    feed(':access.test 803 me #ghost :ACCESS list begins');
    feed(':access.test 804 me #ghost HOST bob!*@* oper');
    feed(':access.test 805 me #ghost :End of ACCESS list');

    expect(store.getState().channelAccess.has('#ghost')).toBe(false);
  });

  it('applies 801 ADD and 802 DELETE onto the committed list', () => {
    connect();
    store.getState().setChannelAccess('#room', [
      { level: 'VOICE', mask: 'carol!*@*' },
    ]);

    feed(':access.test 801 me #room HOST bob!*@* :ACCESS entry added');
    expect(store.getState().channelAccess.get('#room')).toEqual(
      expect.arrayContaining([
        { level: 'VOICE', mask: 'carol!*@*' },
        { level: 'HOST', mask: 'bob!*@*' },
      ]),
    );

    feed(':access.test 802 me #room VOICE carol!*@* :ACCESS entry deleted');
    expect(store.getState().channelAccess.get('#room')).toEqual([
      { level: 'HOST', mask: 'bob!*@*' },
    ]);
  });

  it('clears incomplete LIST buffers across account-bound reset', () => {
    connect();
    feed(':access.test 803 me #room :ACCESS list begins');
    feed(':access.test 804 me #room HOST stale!*@* oper');
    // Account change clears transport + channelAccess maps.
    feed(':me!user@host ACCOUNT bob');

    expect(store.getState().channelAccess.size).toBe(0);
    expect(store.getState().channelAccessLoading.size).toBe(0);

    // A lone 805 after reset must not resurrect the stale buffer entry.
    connect();
    feed(':access.test 805 me #room :End of ACCESS list');
    expect(store.getState().channelAccess.get('#room')).toEqual([]);
  });

  it('bounds setChannelAccess at the protocol entry cap', () => {
    connect();
    const oversized = Array.from({ length: 300 }, (_, i) => ({
      level: 'VOICE' as const,
      mask: `u${i}!*@*`,
    }));
    store.getState().setChannelAccess('#room', oversized);
    expect(store.getState().channelAccess.get('#room')).toHaveLength(256);
  });

  it('drops ACCESS state when we PART the channel', () => {
    connect();
    store.getState().setChannelAccess('#room', [
      { level: 'HOST', mask: 'bob!*@*' },
    ]);
    store.setState({
      channelAccessLoading: new Set(['#room']),
    });
    feed(':access.test 803 me #room :ACCESS list begins');
    feed(':access.test 804 me #room DENY *!*@spam.example oper');

    feed(':me!u@h PART #room :bye');

    expect(store.getState().channels.has('#room')).toBe(false);
    expect(store.getState().channelAccess.has('#room')).toBe(false);
    expect(store.getState().channelAccessLoading.has('#room')).toBe(false);

    // A late 805 after PART must not resurrect the buffered DENY entry.
    feed(':access.test 805 me #room :End of ACCESS list');
    expect(store.getState().channelAccess.has('#room')).toBe(false);
  });
});
