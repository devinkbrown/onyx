// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.readMarker.test.ts
 *
 * A server read marker (IRCv3 draft/read-marker, relayed from a bouncer or a
 * sibling session) is folded back into unread/mention state by _applyReadMarker
 * via the MARKREAD handler. When the marker only PARTIALLY catches up — leaving
 * a nonzero unread tail — the per-channel mention badge (`channelMentions`) and
 * the global inbox count (`totalUnreadMentions`) must be re-derived from the
 * remaining unread messages, not left at their pre-marker value. Otherwise the
 * mention badge over-counts (and can exceed the unread count, which is
 * impossible).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { store } from './store';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

function msg(id: string, from: string, atMs: number, highlight: boolean): ChatMessage {
  return {
    id,
    time: new Date(atMs),
    from,
    text: highlight ? 'hey me look' : 'just chatter',
    type: 'msg',
    highlight,
    target: '#chan',
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState(initialState, true);
});

describe('_applyReadMarker — partial catch-up re-derives the mention count', () => {
  it('recomputes channelMentions/totalUnreadMentions when unread stays > 0', () => {
    const key = '#chan';
    // Five messages from bob: t1..t5. Highlights on t1, t3, t5 → 3 mentions.
    const t = [1000, 2000, 3000, 4000, 5000];
    const messages: ChatMessage[] = [
      msg('m1', 'bob', t[0]!, true),
      msg('m2', 'bob', t[1]!, false),
      msg('m3', 'bob', t[2]!, true),
      msg('m4', 'bob', t[3]!, false),
      msg('m5', 'bob', t[4]!, true),
    ];
    const channel: Channel = {
      name: '#chan',
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map(),
      unread: 5,
      highlights: 3,
      createdAt: null,
      messages,
    };
    const channels = new Map<string, Channel>([[key, channel]]);

    store.setState({
      ...initialState,
      ourNick: 'me',
      // NOT looking at this channel — otherwise unread is forced to 0.
      activeView: { kind: 'status' },
      connectionStatus: 'connected',
      channels,
      channelUnread: { [key]: 5 },
      channelMentions: { [key]: 3 },
      totalUnreadMentions: 3,
    } as never, true);

    // Marker sits between t3 (3000) and t4 (4000): only m4 + m5 remain unread,
    // of which only m5 is a highlight → the correct mention count is 1.
    feed(':me MARKREAD #chan timestamp=1970-01-01T00:00:03.500Z');

    const s = store.getState();
    expect(s.channelUnread[key]).toBe(2);
    // Before the fix this stayed 3 (stale) and could exceed the unread count.
    expect(s.channelMentions[key]).toBe(1);
    expect(s.totalUnreadMentions).toBe(1);
    expect(s.channels.get(key)!.highlights).toBe(1);

    // Immutability: the mention map is a fresh object, not mutated in place.
    expect(s.channelMentions).not.toBe(initialState.channelMentions);
  });

  it('still zeroes the mention count on a full catch-up', () => {
    const key = '#chan';
    const messages: ChatMessage[] = [
      msg('m1', 'bob', 1000, true),
      msg('m2', 'bob', 2000, true),
    ];
    const channel: Channel = {
      name: '#chan',
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map(),
      unread: 2,
      highlights: 2,
      createdAt: null,
      messages,
    };
    store.setState({
      ...initialState,
      ourNick: 'me',
      activeView: { kind: 'status' },
      connectionStatus: 'connected',
      channels: new Map<string, Channel>([[key, channel]]),
      channelUnread: { [key]: 2 },
      channelMentions: { [key]: 2 },
      totalUnreadMentions: 2,
    } as never, true);

    // Marker past the last message → nothing unread.
    feed(':me MARKREAD #chan timestamp=1970-01-01T00:00:09.000Z');

    const s = store.getState();
    expect(s.channelUnread[key]).toBe(0);
    expect(s.channelMentions[key]).toBe(0);
    expect(s.totalUnreadMentions).toBe(0);
    expect(s.channels.get(key)!.highlights).toBe(0);
  });
});
