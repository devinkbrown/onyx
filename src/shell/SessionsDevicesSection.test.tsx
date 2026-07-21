// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionsDevicesSection — B8: SESSION LIST fold + DROP, honest empty state.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';

import { store } from '@/lib/store';
import { SessionsDevicesSection } from './SessionsDevicesSection';

const initial = store.getInitialState();

afterEach(() => {
  cleanup();
  store.setState(initial, true);
});

beforeEach(() => {
  store.setState({
    ...initial,
    client: { sendRaw: vi.fn() } as never,
    server: { account: 'alice', name: 'test' } as never,
    accountSessions: [],
    accountSessionsPending: false,
    accountSessionsError: null,
  }, true);
});

describe('SessionsDevicesSection', () => {
  it('renders nothing for a guest (no account)', () => {
    render(() => <SessionsDevicesSection account={null} />);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty account string (fail-closed)', () => {
    render(() => <SessionsDevicesSection account="" />);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
  });

  it('requests SESSION LIST on open and shows empty pending honestly', () => {
    const sendRaw = vi.fn();
    store.setState({ client: { sendRaw } as never }, false);
    render(() => <SessionsDevicesSection account="alice" />);

    expect(screen.getByTestId('sessions-devices-section')).toBeInTheDocument();
    expect(sendRaw).toHaveBeenCalledWith('SESSION', 'LIST');
    expect(screen.getByTestId('sessions-empty')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-refresh')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
  });

  it('lists server sessions and allows revoke on non-current rows only', () => {
    const sendRaw = vi.fn();
    store.setState({ client: { sendRaw } as never }, false);

    render(() => <SessionsDevicesSection account="alice" />);
    // Auto-refresh on mount clears the list; apply the server fold after that.
    store.setState({
      accountSessions: [
        { index: 1, current: true, signonMs: 1_710_000_000_000, state: 'attached' },
        { index: 2, current: false, signonMs: 1_710_000_100_000, state: 'attached' },
      ],
      accountSessionsPending: false,
    }, false);

    expect(screen.getByTestId('sessions-current-device')).toHaveTextContent(/this connection/i);
    expect(screen.getByTestId('sessions-row-2')).toHaveTextContent(/session #2/i);
    expect(screen.queryByTestId('sessions-drop-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sessions-drop-2'));
    expect(sendRaw).toHaveBeenCalledWith('SESSION', 'DROP', '#2');
  });

  it('points at Passkeys for device credentials', () => {
    render(() => <SessionsDevicesSection account="alice" />);
    const hint = screen.getByTestId('sessions-passkeys-hint');
    expect(hint).toHaveTextContent(/passkeys/i);
  });

  it('updates when the account prop changes (reactivity)', () => {
    const [account, setAccount] = createSignal<string | null>('alice');
    render(() => <SessionsDevicesSection account={account()} />);
    expect(screen.getByText('alice', { selector: 'strong' })).toBeInTheDocument();
    setAccount('carol');
    expect(screen.getByText('carol', { selector: 'strong' })).toBeInTheDocument();
    setAccount(null);
    expect(screen.queryByTestId('sessions-devices-section')).not.toBeInTheDocument();
  });
});
