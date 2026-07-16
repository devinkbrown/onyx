// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL_COLORS_STORAGE_KEY, saveChannelColors } from '@/lib/channelColorMemory';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  _resetAccountReplyStateForTests,
  _resetSessionRestoreForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://channel-colors-switch.example/ws';

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
    id: 'channel-colors-switch',
    name: 'Channel Colors Switch',
    network: 'Channel Colors Switch',
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

describe('private channel-color ownership', () => {
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

  it('fails closed without an owner and never admits malformed CSS to style state', () => {
    store.setState({ server: null, ourNick: '', channelColors: new Map() });
    store.getState().setChannelColor('#ownerless-private', '#AABBCC');
    expect(store.getState().channelColors).toEqual(new Map());
    expect(localStorage.length).toBe(0);

    const alice = owner('alice');
    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().setChannelColor(' #Alice-Private ', '#AABBCC');
    store.getState().setChannelColor('#unsafe', 'red; background: url(https://example.test)');
    store.getState().setChannelColor('#function', 'oklch(70% 0.2 30)');
    store.getState().setChannelColor('#bad room', '#112233');

    expect(store.getState().channelColors).toEqual(new Map([['#alice-private', '#aabbcc']]));
    expect(localStorage.getItem(deviceMemoryStorageKey(CHANNEL_COLORS_STORAGE_KEY, alice)!))
      .toBe('{"#alice-private":"#aabbcc"}');

    store.getState().clearChannelColor('#ALICE-PRIVATE');
    expect(store.getState().channelColors).toEqual(new Map());
    expect(localStorage.getItem(deviceMemoryStorageKey(CHANNEL_COLORS_STORAGE_KEY, alice)!)).toBeNull();
  });

  it('replaces colors on every owner transition and filters malformed persisted CSS', () => {
    expect(saveChannelColors(new Map([['#alice-private', '#111111']]), owner('alice')))
      .not.toBeNull();
    const bobKey = deviceMemoryStorageKey(CHANNEL_COLORS_STORAGE_KEY, owner('bob'))!;
    localStorage.setItem(bobKey, JSON.stringify({
      '#bob-private': '#222222',
      '#unsafe': 'red; background: url(https://example.test)',
      '#script': 'javascript:alert(1)',
    }));
    expect(saveChannelColors(new Map([['#mika-private', '#444444']]), owner('mika')))
      .not.toBeNull();
    expect(saveChannelColors(new Map([['#carol-private', '#555555']]), owner('carol')))
      .not.toBeNull();

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':channel-colors-switch.example 001 alice :Welcome');
    expect(store.getState().channelColors).toEqual(new Map([['#alice-private', '#111111']]));

    receive(':channel-colors-switch.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().channelColors).toEqual(new Map([['#bob-private', '#222222']]));
    expect(store.getState().channelColors.has('#alice-private')).toBe(false);
    expect(store.getState().channelColors.has('#unsafe')).toBe(false);
    expect(store.getState().channelColors.has('#script')).toBe(false);

    // The replacement guest is the current nick, not the account that just logged out.
    expect(saveChannelColors(new Map([['#alice-guest', '#333333']]), owner('alice')))
      .not.toBeNull();
    receive(':channel-colors-switch.example 901 alice alice!u@h :You are now logged out');
    expect(store.getState().channelColors).toEqual(new Map([['#alice-guest', '#333333']]));

    receive(':alice!webchat@example NICK mika');
    expect(store.getState().channelColors).toEqual(new Map([['#mika-private', '#444444']]));

    receive(':mika!webchat@example ACCOUNT carol');
    expect(store.getState().channelColors).toEqual(new Map([['#carol-private', '#555555']]));

    store.getState().logout();
    receive(':channel-colors-switch.example NOTICE mika :You are now logged out.');
    expect(store.getState().channelColors).toEqual(new Map([['#mika-private', '#444444']]));

    store.getState().disconnect();
    expect(store.getState().channelColors).toEqual(new Map());
  });
});
