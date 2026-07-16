// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTO_JOIN_STORAGE_KEY, saveAutoJoinChannels } from '@/lib/autoJoinMemory';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  _resetAccountReplyStateForTests,
  _resetSessionRestoreForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://autojoin-switch.example/ws';

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | null = null;

  readyState = FakeWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor() {
    FakeWebSocket.latest = this;
  }
}

function server(account: string | null, nick = account ?? 'guest42'): Server {
  return {
    id: 'autojoin-switch',
    name: 'Autojoin Switch',
    network: 'Autojoin Switch',
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

function receive(line: string): void {
  FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
}

function sentLines(): string[] {
  return FakeWebSocket.latest?.send.mock.calls.map(([line]) => String(line)) ?? [];
}

describe('private auto-join ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    _resetAccountReplyStateForTests();
    _resetSessionRestoreForTests();
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    _resetSessionRestoreForTests();
    vi.unstubAllGlobals();
  });

  it('fails closed without an owner and persists only sanitized owner rooms', () => {
    store.setState({ server: null, ourNick: '', autoJoinChannels: [] });
    store.getState().addAutoJoin('#ownerless-private');
    expect(store.getState().autoJoinChannels).toEqual([]);
    expect(localStorage.length).toBe(0);

    const alice = owner('alice');
    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().addAutoJoin(' #Alice-Private ');
    store.getState().addAutoJoin('#alice-private');
    store.getState().addAutoJoin('#bad room');

    expect(store.getState().autoJoinChannels).toEqual(['#alice-private']);
    expect(localStorage.getItem(deviceMemoryStorageKey(AUTO_JOIN_STORAGE_KEY, alice)!))
      .toBe('["#alice-private"]');

    store.getState().removeAutoJoin('#ALICE-PRIVATE');
    expect(store.getState().autoJoinChannels).toEqual([]);
    expect(localStorage.getItem(deviceMemoryStorageKey(AUTO_JOIN_STORAGE_KEY, alice)!)).toBeNull();
  });

  it('hydrates every owner transition without ever consuming the saved set as blind JOINs', () => {
    expect(saveAutoJoinChannels(['#alice-secret'], owner('alice'))).toEqual(['#alice-secret']);
    expect(saveAutoJoinChannels(['#bob-secret'], owner('bob'))).toEqual(['#bob-secret']);
    expect(saveAutoJoinChannels(['#mika-secret'], owner('mika'))).toEqual(['#mika-secret']);
    expect(saveAutoJoinChannels(['#carol-secret'], owner('carol'))).toEqual(['#carol-secret']);

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':autojoin-switch.example 001 alice :Welcome');

    expect(store.getState().autoJoinChannels).toEqual(['#alice-secret']);
    expect(sentLines().some((line) => line.startsWith('JOIN '))).toBe(false);

    FakeWebSocket.latest?.send.mockClear();
    receive(':autojoin-switch.example 900 alice alice!u@h bob :You are now logged in as bob');

    expect(store.getState().autoJoinChannels).toEqual(['#bob-secret']);
    expect(sentLines().some((line) => line.startsWith('JOIN '))).toBe(false);
    expect(sentLines().join('\n')).not.toContain('#alice-secret');

    expect(saveAutoJoinChannels(['#alice-guest'], owner('alice'))).toEqual(['#alice-guest']);
    receive(':autojoin-switch.example 901 alice alice!u@h :You are now logged out');
    expect(store.getState().autoJoinChannels).toEqual(['#alice-guest']);

    receive(':alice!webchat@example NICK mika');
    expect(store.getState().autoJoinChannels).toEqual(['#mika-secret']);

    receive(':mika!webchat@example ACCOUNT carol');
    expect(store.getState().autoJoinChannels).toEqual(['#carol-secret']);
    expect(sentLines().some((line) => line.startsWith('JOIN '))).toBe(false);

    store.getState().logout();
    receive(':autojoin-switch.example NOTICE mika :You are now logged out.');
    expect(store.getState().autoJoinChannels).toEqual(['#mika-secret']);
    expect(sentLines().some((line) => line.startsWith('JOIN '))).toBe(false);

    store.getState().disconnect();
    expect(store.getState().autoJoinChannels).toEqual([]);
  });
});
