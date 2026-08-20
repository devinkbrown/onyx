// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectPulse, roomPresenceLabel } from './ConnectPulse';
import { NODES, pingNode } from './nodes';

const { fetchStatsIndex } = vi.hoisted(() => ({
  fetchStatsIndex: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/lib/stats/networkIndex', () => ({
  fetchStatsIndex,
  relTime: vi.fn(() => 'now'),
}));

vi.mock('./nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nodes')>();
  return {
    ...actual,
    pingNode: vi.fn((_node, _timeout, signal?: AbortSignal) => new Promise<number>((resolve) => {
      signal?.addEventListener('abort', () => resolve(Number.POSITIVE_INFINITY), { once: true });
    })),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConnectPulse node probes', () => {
  it('labels current presence from present, never rolling active_users', () => {
    const room = {
      channel: '#root',
      messages: 908,
      active_users: 16,
      present: 7,
      last_active: 1,
      topic: '',
      spark: [],
    };

    expect(roomPresenceLabel(room, Date.now())).toBe('7 people here now');
    expect(roomPresenceLabel({ ...room, present: 1 }, Date.now())).toBe('1 person here now');
    expect(roomPresenceLabel({ ...room, present: 0 }, Date.now())).toBe('now');
  });

  it('keeps the connect surface mounted while optional pulse data is pending', () => {
    render(() => (
      <Suspense fallback={<p data-testid="connect-suspended">Loading connect</p>}>
        <p>Stable sign-in form</p>
        <ConnectPulse />
      </Suspense>
    ));

    expect(screen.queryByTestId('connect-suspended')).not.toBeInTheDocument();
    expect(screen.getByText('Stable sign-in form')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Live network activity' })).toBeInTheDocument();
  });

  it('shares one lifecycle signal with its probes and aborts it on unmount', async () => {
    const view = render(() => <ConnectPulse />);
    const probe = vi.mocked(pingNode);
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(NODES.length));

    const signals = probe.mock.calls.map((call) => call[2]);
    expect(signals.every((signal) => signal && !signal.aborted)).toBe(true);
    expect(new Set(signals).size).toBe(1);

    view.unmount();

    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });

  it('links live rooms and the aggregate index to the public room ledger', async () => {
    fetchStatsIndex.mockResolvedValueOnce({
      generated_at: 1,
      channels_complete: true,
      channels: [
        {
          channel: '#root',
          messages: 908,
          active_users: 16,
          present: 7,
          last_active: 1,
          topic: 'welcome',
          spark: [],
        },
      ],
    });

    render(() => <ConnectPulse />);

    expect(await screen.findByRole('link', { name: 'Room ledger' })).toHaveAttribute('href', '/stats/');
    expect(screen.getByRole('link', { name: 'Room ledger for #root' })).toHaveAttribute(
      'href',
      '/stats/?room=%23root',
    );
  });

  it('links a join deep-link target to the public room ledger', () => {
    render(() => <ConnectPulse deepLink="#lobby" />);

    expect(screen.getByTestId('pulse-deeplink-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23lobby',
    );
    expect(screen.getByTestId('pulse-deeplink-ledger')).toHaveAttribute(
      'aria-label',
      'Room ledger for #lobby',
    );
  });

  it('keeps non-channel deep link targets as plain text', () => {
    render(() => <ConnectPulse deepLink="alice" />);

    expect(screen.queryByTestId('pulse-deeplink-ledger')).toBeNull();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });
});
