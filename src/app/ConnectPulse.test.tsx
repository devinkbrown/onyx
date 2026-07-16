// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectPulse } from './ConnectPulse';
import { NODES, pingNode } from './nodes';

vi.mock('@/lib/stats/networkIndex', () => ({
  fetchStatsIndex: vi.fn(() => new Promise(() => {})),
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
});
