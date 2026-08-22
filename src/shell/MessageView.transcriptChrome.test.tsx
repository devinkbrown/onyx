// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageView.transcriptChrome.test.tsx — consumer transcript surface.
 *
 * Pins grouped rows, the unread marker, pending visibility, and hover-bar
 * discoverability without touching store/protocol kernels.
 */
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { MessageView } from './MessageView';

const initialState = store.getInitialState();

function makeMessage(
  id: string,
  from: string,
  text: string,
  minute: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date(2026, 6, 10, 9, minute),
    type: 'msg',
    target: '#general',
    ...extra,
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
    unread: 2,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

function seed(messages: ChatMessage[], unreadId?: string): void {
  store.setState(
    {
      ...initialState,
      channels: new Map([['#general', makeChannel(messages)]]),
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      ourNick: 'alice',
      canEditMessages: true,
      canRedactMessages: true,
      viewUnreadDividerId: unreadId
        ? new Map([['#general', unreadId]])
        : new Map(),
    },
    true,
  );
}

describe('MessageView consumer transcript chrome', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
    resetPreferences();
  });

  it('groups consecutive same-author lines and repeats avatar/name only on the header', () => {
    seed([
      makeMessage('m1', 'bob', 'first', 0),
      makeMessage('m2', 'bob', 'second', 1),
      makeMessage('m3', 'alice', 'reply', 2),
    ]);

    render(() => <MessageView />);

    const first = document.querySelector('[data-message-search-id="m1"]');
    const second = document.querySelector('[data-message-search-id="m2"]');
    const third = document.querySelector('[data-message-search-id="m3"]');
    expect(first).toHaveClass('shell-msg-group');
    expect(second).toHaveClass('shell-msg-cont');
    expect(third).toHaveClass('shell-msg-group');
    expect(first?.querySelector('.shell-msg-author')?.textContent).toBe('bob');
    expect(second?.querySelector('.shell-msg-author')).toBeNull();
    expect(document.querySelectorAll('.shell-day-divider')).toHaveLength(1);
  });

  it('holds a New messages divider above the captured unread row', () => {
    seed([
      makeMessage('m1', 'bob', 'older', 0),
      makeMessage('m2', 'bob', 'unseen', 1),
    ], 'm2');

    render(() => <MessageView />);

    const divider = document.querySelector('.shell-unread-divider');
    const unseen = document.querySelector('[data-message-search-id="m2"]');
    expect(divider).not.toBeNull();
    expect(divider).toHaveAccessibleName('New messages');
    expect(divider?.textContent).toMatch(/New messages/);
    expect(unseen?.previousElementSibling).toBe(divider);
  });

  it('marks a pending local echo with a visible Queued chip', () => {
    seed([
      makeMessage('m-pending', 'alice', 'still sending', 0, { pending: true }),
    ]);

    render(() => <MessageView />);

    const row = document.querySelector('[data-message-search-id="m-pending"]');
    expect(row).toHaveClass('shell-msg-pending');
    expect(row?.querySelector('.shell-msg-pending-mark')?.textContent).toBe('Queued');
    expect(screen.getByRole('article', { name: /queued/i })).toBeInTheDocument();
  });

  it('exposes React, Reply, and More on every live row — not Edit/Delete chips', () => {
    seed([
      makeMessage('m-other', 'bob', 'theirs', 0),
      makeMessage('m-own', 'alice', 'ours', 1),
    ]);

    render(() => <MessageView />);

    expect(screen.getByRole('button', { name: 'Reply to bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose reaction for message from bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for message from bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply to alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose reaction for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for message from alice' })).toBeInTheDocument();
    expect(screen.queryByTestId('msg-menu-edit')).toBeNull();
    expect(screen.queryByTestId('msg-menu-delete')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(react|reply|edit|delete)$/i })).toBeNull();
  });
});
