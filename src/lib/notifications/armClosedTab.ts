// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * armClosedTab.ts — one product path for permission + existing Web Push.
 *
 * Uses the shipped SW + WEBPUSH SUBSCRIBE contract. Does not invent a vendor.
 * Desktop-host native notify is not claimed here — callers show host honesty.
 */
import { getState, selectAccount } from '@/lib/store';

import { requestDesktopNotificationPermission } from './browser';
import type { DesktopNotificationPermission } from './decision';
import { enableWebPush, webPushSupported, type WebPushResult } from './webPush';

export type ArmClosedTabWebPush =
  | WebPushResult
  | { ok: false; skipped: true; reason: string };

export type ArmClosedTabResult = {
  permission: DesktopNotificationPermission;
  desktopEnabled: boolean;
  webPush: ArmClosedTabWebPush;
};

export async function armClosedTabNotifications(): Promise<ArmClosedTabResult> {
  const permission = await requestDesktopNotificationPermission();
  const desktopEnabled = permission === 'granted';
  if (desktopEnabled) getState().setPushNotificationsEnabled(true);

  if (!desktopEnabled) {
    return {
      permission,
      desktopEnabled,
      webPush: {
        ok: false,
        skipped: true,
        reason: permission === 'denied'
          ? 'Notifications are blocked by the browser.'
          : 'This browser cannot show notifications.',
      },
    };
  }

  if (!webPushSupported()) {
    return {
      permission,
      desktopEnabled,
      webPush: {
        ok: false,
        skipped: true,
        reason: 'This browser cannot receive alerts while the tab is closed.',
      },
    };
  }

  if (!selectAccount(getState())) {
    return {
      permission,
      desktopEnabled,
      webPush: {
        ok: false,
        skipped: true,
        reason: 'Sign in to get mentions, DMs, and calls when the tab is closed.',
      },
    };
  }

  return {
    permission,
    desktopEnabled,
    webPush: await enableWebPush(),
  };
}

export function closedTabArmedToast(result: ArmClosedTabResult): {
  variant: 'success' | 'info' | 'warning';
  title: string;
  description: string;
} {
  if (result.webPush.ok) {
    return {
      variant: 'success',
      title: 'Alerts on',
      description: 'Mentions, DMs, and calls can reach this browser when the tab is closed.',
    };
  }
  if (result.desktopEnabled && 'skipped' in result.webPush && result.webPush.skipped) {
    return {
      variant: 'info',
      title: 'Notifications allowed',
      description: result.webPush.reason,
    };
  }
  return {
    variant: 'warning',
    title: 'Alerts unavailable',
    description: result.webPush.ok === false ? result.webPush.reason : 'Alerts could not be turned on.',
  };
}
