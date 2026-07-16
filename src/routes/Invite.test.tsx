// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import InviteRoute from './Invite';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InviteRoute', () => {
  it('renders a rich invite from query params and hands off to the app', () => {
    window.history.pushState({}, '', '/invite?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release%20train&reader=1&as=yuki');

    render(() => <InviteRoute />);

    expect(screen.getByRole('heading', { name: /join\s+#general/i })).toBeInTheDocument();
    expect(screen.getByText('Onyx')).toBeInTheDocument();
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
    window.history.pushState({}, '', '/invite?join=%23general');
    render(() => <InviteRoute />);

    const copy = screen.getByRole('button', { name: 'Copy invite link' });
    expect(writeClipboardText).not.toHaveBeenCalled();
    fireEvent.click(copy);
    fireEvent.click(copy);

    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Invite link copied to clipboard.')).not.toBeInTheDocument();
    resolveCopy(true);
    expect(await screen.findByText('Invite link copied to clipboard.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Copied invite' })).not.toBeDisabled();
  });

  it('keeps truthful failure feedback when no clipboard pathway succeeds', async () => {
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    render(() => <InviteRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Copy failed');
    expect(screen.queryByRole('button', { name: 'Copied invite' })).not.toBeInTheDocument();
  });

  it('ignores a clipboard completion delivered after the invite route unmounts', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    const view = render(() => <InviteRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    view.unmount();
    resolveCopy(true);
    await pending;
    await Promise.resolve();

    expect(screen.queryByText('Invite link copied to clipboard.')).not.toBeInTheDocument();
  });
});
