import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import RoadmapRoute from './Roadmap';

describe('RoadmapRoute', () => {
  it('renders the public roadmap as a main website route', () => {
    render(() => <RoadmapRoute />);

    expect(screen.getByRole('heading', { name: /what shipped/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Operations become visible/i })).toBeInTheDocument();
  });

  it('links to the rest of the public website', () => {
    render(() => <RoadmapRoute />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/stats');
    expect(hrefs).toContain('/status');
    expect(hrefs).toContain('/app');
  });
});
