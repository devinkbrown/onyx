import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import StatsRoute from './Stats';

describe('StatsRoute', () => {
  it('renders the public stats page shell without a live feed', async () => {
    render(() => <StatsRoute />);

    expect(screen.getByRole('heading', { name: /the rooms in motion/i })).toBeInTheDocument();
    expect(await screen.findByText(/stats are waiting/i)).toBeInTheDocument();
  });
});
