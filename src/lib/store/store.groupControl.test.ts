// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';
import { _resetVaultForTests, loadOutbox } from '@/lib/vault/historyVault';

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
      sealRoomMessage: vi.fn(async () => ({ ok: false as const, status: 'locked' as const, reason: 'session-not-provisioned' as const })),
      openRoomMessage: vi.fn(async () => ({ ok: false as const, status: 'locked' as const, reason: 'session-not-provisioned' as const })),
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
    sealRoomMessage: ReturnType<typeof vi.fn>;
    openRoomMessage: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
}

describe('store group-control lifecycle ownership', () => {
  beforeEach(() => {
    store.getState().disconnect();
    store.setState(initialState, true);
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
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

  it('seals required-room plaintext before wire admission and keeps plaintext transient', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    bridge.sealRoomMessage.mockResolvedValueOnce({ ok: true, status: 'sealed', room: '#secure', epoch: 1, envelope: 'ONYXROOM1 ciphertext' });
    store.setState({
      channelProps: new Map([['#secure', { 'encryption-policy': 'required' }]]),
      channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]),
    });
    store.getState().sendMessage('#secure', 'transient plaintext');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.sealRoomMessage).toHaveBeenCalledWith('#secure', 'transient plaintext');
    expect(FakeWebSocket.latest!.send.mock.calls.map(([line]) => String(line))).toContain('@+onyx/e2ee=mls PRIVMSG #secure :ONYXROOM1 ciphertext\r\n');
    const message = store.getState().channels.get('#secure')?.messages[0];
    expect(message).toMatchObject({ text: 'ONYXROOM1 ciphertext', plaintext: 'transient plaintext', encrypted: true, e2ee: 'mls' });
  });

  it('seals required-room user input even when it resembles a prewrapped envelope', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    bridge.sealRoomMessage.mockResolvedValueOnce({ ok: true, status: 'sealed', room: '#secure', epoch: 1, envelope: 'ONYXROOM1 freshly-sealed' });
    store.setState({
      channelProps: new Map([['#secure', { 'encryption-policy': 'required' }]]),
      channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]),
    });

    store.getState().sendMessage('#secure', 'ONYXROOM1 attacker-controlled-input');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridge.sealRoomMessage).toHaveBeenCalledWith('#secure', 'ONYXROOM1 attacker-controlled-input');
    const wire = FakeWebSocket.latest!.send.mock.calls.map(([line]) => String(line));
    expect(wire).toContain('@+onyx/e2ee=mls PRIVMSG #secure :ONYXROOM1 freshly-sealed\r\n');
    expect(wire.join('')).not.toContain('PRIVMSG #secure :ONYXROOM1 attacker-controlled-input');
  });

  it('refuses required-room sends while offline without persisting plaintext or adding a placeholder', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    store.setState({
      client: null,
      connectionStatus: 'disconnected',
      channelProps: new Map([['#secure', { 'encryption-policy': 'required' }]]),
      channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]),
    });

    store.getState().sendMessage('#secure', 'offline secret');
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await loadOutbox()).toEqual([]);
    expect(store.getState().channels.get('#secure')?.messages).toEqual([]);
    expect(store.getState().toasts.at(-1)?.title).toBe("Can't queue encrypted room message");
  });

  it('fails closed for a required-room seal failure and ignores stale completion', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    let release!: (value: { ok: true; status: 'sealed'; room: string; epoch: number; envelope: string }) => void;
    bridge.sealRoomMessage.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    store.setState({ channelProps: new Map([['#secure', { 'encryption-policy': 'required' }]]) });
    store.getState().sendMessage('#secure', 'must not send');
    store.getState().disconnect();
    release({ ok: true, status: 'sealed', room: '#secure', epoch: 1, envelope: 'ONYXROOM1 stale' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeWebSocket.latest!.send.mock.calls.map(([line]) => String(line)).join('')).not.toContain('ONYXROOM1 stale');

    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    currentBridge().sealRoomMessage.mockResolvedValueOnce({ ok: false, status: 'locked', reason: 'recovery-required' });
    store.getState().sendMessage('#secure', 'blocked');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().toasts.at(-1)?.title).toBe('Encrypted room is locked');
  });

  it('opens live and CHATHISTORY room envelopes transiently while retaining ciphertext', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    bridge.openRoomMessage
      .mockResolvedValueOnce({ ok: true, status: 'opened', room: '#secure', epoch: 1, plaintext: 'live plaintext' })
      .mockResolvedValueOnce({ ok: true, status: 'opened', room: '#secure', epoch: 1, plaintext: 'history plaintext' });
    store.setState({ channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]) });
    receive('@msgid=live;+onyx/e2ee=mls :bob!u@h PRIVMSG #secure :ONYXROOM1 live');
    await new Promise((resolve) => setTimeout(resolve, 0));
    let message = store.getState().channels.get('#secure')?.messages.at(-1);
    expect(message).toMatchObject({ id: 'live', text: 'ONYXROOM1 live', plaintext: 'live plaintext', encrypted: true });
    receive('BATCH +history chathistory #secure');
    receive('@batch=history;msgid=old;+onyx/e2ee=mls :bob!u@h PRIVMSG #secure :ONYXROOM1 old');
    receive('BATCH -history');
    await new Promise((resolve) => setTimeout(resolve, 0));
    message = store.getState().channels.get('#secure')?.messages.find((entry) => entry.id === 'old');
    expect(message).toMatchObject({ text: 'ONYXROOM1 old', plaintext: 'history plaintext', encrypted: true });
    expect(bridge.openRoomMessage).toHaveBeenCalledWith('#secure', 'ONYXROOM1 live');
    expect(bridge.openRoomMessage).toHaveBeenCalledWith('#secure', 'ONYXROOM1 old');
  });

  it('notifies a live s.channels subscriber when a room envelope opens (reactive read, not just state)', async () => {
    // _openGroupRoomMessage used to mutate `message.plaintext` on the live
    // object BEFORE the immutable `set(...)` that follows it. That mutation
    // made the set's own `current.plaintext !== undefined` guard see the
    // already-updated value, so `changed` stayed false, `set` returned `{}`,
    // and `s.channels` kept its old reference — a `useStore(s => s.channels)`
    // subscriber (e.g. MessageView) never fired and the row stayed on the
    // locked placeholder until an unrelated update rebuilt the array. Reading
    // state after the fact (`store.getState()`) cannot catch this — it must
    // assert the subscriber itself fires.
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    bridge.openRoomMessage.mockResolvedValueOnce({ ok: true, status: 'opened', room: '#secure', epoch: 1, plaintext: 'reactive plaintext' });
    store.setState({ channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]) });

    const spy = vi.fn();
    const unsubscribe = store.subscribe((s) => s.channels, spy);
    try {
      // The synchronous PRIVMSG handling adds the ciphertext row (a
      // legitimate, expected notification) before the async decrypt even
      // starts. Snapshot the call count AFTER that settles so the assertion
      // below isolates the notification the async `.then()` must produce —
      // asserting `toHaveBeenCalled()` on the raw spy would trivially pass
      // off that first, unrelated notification even with the bug present.
      receive('@msgid=live;+onyx/e2ee=mls :bob!u@h PRIVMSG #secure :ONYXROOM1 live');
      const callsBeforeDecrypt = spy.mock.calls.length;
      expect(callsBeforeDecrypt).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spy.mock.calls.length).toBeGreaterThan(callsBeforeDecrypt);
      const message = store.getState().channels.get('#secure')?.messages.at(-1);
      expect(message).toMatchObject({ id: 'live', plaintext: 'reactive plaintext' });
    } finally {
      unsubscribe();
    }
  });

  it('keeps failed and stale room opens ciphertext-only', async () => {
    store.getState().connect({ url: 'wss://example.test/irc', nick: 'alice' });
    receive(':example.test 001 alice :Welcome');
    const bridge = currentBridge();
    bridge.openRoomMessage.mockResolvedValueOnce({ ok: false, status: 'locked', reason: 'session-not-provisioned' });
    store.setState({ channels: new Map([['#secure', { name: '#secure', topic: '', topicSetBy: '', topicSetAt: null, modes: '', users: new Map(), unread: 0, highlights: 0, createdAt: null, messages: [] }]]) });
    receive('@msgid=locked;+onyx/e2ee=mls :bob!u@h PRIVMSG #secure :ONYXROOM1 locked');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const locked = store.getState().channels.get('#secure')?.messages.at(-1);
    expect(locked).toMatchObject({ text: 'ONYXROOM1 locked', encrypted: true });
    expect(locked?.plaintext).toBeUndefined();

    let release!: (value: { ok: true; status: 'opened'; room: string; epoch: number; plaintext: string }) => void;
    bridge.openRoomMessage.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    receive('@msgid=stale;+onyx/e2ee=mls :bob!u@h PRIVMSG #secure :ONYXROOM1 stale');
    store.getState().disconnect();
    release({ ok: true, status: 'opened', room: '#secure', epoch: 1, plaintext: 'must not attach' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().channels.get('#secure')?.messages.find((entry) => entry.id === 'stale')?.plaintext).toBeUndefined();
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
