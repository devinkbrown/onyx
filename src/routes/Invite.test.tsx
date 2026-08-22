// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import InviteRoute from './Invite';

const src = readFileSync(resolve(__dirname, 'Invite.tsx'), 'utf8');

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('InviteRoute', () => {
  it('uses PublicFrame as the only document frame and keeps Invite out of primary navigation', () => {
    const { container } = render(() => <InviteRoute />);

    expect(src).toContain("import { PublicFrame } from '@/ui/public'");
    expect(src).toContain('currentPath="/invite/"');
    expect(src).toContain('mainLabel="Onyx invite"');
    expect(src).toContain('class="ui-root r invite-page"');
    expect(src).not.toContain('<PublicFooter');
    expect(src).not.toContain('<header');
    expect(src).not.toContain('<main');
    expect(src).not.toContain('r-status');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Onyx invite' })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.invite-page')).toBeTruthy();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Friends.*Invite/);
    expect(container.querySelector('.r-ground')).toBeTruthy();
    expect(container.querySelector('.r-flecks')).toBeTruthy();
    expect(container.querySelector('.r-veins')).toBeTruthy();
    expect(container.querySelector('.r-grain')).toBeTruthy();
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primary).getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/invite/');
    expect(within(primary).getByRole('link', { name: 'Join' })).toHaveAttribute('aria-current', 'page');
    expect(within(primary).queryByRole('link', { name: 'Status' })).toBeNull();
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' })
      .filter((link) => link.classList.contains('public-frame__open'));
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('link', { name: 'How Onyx works' })).toHaveAttribute('href', '/about/');
    expect(container.querySelector('.invite-page a[href="/guides/"]')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides/');
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <InviteRoute />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('renders a warm room preview with display name and Join', () => {
    window.history.pushState({}, '', '/invite/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release%20train&reader=1&as=yuki');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join #general' })).toBeInTheDocument();
    expect(screen.getByText('Choose a display name to enter this room.')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Invite preview' })).toHaveTextContent('Join #general on Onyx');
    expect(screen.getByRole('note', { name: 'Invite preview' })).toHaveTextContent('release train');
    expect(screen.getByLabelText('Display name')).toHaveValue('yuki');
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      '/app/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki',
    );
    expect(screen.queryByText(/handoff receipt|room ledger|claim a name|open graph|handshake|claim path/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bmesh\b|\bIRC\b|\bMODE\b/)).not.toBeInTheDocument();
  });

  it('renders a bare invite as a network-only preview and hands off without a phantom room', () => {
    window.history.pushState({}, '', '/invite/');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Onyx' })).toBeInTheDocument();
    expect(screen.getByText('Choose a display name, then pick a room once you are in.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/app/');
    expect(screen.queryByText(/#root|#general/)).not.toBeInTheDocument();
  });

  it('rejects an invalid join token instead of reflecting it', () => {
    window.history.pushState({}, '', '/invite/?join=%23bad%2Cevil');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Onyx' })).toBeInTheDocument();
    expect(screen.queryByText(/evil/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/app/');
  });

  it('carries a typed display name into the existing join link', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    render(() => <InviteRoute />);

    fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'River' } });

    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      '/app/?join=%23lounge&as=River',
    );
  });

  it('sets invite-specific metadata', () => {
    window.history.pushState({}, '', '/invite/?join=%23root&ignored=noise#local-fragment');

    render(() => <InviteRoute />);

    expect(document.title).toBe('Join #root on Onyx');
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'Join #root on Onyx',
    );
    const expectedUrl = `${window.location.origin}/invite/?join=%23root`;
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(expectedUrl);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(expectedUrl);
  });

  it('announces copy success only after the shared clipboard write resolves', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    window.history.pushState({}, '', '/invite/?join=%23general');
    render(() => <InviteRoute />);

    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(writeClipboardText).not.toHaveBeenCalled();
    fireEvent.click(copy);
    fireEvent.click(copy);

    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Invite link copied to clipboard.')).not.toBeInTheDocument();
    resolveCopy(true);
    expect(await screen.findByText('Invite link copied to clipboard.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Copied link' })).not.toBeDisabled();
  });

  it('keeps truthful failure feedback when no clipboard pathway succeeds', async () => {
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    render(() => <InviteRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Copy failed');
    expect(screen.queryByRole('button', { name: 'Copied link' })).not.toBeInTheDocument();
  });

  it('ignores a clipboard completion delivered after the invite route unmounts', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    const view = render(() => <InviteRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    view.unmount();
    resolveCopy(true);
    await pending;
    await Promise.resolve();

    expect(screen.queryByText('Invite link copied to clipboard.')).not.toBeInTheDocument();
  });
});
