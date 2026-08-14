// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi } from 'vitest';
import { IRCClient, MAX_CLIENT_ISUPPORT_TOKENS } from './client';
import { _resetDeviceSigningForTests } from '../e2ee/deviceSign';
import type { IRCMessage } from './types';

const MIB = 1024 * 1024;

interface TestSocket {
  readyState: number;
  bufferedAmount: number;
  protocol?: string;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

function attachSocket(client: IRCClient, overrides: Partial<TestSocket> = {}) {
  const sent: unknown[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const socket: TestSocket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (data) => sent.push(data),
    close: (code, reason) => closed.push({ code, reason }),
    ...overrides,
  };
  (client as unknown as { ws: TestSocket }).ws = socket;
  return { socket, sent, closed };
}

// Regression tests for the WebSocket framing gotcha (memory: Onyx Server wss sends one IRC
// message per frame with NO trailing CRLF; clients must split on /\r?\n/ and must NOT
// buffer a remainder across frames). _onMessage is driven directly — no socket needed.
function makeClient(): { client: IRCClient; commands: string[] } {
  const commands: string[] = [];
  const client = new IRCClient({
    url: 'wss://ircx.us:8080/',
    nick: 'onyx',
    onMessage: (m: IRCMessage) => commands.push(m.command),
  });
  return { client, commands };
}

function feed(client: IRCClient, data: string): void {
  (client as unknown as { _onMessage(ev: { data: string }): void })._onMessage({ data });
}

describe('IRCClient WebSocket subprotocol', () => {
  it('prefers the Onyx media protocol and offers text.ircv3.net as fallback', () => {
    const constructions: Array<{ url: string | URL; protocols?: string | string[] }> = [];
    const sockets: Array<{
      onopen: ((e: Event) => void) | null;
      send: ReturnType<typeof vi.fn>;
    }> = [];
    class StubWS {
      static OPEN = 1;
      readyState = StubWS.OPEN;
      bufferedAmount = 0;
      binaryType = '';
      protocol = 'onyx.irc-media.v1';
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(url: string | URL, protocols?: string | string[]) {
        constructions.push({ url, protocols });
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', StubWS);
    try {
      const client = new IRCClient({
        url: 'wss://ircx.us:8080/',
        nick: 'onyx',
        onMessage: () => {},
      });

      expect(client.connect()).toBe(true);
      expect(client.socketGeneration).toBe(1);
      expect(constructions).toEqual([{
        url: 'wss://ircx.us:8080/',
        protocols: ['onyx.irc-media.v1', 'text.ircv3.net'],
      }]);
      sockets[0]?.onopen?.(new Event('open'));
      expect(sockets[0]?.send.mock.calls.slice(0, 3).map(([payload]) => payload)).toEqual([
        'CAP LS 302\r\n',
        'NICK onyx\r\n',
        'USER webchat 0 * :onyx (webchat)\r\n',
      ]);

      // The store's reconnect path reuses the same client and calls connect();
      // connect itself closes and detaches the prior socket before replacing it.
      expect(client.connect()).toBe(true);
      expect(client.socketGeneration).toBe(2);
      expect(constructions).toHaveLength(2);
      expect(constructions[1]).toEqual(constructions[0]);
      sockets[1]?.onopen?.(new Event('open'));
      expect(sockets[1]?.send.mock.calls.slice(0, 3).map(([payload]) => payload)).toEqual(
        sockets[0]?.send.mock.calls.slice(0, 3).map(([payload]) => payload),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores a queued stale open event after reconnect replaces its socket', () => {
    const sockets: Array<{
      protocol: string;
      onopen: ((e: Event) => void) | null;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    class StubWS {
      static OPEN = 1;
      readyState = StubWS.OPEN;
      bufferedAmount = 0;
      binaryType = '';
      protocol = '';
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', StubWS);
    try {
      const client = new IRCClient({
        url: 'wss://ircx.us:8080/',
        nick: 'onyx',
        onMessage: () => {},
      });
      expect(client.connect()).toBe(true);
      const queuedStaleOpen = sockets[0]?.onopen;

      expect(client.connect()).toBe(true);
      expect(sockets[0]?.onopen).toBeNull();
      queuedStaleOpen?.(new Event('open'));

      expect(sockets[1]?.send).not.toHaveBeenCalled();
      expect(sockets[1]?.close).not.toHaveBeenCalled();

      if (sockets[1]) sockets[1].protocol = 'onyx.irc-media.v1';
      sockets[1]?.onopen?.(new Event('open'));
      expect(sockets[1]?.send.mock.calls.slice(0, 3).map(([payload]) => payload)).toEqual([
        'CAP LS 302\r\n',
        'NICK onyx\r\n',
        'USER webchat 0 * :onyx (webchat)\r\n',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removes one terminal CRLF from registration frames on text.ircv3.net, including reconnect', () => {
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
    });

    const first = attachSocket(client, { protocol: 'text.ircv3.net' });
    (client as unknown as { _onOpen(): void })._onOpen();
    expect(first.sent.slice(0, 3)).toEqual([
      'CAP LS 302',
      'NICK onyx',
      'USER webchat 0 * :onyx (webchat)',
    ]);

    const reconnect = attachSocket(client, { protocol: 'text.ircv3.net' });
    (client as unknown as { _onOpen(): void })._onOpen();
    expect(reconnect.sent.slice(0, 3)).toEqual(first.sent.slice(0, 3));
  });

  it.each(['', 'chat.v1'])('fails closed before registration when the server selects %j', (protocol) => {
    const errors: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      onError: (error) => errors.push(error),
    });
    const { sent, closed } = attachSocket(client, { protocol });

    (client as unknown as { _onOpen(): void })._onOpen();

    expect(sent).toEqual([]);
    expect(closed).toEqual([{ code: 1002, reason: 'WebSocket subprotocol required' }]);
    expect(errors).toEqual([
      'WebSocket protocol error: the server did not select a supported subprotocol.',
    ]);
  });

  it('keeps CRLF and binary media on the Onyx multiplexed protocol', () => {
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
    });
    const { sent } = attachSocket(client, { protocol: 'onyx.irc-media.v1' });
    (client as unknown as { _onOpen(): void })._onOpen();
    expect(sent.slice(0, 3)).toEqual([
      'CAP LS 302\r\n',
      'NICK onyx\r\n',
      'USER webchat 0 * :onyx (webchat)\r\n',
    ]);
    expect(client.sendBinary(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(sent[3]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects multiline text and binary media on text.ircv3.net', () => {
    const errors: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      onError: (error) => errors.push(error),
    });
    const { sent } = attachSocket(client, { protocol: 'text.ircv3.net' });
    expect(client.send('PRIVMSG #root :one\r\nPRIVMSG #root :two\r\n')).toBe(false);
    expect(client.sendBinary(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(sent).toEqual([]);
    expect(errors).toEqual([
      'Message was not sent: text.ircv3.net requires exactly one IRC line per frame.',
    ]);
  });

  it.each([
    { payload: '', label: 'empty' },
    { payload: ':s NOTICE * :one\r\n:s NOTICE * :two', label: 'CRLF-batched' },
  ])('closes on an inbound $label text.ircv3.net message before dispatch', ({ payload }) => {
    const commands: string[] = [];
    const errors: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: (message) => commands.push(message.command),
      onError: (error) => errors.push(error),
    });
    const { closed } = attachSocket(client, { protocol: 'text.ircv3.net' });

    feed(client, payload);

    expect(commands).toEqual([]);
    expect(errors).toEqual([
      'WebSocket protocol error: text.ircv3.net requires exactly one non-empty IRC line per frame.',
    ]);
    expect(closed).toEqual([{ code: 1002, reason: 'Invalid text.ircv3.net frame' }]);
  });
});

describe('IRCClient WebSocket frame handling', () => {
  it('never retries a registered nickname as an anonymous alias', () => {
    const errors: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'alice',
      onMessage: () => {},
      onError: (error) => errors.push(error),
    });
    const { sent, closed } = attachSocket(client);

    feed(client, ':onyx 432 * alice :Nickname is registered; authenticate as this account before using it');

    expect(sent).toEqual([]);
    expect(errors).toEqual([
      'That nickname is registered. Sign in as its account before using it.',
    ]);
    expect(closed).toEqual([{
      code: 4003,
      reason: 'Registered nickname requires authentication',
    }]);
  });

  it('processes a single frame that has NO trailing CRLF', () => {
    const { client, commands } = makeClient();
    feed(client, ':eshmaki.me NOTICE * :no trailing newline here');
    expect(commands).toEqual(['NOTICE']);
  });

  it('processes several CRLF-separated lines batched in one frame', () => {
    const { client, commands } = makeClient();
    feed(client, ':s NOTICE * :one\r\n:s NOTICE * :two\r\n:s NOTICE * :three');
    expect(commands).toEqual(['NOTICE', 'NOTICE', 'NOTICE']);
  });

  it('never carries a remainder across two CRLF-less frames', () => {
    const { client, commands } = makeClient();
    feed(client, ':s NOTICE * :frame-a');
    feed(client, ':s NOTICE * :frame-b');
    expect(commands).toEqual(['NOTICE', 'NOTICE']);
  });

  it('closes with 1009 before parsing an oversized UTF-8 text frame', () => {
    const commands: string[] = [];
    const errors: string[] = [];
    const raw: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: (message) => commands.push(message.command),
      onRaw: (line) => raw.push(line),
      onError: (error) => errors.push(error),
    });
    const { closed } = attachSocket(client);

    // Each astral character occupies two UTF-16 code units but four UTF-8
    // bytes. This stays below the code-unit guard while exceeding 1 MiB on the
    // wire, pinning the byte-bound rather than merely the allocation fast path.
    feed(client, '🌊'.repeat((MIB / 4) + 1));

    expect(commands).toEqual([]);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['WebSocket text frame exceeded the client safety limit.']);
    expect(closed).toEqual([{ code: 1009, reason: 'WebSocket frame too large' }]);
  });
});

