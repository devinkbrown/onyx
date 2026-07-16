// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatusRoute from './Status';

describe('StatusRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the public status page shell without a live feed', async () => {
    render(() => <StatusRoute />);

    expect(screen.getByRole('heading', { name: /mesh health/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /vault backups/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open stats/i })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: /open roadmap/i })).toHaveAttribute('href', '/roadmap');
    expect(await screen.findByText(/status is waiting/i)).toBeInTheDocument();
    expect(screen.getByText('status unavailable')).toHaveAttribute('data-feed-state', 'unavailable');
  });

  it('keeps the status page shell visible while public feeds are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="status-suspended">Loading status</p>}>
        <StatusRoute />
      </Suspense>
    ));

    expect(screen.getByRole('heading', { name: /mesh health/i })).toBeInTheDocument();
    expect(screen.queryByTestId('status-suspended')).not.toBeInTheDocument();
  });
});
