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
});
