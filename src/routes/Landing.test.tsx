// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import Landing from './Landing';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));

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
    expect(container.querySelector('.public-frame__context')).toBeNull();
    expect(container.querySelector('[data-testid="public-atmosphere"]')).toBeTruthy();
  });

  it('keeps leftover ground nodes from painting over the shared scene', () => {
    const landingCss = readFileSync(resolve(__dirname, 'landing.css'), 'utf8');
    const homeCss = readFileSync(resolve(__dirname, 'home.css'), 'utf8');
    expect(landingCss).toMatch(/\.r \{[^}]*background: transparent/);
    expect(landingCss).toMatch(/\.r-ground \{[^}]*background: transparent/);
    expect(homeCss).toMatch(/\.r-landing\.home \.r-ground\.home-ground \{\s*background: transparent;/);
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
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/download/');
    expect(container.querySelector('a.home-secondary-link')).toHaveTextContent('Download');
    expect(container.textContent).toMatch(/Invite someone\. Join a room\. Talk\./);
    expect(container.querySelector('.home-desktop-note')?.textContent).toMatch(
      /Supporting browsers can put Onyx on the Home Screen or in its own window\. No store\./,
    );
    expect(container.textContent).not.toMatch(/install Onyx as a PWA/i);
    expect(container.textContent).not.toMatch(/app store|play store|beforeinstallprompt|iOS push/i);
  });

  it('derives public destination links from manifest hrefs', () => {
    const { container, getByRole } = render(() => <Landing />);
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/download/');
    expect(getByRole('link', { name: /keep it here/i })).toHaveAttribute('href', '/download/');
    expect(getByRole('link', { name: /how the rooms work/i })).toHaveAttribute('href', '/about/');
  });

  it('keeps hosting extras below the fold in manifest destination order', () => {
    const { getByRole } = render(() => <Landing />);
    const shelf = getByRole('navigation', { name: 'Also here' });
    expect([...shelf.querySelectorAll('a')].map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }))).toEqual([
      { label: 'Status', href: '/status/' },
      { label: 'Roadmap', href: '/roadmap/' },
      { label: 'About', href: '/about/' },
      { label: 'Download', href: '/download/' },
      { label: 'Guides', href: '/guides/' },
      { label: 'Invite', href: '/invite/?join=%23root' },
    ]);
  });

  it('keeps the room preview static, stateful, and free of fabricated live activity', () => {
    const { getByRole, getByText, container } = render(() => <Landing />);
    const preview = container.querySelector('[data-product-preview]');
    expect(preview).toHaveAttribute('data-preview-state', 'room');
    expect(getByText('Preview')).toBeInTheDocument();
    expect(preview!.textContent).toMatch(/labeled conversation/i);
    expect(preview!.querySelector('.product-preview__roombar')?.textContent).toMatch(/Weekend plans/);
    expect(preview!.textContent).toMatch(/dinner/);
    const roomTab = getByRole('tab', { name: 'Room' });
    roomTab.focus();
    fireEvent.keyDown(roomTab, { key: 'ArrowRight' });
    expect(preview).toHaveAttribute('data-preview-state', 'home');
    const homeTab = getByRole('tab', { name: 'Home' });
    expect(homeTab).toHaveAttribute('aria-selected', 'true');
    expect(preview!.textContent).not.toMatch(/mira|Room is open|12,482|CONNECT/i);
  });

  it('keeps preview tabs at a usable target size with visible focus and forced-color selection', async () => {
    const homeCss = readFileSync(resolve(__dirname, 'home.css'), 'utf8');
    const { getByRole } = render(() => <Landing />);
    const roomTab = getByRole('tab', { name: 'Room' });
    roomTab.focus();
    fireEvent.keyDown(roomTab, { key: 'ArrowRight' });

    await waitFor(() => expect(getByRole('tab', { name: 'Home' })).toHaveFocus());
    expect(homeCss).toContain('min-height: var(--target-min, 44px)');
    expect(homeCss).toContain('.product-preview__tabs button:focus-visible');
    expect(homeCss).toContain(".product-preview__tabs button[aria-selected='true']");
  });

  it('states only trust claims the rooms can stand behind', () => {
    const { container } = render(() => <Landing />);
    const trust = container.querySelector('[data-home-trust]');
    expect(trust).toHaveTextContent('No ads');
    expect(trust).toHaveTextContent('No third-party trackers');
    expect(trust).toHaveTextContent('Private DMs');
    expect(trust).toHaveTextContent('History on this device');
    expect(container.textContent).not.toMatch(/fully encrypted|group E2EE|passkey|Discord-killer|nobody.s product|cloud history/i);
  });

  it('uses the locked mark and mascot without naming the seal', () => {
    const { container } = render(() => <Landing />);
    expect(container.querySelector('.public-frame__mark')?.getAttribute('src')).toBe('/brand/mark.png');
    expect(container.querySelector('.public-frame__lockup')?.getAttribute('src')).toBe('/brand/lockup.png');
    expect(container.querySelector('.public-frame__wordmark')?.getAttribute('src')).toBe('/brand/wordmark.png');
    expect(container.querySelector('img.home-mascot')?.getAttribute('src')).toBe('/brand/mascot-transparent.png');
    expect(container.querySelector('.home-mascot-scene img.home-mascot')).toBeInTheDocument();
    expect(container.querySelector('.home-mascot-wake')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('img.home-mascot')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Pebble/i);
    expect(container.textContent).not.toMatch(/Meet Pebble/i);
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
