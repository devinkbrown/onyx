// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';

import { RoadmapBridge } from './Roadmap';

describe('RoadmapRoute', () => {
  it('uses PublicFrame as its only document frame and exposes canonical navigation', () => {
    const { container } = render(() => <RoadmapBridge />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Onyx product roadmap' })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.roadmap-page')).toBeTruthy();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Planning\s*·\s*Proof before promise/);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { name: /a place for your people\s*that you can trust/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Roadmap state legend' })).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getAllByText('Proof before promise')).toHaveLength(2);
    expect(screen.getByText(/first-class native experience inside OnyxOS/i)).toBeInTheDocument();
  });

  it('shows the current execution sequence without protocol jargon', () => {
    render(() => <RoadmapBridge />);

    expect(screen.getByRole('heading', { name: /repair the front door/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /make the client dependable/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /bring Onyx into OnyxOS/i })).toBeInTheDocument();
    expect(screen.queryByText(/IRCv3|IRCX/)).not.toBeInTheDocument();
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <RoadmapBridge />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });

    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
