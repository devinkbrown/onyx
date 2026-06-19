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
    nick: 'ruri',
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
