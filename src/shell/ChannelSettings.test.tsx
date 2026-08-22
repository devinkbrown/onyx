// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSettings.test.tsx — per-channel Notifications control.
 *
 * Pins the personal notification-mode picker: it reflects the current stored
 * mode (reactively, via useStore + channelNotifyMode) and dispatches
 * setChannelNotifyMode on change. The picker is a personal preference, so it is
 * available to every member (no op gate) and applies immediately. AAA pattern.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store, type Server } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { NotifyLevel } from '@/lib/notifications/channelNotifyMode';
import { readChannelTopicDraft, saveChannelTopicDraft } from '@/lib/channel/topicDrafts';
import { ChannelSettings } from './ChannelSettings';

vi.mock('@/lib/stats/channelDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stats/channelDetail')>();
  return {
    ...actual,
    fetchChannelDetail: vi.fn(async () => ({
      channel: '#general',
      generatedAt: 1,
      firstSeen: 1,
      lastActive: Math.floor(Date.now() / 1000) - 60,
      present: 8,
      lastSpeaker: 'alice',
      totals: {
        messages: 500,
        words: 1200,
        activeUsers: 8,
        joins: 2,
        parts: 1,
        quits: 0,
        kicks: 0,
        topicChanges: 0,
      },
      hours: Array.from({ length: 24 }, () => 0),
      days: [],
      heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      busiestDay: { date: '2026-07-01', messages: 50 },
      peakHour: 12,
      complete: true,
    })),
  };
});

const initialState = store.getInitialState();
const ALICE_OWNER = { serverUrl: 'wss://example.test', identity: 'alice' } as const;
const BOB_OWNER = { serverUrl: 'wss://example.test', identity: 'bob' } as const;

function testServer(account: string): Server {
  return {
    id: `channel-settings-${account}`,
    name: 'Example',
    network: 'Example',
    url: ALICE_OWNER.serverUrl,
    icon: '',
    nick: account,
    account,
    connected: true,
  };
}

function makeChannel(name: string, modes: string[] = []): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set(modes) });
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

function seed(
  notify?: Map<string, NotifyLevel>,
  options?: { op?: boolean; client?: { sendRaw: ReturnType<typeof vi.fn> } },
): void {
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', options?.op ? ['o'] : []));
  store.setState(
    {
      ...initialState,
      server: testServer('alice'),
      channels,
      ourNick: 'me',
      activeView: { kind: 'channel', channel: '#general' },
      connectionStatus: 'connected',
      channelNotify: notify ?? new Map(),
      ...(options?.client ? { client: options.client as never } : {}),
    },
    true,
  );
}

function renderPanel() {
  return render(() => (
    <ChannelSettings channel="#general" open={true} onOpenChange={() => {}} />
  ));
}

