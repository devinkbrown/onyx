// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import RoadmapRoute, {
  focusRoadmapPriority,
  RoadmapBridge,
  roadmapPriorityFromHash,
} from './Roadmap';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));

const src = readFileSync(resolve(__dirname, 'Roadmap.tsx'), 'utf8');
const css = readFileSync(resolve(__dirname, 'roadmap.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

function footerLinks() {
  return [...screen.getByRole('navigation', { name: 'Footer navigation' }).querySelectorAll('a')]
    .map((link) => ({ label: link.textContent, href: link.getAttribute('href') }));
}

describe('RoadmapRoute — community copy', () => {
  it('talks about rooms, calls, catch-up, and Home Screen — not OnyxOS', () => {
    expect(src).toContain('Rooms, calls, catch-up, and a Home Screen.');
    expect(src).toContain('Rooms that stay open');
    expect(src).toContain('Calls and catch-up');
    expect(src).toContain('Home Screen on this device');
    expect(src).not.toMatch(/onyxos/i);
    expect(src).not.toMatch(/Proof before promise/i);
    expect(src).not.toMatch(/Evidence gated/i);
    expect(src).not.toMatch(/IRCv3|IRCX|protocol|vault|crypto kernel/i);
    expect(src).not.toMatch(/fully encrypted|group E2EE|passkeys?/i);
    expect(src).not.toMatch(/href="\/terms\/"/);
    expect(src).not.toMatch(/href="\/stats\/"/);
  });

  it('keeps quiet-harbor type: Instrument Sans, Fraunces once, no Anton or glass', () => {
    expect(css).toContain('var(--font-sans)');
    expect((css.match(/var\(--font-serif\)/g) ?? []).length).toBe(1);
    expect(cssNoComments).not.toMatch(/Anton|Inter|purple|blurple|#5865[Ff]2/i);
    expect(cssNoComments).not.toContain('backdrop-filter');
    expect(cssNoComments).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).toContain('var(--target-min, 44px)');
  });
});

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
    expect(container.querySelector('.public-frame__context'))
      .toHaveTextContent(/What is next\s*·\s*Rooms, calls, catch-up/);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'Roadmap' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'Stats' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(footerLinks()).toEqual([
      { label: 'House rules', href: '/guidelines/' },
      { label: 'Privacy', href: '/privacy/' },
      { label: 'Contact', href: '/contact/' },
      { label: 'Status', href: '/status/' },
      { label: 'Guides', href: '/guides/' },
    ]);
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'Roadmap' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'Stats' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(container.querySelector('a[href="/stats/"], a[href="/stats"]')).toBeNull();
    expect(container.querySelector('a[href="/onyxos/"], a[href="/onyxos"]')).toBeNull();
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { name: /rooms, calls, catch-up, and a Home Screen/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Roadmap state legend' })).toBeInTheDocument();
    expect(screen.queryByText(/Proof before promise/i)).toBeNull();
    expect(screen.queryByText(/OnyxOS/i)).toBeNull();
  });

  it('turns the state legend into a keyboard-navigable sequence of priorities', () => {
    render(() => <RoadmapBridge />);
    const legend = screen.getByRole('group', { name: 'Roadmap state legend' });
    const sequence = [
      ['now', 'Rooms that stay open'],
      ['next', 'Calls and catch-up'],
      ['later', 'Home Screen on this device'],
    ] as const;

    for (const [state, title] of sequence) {
      const link = within(legend).getByRole('link', { name: new RegExp(`^${state}$`, 'i') });
      const card = document.querySelector(`#roadmap-${state}`);
      expect(link).toHaveAttribute('href', `#roadmap-${state}`);
      expect(card).toHaveAttribute(
        'aria-labelledby',
        `roadmap-${state}-title`,
      );
      expect(card).toHaveAttribute('tabindex', '-1');
      expect(document.querySelector(`#roadmap-${state}-title`)).toHaveTextContent(title);
    }
  });

  it('syncs an anchored priority into the current reading path', async () => {
    const previous = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', '/roadmap/#roadmap-next');
    try {
      render(() => <RoadmapBridge />);
      const next = screen.getByRole('link', { name: 'Next' });
      const nextCard = document.getElementById('roadmap-next');
      await waitFor(() => expect(next).toHaveAttribute('aria-current', 'location'));
      expect(nextCard).toHaveAttribute('data-current', 'true');
    } finally {
      window.history.replaceState(null, '', previous || '/');
    }
  });

  it('moves focus to the selected priority after an ordinary legend click', async () => {
    render(() => <RoadmapBridge />);
    const later = screen.getByRole('link', { name: 'Later' });
    const laterCard = document.getElementById('roadmap-later');
    fireEvent.click(later);

    await waitFor(() => expect(laterCard).toHaveFocus());
    expect(later).toHaveAttribute('aria-current', 'location');
    expect(laterCard).toHaveAttribute('data-current', 'true');
  });

  it('accepts only the three roadmap hashes and ignores a missing focus target', () => {
    expect(roadmapPriorityFromHash('#roadmap-now')).toBe('now');
    expect(roadmapPriorityFromHash('roadmap-next')).toBe('next');
    expect(roadmapPriorityFromHash('#roadmap-later')).toBe('later');
    expect(roadmapPriorityFromHash('#roadmap-unplanned')).toBeNull();
    expect(() => focusRoadmapPriority(null)).not.toThrow();
  });

  it('stamps community metadata', () => {
    render(() => <RoadmapRoute />);
    expect(document.title).toBe('Onyx roadmap — rooms, calls, catch-up');
  });

  it('shows the community sequence without protocol jargon', () => {
    render(() => <RoadmapBridge />);

    expect(screen.getByRole('heading', { name: /rooms that stay open/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /calls and catch-up/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Home Screen on this device/i })).toBeInTheDocument();
    expect(screen.queryByText(/IRCv3|IRCX/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /bring Onyx into OnyxOS/i })).toBeNull();
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

  it('keeps selected priority markers visible in forced colors', () => {
    expect(css).toContain(".roadmap-legend a[aria-current='location']");
    expect(css).toContain(".roadmap-card[data-current='true']");
    expect(css).toContain('@media (forced-colors: active)');
  });
});
