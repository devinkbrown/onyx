// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import {
  MAX_VAULT_MESSAGE_ID_LENGTH,
  MAX_VAULT_MESSAGE_TEXT_LENGTH,
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
} from '@/lib/vault/historyVault';
import {
  _beginNamesBurstForTests,
  MAX_CHANNEL_LIST_ENTRIES,
  MAX_LIVE_CHANNELS,
  MAX_LIVE_CHANNEL_MESSAGES,
  MAX_LIVE_CHANNEL_USERS,
  MAX_LIVE_DM_CONVERSATIONS,
  MAX_LIVE_PROP_KEYS,
  MAX_LIVE_PROP_TARGETS,
  MAX_LIVE_PROP_VALUE_LENGTH,
  MAX_TEGAMI_CONVERSATIONS,
  MAX_TEGAMI_COUNT,
  store,
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

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState({
    ...initialState,
    client: {
      isupport: { CHANTYPES: '#&' },
      negotiatedCaps: new Set<string>(),
      capValues: new Map<string, string>(),
      prefixToMode: { '@': 'o' },
      sendRaw: () => true,
      send: () => true,
    } as never,
    ourNick: 'me',
    connectionStatus: 'connected',
    channels: new Map([['#root', channel('#root')]]),
  }, true);
});

describe('live inbound message bounds', () => {
  it('accepts only requested, bounded, sanitized channel directory rows', () => {
    feed(':server 322 me #unsolicited 4 :hidden allocation');
    expect(store.getState().channelList).toEqual([]);

    store.setState({ channelListLoading: true });
    feed(`:server 322 me #room-0 4 :${'x'.repeat(4 * 1024)}😀tail`);
    feed(':server 322 me not-a-channel 5 :invalid');
    for (let index = 1; index < MAX_CHANNEL_LIST_ENTRIES + 8; index += 1) {
      feed(`:server 322 me #room-${index} ${index} :topic ${index}`);
    }

    const rows = store.getState().channelList;
    expect(rows).toHaveLength(MAX_CHANNEL_LIST_ENTRIES);
    expect(rows[0]).toMatchObject({ name: '#room-0', count: 4 });
    expect(rows[0]?.topic).toBe('x'.repeat(4 * 1024));
    expect(rows.some((row) => row.name === 'not-a-channel')).toBe(false);
    expect(rows.some((row) => row.name === `#room-${MAX_CHANNEL_LIST_ENTRIES}`)).toBe(false);
  });

  it('stores at most one vault-sized message body without splitting a surrogate pair', () => {
    const text = `${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1)}😀tail`;
    feed(`:alice!u@host PRIVMSG #root :${text}`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1));
    expect(stored?.text).toHaveLength(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1);
  });

  it('drops a sender or target that cannot be represented safely', () => {
    feed(`:${'a'.repeat(MAX_VAULT_SENDER_LENGTH + 1)}!u@host PRIVMSG me :oversized sender`);
    feed(`:me!u@host PRIVMSG ${'b'.repeat(MAX_VAULT_TARGET_LENGTH + 1)} :oversized target`);

    expect(store.getState().dms.size).toBe(0);
    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
  });

  it('replaces an oversized server message id instead of retaining it', () => {
    feed(`@msgid=${'m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :alice!u@host PRIVMSG #root :safe`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('safe');
    expect(stored?.id).toBeTruthy();
    expect(stored?.id).not.toContain('m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1));
    expect(stored?.id.length).toBeLessThanOrEqual(MAX_VAULT_MESSAGE_ID_LENGTH);
  });

  it('ignores an oversized reply id instead of retaining it in message state', () => {
    feed(`@draft/reply=${'r'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :alice!u@host PRIVMSG #root :safe reply text`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('safe reply text');
    expect(stored?.replyTo).toBeUndefined();
  });

  it('applies vault field bounds to offline TEGAMI delivery', () => {
    feed(`@msgid=${'m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :eshmaki.me NOTE TEGAMI :from alice :${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH + 8)}`);

    const stored = store.getState().dms.get('alice')?.messages[0];
    expect(stored?.text).toHaveLength(MAX_VAULT_MESSAGE_TEXT_LENGTH);
    expect(stored?.id).toBeTruthy();
    expect(stored?.id.length).toBeLessThanOrEqual(MAX_VAULT_MESSAGE_ID_LENGTH);
    expect(store.getState().tegami.get('alice')).toEqual({ count: 1, firstMsgId: stored?.id });

    feed(`:eshmaki.me NOTE TEGAMI :from ${'a'.repeat(MAX_VAULT_SENDER_LENGTH + 1)} :rejected`);
    expect(store.getState().dms.size).toBe(1);
    expect(store.getState().tegami.size).toBe(1);
  });

  it('caps offline aggregates and repairs an oversized legacy aggregate map', () => {
    feed(':eshmaki.me NOTE TEGAMI :from alice :first');
    store.setState({
      tegami: new Map([
        ...Array.from(
          { length: MAX_TEGAMI_CONVERSATIONS + 8 },
          (_, index) => [`legacy-${index}`, { count: 1, firstMsgId: `old-${index}` }] as const,
        ),
        ['alice', { count: MAX_TEGAMI_COUNT, firstMsgId: 'first' }],
      ]),
    });

    feed(':eshmaki.me NOTE TEGAMI :from alice :again');
    expect(store.getState().tegami.size).toBe(MAX_TEGAMI_CONVERSATIONS);
    expect(store.getState().tegami.get('alice')?.count).toBe(MAX_TEGAMI_COUNT);
  });

  it('bounds unsolicited DM conversations without evicting unread rows', () => {
    for (let index = 0; index < MAX_LIVE_DM_CONVERSATIONS + 1; index += 1) {
      feed(`:user-${index}!u@host PRIVMSG me :message ${index}`);
    }

    expect(store.getState().dms.size).toBe(MAX_LIVE_DM_CONVERSATIONS);
    expect(store.getState().dms.has(`user-${MAX_LIVE_DM_CONVERSATIONS}`)).toBe(false);

    const dms = new Map(store.getState().dms);
    const oldest = dms.get('user-0');
    expect(oldest).toBeDefined();
    dms.set('user-0', { ...oldest!, unread: 0, highlights: 0 });
    store.setState({ dms });

    feed(`:user-${MAX_LIVE_DM_CONVERSATIONS}!u@host PRIVMSG me :retry`);
    expect(store.getState().dms.size).toBe(MAX_LIVE_DM_CONVERSATIONS);
    expect(store.getState().dms.has('user-0')).toBe(false);
    expect(store.getState().dms.has(`user-${MAX_LIVE_DM_CONVERSATIONS}`)).toBe(true);
    expect(store.getState().firstUnreadId.has('user-0')).toBe(false);
  });

  it('bounds and validates live PROP broadcasts and 818 snapshots', () => {
    feed(':server PROP');
    feed(':server PROP #root __proto__ :poison');
    feed(':server PROP __proto__ safe :poison');
    expect(store.getState().channelProps.size).toBe(0);
    expect(store.getState().userProps.size).toBe(0);

    feed(`:server PROP #root large :${'x'.repeat(MAX_LIVE_PROP_VALUE_LENGTH)}😀tail`);
    feed(':server 818 me #root from-list :listed');
    expect(store.getState().channelProps.get('#root')?.['large'])
      .toBe('x'.repeat(MAX_LIVE_PROP_VALUE_LENGTH));
    expect(store.getState().channelProps.get('#root')?.['from-list']).toBe('listed');

    for (let index = 0; index < MAX_LIVE_PROP_KEYS + 8; index += 1) {
      feed(`:server PROP #root prop-${index} :bounded`);
    }
    expect(Object.keys(store.getState().channelProps.get('#root') ?? {}))
      .toHaveLength(MAX_LIVE_PROP_KEYS);

    feed(':server PROP #root large :');
    expect(store.getState().channelProps.get('#root')?.['large']).toBe('');
  });

  it('caps property targets and the derived activity record together', () => {
    for (let index = 0; index < MAX_LIVE_PROP_TARGETS + 8; index += 1) {
      feed(`:server PROP user-${index} STATUS :coding project-${index}`);
    }

    expect(store.getState().userProps.size).toBe(MAX_LIVE_PROP_TARGETS);
    expect(Object.keys(store.getState().userActivities)).toHaveLength(MAX_LIVE_PROP_TARGETS);
    expect(store.getState().userProps.has(`user-${MAX_LIVE_PROP_TARGETS}`)).toBe(false);
    expect(store.getState().userActivities[`user-${MAX_LIVE_PROP_TARGETS}`]).toBeUndefined();
  });

  it('caps authoritative NAMES rosters while still refreshing existing members', () => {
    _beginNamesBurstForTests('#root');
    const names = Array.from(
      { length: MAX_LIVE_CHANNEL_USERS + 32 },
      (_, index) => `user-${index}`,
    ).join(' ');
    feed(`:server 353 me = #root :${names}`);

    let users = store.getState().channels.get('#root')?.users;
    expect(users?.size).toBe(MAX_LIVE_CHANNEL_USERS);
    expect(users?.has(`user-${MAX_LIVE_CHANNEL_USERS}`)).toBe(false);

    feed(':server 353 me = #root :@user-0 overflow');
    users = store.getState().channels.get('#root')?.users;
    expect(users?.get('user-0')?.modes).toEqual(new Set(['o']));
    expect(users?.has('overflow')).toBe(false);
  });

  it('rejects roster overflow joins without producing phantom activity', () => {
    const users = new Map(Array.from(
      { length: MAX_LIVE_CHANNEL_USERS },
      (_, index) => [`user-${index}`, {
        nick: `user-${index}`,
        modes: new Set<string>(),
        away: false,
      }] as const,
    ));
    store.setState({
      channels: new Map([['#root', { ...channel('#root'), users }]]),
      channelEvents: {},
    });

    feed(':overflow!u@host JOIN #root');

    const root = store.getState().channels.get('#root');
    expect(root?.users.size).toBe(MAX_LIVE_CHANNEL_USERS);
    expect(root?.users.has('overflow')).toBe(false);
    expect(root?.messages).toEqual([]);
    expect(store.getState().channelEvents['#root']).toBeUndefined();
  });

  it('bounds server-driven self JOIN channel creation', () => {
    const channels = new Map(Array.from(
      { length: MAX_LIVE_CHANNELS },
      (_, index) => [`#room-${index}`, channel(`#room-${index}`)] as const,
    ));
    store.setState({ channels });

    feed(':me!u@host JOIN #overflow');

    expect(store.getState().channels.size).toBe(MAX_LIVE_CHANNELS);
    expect(store.getState().channels.has('#overflow')).toBe(false);
  });

  it('bounds channel event and welcome target collections', () => {
    for (let index = 0; index < MAX_LIVE_CHANNELS + 8; index += 1) {
      const room = `#room-${index}`;
      store.getState().addChannelEvent(room, {
        type: 'join',
        nick: 'alice',
        text: index === MAX_LIVE_CHANNELS + 7
          ? 'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH)
          : `alice joined ${room}`,
        time: new Date(),
      });
      store.getState().markWelcomeSeen(room);
    }

    const state = store.getState();
    expect(Object.keys(state.channelEvents)).toHaveLength(MAX_LIVE_CHANNELS);
    expect(state.channelEvents['#room-0']).toBeUndefined();
    expect(state.channelEvents[`#room-${MAX_LIVE_CHANNELS + 7}`]?.[0]?.text.length)
      .toBe(4 * 1024);
    expect(state.channelWelcomeSeen.size).toBe(MAX_LIVE_CHANNELS);
    expect(state.channelWelcomeSeen.has('#room-0')).toBe(false);
    expect(state.channelWelcomeSeen.has(`#room-${MAX_LIVE_CHANNELS + 7}`)).toBe(true);
  });

  it('bounds live roster system lines and their untrusted reasons', () => {
    const messages = Array.from({ length: MAX_LIVE_CHANNEL_MESSAGES }, (_, index) => ({
      id: `seed-${index}`,
      time: new Date(index),
      from: '',
      text: `seed ${index}`,
      type: 'system' as const,
      target: '#root',
    }));
    store.setState({ channels: new Map([['#root', { ...channel('#root'), messages }]]) });

    feed(':alice!u@host JOIN #root');
    feed(`:alice!u@host PART #root :${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH)}`);
    feed(':bob!u@host JOIN #root');
    feed(`:bob!u@host QUIT :${'y'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH)}`);
    feed(':carol!u@host JOIN #root');
    feed(`:mod!u@host KICK #root carol :${'z'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH)}`);

    const root = store.getState().channels.get('#root');
    expect(root?.messages).toHaveLength(MAX_LIVE_CHANNEL_MESSAGES);
    expect(root?.users.size).toBe(0);
    for (const message of root?.messages.slice(-6) ?? []) {
      expect(message.text.length).toBeLessThanOrEqual(4 * 1024 + 64);
    }
  });

  it('ignores malformed roster events without throwing or mutating state', () => {
    expect(() => {
      feed(':alice!u@host JOIN');
      feed(':alice!u@host PART');
      feed('QUIT :gone');
      feed(':mod!u@host KICK #root');
      feed(':alice!u@host NICK');
      feed(':server MODE');
      feed(':server 353 me = not-a-channel :alice');
    }).not.toThrow();

    expect(store.getState().channels.get('#root')).toEqual(channel('#root'));
  });
});
