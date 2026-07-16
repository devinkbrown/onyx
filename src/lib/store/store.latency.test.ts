// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { store } from './store';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn((..._args: string[]) => true),
    send: vi.fn((_line: string) => true),
    destroy: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    prefixToMode: {} as Record<string, string>,
  };
}

function connect() {
  const client = makeClient();
  store.setState({
    ...initialState,
    client: client as never,
    ourNick: 'me',
    connectionStatus: 'connected',
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function latestPingCookie(client: ReturnType<typeof makeClient>): string {
  const call = client.sendRaw.mock.calls.findLast(args => args[0] === 'PING');
  const cookie = call?.[1];
  if (typeof cookie !== 'string') throw new Error('Expected a latency PING');
  return cookie;
}

function pingCount(client: ReturnType<typeof makeClient>): number {
  return client.sendRaw.mock.calls.filter(args => args[0] === 'PING').length;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  store.setState(initialState, true);
});

afterEach(() => {
  store.getState().disconnect();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('latency probe lifecycle', () => {
  it('keeps exactly one acknowledged ping loop alive', () => {
    const client = connect();
    feed(':latency.example 001 me :Welcome');
    expect(pingCount(client)).toBe(1);

    const firstCookie = latestPingCookie(client);
    feed(`:latency.example PONG latency.example :${firstCookie}`);
    // A replayed/forged cookie must not add a second scheduled loop.
    feed(':latency.example PONG latency.example :lat-forged');

    vi.advanceTimersByTime(30_000);
    expect(pingCount(client)).toBe(2);

    const secondCookie = latestPingCookie(client);
    feed(`:latency.example PONG latency.example :${secondCookie}`);
    feed(`:latency.example PONG latency.example :${secondCookie}`);
    vi.advanceTimersByTime(30_000);
    expect(pingCount(client)).toBe(3);
  });

  it('does not let an old session timer send through a replacement client', () => {
    const oldClient = connect();
    feed(':latency.example 001 me :Welcome');
    const cookie = latestPingCookie(oldClient);
    feed(`:latency.example PONG latency.example :${cookie}`);

    store.getState().disconnect();
    const replacementClient = connect();
    vi.advanceTimersByTime(30_000);

    expect(pingCount(replacementClient)).toBe(0);
  });
});
