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
import { channelNotifyMode, type NotifyMode } from '@/lib/notifications/channelNotifyMode';

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
  const channelNotify = useStore((s) => s.channelNotify);
  const roomNotifyCopy = createMemo(() => {
    const channel = roomChannel();
    const mode: NotifyMode = channel ? channelNotifyMode(channelNotify(), channel) : 'all';
    const modeCopy = mode === 'all'
      ? 'All: room messages may create inbox entries, unread/badge activity, sound, and desktop alerts.'
      : mode === 'mentions'
        ? 'Mentions only: this room contributes only messages that mention you to notification decisions. Followed-conversation activity is a separate global Calm-mode tier and may still add a badge or alert when that mode allows it.'
        : 'Mute: this room is hard-silenced; its messages create no inbox entries, unread counts, highlights, sound, or desktop alerts.';
    return `${modeCopy} Browser permission is required for desktop alerts; the global Onyx notification mode, DND/quiet hours, and sound setting are separate gates. Closed-tab delivery additionally requires alerts to be armed for this signed-in browser and an available connection.`;
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
    // A connection/account change supersedes any in-flight user operation.
    // Clear the presentation state immediately; stale completions below may
    // never publish their result, but must not strand the controls disabled.
    setBusy(false);
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
    setBusy(false);
  });

  async function handleEnable(): Promise<void> {
    if (busy() || hostHonesty().notice) return;
    const operation = ++webPushOperation;
    const startingAccount = account();
    const startingClient = getState().client;
    const startingConnection = connectionStatus();
    const isCurrent = (): boolean => !disposed
      && operation === webPushOperation
      && account() === startingAccount
      && getState().client === startingClient
      && connectionStatus() === startingConnection;
    setBusy(true);
    try {
      const result = await armClosedTabNotifications();
      if (!isCurrent()) return;
      setPermission(result.permission);
      setWebPushOn(result.webPush.ok);
      getState().addToast(closedTabArmedToast(result));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function handleDisable(): Promise<void> {
    if (busy()) return;
    const operation = ++webPushOperation;
    const startingAccount = account();
    const startingClient = getState().client;
    const startingConnection = connectionStatus();
    const isCurrent = (): boolean => !disposed
      && operation === webPushOperation
      && account() === startingAccount
      && getState().client === startingClient
      && connectionStatus() === startingConnection;
    setBusy(true);
    try {
      const result = await disableWebPush();
      if (!isCurrent()) return;
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
      if (isCurrent()) setBusy(false);
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
          <strong>Effective alerts have three layers:</strong> this browser must allow desktop notifications, your Onyx mode chooses what is alertable, and each room can narrow its own policy. Inbox and badge activity follow the selected mode; DND/quiet hours and sound are separate alert gates. Closed-tab delivery also requires alerts to be armed for this signed-in browser and an available connection — permission alone is not enough.
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
                {roomNotifyCopy()}
              </p>
              <ChannelNotifyControl channel={channel()} />
            </section>
          )}
        </Show>
      </div>
    </Sheet>
  );
}
