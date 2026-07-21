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
  MAX_AWAY_NICKS,
  MAX_LIVE_CHANNELS,
  MAX_LIVE_CHANNEL_MESSAGES,
  MAX_LIVE_CHANNEL_USERS,
  MAX_LIVE_DM_CONVERSATIONS,
  MAX_LIVE_PROP_KEYS,
  MAX_LIVE_PROP_TARGETS,
  MAX_LIVE_PROP_VALUE_LENGTH,
  MAX_ISUPPORT_TOKENS,
  MAX_ISUPPORT_VALUE_LENGTH,
  MAX_MOTD_TEXT_LENGTH,
  MAX_SERVER_AUX_TEXT_LENGTH,
  MAX_SERVER_RULE_LINES,
  MAX_OFFLINE_MEMO_CONVERSATIONS,
  MAX_OFFLINE_MEMO_COUNT,
  MAX_WHOIS_CACHE_ENTRIES,
  MAX_WHOIS_CHANNELS,
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
  it('retains only the active bounded WHOIS working set', () => {
    feed(':server 311 me unsolicited user host * :Unsolicited profile');
    expect(store.getState().whoisData.size).toBe(0);
    expect(store.getState().userProfiles.size).toBe(0);

    for (let index = 0; index < MAX_WHOIS_CACHE_ENTRIES + 8; index += 1) {
      store.getState().openWhois(`peer-${index}`);
    }
    expect(store.getState().whoisData.size).toBe(MAX_WHOIS_CACHE_ENTRIES);
    expect(store.getState().whoisData.has('peer-0')).toBe(false);

    store.getState().openWhois('active-peer');
    feed(`:server 311 me active-peer ${'u'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8)} host * :${'r'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8)}`);
    const channels = Array.from({ length: MAX_WHOIS_CHANNELS + 32 }, (_, index) => `#c-${index}`).join(' ');
    feed(`:server 319 me active-peer :${channels}`);
    feed(':server 317 me active-peer -5 not-a-number :seconds idle');

    const active = store.getState().whoisData.get('active-peer');
    expect(active?.username).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
    expect(active?.realname).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
    expect(active?.channels).toHaveLength(MAX_WHOIS_CHANNELS);
    expect(active?.idleSecs).toBe(0);
    expect(active?.signOnTs).toBe(0);

    store.getState().openWhois('replacement');
    feed(':server 330 me active-peer old-account :is logged in as');
    expect(store.getState().whoisData.get('active-peer')?.account).toBeUndefined();
    expect(store.getState().userProfiles.get('active-peer')?.account).toBeUndefined();
  });

  it('bounds requested MOTD, rules, service notices, and server-log text', () => {
    feed(':server 372 me :unsolicited MOTD');
    feed(':server 376 me :end');
    expect(store.getState().motd).toBeNull();

    feed(':server 375 me :- server MOTD -');
    for (let index = 0; index < 24; index += 1) {
      feed(`:server 372 me :${'m'.repeat(MAX_SERVER_AUX_TEXT_LENGTH)}😀tail`);
    }
    feed(':server 376 me :end');
    expect(store.getState().motd?.length).toBeLessThanOrEqual(MAX_MOTD_TEXT_LENGTH);
    expect(store.getState().motd?.endsWith('\ud83d')).toBe(false);

    for (let index = 0; index < MAX_SERVER_RULE_LINES + 8; index += 1) {
      feed(`:server 308 me :${index}-${'r'.repeat(MAX_SERVER_AUX_TEXT_LENGTH)}😀tail`);
    }
    expect(store.getState().serverRules).toHaveLength(MAX_SERVER_RULE_LINES);
    expect(store.getState().serverRules.every((line) => line.length <= MAX_SERVER_AUX_TEXT_LENGTH))
      .toBe(true);

    store.getState().addServiceNotice('s'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8), 't'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8));
    store.getState().addServerLog('l'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8), 'f'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8));
    expect(store.getState().serviceNotices.at(-1)?.source).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
    expect(store.getState().serviceNotices.at(-1)?.text).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
    expect(store.getState().serverLog.at(-1)?.from).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
    expect(store.getState().serverLog.at(-1)?.text).toHaveLength(MAX_SERVER_AUX_TEXT_LENGTH);
  });

  it('accepts WHO away state only for bounded members in a joined roster', () => {
    const root = channel('#root');
    root.users.set('alice', {
      nick: 'Alice',
      modes: new Set(),
      away: false,
    });
    store.setState({ channels: new Map([['#root', root]]) });

    feed(':server 352 me #other user host server Mallory G :0 away');
    feed(':server 352 me #root user host server Mallory G :0 away');
    feed(`:server 352 me #root user host server ${'x'.repeat(MAX_VAULT_SENDER_LENGTH + 1)} G :0 away`);
    expect(store.getState().awayNicks).toEqual(new Set());

    feed(':server 352 me #root user host server Alice G :0 away');
    expect(store.getState().awayNicks).toEqual(new Set(['alice']));
    expect(store.getState().channels.get('#root')?.users.get('alice')?.away).toBe(true);

    feed(':server 352 me #root user host server Alice H :0 present');
    expect(store.getState().awayNicks).toEqual(new Set());
    expect(store.getState().channels.get('#root')?.users.get('alice')?.away).toBe(false);
  });

  it('bounds and sanitizes the accumulated ISUPPORT feature registry', () => {
    feed(':server 005 me __proto__=poison lowercase=bad 9BAD=nope :supported');
    expect(store.getState().serverFeatures.size).toBe(0);
    expect(Object.keys(store.getState().isupportTokens)).toEqual([]);

    const tokens = Array.from(
      { length: MAX_ISUPPORT_TOKENS + 12 },
      (_, index) => `FEATURE${index}=value-${index}`,
    ).join(' ');
    feed(`:server 005 me ${tokens} :supported`);
    expect(store.getState().serverFeatures.size).toBe(MAX_ISUPPORT_TOKENS);
    expect(Object.keys(store.getState().isupportTokens)).toHaveLength(MAX_ISUPPORT_TOKENS);
    expect(store.getState().serverFeatures.has(`FEATURE${MAX_ISUPPORT_TOKENS}`)).toBe(false);

    feed(`:server 005 me FEATURE0=updated OVERSIZED=${'x'.repeat(MAX_ISUPPORT_VALUE_LENGTH + 1)} OVERFLOW=new :supported`);
    expect(store.getState().serverFeatures.size).toBe(MAX_ISUPPORT_TOKENS);
    expect(store.getState().serverFeatures.get('FEATURE0')).toBe('updated');
    expect(store.getState().serverFeatures.has('OVERSIZED')).toBe(false);
    expect(store.getState().serverFeatures.has('OVERFLOW')).toBe(false);
    expect(Object.hasOwn(store.getState().isupportTokens, '__proto__')).toBe(false);
  });

  it('retains the last valid channel limits after malformed ISUPPORT updates', () => {
    feed(':server 005 me CHANLIMIT=#&:25,!:10 :supported');
    expect(store.getState().chanLimits).toEqual({ '#': 25, '&': 25, '!': 10 });

    feed(':server 005 me CHANLIMIT=#:25junk :supported');
    expect(store.getState().chanLimits).toEqual({ '#': 25, '&': 25, '!': 10 });
  });

  it('repairs legacy away memory and refuses growth beyond one roster ceiling', () => {
    store.setState({
      awayNicks: new Set(Array.from(
        { length: MAX_AWAY_NICKS + 8 },
        (_, index) => `legacy-${index}`,
      )),
    });

    store.getState().setNickAway('new-peer', true);

    expect(store.getState().awayNicks.size).toBe(MAX_AWAY_NICKS);
    expect(store.getState().awayNicks.has('new-peer')).toBe(false);
    store.getState().setNickAway('legacy-0', false);
    expect(store.getState().awayNicks.size).toBe(MAX_AWAY_NICKS - 1);
  });

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

  it('applies vault field bounds to offline memo delivery', () => {
    feed(`@msgid=${'m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :eshmaki.me NOTE MEMO :from alice :${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH + 8)}`);

    const stored = store.getState().dms.get('alice')?.messages[0];
    expect(stored?.text).toHaveLength(MAX_VAULT_MESSAGE_TEXT_LENGTH);
    expect(stored?.id).toBeTruthy();
    expect(stored?.id.length).toBeLessThanOrEqual(MAX_VAULT_MESSAGE_ID_LENGTH);
    expect(store.getState().offlineMemo.get('alice')).toEqual({ count: 1, firstMsgId: stored?.id });

    feed(`:eshmaki.me NOTE MEMO :from ${'a'.repeat(MAX_VAULT_SENDER_LENGTH + 1)} :rejected`);
    expect(store.getState().dms.size).toBe(1);
    expect(store.getState().offlineMemo.size).toBe(1);
  });

  it('caps offline aggregates and repairs an oversized legacy aggregate map', () => {
    feed(':eshmaki.me NOTE MEMO :from alice :first');
    store.setState({
      offlineMemo: new Map([
        ...Array.from(
          { length: MAX_OFFLINE_MEMO_CONVERSATIONS + 8 },
          (_, index) => [`legacy-${index}`, { count: 1, firstMsgId: `old-${index}` }] as const,
        ),
        ['alice', { count: MAX_OFFLINE_MEMO_COUNT, firstMsgId: 'first' }],
      ]),
    });

    feed(':eshmaki.me NOTE MEMO :from alice :again');
    expect(store.getState().offlineMemo.size).toBe(MAX_OFFLINE_MEMO_CONVERSATIONS);
    expect(store.getState().offlineMemo.get('alice')?.count).toBe(MAX_OFFLINE_MEMO_COUNT);
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
