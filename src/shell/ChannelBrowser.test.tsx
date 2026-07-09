import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
