import { describe, it, expect } from 'vitest';
import { IRCClient } from './client';
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
