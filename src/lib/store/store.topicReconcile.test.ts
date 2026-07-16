// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { markTopicRead, readTopicReadLedger } from '@/lib/topics/topicReadLedger';
import { TOPIC_TAG } from '@/lib/topics/topics';

import { _resetNamesBurstsForTests, store, type Server } from './store';

const initialState = store.getInitialState();
const ROOM = '#room';
const BASELINE = '2026-07-16T10:00:00.000Z';
const MEMORY_OWNER = { serverUrl: 'wss://topics.test', identity: 'me' } as const;
const memoryServer: Server = {
  id: 'topic-reconcile',
  name: 'Topics',
  network: 'Topics',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
  connected: true,
};

function row(
  id: string,
  at: string,
  topic: string | null,
  options: { from?: string; highlight?: boolean; type?: ChatMessage['type'] } = {},
): ChatMessage {
  return {
    id,
    time: new Date(at),
    from: options.from ?? 'alice',
    text: options.highlight ? 'hello me' : `row ${id}`,
    type: options.type ?? 'msg',
    target: ROOM,
    topic,
    highlight: options.highlight ?? false,
  };
}

function room(messages: ChatMessage[]): Channel {
  return {
    name: ROOM,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: messages.length,
    highlights: messages.filter((message) => message.highlight).length,
    createdAt: null,
    messages,
  };
}

function seed(messages: ChatMessage[]) {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    destroy: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set(['draft/read-marker']),
  };
  store.setState({
    ...initialState,
    server: memoryServer,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'me',
    channels: new Map([[ROOM, room(messages)]]),
    activeView: { kind: 'home' },
    channelUnread: { [ROOM]: messages.length },
    channelMentions: { [ROOM]: messages.filter((message) => message.highlight).length },
    totalUnreadMentions: messages.filter((message) => message.highlight).length,
    firstUnreadId: new Map(messages[0] ? [[ROOM, messages[0].id]] : []),
    readMarkers: new Map([[ROOM, BASELINE]]),
  }, true);
  return client;
}

function feed(id: string, at: string, text: string, topic?: string): void {
  const tags = [
    `msgid=${id}`,
    `time=${at}`,
    ...(topic ? [`${TOPIC_TAG}=${topic}`] : []),
  ].join(';');
  store.getState()._handleMessage(
    parseIRCMessage(`@${tags} :alice!a@host PRIVMSG ${ROOM} :${text}`),
  );
}

beforeEach(() => {
  store.setState(initialState, true);
  _resetNamesBurstsForTests();
  localStorage.clear();
});

