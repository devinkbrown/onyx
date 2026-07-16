// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  DISPLAY_NAMES_STORAGE_KEY,
  NICK_COLORS_STORAGE_KEY,
  saveDisplayNameOverrides,
  saveNickColorOverrides,
  saveSoftIgnoreList,
  SOFT_IGNORE_STORAGE_KEY,
} from '@/lib/identityOverrides';
import { parseIRCMessage } from '@/lib/irc/parser';
import { _resetAccountReplyStateForTests, store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://identity-switch.example/ws';

function server(account: string | null, nick = account ?? 'guest42'): Server {
  return {
    id: 'identity-switch',
    name: 'Identity Switch',
    network: 'Identity Switch',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function owner(identity: string) {
  return { serverUrl, identity } as const;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function expectIdentityOverrides(
  softIgnore: string,
  colorNick: string,
  color: string,
  displayNick: string,
  displayName: string,
): void {
  const state = store.getState();
  expect(state.softIgnoreList).toEqual(new Set([softIgnore]));
  expect(state.nickColorOverrides).toEqual(new Map([[colorNick, color]]));
  expect(state.displayNameOverrides).toEqual({ [displayNick]: displayName });
}

describe('private identity override ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    _resetAccountReplyStateForTests();
  });

  it('fails closed without a server owner and sanitizes owner-scoped writes', () => {
    store.setState({ server: null, ourNick: '' });
    store.getState().toggleSoftIgnore('PrivateContact');
    store.getState().setNickColorOverride('PrivateContact', '#AABBCC');
    store.getState().setDisplayNameOverride('PrivateContact', 'Private alias');

    expect(store.getState().softIgnoreList).toEqual(new Set());
    expect(store.getState().nickColorOverrides).toEqual(new Map());
    expect(store.getState().displayNameOverrides).toEqual({});
    expect(localStorage.length).toBe(0);

    const alice = owner('alice');
    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().toggleSoftIgnore('  TrEv  ');
    store.getState().setNickColorOverride('TrEv', '#AABBCC');
    store.getState().setNickColorOverride('unsafe', 'red; background: url(https://example.test)');
    store.getState().setDisplayNameOverride('TrEv', '  Trusted teammate  ');
    store.getState().setDisplayNameOverride('bad nick', 'Must not persist');

    expectIdentityOverrides('trev', 'trev', '#aabbcc', 'trev', 'Trusted teammate');
    expect(localStorage.getItem(deviceMemoryStorageKey(SOFT_IGNORE_STORAGE_KEY, alice)!))
      .toBe('["trev"]');
    expect(localStorage.getItem(deviceMemoryStorageKey(NICK_COLORS_STORAGE_KEY, alice)!))
      .toBe('{"trev":"#aabbcc"}');
    expect(localStorage.getItem(deviceMemoryStorageKey(DISPLAY_NAMES_STORAGE_KEY, alice)!))
      .toBe('{"trev":"Trusted teammate"}');
  });

  it('reactively replaces 900, 901, NICK, and ACCOUNT owner namespaces', () => {
    expect(saveSoftIgnoreList(new Set(['bob-ignore']), owner('bob'))).not.toBeNull();
    expect(saveNickColorOverrides(new Map([['bob-color', '#112233']]), owner('bob'))).not.toBeNull();
    expect(saveDisplayNameOverrides({ 'bob-alias': 'Bob alias' }, owner('bob'))).not.toBeNull();
    expect(saveSoftIgnoreList(new Set(['guest-ignore']), owner('guest42'))).not.toBeNull();
    expect(saveNickColorOverrides(new Map([['guest-color', '#223344']]), owner('guest42'))).not.toBeNull();
    expect(saveDisplayNameOverrides({ 'guest-alias': 'Guest alias' }, owner('guest42'))).not.toBeNull();
    expect(saveSoftIgnoreList(new Set(['mika-ignore']), owner('mika'))).not.toBeNull();
    expect(saveNickColorOverrides(new Map([['mika-color', '#334455']]), owner('mika'))).not.toBeNull();
    expect(saveDisplayNameOverrides({ 'mika-alias': 'Mika alias' }, owner('mika'))).not.toBeNull();
    expect(saveSoftIgnoreList(new Set(['carol-ignore']), owner('carol'))).not.toBeNull();
    expect(saveNickColorOverrides(new Map([['carol-color', '#445566']]), owner('carol'))).not.toBeNull();
    expect(saveDisplayNameOverrides({ 'carol-alias': 'Carol alias' }, owner('carol'))).not.toBeNull();

    store.setState({
      server: server('alice', 'guest42'),
      ourNick: 'guest42',
      softIgnoreList: new Set(['alice-private-ignore']),
      nickColorOverrides: new Map([['alice-private-color', '#abcdef']]),
      displayNameOverrides: { 'alice-private-alias': 'Alice private alias' },
    });

    feed(':identity-switch.example 900 guest42 guest42!u@h bob :You are now logged in as bob');
    expectIdentityOverrides('bob-ignore', 'bob-color', '#112233', 'bob-alias', 'Bob alias');

    feed(':identity-switch.example 901 guest42 guest42!u@h :You are now logged out');
    expectIdentityOverrides('guest-ignore', 'guest-color', '#223344', 'guest-alias', 'Guest alias');

    feed(':guest42!webchat@example NICK mika');
    expectIdentityOverrides('mika-ignore', 'mika-color', '#334455', 'mika-alias', 'Mika alias');

    feed(':mika!webchat@example ACCOUNT carol');
    expectIdentityOverrides('carol-ignore', 'carol-color', '#445566', 'carol-alias', 'Carol alias');
    expect(JSON.stringify(store.getState())).not.toContain('alice-private');
  });
});
