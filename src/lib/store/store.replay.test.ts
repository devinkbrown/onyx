/**
 * store.replay.test.ts — draft/event-playback must never mutate live state.
 *
 * Orochi's CHATHISTORY replay includes historical JOIN/PART/QUIT/KICK/TOPIC
 * lines (when the client has the event-playback cap) tagged with @time+msgid
 * but NO batch tag. Before the guard, a replayed QUIT deleted members who are
 * in the channel RIGHT NOW — the "nicklist shrinks after a while" bug.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from './store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

const user = (nick: string): [string, ChannelUser] => [
  nick.toLowerCase(),
  { nick, modes: new Set<string>(), away: false },
];

const channel = (name: string, nicks: string[]): Channel => ({
  name,
  topic: 'the current topic',
  topicSetBy: 'kain',
  topicSetAt: null,
  modes: '',
  users: new Map(nicks.map(user)),
  unread: 0,
  highlights: 0,
  createdAt: null,
  messages: [],
});

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

const mockClient = () =>
  ({
    negotiatedCaps: new Set(['draft/chathistory', 'draft/event-playback']),
    capValues: new Map<string, string>(),
    isupport: {},
    prefixToMode: {},
    sendRaw: () => {},
    send: () => {},
  }) as never;

beforeEach(() => {
  store.setState(
    {
      ...initialState,
      client: mockClient(),
      ourNick: 'me',
      channels: new Map([['#root', channel('#root', ['me', 'kain', 'trev', 'mizu'])]]),
    },
    true,
  );
});

describe('event-playback replay guard', () => {
  it('replayed QUIT/PART/JOIN inside a chathistory batch never touch the roster', () => {
    feed('BATCH +r1 chathistory #root');
    // Orochi replay lines: @time + msgid, NO batch tag.
    feed('@time=2026-07-01T10:00:00.000Z;msgid=old-q1 :trev!t@host QUIT :old netsplit');
    feed('@time=2026-07-01T10:01:00.000Z;msgid=old-p1 :mizu!m@host PART #root :bbl');
    feed('@time=2026-07-01T10:02:00.000Z;msgid=old-j1 :ghost!g@host JOIN #root');
    feed('@time=2026-07-01T10:03:00.000Z;msgid=old-t1 :kain!k@host TOPIC #root :ancient topic');
    feed('BATCH -r1');

    const ch = store.getState().channels.get('#root')!;
    expect([...ch.users.keys()].sort()).toEqual(['kain', 'me', 'mizu', 'trev']);
    expect(ch.users.has('ghost')).toBe(false);
    expect(ch.topic).toBe('the current topic');
    // The events still render in scrollback as historical system lines.
    const texts = ch.messages.map((m) => m.text);
    expect(texts).toContain('trev quit: old netsplit');
    expect(texts).toContain('mizu left (bbl)');
    expect(texts).toContain('ghost joined');
  });

  it('live JOIN/QUIT outside a batch still mutate the roster', () => {
    feed(':newbie!n@host JOIN #root');
    expect(store.getState().channels.get('#root')!.users.has('newbie')).toBe(true);
    feed(':trev!t@host QUIT :real quit');
    expect(store.getState().channels.get('#root')!.users.has('trev')).toBe(false);
  });

  it('a live QUIT during an open batch is not swallowed (no msgid = live)', () => {
    feed('BATCH +r2 chathistory #root');
    feed(':mizu!m@host QUIT :actually leaving now');
    feed('BATCH -r2');
    expect(store.getState().channels.get('#root')!.users.has('mizu')).toBe(false);
  });

  it('replayed NICK does not rename anyone now', () => {
    feed('BATCH +r3 chathistory #root');
    feed('@time=2026-07-01T09:00:00.000Z;msgid=old-n1 :kain!k@host NICK kain2');
    feed('BATCH -r3');
    const ch = store.getState().channels.get('#root')!;
    expect(ch.users.has('kain')).toBe(true);
    expect(ch.users.has('kain2')).toBe(false);
  });
});
