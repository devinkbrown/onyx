// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.roster.test.ts
 *
 * Regression coverage for the member-list COLLAPSE bug: after a mesh netsplit
 * re-sync the client issues JOIN + an explicit NAMES per channel (and a
 * focus/poll refresh can add a third), so two or three NAMES bursts for the
 * same channel interleave on the wire. The old design keyed "is this a fresh
 * burst?" off Set membership and treated *any* 353 arriving with no in-progress
 * entry as a fresh REPLACE — so an interleaved or late 353 (a cross-node line
 * landing after another burst's 366 cleared the key) wiped the full roster and
 * left only its ~2 nicks.
 *
 * The fix: a REPLACE is authorized ONLY by a burst WE initiated (self-JOIN or a
 * NAMES we sent, phase 'expect'); its first 353 replaces and the rest — and any
 * stray/late line with no burst entry — APPEND. These tests drive real wire
 * frames through _handleMessage and assert the roster reconciles to the FULL
 * server truth, never a subset.
 *
 * Each test uses a DISTINCT channel name so the module-level burst / refresh
 * throttle maps (not reset by setState) cannot leak across tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetNamesBurstsForTests, store } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

/** Minimal IRCClient stand-in — captures sendRaw, satisfies handler reads. */
function makeClient() {
  return {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    prefixToMode: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' } as Record<string, string>,
  };
}

