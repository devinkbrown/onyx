// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { ScheduledEventLine } from './ScheduledEventLine';

const initialState = store.getInitialState();

function channel(name: string, ownModes: readonly string[]): Channel {
  const user: ChannelUser = { nick: 'kain', modes: new Set(ownModes) };
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map([['kain', user]]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  store.setState(initialState, true);
});

describe('<ScheduledEventLine>', () => {
  it('keeps event state, controls, and actions aligned across a channel prop transition', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    const liveAt = Math.floor(Date.now() / 1000) - 30;
    store.setState({
      ...initialState,
      ourNick: 'kain',
      channels: new Map([
        ['#alpha', channel('#alpha', ['o'])],
        ['#beta', channel('#beta', [])],
      ]),
      channelProps: new Map([
        ['#alpha', { 'ocean.event': `${liveAt}|Alpha call` }],
        ['#beta', { 'ocean.event': `${liveAt}|Beta call` }],
      ]),
      voice: { ...initialState.voice, callChannel: '#alpha' },
    }, true);
    const joinSpy = vi.spyOn(store.getState(), 'joinVoiceChannel').mockResolvedValue(undefined);
    const [activeChannel, setActiveChannel] = createSignal('#alpha');

    render(() => <ScheduledEventLine channel={activeChannel()} />);

    expect(screen.getByText('Alpha call')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scheduled event: Alpha call' })).toBeInTheDocument();
    expect(screen.getByRole('time')).toHaveAttribute('datetime');
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear scheduled event' })).toBeInTheDocument();

    setActiveChannel('#beta');

    expect(screen.getByText('Beta call')).toBeInTheDocument();
    expect(screen.queryByText('Alpha call')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear scheduled event' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(joinSpy).toHaveBeenCalledWith('#beta');
  });
});
