// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { IRCClient } from './client';
import type { IRCMessage } from './types';

type PrivateClient = {
  ws: { readyState: number; bufferedAmount: number; send(line: string): void; close(): void } | null;
  _onMessage(event: { data: string }): void;
};

function harness(onMessage: (message: IRCMessage) => void = () => undefined) {
  const sent: string[] = [];
  const raw: Array<{ line: string; direction: 'in' | 'out' }> = [];
  const errors: string[] = [];
  const client = new IRCClient({
    url: 'wss://chat.example/irc', nick: 'alice', onMessage,
    onRaw: (line, direction) => raw.push({ line, direction }),
    onError: (error) => errors.push(error),
  });
  const privateClient = client as unknown as PrivateClient;
  privateClient.ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (line) => sent.push(line),
    close: () => undefined,
  };
  return {
    client,
    sent,
    raw,
    errors,
    feed: (line: string) => privateClient._onMessage({ data: line }),
  };
}

describe('group-control raw-log secrecy', () => {
  const sentinel = 'SENTINEL-PRIVATE-CONTROL-PAYLOAD';
  const sensitive = [
    `E2EEGROUP #room COMMIT :${sentinel}`,
    `@time=1 :alice!u@h e2ee.keypackage #room :${sentinel}`,
    `:alice E2EE.COMMIT #room :${sentinel}`,
    `E2EE.WELCOME #room :${sentinel}`,
    `E2EEKEY LIST alice :${sentinel}`,
    `:server.example NOTICE alice :E2EEKEY DEVICE alice phone ${sentinel}`,
    `:server.example FAIL E2EEGROUP BAD_CONTROL :${sentinel}`,
    `:server.example WARN e2eekey BAD_DIRECTORY :${sentinel}`,
    `:server.example NOTE E2EEKEY INFO :${sentinel}`,
  ];

  it('redacts inbound tagged, prefixed, mixed-case, wrapped and error forms', () => {
    const messages: IRCMessage[] = [];
    const { raw, feed } = harness((message) => messages.push(message));
    for (const line of sensitive) feed(line);
    expect(raw).toHaveLength(sensitive.length);
    expect(raw.map((entry) => entry.line).join('\n')).not.toContain(sentinel);
    expect(raw.every((entry) => entry.line.includes('<redacted>'))).toBe(true);
    expect(messages).toHaveLength(sensitive.length);
    expect(JSON.stringify(messages)).toContain(sentinel);
  });

  it('redacts outbound logs while preserving exact wire bytes', () => {
    const { client, raw, sent } = harness();
    for (const line of sensitive) expect(client.send(`${line}\r\n`)).toBe(true);
    expect(raw.map((entry) => entry.line).join('\n')).not.toContain(sentinel);
    expect(sent.join('\n')).toContain(sentinel);
    expect(sent).toEqual(sensitive.map((line) => `${line}\r\n`));
  });

  it('never exposes a sensitive line through the parse/handler diagnostic', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { feed } = harness(() => { throw new Error(sentinel); });
    feed(`:alice E2EE.COMMIT #room :${sentinel}`);
    const diagnostic = warning.mock.calls.flat().map(String).join(' ');
    expect(diagnostic).toContain('E2EE.COMMIT <redacted>');
    expect(diagnostic).not.toContain(sentinel);
    warning.mockRestore();
  });

  it('fails closed for malformed NOTICE, duplicate prefixes, and lone CR forms', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { raw, feed } = harness();
    feed(`NOTICE :E2EEKEY DEVICE alice phone ${sentinel}`);
    feed(`:server :bad E2EE.COMMIT #room :${sentinel}`);
    feed(`:server NOTICE alice :E2EEKEY DEVICE\r${sentinel}`);
    const diagnostics = warning.mock.calls.flat().map(String).join(' ');
    expect(raw.map((entry) => entry.line).join('\n')).not.toContain(sentinel);
    expect(diagnostics).not.toContain(sentinel);
    warning.mockRestore();
  });

  it('rejects an ordinary-first batched outbound legacy frame before wire or logging', () => {
    const { client, raw, sent, errors } = harness();
    expect(client.send(`PRIVMSG #room :ok\r\nE2EEGROUP #room COMMIT :${sentinel}\r\n`)).toBe(false);
    expect(sent).toEqual([]);
    expect(raw).toEqual([]);
    expect(errors).toEqual(['Message was not sent: IRC WebSocket frames require exactly one IRC line.']);
  });

  it('redacts NUL-split sensitive tokens before parser normalization inbound', () => {
    const commands: string[] = [];
    const { raw, feed } = harness((message) => commands.push(message.command));
    const nulCases = [
      `\0E2EE.COMMIT #room :${sentinel}`,
      `E2EE.\0COMMIT #room :${sentinel}`,
      `AUTHENTIC\0ATE ${sentinel}`,
      `NOTICE alice :E2EE\0KEY DEVICE ${sentinel}`,
      `FAIL E2EE\0GROUP BAD :${sentinel}`,
      `WARN E2EE\0KEY BAD :${sentinel}`,
      `NOTE \0E2EEKEY INFO :${sentinel}`,
    ];
    for (const line of nulCases) feed(line);
    expect(raw.map((entry) => entry.line).join('\n')).not.toContain(sentinel);
    expect(raw.every((entry) => entry.line.includes('<redacted>'))).toBe(true);
    expect(commands).toContain('AUTHENTICATE');
    expect(commands).toContain('NOTICE');
  });

  it('redacts NUL-split sensitive tokens outbound while preserving exact wire bytes', () => {
    const { client, raw, sent } = harness();
    const nulCases = [
      `\0E2EE.WELCOME #room :${sentinel}`,
      `E2EE.\0KEYPACKAGE #room :${sentinel}`,
      `AUTHENTIC\0ATE ${sentinel}`,
      `NOTICE alice :E2EE\0KEY DEVICE ${sentinel}`,
      `FAIL E2EE\0GROUP BAD :${sentinel}`,
      `WARN E2EE\0KEY BAD :${sentinel}`,
      `NOTE \0E2EEKEY INFO :${sentinel}`,
    ];
    for (const line of nulCases) expect(client.send(`${line}\r\n`)).toBe(true);
    expect(raw.map((entry) => entry.line).join('\n')).not.toContain(sentinel);
    expect(sent).toEqual(nulCases.map((line) => `${line}\r\n`));
  });

  it('leaves ordinary IRC lines unchanged', () => {
    const { raw, feed } = harness();
    const ordinary = ':alice PRIVMSG #room :ordinary hello';
    feed(ordinary);
    expect(raw).toEqual([{ line: ordinary, direction: 'in' }]);
  });
});
