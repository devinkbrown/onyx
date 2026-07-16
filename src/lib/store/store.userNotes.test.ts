// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { parseIRCMessage } from '@/lib/irc/parser';
import {
  MAX_USER_NOTE_LENGTH,
  MAX_USER_NOTES,
  saveUserNotes,
  USER_NOTES_STORAGE_KEY,
} from '@/lib/userNotes';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://notes.example/ws';

function server(account: string | null, nick = account ?? 'guest'): Server {
  return {
    id: 'notes-test',
    name: 'Notes',
    network: 'Notes',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('private user note actions and identity hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('normalizes, persists, reads, and deletes notes for only the active owner', () => {
    const owner = { serverUrl, identity: 'alice' } as const;
    store.setState({ server: server('alice'), ourNick: 'alice', userNotes: new Map() });

    store.getState().setUserNote('  TrEv ', '  private context  ');

    expect(store.getState().getUserNote('TREV')).toBe('private context');
    const key = deviceMemoryStorageKey(USER_NOTES_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({ trev: 'private context' });

    store.getState().deleteUserNote('trev');
    expect(store.getState().userNotes).toEqual(new Map());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('fails closed without an owner and rejects malformed or over-limit input', () => {
    store.setState({ server: null, ourNick: '', userNotes: new Map([['trev', 'stale secret']]) });
    store.getState().setUserNote('mallory', 'must not persist');
    store.getState().deleteUserNote('trev');

    expect(store.getState().getUserNote('trev')).toBe('');
    expect(store.getState().userNotes).toEqual(new Map([['trev', 'stale secret']]));
    expect(localStorage.length).toBe(0);

    const full = new Map(Array.from({ length: MAX_USER_NOTES }, (_, index) => [
      `user${index}`,
      `note ${index}`,
    ]));
    store.setState({ server: server('alice'), ourNick: 'alice', userNotes: full });
    store.getState().setUserNote('bad nick', 'rejected');
    store.getState().setUserNote('extra', 'rejected at capacity');
    store.getState().setUserNote('user0', 'x'.repeat(MAX_USER_NOTE_LENGTH + 1));

    expect(store.getState().userNotes).toEqual(full);
    expect(localStorage.length).toBe(0);
  });

  it('hydrates Bob notes and quarantines Alice notes on a live 900 switch', () => {
    const bob = { serverUrl, identity: 'bob' } as const;
    saveUserNotes(new Map([['Trev', 'Bob private note']]), bob);
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      userNotes: new Map([['trev', 'Alice private note']]),
    });

    feed(':notes.example 900 alice alice!u@h bob :You are now logged in as bob');

    expect(store.getState().userNotes).toEqual(new Map([['trev', 'Bob private note']]));
    expect(store.getState().getUserNote('trev')).toBe('Bob private note');
  });

  it('hydrates the guest owner notes on 901 and preserves same-owner hydration', () => {
    const alice = { serverUrl, identity: 'alice' } as const;
    const guest = { serverUrl, identity: 'guest42' } as const;
    saveUserNotes(new Map([['alice-peer', 'Alice note']]), alice);
    saveUserNotes(new Map([['guest-peer', 'Guest note']]), guest);

    store.setState({ server: server('alice'), ourNick: 'alice', userNotes: new Map() });
    feed(':notes.example 900 alice alice!u@h alice :You are now logged in as alice');
    expect(store.getState().userNotes).toEqual(new Map([['alice-peer', 'Alice note']]));

    store.setState({ server: server('alice', 'guest42'), ourNick: 'guest42' });
    feed(':notes.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().userNotes).toEqual(new Map([['guest-peer', 'Guest note']]));
  });
});
