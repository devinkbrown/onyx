import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import RoadmapRoute from './Roadmap';

describe('RoadmapRoute', () => {
  it('renders the public roadmap as a main website route', () => {
    render(() => <RoadmapRoute />);

    expect(screen.getByRole('heading', { name: /what shipped/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Operations are visible/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time-native' })).toBeInTheDocument();
    expect(screen.getByText('Scheduled events on Home')).toBeInTheDocument();
    expect(screen.getByText('Vault memory previews')).toBeInTheDocument();
    expect(screen.getByText('Quiet room activity')).toBeInTheDocument();
    expect(screen.getByText('Home return recaps')).toBeInTheDocument();
    expect(screen.getByText('Spotlight handoff')).toBeInTheDocument();
    expect(screen.getByText('Room rhythm heatlines')).toBeInTheDocument();
    expect(screen.getByText('Event context')).toBeInTheDocument();
    expect(screen.getByText('Review from start')).toBeInTheDocument();
    expect(screen.getByText('Catch-up review history')).toBeInTheDocument();
    expect(screen.getByText('Review text search')).toBeInTheDocument();
    expect(screen.getByText('Channel directory dedupe')).toBeInTheDocument();
    expect(screen.getByText('Reader digest notes')).toBeInTheDocument();
    expect(screen.getByText('Shareable moment links')).toBeInTheDocument();
    expect(screen.getByText('Reader memory context')).toBeInTheDocument();
    expect(screen.getByText('Moment search handoff')).toBeInTheDocument();
    expect(screen.getByText('Reader transcript jumps')).toBeInTheDocument();
    expect(screen.getByText('Digest review handoff')).toBeInTheDocument();
    expect(screen.getByText('Review completion')).toBeInTheDocument();
    expect(screen.getByText('Reader return Home')).toBeInTheDocument();
    expect(screen.getByText('Reviewed span recall')).toBeInTheDocument();
    expect(screen.getByText('Hydrated context trails')).toBeInTheDocument();
    expect(screen.getByText('Vault context trails')).toBeInTheDocument();
    expect(screen.getByText('Vault anchor jumps')).toBeInTheDocument();
    expect(screen.getByText('Client access audit')).toBeInTheDocument();
    expect(screen.getByText('Dense-panel evidence')).toBeInTheDocument();
    expect(screen.getByText('Home access evidence')).toBeInTheDocument();
    expect(screen.getByText('Search access evidence')).toBeInTheDocument();
    expect(screen.getByText('Inbox access evidence')).toBeInTheDocument();
    expect(screen.getByText('Directory access evidence')).toBeInTheDocument();
    expect(screen.getByText('Account access evidence')).toBeInTheDocument();
    expect(screen.getByText('Sidebar access evidence')).toBeInTheDocument();
    expect(screen.getByText('Shortcuts access evidence')).toBeInTheDocument();
    expect(screen.getByText('Pins access evidence')).toBeInTheDocument();
    expect(screen.getByText('Theme import evidence')).toBeInTheDocument();
    expect(screen.getByText(/time is active/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Washi' })).toBeInTheDocument();
  });

  it('links to the rest of the public website', () => {
    render(() => <RoadmapRoute />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/stats');
    expect(hrefs).toContain('/status');
    expect(hrefs).toContain('/app');
    expect(hrefs).toContain('/accessibility/');
  });
});
