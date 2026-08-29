// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));
import {
  GUIDE_HOWTOS,
  GUIDE_PAGE_META,
  Guides,
  resolveGuidesSurface,
  type GuidesSurface,
} from './Guides';
import { GUIDE_PROGRESS_STORAGE_KEY } from '@/lib/guides/progress';
import * as clipboard from '@/lib/clipboard/writeClipboardText';

const PRIMARY_LINKS = [
  ['About', '/about/'],
  ['Download', '/download/'],
] as const;

const FORBIDDEN = /mIRC|\bmirc\b|IRCv3|\bIRC\b|Discord killer|\bmesh\b|handshake|claim path|group E2EE live|passkey as/i;

const SURFACES = ['guides', 'community'] as const satisfies readonly GuidesSurface[];

afterEach(() => {
  localStorage.removeItem(GUIDE_PROGRESS_STORAGE_KEY);
  vi.restoreAllMocks();
});

describe.each(SURFACES)('Guides /$surface/', (surface) => {
  const meta = GUIDE_PAGE_META[surface];

  it('uses PublicFrame as its only document frame', () => {
    const { container } = render(() => <Guides surface={surface} />);

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
  });

  it('names its main landmark and stays out of the primary navigation', () => {
    render(() => <Guides surface={surface} />);

    expect(screen.getByRole('main', { name: meta.mainLabel })).toHaveAttribute('id', 'public-main');

    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = within(primary).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(PRIMARY_LINKS.map(([label, href]) => [label, href]));
    expect(links.filter((link) => link.hasAttribute('aria-current'))).toHaveLength(0);
    expect(within(primary).queryByRole('link', { name: 'Guides' })).toBeNull();
    expect(primary.querySelector(`a[href="/${surface}/"]`)).toBeNull();
  });

  it('teaches the official app, not another chat program', () => {
    const { container } = render(() => <Guides surface={surface} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Getting started' })).toBeInTheDocument();
    expect(screen.getByText(/Friends, clubs, rooms/)).toBeInTheDocument();
    expect(screen.getByText(/official app/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(container.textContent).not.toMatch(/Anton|neon/i);
    expect(screen.queryByRole('heading', { name: /WeeChat|irssi|mIRC/i })).toBeNull();
    const optional = container.querySelector('.guides-card--optional');
    expect(optional?.textContent).toMatch(/WeeChat/);
    expect(optional?.textContent).toMatch(/irssi/);
  });

  it('keeps the how-tos in newcomer order with another client last', () => {
    render(() => <Guides surface={surface} />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      'One small step at a time',
      'Be kind, then talk',
      ...GUIDE_HOWTOS.map((howto) => howto.title),
    ]);
    expect(headings.at(-1)).toBe('Another client, or your own server');

    expect(screen.getByRole('heading', { name: 'Join a room' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite a friend' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messages and private DMs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Calls when you want them' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keep it on this device' })).toBeInTheDocument();

    const messagesCard = screen.getByRole('heading', { name: 'Messages and private DMs' }).closest('article');
    expect(messagesCard).not.toBeNull();
    expect(within(messagesCard as HTMLElement).getByText(/Direct messages are one-to-one/)).toBeInTheDocument();
    expect(within(messagesCard as HTMLElement).getByText(/can be private/)).toBeInTheDocument();
    expect(within(messagesCard as HTMLElement).getByText(/Group rooms are not end-to-end encrypted/)).toBeInTheDocument();
    expect(screen.getByText(/Passkeys are not the everyday way to sign in/)).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.getByText(/usual way in/)).toBeInTheDocument();
  });

  it('hands off to the official app and invite door without a second Open Onyx', () => {
    const { container } = render(() => <Guides surface={surface} />);

    const join = screen.getAllByRole('link', { name: 'Join a room' });
    expect(join.length).toBeGreaterThanOrEqual(1);
    expect(join[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('link', { name: 'Open the public room' })).toHaveAttribute(
      'href',
      '/app/?join=%23root',
    );
    expect(screen.getByRole('link', { name: 'Open an invite' })).toHaveAttribute('href', '/invite/');

    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' })
      .filter((link) => link.classList.contains('public-frame__open'));
    expect(openOnyx).toHaveLength(1);
    expect(container.querySelectorAll('a.public-frame__open')).toHaveLength(1);
  });

  it('stamps canonical metadata for its own path', () => {
    render(() => <Guides surface={surface} />);

    expect(document.title).toBe(meta.title);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${window.location.origin}/${surface}/`,
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      meta.description,
    );
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <Guides surface={surface} />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });

    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('turns the newcomer order into a local, resettable first-room plan', () => {
    localStorage.removeItem(GUIDE_PROGRESS_STORAGE_KEY);
    render(() => <Guides surface={surface} />);

    expect(screen.getByRole('heading', { name: 'One small step at a time' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Guide plan progress' })).toHaveAttribute('value', '0');
    expect(screen.getByRole('link', { name: 'Go to: Join a room' })).toHaveAttribute('href', '#join');
    const route = screen.getByRole('list', { name: 'First room route' });
    const routeLinks = within(route).getAllByRole('link');
    expect(routeLinks.map((link) => link.getAttribute('href'))).toEqual([
      '#join',
      '#invite',
      '#messages',
      '#calls',
      '#this-device',
    ]);
    expect(route.querySelector('[aria-current="step"]')).toHaveAttribute('href', '#join');
    expect(route.querySelector('[data-state="later"]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy and safety, at a glance' })).toBeInTheDocument();
    expect(screen.getByText('Calls are opt-in and are not recorded.')).toBeInTheDocument();

    const join = screen.getByRole('button', { name: 'Mark Join a room complete' });
    fireEvent.click(join);
    expect(join).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('progressbar', { name: 'Guide plan progress' })).toHaveAttribute('value', '1');
    expect(screen.getByRole('link', { name: 'Go to: Invite a friend' })).toHaveAttribute('href', '#invite');
    expect(localStorage.getItem(GUIDE_PROGRESS_STORAGE_KEY)).toBe(JSON.stringify(['join']));
    expect(route.querySelector('[aria-current="step"]')).toHaveAttribute('href', '#invite');
    expect(route.querySelector('[data-state="done"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset plan' }));
    expect(screen.getByRole('progressbar', { name: 'Guide plan progress' })).toHaveAttribute('value', '0');
    expect(screen.getByRole('button', { name: 'Mark Join a room complete' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('creates a local-only first-room handoff for copy or text download', async () => {
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    render(() => <Guides surface={surface} />);

    const download = screen.getByRole('link', { name: 'Download text' });
    expect(download).toHaveAttribute('download', 'onyx-first-room-plan.txt');
    expect(download.getAttribute('href')).toMatch(/^data:text\/plain;charset=utf-8,/);

    fireEvent.click(screen.getByRole('button', { name: 'Copy first-room plan' }));

    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith(expect.stringContaining('Onyx first-room plan'));
    });
    expect(writeClipboardText).toHaveBeenCalledWith(expect.stringContaining('This plan is not sent anywhere.'));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Plan share status' }))
        .toHaveTextContent('First-room plan copied. It was created here and nothing was sent.');
    });
    expect(localStorage.getItem(GUIDE_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('keeps the local boundary explicit when copying cannot complete', async () => {
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    render(() => <Guides surface={surface} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy first-room plan' }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Plan share status' }))
        .toHaveTextContent('Copy did not complete. Download the text instead; nothing was sent.');
    });
  });

  it('restores only the supported guide steps from this browser', () => {
    localStorage.setItem(GUIDE_PROGRESS_STORAGE_KEY, JSON.stringify(['join', 'unknown']));
    render(() => <Guides surface={surface} />);

    expect(screen.getByRole('progressbar', { name: 'Guide plan progress' })).toHaveAttribute('value', '1');
    expect(screen.getByRole('button', { name: 'Mark Join a room not complete' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark Invite a friend complete' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Guides route family', () => {
  it('admits the leftover overlay URLs as the same getting-started surface', () => {
    expect(['/guides/', '/guides', '/community/', '/community'].map(resolveGuidesSurface))
      .toEqual(['guides', 'guides', 'community', 'community']);
    expect(() => resolveGuidesSurface('/guides/weechat/')).toThrow(/allowlisted/);
    expect(() => resolveGuidesSurface('/unknown/')).toThrow(/allowlisted/);
  });

  it('puts Guides in the footer so a cold visitor can reach the page', () => {
    render(() => <Guides surface="guides" />);
    const footer = screen.getByRole('navigation', { name: 'Footer navigation' });
    expect(within(footer).getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides/');
  });
});
