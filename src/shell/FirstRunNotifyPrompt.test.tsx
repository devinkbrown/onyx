// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArmClosedTabResult } from '@/lib/notifications/armClosedTab';
import type { DesktopNotificationPermission } from '@/lib/notifications/decision';
import {
  FIRST_RUN_NOTIFY_LEDE,
  FIRST_RUN_NOTIFY_TITLE,
  markNotifyFirstSend,
  resetFirstRunNotifyState,
} from '@/lib/notifications/firstRunNotify';
import { resetNotificationsOpenState } from '@/lib/notifications/youNotificationsState';
import { store } from '@/lib/store/store';

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

const standaloneMocks = vi.hoisted(() => ({
  standalone: undefined as boolean | undefined,
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

vi.mock('@/lib/notifications/firstRunNotify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications/firstRunNotify')>();
  return {
    ...actual,
    readNavigatorStandalone: () => standaloneMocks.standalone,
  };
});

import { FirstRunNotifyPrompt } from './FirstRunNotifyPrompt';

const initialState = store.getInitialState();

describe('FirstRunNotifyPrompt', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetFirstRunNotifyState();
    resetNotificationsOpenState();
    localStorage.clear();
    platformMocks.surface = 'browser';
    platformMocks.notifications = false;
    standaloneMocks.standalone = undefined;
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

  it('stays quiet on first paint — inbound history is not a send', () => {
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
    expect(screen.queryByText(FIRST_RUN_NOTIFY_TITLE)).not.toBeInTheDocument();
  });

  it('asks once after the first send and dismissed stays dismissed', async () => {
    markNotifyFirstSend();
    const view = render(() => <FirstRunNotifyPrompt />);

    const sheet = await screen.findByTestId('first-run-notify');
    expect(sheet).toHaveTextContent(FIRST_RUN_NOTIFY_TITLE);
    expect(sheet).toHaveTextContent(FIRST_RUN_NOTIFY_LEDE);
    expect(sheet).not.toHaveTextContent(/e2ee|onesignal|safari tab/i);

    fireEvent.click(screen.getByTestId('first-run-notify-dismiss'));
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();

    view.unmount();
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });

  it('arms closed-tab alerts from the quiet sheet', async () => {
    markNotifyFirstSend();
    render(() => <FirstRunNotifyPrompt />);

    fireEvent.click(await screen.findByTestId('first-run-notify-enable'));
    await waitFor(() => expect(armMocks.arm).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument());
  });

  it('iOS Safari tab does not claim push after a send', () => {
    standaloneMocks.standalone = false;
    platformMocks.surface = 'browser';
    markNotifyFirstSend();
    render(() => <FirstRunNotifyPrompt />);

    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
    expect(screen.queryByText(/push|when this tab is closed|web push/i)).not.toBeInTheDocument();
    expect(armMocks.arm).not.toHaveBeenCalled();
  });

  it('may offer on an iOS Home Screen standalone web app after a send', async () => {
    standaloneMocks.standalone = true;
    platformMocks.surface = 'pwa';
    markNotifyFirstSend();
    render(() => <FirstRunNotifyPrompt />);

    expect(await screen.findByTestId('first-run-notify')).toHaveTextContent(FIRST_RUN_NOTIFY_TITLE);
  });

  it('does not ask on the Zig host when native notifications are false', () => {
    platformMocks.surface = 'zig-desktop';
    platformMocks.notifications = false;
    markNotifyFirstSend();
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });

  it('does not nag when permission is already granted or denied', () => {
    markNotifyFirstSend();
    browserMocks.getPermission.mockReturnValue('granted');
    const granted = render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
    granted.unmount();

    browserMocks.getPermission.mockReturnValue('denied');
    render(() => <FirstRunNotifyPrompt />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
  });
});
