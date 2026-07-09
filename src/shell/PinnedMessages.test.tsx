import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { PinnedMessages } from './PinnedMessages';

const initialState = store.getInitialState();

function message(id: string, from: string, text: string): ChatMessage {
  return {
    id,
    from,
    text,
    target: '#room',
    time: new Date('2026-07-09T03:00:00Z'),
    type: 'msg',
  };
}

function channel(messages: ChatMessage[]): Channel {
  return {
    name: '#room',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map([
      ['me', { nick: 'me', modes: new Set(['o']) }],
    ]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

function seedPins(): void {
  const messages = [
    message('m1', 'alice', 'Keep this near the top.'),
    message('m2', 'bob', 'Ops should read this before changing the topic.'),
  ];
  store.setState({
    ...initialState,
    showPinnedMessages: true,
    activeView: { kind: 'channel', channel: '#room' },
    ourNick: 'me',
    channels: new Map([['#room', channel(messages)]]),
    channelProps: new Map([['#room', { PINS: 'm1,m2' }]]),
  }, true);
}

describe('PinnedMessages accessibility', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a named pins dialog with a channel-specific list', () => {
    seedPins();
    render(() => <PinnedMessages />);

    expect(screen.getByRole('dialog', { name: 'Pinned messages' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pinned messages in #room' })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Jump to pinned message from alice: Keep this near the top.',
    })).toBeInTheDocument();
  });

  it('exposes a real target-specific unpin action for ops', () => {
    seedPins();
    const unpin = vi.spyOn(store.getState(), 'unpinMessage');
    render(() => <PinnedMessages />);

    fireEvent.click(screen.getByRole('button', { name: 'Unpin message m1' }));

    expect(unpin).toHaveBeenCalledWith('#room', 'm1');
  });
});
