// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import { RoadmapBridge } from './Roadmap';

describe('RoadmapRoute', () => {
  it('renders a useful standalone public roadmap instead of a redirect-only bridge', () => {
    render(() => <RoadmapBridge />);

    expect(screen.getByRole('heading', { name: /a place for your people\s*that you can trust/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByText(/first-class native experience inside OnyxOS/i)).toBeInTheDocument();
  });

  it('shows the current execution sequence without protocol jargon', () => {
    render(() => <RoadmapBridge />);

    expect(screen.getByRole('heading', { name: /repair the front door/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /make the client dependable/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /bring Onyx into OnyxOS/i })).toBeInTheDocument();
    expect(screen.queryByText(/IRCv3|IRCX/)).not.toBeInTheDocument();
  });
});
