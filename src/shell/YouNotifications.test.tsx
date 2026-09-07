// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import type { DesktopNotificationPermission } from '@/lib/notifications/decision';
import type { ArmClosedTabResult } from '@/lib/notifications/armClosedTab';
import type { WebPushResult } from '@/lib/notifications/webPush';
import {
  openNotifications,
  resetNotificationsOpenState,
} from '@/lib/notifications/youNotificationsState';
import { store, type Server } from '@/lib/store/store';

const browserMocks = vi.hoisted(() => ({
  getPermission: vi.fn<() => DesktopNotificationPermission>(() => 'default'),
}));

const armMocks = vi.hoisted(() => ({
  arm: vi.fn<() => Promise<ArmClosedTabResult>>(async () => ({
    permission: 'granted',
    desktopEnabled: true,
    webPush: { ok: true },
  })),
}));

const webPushMocks = vi.hoisted(() => ({
  active: vi.fn(async () => false),
  disable: vi.fn<() => Promise<WebPushResult>>(async () => ({ ok: true })),
  intentDesired: vi.fn(() => false),
  recover: vi.fn<() => Promise<WebPushResult>>(async () => ({
    ok: false,
    reason: 'Push is not enabled on this browser.',
  })),
  supported: vi.fn(() => true),
}));

const platformMocks = vi.hoisted(() => ({
  surface: 'browser' as 'browser' | 'pwa' | 'zig-desktop',
  notifications: false,
}));

vi.mock('@/lib/notifications/browser', () => ({
  getDesktopNotificationPermission: browserMocks.getPermission,
}));

vi.mock('@/lib/notifications/armClosedTab', () => ({
  armClosedTabNotifications: armMocks.arm,
  closedTabArmedToast: (result: ArmClosedTabResult) => (
    result.webPush.ok
      ? {
        variant: 'success' as const,
        title: 'Alerts on',
        description: 'Mentions, DMs, and calls can reach this browser when the tab is closed.',
      }
      : {
        variant: 'warning' as const,
        title: 'Alerts unavailable',
        description: 'skipped' in result.webPush ? result.webPush.reason : 'failed',
      }
  ),
}));

vi.mock('@/lib/notifications/webPush', () => ({
  disableWebPush: webPushMocks.disable,
  recoverWebPush: webPushMocks.recover,
  webPushActive: webPushMocks.active,
  webPushIntentDesired: webPushMocks.intentDesired,
  webPushSupported: webPushMocks.supported,
}));

vi.mock('@/lib/platform', () => ({
  detectClientSurface: () => platformMocks.surface,
  capabilitiesForSurface: () => ({
    bridge: false,
    notifications: platformMocks.notifications,
    deepLinks: false,
    windowControls: false,
    updater: false,
    secureStorage: false,
  }),
}));

import { YouNotifications } from './YouNotifications';

const initialState = store.getInitialState();

function server(account: string | null): Server {
  return {
    id: 'local',
    name: 'Local',
    network: 'Onyx',
    url: 'wss://example.invalid',
    icon: '#000',
    nick: 'me',
    account,
    connected: true,
  };
}

