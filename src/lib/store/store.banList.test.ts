// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import {
  MAX_BAN_LIST_ENTRIES,
  MAX_TEMP_BAN_MINUTES,
  MAX_TEMP_BAN_TIMERS,
  _resetBanListTransportForTests,
  _resetTempBanTimersForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();

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

function connect(room = '#room', account = 'alice') {
  const client = makeClient();
  const server: Server = {
    id: 'ban-test',
    name: 'Ban test',
    network: 'Ban test',
    url: 'wss://ban.test',
    icon: '',
    nick: 'me',
    account,
    connected: true,
  };
  store.setState({
    ...initialState,
    client: client as never,
    server,
    ourNick: 'me',
    connectionStatus: 'connected',
    channels: new Map([[room.toLowerCase(), channel(room)]]),
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  _resetBanListTransportForTests();
  _resetTempBanTimersForTests();
  store.setState(initialState, true);
});

afterEach(() => {
  _resetTempBanTimersForTests();
  vi.useRealTimers();
});

describe('RPL_BANLIST transport bounds', () => {
  it('retains only bounded, normalized rows for a joined channel', () => {
    connect();
    feed(`:ban.test 367 me #room ${'x'.repeat(900)} ${'setter'.repeat(40)} 123`);
    for (let index = 1; index < MAX_BAN_LIST_ENTRIES + 50; index += 1) {
      feed(`:ban.test 367 me #room bad${index}!*@* oper ${index}`);
    }
    feed(':ban.test 368 me #room :End of channel ban list');

    const bans = store.getState().banList.get('#room');
    expect(bans).toHaveLength(MAX_BAN_LIST_ENTRIES);
    expect(bans?.[0]?.mask).toHaveLength(512);
    expect(bans?.[0]?.setBy).toHaveLength(128);
    expect(bans?.[0]?.setAt).toBe(123);
    expect(bans?.at(-1)?.mask).toBe(`bad${MAX_BAN_LIST_ENTRIES - 1}!*@*`);
  });

  it('ignores unsolicited lists for channels outside the live session', () => {
    connect('#room');
    feed(':ban.test 367 me #ghost bad!*@* oper 123');
    feed(':ban.test 368 me #ghost :End of channel ban list');

    expect(store.getState().banList.has('#ghost')).toBe(false);
  });

  it('ignores stale MODE ban echoes outside joined rooms and bounds live echoes', () => {
    connect('#room');
    feed(':oper!u@h MODE #ghost +b stale!*@*');
    expect(store.getState().banList.has('#ghost')).toBe(false);
    expect(store.getState().moderationLog.some((entry) => entry.channel === '#ghost')).toBe(false);

    feed(`:oper!u@h MODE #room +b ${'x'.repeat(900)}`);
    expect(store.getState().banList.get('#room')).toEqual([
      expect.objectContaining({ mask: 'x'.repeat(512), setBy: 'oper' }),
    ]);
    feed(`:oper!u@h MODE #room -b ${'x'.repeat(900)}`);
    expect(store.getState().banList.get('#room')).toEqual([]);
  });

  it('drops an incomplete numeric burst before a replacement session', () => {
    connect();
    feed(':ban.test 367 me #room stale!*@* old-oper 123');
    store.getState().disconnect();

    connect();
    feed(':ban.test 368 me #room :End of channel ban list');
    expect(store.getState().banList.get('#room')).toEqual([]);
  });

  it('clears completed masks when the authenticated account changes', () => {
    connect();
    store.getState().setBanList('#room', [{ mask: 'private!*@*', setBy: 'oper', setAt: 123 }]);
    expect(store.getState().banList.get('#room')).toHaveLength(1);

    feed(':me!user@host ACCOUNT bob');
    expect(store.getState().banList.size).toBe(0);
  });

  it('bounds direct state writes at the same protocol boundary', () => {
    connect();
    const oversized = Array.from(
      { length: MAX_BAN_LIST_ENTRIES + 20 },
      (_, index) => ({ mask: `mask${index}!*@*`, setAt: Number.NaN }),
    );
    store.getState().setBanList('#room', oversized);

    const bans = store.getState().banList.get('#room');
    expect(bans).toHaveLength(MAX_BAN_LIST_ENTRIES);
    expect(bans?.[0]).toEqual({ mask: 'mask0!*@*' });
  });
});

describe('fetchBanList request metadata', () => {
  it('marks a requested list loading, then ready when 368 completes', () => {
    const client = connect();
    store.getState().fetchBanList('#room');
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#room', '+b');
    expect(store.getState().banListMeta.get('#room')?.status).toBe('loading');

    client.sendRaw.mockClear();
    store.getState().fetchBanList(' #Room ');
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#room', '+b');

    feed(':ban.test 367 me #room bad!*@* oper 123');
    feed(':ban.test 368 me #room :End of channel ban list');

    expect(store.getState().banList.get('#room')).toEqual([
      { mask: 'bad!*@*', setBy: 'oper', setAt: 123 },
    ]);
    expect(store.getState().banListMeta.get('#room')?.status).toBe('ready');
    expect(store.getState().banListMeta.get('#room')?.updatedAt).toEqual(expect.any(Number));
  });

  it('settles an empty authoritative list as ready', () => {
    connect();
    store.getState().fetchBanList('#room');
    feed(':ban.test 368 me #room :End of channel ban list');
    expect(store.getState().banList.get('#room')).toEqual([]);
    expect(store.getState().banListMeta.get('#room')?.status).toBe('ready');
  });

  it('records a send failure and a 482 permission error', () => {
    const client = connect();
    client.sendRaw.mockReturnValueOnce(false);
    store.getState().fetchBanList('#room');
    expect(store.getState().banListMeta.get('#room')).toMatchObject({
      status: 'error',
      error: 'Could not request the block list.',
    });

    client.sendRaw.mockReturnValue(true);
    store.getState().fetchBanList('#room');
    feed(':ban.test 482 me #room :You need operator privileges');
    expect(store.getState().banListMeta.get('#room')).toMatchObject({
      status: 'error',
      error: 'You need moderator permission to view this list.',
    });
  });

  it('settles a pending request on disconnect and ignores a stale 368 for readiness', () => {
    connect();
    store.getState().fetchBanList('#room');
    expect(store.getState().banListMeta.get('#room')?.status).toBe('loading');

    store.getState().disconnect();
    expect(store.getState().banListMeta.size).toBe(0);

    connect();
    feed(':ban.test 368 me #room :End of channel ban list');
    expect(store.getState().banList.get('#room')).toEqual([]);
    expect(store.getState().banListMeta.get('#room')?.status).not.toBe('loading');
    expect(store.getState().banListMeta.get('#room')?.status).not.toBe('ready');
  });

  it('clears list metadata when the authenticated account changes', () => {
    connect();
    store.getState().fetchBanList('#room');
    feed(':ban.test 368 me #room :End of channel ban list');
    expect(store.getState().banListMeta.get('#room')?.status).toBe('ready');

    feed(':me!user@host ACCOUNT bob');
    expect(store.getState().banListMeta.size).toBe(0);
  });

  it('does not complete an in-flight request from a stale 367/368 after the epoch advances', () => {
    connect();
    store.getState().fetchBanList('#room');
    expect(store.getState().banListMeta.get('#room')?.status).toBe('loading');

    _resetBanListTransportForTests();
    feed(':ban.test 367 me #room stale!*@* oper 9');
    feed(':ban.test 368 me #room :End of channel ban list');

    expect(store.getState().banList.has('#room')).toBe(false);
    expect(store.getState().banListMeta.get('#room')?.status).toBe('loading');
  });

  it('applies 482 only to the owned pending ban-list request', () => {
    connect();
    feed(':ban.test 482 me #room :You need operator privileges');
    expect(store.getState().banListMeta.get('#room')).toBeUndefined();

    store.getState().fetchBanList('#room');
    feed(':ban.test 482 me #other :You need operator privileges');
    expect(store.getState().banListMeta.get('#room')?.status).toBe('loading');

    feed(':ban.test 482 me #room :You need operator privileges');
    expect(store.getState().banListMeta.get('#room')).toMatchObject({
      status: 'error',
      error: 'You need moderator permission to view this list.',
    });
  });
});

describe('temporary ban timer ownership and bounds', () => {
  it('sends a normalized ban and removes it after the requested duration', () => {
    vi.useFakeTimers();
    const client = connect();

    store.getState().tempBan(' #Room ', ' bad!*@* ', 1);
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#room', '+b', 'bad!*@*');

    vi.advanceTimersByTime(60_000);
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#room', '-b', 'bad!*@*');
  });

  it('rejects inputs that cannot be paired with a safe bounded unban timer', () => {
    vi.useFakeTimers();
    const client = connect();

    store.getState().tempBan('room', 'bad!*@*', 1);
    store.getState().tempBan('#room', `${'x'.repeat(513)}!*@*`, 1);
    store.getState().tempBan('#room', 'bad!*@*', 0);
    store.getState().tempBan('#room', 'bad!*@*', 1.5);
    store.getState().tempBan('#room', 'bad!*@*', MAX_TEMP_BAN_MINUTES + 1);

    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps distinct pending timers before sending a ban it cannot retire', () => {
    vi.useFakeTimers();
    const client = connect();

    for (let index = 0; index < MAX_TEMP_BAN_TIMERS + 1; index += 1) {
      store.getState().tempBan('#room', `user${index}!*@*`, 1);
    }

    expect(client.sendRaw).toHaveBeenCalledTimes(MAX_TEMP_BAN_TIMERS);
    expect(vi.getTimerCount()).toBe(MAX_TEMP_BAN_TIMERS);
  });

  it('never spends a replacement account authority on an older unban', () => {
    vi.useFakeTimers();
    const client = connect('#room', 'alice');
    store.getState().tempBan('#room', 'bad!*@*', 1);

    feed(':me!user@host ACCOUNT bob');
    vi.advanceTimersByTime(60_000);

    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#room', '-b', 'bad!*@*');
  });

  it('retries briefly on the same disconnected client and unbans after reconnect', () => {
    vi.useFakeTimers();
    const client = connect();
    store.getState().tempBan('#room', 'bad!*@*', 1);
    store.setState((state) => ({
      connectionStatus: 'disconnected',
      server: state.server ? { ...state.server, connected: false } : null,
    }));

    vi.advanceTimersByTime(60_000);
    expect(client.sendRaw).toHaveBeenCalledTimes(1);
    store.setState((state) => ({
      connectionStatus: 'connected',
      server: state.server ? { ...state.server, connected: true } : null,
    }));
    vi.advanceTimersByTime(30_000);

    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#room', '-b', 'bad!*@*');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending authority when the user explicitly disconnects', () => {
    vi.useFakeTimers();
    const client = connect();
    store.getState().tempBan('#room', 'bad!*@*', 1);

    store.getState().disconnect();
    vi.advanceTimersByTime(90_000);

    expect(client.sendRaw).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
