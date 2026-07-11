// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import StatusRoute from './Status';

describe('StatusRoute', () => {
  it('renders the public status page shell without a live feed', async () => {
    render(() => <StatusRoute />);

    expect(screen.getByRole('heading', { name: /mesh health/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /vault backups/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open stats/i })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: /open roadmap/i })).toHaveAttribute('href', '/roadmap');
    expect(await screen.findByText(/status is waiting/i)).toBeInTheDocument();
  });
});
