// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.labeledResponse.test.ts — IRCv3 labeled-response correlation (Era 1 A7).
 *
 * Online optimistic send stamps `@label=`, shows a pending row, and replaces it
 * with the server's labeled echo (msgid) or promotes on bare ACK. Outbox flush
 * reuses the durable placeholder id for the same correlation.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store, _resetBatchCollectorsForTests } from './store';
import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { _resetLabelCounterForTests } from '@/lib/irc/labels';
import { _resetVaultForTests, loadOutbox } from '@/lib/vault/historyVault';

const initialState = store.getInitialState();

const server = {
  id: 'label-test',
  name: 'Onyx',
  network: 'Onyx',
  url: 'wss://example.test',
  icon: '',
  nick: 'me',
  account: 'me',
  connected: true,
};

function channel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

type MockClient = {
  negotiatedCaps: Set<string>;
  capValues: Map<string, string>;
  isupport: { CHANTYPES: string };
  prefixToMode: Record<string, string>;
  sendRaw: ReturnType<typeof vi.fn<(...args: string[]) => boolean>>;
  send: ReturnType<typeof vi.fn<(line: string) => boolean>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
};

function mockClient(caps: string[] = ['labeled-response', 'echo-message', 'batch']): MockClient {
  return {
    negotiatedCaps: new Set(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw: vi.fn((..._args: string[]) => true),
    send: vi.fn((_line: string) => true),
    destroy: vi.fn(),
  };
}

function clientOf(): MockClient {
  return store.getState().client as unknown as MockClient;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function messages(target = '#room') {
  return store.getState().channels.get(target.toLowerCase())?.messages ?? [];
}

/** Pull the `@label=` value from an outbound tagged line (tests only). */
function labelFromWire(wire: string): string {
  const match = /^@label=([^ ]+) /.exec(wire) ?? /(?:^|;)label=([^ ;]+)/.exec(wire);
  const label = match?.[1];
  if (!label) throw new Error(`no @label= in wire: ${wire}`);
  return label;
}

async function until(ok: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetVaultForTests();
  _resetBatchCollectorsForTests();
  _resetLabelCounterForTests();
  store.setState(
    {
      ...initialState,
      ourNick: 'me',
      server,
      connectionStatus: 'connected',
      client: mockClient() as never,
      channels: new Map([['#room', channel('#room')]]),
    },
    true,
  );
});

describe('labeled-response online send', () => {
  it('stamps @label= on PRIVMSG and shows a pending optimistic row', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'hello labeled');

    expect(client.send).toHaveBeenCalledTimes(1);
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    expect(wire).toMatch(/^@label=[^ ]+ PRIVMSG #room :hello labeled\r\n$/);

    const label = labelFromWire(wire);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({
      id: `label:${label}`,
      text: 'hello labeled',
      pending: true,
      from: 'me',
    });
  });

  it('replaces the pending row with the labeled echo msgid', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'echo me');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    feed(`@label=${label};msgid=srv-42;time=2026-07-19T12:00:00.000Z :me!u@h PRIVMSG #room :echo me`);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({
      id: 'srv-42',
      text: 'echo me',
      from: 'me',
    });
    expect(messages()[0]!.pending).toBeUndefined();
  });

  it('promotes the pending row on a bare labeled ACK (no echo-message body)', () => {
    store.setState({
      client: mockClient(['labeled-response', 'batch']) as never,
    });
    const client = clientOf();
    store.getState().sendMessage('#room', 'ack only');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);
    expect(messages()[0]?.pending).toBe(true);

    feed(`@label=${label} :irc.example ACK`);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.pending).toBeUndefined();
    expect(messages()[0]?.text).toBe('ack only');
    expect(messages()[0]?.id).not.toBe(`label:${label}`);
  });

  it('drops the pending row and toasts on a labeled 404', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'blocked');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    feed(`@label=${label} :irc.example 404 me #room :Cannot send to channel`);
    expect(messages()).toHaveLength(0);
    expect(store.getState().toasts.some((t) => t.title === 'Message not delivered')).toBe(true);
  });

  it('does not stamp labels when the cap was not negotiated', () => {
    store.setState({
      client: mockClient([]) as never,
    });
    const client = clientOf();
    store.getState().sendMessage('#room', 'plain');
    expect(client.sendRaw).toHaveBeenCalledWith('PRIVMSG', '#room', 'plain');
    expect(client.send).not.toHaveBeenCalled();
    // Without echo-message, local non-pending echo is added.
    expect(messages()[0]).toMatchObject({ text: 'plain' });
    expect(messages()[0]!.pending).toBeUndefined();
    expect(messages()[0]!.id.startsWith('label:')).toBe(false);
  });

  it('includes label with topic tags on a single-line send', () => {
    store.getState().setActiveChannelTopic('#room', 'roadmap');
    const client = clientOf();
    store.getState().sendMessage('#room', 'tagged');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    expect(wire).toMatch(/^@onyx\/topic=roadmap;label=[^ ]+ PRIVMSG #room tagged\r\n$/);
  });
});