describe('device-local named-conversation read reconciliation', () => {
  it('consumes only the opened topic across interleaved topic, untagged, mention, self, and system rows', () => {
    const client = seed([
      row('road-1', '2026-07-16T11:00:00.000Z', 'RoadMap'),
      row('release-1', '2026-07-16T12:00:00.000Z', 'Release'),
      row('untagged-mention', '2026-07-16T13:00:00.000Z', null, { highlight: true }),
      row('self-road', '2026-07-16T14:00:00.000Z', 'RoadMap', { from: 'me' }),
      row('system-release', '2026-07-16T15:00:00.000Z', 'Release', { type: 'system' }),
    ]);

    store.getState().openChannelConversation(ROOM, 'roadmap');

    const state = store.getState();
    expect(state.activeChannelTopics.get(ROOM)).toBe('RoadMap');
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 2, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(2);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.totalUnreadMentions).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('release-1');
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(false);
    expect(readTopicReadLedger(MEMORY_OWNER)).toContainEqual(expect.objectContaining({
      channel: ROOM,
      topic: 'roadmap',
      lastReadMessageId: 'road-1',
    }));
  });

  it('advances the visible topic on live delivery without consuming hidden siblings', () => {
    seed([
      row('road-1', '2026-07-16T11:00:00.000Z', 'RoadMap'),
      row('release-1', '2026-07-16T12:00:00.000Z', 'Release'),
    ]);
    store.getState().openChannelConversation(ROOM, 'roadmap');

    feed('road-live', '2026-07-16T13:00:00.000Z', 'visible update', 'ROADMAP');
    expect(store.getState().channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 0 });
    expect(store.getState().firstUnreadId.get(ROOM)).toBe('release-1');
    expect(readTopicReadLedger(MEMORY_OWNER)).toContainEqual(expect.objectContaining({
      topic: 'roadmap',
      lastReadMessageId: 'road-live',
    }));

    feed('release-mention', '2026-07-16T14:00:00.000Z', 'hello me', 'Release');
    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 2, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(2);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('release-1');
  });

  it('folds an incoming room marker into an active topic without zeroing newer hidden rows', () => {
    seed([
      row('release-old', '2026-07-16T11:00:00.000Z', 'Release'),
      row('road-visible', '2026-07-16T12:00:00.000Z', 'RoadMap'),
      row('untagged-new', '2026-07-16T13:00:00.000Z', null),
      row('release-new', '2026-07-16T14:00:00.000Z', 'Release', { highlight: true }),
    ]);
    store.getState().openChannelConversation(ROOM, 'roadmap');

    store.getState()._handleMessage(parseIRCMessage(
      ':me MARKREAD #room timestamp=2026-07-16T12:30:00.000Z',
    ));

    const state = store.getState();
    expect(state.readMarkers.get(ROOM)).toBe('2026-07-16T12:30:00.000Z');
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 2, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(2);
    expect(state.channelMentions[ROOM]).toBe(1);
    expect(state.totalUnreadMentions).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('untagged-new');
  });

  it('honors a newer device-topic cursor when an inactive room marker is replayed', () => {
    const messages = [
      row('road-old', '2026-07-16T11:00:00.000Z', 'RoadMap'),
      row('release-1', '2026-07-16T12:00:00.000Z', 'Release'),
      row('road-read', '2026-07-16T13:00:00.000Z', 'RoadMap'),
      row('release-2', '2026-07-16T14:00:00.000Z', 'Release', { highlight: true }),
    ];
    seed(messages);
    markTopicRead(ROOM, 'roadmap', messages[2]!, MEMORY_OWNER);

    store.getState()._handleMessage(parseIRCMessage(
      ':me MARKREAD #room timestamp=2026-07-16T10:30:00.000Z',
    ));

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 2, highlights: 1 });
    expect(state.channelUnread[ROOM]).toBe(2);
    expect(state.firstUnreadId.get(ROOM)).toBe('release-1');
  });

  it('keeps an exact live first-unread boundary ahead of a skewed stored timestamp', () => {
    seed([row('road-1', '2026-07-16T11:00:00.000Z', 'RoadMap')]);
    store.getState().openChannelConversation(ROOM, 'roadmap');

    // The line arrived now but carries a server clock behind our previous
    // local MARKREAD timestamp. Its exact delivery id remains authoritative.
    feed('skewed-hidden', '2026-07-16T09:59:59.000Z', 'hidden despite skew', 'Release');
    store.getState().reconcileChannelTopicUnread(ROOM);

    const state = store.getState();
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.firstUnreadId.get(ROOM)).toBe('skewed-hidden');
  });

  it('treats raw channel navigation as All, marks loaded topics, and advances room MARKREAD', () => {
    const client = seed([
      row('road-1', '2026-07-16T11:00:00.000Z', 'RoadMap'),
      row('release-1', '2026-07-16T12:00:00.000Z', 'Release'),
      row('untagged-1', '2026-07-16T13:00:00.000Z', null),
    ]);
    store.getState().openChannelConversation(ROOM, 'roadmap');
    client.sendRaw.mockClear();

    store.getState().navigate({ kind: 'channel', channel: ROOM });

    const state = store.getState();
    expect(state.activeChannelTopics.has(ROOM)).toBe(false);
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 0, highlights: 0 });
    expect(state.channelUnread[ROOM]).toBe(0);
    expect(state.channelMentions[ROOM]).toBe(0);
    expect(state.firstUnreadId.has(ROOM)).toBe(false);
    expect(readTopicReadLedger(MEMORY_OWNER)).toEqual(expect.arrayContaining([
      expect.objectContaining({ topic: 'roadmap', lastReadMessageId: 'road-1' }),
      expect.objectContaining({ topic: 'release', lastReadMessageId: 'release-1' }),
    ]));
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(true);
  });

  it('clears stale topic selections on self-PART and disconnect', () => {
    seed([row('road-1', '2026-07-16T11:00:00.000Z', 'RoadMap')]);
    store.getState().openChannelConversation(ROOM, 'roadmap');

    store.getState()._handleMessage(parseIRCMessage(':me!u@h PART #room :leaving'));
    expect(store.getState().activeChannelTopics.has(ROOM)).toBe(false);

    seed([row('road-2', '2026-07-16T12:00:00.000Z', 'RoadMap')]);
    store.getState().openChannelConversation(ROOM, 'roadmap');
    store.getState().disconnect();
    expect(store.getState().activeChannelTopics.size).toBe(0);
  });
});
