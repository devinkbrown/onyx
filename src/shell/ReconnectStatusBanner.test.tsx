// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { ReconnectStatusBanner } from './ReconnectStatusBanner';

const initialState = store.getInitialState();

function seed(
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting',
  reconnectIn = 0,
): void {
  store.setState({ ...initialState, connectionStatus, reconnectIn }, true);
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
    seed('disconnected');
    render(() => <ReconnectStatusBanner />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('Disconnected from network. Working offline.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Disconnected from network.')).toBeInTheDocument();
  });

  it('keeps the visible countdown out of the stable screen-reader announcement', () => {
    seed('reconnecting', 5);
    render(() => <ReconnectStatusBanner />);

    const status = screen.getByRole('status');
    expect(screen.getByText('Reconnecting in 5s…').closest('[aria-hidden="true"]')).toBeInTheDocument();
    expect(status).toHaveTextContent('Reconnecting to network.');
    expect(status).not.toHaveTextContent('5');

    store.setState({ reconnectIn: 4 });

    expect(screen.getByText('Reconnecting in 4s…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Reconnecting to network.');
    expect(status).not.toHaveTextContent('4');
  });

  it('announces phase boundaries and briefly shows Back online after the handshake', () => {
    vi.useFakeTimers();
    seed('disconnected');
    render(() => <ReconnectStatusBanner />);

    store.setState({ connectionStatus: 'reconnecting', reconnectIn: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to network.');

    store.setState({ connectionStatus: 'connecting', reconnectIn: 0 });
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to network.');

    store.setState({ connectionStatus: 'connected' });
    expect(screen.getByText('Back online')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Back online.');

    vi.advanceTimersByTime(3_000);
    expect(screen.queryByText('Back online')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Back online.');
  });

  it('cancels recovery dismissal when another disconnect begins', () => {
    vi.useFakeTimers();
    seed('disconnected');
    render(() => <ReconnectStatusBanner />);

    store.setState({ connectionStatus: 'connected' });
    expect(screen.getByText('Back online')).toBeInTheDocument();

    store.setState({ connectionStatus: 'disconnected' });
    vi.advanceTimersByTime(3_000);

    expect(screen.getByText('Disconnected from network.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected from network. Working offline.');
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
