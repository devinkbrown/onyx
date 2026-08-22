// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * firstRunNotify.ts — one quiet permission ask after the first send.
 *
 * Never a wall on first paint or Connect. Never the marketing site.
 * iOS may be offered only from the Home Screen standalone web app —
 * never a Safari tab, where Web Push does not work.
 */
import { createSignal, type Accessor } from 'solid-js';

import type { ClientSurface } from '@/lib/platform';

import type { DesktopNotificationPermission } from './decision';

export const NOTIFY_FIRST_SEND_KEY = 'onyx:notify-first-send';
export const NOTIFY_FIRST_RUN_DISMISS_KEY = 'onyx:notify-first-run-dismissed';

export const FIRST_RUN_NOTIFY_TITLE = 'Get a ping when you leave';
export const FIRST_RUN_NOTIFY_LEDE =
  'Mentions, DMs, and calls can reach this browser.';

export type NotifyNavigatorProbe = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function isIosSafariLike(input: NotifyNavigatorProbe = {}): boolean {
  const ua = input.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return input.platform === 'MacIntel' && (input.maxTouchPoints ?? 0) > 1;
}

export function readNotifyNavigatorProbe(
  nav: NotifyNavigatorProbe | null | undefined =
    typeof navigator !== 'undefined' ? navigator : undefined,
): NotifyNavigatorProbe {
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
  };
}

/** iOS Safari tabs cannot receive Web Push. Home Screen standalone can. */
export function canClaimClosedTabPush(input: {
  ios: boolean;
  standalone: boolean;
}): boolean {
  return !(input.ios && !input.standalone);
}

export function firstRunNotifyCopy(input: {
  ios: boolean;
  standalone: boolean;
}): { title: string; lede: string } | null {
  if (!canClaimClosedTabPush(input)) return null;
  return { title: FIRST_RUN_NOTIFY_TITLE, lede: FIRST_RUN_NOTIFY_LEDE };
}

export function shouldOfferFirstRunNotify(input: {
  sent: boolean;
  dismissed: boolean;
  permission: DesktopNotificationPermission;
  surface: ClientSurface;
  hostNotifications: boolean;
  ios: boolean;
  standalone: boolean;
}): boolean {
  if (!input.sent || input.dismissed) return false;
  if (!canClaimClosedTabPush(input)) return false;
  if (input.surface === 'zig-desktop' && !input.hostNotifications) return false;
  return input.permission === 'default';
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readFlag(key: string): boolean {
  if (!hasStorage()) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (!hasStorage()) return;
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — session-only */
  }
}

const [sentAccessor, setSentSignal] = createSignal(readFlag(NOTIFY_FIRST_SEND_KEY));
const [dismissedAccessor, setDismissedSignal] = createSignal(readFlag(NOTIFY_FIRST_RUN_DISMISS_KEY));

export const hasNotifyFirstSend: Accessor<boolean> = sentAccessor;
export const isNotifyAskDismissed: Accessor<boolean> = dismissedAccessor;

export function markNotifyFirstSend(): void {
  if (sentAccessor()) return;
  setSentSignal(true);
  writeFlag(NOTIFY_FIRST_SEND_KEY, true);
}

export function dismissNotifyAsk(): void {
  if (dismissedAccessor()) return;
  setDismissedSignal(true);
  writeFlag(NOTIFY_FIRST_RUN_DISMISS_KEY, true);
}

/** Test / boundary reset. */
export function resetFirstRunNotifyState(): void {
  setSentSignal(false);
  setDismissedSignal(false);
  writeFlag(NOTIFY_FIRST_SEND_KEY, false);
  writeFlag(NOTIFY_FIRST_RUN_DISMISS_KEY, false);
}
