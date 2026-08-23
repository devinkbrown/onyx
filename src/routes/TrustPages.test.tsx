// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@solidjs/testing-library';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));
import {
  HOUSE_RULES,
  TRUST_PAGE_META,
  TrustPage,
  resolveTrustPage,
  type TrustPageId,
} from './TrustPages';

const PRIMARY_LINKS = [
  ['About', '/about/'],
  ['Download', '/download/'],
] as const;

const FORBIDDEN = /fully encrypted|we cannot read your messages|group E2EE is live|passkeys? as anonymous|Discord killer|military-grade|cloud history|arbitration|liability cap|mailto:/i;

const PAGES = ['privacy', 'guidelines', 'contact'] as const satisfies readonly TrustPageId[];

describe.each(PAGES)('TrustPages /$page/', (page) => {
  const meta = TRUST_PAGE_META[page];

  it('uses PublicFrame as its only document frame', () => {
    const { container } = render(() => <TrustPage page={page} />);

    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('nav')).toHaveLength(2);
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(screen.getByRole('main', { name: meta.mainLabel })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('heading', { level: 1, name: meta.heading })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(container.textContent).not.toMatch(/Pebble/i);
    expect(container.textContent).not.toMatch(/Anton|neon/i);
  });

  it('keeps trust pages out of primary navigation', () => {
    render(() => <TrustPage page={page} />);
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primary).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(PRIMARY_LINKS.map(([label, href]) => [label, href]));
    expect(within(primary).queryByRole('link', { name: meta.kicker })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Onyx' })).toHaveAttribute('href', '/app/');
  });

  it('stamps canonical metadata for its own path', () => {
    render(() => <TrustPage page={page} />);
    expect(document.title).toBe(meta.title);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${window.location.origin}/${page}/`,
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', meta.description);
  });
});

describe('Trust page facts', () => {
  it('admits only the allowlisted trust paths', () => {
    expect(['/privacy/', '/privacy', '/guidelines/', '/contact/'].map(resolveTrustPage))
      .toEqual(['privacy', 'privacy', 'guidelines', 'contact']);
    expect(() => resolveTrustPage('/terms/')).toThrow(/allowlisted/);
    expect(() => resolveTrustPage('/rules/')).toThrow(/allowlisted/);
  });

  it('states privacy facts without an invented mailbox or unreadability claim', () => {
    render(() => <TrustPage page="privacy" />);
    expect(screen.getByText(/about 400 recent messages per room/i)).toBeInTheDocument();
    expect(screen.getByText(/Group E2EE is not live/)).toBeInTheDocument();
    expect(screen.getByText(/does not sell your attention/)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact/');
    expect(document.body.textContent).not.toMatch(/we cannot read/i);
    expect(document.body.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('lists a short house-rules set with emergency honesty and no invented email', () => {
    render(() => <TrustPage page="guidelines" />);
    expect(HOUSE_RULES.length).toBeGreaterThanOrEqual(8);
    expect(HOUSE_RULES.length).toBeLessThanOrEqual(12);
    expect(screen.getByText(/Onyx is not 911/)).toBeInTheDocument();
    expect(screen.getByText(/We can disable accounts or rooms/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SECURITY.md' })).toHaveAttribute(
      'href',
      'https://github.com/devinkbrown/onyx/blob/onyx-solid/SECURITY.md',
    );
    expect(document.body.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('points contact at GitHub and leaves security.txt mailbox as a TODO', () => {
    const { container } = render(() => <TrustPage page="contact" />);
    expect(screen.getByRole('link', { name: 'devinkbrown/onyx' })).toHaveAttribute(
      'href',
      'https://github.com/devinkbrown/onyx',
    );
    expect(container.textContent).toMatch(/no contact email/i);
    expect(document.body.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
