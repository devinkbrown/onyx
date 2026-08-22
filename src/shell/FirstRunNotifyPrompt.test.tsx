// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import type { ArmClosedTabResult } from '@/lib/notifications/armClosedTab';
import type { DesktopNotificationPermission } from '@/lib/notifications/decision';
import {
  resetFirstRunNotifyState,
} from '@/lib/notifications/firstRunNotify';
import {
  isNotificationsOpen,
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

const platformMocks = vi.hoisted(() => ({
  surface: 'browser' as 'browser' | 'pwa' | 'zig-desktop',
  notifications: false,
}));

vi.mock('@/lib/notifications/browser', () => ({
  getDesktopNotificationPermission: browserMocks.getPermission,
}));

vi.mock('@/lib/notifications/armClosedTab', () => ({
  armClosedTabNotifications: armMocks.arm,
  closedTabArmedToast: () => ({
    variant: 'success' as const,
    title: 'Alerts on',
    description: 'Mentions, DMs, and calls can reach this browser when the tab is closed.',
  }),
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

import { FirstRunNotifyPrompt } from './FirstRunNotifyPrompt';

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

function realMessage(): ChatMessage {
  return {
    id: 'm1',
    time: new Date('2026-08-22T12:00:00.000Z'),
    from: 'bob',
    text: 'hello',
    type: 'msg',
    target: '#general',
  };
}

function emptyChannel(): Channel {
  return {
    name: '#general',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map<string, ChannelUser>(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [{
      id: 'join-1',
      time: new Date('2026-08-22T12:00:00.000Z'),
      from: 'me',
      text: 'joined',
      type: 'join',
      target: '#general',
    }],
  };
}

describe('FirstRunNotifyPrompt', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetFirstRunNotifyState();
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
  });

  afterEach(() => {
    cleanup();
    resetFirstRunNotifyState();
    resetNotificationsOpenState();
    store.setState(initialState, true);
    localStorage.clear();
  });

  it('stays quiet until a real message is sent or received', () => {
    store.setState({
      server: server('alice'),
      channels: new Map([['#general', emptyChannel()]]),
    });
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });

  it('asks once after real chat and can be dismissed', async () => {
    const room = emptyChannel();
    room.messages = [...room.messages, realMessage()];
    store.setState({
      server: server('alice'),
      channels: new Map([['#general', room]]),
    });
    render(() => <FirstRunNotifyPrompt />);

    expect(await screen.findByTestId('first-run-notify')).toHaveTextContent(/mentions, DMs, or calls/i);
    expect(screen.getByTestId('first-run-notify')).not.toHaveTextContent(/e2ee|onesignal/i);

    fireEvent.click(screen.getByTestId('first-run-notify-dismiss'));
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });

  it('arms closed-tab alerts from the quiet ask', async () => {
    store.setState({
      server: server('alice'),
      channels: new Map([['#general', {
        ...emptyChannel(),
        messages: [realMessage()],
      }]]),
    });
    render(() => <FirstRunNotifyPrompt />);

    fireEvent.click(await screen.findByTestId('first-run-notify-enable'));
    await waitFor(() => expect(armMocks.arm).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument());
  });

  it('opens You → Notifications from the chip', async () => {
    store.setState({
      server: server('alice'),
      notifications: [{
        id: 'n1',
        type: 'mention',
        text: 'ping',
        from: 'bob',
        channel: '#general',
        at: new Date(),
      }],
    });
    render(() => <FirstRunNotifyPrompt />);

    fireEvent.click(await screen.findByTestId('first-run-notify-settings'));
    expect(isNotificationsOpen()).toBe(true);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });

  it('does not ask on the Zig host when native notifications are false', () => {
    platformMocks.surface = 'zig-desktop';
    platformMocks.notifications = false;
    store.setState({
      server: server('alice'),
      channels: new Map([['#general', {
        ...emptyChannel(),
        messages: [realMessage()],
      }]]),
    });
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });
});