describe('IRCClient ISUPPORT bounds', () => {
  it('retains the last valid CHANLIMIT map after malformed updates', () => {
    const { client } = makeClient();
    feed(client, ':server 005 onyx CHANLIMIT=#&:25,!:10 :are supported');
    expect(client.isupport.CHANLIMITS).toEqual({ '#': 25, '&': 25, '!': 10 });
    expect(client.isupport.MAXCHANNELS).toBe(25);

    feed(client, ':server 005 onyx CHANLIMIT=#:25junk :are supported');
    expect(client.isupport.CHANLIMITS).toEqual({ '#': 25, '&': 25, '!': 10 });
    expect(client.isupport.MAXCHANNELS).toBe(25);
  });

  it('retains valid numeric defaults after partial or unbounded values', () => {
    const { client } = makeClient();
    feed(client, ':server 005 onyx NICKLEN=96 TOPICLEN=512 MAXCHANNELS=75 MODES=8 SILENCE=32 :supported');
    expect(client.isupport).toMatchObject({
      NICKLEN: 96, TOPICLEN: 512, MAXCHANNELS: 75, MODES: 8, SILENCE: 32,
    });

    feed(client, ':server 005 onyx NICKLEN=96junk TOPICLEN=-1 MAXCHANNELS=0 MODES=Infinity SILENCE=1000001 :supported');
    expect(client.isupport).toMatchObject({
      NICKLEN: 96, TOPICLEN: 512, MAXCHANNELS: 75, MODES: 8, SILENCE: 32,
    });
  });

  it('caps token work and rejects oversized or noncanonical keys', () => {
    const { client } = makeClient();
    const tokens = Array.from(
      { length: MAX_CLIENT_ISUPPORT_TOKENS },
      (_, index) => `UNKNOWN${index}=value`,
    ).join(' ');
    feed(client, `:server 005 onyx ${tokens} NETWORK=overflow :supported`);
    expect(client.isupport.NETWORK).toBe('Onyx');

    feed(client, `:server 005 onyx NETWORK=${'x'.repeat(1025)} lowercase=bad :supported`);
    expect(client.isupport.NETWORK).toBe('Onyx');
  });

  it('retains valid structural features after ambiguous updates', () => {
    const { client } = makeClient();
    feed(client, ':server 005 onyx NETWORK=Onyx CHANTYPES=#& CASEMAPPING=strict-rfc1459 CHANMODES=beI,k,lf,imnst :supported');
    expect(client.isupport).toMatchObject({
      NETWORK: 'Onyx',
      CHANTYPES: '#&',
      CASEMAPPING: 'strict-rfc1459',
      CHANMODES: ['beI', 'k', 'lf', 'imnst'],
    });

    feed(client, ':server 005 onyx NETWORK CHANTYPES=ab CASEMAPPING=unknown CHANMODES=beI,k,lf :supported');
    expect(client.isupport).toMatchObject({
      NETWORK: 'Onyx',
      CHANTYPES: '#&',
      CASEMAPPING: 'strict-rfc1459',
      CHANMODES: ['beI', 'k', 'lf', 'imnst'],
    });
  });
});

