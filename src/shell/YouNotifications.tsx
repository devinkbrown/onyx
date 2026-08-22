// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * YouNotifications — short You → Notifications page.
 *
 * Product path for closed-tab mentions / DMs / calls on the existing SW +
 * WEBPUSH contract. Mute / mentions-only reuses ChannelNotifyControl. Host
 * copy stays honest when the Zig desktop matrix has notifications: false.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';

import { Button } from '@/primitives/Button';
import { Sheet } from '@/primitives/Sheet';
import { getState, selectAccount, useStore } from '@/lib/store';
import {
  disableWebPush,
  recoverWebPush,
  webPushActive,
  webPushIntentDesired,
  webPushSupported,
} from '@/lib/notifications/webPush';
import { armClosedTabNotifications, closedTabArmedToast } from '@/lib/notifications/armClosedTab';
import {
  CLOSED_TAB_KIND_COPY,
  CLOSED_TAB_KINDS,
  closedTabStatusCopy,
  hostNotifyHonesty,
} from '@/lib/notifications/closedTabCopy';
import {
  getDesktopNotificationPermission,
} from '@/lib/notifications/browser';
import { monitorDesktopNotificationPermission } from '@/lib/notifications/permissionMonitor';
import type { DesktopNotificationPermission } from '@/lib/notifications/decision';
import {
  capabilitiesForSurface,
  detectClientSurface,
} from '@/lib/platform';
import {
  closeNotifications,
  isNotificationsOpen,
} from '@/lib/notifications/youNotificationsState';

import { ChannelNotifyControl } from './ChannelNotifyControl';
import { YouHubNav } from './YouHubNav';
import './you-notifications.css';

export function YouNotifications(): JSX.Element {
  const account = useStore(selectAccount);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const activeView = useStore((s) => s.activeView);
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());
  const [webPushOn, setWebPushOn] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [recoveryEpoch, setRecoveryEpoch] = createSignal(0);
  let disposed = false;
  let webPushOperation = 0;

  const surface = createMemo(() => detectClientSurface());
  const hostHonesty = createMemo(() => hostNotifyHonesty({
    surface: surface(),
    capabilities: capabilitiesForSurface(surface()),
  }));
  const roomChannel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });
  const kindsOn = createMemo(() => webPushOn() && permission() === 'granted');
  const status = createMemo(() => closedTabStatusCopy({
    permission: permission(),
    webPushOn: webPushOn(),
    signedIn: Boolean(account()),
    webPushSupported: webPushSupported(),
    hostNotice: hostHonesty().notice,
  }));
  const canArmBrowserAlerts = createMemo(() => (
    !hostHonesty().notice
    && permission() !== 'unsupported'
    && permission() !== 'denied'
  ));

  createEffect(() => {
    const connected = connectionStatus() === 'connected';
    recoveryEpoch();
    account();
    const operation = ++webPushOperation;
    setWebPushOn(false);
    if (!account()) return;
    void (async () => {
      try {
        let active = await webPushActive();
        if (disposed || operation !== webPushOperation) return;
        if (!active && connected && webPushIntentDesired()) {
          const recovered = await recoverWebPush();
          if (disposed || operation !== webPushOperation) return;
          active = recovered.ok;
        }
        if (!disposed && operation === webPushOperation) setWebPushOn(active);
      } catch {
        if (!disposed && operation === webPushOperation) setWebPushOn(false);
      }
    })();
  });

  createEffect(() => {
    if (!isNotificationsOpen()) return;
    const stop = monitorDesktopNotificationPermission((next: DesktopNotificationPermission) => {
      if (disposed) return;
      setPermission(next);
      if (next === 'granted' && webPushIntentDesired()) {
        setRecoveryEpoch((epoch) => epoch + 1);
      }
    }, { readPermission: getDesktopNotificationPermission });
    onCleanup(stop);
  });

  onCleanup(() => {
    disposed = true;
    webPushOperation += 1;
  });

  async function handleEnable(): Promise<void> {
    if (busy() || hostHonesty().notice) return;
    const operation = ++webPushOperation;
    setBusy(true);
    try {
      const result = await armClosedTabNotifications();
      if (disposed || operation !== webPushOperation) return;
      setPermission(result.permission);
      setWebPushOn(result.webPush.ok);
      getState().addToast(closedTabArmedToast(result));
    } finally {
      if (!disposed && operation === webPushOperation) setBusy(false);
    }
  }

  async function handleDisable(): Promise<void> {
    if (busy()) return;
    const operation = ++webPushOperation;
    setBusy(true);
    try {
      const result = await disableWebPush();
      if (disposed || operation !== webPushOperation) return;
      if (result.ok) {
        setWebPushOn(false);
        getState().addToast({
          variant: 'info',
          title: 'Closed-tab alerts off',
          description: 'This browser will not be pinged for mentions, DMs, or calls while the tab is closed.',
        });
      } else {
        getState().addToast({ variant: 'warning', title: 'Push unavailable', description: result.reason });
      }
    } finally {
      if (!disposed && operation === webPushOperation) setBusy(false);
    }
  }

  return (
    <Sheet
      open={isNotificationsOpen()}
      onOpenChange={(open) => (open ? undefined : closeNotifications())}
      title="Notifications"
      description="Mentions, DMs, and calls"
      closeLabel="Close notifications"
    >
      <div class="you-notify" data-testid="you-notifications">
        <YouHubNav current="notifications" onLeave={closeNotifications} />
        <p class="you-notify-lede">
          Mentions, DMs, and calls can reach you after this tab closes. Onyx uses this browser and the network you already joined — not a third-party push service.
        </p>
        <p
          class="you-notify-status"
          data-testid="you-notifications-status"
          data-kind={hostHonesty().notice ? 'host' : 'browser'}
        >
          {status()}
        </p>
        <Show when={!hostHonesty().notice}>
          <Show
            when={webPushOn()}
            fallback={
              <Button
                type="button"
                variant="primary"
                disabled={busy() || !canArmBrowserAlerts()}
                aria-busy={busy()}
                data-testid="you-notifications-enable"
                onClick={() => void handleEnable()}
              >
                Turn on alerts
              </Button>
            }
          >
            <Button
              type="button"
              variant="ghost"
              disabled={busy()}
              aria-busy={busy()}
              data-testid="you-notifications-disable"
              onClick={() => void handleDisable()}
            >
              Turn off closed-tab alerts
            </Button>
          </Show>
        </Show>
        <section aria-labelledby="you-notify-kinds-title">
          <h3 id="you-notify-kinds-title" class="you-notify-room-title">What can ping</h3>
          <ul class="you-notify-kinds">
            <For each={CLOSED_TAB_KINDS}>
              {(kind) => (
                <li class="you-notify-kind" data-on={kindsOn() ? 'true' : 'false'} data-kind={kind}>
                  <span class="you-notify-kind-mark" aria-hidden="true" />
                  <p class="you-notify-kind-title">{CLOSED_TAB_KIND_COPY[kind].title}</p>
                  <p class="you-notify-kind-body">{CLOSED_TAB_KIND_COPY[kind].body}</p>
                </li>
              )}
            </For>
          </ul>
        </section>
        <Show when={roomChannel()}>
          {(channel) => (
            <section class="you-notify-room" aria-labelledby="you-notify-room-title">
              <h3 id="you-notify-room-title" class="you-notify-room-title">This room</h3>
              <p class="you-notify-room-copy">
                All messages, mentions only, or mute — your alerts for {channel()} on this device.
              </p>
              <ChannelNotifyControl channel={channel()} />
            </section>
          )}
        </Show>
      </div>
    </Sheet>
  );
}
