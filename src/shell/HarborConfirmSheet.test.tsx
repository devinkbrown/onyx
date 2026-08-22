// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { HarborConfirmHost } from './HarborConfirmSheet';
import {
  closeRoomVerbConfirm,
  openCloseConversationConfirm,
  openLeaveRoomConfirm,
} from './roomVerbConfirm';

const initialState = store.getInitialState();

describe('HarborConfirmHost', () => {
  const sendRaw = vi.fn(() => true);

  beforeEach(() => {
    closeRoomVerbConfirm();
    sendRaw.mockClear();
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
      server: {
        id: 'harbor',
        name: 'Harbor',
        network: 'Harbor',
        url: 'wss://harbor.test/ws',
        icon: '',
        nick: 'alice',
        account: 'alice',
        connected: true,
      },
      ourNick: 'alice',
      addToast: vi.fn(),
    }, true);
  });

  afterEach(() => {
    cleanup();
    closeRoomVerbConfirm();
    store.setState(initialState, true);
  });

  it('confirms leave with Fraunces-once copy and then PARTs', () => {
    openLeaveRoomConfirm('#harbor');
    render(() => <HarborConfirmHost />);

    expect(screen.getByRole('heading', { name: 'Leave #harbor?' })).toBeInTheDocument();
    expect(screen.getByText('You will leave #harbor. History stays on this device.')).toBeInTheDocument();
    expect(sendRaw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('harbor-leave-confirm'));
    expect(sendRaw).toHaveBeenCalledWith('PART', '#harbor', 'Goodbye');
    expect(screen.queryByTestId('harbor-confirm')).toBeNull();
  });

  it('closes a conversation without PARTing', () => {
    openCloseConversationConfirm('mira');
    render(() => <HarborConfirmHost />);

    expect(screen.getByRole('heading', { name: 'Close conversation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('harbor-close-confirm'));
    expect(store.getState().closedConversations.has('mira')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('Stay dismisses leave without PARTing', () => {
    openLeaveRoomConfirm('#harbor');
    render(() => <HarborConfirmHost />);
    fireEvent.click(screen.getByTestId('harbor-confirm-cancel'));
    expect(sendRaw).not.toHaveBeenCalled();
    expect(screen.queryByTestId('harbor-confirm')).toBeNull();
  });
});
