// SPDX-License-Identifier: AGPL-3.0-or-later
/** Evidence-gated resolution for ?join=#room&topic=... deep links. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { readTopicReadMarker } from '@/lib/topics/topicReadLedger';
import { TOPIC_PROP, TOPIC_TAG } from '@/lib/topics/topics';

import { _resetPendingDeepLinkTopicResolutionForTests, store } from './store';

const ROOM = '#general';
const initialState = store.getInitialState();

function channel(unread = 0): Channel {
  return {
    name: '#General',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seed(options: {
  caps?: readonly string[];
  ircx?: boolean;
  unread?: number;
} = {}) {
  const client = {
    negotiatedCaps: new Set(options.caps ?? []),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    sendRaw: vi.fn(),
    send: vi.fn(),
  };
  store.setState({
    ...initialState,
    client: client as never,
    connectionStatus: 'connected',
    status: 'connected',
    isIRCX: options.ircx ?? false,
    ourNick: 'me',
    channels: new Map([[ROOM, channel(options.unread)]]),
    activeView: { kind: 'channel', channel: ROOM },
    channelUnread: { [ROOM]: options.unread ?? 0 },
    firstUnreadId: new Map(options.unread ? [[ROOM, 'history-topic']] : []),
  }, true);
  store.getState().setPendingDeepLinkJoin('#General', null, 'roadmap');
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetPendingDeepLinkTopicResolutionForTests();
  store.setState(initialState, true);
  localStorage.clear();
});

afterEach(() => {
  _resetPendingDeepLinkTopicResolutionForTests();
  vi.useRealTimers();
});

describe('pending deep-link topics', () => {
  it('joins after registration without applying the requested label as a raw filter', () => {
    const client = seed({ caps: ['draft/chathistory'], ircx: true });

    feed(':server 001 me :Welcome');
    vi.advanceTimersByTime(1_600);

    expect(client.sendRaw).toHaveBeenCalledWith('JOIN', '#General');
    expect(store.getState().pendingDeepLinkTopic).toBe('roadmap');
    expect(store.getState().activeChannelTopics.has(ROOM)).toBe(false);
  });

  it('resolves a canonical label from the IRCX topic registry without a phantom interim filter', () => {
    const client = seed({ ircx: true });

    expect(store.getState().activeChannelTopics.has(ROOM)).toBe(false);
    feed(`:server 818 me #General ${TOPIC_PROP} :RoadMap,Release Train`);

    const state = store.getState();
    expect(state.pendingDeepLinkTopic).toBeNull();
    expect(state.activeView).toEqual({ kind: 'channel', channel: ROOM });
    expect(state.activeChannelTopics.get(ROOM)).toBe('RoadMap');
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(false);
  });

  it('opens replay-proven topics and records the visible topic read without a server marker', () => {
    const client = seed({ caps: ['draft/chathistory'], unread: 1 });

    feed('BATCH +history chathistory #General');
    feed(`@batch=history;msgid=history-topic;time=2026-07-16T12:00:00.000Z;${TOPIC_TAG}=RoadMap :alice!a@host PRIVMSG #General :retained update`);
    feed('BATCH -history');

    const state = store.getState();
    expect(state.pendingDeepLinkTopic).toBeNull();
    expect(state.activeChannelTopics.get(ROOM)).toBe('RoadMap');
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 0, highlights: 0 });
    expect(state.channelUnread[ROOM]).toBe(0);
    expect(state.firstUnreadId.has(ROOM)).toBe(false);
    expect(readTopicReadMarker(ROOM, 'roadmap')).toMatchObject({
      lastReadMessageId: 'history-topic',
    });
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(false);
  });

  it('waits for registry and history completion before a stale label falls back to the whole room', () => {
    const client = seed({
      caps: ['draft/chathistory', 'draft/read-marker'],
      ircx: true,
      unread: 1,
    });

    feed(':server 819 me #General :End of properties');
    expect(store.getState().pendingDeepLinkTopic).toBe('roadmap');
    expect(store.getState().activeChannelTopics.has(ROOM)).toBe(false);

    feed('BATCH +empty chathistory #General');
    feed('BATCH -empty');

    const state = store.getState();
    expect(state.pendingDeepLinkTopic).toBeNull();
    expect(state.activeView).toEqual({ kind: 'channel', channel: ROOM });
    expect(state.activeChannelTopics.has(ROOM)).toBe(false);
    expect(client.sendRaw.mock.calls.some(([command]) => command === 'MARKREAD')).toBe(true);
  });

  it('bounds missing server evidence and still fails safely to the whole room', () => {
    seed({ caps: ['draft/chathistory'], ircx: true });
    feed(':me!u@host JOIN #General');

    expect(store.getState().pendingDeepLinkTopic).toBe('roadmap');
    vi.advanceTimersByTime(8_000);

    const state = store.getState();
    expect(state.pendingDeepLinkTopic).toBeNull();
    expect(state.activeChannelTopics.has(ROOM)).toBe(false);
    expect(state.activeView.kind).toBe('channel');
  });
});
