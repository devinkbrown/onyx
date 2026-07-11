// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.search.test.ts — server-side SEARCH (draft/search).
 *
 * The reply replays as a chathistory-shaped batch; while a search is pending
 * for that target, the batch must be DIVERTED into serverSearch.results and
 * must NOT merge into the conversation buffer. FAIL SEARCH surfaces an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from './store';
import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

const emptyChannel = (name: string): Channel => ({
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
});

function mockClient(caps: string[]) {
  const sent: string[] = [];
  return {
    sent,
    client: {
      negotiatedCaps: new Set(caps),
      capValues: new Map<string, string>(),
      isupport: {},
      sendRaw: (...parts: string[]) => sent.push(parts.join(' ')),
      send: (line: string) => sent.push(line),
    } as never,
  };
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

beforeEach(() => {
  vi.useFakeTimers();
  store.setState(
    {
      ...initialState,
      channels: new Map([['#root', emptyChannel('#root')]]),
      ourNick: 'kain',
    },
    true,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchServerHistory', () => {
  it('is a no-op without the draft/search cap', () => {
    const { client, sent } = mockClient([]);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');
    expect(sent.length).toBe(0);
    expect(store.getState().serverSearch.status).toBe('idle');
  });

  it('sends SEARCH and diverts the chathistory-shaped reply into results', () => {
    const { client, sent } = mockClient(['draft/search']);
    store.setState({ client });

    store.getState().searchServerHistory('#root', 'mesh update');
    expect(sent.some((l) => l.includes('SEARCH') && l.includes('#root'))).toBe(true);
    expect(store.getState().serverSearch.status).toBe('pending');

    feed('BATCH +s1 chathistory #root');
    feed('@batch=s1;msgid=old1;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :the mesh update landed');
    feed('@batch=s1;msgid=old2;time=2026-06-02T11:00:00.000Z :kain!k@host PRIVMSG #root :mesh update round two');
    feed('BATCH -s1');

    const search = store.getState().serverSearch;
    expect(search.status).toBe('done');
    expect(search.results.map((m) => m.id)).toEqual(['old1', 'old2']);
    // Diverted — the channel buffer must stay untouched.
    expect(store.getState().channels.get('#root')!.messages.length).toBe(0);
  });

  it('a chathistory batch with no pending search still merges into the buffer', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });

    feed('BATCH +h1 chathistory #root');
    feed('@batch=h1;msgid=h-1;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :plain history');
    feed('BATCH -h1');

    expect(store.getState().channels.get('#root')!.messages.map((m) => m.id)).toEqual(['h-1']);
    expect(store.getState().serverSearch.status).toBe('idle');
  });

  it('FAIL SEARCH surfaces the error', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'zzz');
    feed(':server FAIL SEARCH RATE_LIMITED :Please wait before searching again');
    expect(store.getState().serverSearch.status).toBe('error');
    expect(store.getState().serverSearch.error).toMatch(/wait before searching/i);
  });

  it('times out a search the server never answers', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'void');
    vi.advanceTimersByTime(6500);
    expect(store.getState().serverSearch.status).toBe('error');
  });

  it('clearServerSearch resets to idle', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');
    store.getState().clearServerSearch();
    expect(store.getState().serverSearch).toEqual({
      target: '',
      query: '',
      status: 'idle',
      results: [],
      error: null,
    });
  });
});
