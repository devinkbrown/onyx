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

// Regression tests for the WebSocket framing gotcha (memory: Orochi wss sends one IRC
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

describe('IRCClient WebSocket frame handling', () => {
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
    feed(client, ':server 005 onyx NETWORK=Orochi CHANTYPES=#& CASEMAPPING=strict-rfc1459 CHANMODES=beI,k,lf,imnst :supported');
    expect(client.isupport).toMatchObject({
      NETWORK: 'Orochi',
      CHANTYPES: '#&',
      CASEMAPPING: 'strict-rfc1459',
      CHANMODES: ['beI', 'k', 'lf', 'imnst'],
    });

    feed(client, ':server 005 onyx NETWORK CHANTYPES=ab CASEMAPPING=unknown CHANMODES=beI,k,lf :supported');
    expect(client.isupport).toMatchObject({
      NETWORK: 'Orochi',
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

    feedBinary(client, new Uint8Array((8 * MIB) + 1));

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

    expect(client.sendBinary(new Uint8Array((8 * MIB) + 1))).toBe(false);
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
