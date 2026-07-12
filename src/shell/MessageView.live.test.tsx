// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageView.live.test.tsx — SC 4.1.3 Status Messages.
 *
 * The message feed is a role="log" aria-live region "for new chat activity".
 * A topic-filter switch swaps the whole trailing window (messages() becomes a
 * different filtered set) without changing activeTarget(); for small sets the
 * window start does not decrease, so the log must be muted on the topic change
 * itself — otherwise NVDA/VoiceOver read the swapped-in tail aloud as if it were
 * new activity (transcript-replay spam). We assert the SEMANTICS: aria-live on the
 * named log flips to 'off' on a topic switch and back to 'polite' after the
 * restore window.
 */

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { MessageView } from './MessageView';

const initialState = store.getInitialState();

function makeMessage(id: string, from: string, text: string, topic: string | null): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date('2026-07-12T12:00:00Z'),
    type: 'msg',
    target: '#general',
    ...(topic !== null ? { topic } : {}),
  };
}

function makeChannel(msgs: ChatMessage[]): Channel {
  const users = new Map<string, ChannelUser>([
    ['alice', { nick: 'alice', modes: new Set<string>() }],
    ['bob', { nick: 'bob', modes: new Set<string>() }],
  ]);
  return {
    name: '#general',
    topic: 'Welcome',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: msgs,
  };
}

function seedTwoTopicChannel(): void {
  const channel = makeChannel([
    makeMessage('m1', 'alice', 'Roadmap one', 'roadmap'),
    makeMessage('m2', 'bob', 'Roadmap two', 'roadmap'),
    makeMessage('m3', 'alice', 'Release one', 'release'),
    makeMessage('m4', 'bob', 'Release two', 'release'),
  ]);
  const channels = new Map<string, Channel>([['#general', channel]]);
  store.setState(
    {
      ...initialState,
      channels,
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      ourNick: 'testuser',
    },
    true,
  );
}

describe('MessageView live-log topic-switch suppression (SC 4.1.3)', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('mutes the message log when switching between two topic filters, then restores to polite', async () => {
    // Arrange — a channel filtered to one small topic.
    seedTwoTopicChannel();
    store.getState().setActiveChannelTopic('#general', 'roadmap');
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });

    // Opening the conversation suppresses briefly; wait for the initial restore
    // so we are asserting the topic switch specifically, not the mount.
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));

    // Act — switch to a different topic filter on the SAME channel. The tail rows
    // in the DOM are wholly replaced, but activeTarget() is unchanged.
    store.getState().setActiveChannelTopic('#general', 'release');

    // Assert — the log is muted across the row swap so it is not read aloud.
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'off'));

    // ... and restored to polite so genuinely new lines still announce.
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));
  });

  it('mutes the message log when clearing the topic filter (window start rises)', async () => {
    // Arrange — start filtered to a small topic.
    seedTwoTopicChannel();
    store.getState().setActiveChannelTopic('#general', 'roadmap');
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));

    // Act — clear the filter: the unfiltered set is larger, so the window start
    // does not decrease. The old start-decrease-only guard would miss this.
    store.getState().setActiveChannelTopic('#general', null);

    // Assert — still muted on the identity change, then restored.
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'off'));
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));
  });
});
