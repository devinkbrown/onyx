// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeRoomBoard } from './HomeRoomBoard';

afterEach(cleanup);

describe('HomeRoomBoard', () => {
  it('opens with the public room and exposes useful real destinations', () => {
    const { container } = render(() => <HomeRoomBoard />);
    const board = container.querySelector('[data-home-room-board]')!;

    expect(board).toHaveAttribute('data-room-intent', 'public-room');
    expect(board).toHaveTextContent('For the next match. And the conversation after.');
    expect(board).toHaveTextContent(/not a live list of who is online/i);
    expect(screen.getByRole('link', { name: 'Open the public room' })).toHaveAttribute('href', '/invite/?join=%23root');
    expect(screen.getByRole('navigation', { name: 'Useful ways into Onyx' })).toBeInTheDocument();
    expect(board.querySelector('.home-room-board__map, ol')).toBeNull();
  });

  it('keeps route choice keyboard-operable and updates the active destination', async () => {
    const { container } = render(() => <HomeRoomBoard />);
    const board = container.querySelector('[data-home-room-board]')!;
    const firstTab = screen.getByRole('tab', { name: 'Meet people' });

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Bring people' })).toHaveFocus());
    expect(board).toHaveAttribute('data-room-intent', 'bring-people');
    expect(board).toHaveTextContent('Bring your people along.');
    expect(screen.getByRole('link', { name: 'Open Onyx' })).toHaveAttribute('href', '/app/');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Bring people' }), { key: 'End' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Get oriented' })).toHaveFocus());
    expect(board).toHaveAttribute('data-room-intent', 'learn');
    expect(screen.getByRole('link', { name: 'Read the first-room guide' })).toHaveAttribute('href', '/guides/');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Get oriented' }), { key: 'Home' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Meet people' })).toHaveFocus());
    expect(board).toHaveAttribute('data-room-intent', 'public-room');
  });

  it('keeps every preview interaction local and leaves the scene free of fake controls', () => {
    const { container } = render(() => <HomeRoomBoard />);
    const board = container.querySelector('[data-home-room-board]')!;
    expect(board.querySelectorAll('button')).toHaveLength(3);
    expect(board.querySelectorAll('input, textarea, select, [data-live-room]')).toHaveLength(0);
    expect([...board.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toContain('/download/');
  });
});
