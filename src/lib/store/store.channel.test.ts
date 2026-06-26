/**
 * store.channel.test.ts
 *
 * Channel management + member moderation actions. Each action sends a raw
 * server command through the IRC client; we mock the client to capture the
 * exact raw line. We also drive MODE / 324 numerics through _handleMessage to
 * assert the derived mode + role selectors that gate the UI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import {
  selectIsChannelOp,
  selectOwnPrefix,
  selectChannelModeState,
  parseChannelModeString,
} from './store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

/** Minimal IRCClient stand-in — assert on sendRaw, satisfy handler reads. */
function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    modeToPrefix: { Q: '!', q: '.', o: '@', v: '+' } as Record<string, string>,
    prefixToMode: { '!': 'Q', '.': 'q', '@': 'o', '+': 'v' } as Record<string, string>,
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
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState(initialState, true);
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