describe('IRCClient binary media plane', () => {
  function feedBinary(client: IRCClient, bytes: Uint8Array): void {
    (client as unknown as { _onMessage(ev: { data: ArrayBuffer }): void })._onMessage({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
  }

  it('routes a binary frame to onBinary and binaryHandlers, never to onMessage', () => {
    const commands: string[] = [];
    const viaOption: Uint8Array[] = [];
    const viaHandler: Uint8Array[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: (m: IRCMessage) => commands.push(m.command),
      onBinary: (b) => viaOption.push(b),
    });
    client.binaryHandlers.add((b) => viaHandler.push(b));

    feedBinary(client, new Uint8Array([1, 2, 3, 4]));

    expect(commands).toEqual([]); // binary never reaches the IRC line parser
    expect(viaOption).toHaveLength(1);
    expect(Array.from(viaOption[0]!)).toEqual([1, 2, 3, 4]);
    expect(viaHandler).toHaveLength(1);
    expect(Array.from(viaHandler[0]!)).toEqual([1, 2, 3, 4]);
  });

  it('ignores an empty binary frame', () => {
    const viaOption: Uint8Array[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      onBinary: (b) => viaOption.push(b),
    });
    feedBinary(client, new Uint8Array(0));
    expect(viaOption).toEqual([]);
  });

  it('still parses text frames after a binary frame (no state bleed)', () => {
    const commands: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: (m: IRCMessage) => commands.push(m.command),
    });
    feedBinary(client, new Uint8Array([9, 9]));
    (client as unknown as { _onMessage(ev: { data: string }): void })._onMessage({ data: ':s NOTICE * :hi' });
    expect(commands).toEqual(['NOTICE']);
  });

  it('closes with 1009 before dispatching an oversized binary frame', () => {
    const viaOption: Uint8Array[] = [];
    const errors: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      onBinary: (bytes) => viaOption.push(bytes),
      onError: (error) => errors.push(error),
    });
    const viaHandler = vi.fn();
    client.binaryHandlers.add(viaHandler);
    const { closed } = attachSocket(client);

    feedBinary(client, new Uint8Array((4 * MIB) + 1));

    expect(viaOption).toEqual([]);
    expect(viaHandler).not.toHaveBeenCalled();
    expect(errors).toEqual(['WebSocket binary frame exceeded the client safety limit.']);
    expect(closed).toEqual([{ code: 1009, reason: 'WebSocket frame too large' }]);
  });
});

