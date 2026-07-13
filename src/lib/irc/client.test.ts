// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi } from 'vitest';
import { IRCClient } from './client';
import { _resetDeviceSigningForTests } from '../e2ee/deviceSign';
import type { IRCMessage } from './types';

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
});

// ── Session-resume token refresh ───────────────────────────────────────────
// The server issues fresh resume tokens mid-session (NOTE SESSION TOKEN / MTOKEN);
// auto-reconnect reuses the SAME IRCClient instance (store: reconnectNow →
// client.connect()), so unless the refreshed token is pushed back into the live
// client, every reconnect replays the stale construction-time token — undefined
// for a session that began with no saved token — and resume silently fails.
describe('IRCClient session-resume token lifecycle', () => {
  /** Attach a fake OPEN socket that captures every outbound line, and mark the
   *  session as logged in so the 001 handler runs the resume path. */
  function makeLoggedInClient(opts?: { sessionToken?: string; meshToken?: string }) {
    const sent: string[] = [];
    const client = new IRCClient({
      url: 'wss://ircx.us:8080/',
      nick: 'onyx',
      onMessage: () => {},
      sessionToken: opts?.sessionToken,
      meshToken: opts?.meshToken,
    });
    const priv = client as unknown as {
      ws: { readyState: number; send(l: string): void };
      _loggedIn: boolean;
      _onMessage(ev: { data: string }): void;
    };
    priv.ws = { readyState: WebSocket.OPEN, send: (l: string) => sent.push(l) };
    priv._loggedIn = true;
    return { client, sent, feed001: () => priv._onMessage({ data: ':eshmaki.me 001 onyx :Welcome' }) };
  }

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
      if (command === 'IDENTITY') sent.push([command, ...params]);
      else origSendRaw(command, ...params);
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
