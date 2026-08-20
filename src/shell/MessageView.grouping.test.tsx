// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { MessageView } from './MessageView';

const initialState = store.getInitialState();

function makeMessage(id: string, from: string, text: string, minute: number): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date(2026, 6, 10, 9, minute),
    type: 'msg',
    target: '#general',
  };
}

function makeChannel(messages: ChatMessage[]): Channel {
  const users = new Map<string, ChannelUser>([
    ['alice', { nick: 'alice', modes: new Set<string>() }],
    ['bob', { nick: 'bob', modes: new Set<string>() }],
  ]);
  return {
    name: '#general',
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

describe('MessageView continuation grouping reactivity', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    resetPreferences();
  });

  it('updates an existing keyed row from continuation to full-header when its predecessor changes', async () => {
    const first = makeMessage('m1', 'alice', 'first', 0);
    const predecessor = makeMessage('m2', 'bob', 'predecessor', 1);
    const subject = makeMessage('m3', 'bob', 'subject', 2);
    store.setState(
      {
        ...initialState,
        channels: new Map([['#general', makeChannel([first, predecessor, subject])]]),
        activeView: { kind: 'channel', channel: '#general' },
        connectionStatus: 'connected',
        ourNick: 'testuser',
      },
      true,
    );

    render(() => <MessageView />);

    await waitFor(() => {
      const row = document.querySelector('[data-message-search-id="m3"]');
      expect(row).not.toBeNull();
      expect(row).toHaveClass('shell-msg-cont');
      expect(row).not.toHaveClass('shell-msg-group');
    });

    store.setState({
      channels: new Map([['#general', makeChannel([first, subject])]]),
    });

    await waitFor(() => {
      const row = document.querySelector('[data-message-search-id="m3"]');
      expect(row).not.toBeNull();
      expect(row).toHaveClass('shell-msg-group');
      expect(row).not.toHaveClass('shell-msg-cont');
    });
  });
});
