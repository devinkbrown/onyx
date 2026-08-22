// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store/store';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { MessageView } from './MessageView';
import { recordFirstHourHandoff, resetFirstHourForTests } from '@/lib/firstHour/firstHour';

const initialState = store.getInitialState();

function makeMessage(id: string, from: string, text: string): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date(2026, 6, 10, 9, 0),
    type: 'msg',
    target: '#general',
  };
}

function makeChannel(name: string, messages: ChatMessage[] = []): Channel {
  const users = new Map<string, ChannelUser>([
    ['alice', { nick: 'alice', modes: new Set<string>() }],
  ]);
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

describe('MessageView empty room and channel intro', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
    resetFirstHourForTests();
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    resetPreferences();
    resetFirstHourForTests();
  });

  it('keeps the beginning card to one Fraunces line and one sentence — no Room ledger', async () => {
    store.setState(
      {
        ...initialState,
        channels: new Map([
          ['#general', makeChannel('#general', [makeMessage('m1', 'alice', 'hello')])],
        ]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        historyExhausted: new Map([['#general', true]]),
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-intro')).toBeTruthy();
    });

    expect(screen.getByTestId('channel-intro').querySelector('.shell-channel-intro-title')?.textContent).toBe('#general');
    expect(screen.getByTestId('channel-intro').querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByTestId('channel-intro-ledger')).toBeNull();
    expect(screen.queryByRole('link', { name: /Room ledger/i })).toBeNull();
  });

  it('shows one empty-room lede plus one sentence and no Room ledger CTA', async () => {
    store.setState(
      {
        ...initialState,
        channels: new Map([['#general', makeChannel('#general')]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-empty')).toBeTruthy();
    });

    const empty = screen.getByTestId('feed-empty');
    expect(empty.querySelector('.shell-feed-empty-title')?.textContent).toBe('Still waters here');
    expect(empty.querySelector('.shell-feed-empty-body')?.textContent).toMatch(/Say the first thing in #general/);
    expect(screen.getByTestId('feed-empty-invite')).toHaveTextContent('Invite friends');
    expect(screen.queryByTestId('feed-empty-channel-ledger')).toBeNull();
    expect(screen.queryByRole('link', { name: /Room ledger/i })).toBeNull();
  });

  it('does not flash the empty room while history is loading', async () => {
    store.setState(
      {
        ...initialState,
        channels: new Map([['#general', makeChannel('#general')]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
        historyLoading: new Map([['#general', true]]),
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    });
    expect(screen.queryByTestId('feed-empty')).toBeNull();
    expect(screen.queryByText('Still waters here')).toBeNull();
  });

  it('omits the beginning card for direct-message views', async () => {
    store.setState(
      {
        ...initialState,
        dms: new Map<string, DMConversation>([
          ['bob', { nick: 'bob', account: null, unread: 0, highlights: 0, messages: [] }],
        ]),
        activeView: { kind: 'dm', nick: 'bob' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      expect(screen.queryByTestId('channel-intro')).toBeNull();
    });
    expect(screen.queryByTestId('channel-intro-ledger')).toBeNull();
    expect(screen.queryByRole('link', { name: /Room ledger/i })).toBeNull();
    expect(screen.getByTestId('feed-empty')).toHaveTextContent('A private conversation');
    expect(screen.getByTestId('feed-empty')).toHaveTextContent(
      'Only the two of you can read these messages. They stay on this device.',
    );
    expect(screen.getByTestId('feed-empty')).not.toHaveTextContent(/fully encrypted|cloud sync|TOFU|🔒/i);
  });

  it('asks a first-hour guest to say hi instead of showing slash commands', async () => {
    recordFirstHourHandoff({ landing: 'room', channel: '#general', guest: true });
    store.setState(
      {
        ...initialState,
        channels: new Map([['#general', makeChannel('#general')]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'river',
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-empty')).toBeTruthy();
    });
    expect(screen.getByText('Say hi')).toBeInTheDocument();
    expect(screen.queryByText('/search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-empty-channel-ledger')).not.toBeInTheDocument();
  });
});
