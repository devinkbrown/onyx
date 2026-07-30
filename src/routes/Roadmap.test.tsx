// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import RoadmapRoute, { ROADMAP_LANES } from './Roadmap';

describe('RoadmapRoute', () => {
  it('renders the evidence-led roadmap instead of redirecting back into itself', () => {
    render(() => <RoadmapRoute />);

    expect(screen.getByTestId('roadmap-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /build the place/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the open network works/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /claims we will not fake/i })).toBeInTheDocument();
  });

  it('keeps shipped, active, next, and evidence-gated work visibly distinct', () => {
    render(() => <RoadmapRoute />);

    expect(new Set(ROADMAP_LANES.map((lane) => lane.state))).toEqual(
      new Set(['shipped', 'active', 'next', 'gated']),
    );
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Evidence gated').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /download and install/i })).toHaveAttribute(
      'href',
      '/download/',
    );
  });
});
