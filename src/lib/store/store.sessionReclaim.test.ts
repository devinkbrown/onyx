// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.sessionReclaim.test.ts — visible session-reclaim banner state.
 *
 * IRCClient's `onSessionReclaim` (client.ts, fired from
 * `_sendSessionCommandsAfterAuthentication` on every `001`) is observational —
 * it never drives protocol behavior. These tests drive the real connect() →
 * 900/001 → FAIL SESSION flow through a fake WebSocket and assert on the
 * store's `sessionReclaim` projection, the same harness style as
 * store.sessionRoster.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveCredentials, storeMeshToken, storeSessionToken } from '@/lib/credentials';
import { store } from './store';

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

describe('session-reclaim banner state', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not show a banner for an ordinary guest first connect (none-held)', () => {
    store.getState().connect({ url: 'wss://example.test', nick: 'Guest42' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 Guest42 :Welcome to Onyx');

    expect(store.getState().sessionReclaim).toBeNull();
  });

  it('shows restoring, then promotes to reclaimed and auto-dismisses when the resume holds', () => {
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      storeSessionToken('local-held');
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');

      expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME local-held\r\n');
      expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });

      vi.advanceTimersByTime(2_000);
      expect(store.getState().sessionReclaim).toEqual({ phase: 'reclaimed', kind: 'local' });

      vi.advanceTimersByTime(3_000);
      expect(store.getState().sessionReclaim).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers a live mesh bearer over a held local one and reports kind: mesh', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    storeSessionToken('local-held');
    storeMeshToken('mesh-held', Math.floor((Date.now() + 3_600_000) / 1000));
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME mesh-held\r\n');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'mesh' });
  });

  it('moves an attempted resume to reclaim-failed on FAIL SESSION INVALID_TOKEN, superseding the restoring guess', () => {
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      storeSessionToken('stale-token');
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');
      expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });

      receive(':example.test FAIL SESSION INVALID_TOKEN :The session token is invalid');
      expect(store.getState().sessionReclaim).toEqual({ phase: 'reclaim-failed' });

      // The confirm-window timer must not resurrect a false 'reclaimed' toast
      // over the real, worse outcome.
      vi.advanceTimersByTime(5_000);
      expect(store.getState().sessionReclaim).toEqual({ phase: 'reclaim-failed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves to reclaim-failed on FAIL SESSION NO_SESSION as well', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    storeSessionToken('stale-token');
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    receive(':example.test FAIL SESSION NO_SESSION :No detached session to resume');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'reclaim-failed' });
  });

  it('leaves an unrelated SESSION LIST/DROP failure alone', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    storeSessionToken('local-held');
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });

    receive(':example.test FAIL SESSION STALE_LIST :SESSION LIST snapshot is no longer valid; list again');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });
  });

  it('shows sign-in-again when the only held bearer (mesh) has already lapsed and no local fallback exists', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    // Simulate a long-lived tab: the mesh bearer was live at load time but has
    // since lapsed, and no local token was ever held on this device.
    store.getState().client?.updateResumeTokens({
      meshToken: 'lapsed-mesh',
      meshTokenExpiresAt: Date.now() - 1_000,
    });
    receive(':example.test 001 kain :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send).not.toHaveBeenCalledWith('SESSION RESUME lapsed-mesh\r\n');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'sign-in-again' });
  });

  it('falls through to the local bearer when the mesh one has lapsed, without a sign-in-again banner', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    storeSessionToken('local-held');
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    store.getState().client?.updateResumeTokens({
      meshToken: 'lapsed-mesh',
      meshTokenExpiresAt: Date.now() - 1_000,
    });
    receive(':example.test 001 kain :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME local-held\r\n');
    expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });
  });

  it('resets a stale reclaim banner on a fresh explicit connect()', () => {
    store.setState({ sessionReclaim: { phase: 'sign-in-again' } });
    store.getState().connect({ url: 'wss://example.test', nick: 'Guest42' });

    expect(store.getState().sessionReclaim).toBeNull();
  });

  it('dismissSessionReclaim clears the banner and stops the pending auto-promotion', () => {
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      storeSessionToken('local-held');
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');
      expect(store.getState().sessionReclaim).toEqual({ phase: 'restoring', kind: 'local' });

      store.getState().dismissSessionReclaim();
      expect(store.getState().sessionReclaim).toBeNull();

      // The confirm-window timer that would have promoted to 'reclaimed' was
      // cancelled by the dismissal; it must not resurrect the banner later.
      vi.advanceTimersByTime(5_000);
      expect(store.getState().sessionReclaim).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a lingering reclaim banner on explicit disconnect', () => {
    store.setState({ sessionReclaim: { phase: 'reclaim-failed' } });
    store.getState().disconnect();

    expect(store.getState().sessionReclaim).toBeNull();
  });
});
