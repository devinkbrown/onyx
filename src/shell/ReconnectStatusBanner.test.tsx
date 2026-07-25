// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { ReconnectStatusBanner } from './ReconnectStatusBanner';

const initialState = store.getInitialState();

function seed(
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting',
  reconnectIn = 0,
  autoReconnect = true,
): void {
  store.setState({ ...initialState, connectionStatus, reconnectIn, autoReconnect }, true);
}

describe('ReconnectStatusBanner', () => {
  beforeEach(() => {
    seed('connected');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    store.setState(initialState, true);
  });

  it('announces a disconnect through one polite atomic status', () => {
    seed('disconnected', 0, false);
    render(() => <ReconnectStatusBanner />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent(/Disconnected/);
    expect(status).toHaveTextContent(/Reconnect when you are ready/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent(/Reconnect when you are ready/);
  });

  it('keeps countdown in the visible banner while status stays a phase announcement', () => {
    seed('reconnecting', 5);
    render(() => <ReconnectStatusBanner />);

    const status = screen.getByRole('status');
    const banner = screen.getByTestId('reconnect-status-banner');
    expect(banner).toHaveAttribute('aria-hidden', 'true');
    expect(banner).toHaveTextContent(/5s/);
    expect(status).toHaveTextContent(/Reconnecting/);

    store.setState({ reconnectIn: 4 });
    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent(/4s/);
    expect(screen.getByRole('status')).toBe(status);
  });

  it('announces phase boundaries and briefly shows Back online after the handshake', () => {
    vi.useFakeTimers();
    seed('disconnected');
    render(() => <ReconnectStatusBanner />);

    store.setState({ connectionStatus: 'reconnecting', reconnectIn: 2 });
    expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/);

    store.setState({ connectionStatus: 'connecting', reconnectIn: 0 });
    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent(/Connecting/);
    expect(screen.getByRole('status')).toHaveTextContent(/Connecting|secure session/);

    store.setState({ connectionStatus: 'connected' });
    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent('Back online');
    expect(screen.getByRole('status')).toHaveTextContent('Back online.');

    vi.advanceTimersByTime(3_000);
    expect(screen.queryByTestId('reconnect-status-banner')).not.toBeInTheDocument();
  });

  it('cancels recovery dismissal when another disconnect begins', () => {
    vi.useFakeTimers();
    seed('disconnected');
    render(() => <ReconnectStatusBanner />);

    store.setState({ connectionStatus: 'connected' });
    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent('Back online');

    store.setState({ connectionStatus: 'disconnected', autoReconnect: true });
    vi.advanceTimersByTime(3_000);

    expect(screen.getByTestId('reconnect-status-banner')).toHaveTextContent(/retry automatically/);
    expect(screen.getByRole('status')).toHaveTextContent(/Disconnected/);
  });

  it('cleans the recovery timer when the banner unmounts', () => {
    vi.useFakeTimers();
    seed('disconnected');
    const result = render(() => <ReconnectStatusBanner />);

    store.setState({ connectionStatus: 'connected' });
    expect(vi.getTimerCount()).toBe(1);

    result.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
