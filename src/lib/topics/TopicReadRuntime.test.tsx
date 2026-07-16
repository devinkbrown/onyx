// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';

import { TopicReadRuntime, changedTopicReadChannels } from './TopicReadRuntime';
import { TOPIC_READ_LEDGER_KEY, type TopicReadMarker } from './topicReadLedger';

const initialState = store.getInitialState();

function message(
  id: string,
  target: string,
  topic: string | null,
  at: number,
  highlight = false,
): ChatMessage {
  return {
    id,
    target,
    topic,
    time: new Date(at),
    from: 'alice',
    text: highlight ? 'hello me' : id,
    type: 'msg',
    highlight,
  };
}

function channel(name: string, messages: ChatMessage[], highlights: number): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: messages.length,
    highlights,
    createdAt: null,
    messages,
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  store.setState(initialState, true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  store.setState(initialState, true);
});

describe('changedTopicReadChannels', () => {
  it('deduplicates changed topics by room and ignores reordered identical markers', () => {
    const alpha: TopicReadMarker = {
      channel: '#alpha', topic: 'roadmap', lastReadMessageId: 'a1', lastReadAt: 10,
    };
    const beta: TopicReadMarker = {
      channel: '#beta', topic: 'release', lastReadMessageId: 'b1', lastReadAt: 20,
    };

    expect([...changedTopicReadChannels([alpha, beta], [beta, alpha])]).toEqual([]);
    expect([...changedTopicReadChannels([alpha], [
      { ...alpha, lastReadMessageId: 'a2', lastReadAt: 30 },
      { channel: '#alpha', topic: 'release', lastReadMessageId: 'a3', lastReadAt: 31 },
    ])]).toEqual(['#alpha']);
  });
});

describe('TopicReadRuntime cross-tab reconciliation', () => {
  it('updates an inactive affected room without reconciling unaffected loaded rooms', () => {
    const alphaMessages = [
      message('alpha-road', '#alpha', 'RoadMap', 1_000),
      message('alpha-untagged', '#alpha', null, 2_000, true),
    ];
    const betaMessages = [message('beta-release', '#beta', 'Release', 1_500)];
    const reconcile = store.getState().reconcileChannelTopicUnread;
    const reconcileSpy = vi.fn((target: string) => reconcile(target));

    store.setState({
      ...initialState,
      ourNick: 'me',
      activeView: { kind: 'home' },
      channels: new Map([
        ['#alpha', channel('#alpha', alphaMessages, 1)],
        ['#beta', channel('#beta', betaMessages, 0)],
      ]),
      channelUnread: { '#alpha': 2, '#beta': 1 },
      channelMentions: { '#alpha': 1, '#beta': 0 },
      totalUnreadMentions: 1,
      firstUnreadId: new Map([
        ['#alpha', 'alpha-road'],
        ['#beta', 'beta-release'],
      ]),
      readMarkers: new Map([
        ['#alpha', new Date(0).toISOString()],
        ['#beta', new Date(0).toISOString()],
      ]),
      reconcileChannelTopicUnread: reconcileSpy,
    }, true);
    const { unmount } = render(() => <TopicReadRuntime />);

    const nextLedger: TopicReadMarker[] = [{
      channel: '#alpha',
      topic: 'roadmap',
      lastReadMessageId: 'alpha-road',
      lastReadAt: 1_000,
    }];
    const serialized = JSON.stringify(nextLedger);
    // A real storage event fires after the other tab has committed this value.
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, serialized);
    window.dispatchEvent(new StorageEvent('storage', {
      key: TOPIC_READ_LEDGER_KEY,
      newValue: serialized,
    }));

    const state = store.getState();
    expect(state.activeView).toEqual({ kind: 'home' });
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledWith('#alpha');
    expect(reconcileSpy).not.toHaveBeenCalledWith('#beta');
    expect(state.channels.get('#alpha')).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.channelUnread['#alpha']).toBe(1);
    expect(state.channelMentions['#alpha']).toBe(1);
    expect(state.firstUnreadId.get('#alpha')).toBe('alpha-untagged');
    expect(state.channels.get('#beta')).toMatchObject({ unread: 1, highlights: 0 });
    expect(state.channelUnread['#beta']).toBe(1);

    unmount();
  });
});
