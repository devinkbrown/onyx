// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { RoomInviteShare } from './RoomInviteShare';
import { closeRoomInviteShare, openRoomInviteShare } from './roomInviteShareState';

const initialState = store.getInitialState();
const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');

function makeChannel(name: string, topic = ''): Channel {
  return {
    name,
    topic,
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map<string, ChannelUser>(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

beforeEach(() => {
  store.setState({
    ...initialState,
    networkName: 'Onyx',
    channels: new Map([['#lounge', makeChannel('#lounge', 'Friday hangout')]]),
    connectionStatus: 'connected',
    ourNick: 'me',
  }, true);
  closeRoomInviteShare();
});

afterEach(() => {
  cleanup();
  closeRoomInviteShare();
  vi.restoreAllMocks();
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else Reflect.deleteProperty(navigator, 'share');
  if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
  else Reflect.deleteProperty(navigator, 'canShare');
  store.setState(initialState, true);
});

describe('RoomInviteShare', () => {
  it('opens from the shared signal with the room name and real topic', () => {
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    expect(screen.getByRole('dialog', { name: /invite friends/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Invite preview' })).toHaveTextContent('#lounge');
    expect(screen.getByText('Friday hangout')).toBeInTheDocument();
    expect(screen.getByText(/Send this link/)).toBeInTheDocument();
    expect(screen.getByText('Anyone with the link can open the invite. Room access rules still apply.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.queryByText(/choose to join this room/i)).toBeNull();
    expect(screen.getByText(`${window.location.origin}/invite/?join=%23lounge`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByText(/mesh|handshake|claim path|IRC|MODE/i)).not.toBeInTheDocument();
  });

  it('shares a network invite when no room is selected', () => {
    openRoomInviteShare('');
    render(() => <RoomInviteShare />);

    expect(screen.getByRole('group', { name: 'Invite preview' })).toHaveTextContent('Onyx');
    expect(screen.getByText(`${window.location.origin}/invite/`)).toBeInTheDocument();
  });

  it('explains the copy fallback when native sharing is unavailable', () => {
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.getByText('Sharing is not available here. Copy the link instead.')).toBeInTheDocument();
  });

  it('keeps copying available while disconnected', () => {
    store.setState({ connectionStatus: 'disconnected' });
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    expect(screen.getByText('You’re offline. You can still copy this link and share it.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
  });

  it('copies the existing invite link', async () => {
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText('Invite link copied to clipboard.')).toHaveAttribute('role', 'status');
    expect(writeClipboardText).toHaveBeenCalledWith(`${window.location.origin}/invite/?join=%23lounge`);
  });

  it('mounts an empty live region before actions and retains it across success, failure, and cancellation', async () => {
    vi.spyOn(clipboard, 'writeClipboardText')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const share = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Share unavailable'))
      .mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    const status = screen.getByTestId('room-invite-share-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toBeEmptyDOMElement();

    for (const result of [
      'Invite link copied to clipboard.',
      'Copy failed. Select and copy the link shown above.',
      'Invite link copied to clipboard.',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(await screen.findByText(result)).toBe(status);
      expect(status).toBeVisible();
      expect(status).not.toHaveClass('sr-only');
    }

    for (const result of [
      'Invite shared.',
      'Could not open the share sheet. Copy the link instead.',
      'Share cancelled. The link is still available below.',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(screen.getByText('Opening your device share sheet.')).toBe(status);
      expect(await screen.findByText(result)).toBe(status);
      expect(status).toBeVisible();
    }
  });

  it('offers native share when the browser accepts the payload', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    openRoomInviteShare('#lounge');
    render(() => <RoomInviteShare />);

    const shareButton = screen.getByRole('button', { name: 'Share' });
    expect(shareButton).toHaveClass('onyx-button--ghost');
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveClass('onyx-button--primary');
    fireEvent.click(shareButton);

    expect(await screen.findByText('Invite shared.')).toHaveAttribute('role', 'status');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Join #lounge on Onyx',
      text: 'A friend invited you to #lounge on Onyx.',
      url: `${window.location.origin}/invite/?join=%23lounge`,
    }));
  });
});