function openAdvanced() {
  fireEvent.click(screen.getByText('Advanced'));
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

describe('ChannelSettings — Public insights', () => {
  it('deep-links the embedded room insights strip to the room ledger', async () => {
    seed();
    renderPanel();
    openAdvanced();

    expect(await screen.findByTestId('room-insights-open-stats')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(screen.getByTestId('room-insights-open-stats')).toHaveTextContent('Room ledger');
  });
});

describe('ChannelSettings — default chrome', () => {
  it('keeps ACCESS and room rules under Advanced', () => {
    seed();
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByText('+m')).toBeNull();
    expect(screen.queryByText('Room key (+k)')).toBeNull();

    openAdvanced();
    expect(screen.getByRole('heading', { name: 'Room rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
  });
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
    expect(readChannelTopicDraft('#general', undefined, ALICE_OWNER)).toBe('Awaiting acknowledgement');
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

    expect(readChannelTopicDraft('#general', undefined, ALICE_OWNER)).toBeNull();
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

    expect(readChannelTopicDraft('#general', undefined, ALICE_OWNER)).toBe('My proposed topic');
    expect(screen.getByLabelText('Topic text')).toHaveValue('My proposed topic');
    first.unmount();
    renderPanel();
    expect(screen.getByLabelText('Topic text')).toHaveValue('My proposed topic');
  });

  it('switches the topic field from Alice to Bob when the live account changes', () => {
    saveChannelTopicDraft('#general', 'Alice proposed topic', '', undefined, ALICE_OWNER);
    saveChannelTopicDraft('#general', 'Bob proposed topic', '', undefined, BOB_OWNER);
    seed();
    renderPanel();
    expect(screen.getByLabelText('Topic text')).toHaveValue('Alice proposed topic');

    store.setState({ server: testServer('bob'), ourNick: 'bob' });

    expect(screen.getByLabelText('Topic text')).toHaveValue('Bob proposed topic');
  });
});

describe('ChannelSettings — Export transcript', () => {
  it('exposes text and JSON download actions for local scrollback', () => {
    seed();
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Export transcript' })).toBeInTheDocument();
    expect(screen.getByTestId('chset-export-txt')).toHaveAccessibleName(/download text/i);
    expect(screen.getByTestId('chset-export-json')).toHaveAccessibleName(/download json/i);
  });
});

describe('ChannelSettings — Leave channel', () => {
  it('requires confirm before parting the active channel', () => {
    const sendRaw = vi.fn();
    seed(undefined, { client: { sendRaw } });
    const onOpenChange = vi.fn();
    render(() => (
      <ChannelSettings channel="#general" open={true} onOpenChange={onOpenChange} />
    ));

    fireEvent.click(screen.getByTestId('chset-leave'));
    expect(sendRaw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('chset-leave-confirm'));
    expect(sendRaw).toHaveBeenCalledWith('PART', '#general', 'Goodbye');
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
    // Share payload includes encryption-policy chip when known (E2EE optional/required/off).
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: '#general on Onyx',
      text: expect.stringMatching(/^Join #general on Onyx/),
      url: expect.stringContaining('/invite/?join=%23general'),
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

  it('discards typed invite state and a pending copy result when the owner changes', async () => {
    seed();
    let resolveCopy: (() => void) | undefined;
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const writeText = vi.fn(() => pendingCopy);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPanel();
    fireEvent.input(screen.getByLabelText('Suggested guest name (optional)'), {
      target: { value: 'alice-guest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(screen.getByRole('button', { name: 'Copying invite link…' })).toBeDisabled();

    store.setState({ server: testServer('bob'), ourNick: 'bob' });

    await waitFor(() => expect(screen.getByLabelText('Suggested guest name (optional)')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Copy invite link' })).not.toBeDisabled();
    resolveCopy?.();
    await pendingCopy;
    await Promise.resolve();
    // Invite-status live region (not other polite regions on the panel).
    expect(screen.getByTestId('chset-invite-status')).toHaveTextContent('');
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

describe('ChannelSettings — Roles & access (IRCX ACCESS)', () => {
  it('hides the ACCESS manager from non-ops', () => {
    seed();
    renderPanel();
    openAdvanced();

    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.getByText(/Access entries grant founder/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add access entry' })).not.toBeInTheDocument();
  });

  it('lists committed ACCESS entries and refreshes on open for ops', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    store.setState({
      channelAccess: new Map([
        [
          '#general',
          [
            { level: 'HOST', mask: 'bob!*@*', setBy: 'alice', duration: 3600 },
            { level: 'DENY', mask: '*!*@spam.example' },
          ],
        ],
      ]),
    });

    renderPanel();
    openAdvanced();

    expect(sendRaw).toHaveBeenCalledWith('ACCESS', '#general', 'LIST');
    const list = screen.getByRole('list', { name: 'Room access entries' });
    expect(list).toBeInTheDocument();
    expect(list).toHaveTextContent('bob!*@*');
    expect(list).toHaveTextContent('*!*@spam.example');
    expect(list).toHaveTextContent('1 hour');
    expect(list).toHaveTextContent('set by alice');
  });

  it('dispatches addChannelAccess with expanded nick mask', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    const addSpy = vi.spyOn(store.getState(), 'addChannelAccess');

    renderPanel();
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Role level'), { target: { value: 'VOICE' } });
    fireEvent.input(screen.getByLabelText('Name or hostmask'), { target: { value: 'carol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add access entry' }));

    expect(addSpy).toHaveBeenCalledWith('#general', 'VOICE', 'carol!*@*', undefined);
  });

  it('passes an optional timeout through to addChannelAccess', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    const addSpy = vi.spyOn(store.getState(), 'addChannelAccess');

    renderPanel();
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Role level'), { target: { value: 'DENY' } });
    fireEvent.input(screen.getByLabelText('Name or hostmask'), {
      target: { value: 'bad!*@spam.example' },
    });
    fireEvent.input(screen.getByLabelText('Timeout seconds (optional)'), {
      target: { value: '3600' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add access entry' }));

    expect(addSpy).toHaveBeenCalledWith('#general', 'DENY', 'bad!*@spam.example', 3600);
  });

  it('surfaces a form error and skips the wire on empty mask', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    const addSpy = vi.spyOn(store.getState(), 'addChannelAccess');

    renderPanel();
    openAdvanced();
    sendRaw.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add access entry' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/name or hostmask/i);
    expect(addSpy).not.toHaveBeenCalled();
    // Opening the panel issues ACCESS LIST once; the invalid submit must not.
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('does not request ACCESS LIST for non-ops', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: false, client: { sendRaw } });
    renderPanel();
    expect(sendRaw).not.toHaveBeenCalledWith('ACCESS', '#general', 'LIST');
  });

  it('removes an entry through deleteChannelAccess', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    store.setState({
      channelAccess: new Map([
        ['#general', [{ level: 'HOST', mask: 'bob!*@*' }]],
      ]),
    });
    const delSpy = vi.spyOn(store.getState(), 'deleteChannelAccess');

    renderPanel();
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: 'Remove HOST access for bob!*@*' }));

    expect(delSpy).toHaveBeenCalledWith('#general', 'HOST', 'bob!*@*');
  });

  it('updates the list reactively when the store commits ACCESS rows', () => {
    const sendRaw = vi.fn(() => true);
    seed(undefined, { op: true, client: { sendRaw } });
    renderPanel();
    openAdvanced();

    expect(screen.getByTestId('chset-access-empty')).toBeInTheDocument();

    store.setState({
      channelAccess: new Map([
        ['#general', [{ level: 'OWNER', mask: 'dana!*@*' }]],
      ]),
    });

    const list = screen.getByRole('list', { name: 'Room access entries' });
    expect(list).toHaveTextContent('dana!*@*');
    expect(list).toHaveTextContent('Owner');
  });
});
