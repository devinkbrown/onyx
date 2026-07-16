// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  INVISIBLE_MODE_STORAGE_KEY,
  saveInvisibleMode,
} from '@/lib/invisibleModeMemory';
import {
  _resetAccountReplyStateForTests,
  _resetSessionRestoreForTests,
  store,
} from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://invisible-switch.example/ws';

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

function owner(identity: string) {
  return { serverUrl, identity } as const;
}

function receive(line: string): void {
  FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
}

function sentLines(): string[] {
  return FakeWebSocket.latest?.send.mock.calls.map(([line]) => String(line)) ?? [];
}

function clearSent(): void {
  FakeWebSocket.latest?.send.mockClear();
}

function expectNoModeWrite(): void {
  expect(sentLines().some(line => line.startsWith('MODE '))).toBe(false);
}

function setAndExpectMode(enabled: boolean, nick: string): void {
  clearSent();
  store.getState().setInvisibleMode(enabled);
  expect(store.getState().invisibleMode).toBe(enabled);
  expect(sentLines()).toContain(`MODE ${nick} ${enabled ? '+i' : '-i'}\r\n`);
}

describe('private invisible-mode ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('fails closed without an owner and sends nothing when a verified save fails', () => {
    store.setState({ server: null, ourNick: '', invisibleMode: false });
    store.getState().setInvisibleMode(true);
    expect(store.getState().invisibleMode).toBe(false);
    expect(localStorage.length).toBe(0);

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':invisible-switch.example 001 alice :Welcome');
    clearSent();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    store.getState().setInvisibleMode(true);
    expect(store.getState().invisibleMode).toBe(false);
    expectNoModeWrite();
    expect(localStorage.getItem(deviceMemoryStorageKey(INVISIBLE_MODE_STORAGE_KEY, owner('alice'))!))
      .toBeNull();
  });

  it('replaces state on every identity transition without auto-sending MODE', () => {
    expect(saveInvisibleMode(true, owner('alice'))).toBe(true);
    expect(saveInvisibleMode(false, owner('bob'))).toBe(false);
    expect(saveInvisibleMode(true, owner('mika'))).toBe(true);
    expect(saveInvisibleMode(true, owner('carol'))).toBe(true);

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    clearSent();
    receive(':invisible-switch.example 001 alice :Welcome');
    expect(store.getState().invisibleMode).toBe(true);
    expectNoModeWrite();
    setAndExpectMode(false, 'alice');

    clearSent();
    receive(':invisible-switch.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().invisibleMode).toBe(false);
    expectNoModeWrite();
    setAndExpectMode(true, 'alice');

    expect(saveInvisibleMode(true, owner('alice'))).toBe(true);
    clearSent();
    receive(':invisible-switch.example 901 alice alice!u@h :You are now logged out');
    expect(store.getState().invisibleMode).toBe(true);
    expectNoModeWrite();
    setAndExpectMode(false, 'alice');

    clearSent();
    receive(':alice!webchat@example NICK mika');
    expect(store.getState().invisibleMode).toBe(true);
    expectNoModeWrite();
    setAndExpectMode(false, 'mika');

    clearSent();
    receive(':mika!webchat@example ACCOUNT carol');
    expect(store.getState().invisibleMode).toBe(true);
    expectNoModeWrite();
    setAndExpectMode(false, 'mika');

    expect(saveInvisibleMode(true, owner('mika'))).toBe(true);
    store.getState().logout();
    clearSent();
    receive(':invisible-switch.example NOTICE mika :You are now logged out.');
    expect(store.getState().invisibleMode).toBe(true);
    expectNoModeWrite();
    setAndExpectMode(false, 'mika');

    clearSent();
    store.getState().disconnect();
    expect(store.getState().invisibleMode).toBe(false);
    expectNoModeWrite();
  });
});
