// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store, type Server } from '@/lib/store/store';
import type { DesktopNotificationPermission } from './decision';
import type { WebPushResult } from './webPush';

const browserMocks = vi.hoisted(() => ({
  requestPermission: vi.fn<() => Promise<DesktopNotificationPermission>>(async () => 'default'),
}));

const webPushMocks = vi.hoisted(() => ({
  enable: vi.fn<() => Promise<WebPushResult>>(async () => ({ ok: true })),
  supported: vi.fn(() => true),
}));

vi.mock('./browser', () => ({
  requestDesktopNotificationPermission: browserMocks.requestPermission,
}));

vi.mock('./webPush', () => ({
  enableWebPush: webPushMocks.enable,
  webPushSupported: webPushMocks.supported,
}));

import { armClosedTabNotifications, closedTabArmedToast } from './armClosedTab';

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

describe('armClosedTabNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    browserMocks.requestPermission.mockReset().mockResolvedValue('granted');
    webPushMocks.enable.mockReset().mockResolvedValue({ ok: true });
    webPushMocks.supported.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('enables desktop prefs and existing Web Push when signed in', async () => {
    store.setState({ server: server('alice') });

    const result = await armClosedTabNotifications();

    expect(result).toEqual({
      permission: 'granted',
      desktopEnabled: true,
      webPush: { ok: true },
    });
    expect(store.getState().pushNotificationsEnabled).toBe(true);
    expect(webPushMocks.enable).toHaveBeenCalledOnce();
    expect(closedTabArmedToast(result).description).toMatch(/mentions, DMs, and calls/i);
    expect(closedTabArmedToast(result).description).not.toMatch(/e2ee|onesignal/i);
  });

  it('does not subscribe guests — closed-tab needs an account', async () => {
    store.setState({ server: server(null) });

    const result = await armClosedTabNotifications();

    expect(result.desktopEnabled).toBe(true);
    expect(result.webPush).toEqual({
      ok: false,
      skipped: true,
      reason: 'Sign in to get mentions, DMs, and calls when the tab is closed.',
    });
    expect(webPushMocks.enable).not.toHaveBeenCalled();
    expect(closedTabArmedToast(result).variant).toBe('info');
  });

  it('skips Web Push when the browser blocks permission', async () => {
    browserMocks.requestPermission.mockResolvedValue('denied');
    store.setState({ server: server('alice') });

    const result = await armClosedTabNotifications();

    expect(result.desktopEnabled).toBe(false);
    expect(webPushMocks.enable).not.toHaveBeenCalled();
    expect(closedTabArmedToast(result).variant).toBe('warning');
  });
});