function connect(ourNick = 'me') {
  const client = makeClient();
  store.setState({
    ...initialState,
    client: client as never,
    ourNick,
    connectionStatus: 'connected',
    channels: new Map(),
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

/** Sorted lowercase nicks currently in the channel roster. */
function roster(channel: string): string[] {
  const c = store.getState().channels.get(channel.toLowerCase());
  return c ? [...c.users.keys()].sort() : [];
}

beforeEach(() => {
  store.setState(initialState, true);
  _resetNamesBurstsForTests();
});

describe('NAMES roster reconcile — interleaved / late bursts never collapse', () => {
  it('keeps the FULL union when a late partial 353 lands after an early 366', () => {
    // A self-JOIN arms an authoritative burst (phase 'expect'): its first 353
    // may REPLACE. This mirrors production, where JOIN triggers NAMES.
    connect('me');
    feed(':me!u@h JOIN #interleave');
    expect(roster('#interleave')).toEqual([]); // JOIN alone adds no members

    // Burst arrives across two 353 lines…
    feed(':server 353 me = #interleave :me alice bob');
    feed(':server 353 me = #interleave :carol dave');
    // …then an OVERLAPPING burst's 366 closes the tracking early…
    feed(':server 366 me #interleave :End of /NAMES list.');
    // …and a late cross-node 353 lands AFTER that 366. Under the old code this
    // was treated as a fresh burst and REPLACED the roster with just {erin,frank}.
    feed(':server 353 me = #interleave :erin frank');
    feed(':server 366 me #interleave :End of /NAMES list.');

    // Full union — NOT collapsed to the last line's two nicks.
    expect(roster('#interleave')).toEqual(
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'me'],
    );
  });

  it('a stray 353 with no burst in progress APPENDS, never replaces', () => {
    // No self-JOIN / NAMES was initiated for #stray here, so no burst is armed.
    store.setState({
      ...initialState,
      client: makeClient() as never,
      ourNick: 'me',
      connectionStatus: 'connected',
      channels: new Map([
        ['#stray', {
          name: '#stray', topic: '', topicSetBy: '', topicSetAt: null, modes: '',
          users: new Map([
            ['me', { nick: 'me', modes: new Set<string>(), away: false }],
            ['alice', { nick: 'alice', modes: new Set<string>(), away: false }],
          ]),
          unread: 0, highlights: 0, createdAt: null, messages: [],
        }],
      ]) as never,
    }, true);

    // An unsolicited 353 (e.g. a cross-node echo) must not wipe the existing two.
    feed(':server 353 me = #stray :bob');
    feed(':server 366 me #stray :End of /NAMES list.');

    expect(roster('#stray')).toEqual(['alice', 'bob', 'me']);
  });

  it('an armed burst still DROPS stale members (authoritative replace)', () => {
    // Seed a channel already holding a member who has since left ("ghost").
    store.setState({
      ...initialState,
      client: makeClient() as never,
      ourNick: 'me',
      connectionStatus: 'connected',
      channels: new Map([
        ['#reconcile', {
          name: '#reconcile', topic: '', topicSetBy: '', topicSetAt: null, modes: '',
          users: new Map([
            ['me', { nick: 'me', modes: new Set<string>(), away: false }],
            ['ghost', { nick: 'ghost', modes: new Set<string>(), away: false }],
          ]),
          unread: 0, highlights: 0, createdAt: null, messages: [],
        }],
      ]) as never,
    }, true);

    // Focus/poll re-request path arms 'expect' via the self-JOIN wire frame the
    // server replays on reconnect; the first 353 then REPLACES, dropping ghost.
    feed(':me!u@h JOIN #reconcile');
    feed(':server 353 me = #reconcile :me alice');
    feed(':server 366 me #reconcile :End of /NAMES list.');

    expect(roster('#reconcile')).toEqual(['alice', 'me']); // ghost dropped
  });

  it('does not let a later 353 chunk undo a live PART during the burst', () => {
    connect('me');
    feed(':me!u@h JOIN #part-race');
    feed(':server 353 me = #part-race :me alice');

    feed(':alice!u@h PART #part-race :gone');
    feed(':server 353 me = #part-race :alice bob');
    feed(':server 366 me #part-race :End of /NAMES list.');

    expect(roster('#part-race')).toEqual(['bob', 'me']);
  });

  it('does not let a late 353 after an early 366 undo a live QUIT', () => {
    connect('me');
    feed(':me!u@h JOIN #quit-race');
    feed(':server 353 me = #quit-race :me alice');

    feed(':alice!u@h QUIT :gone');
    feed(':server 366 me #quit-race :End of /NAMES list.');
    feed(':server 353 me = #quit-race :alice bob');

    expect(roster('#quit-race')).toEqual(['bob', 'me']);
  });

  it('does not resurrect the old nick from a late 353 after a live NICK', () => {
    connect('me');
    feed(':me!u@h JOIN #nick-race');
    feed(':server 353 me = #nick-race :me alice');

    feed(':alice!u@h NICK alicia');
    feed(':server 353 me = #nick-race :alice bob');
    feed(':server 366 me #nick-race :End of /NAMES list.');

    expect(roster('#nick-race')).toEqual(['alicia', 'bob', 'me']);
  });

  it('does not recreate a channel from a late 353 after self-PART', () => {
    connect('me');
    feed(':me!u@h JOIN #self-part-race');
    feed(':server 353 me = #self-part-race :me alice');

    feed(':me!u@h PART #self-part-race :gone');
    feed(':server 353 me = #self-part-race :me alice');
    feed(':server 366 me #self-part-race :End of /NAMES list.');

    expect(store.getState().channels.has('#self-part-race')).toBe(false);
  });

  it('returns home and clears channel UI state after a self-KICK', () => {
    connect('me');
    feed(':me!u@h JOIN #self-kick');
    store.setState({
      channelFolders: [{ id: 'work', name: 'Work', channels: ['#self-kick'], collapsed: false }],
      activeChannelTopics: new Map([['#self-kick', 'release train']]),
    });

    feed(':op!u@h KICK #self-kick me :policy');
    feed(':server 353 me = #self-kick :me alice');

    expect(store.getState().channels.has('#self-kick')).toBe(false);
    expect(store.getState().activeView).toEqual({ kind: 'home' });
    expect(store.getState().channelFolders[0]?.channels).toEqual([]);
    expect(store.getState().activeChannelTopics.has('#self-kick')).toBe(false);
  });

  it('an expired burst cannot promote a late partial 353 to roster replacement', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      connect('me');
      feed(':me!u@h JOIN #expired');
      feed(':server 353 me = #expired :me alice');

      now.mockReturnValue(15_001);
      feed(':server 353 me = #expired :bob');

      expect(roster('#expired')).toEqual(['alice', 'bob', 'me']);
    } finally {
      now.mockRestore();
    }
  });

  it('does not re-arm a focus refresh while settled late lines can still arrive', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const client = connect('me');
      feed(':me!u@h JOIN #settled-focus');
      feed(':server 353 me = #settled-focus :me alice carol');
      feed(':server 366 me #settled-focus :End of /NAMES list.');

      // Past the ordinary 8s focus throttle but still within the 15s window in
      // which an interleaved mesh 353 can trail the first observed 366.
      now.mockReturnValue(9_000);
      store.getState().navigate({ kind: 'home' });
      store.getState().navigate({ kind: 'channel', channel: '#settled-focus' });
      expect(client.sendRaw.mock.calls.filter((call) => call[0] === 'NAMES')).toHaveLength(1);

      feed(':server 353 me = #settled-focus :bob');
      expect(roster('#settled-focus')).toEqual(['alice', 'bob', 'carol', 'me']);
    } finally {
      now.mockRestore();
    }
  });

  it('remaps existing roster status modes when ISUPPORT PREFIX changes', () => {
    connect('me');
    feed(':me!u@h JOIN #prefix-change');
    feed(':server 353 me = #prefix-change :me @alice');
    expect(store.getState().channels.get('#prefix-change')?.users.get('alice')?.modes).toEqual(new Set(['o']));

    // The same @ prefix now represents owner (q), not operator (o).
    feed(':server 005 me PREFIX=(qa)@+ :are supported by this server');

    expect(store.getState().channels.get('#prefix-change')?.users.get('alice')?.modes).toEqual(new Set(['q']));
  });
});

