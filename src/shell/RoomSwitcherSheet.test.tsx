// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomSwitcherSheet } from './RoomSwitcherSheet';

afterEach(cleanup);

describe('RoomSwitcherSheet', () => {
  it('exposes the selected collection as a modal sheet and dismisses from its backdrop', () => {
    const onDismiss = vi.fn();
    render(() => (
      <RoomSwitcherSheet open mode="messages" onDismiss={onDismiss}>
        <button type="button">Ada</button>
      </RoomSwitcherSheet>
    ));

    expect(screen.getByRole('dialog', { name: 'Inbox switcher' })).toBeInTheDocument();
    expect(screen.getByText('Choose a conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close switcher' })).toHaveAttribute('title', 'Close switcher');
    fireEvent.click(document.querySelector('.shell-sidebar-backdrop')!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