describe('labeled-response outbox flush', () => {
  it('correlates the outbox placeholder via @label= until the labeled echo', async () => {
    store.setState({ connectionStatus: 'disconnected', client: null });
    store.getState().sendMessage('#room', 'queued labeled');
    await until(async () => (await loadOutbox()).length === 1);
    await until(() => messages().some((m) => m.pending));
    const [entry] = await loadOutbox();
    const placeholderId = `outbox:${entry!.id}`;
    expect(messages()[0]?.id).toBe(placeholderId);

    const client = mockClient(['labeled-response', 'echo-message', 'batch']);
    store.setState({ connectionStatus: 'connected', client: client as never });
    store.getState().flushOutbox();

    await until(() => client.send.mock.calls.length > 0);
    await until(async () => (await loadOutbox()).length === 0);

    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    expect(wire).toMatch(/^@label=[^ ]+ PRIVMSG #room :queued labeled\r\n$/);
    const label = labelFromWire(wire);

    // Durable gone; UI still pending until the labeled echo.
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ id: placeholderId, pending: true });

    feed(`@label=${label};msgid=out-9 :me!u@h PRIVMSG #room :queued labeled`);

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ id: 'out-9', text: 'queued labeled' });
    expect(messages()[0]!.pending).toBeUndefined();
  });

  it('promotes the outbox placeholder on a bare labeled ACK after flush', async () => {
    store.setState({ connectionStatus: 'disconnected', client: null });
    store.getState().sendMessage('#room', 'queued ack');
    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    const placeholderId = `outbox:${entry!.id}`;

    const client = mockClient(['labeled-response', 'batch']);
    store.setState({ connectionStatus: 'connected', client: client as never });
    store.getState().flushOutbox();
    await until(() => client.send.mock.calls.length > 0);
    await until(async () => (await loadOutbox()).length === 0);

    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);
    expect(messages()[0]).toMatchObject({ id: placeholderId, pending: true });

    feed(`@label=${label} :irc.example ACK`);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.pending).toBeUndefined();
    expect(messages()[0]?.text).toBe('queued ack');
    expect(messages()[0]?.id).not.toBe(placeholderId);
  });

  it('drops the outbox placeholder and toasts on labeled FAIL after flush', async () => {
    store.setState({ connectionStatus: 'disconnected', client: null });
    store.getState().sendMessage('#room', 'queued fail');
    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    const placeholderId = `outbox:${entry!.id}`;

    const client = mockClient(['labeled-response', 'echo-message', 'batch']);
    store.setState({ connectionStatus: 'connected', client: client as never });
    store.getState().flushOutbox();
    await until(() => client.send.mock.calls.length > 0);
    await until(async () => (await loadOutbox()).length === 0);

    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);
    expect(messages()[0]?.id).toBe(placeholderId);

    feed(`@label=${label} FAIL PRIVMSG CANNOT_SEND :Cannot send to channel`);
    expect(messages()).toHaveLength(0);
    expect(store.getState().toasts.some((t) => t.title === 'Message not delivered')).toBe(true);
  });

  it('keeps durable outbox + pending UI when socket admission fails under labeled-response', async () => {
    store.setState({ connectionStatus: 'disconnected', client: null });
    store.getState().sendMessage('#room', 'stuck admission');
    await until(async () => (await loadOutbox()).length === 1);
    await until(() => messages().some((m) => m.pending));
    const [entryBefore] = await loadOutbox();
    const placeholderBefore = messages().find((m) => m.pending);

    const client = mockClient(['labeled-response', 'echo-message', 'batch']);
    client.send = vi.fn((_line: string) => false);
    store.setState({ connectionStatus: 'connected', client: client as never });
    store.getState().flushOutbox();
    await until(() => client.send.mock.calls.length > 0);

    expect(await loadOutbox()).toEqual([entryBefore]);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toBe(placeholderBefore);
    expect(messages()[0]?.pending).toBe(true);
    expect(store.getState().toasts.some((t) => t.title.includes('sent'))).toBe(false);
  });
});