describe('netsplit QUIT batch — only the quitter leaves, NAMES restores truth', () => {
  it('a QUIT removes only the quitter, not the rest of the roster', () => {
    store.setState({
      ...initialState,
      client: makeClient() as never,
      ourNick: 'me',
      connectionStatus: 'connected',
      channels: new Map([
        ['#split', {
          name: '#split', topic: '', topicSetBy: '', topicSetAt: null, modes: '',
          users: new Map([
            ['me', { nick: 'me', modes: new Set<string>(), away: false }],
            ['alice', { nick: 'alice', modes: new Set<string>(), away: false }],
            ['bob', { nick: 'bob', modes: new Set<string>(), away: false }],
            ['carol', { nick: 'carol', modes: new Set<string>(), away: false }],
          ]),
          unread: 0, highlights: 0, createdAt: null, messages: [],
        }],
      ]) as never,
    }, true);

    // A netsplit emits a QUIT per departed member. Each must drain ONLY itself.
    feed(':alice!u@h QUIT :*.net *.split');
    expect(roster('#split')).toEqual(['bob', 'carol', 'me']);

    feed(':bob!u@h QUIT :*.net *.split');
    expect(roster('#split')).toEqual(['carol', 'me']);
  });

  it('a NAMES reconcile after a netsplit rebuilds the FULL server roster', () => {
    connect('me');
    feed(':me!u@h JOIN #netjoin');
    feed(':server 353 me = #netjoin :me alice');
    feed(':server 366 me #netjoin :End of /NAMES list.');
    expect(roster('#netjoin')).toEqual(['alice', 'me']);

    // Netsplit drops alice from this node's view…
    feed(':alice!u@h QUIT :*.net *.split');
    expect(roster('#netjoin')).toEqual(['me']);

    // …the reconnect resync re-arms a burst (self-JOIN replay) and NAMES then
    // rebuilds the authoritative roster, restoring the whole channel.
    feed(':me!u@h JOIN #netjoin');
    feed(':server 353 me = #netjoin :me alice bob carol dave');
    feed(':server 366 me #netjoin :End of /NAMES list.');
    expect(roster('#netjoin')).toEqual(['alice', 'bob', 'carol', 'dave', 'me']);
  });
});
