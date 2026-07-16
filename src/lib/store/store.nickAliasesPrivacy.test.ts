// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import {
  loadNickAliases,
  saveNickAliases,
} from '@/lib/nickAliases';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://aliases.example/ws';

function server(account: string | null, nick = account ?? 'guest42'): Server {
  return {
    id: 'aliases-test',
    name: 'Aliases',
    network: 'Aliases',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(),
    destroy: vi.fn(),
  } as never;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('private nick alias ownership and reclaim', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  afterEach(() => {
    store.getState().disconnect();
    vi.restoreAllMocks();
  });

  it('fails closed without an owner', () => {
    store.setState({ server: null, ourNick: '', nickAliases: [] });
    store.getState().setNickAliases(['PrivateFallback']);

    expect(store.getState().nickAliases).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('persists only the active owner validated aliases', () => {
    const alice = { serverUrl, identity: 'alice' } as const;
    store.setState({ server: server('alice'), ourNick: 'alice', nickAliases: [] });

    store.getState().setNickAliases([' Alice ', 'AliceAway', 'aliceaway', 'bad nick']);

    expect(store.getState().nickAliases).toEqual(['AliceAway']);
    expect(loadNickAliases(alice)).toEqual(['AliceAway']);
  });

  it('switches to Bob aliases on 900 and never tries Alice aliases for Bob reclaim', () => {
    const alice = { serverUrl, identity: 'alice' } as const;
    const bob = { serverUrl, identity: 'bob' } as const;
    saveNickAliases(['AliceAway'], alice);
    saveNickAliases(['BobAway'], bob);
    const sendRaw = vi.fn();
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      client: mockClient(sendRaw),
      nickAliases: ['AliceAway'],
      currentNickIsAlias: false,
    });

    feed(':aliases.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().nickAliases).toEqual(['BobAway']);
    expect(store.getState().currentNickIsAlias).toBe(true);
    expect(sendRaw).toHaveBeenCalledWith('NICK', 'bob');

    feed(':aliases.example 433 alice bob :Nickname is already in use');
    expect(sendRaw).toHaveBeenCalledWith('NICK', 'BobAway');
    expect(sendRaw).not.toHaveBeenCalledWith('NICK', 'AliceAway');

    feed(':alice!u@h NICK bob');
    expect(store.getState().currentNickIsAlias).toBe(false);
  });

  it('hydrates guest aliases on 901 and on an ordinary guest NICK change', () => {
    const guest42 = { serverUrl, identity: 'guest42' } as const;
    const mika = { serverUrl, identity: 'mika' } as const;
    saveNickAliases(['GuestSpare'], guest42);
    saveNickAliases(['MikaSpare'], mika);
    store.setState({
      server: server('bob', 'guest42'),
      ourNick: 'guest42',
      nickAliases: ['BobAway'],
      currentNickIsAlias: true,
    });

    feed(':aliases.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().nickAliases).toEqual(['GuestSpare']);
    expect(store.getState().currentNickIsAlias).toBe(false);

    feed(':guest42!u@h NICK mika');
    expect(store.getState().nickAliases).toEqual(['MikaSpare']);
  });
});
