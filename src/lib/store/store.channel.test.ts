// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.channel.test.ts
 *
 * Channel management + member moderation actions. Each action sends a raw
 * server command through the IRC client; we mock the client to capture the
 * exact raw line. We also drive MODE / 324 numerics through _handleMessage to
 * assert the derived mode + role selectors that gate the UI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store, type Server } from './store';
import {
  selectIsChannelOp,
  selectOwnPrefix,
  selectChannelModeState,
  parseChannelModeString,
  _beginNamesBurstForTests,
  _resetNamesBurstsForTests,
  _resetWhoisRequestTimerForTests,
} from './store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { TOPIC_TAG } from '@/lib/topics/topics';
import { follow, followed, unfollow } from '@/lib/notifications/followed';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://channels.test', identity: 'me' } as const;
const memoryServer: Server = {
  id: 'channel-test',
  name: 'Channels',
  network: 'Channels',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
  connected: true,
};

/** Minimal IRCClient stand-in — assert on sendRaw, satisfy handler reads. */
function makeClient() {
  return {
    sendRaw: vi.fn((..._args: string[]) => true),
    destroy: vi.fn(),
    send: vi.fn((_line: string) => true),
    join: vi.fn((_channel: string, _key?: string) => true),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    modeToPrefix: { Y: '*', Q: '!', q: '~', a: '&', o: '@', h: '%', v: '+' } as Record<string, string>,
    prefixToMode: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' } as Record<string, string>,
  };
}

function makeUser(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeChannel(name: string, users: ChannelUser[], modes = ''): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: 'Welcome',
    topicSetBy: 'server',
    topicSetAt: null,
    modes,
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

/** Seed a channel with the given users and set ourNick + a mock client. */
function seed(channelName: string, users: ChannelUser[], ourNick = 'me', modes = '') {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set(channelName.toLowerCase(), makeChannel(channelName, users, modes));
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    ourNick,
    activeView: { kind: 'channel', channel: channelName.toLowerCase() },
    connectionStatus: 'connected',
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState(initialState, true);
  // NAMES-burst + roster-refresh tracking is module-level state that survives a
  // setState reset; clear it so an armed 'expect' can't leak across tests.
  _resetNamesBurstsForTests();
  _resetWhoisRequestTimerForTests();
  for (const key of followed()) unfollow(key);
  localStorage.clear();
});

// ── Raw command dispatch ────────────────────────────────────────────────────

