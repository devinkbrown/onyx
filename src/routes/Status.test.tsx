import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import StatusRoute from './Status';

describe('StatusRoute', () => {
  it('renders the public status page shell without a live feed', async () => {
    render(() => <StatusRoute />);

    expect(screen.getByRole('heading', { name: /mesh health/i })).toBeInTheDocument();
    expect(await screen.findByText(/status is waiting/i)).toBeInTheDocument();
  });
});