describe('IRCClient bounded WebSocket sends', () => {
  function makeSendClient() {
    const errors: string[] = [];
    const raw: Array<{ line: string; direction: 'in' | 'out' }> = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      onError: (error) => errors.push(error),
      onRaw: (line, direction) => raw.push({ line, direction }),
    });
    return { client, errors, raw };
  }

  it('returns true and logs only after an ordered text frame is accepted', () => {
    const { client, errors, raw } = makeSendClient();
    const { sent } = attachSocket(client);

    expect(client.sendRaw('PRIVMSG', '#room', 'hello')).toBe(true);
    expect(sent).toEqual(['PRIVMSG #room hello\r\n']);
    expect(raw).toEqual([{ line: 'PRIVMSG #room hello', direction: 'out' }]);
    expect(errors).toEqual([]);
  });

  it('rejects a closed socket with an explicit error and no raw-log entry', () => {
    const { client, errors, raw } = makeSendClient();
    const { sent } = attachSocket(client, { readyState: WebSocket.CLOSED });

    expect(client.sendRaw('PING', 'late')).toBe(false);
    expect(sent).toEqual([]);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['Message was not sent: the connection is not open.']);
  });

  it('reports a send throw without claiming the frame in the raw log', () => {
    const { client, errors, raw } = makeSendClient();
    attachSocket(client, { send: () => { throw new Error('socket raced'); } });

    expect(client.sendRaw('PING', 'race')).toBe(false);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['Message was not sent: the connection closed during send.']);
  });

  it('reports a synchronous OPEN-to-CLOSING race after send', () => {
    const { client, errors, raw } = makeSendClient();
    const { socket, sent } = attachSocket(client);
    socket.send = (data) => {
      sent.push(data);
      socket.readyState = WebSocket.CLOSING;
    };

    expect(client.sendRaw('PING', 'race')).toBe(false);
    expect(sent).toEqual(['PING race\r\n']);
    expect(raw).toEqual([]);
    expect(errors).toEqual([
      'Message delivery could not be confirmed: the connection closed during send.',
    ]);
  });

  it('closes a congested control socket before adding another text frame', () => {
    const { client, errors, raw } = makeSendClient();
    const { sent, closed } = attachSocket(client, { bufferedAmount: 8 * MIB });

    expect(client.sendRaw('PING', 'full')).toBe(false);
    expect(sent).toEqual([]);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['Message was not sent: the connection is congested. Reconnecting…']);
    expect(closed).toEqual([{ code: 4004, reason: 'Send buffer congested' }]);
  });

  it('fails closed when the browser reports a non-finite send queue', () => {
    const { client, errors } = makeSendClient();
    const { sent, closed } = attachSocket(client, { bufferedAmount: Number.NaN });

    expect(client.sendRaw('PING', 'unknown')).toBe(false);
    expect(sent).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(closed).toEqual([{ code: 4004, reason: 'Send buffer congested' }]);
  });

  it('rejects oversized UTF-8 text before send or logging', () => {
    const { client, errors, raw } = makeSendClient();
    const { sent } = attachSocket(client);

    expect(client.send('🌊'.repeat((MIB / 4) + 1))).toBe(false);
    expect(sent).toEqual([]);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['Message was not sent: the IRC frame is too large.']);
  });

  it('copies accepted binary data and sheds media under congestion', () => {
    const { client } = makeSendClient();
    const { socket, sent, closed } = attachSocket(client);
    const source = new Uint8Array([9, 1, 2, 8]).subarray(1, 3);

    expect(client.sendBinary(source)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(sent[0] as Uint8Array)).toEqual([1, 2]);
    expect(sent[0]).not.toBe(source);

    socket.bufferedAmount = 8 * MIB;
    expect(client.sendBinary(new Uint8Array([3]))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(closed).toEqual([]);
  });

  it('rejects an oversized outbound binary frame without touching the socket', () => {
    const { client } = makeSendClient();
    const { sent, closed } = attachSocket(client);

    expect(client.sendBinary(new Uint8Array((4 * MIB) + 1))).toBe(false);
    expect(sent).toEqual([]);
    expect(closed).toEqual([]);
  });
});