describe('labeled-response FAIL / batch / hostile', () => {
  it('drops the pending row on a labeled standard-reply FAIL', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'policy blocked');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    feed(`@label=${label} FAIL PRIVMSG NEEDREGGEDNICK :You need to be logged in`);
    expect(messages()).toHaveLength(0);
    expect(store.getState().toasts.some((t) => t.title === 'Message not delivered')).toBe(true);
  });

  it('resolves via a labeled-response batch that wraps the self-echo', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'batched echo');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    feed(`@label=${label} BATCH +lr1 labeled-response`);    feed(`@batch=lr1;msgid=b-1;label=${label} :me!u@h PRIVMSG #room :batched echo`);
    feed('BATCH -lr1');

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ id: 'b-1', text: 'batched echo' });
    expect(messages()[0]!.pending).toBeUndefined();
  });

  it('promotes on an empty labeled-response batch (ACK-equivalent)', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'empty batch');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);
    expect(messages()[0]?.pending).toBe(true);
    feed(`@label=${label} BATCH +lr2 labeled-response`);
    feed('BATCH -lr2');

    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.pending).toBeUndefined();
    expect(messages()[0]?.text).toBe('empty batch');
  });

  it('ignores hostile inbound labels that do not match a pending send', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'mine');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    // Foreign label must not steal or clear our pending correlation.
    feed('@label=not-ours;msgid=evil :me!u@h PRIVMSG #room :mine');
    expect(messages().some((m) => m.id === `label:${label}` && m.pending)).toBe(true);

    // Invalid (space-bearing after unescape) labels are refused by isValidLabel.
    feed('@label=bad\\slabel;msgid=x :me!u@h PRIVMSG #room :mine');
    expect(messages().some((m) => m.id === `label:${label}` && m.pending)).toBe(true);

    // Real match still resolves the pending row (foreign + invalid already landed).
    feed(`@label=${label};msgid=ok :me!u@h PRIVMSG #room :mine`);
    expect(messages().some((m) => m.id === 'ok' && !m.pending)).toBe(true);
    expect(messages().some((m) => m.id === `label:${label}`)).toBe(false);
    expect(messages().some((m) => m.id === 'evil')).toBe(true);
  });

  it('does not resolve a labeled echo from another nick', () => {
    const client = clientOf();
    store.getState().sendMessage('#room', 'only mine');
    const wire = String(client.send.mock.calls[0]?.[0] ?? '');
    const label = labelFromWire(wire);

    feed(`@label=${label};msgid=other :eve!u@h PRIVMSG #room :only mine`);    expect(messages().some((m) => m.id === `label:${label}` && m.pending)).toBe(true);
    // Eve's line is a live message; our pending stays until a self-echo.
    expect(messages().some((m) => m.id === 'other' && m.from === 'eve')).toBe(true);
  });
});

describe('labeled-response disconnect promote', () => {
  it('promotes wire-admitted pending rows on socket drop without wiping the buffer', () => {
    // Full disconnect() clears channels; the production flap path is
    // IRCClient.onDisconnected, which keeps the conversation buffer and must
    // still clear pending chrome so rows never hang as "sending…".
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      binaryType = '';
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readonly send = vi.fn();
      close(): void {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'me',
      });
      const live = store.getState().client as unknown as {
        negotiatedCaps: Set<string>;
        isupport: { CHANTYPES: string };
        send: (line: string) => boolean;
        sendRaw: (...args: string[]) => boolean;
        opts: { onDisconnected?: (reason: string) => void };
      };
      // Negotiate the caps the optimistic path needs, then restore the room.
      live.negotiatedCaps = new Set(['labeled-response', 'echo-message', 'batch']);
      live.isupport = { CHANTYPES: '#&' };
      live.send = vi.fn(() => true);
      live.sendRaw = vi.fn(() => true);
      store.setState({
        ourNick: 'me',
        connectionStatus: 'connected',
        server: { ...server, connected: true },
        channels: new Map([['#room', channel('#room')]]),
      });

      store.getState().sendMessage('#room', 'in flight');
      const wire = String((live.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      const label = labelFromWire(wire);
      expect(messages()[0]).toMatchObject({ id: `label:${label}`, pending: true, text: 'in flight' });
      live.opts.onDisconnected?.('socket closed');

      expect(messages()).toHaveLength(1);
      expect(messages()[0]?.text).toBe('in flight');
      expect(messages()[0]?.pending).toBeUndefined();
      expect(messages()[0]?.id).not.toBe(`label:${label}`);
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });
});
