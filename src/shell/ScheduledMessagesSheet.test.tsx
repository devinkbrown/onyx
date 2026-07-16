// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ScheduledMessagesSheet.test.tsx — the pending "send later" queue Sheet.
 *
 * Asserts the list renders each pending entry, cancel removes it (and the DOM
 * updates after the store change — the reactivity guard), and the empty state
 * shows when the queue drains.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import { ScheduledMessagesSheet } from './ScheduledMessagesSheet';

const initialState = store.getInitialState();

describe('ScheduledMessagesSheet', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    store.setState({
      ourNick: 'alice',
      server: {
        id: 'scheduled-sheet-test',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'alice',
        account: 'alice',
        connected: true,
      },
    });
    store.getState().openScheduledMessages();
  });

  afterEach(() => {
    cleanup();
  });

  it('lists each pending scheduled message', () => {
    store.getState().scheduleMessage('#root', 'first', Date.now() + 3_600_000);
    store.getState().scheduleMessage('#ops', 'second', Date.now() + 7_200_000);

    render(() => <ScheduledMessagesSheet />);
    const list = screen.getByRole('list', { name: 'Pending scheduled messages' });
    expect(list.querySelectorAll('.shell-scheduled-item')).toHaveLength(2);
  });

  it('cancels an entry and updates the DOM after the store change', () => {
    store.getState().scheduleMessage('#root', 'drop me', Date.now() + 3_600_000);

    render(() => <ScheduledMessagesSheet />);
    fireEvent.click(
      screen.getByRole('button', { name: /Cancel scheduled message to #root/ }),
    );

    expect(store.getState().scheduledMessages).toHaveLength(0);
    // The list is gone; the empty state replaces it — proves reactivity.
    expect(screen.queryByRole('list', { name: 'Pending scheduled messages' })).toBeNull();
  });

  it('shows and cancels only the current account queue while holding legacy rows', () => {
    store.getState().scheduleMessage('#alice', 'Alice private plan', Date.now() + 3_600_000);
    const alice = store.getState().scheduledMessages[0]!;
    const legacy = { ...alice, id: 'legacy-ownerless', text: 'Legacy private plan', owner: null };
    store.setState({
      scheduledMessages: [alice, legacy],
      ourNick: 'bob',
      server: {
        ...store.getState().server!,
        id: 'scheduled-sheet-bob',
        nick: 'bob',
        account: 'bob',
      },
    });
    store.getState().scheduleMessage('#bob', 'Bob private plan', Date.now() + 7_200_000);

    render(() => <ScheduledMessagesSheet />);

    expect(screen.getByText('Bob private plan')).toBeInTheDocument();
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy private plan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel scheduled message to #bob/ }));
    expect(store.getState().scheduledMessages).toEqual([alice, legacy]);
    expect(screen.queryByRole('list', { name: 'Pending scheduled messages' })).toBeNull();

    store.setState({
      ourNick: 'alice',
      server: {
        ...store.getState().server!,
        id: 'scheduled-sheet-alice',
        nick: 'alice',
        account: 'alice',
      },
    });
    expect(screen.getByText('Alice private plan')).toBeInTheDocument();
    expect(screen.queryByText('Legacy private plan')).not.toBeInTheDocument();
  });
});