// ── Session-resume token refresh ───────────────────────────────────────────
// The server issues fresh resume tokens mid-session (NOTE SESSION TOKEN / MTOKEN);
// auto-reconnect reuses the SAME IRCClient instance (store: reconnectNow →
// client.connect()), so unless the refreshed token is pushed back into the live
// client, every reconnect replays the stale construction-time token — undefined
// for a session that began with no saved token — and resume silently fails.
describe('IRCClient session-resume token lifecycle', () => {
  /** Attach a fake OPEN socket that captures every outbound line. */
  function makeSessionClient(
    opts?: { sessionToken?: string; meshToken?: string },
    loggedIn = false,
  ) {
    const sent: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      sessionToken: opts?.sessionToken,
      meshToken: opts?.meshToken,
    });
    const priv = client as unknown as {
      ws: { readyState: number; bufferedAmount: number; send(l: string): void };
      _loggedIn: boolean;
      _onMessage(ev: { data: string }): void;
    };
    priv.ws = { readyState: WebSocket.OPEN, bufferedAmount: 0, send: (l: string) => sent.push(l) };
    priv._loggedIn = loggedIn;
    return {
      client,
      sent,
      feed001: () => priv._onMessage({ data: ':eshmaki.me 001 onyx :Welcome' }),
      feed900: () => priv._onMessage({
        data: ':eshmaki.me 900 onyx onyx!web@example onyx :You are now logged in as onyx',
      }),
    };
  }

  function makeLoggedInClient(opts?: { sessionToken?: string; meshToken?: string }) {
    return makeSessionClient(opts, true);
  }

  it('defers a passwordless remembered resume until post-registration account proof', () => {
    const { sent, feed001, feed900 } = makeSessionClient({ sessionToken: 'remembered-session' });
    feed001();
    expect(sent.some(line => line.startsWith('SESSION '))).toBe(false);

    feed900();
    expect(sent).toContain('SESSION RESUME remembered-session\r\n');
    expect(sent).toContain('SESSION TOKEN\r\n');
  });

  it('sends no SESSION commands for an ordinary fresh guest connection', () => {
    const { sent, feed001 } = makeSessionClient();
    feed001();
    expect(sent.filter(line => line.startsWith('SESSION '))).toEqual([]);
  });

  it('does not replay deferred SESSION commands when account proof repeats', () => {
    const { sent, feed001, feed900 } = makeSessionClient({ meshToken: 'remembered-mesh' });
    feed001();
    feed001();
    feed900();
    feed900();
    expect(sent.filter(line => line === 'SESSION RESUME remembered-mesh\r\n')).toHaveLength(1);
    expect(sent.filter(line => line === 'SESSION TOKEN\r\n')).toHaveLength(1);
  });

  it('requests a session token when a connected guest signs in later', () => {
    const { sent, feed001, feed900 } = makeSessionClient();
    feed001();
    expect(sent.filter(line => line.startsWith('SESSION '))).toEqual([]);

    feed900();
    expect(sent.filter(line => line.startsWith('SESSION '))).toEqual(['SESSION TOKEN\r\n']);
  });

  it('does not treat the short IRCX 900 error as account proof', () => {
    const { client, sent, feed001 } = makeSessionClient({ sessionToken: 'held-token' });
    const priv = client as unknown as { _onMessage(ev: { data: string }): void };
    feed001();
    priv._onMessage({ data: ':eshmaki.me 900 onyx :Bad command' });
    expect(sent.some(line => line.startsWith('SESSION '))).toBe(false);
  });

  it('requests a token for a fresh SASL login without trying to resume', () => {
    const { sent, feed001 } = makeLoggedInClient();
    feed001();
    expect(sent).toContain('SESSION TOKEN\r\n');
    expect(sent.some(line => line.startsWith('SESSION RESUME '))).toBe(false);
  });

  it('sends SESSION RESUME with the construction-time mesh token on 001', () => {
    const { sent, feed001 } = makeLoggedInClient({ sessionToken: 'local-A', meshToken: 'mesh-A' });
    feed001();
    // Prefers the mesh token over the local token (memory rule).
    expect(sent).toContain('SESSION RESUME mesh-A\r\n');
    expect(sent).not.toContain('SESSION RESUME local-A\r\n');
  });

  it('resumes with a token refreshed mid-session, not the stale construction token', () => {
    // Session began with NO saved token — the classic first-connect case.
    const { client, sent, feed001 } = makeLoggedInClient();
    // Server issued fresh tokens after the first registration; the store pushes
    // them back into the live client.
    client.updateResumeTokens({ sessionToken: 'local-fresh' });
    client.updateResumeTokens({ meshToken: 'mesh-fresh' });
    feed001();
    // The reconnect must resume with the freshest mesh token, not undefined.
    expect(sent).toContain('SESSION RESUME mesh-fresh\r\n');
  });

  it('a TOKEN refresh never clobbers a held MTOKEN (partial merge)', () => {
    const { client, sent, feed001 } = makeLoggedInClient({ meshToken: 'mesh-held' });
    // A later NOTE SESSION TOKEN updates only the local token.
    client.updateResumeTokens({ sessionToken: 'local-new' });
    feed001();
    // Mesh token still preferred and intact.
    expect(sent).toContain('SESSION RESUME mesh-held\r\n');
  });

  it('refuses to install an invalid resume token (fail-closed partial merge)', () => {
    const { client, sent, feed001 } = makeLoggedInClient({ meshToken: 'mesh-held' });
    // Hostile / buggy callers must not replace a good mesh token with garbage,
    // and must not install a space-bearing local token that would become a
    // colon-prefixed multi-word SESSION RESUME on the wire.
    client.updateResumeTokens({ meshToken: 'mesh with spaces' });
    client.updateResumeTokens({ sessionToken: 'tok\r\nPRIVMSG #x :pwned' });
    client.updateResumeTokens({ sessionToken: '' });
    client.updateResumeTokens({ sessionToken: 'x'.repeat(4 * 1024 + 1) });
    feed001();
    expect(sent).toContain('SESSION RESUME mesh-held\r\n');
    expect(sent.some(line => line.startsWith('SESSION RESUME ') && line !== 'SESSION RESUME mesh-held\r\n'))
      .toBe(false);
  });

  it('skips SESSION RESUME for construction-time invalid tokens', () => {
    const { client, sent, feed001 } = makeLoggedInClient({
      sessionToken: 'has space',
      meshToken: 'also bad\n',
    });
    // Constructor sanitizes fail-closed: garbage never sits in opts.
    expect((client as unknown as { opts: { sessionToken?: string; meshToken?: string } }).opts.sessionToken)
      .toBeUndefined();
    expect((client as unknown as { opts: { sessionToken?: string; meshToken?: string } }).opts.meshToken)
      .toBeUndefined();
    feed001();
    expect(sent.some(line => line.startsWith('SESSION RESUME '))).toBe(false);
    expect(sent).toContain('SESSION TOKEN\r\n');
  });

  it('falls through from an invalid mesh token to a valid local token', () => {
    // Constructor drops the bad mesh preference; the valid local bearer remains
    // and is the one emitted on SESSION RESUME.
    const { client, sent, feed001 } = makeLoggedInClient({
      sessionToken: 'local-ok',
      meshToken: 'bad mesh',
    });
    expect((client as unknown as { opts: { meshToken?: string } }).opts.meshToken).toBeUndefined();
    feed001();
    expect(sent).toContain('SESSION RESUME local-ok\r\n');
    expect(sent.some(line => line.includes('bad mesh'))).toBe(false);
  });

  it('clearResumeTokens forgets every bearer so the next 001 cannot resume', () => {
    const { client, sent, feed001 } = makeLoggedInClient({
      sessionToken: 'local-held',
      meshToken: 'mesh-held',
    });
    client.clearResumeTokens();
    feed001();
    expect(sent.some(line => line.startsWith('SESSION RESUME '))).toBe(false);
    expect(sent).toContain('SESSION TOKEN\r\n');
  });
});

