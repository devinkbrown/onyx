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
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { DEFAULT_WINDOW_SIZE } from './messageWindow';
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

function makeSystemMessage(id: string, text: string): ChatMessage {
  return {
    id,
    from: '',
    text,
    time: new Date('2026-07-12T12:00:00Z'),
    type: 'system',
    target: '#general',
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
    resetPreferences();
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

  it('keeps system rows non-live while the parent log owns announcement state', async () => {
    // Arrange — opening a conversation temporarily mutes the parent log so the
    // loaded transcript is not announced as new activity.
    const channel = makeChannel([makeSystemMessage('system-join', 'alice joined')]);
    store.setState(
      {
        ...initialState,
        channels: new Map([['#general', channel]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      },
      true,
    );

    render(() => <MessageView />);

    // Assert — the row remains focusable and named transcript content, but the
    // containing log is the only live-region owner during and after restoration.
    const feed = screen.getByRole('log', { name: 'Message history' });
    const systemRow = screen.getByRole('article', { name: 'alice joined' });
    expect(feed).toHaveAttribute('aria-live', 'off');
    expect(systemRow).toHaveClass('shell-msg-system');
    expect(systemRow).toHaveAttribute('tabindex', '-1');
    expect(systemRow).not.toHaveAttribute('aria-live');
    expect(feed.querySelector('[role="status"]')).toBeNull();

    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));
    expect(systemRow).toHaveTextContent('alice joined');
    expect(feed.querySelector('[role="status"]')).toBeNull();
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

function seedLongChannel(count: number, unreadId?: string): void {
  const msgs = Array.from({ length: count }, (_, index) =>
    makeMessage(`m-${index}`, 'alice', `line ${index}`, null),
  );
  const channel = makeChannel(msgs);
  store.setState(
    {
      ...initialState,
      channels: new Map([['#general', channel]]),
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      ourNick: 'testuser',
      viewUnreadDividerId: unreadId
        ? new Map([['#general', unreadId]])
        : new Map(),
    },
    true,
  );
}

function renderedMessageCount(feed: HTMLElement): number {
  return feed.querySelectorAll('[data-message-search-id]').length;
}

describe('MessageView bounded historical navigation', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    resetPreferences();
  });

  it('mounts only the trailing page of a long transcript', () => {
    seedLongChannel(180);
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    expect(renderedMessageCount(feed)).toBe(DEFAULT_WINDOW_SIZE);
    expect(screen.getByText('line 179')).toBeInTheDocument();
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show earlier messages/ })).toBeInTheDocument();
  });

  it('keeps a deep unread divider in a bounded page instead of mounting the tail from there', () => {
    seedLongChannel(180, 'm-20');
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);
    expect(screen.getByText('line 20')).toBeInTheDocument();
    expect(feed.querySelector('.shell-unread-divider')).not.toBeNull();
    expect(screen.queryByText('line 179')).not.toBeInTheDocument();
  });

  it('focuses a time-travel landing inside a bounded page and keeps it after the landing id clears', async () => {
    seedLongChannel(180);
    render(() => <MessageView />);

    store.getState().focusMessage('m-40');

    const feed = screen.getByRole('log', { name: 'Message history' });
    await waitFor(() => {
      expect(screen.getByText('line 40')).toBeInTheDocument();
    });
    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);
    expect(screen.queryByText('line 179')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(store.getState().timeTravelLandingId).toBeNull();
    });
    expect(screen.getByText('line 40')).toBeInTheDocument();
    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);
  });

  it('Reader Start opens the first loaded page and focuses the first message', async () => {
    setPreference('readerMode', true);
    seedLongChannel(180);
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByText('line 0')).toBeInTheDocument();
    expect(screen.queryByText('line 179')).not.toBeInTheDocument();
    expect(renderedMessageCount(feed)).toBe(DEFAULT_WINDOW_SIZE);
    expect(feed).toHaveAttribute('aria-live', 'off');
    expect(document.activeElement).toBe(
      feed.querySelector('[data-message-search-id="m-0"]'),
    );
  });

  it('jump to latest restores the trailing page without mounting the whole transcript', async () => {
    setPreference('readerMode', true);
    seedLongChannel(180, 'm-20');
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('line 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Jump to latest/ }));

    expect(screen.getByText('line 179')).toBeInTheDocument();
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.queryByText('line 20')).not.toBeInTheDocument();
    expect(renderedMessageCount(feed)).toBe(DEFAULT_WINDOW_SIZE);
  });

  it('show earlier stays bounded and mutes the live region while older rows enter', async () => {
    seedLongChannel(180);
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));

    fireEvent.click(screen.getByRole('button', { name: /Show earlier messages/ }));

    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(180);
    expect(renderedMessageCount(feed)).toBeGreaterThan(DEFAULT_WINDOW_SIZE);
    expect(screen.getByText('line 179')).toBeInTheDocument();
    expect(feed).toHaveAttribute('aria-live', 'off');
  });

  it('Reader New hands off a near-tail unread that sits outside the Start page', async () => {
    setPreference('readerMode', true);
    seedLongChannel(1000, 'm-850');
    render(() => <MessageView />);

    const feed = screen.getByRole('log', { name: 'Message history' });
    await waitFor(() => expect(feed).toHaveAttribute('aria-live', 'polite'));

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('line 0')).toBeInTheDocument();
    expect(screen.queryByText('line 850')).not.toBeInTheDocument();
    expect(feed.querySelector('.shell-unread-divider')).toBeNull();
    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    await waitFor(() => {
      const divider = feed.querySelector('.shell-unread-divider');
      expect(divider).not.toBeNull();
      expect(document.activeElement).toBe(divider);
    });
    expect(screen.getByText('line 850')).toBeInTheDocument();
    expect(renderedMessageCount(feed)).toBeLessThanOrEqual(DEFAULT_WINDOW_SIZE);
    expect(feed).toHaveAttribute('aria-live', 'off');
    expect(store.getState().viewUnreadDividerId.get('#general')).toBe('m-850');

    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));

    expect(screen.getByText('line 999')).toBeInTheDocument();
    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.queryByText('line 850')).not.toBeInTheDocument();
    expect(feed.querySelector('.shell-unread-divider')).toBeNull();
    expect(renderedMessageCount(feed)).toBe(DEFAULT_WINDOW_SIZE);
  });
});
