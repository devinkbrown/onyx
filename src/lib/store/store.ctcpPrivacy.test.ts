// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CTCP_CONFIG_STORAGE_KEY,
  DEFAULT_CTCP_CONFIG,
  saveCtcpConfig,
} from '@/lib/ctcpMemory';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  _resetAccountReplyStateForTests,
  _resetSessionRestoreForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://ctcp-switch.example/ws';

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
    id: 'ctcp-switch',
    name: 'CTCP Switch',
    network: 'CTCP Switch',
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

function expectConfig(versionReply: string, timeEnabled: boolean): void {
  expect(store.getState().ctcpVersionReply).toBe(versionReply);
  expect(store.getState().ctcpTimeEnabled).toBe(timeEnabled);
}

function expectVersionReply(versionReply: string): void {
  FakeWebSocket.latest?.send.mockClear();
  receive(`:peer!u@example PRIVMSG ${store.getState().ourNick} :\x01VERSION\x01`);
  expect(sentLines()).toContain(`NOTICE peer :\x01VERSION ${versionReply}\x01\r\n`);
}

describe('private CTCP configuration ownership', () => {
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

  it('fails closed without an owner and persists only sanitized owner replies', () => {
    store.setState({
      server: null,
      ourNick: '',
      ctcpVersionReply: DEFAULT_CTCP_CONFIG.versionReply,
      ctcpTimeEnabled: DEFAULT_CTCP_CONFIG.timeEnabled,
    });
    store.getState().setCTCPVersionReply('Ownerless private build');
    store.getState().setCTCPTimeEnabled(false);
    expectConfig(DEFAULT_CTCP_CONFIG.versionReply, DEFAULT_CTCP_CONFIG.timeEnabled);
    expect(localStorage.length).toBe(0);

    const alice = owner('alice');
    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().setCTCPVersionReply('Alice\r\n\0\x01 private build');
    store.getState().setCTCPTimeEnabled(false);

    expectConfig('Alice private build', false);
    expect(localStorage.getItem(deviceMemoryStorageKey(CTCP_CONFIG_STORAGE_KEY, alice)!))
      .toBe('{"versionReply":"Alice private build","timeEnabled":false}');
  });

  it('replaces configuration and emitted replies on every identity transition', () => {
    expect(saveCtcpConfig({ versionReply: 'Alice client', timeEnabled: false }, owner('alice')))
      .not.toBeNull();
    expect(saveCtcpConfig({ versionReply: 'Bob client', timeEnabled: true }, owner('bob')))
      .not.toBeNull();
    expect(saveCtcpConfig({ versionReply: 'Mika client', timeEnabled: false }, owner('mika')))
      .not.toBeNull();
    expect(saveCtcpConfig({ versionReply: 'Carol client', timeEnabled: true }, owner('carol')))
      .not.toBeNull();

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':ctcp-switch.example 001 alice :Welcome');
    expectConfig('Alice client', false);
    expectVersionReply('Alice client');

    FakeWebSocket.latest?.send.mockClear();
    receive(':peer!u@example PRIVMSG alice :\x01TIME\x01');
    expect(sentLines().some(line => line.includes('\x01TIME '))).toBe(false);

    receive(':ctcp-switch.example 900 alice alice!u@h bob :You are now logged in as bob');
    expectConfig('Bob client', true);
    expectVersionReply('Bob client');
    expect(sentLines().join('\n')).not.toContain('Alice client');

    expect(saveCtcpConfig({ versionReply: 'Alice guest', timeEnabled: true }, owner('alice')))
      .not.toBeNull();
    receive(':ctcp-switch.example 901 alice alice!u@h :You are now logged out');
    expectConfig('Alice guest', true);
    expectVersionReply('Alice guest');

    receive(':alice!webchat@example NICK mika');
    expectConfig('Mika client', false);
    expectVersionReply('Mika client');

    receive(':mika!webchat@example ACCOUNT carol');
    expectConfig('Carol client', true);
    expectVersionReply('Carol client');

    store.getState().logout();
    receive(':ctcp-switch.example NOTICE mika :You are now logged out.');
    expectConfig('Mika client', false);
    expectVersionReply('Mika client');

    store.getState().disconnect();
    expectConfig(DEFAULT_CTCP_CONFIG.versionReply, DEFAULT_CTCP_CONFIG.timeEnabled);
  });
});