describe('IRCClient account-attribution wiring (ACCOUNTRESIDENCE)', () => {
  // The controller itself is exercised in attribution.test.ts; these prove the
  // CLIENT feeds it: 900 → account, 005 ACCOUNTRESIDENCE → node, and that an
  // old server (no token) never triggers a single IDENTITY command.
  async function drive(lines: string[]): Promise<string[][]> {
    globalThis.indexedDB = new IDBFactory();
    _resetDeviceSigningForTests();
    localStorage.clear();

    const client = new IRCClient({ url: 'wss://x/', nick: 'kain', onMessage: () => {} });
    const sent: string[][] = [];
    const origSendRaw = client.sendRaw.bind(client);
    client.sendRaw = (command: string, ...params: string[]) => {
      if (command === 'IDENTITY') {
        sent.push([command, ...params]);
        return true;
      }
      return origSendRaw(command, ...params);
    };
    for (const line of lines) feed(client, line);
    return sent;
  }

  it('sends IDENTITY ADD + RESIDENCE after 900 login + advertised token', async () => {
    const sent = await drive([
      ':srv.example 900 kain kain!u@h kain :You are now logged in as kain',
      ':srv.example 005 kain ACCOUNTRESIDENCE=a1b2c3d4e5f60718 NICKLEN=64 :are supported by this server',
    ]);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[0]![1]).toBe('ADD');
    expect(sent[1]![1]).toBe('RESIDENCE');
    expect(sent[1]![2]).toBe('a1b2c3d4e5f60718');
  });

  it('never sends IDENTITY when the server does not advertise ACCOUNTRESIDENCE', async () => {
    const sent = await drive([
      ':srv.example 900 kain kain!u@h kain :You are now logged in as kain',
      ':srv.example 005 kain NICKLEN=64 TOPICLEN=390 :are supported by this server',
    ]);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toEqual([]);
  });

  it('never sends IDENTITY for an unauthenticated (guest) connection', async () => {
    const sent = await drive([
      ':srv.example 005 kain ACCOUNTRESIDENCE=a1b2c3d4e5f60718 :are supported by this server',
    ]);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toEqual([]);
  });
});

