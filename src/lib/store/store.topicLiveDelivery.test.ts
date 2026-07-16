// SPDX-License-Identifier: AGPL-3.0-or-later
/** Live named-conversation unread/highlight consistency regressions. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { readTopicReadMarker } from '@/lib/topics/topicReadLedger';
import { TOPIC_TAG } from '@/lib/topics/topics';

import { store } from './store';

const ROOM = '#room';
const initialState = store.getInitialState();

function channel(): Channel {
  return {
    name: ROOM,
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

function seed(options: {
  notify?: 'all' | 'mentions' | 'none';
  highlightWords?: string[];
} = {}): void {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set(['echo-message']),
  };
  store.setState({
    ...initialState,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'me',
    channels: new Map([[ROOM, channel()]]),
    activeView: { kind: 'channel', channel: ROOM },
    activeChannelTopics: new Map([[ROOM, 'RoadMap']]),
    channelNotify: new Map([[ROOM, options.notify ?? 'all']]),
    highlightWords: options.highlightWords ?? [],
  }, true);
}

function feed(options: {
  id: string;
  at: string;
  text: string;
  topic: string;
  from?: string;
}): void {
  const from = options.from ?? 'alice';
  store.getState()._handleMessage(parseIRCMessage(
    `@msgid=${options.id};time=${options.at};${TOPIC_TAG}=${options.topic} :${from}!u@host PRIVMSG ${ROOM} :${options.text}`,
  ));
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

describe('live topic delivery consistency', () => {
  it('preserves a hidden sibling highlight across visible self and notify-suppressed rows', () => {
    seed();
    feed({
      id: 'hidden-release',
      at: '2026-07-16T11:00:00.000Z',
      text: 'hello me',
      topic: 'Release',
    });

    feed({
      id: 'visible-self',
      at: '2026-07-16T12:00:00.000Z',
      text: 'self update',
      topic: 'RoadMap',
      from: 'me',
    });
    store.setState({ channelNotify: new Map([[ROOM, 'none']]) });
    feed({
      id: 'visible-suppressed',
      at: '2026-07-16T13:00:00.000Z',
      text: 'muted update',
      topic: 'RoadMap',
    });

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.channels.get(ROOM)?.messages.map((message) => message.id)).toEqual([
      'hidden-release',
      'visible-self',
      'visible-suppressed',
    ]);
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.totalUnreadMentions).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('hidden-release');
  });

  it('uses custom highlight words for mentions-only live unread, counters, and notifications', () => {
    seed({ notify: 'mentions', highlightWords: ['urgent'] });

    feed({
      id: 'custom-highlight',
      at: '2026-07-16T11:00:00.000Z',
      text: 'URGENT deployment status',
      topic: 'Release',
    });

    let state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.notifications.at(-1)).toMatchObject({
      type: 'mention',
      text: 'URGENT deployment status',
      from: 'alice',
      channel: ROOM,
    });

    store.getState().reconcileChannelTopicUnread(ROOM);
    state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.channelMentions[ROOM]).toBe(1);
  });

  it('advances a visible topic cursor without consuming a hidden sibling highlight', () => {
    seed();
    feed({
      id: 'hidden-release',
      at: '2026-07-16T11:00:00.000Z',
      text: 'hello me',
      topic: 'Release',
    });
    feed({
      id: 'visible-roadmap',
      at: '2026-07-16T12:00:00.000Z',
      text: 'hello me',
      topic: 'ROADMAP',
    });

    const state = store.getState();
    expect(readTopicReadMarker(ROOM, 'roadmap')).toMatchObject({
      lastReadMessageId: 'visible-roadmap',
    });
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.totalUnreadMentions).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('hidden-release');
  });
});
