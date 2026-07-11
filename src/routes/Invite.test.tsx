// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import InviteRoute from './Invite';

describe('InviteRoute', () => {
  it('renders a rich invite from query params and hands off to the app', () => {
    window.history.pushState({}, '', '/invite?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release%20train&reader=1&as=yuki');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { name: /join\s+#general/i })).toBeInTheDocument();
    expect(screen.getByText('IRCXNet')).toBeInTheDocument();
    expect(screen.getAllByText('#general').length).toBeGreaterThan(1);
    expect(screen.getAllByText('release train').length).toBeGreaterThan(0);
    expect(screen.getByText('Reader mode opens before the room joins.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what onyx keeps from this link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeInTheDocument();
    expect(screen.getAllByText('yuki').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /open invite in onyx/i })).toHaveAttribute(
      'href',
      '/app?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki',
    );
  });

  it('sets invite-specific metadata', () => {
    window.history.pushState({}, '', '/invite?join=%23root');

    render(() => <InviteRoute />);

    expect(document.title).toBe('Join #root on IRCXNet');
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'Join #root on IRCXNet',
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toContain(
      '/invite?join=%23root',
    );
  });
});
