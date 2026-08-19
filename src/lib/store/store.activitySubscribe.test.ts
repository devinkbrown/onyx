// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { store } from './store';
import { _resetNamesBurstsForTests } from './store';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn((..._args: string[]) => true),
    send: vi.fn((_line: string) => true),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    modeToPrefix: { o: '@', v: '+' } as Record<string, string>,
    prefixToMode: { '@': 'o', '+': 'v' } as Record<string, string>,
  };
}

function makeUser(nick: string): ChannelUser {
  return { nick, modes: new Set() };
}

function makeChannel(name: string, users: ChannelUser[], messages: ChatMessage[] = []): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const user of users) usersMap.set(user.nick.toLowerCase(), user);
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

function seed(channelName = '#room', ourNick = 'me') {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set(channelName.toLowerCase(), makeChannel(channelName, [makeUser(ourNick)]));
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
  _resetNamesBurstsForTests();
});

describe('ACTIVITY SUBSCRIBE wiring', () => {
  it('subscribes after a self JOIN and unsubscribes after a self PART', () => {
    const client = seed('#room');
    feed(':me!u@h JOIN #ops');
    expect(client.sendRaw).toHaveBeenCalledWith('ACTIVITY', 'SUBSCRIBE', '#ops');

    feed(':me!u@h PART #ops :bye');
    expect(client.sendRaw).toHaveBeenCalledWith('ACTIVITY', 'UNSUBSCRIBE', '#ops');
  });

  it('applies inbound ACTIVITY typing and ignores our own echo', () => {
    seed('#room');
    feed(':alice!a@h ACTIVITY #room typing active');
    expect(store.getState().typingUsers.get('#room')?.has('alice')).toBe(true);

    feed(':me!u@h ACTIVITY #room typing active');
    expect(store.getState().typingUsers.get('#room')?.has('me')).toBeFalsy();

    feed(':alice!a@h ACTIVITY #room typing done');
    expect(store.getState().typingUsers.get('#room')?.has('alice')).toBeFalsy();
  });

  it('applies inbound ACTIVITY react/unreact onto the matching message', () => {
    const client = seed('#room');
    const channels = new Map(store.getState().channels);
    channels.set('#room', makeChannel('#room', [makeUser('me')], [{
      id: 'mid.1',
      from: 'me',
      text: 'hello',
      time: new Date('2026-08-19T00:00:00Z'),
      type: 'msg',
      target: '#room',
    }]));
    store.setState({ client: client as never, channels });

    feed(':bob!b@h ACTIVITY #room react mid.1 :👍');
    expect(store.getState().channels.get('#room')?.messages[0]?.reactions).toEqual([
      { emoji: '👍', users: ['bob'] },
    ]);

    feed(':bob!b@h ACTIVITY #room unreact mid.1 :👍');
    expect(store.getState().channels.get('#room')?.messages[0]?.reactions).toEqual([]);
  });
});
