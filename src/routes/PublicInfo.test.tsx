// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { PublicInfo, resolvePublicInfoPage, type PublicInfoPage } from './PublicInfo';

/** Manifest order for the shared primary navigation. */
const PRIMARY_LINKS = [
  ['About', '/about/'],
  ['Downloads', '/download/'],
  ['Status', '/status/'],
  ['Roadmap', '/roadmap/'],
  ['OnyxOS', '/onyxos/'],
] as const;

/**
 * The four supporting routes, pinned byte-for-byte. This copy is the public
 * contract these pages exist to state, so a reflow of the frame must never
 * quietly reword it.
 */
const PAGES = [
  {
    page: 'accessibility',
    mainLabel: 'Onyx accessibility',
    title: 'Accessibility',
    lede: 'Access is a product requirement.',
    body: 'Keyboard navigation, focus recovery, motion controls, contrast variants, and live-status announcements are tested in the client. Report a gap in #accessibility.',
  },
  {
    page: 'glossary',
    mainLabel: 'Onyx glossary',
    title: 'Glossary',
    lede: 'Words should make the network easier to use.',
    body: 'Onyx is the network and client. Onyx Server is the engine. Cadence is the media system. Mooring is the secured peer channel.',
  },
  {
    page: 'integrations',
    mainLabel: 'Onyx integrations',
    title: 'Integrations',
    lede: 'Useful actions, constrained by design.',
    body: 'Onyx renders reviewed Block-Kit-lite content and uses capability-scoped action manifests. It never executes a message as a command.',
  },
  {
    page: 'agents',
    mainLabel: 'Onyx agent safety',
    title: 'Agent safety',
    lede: 'Automation has a boundary.',
    body: 'Agent-visible actions are reviewed, capability-scoped, and labelled with their source. Local data stays local unless you explicitly choose otherwise.',
  },
] as const satisfies readonly { page: PublicInfoPage; mainLabel: string; title: string; lede: string; body: string }[];

describe.each(PAGES)('PublicInfo /$page/', (route) => {
  it('uses PublicFrame as its only document frame', () => {
    const { container } = render(() => <PublicInfo page={route.page} />);

    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('nav')).toHaveLength(2); // primary + footer
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(container.querySelectorAll('main#public-main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer, main nav')).toBeNull();

    const skip = screen.getAllByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveLength(1);
    expect(skip[0]).toHaveAttribute('href', '#public-main');

    const disclosure = screen.getAllByRole('button', { name: 'Open navigation menu' });
    expect(disclosure).toHaveLength(1);
    expect(disclosure[0]).toHaveAttribute('aria-controls', 'public-primary-navigation');
  });

  it('names its main landmark for this page and keeps the body non-landmark', () => {
    const { container } = render(() => <PublicInfo page={route.page} />);

    expect(screen.getByRole('main', { name: route.mainLabel })).toHaveAttribute('id', 'public-main');

    const body = container.querySelector('.ui-root.r.data-page');
    expect(body).toBeTruthy();
    expect(body!.tagName).toBe('DIV');
    expect(body!.closest('main#public-main')).toBeTruthy();
  });

  it('stays out of the primary navigation and claims no current page', () => {
    render(() => <PublicInfo page={route.page} />);
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = within(primary).getAllByRole('link');

    expect(links.map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(PRIMARY_LINKS.map(([label, href]) => [label, href]));
    expect(links.filter((link) => link.hasAttribute('aria-current'))).toHaveLength(0);
    expect(within(primary).queryByRole('link', { name: route.title })).toBeNull();
    expect(primary.querySelector(`a[href="/${route.page}/"]`)).toBeNull();
  });

  it('states its public contract verbatim', () => {
    render(() => <PublicInfo page={route.page} />);

    expect(screen.getByRole('heading', { level: 1, name: route.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: route.title })).toBeInTheDocument();
    expect(screen.getByText('public contract')).toBeInTheDocument();
    expect(screen.getAllByText('Public contract')).toHaveLength(1);
    expect(screen.getByText('Onyx · public statement')).toBeInTheDocument();
    expect(screen.queryByText(/verified public statement/i)).not.toBeInTheDocument();
    expect(screen.getByText(route.lede)).toBeInTheDocument();
    expect(screen.getByText(route.body)).toBeInTheDocument();
    expect(document.querySelector('.public-frame__context')).toHaveTextContent(
      new RegExp(`Public contract\\s*·\\s*${route.title}`),
    );
  });

  it('stamps canonical metadata for its own path', () => {
    render(() => <PublicInfo page={route.page} />);

    expect(document.title).toBe(`Onyx — ${route.title}`);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${window.location.origin}/${route.page}/`,
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', route.lede);
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <PublicInfo page={route.page} />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });

    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});

describe('PublicInfo route family', () => {
  it('admits exactly the four explicit support route paths', () => {
    expect(['/accessibility/', '/glossary/', '/integrations/', '/agents/'].map(resolvePublicInfoPage))
      .toEqual(['accessibility', 'glossary', 'integrations', 'agents']);
    expect(() => resolvePublicInfoPage('/agents')).toThrow(/allowlisted/);
    expect(() => resolvePublicInfoPage('/unknown/')).toThrow(/allowlisted/);
  });

  it('derives currentPath and main label from the page alone', () => {
    for (const route of PAGES) {
      const { unmount } = render(() => <PublicInfo page={route.page} />);
      const primary = screen.getByRole('navigation', { name: 'Primary navigation' });

      // A support route never matches a primary destination, so no link is current.
      expect(primary.querySelector('[aria-current]')).toBeNull();
      expect(screen.getByRole('main', { name: route.mainLabel })).toBeInTheDocument();
      unmount();
    }
  });

  it('gives every support page a distinct main landmark name', () => {
    const labels = PAGES.map((route) => route.mainLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