function channel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map<string, ChannelUser>(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [] as ChatMessage[],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('YouNotifications', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetNotificationsOpenState();
    localStorage.clear();
    platformMocks.surface = 'browser';
    platformMocks.notifications = false;
    browserMocks.getPermission.mockReset().mockReturnValue('default');
    armMocks.arm.mockReset().mockResolvedValue({
      permission: 'granted',
      desktopEnabled: true,
      webPush: { ok: true },
    });
    webPushMocks.active.mockReset().mockResolvedValue(false);
    webPushMocks.disable.mockReset().mockResolvedValue({ ok: true });
    webPushMocks.supported.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    resetNotificationsOpenState();
    store.setState(initialState, true);
    localStorage.clear();
  });

  it('stays closed until You opens Notifications', () => {
    render(() => <YouNotifications />);
    expect(screen.queryByTestId('you-notifications')).not.toBeInTheDocument();
  });

  it('lists Mentions, DMs, and Calls and can arm closed-tab alerts', async () => {
    store.setState({
      server: server('alice'),
      connectionStatus: 'connected',
      activeView: { kind: 'channel', channel: '#general' },
      channels: new Map([['#general', channel('#general')]]),
    });
    openNotifications();
    render(() => <YouNotifications />);

    expect(screen.getByTestId('you-notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notifications, current page/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Mentions')).toBeInTheDocument();
    expect(screen.getByText('DMs')).toBeInTheDocument();
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByText(/effective alerts have three layers/i)).toBeInTheDocument();
    expect(screen.getByText(/All: room messages may create inbox entries, unread\/badge activity/i)).toBeInTheDocument();
    expect(screen.getByText(/starts a call in a room you are in/i)).toBeInTheDocument();
    expect(screen.getByTestId('you-notifications')).not.toHaveTextContent(/e2ee|end-to-end|onesignal/i);
    expect(screen.getByRole('radiogroup', { name: /Notifications for #general/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('you-notifications-enable'));
    await waitFor(() => expect(armMocks.arm).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('you-notifications-disable')).toBeInTheDocument());
    expect(store.getState().toasts.at(-1)?.description).toMatch(/mentions, DMs, and calls/i);
  });

  it.each([
    ['all', /All: room messages may create inbox entries, unread\/badge activity, sound, and desktop alerts\./i],
    ['mentions', /Mentions only: this room contributes only messages that mention you to notification decisions\. Followed-conversation activity is a separate global Calm-mode tier and may still add a badge or alert/i],
    ['mute', /Mute: this room is hard-silenced; its messages create no inbox entries, unread counts, highlights, sound, or desktop alerts\./i],
  ] as const)('derives truthful room copy for the %s policy', (mode, expected) => {
    store.setState({
      server: server('alice'),
      connectionStatus: 'connected',
      activeView: { kind: 'channel', channel: '#general' },
      channels: new Map([['#general', channel('#general')]]),
      channelNotify: new Map([['#general', mode === 'mute' ? 'none' : mode]]),
    });
    openNotifications();
    render(() => <YouNotifications />);

    expect(screen.getByText(expected)).toBeInTheDocument();
    if (mode === 'mute') {
      expect(screen.getByText(/hard-silenced/i)).toBeInTheDocument();
      expect(screen.getByText(/permission alone is not enough/i)).toBeInTheDocument();
    }
    if (mode === 'mentions') {
      expect(screen.getByText(/separate global Calm-mode tier/i)).toBeInTheDocument();
      expect(screen.getByText(/closed-tab delivery additionally requires alerts to be armed/i)).toBeInTheDocument();
    }
  });

  it('tells the truth when the Zig host cannot notify', () => {
    platformMocks.surface = 'zig-desktop';
    platformMocks.notifications = false;
    store.setState({ server: server('alice') });
    openNotifications();
    render(() => <YouNotifications />);

    expect(screen.getByTestId('you-notifications-status')).toHaveTextContent(/cannot show system notifications/i);
    expect(screen.queryByTestId('you-notifications-enable')).not.toBeInTheDocument();
  });

  it('settles enable controls when an account change supersedes a pending arm', async () => {
    const pending = deferred<ArmClosedTabResult>();
    armMocks.arm.mockReturnValue(pending.promise);
    store.setState({ server: server('alice'), connectionStatus: 'connected' });
    openNotifications();
    render(() => <YouNotifications />);

    const enable = screen.getByTestId('you-notifications-enable');
    fireEvent.click(enable);
    expect(enable).toBeDisabled();
    store.setState({ server: server('bob') });

    await waitFor(() => expect(screen.getByTestId('you-notifications-enable')).toBeEnabled());
    pending.resolve({ permission: 'granted', desktopEnabled: true, webPush: { ok: true } });
    await pending.promise;
    await Promise.resolve();

    expect(screen.getByTestId('you-notifications-enable')).toBeEnabled();
    expect(store.getState().toasts).toEqual([]);
  });
});
