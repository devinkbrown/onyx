// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { store } from '@/lib/store/store';
import ChannelBrowser from './ChannelBrowser';

const initialState = store.getInitialState();

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('ChannelBrowser', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
  });

  afterEach(cleanup);

  it('shows each listed channel only once after duplicate LIST rows', () => {
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #general 2 :Launch room');
    feed(':server.test 322 me #General 5 :');
    feed(':server.test 322 me #random 1 :Off-topic');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Browse channels' });
    expect(within(dialog).getByRole('search', { name: 'Channel directory search' })).toBeInTheDocument();
    const directory = within(dialog).getByRole('list', { name: 'Public channel directory' });
    expect(within(directory).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getAllByText('#general')).toHaveLength(1);
    expect(within(dialog).getByText('5 users')).toBeInTheDocument();
    expect(within(dialog).getByText('Launch room')).toBeInTheDocument();
    expect(within(dialog).getByText('#random')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Join #general' })).toBeInTheDocument();

    fireEvent.input(within(dialog).getByRole('searchbox', { name: 'Filter channels' }), {
      target: { value: 'off-topic' },
    });

    expect(within(dialog).queryByText('#general')).not.toBeInTheDocument();
    expect(within(dialog).getByText('#random')).toBeInTheDocument();
  });

  it('orders equal-count channels deterministically by name, not LIST arrival order', () => {
    // The mesh streams rows from multiple nodes, so arrival order is not
    // stable. Rows tied on user count must fall back to a name sort or the
    // directory reshuffles between refreshes for identical data.
    store.setState({ channelListLoading: true });
    feed(':server.test 322 me #zebra 5 :');
    feed(':server.test 322 me #alpha 5 :');
    feed(':server.test 322 me #mango 5 :');
    feed(':server.test 323 me :End of LIST');
    store.setState({ showChannelBrowser: true });

    render(() => <ChannelBrowser />);

    const dialog = screen.getByRole('dialog', { name: 'Browse channels' });
    const directory = within(dialog).getByRole('list', { name: 'Public channel directory' });
    const names = Array.from(directory.querySelectorAll('.chb-name')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['#alpha', '#mango', '#zebra']);
  });

  it('announces the debounced result count through a polite status region', () => {
    vi.useFakeTimers();
    try {
      store.setState({ channelListLoading: true });
      feed(':server.test 322 me #general 2 :Launch room');
      feed(':server.test 322 me #random 1 :Off-topic');
      feed(':server.test 323 me :End of LIST');
      store.setState({ showChannelBrowser: true });

      render(() => <ChannelBrowser />);

      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();

      // Opening the directory announces the total once the debounce settles.
      vi.advanceTimersByTime(400);
      expect(status).toHaveTextContent('2 channels available');

      fireEvent.input(screen.getByRole('searchbox', { name: 'Filter channels' }), {
        target: { value: 'off-topic' },
      });
      vi.advanceTimersByTime(400);
      expect(status).toHaveTextContent(/1 channel matches/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the empty directory to assistive tech', () => {
    vi.useFakeTimers();
    try {
      store.setState({ channelListLoading: true });
      feed(':server.test 323 me :End of LIST');
      store.setState({ showChannelBrowser: true });

      render(() => <ChannelBrowser />);

      vi.advanceTimersByTime(400);
      expect(screen.getByRole('status')).toHaveTextContent(/no public channels/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