describe('IRCClient labeled-response capability (Era 1 A7)', () => {
  function makeCapClient() {
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
    });
    const { sent } = attachSocket(client);
    return { client, sent };
  }

  it('requests labeled-response when the server advertises it', () => {
    const { client, sent } = makeCapClient();
    feed(client, ':srv CAP * LS :batch labeled-response message-tags echo-message server-time');

    const req = sent.find((line) => typeof line === 'string' && line.startsWith('CAP REQ '));
    expect(req).toBeDefined();
    expect(String(req)).toContain('labeled-response');
    expect(String(req)).toContain('batch');
    expect(String(req)).toContain('echo-message');
  });

  it('still refuses always-off caps while requesting labeled-response', () => {
    const { client, sent } = makeCapClient();
    feed(
      client,
      ':srv CAP * LS :labeled-response batch tls sts bot draft/file-upload no-implicit-names message-tags',
    );

    const req = sent.find((line) => typeof line === 'string' && line.startsWith('CAP REQ '));
    expect(req).toBeDefined();
    const body = String(req);
    expect(body).toContain('labeled-response');
    expect(body).not.toMatch(/\btls\b/);
    expect(body).not.toMatch(/\bsts\b/);
    expect(body).not.toMatch(/\bbot\b/);
    expect(body).not.toContain('draft/file-upload');
    expect(body).not.toContain('no-implicit-names');
  });

  it('records labeled-response on CAP ACK', () => {
    const { client } = makeCapClient();
    feed(client, ':srv CAP * LS :labeled-response batch');
    feed(client, ':srv CAP * ACK :labeled-response batch');
    expect(client.negotiatedCaps.has('labeled-response')).toBe(true);
    expect(client.negotiatedCaps.has('batch')).toBe(true);
  });

  it('does not record labeled-response when the server NAKs it', () => {
    const { client } = makeCapClient();
    feed(client, ':srv CAP * LS :labeled-response batch message-tags');
    feed(client, ':srv CAP * NAK :labeled-response');
    feed(client, ':srv CAP * ACK :batch message-tags');
    expect(client.negotiatedCaps.has('labeled-response')).toBe(false);
    expect(client.negotiatedCaps.has('batch')).toBe(true);
  });

  it('drops labeled-response from negotiatedCaps on CAP DEL', () => {
    const { client } = makeCapClient();
    feed(client, ':srv CAP * LS :labeled-response batch');
    feed(client, ':srv CAP * ACK :labeled-response batch');
    expect(client.negotiatedCaps.has('labeled-response')).toBe(true);
    feed(client, ':srv CAP * DEL :labeled-response');
    expect(client.negotiatedCaps.has('labeled-response')).toBe(false);
    expect(client.negotiatedCaps.has('batch')).toBe(true);
  });
});

