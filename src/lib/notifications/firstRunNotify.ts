// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * firstRunNotify.ts — one quiet permission ask after the first send.
 *
 * Never a wall on first paint or Connect. Never the marketing site.
 * iOS may be offered only from the Home Screen standalone web app —
 * never a Safari tab, where Web Push does not work.
 *
 * `navigator.standalone === false` is the iOS Safari-tab signal (boolean
 * false, not missing). Other browsers leave the property undefined.
 */
import { createSignal, type Accessor } from 'solid-js';

import type { ClientSurface } from '@/lib/platform';

import type { DesktopNotificationPermission } from './decision';

export const NOTIFY_FIRST_SEND_KEY = 'onyx:notify-first-send';
export const NOTIFY_FIRST_RUN_DISMISS_KEY = 'onyx:notify-first-run-dismissed';

export const FIRST_RUN_NOTIFY_TITLE = 'Get a ping when you leave';
export const FIRST_RUN_NOTIFY_LEDE =
  'Mentions, DMs, and calls can reach this browser.';

export type NotifyStandaloneProbe = {
  standalone?: boolean;
};

/** iOS Safari tabs cannot receive Web Push. Home Screen standalone can. */
export function canClaimClosedTabPush(navigatorStandalone: boolean | null | undefined): boolean {
  return navigatorStandalone !== false;
}

export function readNavigatorStandalone(
  nav: NotifyStandaloneProbe | null | undefined =
    typeof navigator !== 'undefined' ? (navigator as NotifyStandaloneProbe) : undefined,
): boolean | undefined {
  try {
    return nav?.standalone;
  } catch {
    return undefined;
  }
}

export function firstRunNotifyCopy(navigatorStandalone: boolean | null | undefined): {
  title: string;
  lede: string;
} | null {
  if (!canClaimClosedTabPush(navigatorStandalone)) return null;
  return { title: FIRST_RUN_NOTIFY_TITLE, lede: FIRST_RUN_NOTIFY_LEDE };
}

export function shouldOfferFirstRunNotify(input: {
  sent: boolean;
  dismissed: boolean;
  permission: DesktopNotificationPermission;
  surface: ClientSurface;
  hostNotifications: boolean;
  navigatorStandalone?: boolean | null;
}): boolean {
  if (!input.sent || input.dismissed) return false;
  if (!canClaimClosedTabPush(input.navigatorStandalone)) return false;
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
