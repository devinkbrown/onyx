// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSettings.test.tsx — per-channel Notifications control.
 *
 * Pins the personal notification-mode picker: it reflects the current stored
 * mode (reactively, via useStore + channelNotifyMode) and dispatches
 * setChannelNotifyMode on change. The picker is a personal preference, so it is
 * available to every member (no op gate) and applies immediately. AAA pattern.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { NotifyLevel } from '@/lib/notifications/channelNotifyMode';
import { ChannelSettings } from './ChannelSettings';

const initialState = store.getInitialState();

function makeChannel(name: string): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set() });
  return {
    name,
    topic: '',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seed(notify?: Map<string, NotifyLevel>): void {
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general'));
  store.setState(
    {
      ...initialState,
      channels,
      ourNick: 'me',
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      channelNotify: notify ?? new Map(),
    },
    true,
  );
}

function renderPanel() {
  return render(() => (
    <ChannelSettings channel="#general" open={true} onOpenChange={() => {}} />
  ));
}

function notifySelect(): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: /Notifications for #general/i,
  }) as HTMLSelectElement;
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChannelSettings — Notifications', () => {
  it('defaults to All when the channel has no stored preference', () => {
    seed();

    renderPanel();

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(notifySelect().value).toBe('all');
  });

  it('reflects the stored mode (mentions)', () => {
    seed(new Map([['#general', 'mentions']]));

    renderPanel();

    expect(notifySelect().value).toBe('mentions');
  });

  it('reflects a muted channel (stored level "none" → mode "mute")', () => {
    seed(new Map([['#general', 'none']]));

    renderPanel();

    expect(notifySelect().value).toBe('mute');
  });

  it('dispatches setChannelNotifyMode on change and updates the store', () => {
    seed();
    const spy = vi.spyOn(store.getState(), 'setChannelNotifyMode');

    renderPanel();
    fireEvent.change(notifySelect(), { target: { value: 'mute' } });

    // Dispatched with the display channel name + public mode.
    expect(spy).toHaveBeenCalledWith('#general', 'mute');
    // Stored as the legacy level ('mute' → 'none'), keyed lowercase.
    expect(store.getState().channelNotify.get('#general')).toBe('none');
    // The controlled select reflects the new mode reactively.
    expect(notifySelect().value).toBe('mute');
  });

  it('switching back to All clears the stored entry (all is the default)', () => {
    seed(new Map([['#general', 'mentions']]));

    renderPanel();
    fireEvent.change(notifySelect(), { target: { value: 'all' } });

    expect(store.getState().channelNotify.has('#general')).toBe(false);
    expect(notifySelect().value).toBe('all');
  });

  it('is available to non-op members (personal preference, not op-gated)', () => {
    // Seeded member 'me' has no op modes; the control must still render.
    seed();

    renderPanel();

    expect(notifySelect()).not.toBeDisabled();
  });
});

describe('ChannelSettings — Share invite a11y', () => {
  it('names the invite preview and copy affordances for assistive tech', () => {
    seed();
    renderPanel();

    // Preview is a named group so its accessible name is exposed (not a bare div).
    expect(screen.getByRole('group', { name: 'Invite preview' })).toBeInTheDocument();
    // Copy is a real button with a text name; open is a keyboard-reachable link.
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invite in Onyx' })).toHaveAttribute('href');
  });

  it('announces a successful copy through a polite live region (SC 4.1.3)', async () => {
    seed();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    const status = await screen.findByText('Invite link copied to clipboard.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('announces a copy failure in the same region', async () => {
    seed();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    const status = await screen.findByText(/Copy failed\. Select and copy the link shown above\./);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).not.toHaveTextContent('copied');
  });

  it('reports failure without a false copied state when the Clipboard API is unavailable', async () => {
    seed();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    const status = await screen.findByText(/Copy failed\. Select and copy the link shown above\./);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).not.toHaveTextContent('copied');
  });
});