// ── onyx/session-sync (Era 2 B1 multi-device) ──────────────────────────────
// Server-driven session reclaim: when ACKed the server auto-pushes JOIN +
// NAMES/topic + CHATHISTORY for every live channel. The client must request
// the cap when offered and expose sessionSyncActive so the store can suppress
// its own blind rejoin storm (phone + desktop same account).
describe('IRCClient onyx/session-sync capability (Era 2 B1)', () => {
  function makeCapClient() {
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
    });
    const { sent } = attachSocket(client);
    return { client, sent };
  }

  it('requests onyx/session-sync and exposes sessionSyncActive only after CAP ACK', () => {
    const { client, sent } = makeCapClient();
    expect(client.sessionSyncActive).toBe(false);

    feed(client, ':srv CAP * LS :batch message-tags onyx/session-sync labeled-response');
    const req = sent.find((line) => typeof line === 'string' && line.startsWith('CAP REQ '));
    expect(req).toBeDefined();
    expect(String(req)).toContain('onyx/session-sync');
    // Advertised alone does not activate reclaim — only CAP ACK does.
    expect(client.sessionSyncActive).toBe(false);

    feed(client, ':srv CAP * ACK :onyx/session-sync batch');
    expect(client.negotiatedCaps.has('onyx/session-sync')).toBe(true);
    expect(client.sessionSyncActive).toBe(true);
  });

  it('does not activate sessionSyncActive when the server NAKs session-sync', () => {
    const { client } = makeCapClient();
    feed(client, ':srv CAP * LS :onyx/session-sync batch message-tags');
    feed(client, ':srv CAP * NAK :onyx/session-sync');
    feed(client, ':srv CAP * ACK :batch message-tags');
    expect(client.negotiatedCaps.has('onyx/session-sync')).toBe(false);
    expect(client.sessionSyncActive).toBe(false);
  });

  it('drops sessionSyncActive on CAP DEL so reconnect can fall back to client rejoin', () => {
    const { client } = makeCapClient();
    feed(client, ':srv CAP * LS :onyx/session-sync batch');
    feed(client, ':srv CAP * ACK :onyx/session-sync batch');
    expect(client.sessionSyncActive).toBe(true);
    feed(client, ':srv CAP * DEL :onyx/session-sync');
    expect(client.sessionSyncActive).toBe(false);
    expect(client.negotiatedCaps.has('batch')).toBe(true);
  });

  it('accepts onyx/session-sync via CAP NEW mid-connection', () => {
    const { client, sent } = makeCapClient();
    feed(client, ':srv CAP * LS :batch message-tags');
    feed(client, ':srv CAP * ACK :batch message-tags');
    expect(client.sessionSyncActive).toBe(false);

    // Server enables session-sync after registration (mesh upgrade).
    feed(client, ':srv CAP * NEW :onyx/session-sync');
    const req = sent.find(
      (line) =>
        typeof line === 'string'
        && line.startsWith('CAP REQ ')
        && String(line).includes('onyx/session-sync'),
    );
    expect(req).toBeDefined();
    feed(client, ':srv CAP * ACK :onyx/session-sync');
    expect(client.sessionSyncActive).toBe(true);
  });

  it('clears sessionSyncActive on reconnect until CAP is re-ACK\'d', () => {
    // connect() wipes negotiatedCaps; multi-device reclaim must re-negotiate
    // every socket or the store would suppress rejoins without server reclaim.
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
    });
    attachSocket(client);
    feed(client, ':srv CAP * LS :onyx/session-sync');
    feed(client, ':srv CAP * ACK :onyx/session-sync');
    expect(client.sessionSyncActive).toBe(true);

    class StubWS {
      static OPEN = 1;
      static constructions: Array<{ url: string | URL; protocols?: string | string[] }> = [];
      readyState = StubWS.OPEN;
      binaryType = '';
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(url: string | URL, protocols?: string | string[]) {
        StubWS.constructions.push({ url, protocols });
      }
    }
    vi.stubGlobal('WebSocket', StubWS);
    try {
      expect(client.connect()).toBe(true);
      expect(StubWS.constructions).toEqual([{
        url: 'wss://ircx.us:8080/',
        protocols: ['onyx.irc-media.v1', 'text.ircv3.net'],
      }]);
      expect(client.sessionSyncActive).toBe(false);
      expect(client.negotiatedCaps.has('onyx/session-sync')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
