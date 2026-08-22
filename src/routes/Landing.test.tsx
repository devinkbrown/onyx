// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@solidjs/testing-library';
import Landing from './Landing';

describe('Landing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses PublicFrame as the only document frame and exposes its skip target', () => {
    const { container, getByRole, getByText } = render(() => <Landing />);
    expect(getByRole('banner')).toBeInTheDocument();
    expect(getByRole('main', { name: 'Onyx home' })).toHaveAttribute('id', 'public-main');
    expect(getByRole('contentinfo')).toBeInTheDocument();
    expect(getByText('Skip to content')).toHaveAttribute('href', '#public-main');
    expect(getByRole('link', { name: 'Onyx home' })).toHaveAttribute('aria-current', 'page');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.home')).toBeTruthy();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Community\s*·\s*Home/);
  });

  it('opens with a community invitation and a single header Open Onyx', () => {
    const { getAllByRole, getByRole, container } = render(() => <Landing />);
    const openOnyx = getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(openOnyx[0]).toHaveClass('public-frame__open');
    expect(getByRole('heading', { level: 1 })).toHaveTextContent('A room for your people.');
    expect(container.querySelector('a.home-cta-primary')).toHaveAttribute('href', '/app/');
    expect(container.querySelector('a.home-cta-primary')).toHaveTextContent('Join free');
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/invite/?join=%23root');
    expect(container.querySelector('a.home-secondary-link')).toHaveTextContent('Invite someone');
    expect(container.textContent).toMatch(/Invite someone\. Join a room\. Talk\./);
  });

  it('derives public destination links from manifest hrefs', () => {
    const { container, getByRole } = render(() => <Landing />);
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/invite/?join=%23root');
    expect(getByRole('link', { name: /see what's happening/i })).toHaveAttribute('href', '/stats/');
    expect(getByRole('link', { name: /how the rooms work/i })).toHaveAttribute('href', '/about/');
  });

  it('keeps hosting extras below the fold in manifest destination order', () => {
    const { getByRole } = render(() => <Landing />);
    const shelf = getByRole('navigation', { name: 'Hosting and extras' });
    expect([...shelf.querySelectorAll('a')].map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }))).toEqual([
      { label: 'Status', href: '/status/' },
      { label: 'Stats', href: '/stats/' },
      { label: 'Roadmap', href: '/roadmap/' },
      { label: 'About', href: '/about/' },
      { label: 'Download', href: '/download/' },
      { label: 'Invite', href: '/invite/?join=%23root' },
    ]);
  });

  it('keeps the room preview static, stateful, and free of fabricated live activity', () => {
    const { getByRole, getByText, container } = render(() => <Landing />);
    const preview = container.querySelector('[data-product-preview]');
    expect(preview).toHaveAttribute('data-preview-state', 'room');
    expect(getByText(/not live rooms, people, messages/i)).toBeInTheDocument();
    expect(preview!.querySelector('.product-preview__roombar')?.textContent).toMatch(/Weekend plans/);
    expect(preview!.textContent).toMatch(/dinner/);
    fireEvent.keyDown(getByRole('tab', { name: 'Room' }), { key: 'ArrowRight' });
    expect(preview).toHaveAttribute('data-preview-state', 'home');
    expect(getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(preview!.textContent).not.toMatch(/mira|Room is open|12,482|CONNECT/i);
  });

  it('states only trust claims the rooms can stand behind', () => {
    const { container } = render(() => <Landing />);
    const trust = container.querySelector('[data-home-trust]');
    expect(trust).toHaveTextContent('No ads');
    expect(trust).toHaveTextContent('No third-party trackers');
    expect(trust).toHaveTextContent('Private DMs');
    expect(trust).toHaveTextContent('History on your device');
    expect(container.textContent).not.toMatch(/fully encrypted|group E2EE|passkey|Discord-killer|nobody.s product|Open engine/i);
  });

  it('does not put an operator evidence desk or unavailable telemetry on Home', () => {
    const { container, queryByRole } = render(() => <Landing />);
    expect(container.querySelector('[data-home-evidence]')).toBeNull();
    expect(container.querySelector('[data-ui="proof-receipt"]')).toBeNull();
    expect(queryByRole('status')).toBeNull();
    expect(container.textContent).not.toMatch(/unavailable|quorum|no stats export|mesh|node|IRC|SHA-256|Onyx is on/i);
  });

  it('never mentions OnyxOS in the public home story', () => {
    const { container, queryByRole } = render(() => <Landing />);
    expect(container.textContent).not.toMatch(/onyxos/i);
    expect(container.querySelector('a[href="/onyxos/"], a[href="/onyxos"]')).toBeNull();
    expect(queryByRole('link', { name: 'OnyxOS' })).toBeNull();
  });

  it('keeps mobile navigation as a semantic, keyboard-operable disclosure', () => {
    const { getByRole } = render(() => <Landing />);
    const toggle = getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    toggle.click();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
