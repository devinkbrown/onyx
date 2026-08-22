// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * FirstRunNotifyPrompt — one quiet closed-tab ask after real chat.
 *
 * Never a wall on Connect. Offers browser permission (and Web Push when
 * signed in) after a real send/receive, or the user can open You → Notifications.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';

import { Button } from '@/primitives/Button';
import { getState, subscribe } from '@/lib/store';
import { getDesktopNotificationPermission } from '@/lib/notifications/browser';
import { monitorDesktopNotificationPermission } from '@/lib/notifications/permissionMonitor';
import { armClosedTabNotifications, closedTabArmedToast } from '@/lib/notifications/armClosedTab';
import {
  dismissNotifyAsk,
  hasNotifyActivity,
  isNotifyAskDismissed,
  markNotifyActivity,
  shouldOfferFirstRunNotify,
  stateHasRealConversationActivity,
} from '@/lib/notifications/firstRunNotify';
import { hostCannotNotifyNatively } from '@/lib/notifications/closedTabCopy';
import { isNotificationsOpen, openNotifications } from '@/lib/notifications/youNotificationsState';
import { capabilitiesForSurface, detectClientSurface } from '@/lib/platform';

import './first-run-notify.css';

export function FirstRunNotifyPrompt(): JSX.Element {
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());
  const [busy, setBusy] = createSignal(false);
  let disposed = false;

  const surface = createMemo(() => detectClientSurface());
  const offer = createMemo(() => {
    if (isNotificationsOpen()) return false;
    return shouldOfferFirstRunNotify({
      activity: hasNotifyActivity(),
      dismissed: isNotifyAskDismissed(),
      permission: permission(),
      surface: surface(),
      hostNotifications: capabilitiesForSurface(surface()).notifications,
    });
  });

  createEffect(() => {
    if (hasNotifyActivity()) return;
    if (stateHasRealConversationActivity(getState())) markNotifyActivity();
    const unsubscribe = subscribe(
      (state) => stateHasRealConversationActivity(state),
      (hasReal) => {
        if (hasReal) markNotifyActivity();
      },
    );
    onCleanup(unsubscribe);
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

  function handleDismiss(): void {
    dismissNotifyAsk();
  }

  async function handleEnable(): Promise<void> {
    if (busy() || hostCannotNotifyNatively(surface(), capabilitiesForSurface(surface()))) {
      return;
    }
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

  function handleOpenYou(): void {
    dismissNotifyAsk();
    openNotifications();
  }

  return (
    <Show when={offer()}>
      <div
        class="first-run-notify"
        data-testid="first-run-notify"
        role="region"
        aria-label="Closed-tab notifications"
      >
        <p class="first-run-notify__text">
          Get a ping for mentions, DMs, or calls when this tab is closed.
        </p>
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
            data-testid="first-run-notify-settings"
            onClick={handleOpenYou}
          >
            Notifications
          </Button>
          <button
            type="button"
            class="first-run-notify__dismiss"
            aria-label="Not now"
            data-testid="first-run-notify-dismiss"
            onClick={handleDismiss}
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  );
}
