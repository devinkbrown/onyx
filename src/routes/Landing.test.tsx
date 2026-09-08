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

  it('keeps the shared scene host transparent while the home surface is opaque', () => {
    const landingCss = readFileSync(resolve(__dirname, 'landing.css'), 'utf8');
    const homeCss = readFileSync(resolve(__dirname, 'home.css'), 'utf8');
    expect(landingCss).toMatch(/\.r \{[^}]*background: transparent/);
    expect(landingCss).toMatch(/\.r-ground,\s*\.r-flecks,\s*\.r-veins,\s*\.r-grain \{[\s\S]*background: transparent/);
    expect(homeCss).toMatch(/\.r-landing\.home[\s\S]*background: var\(--home-void\)/);
    expect(homeCss).toMatch(/\.public-frame__main:has\(> \.r-landing\.home\)[\s\S]*width: 100%[\s\S]*max-width: none/);
  });

  it('opens with the ULTRA invitation and consistent header and hero handoffs', () => {
    const { getByRole, container } = render(() => <Landing />);
    const headerOpenOnyx = container.querySelector('a.public-frame__open')!;
    const heroOpenOnyx = container.querySelector('a.home-cta-primary')!;
    expect(headerOpenOnyx).toHaveTextContent('Open Onyx');
    expect(headerOpenOnyx).toHaveAttribute('href', '/app/');
    expect(heroOpenOnyx).toHaveTextContent('Open Onyx');
    expect(heroOpenOnyx).toHaveAttribute('href', '/app/');
    expect(container.querySelectorAll('a.home-cta-primary')).toHaveLength(1);
    expect(getByRole('heading', { level: 1 })).toHaveTextContent('Good company. Great nights.');
    expect(container.querySelector('.home-hero-grid')).toBeTruthy();
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/invite/?join=%23root');
    expect(container.querySelector('a.home-secondary-link')).toHaveTextContent('See the public room');
    expect(container).toHaveTextContent('A place for your friends to talk, play, and catch up. Open a room in your browser.');
    expect(container.querySelector('.home-device-note')?.textContent).toMatch(
      /Browser first\. Keep it on this device from a supporting browser/,
    );
  });

  it('keeps the hero scene, trust, and community passage in argument order', () => {
    const { container } = render(() => <Landing />);
    const hero = container.querySelector('.home-hero')!;
    const trust = container.querySelector('[data-home-trust]')!;
    const community = container.querySelector('[data-home-room-board]')!;
    expect(hero.contains(container.querySelector('[data-product-preview]'))).toBe(true);
    expect(hero.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trust.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.home-current, .home-modes, .home-room-board__map')).toBeNull();
  });

  it('keeps the room preview static, social, and keyboard-operable', async () => {
    const { getByRole, getByText, container } = render(() => <Landing />);
    const preview = container.querySelector('[data-product-preview]')!;
    expect(preview).toHaveAttribute('data-preview-state', 'room');
    expect(getByText('Fictional game-night preview')).toBeInTheDocument();
    expect(preview).toHaveTextContent('Not a live room');
    expect(preview).toHaveTextContent('One more round?');
    expect(preview).toHaveTextContent('Give me five minutes.');
    expect(preview).toHaveTextContent('I’ll meet you in voice.');
    expect(preview.querySelector('.home-mascot-scene')).toBeInTheDocument();
    expect(preview.querySelectorAll('img.home-mascot')).toHaveLength(1);

    const roomTab = getByRole('tab', { name: 'Room' });
    roomTab.focus();
    fireEvent.keyDown(roomTab, { key: 'ArrowRight' });
    await waitFor(() => expect(getByRole('tab', { name: 'Home' })).toHaveFocus());
    expect(preview).toHaveAttribute('data-preview-state', 'home');
    expect(getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(preview).not.toHaveTextContent(/12,482|CONNECT|Room is open/);
  });

  it('derives public destination links from manifest hrefs', () => {
    const { container, getByRole } = render(() => <Landing />);
    expect(container.querySelector('a.home-cta-primary')).toHaveAttribute('href', '/app/');
    expect(container.querySelector('a.home-secondary-link')).toHaveAttribute('href', '/invite/?join=%23root');
    expect(getByRole('link', { name: /see device options/i })).toHaveAttribute('href', '/download/');
    expect(getByRole('link', { name: 'the privacy details' })).toHaveAttribute('href', '/privacy/');
    expect(getByRole('link', { name: 'Getting started' })).toHaveAttribute('href', '/guides/');
  });

  it('keeps extras below the scene in manifest destination order', () => {
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

  it('states only trust claims the rooms can stand behind', () => {
    const { container } = render(() => <Landing />);
    const trust = container.querySelector('[data-home-trust]')!;
    expect(trust).toHaveTextContent('No ads');
    expect(trust).toHaveTextContent('No third-party trackers');
    expect(trust).toHaveTextContent('Private DMs');
    expect(trust).toHaveTextContent('History on this device');
    expect(container.textContent).not.toMatch(/fully encrypted|group E2EE|passkey|Discord-killer|cloud history/i);
  });

  it('uses the locked mark and integrates the mascot into the scene once', () => {
    const { container } = render(() => <Landing />);
    expect(container.querySelector('.public-frame__mark')?.getAttribute('src')).toBe('/brand/mark.png');
    expect(container.querySelector('.public-frame__lockup')?.getAttribute('src')).toBe('/brand/lockup.png');
    expect(container.querySelector('.public-frame__wordmark')?.getAttribute('src')).toBe('/brand/wordmark.png');
    expect(container.querySelector('.home-mascot-scene img.home-mascot')).toBeInTheDocument();
    expect(container.querySelector('.home-mascot-scene')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('img.home-mascot')).toHaveLength(1);
    expect(container.querySelector('.home-hero-mark')).toBeNull();
    expect(container.textContent).not.toMatch(/Pebble|Meet Pebble/i);
  });

  it('does not put operator evidence or unavailable telemetry on Home', () => {
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
