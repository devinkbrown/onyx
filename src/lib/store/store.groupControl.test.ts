// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';

const bridgeMocks = vi.hoisted(() => ({
  sequence: 0,
  events: [] as string[],
  bridges: [] as Array<Record<string, unknown>>,
}));

vi.mock('./groupControlBridge', () => ({
  createGroupControlBridge: (options: Record<string, unknown>) => {
    const id = ++bridgeMocks.sequence;
    const client = options.client;
    const event = (name: string) => bridgeMocks.events.push(`bridge-${id}:${name}`);
    const bridge = {
      id,
      client,
      endpoint: options.endpoint,
      options,
      start: vi.fn(() => event('start')),
      onConnected: vi.fn(() => event('connected')),
      onDisconnected: vi.fn(() => event('disconnected')),
      onRegistered: vi.fn(() => { event('registered'); return true; }),
      refreshAuthenticatedAccount: vi.fn(async () => {
        event(`identity:${String((options.authenticatedAccount as () => string | null)())}`);
        return true;
      }),
      setAuthenticatedAccount: vi.fn(async (account: string | null) => {
        event(`set-identity:${String(account)}`);
        return true;
      }),
      onRoomPart: vi.fn((room: string) => event(`part:${room}`)),
      onRoomKick: vi.fn((room: string) => event(`kick:${room}`)),
      destroy: vi.fn(async () => { event('destroy'); }),
    };
    bridgeMocks.bridges.push(bridge);
    event('create');
    return bridge;
  },
}));

import { store } from './store';

const initialState = store.getInitialState();

function safeRuntime(clientId: string): GroupControlRuntimeState {
  return {
    generation: 1,
    lifecycle: 'identity-pending',
    activation: 'hold',
    identity: { clientId, endpoint: 'wss://example.test/irc?realm=one', account: null, deviceId: null },
    rooms: [],
    counters: { accepted: 0, processed: 0, queued: 0, applied: 0, locked: 0, rejected: 0, ignored: 0, coalesced: 0, evicted: 0, expired: 0 },
    queueDepth: 0,
    sessionCount: 0,
  };
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static sequence = 0;
  static latest: FakeWebSocket | null = null;

  readonly id = ++FakeWebSocket.sequence;
  readyState = FakeWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = '';
  protocol = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn(() => bridgeMocks.events.push(`socket-${this.id}:close`));

  constructor() {
    bridgeMocks.events.push(`socket-${this.id}:create`);
    FakeWebSocket.latest = this;
  }
}

function receive(line: string, socket = FakeWebSocket.latest): void {
  socket?.onmessage?.(new MessageEvent('message', { data: line }));
}

