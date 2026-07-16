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
import { readChannelTopicDraft } from '@/lib/channel/topicDrafts';
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

function setServerTopic(topic: string): void {
  const current = store.getState().channels.get('#general');
  if (!current) throw new Error('missing #general test channel');
  store.setState({
    channels: new Map([['#general', { ...current, topic }]]),
  });
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
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
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

describe('ChannelSettings — Topic draft durability', () => {
  it('keeps a submitted draft across reopen until a server echo arrives', () => {
    seed();
    const setTopic = vi.spyOn(store.getState(), 'setTopic').mockImplementation(() => {});
    const first = renderPanel();
    fireEvent.input(screen.getByLabelText('Topic text'), {
      target: { value: 'Awaiting acknowledgement' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));

    expect(setTopic).toHaveBeenCalledWith('#general', 'Awaiting acknowledgement');
    expect(readChannelTopicDraft('#general')).toBe('Awaiting acknowledgement');
    first.unmount();
    renderPanel();
    expect(screen.getByLabelText('Topic text')).toHaveValue('Awaiting acknowledgement');
  });

  it('clears a submitted draft only after the matching server topic arrives', () => {
    seed();
    vi.spyOn(store.getState(), 'setTopic').mockImplementation(() => {});
    const first = renderPanel();
    fireEvent.input(screen.getByLabelText('Topic text'), {
      target: { value: 'Confirmed topic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));

    setServerTopic('Confirmed topic');

    expect(readChannelTopicDraft('#general')).toBeNull();
    first.unmount();
    renderPanel();
    expect(screen.getByLabelText('Topic text')).toHaveValue('Confirmed topic');
  });

  it('preserves a submitted draft when the authoritative echo diverges', () => {
    seed();
    vi.spyOn(store.getState(), 'setTopic').mockImplementation(() => {});
    const first = renderPanel();
    fireEvent.input(screen.getByLabelText('Topic text'), {
      target: { value: 'My proposed topic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));

    setServerTopic('Moderator override');

    expect(readChannelTopicDraft('#general')).toBe('My proposed topic');
    expect(screen.getByLabelText('Topic text')).toHaveValue('My proposed topic');
    first.unmount();
    renderPanel();
    expect(screen.getByLabelText('Topic text')).toHaveValue('My proposed topic');
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

  it('offers the native share sheet only when the browser accepts the invite data', async () => {
    seed();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn(() => true),
      configurable: true,
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Share invite' }));

    expect(await screen.findByText('Invite shared.')).toHaveAttribute('role', 'status');
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: '#general on Onyx',
      text: 'Join #general on Onyx.',
      url: expect.stringContaining('/invite?join=%23general'),
    }));
  });

  it('guards a pending native share and reports cancellation without claiming success', async () => {
    seed();
    let rejectShare: ((reason: unknown) => void) | undefined;
    const share = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectShare = reject;
    }));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });

    renderPanel();
    const button = screen.getByRole('button', { name: 'Share invite' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Opening share sheet…' })).toBeDisabled();
    rejectShare?.(new DOMException('cancelled', 'AbortError'));
    expect(await screen.findByText('Share cancelled. The invite link is still available below.')).toBeInTheDocument();
    expect(screen.queryByText('Invite shared.')).not.toBeInTheDocument();
  });

  it('keeps copy as the fallback when native sharing is unavailable or rejects', async () => {
    seed();
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Share invite' })).not.toBeInTheDocument();
    cleanup();

    const share = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Share invite' }));

    expect(await screen.findByText('Could not open the share sheet. Copy the invite link instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeEnabled();
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
