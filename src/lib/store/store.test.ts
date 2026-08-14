// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKGROUND_STORAGE_KEY, store } from './store';

const initialState = store.getInitialState();

describe('vanilla store', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('exposes the expected initial state', () => {
    const state = store.getState();

    expect(state.status).toBe('disconnected');
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.channels).toBeInstanceOf(Map);
    expect(state.channels.size).toBe(0);
    expect(state.dms).toBeInstanceOf(Map);
    expect(state.dms.size).toBe(0);
    expect(state.activeView).toEqual({ kind: 'home' });
    expect(state.showMemberList).toBe(true);
    expect(state.toasts).toEqual([]);
  });

  it('runs representative mutating actions', () => {
    store.getState().setConnectionStatus('connecting');
    store.getState().setReconnectIn(12);
    store.getState().toggleMemberList();
    store.getState().openSettings('notifications');
    store.getState().addToast({
      variant: 'success',
      title: 'Connected',
      description: 'IRC session established',
    });

    const afterMutations = store.getState();
    expect(afterMutations.connectionStatus).toBe('connecting');
    expect(afterMutations.reconnectIn).toBe(12);
    expect(afterMutations.showMemberList).toBe(false);
    expect(afterMutations.showSettings).toBe(true);
    expect(afterMutations.settingsTab).toBe('notifications');
    expect(afterMutations.toasts).toHaveLength(1);
    expect(afterMutations.toasts[0]).toMatchObject({
      variant: 'success',
      title: 'Connected',
      description: 'IRC session established',
    });
    expect(afterMutations.toasts[0]?.id).toMatch(/^onyx-/);

    const toastId = afterMutations.toasts[0]?.id;
    expect(toastId).toBeDefined();
    store.getState().dismissToast(toastId!);
    store.getState().closeSettings();

    const finalState = store.getState();
    expect(finalState.toasts).toEqual([]);
    expect(finalState.showSettings).toBe(false);
  });

  it('persists theme changes through the current ThemeProvider storage key', () => {
    store.getState().setTheme('ink');

    expect(store.getState().activeTheme).toBe('ink');
    expect(store.getState().theme).toBe('ink');
    expect(localStorage.getItem('onyx:theme')).toBe('ink');
    expect(localStorage.getItem('onyx:active-theme')).toBeNull();

    store.getState().setDisplayTheme('pearl');

    expect(store.getState().activeTheme).toBe('pearl');
    expect(store.getState().theme).toBe('pearl');
    expect(localStorage.getItem('onyx:theme')).toBe('pearl');
    expect(localStorage.getItem('onyx:display-theme')).toBeNull();
  });

  it('keeps theme store and persistence aligned for an invalid request', () => {
    store.getState().setTheme('custom:missing');

    expect(store.getState().activeTheme).toBe('ocean');
    expect(store.getState().theme).toBe('ocean');
    expect(localStorage.getItem('onyx:theme')).toBe('ocean');
  });

  it('synchronizes background changes made in another tab', () => {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, 'starfield');
    window.dispatchEvent(new StorageEvent('storage', {
      key: BACKGROUND_STORAGE_KEY,
      newValue: 'starfield',
    }));

    expect(store.getState().backgroundId).toBe('starfield');

    localStorage.setItem(BACKGROUND_STORAGE_KEY, 'removed-background');
    window.dispatchEvent(new StorageEvent('storage', {
      key: BACKGROUND_STORAGE_KEY,
      newValue: 'removed-background',
    }));
    expect(store.getState().backgroundId).toBe('auto');
  });

  it('notifies selector subscribers when selected state changes', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(
      (state) => state.connectionStatus,
      (next, previous) => {
        listener(next, previous);
      },
    );

    store.getState().setConnectionStatus('connecting');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('connecting', 'disconnected');

    unsubscribe();
    store.getState().setConnectionStatus('connected');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not auto-reconnect after a fatal SASL disconnect', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'alice',
        password: 'wrong',
      });
      store.setState({ autoReconnect: true, connectionStatus: 'connected', reconnectIn: 42 });

      const client = store.getState().client as unknown as {
        opts: { onDisconnected?: (reason: string) => void };
      };
      client.opts.onDisconnected?.('SASL authentication failed');

      expect(store.getState()).toMatchObject({
        status: 'disconnected',
        connectionStatus: 'disconnected',
        autoReconnect: false,
        reconnectIn: 0,
      });
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('does not auto-reconnect after a registered-nickname auth close', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'alice',
      });
      store.setState({ autoReconnect: true, connectionStatus: 'connecting', reconnectIn: 42 });

      const client = store.getState().client as unknown as {
        opts: { onDisconnected?: (reason: string) => void };
      };
      // Server/client close reason only — 432 text frame may have been lost.
      client.opts.onDisconnected?.('Registered nickname requires authentication');

      expect(store.getState()).toMatchObject({
        status: 'disconnected',
        connectionStatus: 'disconnected',
        autoReconnect: false,
        reconnectIn: 0,
      });
      // Connect keys its sign-in CTA off error notifications.
      expect(
        store.getState().notifications.some(
          (n) => n.type === 'error' && /nickname is registered/i.test(n.text),
        ),
      ).toBe(true);
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('treats a bare WebSocket code 4003 close as auth-fatal (reason stripped)', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'alice',
        password: 'secret',
      });
      store.setState({ autoReconnect: true, connectionStatus: 'connected', reconnectIn: 9 });

      const client = store.getState().client as unknown as {
        opts: { onDisconnected?: (reason: string) => void };
      };
      // IRCClient formats missing close reasons as `code ${ev.code}`.
      client.opts.onDisconnected?.('code 4003');

      expect(store.getState()).toMatchObject({
        status: 'disconnected',
        connectionStatus: 'disconnected',
        autoReconnect: false,
        reconnectIn: 0,
      });
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('does not duplicate the registered-nick error when onError already fired', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'alice',
      });
      const client = store.getState().client as unknown as {
        opts: {
          onError?: (err: string) => void;
          onDisconnected?: (reason: string) => void;
        };
      };
      client.opts.onError?.(
        'That nickname is registered. Sign in as its account before using it.',
      );
      client.opts.onDisconnected?.('Registered nickname requires authentication');

      const registeredErrors = store.getState().notifications.filter(
        (n) => n.type === 'error' && /nickname is registered/i.test(n.text),
      );
      expect(registeredErrors).toHaveLength(1);
      expect(store.getState().autoReconnect).toBe(false);
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the SASL account when RPL_LOGGEDIN arrives before registration', () => {
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
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const receive = (line: string): void => {
      FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
    };

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'alice',
        password: 'correct horse battery staple',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));

      receive(':example.test CAP * LS :sasl=PLAIN');
      receive(':example.test CAP * ACK :sasl');
      receive('AUTHENTICATE +');
      // Onyx Server sends 900 during SASL, before the 001 that causes the store to
      // construct its Server record. This ordering used to discard the account
      // and made the top-bar identity chip incorrectly render “Guest”.
      receive(':example.test 900 alice alice!webchat@example alice :You are now logged in as alice');
      receive(':example.test 903 alice :SASL authentication successful');

      expect(store.getState().server).toBeNull();
      receive(':example.test 001 alice :Welcome to Onyx');

      expect(store.getState()).toMatchObject({
        status: 'connected',
        connectionStatus: 'connected',
        server: {
          account: 'alice',
          nick: 'alice',
          connected: true,
        },
      });
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('returns to an actionable error state when WebSocket construction throws', () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error('invalid endpoint');
      }
    }
    vi.stubGlobal('WebSocket', ThrowingWebSocket);

    try {
      store.getState().connect({
        url: 'not-a-websocket-url',
        nick: 'alice',
        password: 'secret',
      });

      expect(store.getState()).toMatchObject({
        client: null,
        status: 'disconnected',
        connectionStatus: 'disconnected',
        autoReconnect: false,
        reconnectIn: 0,
      });
      expect(store.getState().notifications).toContainEqual(
        expect.objectContaining({ type: 'error', text: expect.stringContaining('invalid endpoint') }),
      );
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('does not expose the previous account after an explicit replacement connect fails', () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error('replacement endpoint unavailable');
      }
    }
    const previousClient = { destroy: vi.fn() };
    store.setState({
      client: previousClient as never,
      status: 'connected',
      connectionStatus: 'connected',
      server: {
        id: 'old-session',
        name: 'Old network',
        network: 'Old network',
        url: 'wss://old.example',
        icon: '#000',
        nick: 'alice',
        account: 'alice',
        connected: true,
      },
    });
    vi.stubGlobal('WebSocket', ThrowingWebSocket);

    try {
      store.getState().connect({
        url: 'wss://new.example',
        nick: 'bob',
      });

      expect(previousClient.destroy).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({
        client: null,
        status: 'disconnected',
        connectionStatus: 'disconnected',
        ourNick: 'bob',
        server: null,
      });
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });
});
