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

describe('MessageView channel intro ledger', () => {
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

  it('links an empty public channel intro to the room ledger', async () => {
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

    expect(screen.getByTestId('channel-intro-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(screen.getByRole('link', { name: 'Room ledger for #general' })).toHaveTextContent(
      'Room ledger',
    );
  });

  it('links a brand-new public channel empty state to the room ledger', async () => {
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

    expect(screen.getByTestId('feed-empty-invite')).toHaveTextContent('Invite friends');
    expect(screen.getByTestId('feed-empty-channel-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
  });

  it('omits the ledger link for direct-message views', async () => {
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
