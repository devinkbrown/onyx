// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { loadCredentials, saveCredentials, storeMeshToken, storeSessionToken } from '@/lib/credentials';
import { _resetSessionRestoreForTests, store } from './store';

const initialState = store.getInitialState();

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

function receive(line: string): void {
  FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
}

describe('remembered session roster restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    _resetSessionRestoreForTests();
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    _resetSessionRestoreForTests();
    vi.unstubAllGlobals();
  });

  it('accepts canonical self JOIN and NAMES after a collision alias resumes the account', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    store.getState().client?.updateResumeTokens({ sessionToken: 'resume-token' });
    receive(':example.test 001 kain_ :Welcome to IRCXNet');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME resume-token\r\n');

    receive(':kain!webchat@example JOIN #root');
    receive(':example.test 353 kain_ = #root :@kain trev alice');
    receive(':example.test 366 kain_ #root :End of NAMES list');

    const root = store.getState().channels.get('#root');
    expect(root).toBeDefined();
    expect([...root!.users.values()].map(user => user.nick).sort()).toEqual(['alice', 'kain', 'trev']);

    receive(':kain!webchat@example JOIN #staff');
    receive(':example.test 353 kain_ = #staff :@kain operator');
    receive(':example.test 366 kain_ #staff :End of NAMES list');

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('retains an authoritative resume NAMES burst that arrives before self JOIN', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    store.getState().client?.updateResumeTokens({ sessionToken: 'resume-token' });
    receive(':example.test 001 kain_ :Welcome to IRCXNet');

    receive(':example.test 353 kain_ = #fabricated :intruder mallory');
    expect(store.getState().channels.has('#fabricated')).toBe(false);

    receive(':example.test 353 kain_ = #root :@kain trev alice');
    receive(':example.test 366 kain_ #root :End of NAMES list');
    receive(':kain!webchat@example JOIN #root');

    const root = store.getState().channels.get('#root');
    expect(root).toBeDefined();
    expect([...root!.users.values()].map(user => user.nick).sort()).toEqual(['alice', 'kain', 'trev']);
  });

  it('does not let a stray NAMES reply create a channel outside a restore generation', () => {
    store.setState({ ourNick: 'kain', connectionStatus: 'connected' });

    store.getState()._handleMessage(
      parseIRCMessage(':example.test 353 kain = #stray :kain intruder'),
    );

    expect(store.getState().channels.has('#stray')).toBe(false);
  });

  it('preserves the pre-drop active channel across multi-channel replay JOINs', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to IRCXNet');
    receive(':kain!webchat@example JOIN #root');
    receive(':example.test 353 kain = #root :@kain trev');
    receive(':example.test 366 kain #root :End of NAMES list');
    receive(':kain!webchat@example JOIN #staff');
    receive(':example.test 353 kain = #staff :@kain alice');
    receive(':example.test 366 kain #staff :End of NAMES list');
    store.setState({ activeView: { kind: 'channel', channel: '#root' } });

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');

    receive(':kain!webchat@example JOIN #root');
    receive(':kain!webchat@example JOIN #staff');

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('promotes a passwordless remembered identity only after SESSION success evidence', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('remembered-token');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 001 kain_ :Welcome to IRCXNet');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME remembered-token\r\n');
    expect(store.getState().server?.account).toBeNull();
    const reclaimAttemptsBeforeSuccess = FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line === 'NICK kain\r\n').length ?? 0;

    receive(':example.test NOTE SESSION TOKEN :fresh-token');

    expect(store.getState().server?.account).toBe('kain');
    expect(FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line === 'NICK kain\r\n')).toHaveLength(reclaimAttemptsBeforeSuccess + 1);
  });

  it('keeps a failed remembered SESSION resume in the guest state', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('stale-token');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome to IRCXNet');

    receive(':example.test FAIL SESSION INVALID_TOKEN :The session token is invalid');

    expect(store.getState().server?.account).toBeNull();
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();

    receive(':example.test NOTE SESSION TOKEN :late-token');

    expect(store.getState().server?.account).toBeNull();
  });

  it('does not promote an ordinary guest from an unsolicited SESSION token note', () => {
    store.getState().connect({ url: 'wss://example.test', nick: 'Guest42' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 Guest42 :Welcome to IRCXNet');

    receive(':example.test NOTE SESSION TOKEN :unsolicited-token');

    expect(store.getState().server?.account).toBeNull();
  });

  it('does not reuse remembered tokens after the account logs out', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('remembered-token');
    storeMeshToken('remembered-mesh');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome to IRCXNet');
    receive(':example.test NOTE SESSION TOKEN :fresh-token');
    receive(':example.test NOTE SESSION MTOKEN :fresh-mesh');
    expect(store.getState().server?.account).toBe('kain');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME remembered-mesh\r\n');

    receive(':example.test 901 kain kain!webchat@example :You are now logged out');

    expect(store.getState().server?.account).toBeNull();
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBeUndefined();

    // A rotation already queued before 901 must not re-arm the logged-out
    // identity after logout cleanup wins the race.
    receive(':example.test NOTE SESSION TOKEN :late-token');
    receive(':example.test NOTE SESSION MTOKEN :late-mesh');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBeUndefined();

    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');

    const replayedResume = FakeWebSocket.latest?.send.mock.calls
      .map(([line]) => line)
      .filter(line => line.startsWith('SESSION RESUME ')) ?? [];
    expect(replayedResume).toEqual([]);
  });
});
