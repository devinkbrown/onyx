// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.search.test.ts — server-side SEARCH (draft/search).
 *
 * The reply replays as a chathistory-shaped batch; while a search is pending
 * for that target, the batch must be DIVERTED into serverSearch.results and
 * must NOT merge into the conversation buffer. FAIL SEARCH surfaces an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_SEARCH_RESULT_MAX,
  SERVER_SEARCH_ROW_MAX,
  SERVER_SEARCH_TEXT_MAX,
  store,
} from './store';
import type { Channel, ChatMessage } from '@/lib/irc/types';
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
      destroy: vi.fn(),
    } as never,
  };
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

beforeEach(() => {
  store.getState().disconnect();
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
  store.getState().disconnect();
  vi.clearAllTimers();
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

  it('bounds the public query action and rejects malformed targets before sending', () => {
    const { client, sent } = mockClient(['draft/search']);
    store.setState({ client });

    store.getState().searchServerHistory('#root', 'x'.repeat(700));
    expect(sent).toEqual([`SEARCH #root ${'x'.repeat(512)}`]);
    expect(store.getState().serverSearch.query).toHaveLength(512);

    // Finish the first generation before probing the next public-action call.
    feed('BATCH +s1 chathistory #root');
    feed('BATCH -s1');
    store.getState().clearServerSearch();
    store.getState().searchServerHistory('bad target', 'needle');
    store.getState().searchServerHistory(':bad', 'needle');
    store.getState().searchServerHistory('#root\nJOIN #evil', 'needle');
    store.getState().searchServerHistory(`#${'r'.repeat(512)}`, 'needle');
    expect(sent).toHaveLength(1);
  });

  it('validates, deduplicates, bounds and deterministically orders untrusted search rows', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');

    const oversized = `${'x'.repeat(SERVER_SEARCH_TEXT_MAX - 1)}😀tail`;
    feed('BATCH +s1 chathistory #root');
    feed('@batch=s1;msgid=old-b;time=2026-06-02T11:00:00.000Z :trev!t@host PRIVMSG #root :mesh b');
    feed('@batch=s1;msgid=old-a;time=2026-06-02T11:00:00.000Z :mira!m@host PRIVMSG #root :mesh a');
    feed('@batch=s1;msgid=old-a;time=2026-06-03T11:00:00.000Z :mira!m@host PRIVMSG #root :duplicate');
    feed('@batch=s1;time=2026-06-03T11:00:00.000Z :noid!n@host PRIVMSG #root :missing id');
    feed('@batch=s1;msgid=no-time :mira!m@host PRIVMSG #root :missing time');
    feed('@batch=s1;msgid=bad-time;time=not-a-date :mira!m@host PRIVMSG #root :invalid time');
    feed('@batch=s1;msgid=wrong-target;time=2026-06-03T11:00:00.000Z :mira!m@host PRIVMSG #other :wrong target');
    feed('@batch=s1;msgid=encrypted;time=2026-06-03T11:00:00.000Z :mira!m@host PRIVMSG #root :TSUMUGI1 opaque-ciphertext');
    feed(`@batch=s1;msgid=long;time=2026-06-04T11:00:00.000Z :mira!m@host PRIVMSG #root :${oversized}`);
    feed('BATCH -s1');

    const search = store.getState().serverSearch;
    expect(search.status).toBe('done');
    expect(search.results.map((message) => message.id)).toEqual(['old-a', 'old-b', 'long']);
    expect(search.results[2]?.text.length).toBeLessThanOrEqual(SERVER_SEARCH_TEXT_MAX);
    expect(search.results[2]?.text.charCodeAt(search.results[2]!.text.length - 1))
      .not.toBeGreaterThanOrEqual(0xd800);
    expect(search.notice).toMatch(/shortened/i);
    expect(search.notice).toMatch(/invalid/i);
    expect(search.notice).toMatch(/duplicate/i);
    expect(search.notice).toMatch(/encrypted/i);
    expect(store.getState().channels.get('#root')!.messages).toEqual([]);
  });

  it('hard-bounds accepted results and total processed rows', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'row');
    feed('BATCH +s1 chathistory #root');
    for (let i = 0; i <= SERVER_SEARCH_ROW_MAX; i += 1) {
      feed(`@batch=s1;msgid=row-${i};time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :row ${i}`);
    }
    feed('BATCH -s1');

    const search = store.getState().serverSearch;
    expect(search.results).toHaveLength(SERVER_SEARCH_RESULT_MAX);
    expect(search.notice).toContain(`limited to ${SERVER_SEARCH_RESULT_MAX}`);
    expect(search.notice).toContain(`first ${SERVER_SEARCH_ROW_MAX} server rows`);
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

  it('quarantines a late batch after timeout and refuses a newer query until it closes', () => {
    const { client, sent } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'first');
    vi.advanceTimersByTime(6500);
    expect(store.getState().serverSearch.error).toMatch(/late results will be discarded/i);

    store.getState().searchServerHistory('#root', 'second');
    expect(sent).toHaveLength(1);
    expect(store.getState().serverSearch.error).toMatch(/prior search response is still ambiguous/i);

    feed('BATCH +late chathistory #root');
    feed('@batch=late;msgid=late-1;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :must not leak live');
    feed('BATCH -late');
    expect(store.getState().channels.get('#root')!.messages).toEqual([]);

    store.getState().searchServerHistory('#root', 'second');
    expect(sent).toHaveLength(2);
    expect(store.getState().serverSearch).toMatchObject({ status: 'pending', query: 'second' });
  });

  it('keeps an already-open timed-out batch quarantined even if a late FAIL arrives', () => {
    const { client, sent } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'first');
    feed('BATCH +late chathistory #root');
    vi.advanceTimersByTime(6500);
    feed(':server FAIL SEARCH RATE_LIMITED :late terminal');

    store.getState().searchServerHistory('#root', 'second');
    expect(sent).toHaveLength(1);
    feed('@batch=late;msgid=late-1;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :discard me');
    feed('BATCH -late');
    expect(store.getState().channels.get('#root')!.messages).toEqual([]);

    store.getState().searchServerHistory('#root', 'second');
    expect(sent).toHaveLength(2);
  });

  it('fails closed on overlapping same-target history batches', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');
    feed('BATCH +s1 chathistory #root');
    feed('BATCH +h2 chathistory #root');
    feed('@batch=s1;msgid=one;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :one');
    feed('@batch=h2;msgid=two;time=2026-06-01T10:00:00.000Z :trev!t@host PRIVMSG #root :two');
    feed('BATCH -s1');
    feed('BATCH -h2');

    expect(store.getState().serverSearch.error).toMatch(/overlapping history batches/i);
    expect(store.getState().channels.get('#root')!.messages).toEqual([]);
  });

  it('prevents same-target CHATHISTORY requests from overlapping SEARCH', () => {
    const { client, sent } = mockClient(['draft/search', 'draft/chathistory']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');
    store.getState().requestHistory('#root');
    store.getState().loadHistory('#root');
    store.getState().travelTo('#root', new Date('2026-06-01T10:00:00.000Z'));
    expect(sent).toEqual(['SEARCH #root mesh']);
  });

  it('refuses SEARCH while same-target history is already loading', () => {
    const { client, sent } = mockClient(['draft/search', 'draft/chathistory']);
    store.setState({
      client,
      historyLoading: new Map([['#root', true]]),
    });
    store.getState().searchServerHistory('#root', 'mesh');
    expect(sent).toEqual([]);
    expect(store.getState().serverSearch.error).toMatch(/current history request/i);
  });

  it('enforces the device-only E2EE boundary in the public store action', () => {
    const { client, sent } = mockClient(['draft/search']);
    const encrypted: ChatMessage = {
      id: 'cipher',
      from: 'Mika',
      text: 'TSUMUGI1 opaque-ciphertext',
      target: 'Mika',
      type: 'msg',
      time: new Date('2026-06-01T10:00:00.000Z'),
      encrypted: true,
    };
    store.setState({
      client,
      dms: new Map([['mika', {
        nick: 'Mika',
        account: null,
        unread: 0,
        highlights: 0,
        messages: [encrypted],
      }]]),
    });
    store.getState().searchServerHistory('Mika', 'private');
    expect(sent).toEqual([]);
    expect(store.getState().serverSearch.error).toMatch(/stays on this device/i);
  });

  it('clears the timeout and pending transport state on disconnect', () => {
    const { client } = mockClient(['draft/search']);
    store.setState({ client });
    store.getState().searchServerHistory('#root', 'mesh');
    store.getState().disconnect();
    const disconnectError = store.getState().serverSearch.error;
    vi.advanceTimersByTime(6500);
    expect(disconnectError).toMatch(/disconnected/i);
    expect(store.getState().serverSearch.error).toBe(disconnectError);
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
      notice: null,
    });
  });
});
