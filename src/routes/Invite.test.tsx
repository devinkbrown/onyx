// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import InviteRoute from './Invite';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));

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
    expect(within(primary).queryByRole('link', { name: 'Join' })).toBeNull();
    expect(within(primary).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about/');
    expect(within(primary).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/download/');
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

    expect(screen.getByRole('heading', { level: 1, name: '#general' })).toBeInTheDocument();
    expect(screen.getByText('Choose a display name to walk in.')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Invite preview' })).toHaveTextContent('Join #general on Onyx');
    expect(screen.getByRole('note', { name: 'Invite preview' })).toHaveTextContent('release train');
    expect(screen.getByText(/the room still applies its own access rules/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveValue('yuki');
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      '/app/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki',
    );
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/app/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki&signin=1',
    );
    expect(screen.queryByText(/handoff receipt|room ledger|claim a name|open graph|handshake|claim path/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bmesh\b|\bIRC\b|\bMODE\b/)).not.toBeInTheDocument();
  });

  it('renders a bare invite as a network-only preview and hands off without a phantom room', () => {
    window.history.pushState({}, '', '/invite/');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Onyx' })).toBeInTheDocument();
    expect(screen.getByText('Choose a display name, then pick a room once you are in.')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/app/');
    expect(screen.getByText(/This link does not name a room/)).toBeInTheDocument();
    expect(screen.queryByText(/#root|#general/)).not.toBeInTheDocument();
  });

  it('rejects an invalid join token instead of reflecting it', () => {
    window.history.pushState({}, '', '/invite/?join=%23bad%2Cevil');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Onyx' })).toBeInTheDocument();
    expect(screen.queryByText(/evil/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/app/');
  });

  it('carries a typed display name into the existing join link', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    render(() => <InviteRoute />);

    fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'River' } });

    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      '/app/?join=%23lounge&as=River',
    );
  });

  it('keeps valid Join clicks native, including modified clicks', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    render(() => <InviteRoute />);
    fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'River' } });
    const join = screen.getByTestId('invite-join');
    const preventDefault = vi.spyOn(Event.prototype, 'preventDefault');

    fireEvent.click(join, { ctrlKey: true });

    expect(join).toHaveAttribute('href', '/app/?join=%23lounge&as=River');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByText(/name must start|contain only letters/i)).not.toBeInTheDocument();
  });

  it.each(['33alice', 'alice smith'])('blocks invalid Join click without navigation or as (%s)', (name) => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    render(() => <InviteRoute />);
    const input = screen.getByLabelText('Display name');
    fireEvent.input(input, { target: { value: name } });
    const join = screen.getByTestId('invite-join');
    const before = window.location.href;

    fireEvent.click(join);

    expect(window.location.href).toBe(before);
    expect(join).not.toHaveAttribute('href');
    expect(join.getAttribute('href') ?? '').not.toContain('as=');
    expect(input).toHaveFocus();
    expect(screen.getByText(/name must start|contain only letters/i)).toBeInTheDocument();
  });

  it('blocks invalid Enter submission without navigation or as', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    render(() => <InviteRoute />);
    const input = screen.getByLabelText('Display name');
    fireEvent.input(input, { target: { value: '33alice' } });
    const form = input.closest('form')!;
    const before = window.location.href;

    fireEvent.submit(form);

    expect(window.location.href).toBe(before);
    expect(screen.getByTestId('invite-join').getAttribute('href') ?? '').not.toContain('as=');
    expect(input).toHaveFocus();
    expect(screen.getByText(/start with a letter/i)).toBeInTheDocument();
  });

  it('hands off a valid Enter submission exactly once', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);
    render(() => <InviteRoute />);
    const input = screen.getByLabelText('Display name');
    fireEvent.input(input, { target: { value: 'River' } });

    fireEvent.submit(input.closest('form')!);

    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/app/?join=%23lounge&as=River');
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
    expect(document.querySelector('.invite-copy-status')).toHaveAttribute('role', 'status');
    expect(document.querySelector('.invite-copy-status')).toHaveTextContent('');
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

describe('Invite destination-to-join composition', () => {
  it('explains the destination before the join form and keeps Join as the guest lead', () => {
    window.history.pushState({}, '', '/invite/?join=%23lounge');
    const { container } = render(() => <InviteRoute />);
    const destination = container.querySelector('.invite-destination');
    const form = container.querySelector('.invite-form-panel');

    expect(destination).not.toBeNull();
    expect(form).not.toBeNull();
    expect(destination!.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.invite-mascot')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '#lounge' })).toBeInTheDocument();
    expect(within(form as HTMLElement).getByTestId('invite-join')).toHaveTextContent('Join');
    expect(within(form as HTMLElement).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/app/?join=%23lounge&signin=1',
    );
    expect(container.querySelector('.invite-copy-status')).toHaveAttribute('role', 'status');
  });

  it('keeps a malformed room unknown instead of reflecting it into the destination', () => {
    window.history.pushState({}, '', '/invite/?join=%23bad%2Cevil&topic=secret');
    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Onyx' })).toBeInTheDocument();
    expect(screen.getByText(/This link does not name a room/)).toBeInTheDocument();
    expect(screen.queryByText(/evil/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });
});
