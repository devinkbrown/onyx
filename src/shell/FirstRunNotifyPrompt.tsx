// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * FirstRunNotifyPrompt — one quiet permission sheet after the first send.
 *
 * Never a wall on first paint or Connect. Offers browser permission (and
 * Web Push when signed in) after a successful send on this device.
 * iOS Safari tabs never see this sheet — push only works from Home Screen.
 */
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';

import { Button } from '@/primitives/Button';
import { Sheet } from '@/primitives/Sheet';
import { getState } from '@/lib/store';
import { getDesktopNotificationPermission } from '@/lib/notifications/browser';
import { monitorDesktopNotificationPermission } from '@/lib/notifications/permissionMonitor';
import { armClosedTabNotifications, closedTabArmedToast } from '@/lib/notifications/armClosedTab';
import {
  FIRST_RUN_NOTIFY_LEDE,
  FIRST_RUN_NOTIFY_TITLE,
  dismissNotifyAsk,
  firstRunNotifyCopy,
  hasNotifyFirstSend,
  isIosSafariLike,
  isNotifyAskDismissed,
  readNotifyNavigatorProbe,
  shouldOfferFirstRunNotify,
} from '@/lib/notifications/firstRunNotify';
import { hostCannotNotifyNatively } from '@/lib/notifications/closedTabCopy';
import { isNotificationsOpen } from '@/lib/notifications/youNotificationsState';
import { capabilitiesForSurface, detectClientSurface, isStandaloneDisplayMode } from '@/lib/platform';

import './first-run-notify.css';

export function FirstRunNotifyPrompt(): JSX.Element {
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());
  const [busy, setBusy] = createSignal(false);
  let disposed = false;

  const surface = createMemo(() => detectClientSurface());
  const ios = createMemo(() => isIosSafariLike(readNotifyNavigatorProbe()));
  const standalone = createMemo(() => isStandaloneDisplayMode({
    matchMedia: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null,
    navigator: typeof navigator !== 'undefined'
      ? { standalone: (navigator as { standalone?: boolean }).standalone }
      : null,
  }));
  const copy = createMemo(() => firstRunNotifyCopy({
    ios: ios(),
    standalone: standalone(),
  }));
  const offer = createMemo(() => {
    if (isNotificationsOpen()) return false;
    if (!copy()) return false;
    return shouldOfferFirstRunNotify({
      sent: hasNotifyFirstSend(),
      dismissed: isNotifyAskDismissed(),
      permission: permission(),
      surface: surface(),
      hostNotifications: capabilitiesForSurface(surface()).notifications,
      ios: ios(),
      standalone: standalone(),
    });
  });

  createEffect(() => {
    const stop = monitorDesktopNotificationPermission((next) => {
      if (disposed) return;
      setPermission(next);
    }, { readPermission: getDesktopNotificationPermission });
    onCleanup(stop);
  });

  onCleanup(() => {
    disposed = true;
  });

  function handleOpenChange(open: boolean): void {
    if (!open) dismissNotifyAsk();
  }

  async function handleEnable(): Promise<void> {
    if (busy() || hostCannotNotifyNatively(surface(), capabilitiesForSurface(surface()))) {
      return;
    }
    if (!copy()) return;
    setBusy(true);
    try {
      const result = await armClosedTabNotifications();
      if (disposed) return;
      setPermission(result.permission);
      dismissNotifyAsk();
      getState().addToast(closedTabArmedToast(result));
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  return (
    <Sheet
      data-testid="first-run-notify"
      open={offer()}
      onOpenChange={handleOpenChange}
      title={copy()?.title ?? FIRST_RUN_NOTIFY_TITLE}
      description={copy()?.lede ?? FIRST_RUN_NOTIFY_LEDE}
      closeLabel="Not now"
    >
      <div class="first-run-notify">
        <div class="first-run-notify__actions">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={busy()}
            data-testid="first-run-notify-enable"
            onClick={() => void handleEnable()}
          >
            Turn on
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="first-run-notify-dismiss"
            onClick={() => dismissNotifyAsk()}
          >
            Not now
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
