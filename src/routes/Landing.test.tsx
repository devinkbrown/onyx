import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import Landing from './Landing';

describe('Landing', () => {
  it('renders the community-first hero headline', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/come live/i)).toBeInTheDocument();
    expect(getByText(/on the water/i)).toBeInTheDocument();
  });

  it('leads with people and place, not jargon', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/People, not\s*a product/i)).toBeInTheDocument();
    expect(getByText(/Rooms to\s*wander into/i)).toBeInTheDocument();
  });

  it('invites the visitor to join in seconds', () => {
    const { getByText, getAllByText } = render(() => <Landing />);
    expect(getByText(/You're three\s*steps from hello/i)).toBeInTheDocument();
    expect(getAllByText(/Open Onyx/i).length).toBeGreaterThan(0);
  });

  it('states the culture: open, yours, no ads', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Open to the bone/i)).toBeInTheDocument();
    expect(getByText(/No ads, no mining/i)).toBeInTheDocument();
  });

  it('offers to run your own node', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/raise\s*your own shore/i)).toBeInTheDocument();
  });

  it('carries no devil / gate lore', () => {
    const { queryByText } = render(() => <Landing />);
    expect(queryByText(/devil/i)).not.toBeInTheDocument();
    expect(queryByText(/the gate/i)).not.toBeInTheDocument();
    expect(queryByText(/wrath/i)).not.toBeInTheDocument();
  });

  it('renders the brand mascot accessibly', () => {
    const { getAllByRole } = render(() => <Landing />);
    const dragons = getAllByRole('img').filter((el) =>
      (el.getAttribute('aria-label') ?? '').toLowerCase().includes('water-dragon'),
    );
    expect(dragons.length).toBeGreaterThan(0);
  });

  it('exposes a primary entry point into the app', () => {
    const { getAllByRole } = render(() => <Landing />);
    const enter = getAllByRole('link').filter((a) => a.getAttribute('href') === '/app');
    expect(enter.length).toBeGreaterThan(0);
  });

  it('links the main website telemetry pages from the root page', () => {
    const { getAllByRole } = render(() => <Landing />);
    const hrefs = getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/stats');
    expect(hrefs).toContain('/status');
    expect(hrefs).toContain('/roadmap');
  });

  it('surfaces live public telemetry on the root website', () => {
    const { getByText } = render(() => <Landing />);

    expect(getByText(/The network\s*is visible/i)).toBeInTheDocument();
    expect(getByText(/Public telemetry is part of the front door/i)).toBeInTheDocument();
  });
});
