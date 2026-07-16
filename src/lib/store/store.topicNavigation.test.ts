// SPDX-License-Identifier: AGPL-3.0-or-later
/** Store-level named-conversation navigation and follow destinations. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { follow, followed, unfollow } from '@/lib/notifications/followed';
import { TOPIC_PROP, TOPIC_TAG } from '@/lib/topics/topics';

import { _resetNamesBurstsForTests, store } from './store';

const initialState = store.getInitialState();

function message(id: string, topic: string | null): ChatMessage {
  return {
    id,
    time: new Date('2026-07-16T12:00:00Z'),
    from: 'alice',
    text: 'retained topic message',
    type: 'msg',
    target: '#General',
    topic,
  };
}

function channel(messages: ChatMessage[] = []): Channel {
  return {
    name: '#General',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 3,
    highlights: 1,
    createdAt: null,
    messages,
  };
}

function seed(messages: ChatMessage[] = []) {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set(['draft/read-marker']),
  };
  store.setState({
    ...initialState,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'me',
    channels: new Map([['#general', channel(messages)]]),
    activeView: { kind: 'home' },
    channelUnread: { '#general': 3 },
    channelMentions: { '#general': 1 },
    totalUnreadMentions: 1,
    firstUnreadId: new Map([['#general', 'first-hidden']]),
    viewUnreadDividerId: new Map([['#general', 'prior-divider']]),
    readMarkers: new Map([['#general', '2026-07-16T10:00:00.000Z']]),
  }, true);
  return client;
}

function feedTaggedMessage(id: string, topic: string): void {
  store.getState()._handleMessage(parseIRCMessage(
    `@${TOPIC_TAG}=${topic};msgid=${id} :alice!a@host PRIVMSG #General :quiet update`,
  ));
}

beforeEach(() => {
  store.setState(initialState, true);
  _resetNamesBurstsForTests();
  for (const key of followed()) unfollow(key);
  localStorage.clear();
});

describe('openChannelConversation', () => {
  it('opens a retained topic, consumes that slice, and does not advance MARKREAD', () => {
    const client = seed([message('topic-1', 'RoadMap')]);

    store.getState().openChannelConversation('#General', 'roadmap');

    const state = store.getState();
    expect(state.activeView).toEqual({ kind: 'channel', channel: '#general' });
    expect(state.activeChannelTopics.get('#general')).toBe('RoadMap');
    expect(state.channels.get('#general')).toMatchObject({ unread: 0, highlights: 0 });
    expect(state.channelUnread['#general']).toBe(0);
    expect(state.channelMentions['#general']).toBe(0);
    expect(state.totalUnreadMentions).toBe(0);
    expect(state.firstUnreadId.has('#general')).toBe(false);
    expect(state.viewUnreadDividerId.get('#general')).toBe('prior-divider');
    expect(state.readMarkers.get('#general')).toBe('2026-07-16T10:00:00.000Z');
    expect(client.sendRaw).toHaveBeenCalledWith('NAMES', '#General');
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(false);
  });

  it('accepts a registry topic but falls back to normal whole-room navigation for a stale label', () => {
    const client = seed();
    store.setState({
      channelProps: new Map([['#general', { [TOPIC_PROP]: 'Release Train,roadmap' }]]),
    });

    store.getState().openChannelConversation('#General', 'release train');
    expect(store.getState().activeChannelTopics.get('#general')).toBe('Release Train');
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(false);

    _resetNamesBurstsForTests();
    client.sendRaw.mockClear();
    store.getState().openChannelConversation('#General', 'retired topic');

    const state = store.getState();
    expect(state.activeView).toEqual({ kind: 'channel', channel: '#general' });
    expect(state.activeChannelTopics.has('#general')).toBe(false);
    expect(state.channels.get('#general')).toMatchObject({ unread: 0, highlights: 0 });
    expect(state.channelUnread['#general']).toBe(0);
    expect(state.channelMentions['#general']).toBe(0);
    expect(state.totalUnreadMentions).toBe(0);
    expect(state.firstUnreadId.has('#general')).toBe(false);
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(true);
  });
});

describe('follow notification destinations', () => {
  it('keeps a room-only follow pointed at the whole room for tagged messages', () => {
    seed();
    follow('#General');

    feedTaggedMessage('room-follow', 'roadmap');

    expect(store.getState().notifications.at(-1)).toMatchObject({
      type: 'follow',
      channel: '#General',
      topic: null,
      text: 'quiet update',
    });
  });

  it('uses the topic destination when room and topic follows both match', () => {
    seed();
    follow('#General');
    follow('#General', 'roadmap');

    feedTaggedMessage('topic-follow', 'RoadMap');

    expect(store.getState().notifications.at(-1)).toMatchObject({
      type: 'follow',
      channel: '#General',
      topic: 'RoadMap',
      text: 'quiet update',
    });
  });
});
