// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * closedTabCopy.ts — honest copy for closed-tab mentions / DMs / calls.
 *
 * Never claims native desktop-host notifications when the host matrix flag is
 * false. Never claims a third-party push vendor. Call copy is a room call, not
 * an E2EE promise.
 */
import type { ClientSurface, PlatformCapabilities } from '@/lib/platform';

import type { DesktopNotificationPermission } from './decision';

export const CLOSED_TAB_KINDS = ['mention', 'dm', 'call'] as const;
export type ClosedTabKind = (typeof CLOSED_TAB_KINDS)[number];

export const CLOSED_TAB_KIND_COPY: Record<ClosedTabKind, { title: string; body: string }> = {
  mention: {
    title: 'Mentions',
    body: 'Someone says your name in a room.',
  },
  dm: {
    title: 'DMs',
    body: 'A direct message arrives.',
  },
  call: {
    title: 'Calls',
    body: 'Someone starts a call in a room you are in.',
  },
};

export function hostCannotNotifyNatively(
  surface: ClientSurface,
  capabilities: Pick<PlatformCapabilities, 'notifications'>,
): boolean {
  return surface === 'zig-desktop' && capabilities.notifications === false;
}

export function hostNotifyHonesty(input: {
  surface: ClientSurface;
  capabilities: Pick<PlatformCapabilities, 'notifications'>;
}): { canClaimNativeHost: boolean; notice: string | null } {
  if (input.surface === 'zig-desktop' && input.capabilities.notifications) {
    return { canClaimNativeHost: true, notice: null };
  }
  if (hostCannotNotifyNatively(input.surface, input.capabilities)) {
    return {
      canClaimNativeHost: false,
      notice: 'This desktop app cannot show system notifications yet. Use Onyx in a browser to get mentions, DMs, and calls when the window is closed.',
    };
  }
  return { canClaimNativeHost: false, notice: null };
}

export function closedTabStatusCopy(input: {
  permission: DesktopNotificationPermission;
  webPushOn: boolean;
  signedIn: boolean;
  webPushSupported: boolean;
  hostNotice: string | null;
}): string {
  if (input.hostNotice) return input.hostNotice;
  if (input.permission === 'denied') {
    return 'Notifications are blocked in this browser. Allow them in site settings, then come back here.';
  }
  if (input.permission === 'unsupported') {
    return 'This browser cannot show notifications.';
  }
  if (input.webPushOn) {
    return 'Mentions, DMs, and calls can reach this browser when the tab is closed.';
  }
  if (!input.signedIn) {
    return 'Allow notifications to ping while Onyx is open in the background. Closed-tab alerts need a signed-in account.';
  }
  if (!input.webPushSupported) {
    return 'This browser cannot receive alerts while the tab is closed.';
  }
  return 'Turn on alerts to get mentions, DMs, and calls when this tab is closed.';
}
