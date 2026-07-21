// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import {
  _resetSessionRestoreForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();
const SERVER: Server = {
  id: 'hydrate-cold',
  name: 'Onyx',
  network: 'Onyx',
  url: 'wss://example.test',
  icon: '',
  nick: 'alice',
  account: 'alice',
  connected: true,
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'vault-1',
    time: new Date(1_000),
    from: 'alice',
    text: 'remembered locally',
    type: 'msg',
    target: '#room',
    ...overrides,
  };
}

function mockClient() {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw: vi.fn(() => true),
    join: vi.fn(),
    send: vi.fn(() => true),
    connect: vi.fn(() => true),
    updateResumeTokens: vi.fn(),
  } as never;
}

describe('hydrateHistory cold-start activation', () => {
  beforeEach(() => {
    _resetSessionRestoreForTests();
    store.setState(initialState, true);
  });

  afterEach(() => {
    _resetSessionRestoreForTests();
    vi.restoreAllMocks();
  });

  it('materializes and activates a missing channel buffer before JOIN replay', () => {
    store.getState().hydrateHistory('#Room', [message()], { activate: 'channel' });

    const state = store.getState();
    expect(state.activeView).toEqual({ kind: 'channel', channel: '#room' });
    expect(state.channels.get('#room')?.messages.map((row) => row.id)).toEqual(['vault-1']);
    expect(state.dms.has('#room')).toBe(false);
  });

  it('materializes an encrypted DM from ciphertext without inventing persisted plaintext', () => {
    store.getState().hydrateHistory('Trev', [message({
      id: 'cipher-1',
      target: 'Trev',
      text: 'ONYXDM1 opaque-ciphertext',
      encrypted: true,
      plaintext: undefined,
    })], { activate: 'dm' });

    const state = store.getState();
    const hydrated = state.dms.get('trev')?.messages[0];
    expect(state.activeView).toEqual({ kind: 'dm', nick: 'trev' });
    expect(hydrated?.text).toBe('ONYXDM1 opaque-ciphertext');
    expect(hydrated?.plaintext).toBeUndefined();
    expect(state.channels.has('trev')).toBe(false);
  });

  it('is a no-op for a missing target without activate (JOIN must create the shell)', () => {
    store.getState().hydrateHistory('#ghost', [message({ id: 'g1', target: '#ghost' })]);
    expect(store.getState().channels.has('#ghost')).toBe(false);
    expect(store.getState().activeView).toEqual(initialState.activeView);
  });

  it('merges a time-travel window into live rows chronologically', () => {
    store.getState().hydrateHistory('#room', [message({
      id: 'live',
      time: new Date(3_000),
      text: 'live row',
    })], { activate: 'channel' });

    store.getState().hydrateHistory('#room', [
      message({ id: 'older', time: new Date(1_000), text: 'older vault' }),
      message({ id: 'between', time: new Date(2_000), text: 'between vault' }),
      message({ id: 'newer', time: new Date(4_000), text: 'newer vault' }),
    ]);

    expect(store.getState().channels.get('#room')?.messages.map((row) => row.id))
      .toEqual(['older', 'between', 'live', 'newer']);
  });

  it('holds a cold-activated room across the session-sync JOIN flood', () => {
    // vaultResumeMemory → hydrateHistory({activate}) must win over the first
    // restored JOIN so cold return does not bounce off the remembered room.
    store.setState({
      ...initialState,
      client: mockClient(),
      ourNick: 'alice',
      server: SERVER,
      activeView: { kind: 'home' },
      channels: new Map(),
      dms: new Map(),
      autoReconnect: true,
    }, true);
    store.getState().reconnectNow();
    store.getState().hydrateHistory('#room', [message()], { activate: 'channel' });
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#room' });

    store.getState()._handleMessage(parseIRCMessage(':alice!a@h JOIN #other'));

    expect(store.getState().channels.has('#other')).toBe(true);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#room' });
  });
});