function currentBridge() {
  return bridgeMocks.bridges.at(-1) as {
    id: number;
    options: { publish(runtime: GroupControlRuntimeState | null): void };
    onConnected: ReturnType<typeof vi.fn>;
    onDisconnected: ReturnType<typeof vi.fn>;
    onRegistered: ReturnType<typeof vi.fn>;
    refreshAuthenticatedAccount: ReturnType<typeof vi.fn>;
    setAuthenticatedAccount: ReturnType<typeof vi.fn>;
    onRoomPart: ReturnType<typeof vi.fn>;
    onRoomKick: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
}

describe('store group-control lifecycle ownership', () => {
  beforeEach(() => {
    store.getState().disconnect();
    store.setState(initialState, true);
    localStorage.clear();
    bridgeMocks.sequence = 0;
    bridgeMocks.events.length = 0;
    bridgeMocks.bridges.length = 0;
    FakeWebSocket.sequence = 0;
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('creates and starts exactly one bridge before opening the socket', () => {
    store.getState().connect({ url: 'wss://example.test/irc?realm=one', nick: 'alice' });
    expect(bridgeMocks.bridges).toHaveLength(1);
    expect(bridgeMocks.events.slice(0, 3)).toEqual([
      'bridge-1:create',
      'bridge-1:start',
      'socket-1:create',
    ]);
    expect(currentBridge().onConnected).not.toHaveBeenCalled();
  });

  it('orders 900, connected/server refresh, and exact 001 registration without using nick as account', () => {
    store.getState().connect({ url: 'wss://example.test/irc?realm=one', nick: 'GuestNick' });
    receive(':example.test 900 GuestNick GuestNick!u@h Alice :You are now logged in as Alice');
    expect(currentBridge().setAuthenticatedAccount).toHaveBeenCalledWith('Alice');
    expect(store.getState().server).toBeNull();

    receive(':example.test 001 GuestNick :Welcome');
    expect(currentBridge().onConnected).toHaveBeenCalledOnce();
    expect(currentBridge().refreshAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(currentBridge().onRegistered).toHaveBeenCalledOnce();
    expect(bridgeMocks.events.indexOf('bridge-1:connected'))
      .toBeLessThan(bridgeMocks.events.indexOf('bridge-1:registered'));
    expect(bridgeMocks.events).toContain('bridge-1:identity:Alice');
    expect(store.getState().server?.account).toBe('Alice');
  });

  it('tracks only authoritative self identity transitions and both logout paths', () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 900 alice alice!u@h alice :logged in');
    receive(':example.test 001 alice :Welcome');
    currentBridge().setAuthenticatedAccount.mockClear();

    receive(':mallory!m@evil ACCOUNT mallory-account');
    expect(currentBridge().setAuthenticatedAccount).not.toHaveBeenCalled();
    receive(':alice!u@host ACCOUNT bob');
    expect(currentBridge().setAuthenticatedAccount).toHaveBeenLastCalledWith('bob');
    receive(':alice!u@host ACCOUNT *');
    expect(currentBridge().setAuthenticatedAccount).toHaveBeenLastCalledWith(null);

    receive(':example.test 900 alice alice!u@h alice :logged in');
    receive(':example.test 901 alice alice!u@h :logged out');
    expect(currentBridge().setAuthenticatedAccount).toHaveBeenLastCalledWith(null);

    receive(':example.test 900 alice alice!u@h alice :logged in');
    store.getState().logout();
    receive(':example.test NOTICE alice :You are now logged out');
    expect(currentBridge().setAuthenticatedAccount).toHaveBeenLastCalledWith(null);
  });

  it('detaches on socket loss, reuses the same bridge, and ignores stale replacement publication', () => {
    store.getState().connect({ url: 'wss://old.example.test/irc', nick: 'alice' });
    const oldSocket = FakeWebSocket.latest!;
    receive(':old.example.test 001 alice :Welcome', oldSocket);
    const oldBridge = currentBridge();

    oldSocket.onclose?.(new CloseEvent('close', { code: 1006 }));
    expect(oldBridge.onDisconnected).toHaveBeenCalledOnce();
    expect(bridgeMocks.bridges).toHaveLength(1);

    store.getState().connect({ url: 'wss://new.example.test/irc', nick: 'alice' });
    expect(oldBridge.destroy).toHaveBeenCalledOnce();
    expect(bridgeMocks.bridges).toHaveLength(2);
    const fresh = safeRuntime('fresh-client');
    currentBridge().options.publish(fresh);
    expect(store.getState().groupControlRuntime).toEqual(fresh);
    oldBridge.options.publish(safeRuntime('stale-client'));
    expect(store.getState().groupControlRuntime).toEqual(fresh);
  });

  it('destroys and clears the bridge before explicit client destruction', () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    const bridge = currentBridge();
    bridge.options.publish(safeRuntime('owned'));
    store.getState().disconnect();
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(store.getState().groupControlRuntime).toBeNull();
    expect(bridgeMocks.events.indexOf('bridge-1:destroy'))
      .toBeLessThan(bridgeMocks.events.indexOf('socket-1:close'));
  });

  it('forwards only live self PART/KICK room removal events', () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();

    receive(':mallory!m@evil PART #room :bye');
    receive(':operator!o@host KICK #room mallory :bye');
    expect(bridge.onRoomPart).not.toHaveBeenCalled();
    expect(bridge.onRoomKick).not.toHaveBeenCalled();

    receive('BATCH +history chathistory #room');
    receive('@batch=history;msgid=old-part :alice!u@host PART #room :old');
    receive('@batch=history;msgid=old-kick :operator!o@host KICK #room alice :old');
    receive('BATCH -history');
    expect(bridge.onRoomPart).not.toHaveBeenCalled();
    expect(bridge.onRoomKick).not.toHaveBeenCalled();

    receive(':alice!u@host PART #room :live');
    receive(':operator!o@host KICK #other alice :live');
    expect(bridge.onRoomPart).toHaveBeenCalledWith('#room');
    expect(bridge.onRoomKick).toHaveBeenCalledWith('#other');
  });
});