describe('channel management — raw command dispatch', () => {
  it('setTopic() sends TOPIC <chan> :<text>', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().setTopic('#general', 'New topic');
    expect(client.sendRaw).toHaveBeenCalledWith('TOPIC', '#general', 'New topic');
  });

  it('setChannelMode() sends MODE with modes and args', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().setChannelMode('#general', '+k', 'secret');
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#general', '+k', 'secret');
  });

  it('setChannelMode() is a no-op with empty mode string', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().setChannelMode('#general', '');
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('kickMember() sends KICK with a reason when provided', () => {
    const client = seed('#general', [makeUser('me', ['o']), makeUser('bob')]);
    store.getState().kickMember('#general', 'bob', 'spamming');
    expect(client.sendRaw).toHaveBeenCalledWith('KICK', '#general', 'bob', 'spamming');
  });

  it('kickMember() omits the trailing reason param when none given', () => {
    const client = seed('#general', [makeUser('me', ['o']), makeUser('bob')]);
    store.getState().kickMember('#general', 'bob');
    expect(client.sendRaw).toHaveBeenCalledWith('KICK', '#general', 'bob');
  });

  it('banMask() sends MODE +b <mask> and unbanMask() sends -b', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().banMask('#general', 'bad!*@*');
    store.getState().unbanMask('#general', 'bad!*@*');
    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'MODE', '#general', '+b', 'bad!*@*');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'MODE', '#general', '-b', 'bad!*@*');
  });

  it('banMask() ignores blank masks', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().banMask('#general', '   ');
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('inviteUser() sends INVITE <nick> <chan> in RFC order', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().inviteUser('#general', 'carol');
    expect(client.sendRaw).toHaveBeenCalledWith('INVITE', 'carol', '#general');
  });

  it('webhook actions send WEBHOOK subcommands', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().webhookCreate('#general', 'ci bot');
    store.getState().webhookList('#general');
    store.getState().webhookDelete('wh_123');

    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'WEBHOOK', 'CREATE', '#general', 'ci bot');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'WEBHOOK', 'LIST', '#general');
    expect(client.sendRaw).toHaveBeenNthCalledWith(3, 'WEBHOOK', 'DELETE', 'wh_123');
  });

  it('WEBHOOK notices route to service notices', () => {
    seed('#general', [makeUser('me', ['o'])]);
    feed(':server.test NOTICE me :WEBHOOK: created for #general - POST Discord webhook JSON to https://chat.example/api/webhooks/id/token');
    expect(store.getState().serviceNotices.at(-1)).toMatchObject({
      source: 'Webhook',
      text: expect.stringContaining('WEBHOOK: created for #general'),
    });
  });

  it('flattens channel NOTICE bodies that are Discord webhook JSON', () => {
    seed('#general', [makeUser('me', ['o'])]);
    const body = JSON.stringify({
      username: 'DeployBot',
      content: 'Ship complete',
      embeds: [{ title: 'Release', description: 'v2', fields: [{ name: 'sha', value: 'deadbeef' }] }],
    });
    feed(`:hook!bot@host NOTICE #general :${body}`);

    const last = store.getState().channels.get('#general')?.messages.at(-1);
    expect(last).toMatchObject({ type: 'notice', from: 'hook' });
    expect(last?.text).toContain('DeployBot');
    expect(last?.text).toContain('Ship complete');
    expect(last?.text).toContain('sha: deadbeef');
    expect(last?.text).not.toContain('{');
  });

  it('stores Onyx Server topic tags on channel messages', () => {
    seed('#general', [makeUser('me', ['o'])]);
    feed(`@${TOPIC_TAG}=roadmap;msgid=m-topic :alice!a@host PRIVMSG #general :next milestone`);

    expect(store.getState().channels.get('#general')?.messages.at(-1)).toMatchObject({
      id: 'm-topic',
      text: 'next milestone',
      topic: 'roadmap',
    });
  });

  it('createRoom() joins, sets an optional topic, lands in the room, and focuses the composer', () => {
    const client = seed('#general', [makeUser('me')]);
    store.setState({ showChannelBrowser: true, channelBrowserMode: 'create' });

    expect(store.getState().createRoom({
      name: ' Friends ',
      topic: ' Weekly reads ',
      skin: 'friends',
      hangLabel: 'Saturday 4:00 PM',
      firstLine: 'hey — this is our room',
      sharedInvite: true,
    })).toBe(true);
    feed(':me JOIN #friends');
    expect(client.join).toHaveBeenCalledWith('#friends', undefined);
    expect(client.sendRaw).toHaveBeenCalledWith(
      'TOPIC',
      '#friends',
      'Friends hang · Weekly reads · Next hang: Saturday 4:00 PM',
    );
    expect(client.sendRaw.mock.calls.some((args) => String(args[0]) === 'MODE')).toBe(false);
    expect(client.sendRaw.mock.calls.some((args) => String(args[0]) === 'ACCESS')).toBe(false);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#friends' });
    expect(store.getState().getComposerDraft('#friends')).toBe('hey — this is our room');
    expect(store.getState().showChannelBrowser).toBe(false);
    expect(store.getState().channelBrowserMode).toBe('browse');
  });

  it('createRoom() refuses to finish without a share/invite action', () => {
    const client = seed('#general', [makeUser('me')]);

    expect(store.getState().createRoom({
      name: 'friends',
      sharedInvite: false,
    })).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('createRoom() refuses an invalid name without sending JOIN', () => {
    const client = seed('#general', [makeUser('me')]);

    expect(store.getState().createRoom({
      name: 'bad,name',
      sharedInvite: true,
    })).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('createRoom() focuses an empty composer when no first line is suggested', () => {
    seed('#general', [makeUser('me')]);

    expect(store.getState().createRoom({
      name: 'quiet',
      sharedInvite: true,
    })).toBe(true);
    feed(':me JOIN #quiet');
    expect(store.getState().pendingComposerFocusTarget).toBe('#quiet');
    store.getState().clearPendingComposerFocus();
    expect(store.getState().pendingComposerFocusTarget).toBeNull();
  });

  it('openCreateRoom() opens the existing browser on the create view without LIST', () => {
    const client = seed('#general', [makeUser('me')]);
    store.getState().openCreateRoom();
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(store.getState().channelBrowserMode).toBe('create');
    expect(store.getState().channelListLoading).toBe(false);
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('deduplicates channel browser LIST rows by room name', () => {
    seed('#general', [makeUser('me')]);
    store.setState({ channelListLoading: true });

    feed(':server.test 322 me #general 2 :Launch room');
    feed(':server.test 322 me #General 5 :');
    feed(':server.test 322 me #random 1 :Off-topic');
    feed(':server.test 322 me #general 3 :Duplicated mesh row');
    feed(':server.test 323 me :End of LIST');

    expect(store.getState().channelList).toEqual([
      { name: '#general', count: 5, topic: 'Launch room' },
      { name: '#random', count: 1, topic: 'Off-topic' },
    ]);
    expect(store.getState().channelListLoading).toBe(false);
  });

  it('retains the committed directory when a refresh disconnects before LISTEND', () => {
    const client = seed('#general', [makeUser('me')]);
    store.setState({
      channelList: [{ name: '#saved', count: 3, topic: 'Saved room' }],
      channelListCommitted: [{ name: '#saved', count: 3, topic: 'Saved room' }],
      channelListLoading: false,
      channelListRequest: null,
    });

    store.getState().refreshChannelList();
    feed(':server.test 322 me #new 4 :New room');
    expect(store.getState().channelList).toEqual([{ name: '#new', count: 4, topic: 'New room' }]);
    expect(store.getState().channelListRequest).toEqual([{ name: '#new', count: 4, topic: 'New room' }]);

    store.getState().disconnect();

    expect(client.destroy).toHaveBeenCalled();
    expect(store.getState().channelList).toEqual([{ name: '#saved', count: 3, topic: 'Saved room' }]);
    expect(store.getState().channelListLoading).toBe(false);
    expect(store.getState().channelListRequest).toBeNull();
  });

  it('restores the committed directory when the socket disconnects mid-LIST', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 1;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.getState().connect({ url: 'wss://channels.test', nick: 'me' });
      const committed = [{ name: '#saved', count: 3, topic: 'Saved room' }];
      store.setState({
        channelList: committed,
        channelListCommitted: committed,
        channelListLoading: true,
        channelListRequest: [{ name: '#partial', count: 1, topic: 'Partial' }],
        autoReconnect: false,
        connectionStatus: 'connected',
      });

      const client = store.getState().client as unknown as {
        opts: { onDisconnected?: (reason: string) => void };
      };
      client.opts.onDisconnected?.('socket closed');

      expect(store.getState().channelList).toEqual(committed);
      expect(store.getState().channelListLoading).toBe(false);
      expect(store.getState().channelListRequest).toBeNull();
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('clears a timed-out LIST quarantine across reconnect and ignores the old burst', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();

    try {
      store.getState().connect({ url: 'wss://channels.test', nick: 'me' });
      const client = store.getState().client as unknown as {
        opts: { onConnected?: () => void; onDisconnected?: (reason: string) => void };
      };
      store.setState({ connectionStatus: 'connected' });
      store.getState().refreshChannelList();
      vi.advanceTimersByTime(15_000);
      expect(store.getState().channelListLoading).toBe(false);

      client.opts.onDisconnected?.('socket closed');
      client.opts.onConnected?.();
      store.setState({ client: makeClient() as never, connectionStatus: 'connected' });
      store.getState().refreshChannelList();
      expect(store.getState().channelListLoading).toBe(true);
      // The current client can start another fresh LIST after the old
      // quarantine was cleared by reconnect. Old socket callbacks are detached
      // by IRCClient, so late numerics from that socket never reach the store.
      store.setState({ channelListLoading: false, channelListRequest: null });
      store.getState().refreshChannelList();
      expect(store.getState().channelListLoading).toBe(true);
    } finally {
      vi.useRealTimers();
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('keeps a pending create until its matching self-JOIN', () => {
    const client = seed('#general', [makeUser('me')]);

    expect(store.getState().createRoom({ name: '#new', sharedInvite: true })).toBe(true);
    feed(':me JOIN #other');
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#other' });
    feed(':me JOIN #new');

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#new' });
    expect(client.join).toHaveBeenCalledWith('#new', undefined);
  });

  it('routes channel-full rejection through the join prompt', () => {
    seed('#general', [makeUser('me')]);
    feed(':server.test 471 me #full :Channel is full');
    expect(store.getState().channelJoinPrompt).toEqual({ channel: '#full', error: 'This room is full' });
  });

  it('tags outbound messages with the active named conversation', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().setActiveChannelTopic('#general', 'release train');

    store.getState().sendMessage('#general', 'ship it');

    expect(client.send).toHaveBeenCalledWith('@onyx/topic=release\\strain PRIVMSG #general :ship it\r\n');
    expect(store.getState().channels.get('#general')?.messages.at(-1)).toMatchObject({
      text: 'ship it',
      topic: 'release train',
    });
  });

  it('refuses invalid active topic labels', () => {
    seed('#general', [makeUser('me', ['o'])]);

    store.getState().setActiveChannelTopic('#general', 'bad,label');

    expect(store.getState().activeChannelTopics.has('#general')).toBe(false);
  });

  it('adds topic and reply tags to outbound multiline batches', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    client.negotiatedCaps.add('draft/multiline');
    store.getState().setActiveChannelTopic('#general', 'roadmap');
    store.getState().setReplyingTo({
      id: 'parent-1',
      from: 'alice',
      text: 'earlier',
      time: new Date('2025-01-01T12:00:00Z'),
      type: 'msg',
      target: '#general',
    });

    store.getState().sendMessage('#general', 'line one\nline two');

    expect(client.send).toHaveBeenCalledWith(
      expect.stringMatching(/^@onyx\/topic=roadmap;\+draft\/reply=parent-1 BATCH \+/),
      expect.objectContaining({ onUncertain: expect.any(Function) }),
    );
  });

  it('adds a follow notification for followed channel topics', () => {
    seed('#general', [makeUser('me', ['o'])]);
    store.setState({ activeView: { kind: 'home' }, server: memoryServer });
    follow('#general', 'roadmap', MEMORY_OWNER);

    feed(`@${TOPIC_TAG}=roadmap;msgid=m-follow :alice!a@host PRIVMSG #general :quiet update`);

    expect(store.getState().notifications.at(-1)).toMatchObject({
      type: 'follow',
      from: 'alice',
      channel: '#general',
      topic: 'roadmap',
      text: 'quiet update',
    });
  });

  it('opMember() toggles +o / -o', () => {
    const client = seed('#general', [makeUser('me', ['o']), makeUser('bob')]);
    store.getState().opMember('#general', 'bob', true);
    store.getState().opMember('#general', 'bob', false);
    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'MODE', '#general', '+o', 'bob');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'MODE', '#general', '-o', 'bob');
  });

  it('voiceMember() toggles +v / -v', () => {
    const client = seed('#general', [makeUser('me', ['o']), makeUser('bob')]);
    store.getState().voiceMember('#general', 'bob', true);
    store.getState().voiceMember('#general', 'bob', false);
    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'MODE', '#general', '+v', 'bob');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'MODE', '#general', '-v', 'bob');
  });

  it('whois() requests a WHOIS and opens the whois panel', () => {
    const client = seed('#general', [makeUser('me', ['o'])]);
    store.getState().whois('bob');
    expect(client.sendRaw).toHaveBeenCalledWith('WHOIS', 'bob', 'bob');
    expect(store.getState().showWhois).toBe(true);
    expect(store.getState().whoisNick).toBe('bob');
  });

  it('settles WHOIS immediately with a reconnect error when no client is available', () => {
    store.setState({ ...initialState }, true);

    store.getState().whois('offline-user');

    expect(store.getState().showWhois).toBe(true);
    expect(store.getState().whoisData.get('offline-user')).toMatchObject({
      loading: false,
      error: 'Reconnect to request profile details.',
    });
  });

  it('settles the matching WHOIS request when the server reports no such nick', () => {
    seed('#general', [makeUser('me', ['o'])]);
    store.getState().whois('departed-user');

    feed(':server 401 me departed-user :No such nick');

    expect(store.getState().whoisData.get('departed-user')).toMatchObject({
      loading: false,
      error: 'No profile was found for departed-user. They may have left the network.',
    });
  });

  it('merges multi-line WHOIS channel lists and accumulates special notes', () => {
    seed('#general', [makeUser('me', ['o'])]);
    store.getState().whois('alice');

    feed(':server 319 me alice :@#root');
    feed(':server 319 me alice :+#chat');
    feed(':server 320 me alice :Geo: US');
    feed(':server 320 me alice :Caller-ID enabled');
    feed(':server 313 me alice :is a Network Administrator');
    feed(':server 671 me alice :is using a secure connection');
    feed(':server 318 me alice :End of /WHOIS list');

    expect(store.getState().whoisData.get('alice')).toMatchObject({
      loading: false,
      channels: ['@#root', '+#chat'],
      specialNotes: ['Geo: US', 'Caller-ID enabled'],
      operRole: 'Network Administrator',
      isOper: true,
      secureConnection: 'is using a secure connection',
    });
  });

  it('actions are safe no-ops without a client', () => {
    store.setState({ ...initialState }, true);
    expect(() => {
      store.getState().setTopic('#x', 't');
      store.getState().kickMember('#x', 'bob');
      store.getState().opMember('#x', 'bob', true);
    }).not.toThrow();
  });
});

// ── Role gating selectors ───────────────────────────────────────────────────

describe('selectIsChannelOp / selectOwnPrefix', () => {
  it('returns true for an op and false for a plain member', () => {
    seed('#general', [makeUser('me', ['o'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(true);

    seed('#general', [makeUser('me', [])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(false);
  });

  it('treats owner (q) and founder (Q) as op+', () => {
    seed('#general', [makeUser('me', ['q'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(true);
    seed('#general', [makeUser('me', ['Q'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(true);
  });

  it('treats channel admins as op+ while halfops remain below op', () => {
    seed('#general', [makeUser('me', ['a'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(true);
    seed('#general', [makeUser('me', ['h'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(false);
  });

  it('voice alone does NOT grant op', () => {
    seed('#general', [makeUser('me', ['v'])]);
    expect(selectIsChannelOp('#general')(store.getState())).toBe(false);
  });

  it('network operators (isOper) are always op+', () => {
    seed('#general', [makeUser('me', [])]);
    store.setState({ isOper: true });
    expect(selectIsChannelOp('#general')(store.getState())).toBe(true);
  });

  it('selectOwnPrefix returns our highest-ranked status letter', () => {
    seed('#general', [makeUser('me', ['o', 'v'])]);
    expect(selectOwnPrefix('#general')(store.getState())).toBe('o');
    seed('#general', [makeUser('me', ['v'])]);
    expect(selectOwnPrefix('#general')(store.getState())).toBe('v');
    seed('#general', [makeUser('me', [])]);
    expect(selectOwnPrefix('#general')(store.getState())).toBe('');
  });

  it('selectOwnPrefix ranks standard admin between owner and op', () => {
    seed('#general', [makeUser('me', ['o', 'a'])]);
    expect(selectOwnPrefix('#general')(store.getState())).toBe('a');
    seed('#general', [makeUser('me', ['h', 'v'])]);
    expect(selectOwnPrefix('#general')(store.getState())).toBe('h');
  });
});

// ── Mode-state tracking ─────────────────────────────────────────────────────

describe('parseChannelModeString', () => {
  it('splits flags from key and limit', () => {
    const st = parseChannelModeString('+mntkl secret 50');
    expect(st.flags.has('m')).toBe(true);
    expect(st.flags.has('t')).toBe(true);
    expect(st.key).toBe('secret');
    expect(st.limit).toBe(50);
  });

  it('returns empty state for blank input', () => {
    const st = parseChannelModeString('');
    expect(st.flags.size).toBe(0);
    expect(st.key).toBeNull();
    expect(st.limit).toBeNull();
  });
});

describe('channel mode tracking via _handleMessage', () => {
  it('RPL_CHANNELMODEIS (324) seeds Channel.modes authoritatively', () => {
    seed('#general', [makeUser('me', ['o'])]);
    feed(':server 324 me #general +mnt');
    const st = selectChannelModeState('#general')(store.getState());
    expect(st.flags.has('m')).toBe(true);
    expect(st.flags.has('n')).toBe(true);
    expect(st.flags.has('t')).toBe(true);
  });

  it('RPL_CREATIONTIME (329) seeds Channel.createdAt from the unix timestamp', () => {
    seed('#general', [makeUser('me', ['Q'])]);
    feed(':server 329 me #general 1724350000');
    expect(store.getState().channels.get('#general')?.createdAt).toEqual(new Date(1724350000 * 1000));
    feed(':server 329 me #general not-a-time');
    expect(store.getState().channels.get('#general')?.createdAt).toEqual(new Date(1724350000 * 1000));
  });

  it('a live MODE +k echo records the key, and -k clears it', () => {
    seed('#general', [makeUser('me', ['o'])]);
    feed(':op!u@h MODE #general +k hunter2');
    expect(selectChannelModeState('#general')(store.getState()).key).toBe('hunter2');
    feed(':op!u@h MODE #general -k hunter2');
    expect(selectChannelModeState('#general')(store.getState()).key).toBeNull();
  });

  it('a live MODE +l echo records the limit, and -l clears it', () => {
    seed('#general', [makeUser('me', ['o'])]);
    feed(':op!u@h MODE #general +l 25');
    expect(selectChannelModeState('#general')(store.getState()).limit).toBe(25);
    feed(':op!u@h MODE #general -l');
    expect(selectChannelModeState('#general')(store.getState()).limit).toBeNull();
  });

  it('status-mode (+o) echoes do NOT pollute the channel flag set', () => {
    seed('#general', [makeUser('me', ['o']), makeUser('bob')]);
    feed(':op!u@h MODE #general +o bob');
    const st = selectChannelModeState('#general')(store.getState());
    expect(st.flags.has('o')).toBe(false);
    // but bob now holds op as a per-user status mode
    expect(store.getState().channels.get('#general')?.users.get('bob')?.modes.has('o')).toBe(true);
  });
});

// ── NAMES is authoritative (353/366) ────────────────────────────────────────

describe('NAMES (353/366) replaces the roster', () => {
  function seedEmpty(name: string, ourNick = 'me') {
    const client = makeClient();
    const channels = new Map<string, Channel>();
    channels.set(name.toLowerCase(), makeChannel(name, []));
    store.setState({
      ...initialState,
      client: client as never,
      ourNick,
      channels,
      activeView: { kind: 'channel', channel: name.toLowerCase() },
    }, true);
    return client;
  }

  function roster(name: string): string[] {
    const c = store.getState().channels.get(name.toLowerCase());
    return c ? [...c.users.keys()].sort() : [];
  }

  it('drops departed members when a client-initiated NAMES burst arrives', () => {
    seedEmpty('#room');
    // A self-JOIN / reconcile arms the burst ('expect') before the server's 353,
    // authorizing its first line to REPLACE the roster. Mirror that intent.
    _beginNamesBurstForTests('#room');
    feed(':irc 353 me = #room :me alice bob');
    feed(':irc 366 me #room :End of /NAMES list.');
    expect(roster('#room')).toEqual(['alice', 'bob', 'me']);

    // Reconnect: the reconcile re-arms the burst, so the fresh 353 REPLACES —
    // alice/bob who left during the gap must not linger.
    _beginNamesBurstForTests('#room');
    feed(':irc 353 me = #room :me charlie');
    feed(':irc 366 me #room :End of /NAMES list.');
    expect(roster('#room')).toEqual(['charlie', 'me']);
  });

  it('a late cross-node 353 (no client intent) APPENDS and never collapses the roster', () => {
    seedEmpty('#room');
    // Full authoritative snapshot from a client-initiated burst.
    _beginNamesBurstForTests('#room');
    feed(':irc 353 me = #room :me alice bob');
    feed(':irc 366 me #room :End of /NAMES list.');
    expect(roster('#room')).toEqual(['alice', 'bob', 'me']);

    // Post-netsplit resync: a straggler cross-node 353 arrives AFTER the 366 with
    // NO client-initiated burst arming it (the daemon only sends 353 in reply to
    // OUR JOIN/NAMES, so an un-armed line is definitionally a late partial). It
    // must APPEND — replacing here would collapse the roster to this 1-nick subset.
    feed(':irc 353 me = #room :charlie');
    expect(roster('#room')).toEqual(['alice', 'bob', 'charlie', 'me']);
  });

  it('accumulates multiple 353 lines within a single burst', () => {
    seedEmpty('#room');
    feed(':irc 353 me = #room :me alice');
    feed(':irc 353 me = #room :bob carol');
    feed(':irc 366 me #room :End of /NAMES list.');
    expect(roster('#room')).toEqual(['alice', 'bob', 'carol', 'me']);
  });

  it('preserves standard admin, op, halfop, and voice prefixes from NAMES', () => {
    seedEmpty('#root');
    feed(':irc 353 me = #root :&admin @oper %halfop +voice plain');
    feed(':irc 366 me #root :End of /NAMES list.');
    const users = store.getState().channels.get('#root')?.users;
    expect(users?.get('admin')?.modes.has('a')).toBe(true);
    expect(users?.get('oper')?.modes.has('o')).toBe(true);
    expect(users?.get('halfop')?.modes.has('h')).toBe(true);
    expect(users?.get('voice')?.modes.has('v')).toBe(true);
    expect(users?.get('plain')?.modes.size).toBe(0);
  });

  it('preserves away and account metadata while NAMES refreshes roles and membership', () => {
    seed('#root', [
      makeUser('me'),
      { nick: 'alice', modes: new Set(['v']), away: true, account: 'alice-account' },
      makeUser('ghost'),
    ]);

    _beginNamesBurstForTests('#root');
    feed(':irc 353 me = #root :me @alice bob');
    feed(':irc 366 me #root :End of /NAMES list.');

    const users = store.getState().channels.get('#root')?.users;
    expect([...users?.keys() ?? []].sort()).toEqual(['alice', 'bob', 'me']);
    expect(users?.get('alice')).toMatchObject({
      nick: 'alice',
      away: true,
      account: 'alice-account',
    });
    expect(users?.get('alice')?.modes).toEqual(new Set(['o']));
    expect(users?.get('bob')).toMatchObject({ nick: 'bob', away: false });
  });
});

describe('navigate() reconciles the focused channel roster', () => {
  // A mesh netsplit can leave the member list stale with no delta to fix it.
  // Focusing a channel re-requests NAMES so the list reconciles to server truth.
  function seedConnected(name: string) {
    const client = makeClient();
    const channels = new Map<string, Channel>();
    channels.set(name.toLowerCase(), makeChannel(name, [makeUser('me')]));
    store.setState({
      ...initialState,
      client: client as never,
      connectionStatus: 'connected',
      ourNick: 'me',
      channels,
      activeView: { kind: 'home' },
    }, true);
    return client;
  }

  it('sends NAMES when navigating to a joined channel', () => {
    const client = seedConnected('#recon1');
    store.getState().navigate({ kind: 'channel', channel: '#recon1' });
    expect(client.sendRaw).toHaveBeenCalledWith('NAMES', '#recon1');
  });

  it('normalizes a mixed-case channel navigation to the map key', () => {
    seedConnected('#NavCase');

    store.getState().navigate({ kind: 'channel', channel: '#NavCase' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#navcase' });
  });

  it('throttles repeated focus so it does not spam NAMES', () => {
    const client = seedConnected('#recon2');
    store.getState().navigate({ kind: 'channel', channel: '#recon2' });
    store.getState().navigate({ kind: 'home' });
    store.getState().navigate({ kind: 'channel', channel: '#recon2' });
    const names = client.sendRaw.mock.calls.filter((c) => c[0] === 'NAMES');
    expect(names).toHaveLength(1);
  });

  it('does not send NAMES for a channel we are not in', () => {
    const client = seedConnected('#recon3');
    store.getState().navigate({ kind: 'channel', channel: '#notjoined' });
    const names = client.sendRaw.mock.calls.filter((c) => c[0] === 'NAMES');
    expect(names).toHaveLength(0);
  });

  it('does not send NAMES while disconnected', () => {
    const client = seedConnected('#recon4');
    store.setState({ connectionStatus: 'disconnected' });
    store.getState().navigate({ kind: 'channel', channel: '#recon4' });
    const names = client.sendRaw.mock.calls.filter((c) => c[0] === 'NAMES');
    expect(names).toHaveLength(0);
  });

  it('self-JOIN arms NAMES without a second request and keeps mixed-case roster addressable', () => {
    // A client-initiated JOIN already triggers the server's automatic 353/366.
    // Sending an extra NAMES here re-armed expect mid-burst and collapsed mesh
    // nicklists — so normal self-JOIN only arms the burst. Session reclaim still
    // requests NAMES explicitly (covered in store.sessionRoster.test.ts).
    const client = makeClient();
    store.setState({
      ...initialState,
      client: client as never,
      connectionStatus: 'connected',
      ourNick: 'me',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);
    feed(':me JOIN #ResumeCase');
    feed(':irc 353 me = #ResumeCase :me Alice');

    expect(client.sendRaw.mock.calls.filter((c) => c[0] === 'NAMES')).toHaveLength(0);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#resumecase' });
    expect([...store.getState().channels.get('#resumecase')?.users.keys() ?? []].sort()).toEqual(['alice', 'me']);
  });

  it('requests NAMES once after self-JOIN when no-implicit-names is negotiated', () => {
    const client = makeClient();
    client.negotiatedCaps.add('draft/no-implicit-names');
    store.setState({
      ...initialState,
      client: client as never,
      connectionStatus: 'connected',
      ourNick: 'me',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);

    feed(':me JOIN #ExplicitRoster');
    feed(':irc 353 me = #ExplicitRoster :me Alice @Bob');
    feed(':irc 366 me #ExplicitRoster :End of /NAMES list');

    expect(client.sendRaw.mock.calls.filter((c) => c[0] === 'NAMES')).toEqual([
      ['NAMES', '#ExplicitRoster'],
    ]);
    expect([...store.getState().channels.get('#explicitroster')?.users.keys() ?? []].sort()).toEqual([
      'alice',
      'bob',
      'me',
    ]);
  });
});

// ── Server / status buffer ──────────────────────────────────────────────────
describe('server status buffer (serverLog)', () => {
  beforeEach(() => {
    store.setState({ ...initialState, ourNick: 'me' }, true);
  });

  const log = () => store.getState().serverLog;

  it('starts empty and addServerLog appends a system message at the status target', () => {
    expect(log()).toEqual([]);
    store.getState().addServerLog('hello there', 'irc.example');
    expect(log()).toHaveLength(1);
    expect(log()[0]!.text).toBe('hello there');
    expect(log()[0]!.from).toBe('irc.example');
    expect(log()[0]!.type).toBe('system');
    expect(log()[0]!.target).toBe('*status');
  });

  it('captures the 001 welcome', () => {
    feed(':irc.example 001 me :Welcome to the Onyx network, me');
    expect(log().some(m => /Welcome to the Onyx network/.test(m.text))).toBe(true);
  });

  it('surfaces an otherwise-unhandled server numeric instead of dropping it', () => {
    // 265 RPL_LOCALUSERS has no dedicated case → would hit `default` and vanish.
    feed(':irc.example 265 me 2 2 :Current local users 2, max 2');
    expect(log().some(m => /Current local users 2, max 2/.test(m.text))).toBe(true);
  });

  it('does NOT log a non-numeric unhandled command to the status buffer', () => {
    feed(':irc.example FOOBAR me :some payload');
    expect(log()).toHaveLength(0);
  });

  it('records a server-wide NOTICE in the status buffer', () => {
    feed(':irc.example NOTICE * :Server going down for maintenance');
    expect(log().some(m => /going down for maintenance/.test(m.text))).toBe(true);
  });

  it('records your own user MODE', () => {
    feed(':me MODE me :+iw');
    expect(log().some(m => /your user mode: \+iw/.test(m.text))).toBe(true);
  });

  it('caps the buffer at 500 entries', () => {
    for (let i = 0; i < 520; i++) store.getState().addServerLog(`line ${i}`);
    expect(log()).toHaveLength(500);
    expect(log()[0]!.text).toBe('line 20'); // oldest 20 dropped
    expect(log()[499]!.text).toBe('line 519');
  });

  it('ignores empty text', () => {
    store.getState().addServerLog('');
    expect(log()).toHaveLength(0);
  });
});
