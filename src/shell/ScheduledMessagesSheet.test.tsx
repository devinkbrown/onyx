// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ScheduledMessagesSheet.test.tsx — the pending "send later" queue Sheet.
 *
 * Asserts the list renders each pending entry, cancel removes it (and the DOM
 * updates after the store change — the reactivity guard), and the empty state
 * shows when the queue drains.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { _resetVaultForTests } from '@/lib/vault/historyVault';

import { store } from '@/lib/store/store';
import { ScheduledMessagesSheet } from './ScheduledMessagesSheet';

const initialState = store.getInitialState();

describe('ScheduledMessagesSheet', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    window.indexedDB = globalThis.indexedDB;
    _resetVaultForTests();
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

  it('lists each pending scheduled message', async () => {
    await store.getState().scheduleMessage('#root', 'first', Date.now() + 3_600_000);
    await store.getState().scheduleMessage('#ops', 'second', Date.now() + 7_200_000);

    render(() => <ScheduledMessagesSheet />);
    const list = screen.getByRole('list', { name: 'Pending scheduled messages' });
    expect(list.querySelectorAll('.shell-scheduled-item')).toHaveLength(2);
    expect(screen.getAllByTestId('scheduled-channel-ledger')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Room ledger for #root' })).toHaveAttribute(
      'href',
      '/stats/?room=%23root',
    );
    expect(screen.getAllByText('Saved; waiting for its time')).toHaveLength(2);
    expect(screen.getByText(/Room · #root/)).toBeInTheDocument();
  });

  it('names the scheduled collection precisely when empty', async () => {
    render(() => <ScheduledMessagesSheet />);

    expect(screen.getByText('No scheduled messages.')).toBeInTheDocument();
    expect(screen.queryByText('Your outbox is clear.')).toBeNull();
  });

  it('omits the room ledger link for non-public targets', async () => {
    await store.getState().scheduleMessage('alice', 'dm later', Date.now() + 3_600_000);

    render(() => <ScheduledMessagesSheet />);

    expect(screen.queryByTestId('scheduled-channel-ledger')).toBeNull();
  });

  it('cancels an entry and updates the DOM after the store change', async () => {
    await store.getState().scheduleMessage('#root', 'drop me', Date.now() + 3_600_000);

    render(() => <ScheduledMessagesSheet />);
    fireEvent.click(
      screen.getByRole('button', { name: /Cancel scheduled message to #root/ }),
    );

    await waitFor(() => expect(store.getState().scheduledMessages).toHaveLength(0));
    // The list is gone; the empty state replaces it — proves reactivity.
    expect(screen.queryByRole('list', { name: 'Pending scheduled messages' })).toBeNull();
  });

  it('shows and cancels only the current account queue while holding legacy rows', async () => {
    await store.getState().scheduleMessage('#alice', 'Alice private plan', Date.now() + 3_600_000);
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
    await store.getState().scheduleMessage('#bob', 'Bob private plan', Date.now() + 7_200_000);

    render(() => <ScheduledMessagesSheet />);

    expect(screen.getByText('Bob private plan')).toBeInTheDocument();
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy private plan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel scheduled message to #bob/ }));
    await waitFor(() => expect(store.getState().scheduledMessages).toEqual([alice, legacy]));
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

  it('makes a durable claim visibly uncertain and uses non-cancellation copy', async () => {
    await store.getState().scheduleMessage('#root', 'possibly admitted', Date.now() - 1_000);
    const row = store.getState().scheduledMessages[0]!;
    store.setState({ scheduledMessages: [{ ...row, claim: { token: 'claim-1', claimedAt: Date.now() } }] });

    render(() => <ScheduledMessagesSheet />);

    expect(screen.getByRole('status')).toHaveTextContent('Sending; delivery is uncertain');
    expect(screen.getByText('Sending was attempted. Removing this row cannot confirm or undo delivery.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove uncertain scheduled message to #root/ })).toHaveTextContent('Remove row');
    fireEvent.click(screen.getByRole('button', { name: /Remove uncertain scheduled message to #root/ }));
    await waitFor(() => expect(screen.queryByText('possibly admitted')).toBeNull());
  });

  it('reacts when a due row becomes blocked by protection or encryption', async () => {
    store.setState({ connectionStatus: 'connected' });
    await store.getState().scheduleMessage('#root', 'protected later', Date.now() - 1_000);
    render(() => <ScheduledMessagesSheet />);

    expect(screen.getByRole('status')).toHaveTextContent('Due; awaiting send');
    store.setState({ isIRCX: true, channelPropsSynced: new Set() });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for room protection');
  });
});
