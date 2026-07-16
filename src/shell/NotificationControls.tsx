// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, onCleanup, onMount, Show, untrack, type JSX } from 'solid-js';

import { useStore, getState, selectAccount } from '@/lib/store';
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '@/lib/notifications';
import { monitorDesktopNotificationPermission } from '@/lib/notifications/permissionMonitor';
import {
  CALM_PRESETS,
  calmPreset,
  setCalmPreset,
  type CalmPreset,
} from '@/lib/notifications/calmMode';
import { disableWebPush, enableWebPush, webPushActive, webPushSupported } from '@/lib/notifications/webPush';

const CALM_PRESET_LABELS: Record<CalmPreset, string> = {
  calm: 'Calm',
  regular: 'Regular',
  power: 'Power',
};

const CALM_PRESET_HINTS: Record<CalmPreset, string> = {
  calm: 'only mentions and direct messages notify',
  regular: 'mentions and followed conversations notify',
  power: 'all alertable activity notifies',
};

function permissionLabel(active: boolean, permission: DesktopNotificationPermission): string {
  if (permission === 'unsupported') return 'Desktop notifications are not supported';
  if (permission === 'denied') return 'Desktop notifications are blocked by the browser';
  if (active) return 'Disable desktop notifications';
  return 'Enable desktop notifications';
}

function desktopStateLabel(active: boolean, permission: DesktopNotificationPermission): string {
  if (permission === 'unsupported') return 'Desktop notifications unsupported';
  if (permission === 'denied') return 'Desktop notifications blocked';
  return active ? 'Desktop notifications on' : 'Desktop notifications off';
}

function nextCalmPreset(current: CalmPreset): CalmPreset {
  const index = CALM_PRESETS.indexOf(current);
  return CALM_PRESETS[(index + 1) % CALM_PRESETS.length] ?? 'regular';
}

function calmModeLabel(current: CalmPreset): string {
  const next = nextCalmPreset(current);
  return `Notification mode ${CALM_PRESET_LABELS[current]}: ${CALM_PRESET_HINTS[current]}. Switch to ${CALM_PRESET_LABELS[next]}`;
}

export function NotificationControls(): JSX.Element {
  const pushEnabled = useStore((s) => s.pushNotificationsEnabled);
  const soundEnabled = useStore((s) => s.soundEnabled);
  const dndEnabled = useStore((s) => s.dndEnabled);
  const dndUntil = useStore((s) => s.dndUntil);
  const account = useStore(selectAccount);
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());
  const [webPushOn, setWebPushOn] = createSignal(false);
  const [webPushBusy, setWebPushBusy] = createSignal(false);
  const [dndNowMs, setDndNowMs] = createSignal(Date.now());
  let disposed = false;
  let desktopOperation = 0;
  let webPushOperation = 0;
  let dndDeadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const isCurrentWebPushOperation = (operation: number): boolean => !disposed && operation === webPushOperation;
  const isCurrentDesktopOperation = (operation: number): boolean => !disposed && operation === desktopOperation;

  function clearDndDeadlineTimer(): void {
    if (dndDeadlineTimer === undefined) return;
    clearTimeout(dndDeadlineTimer);
    dndDeadlineTimer = undefined;
  }

  function scheduleDndDeadline(deadline: number): void {
    clearDndDeadlineTimer();
    const now = Date.now();
    setDndNowMs(now);

    if (now >= deadline) {
      const state = getState();
      if (state.dndUntil === deadline) state.setDndUntil(null);
      return;
    }

    dndDeadlineTimer = setTimeout(() => {
      dndDeadlineTimer = undefined;
      const settledAt = Date.now();
      setDndNowMs(settledAt);
      // Wall time can move backwards while a timeout uses a monotonic clock.
      // Re-arm for the remaining duration instead of expiring early.
      if (settledAt < deadline) {
        scheduleDndDeadline(deadline);
        return;
      }
      const state = getState();
      if (state.dndUntil === deadline) state.setDndUntil(null);
    }, deadline - now);
  }

  // A timed mute changes state once, at its exact deadline. Re-arm only when
  // that deadline changes; there is no session-long polling clock.
  createEffect(() => {
    const deadline = dndUntil();
    clearDndDeadlineTimer();
    setDndNowMs(Date.now());
    if (deadline !== null) scheduleDndDeadline(deadline);
  });

  onMount(() => {
    const operation = ++webPushOperation;
    void webPushActive().then((active) => {
      if (isCurrentWebPushOperation(operation)) setWebPushOn(active);
    }).catch(() => {
      if (isCurrentWebPushOperation(operation)) setWebPushOn(false);
    });
  });

  onMount(() => {
    const stopMonitoring = monitorDesktopNotificationPermission((nextPermission) => {
      if (disposed || nextPermission === untrack(permission)) return;
      // An external browser/site-settings change supersedes a pending prompt
      // completion. It updates only the displayed permission; the user's push
      // preference is never enabled automatically.
      desktopOperation += 1;
      setPermission(nextPermission);
    }, { readPermission: getDesktopNotificationPermission });
    onCleanup(stopMonitoring);
  });

  onCleanup(() => {
    disposed = true;
    desktopOperation += 1;
    webPushOperation += 1;
    clearDndDeadlineTimer();
  });

  async function handleWebPushToggle(): Promise<void> {
    if (webPushBusy()) return;
    const operation = ++webPushOperation;
    const enable = !webPushOn();
    const startingAccount = account();
    const startingClient = getState().client;
    setWebPushBusy(true);
    try {
      const result = enable ? await enableWebPush() : await disableWebPush();
      if (!isCurrentWebPushOperation(operation)) return;

      const current = getState();
      if (enable && (selectAccount(current) !== startingAccount || current.client !== startingClient)) {
        setWebPushOn(false);
        current.addToast({
          variant: 'warning',
          title: 'Push setup changed',
          description: 'Your account or connection changed before push setup finished. Try again.',
        });
      } else if (result.ok) {
        setWebPushOn(enable);
        current.addToast(enable
          ? { variant: 'success', title: 'Push on', description: 'DMs reach this browser even with the tab closed.' }
          : { variant: 'info', title: 'Push off', description: 'This browser will no longer be nudged while closed.' });
      } else {
        current.addToast({ variant: 'warning', title: 'Push unavailable', description: result.reason });
      }
    } finally {
      if (isCurrentWebPushOperation(operation)) setWebPushBusy(false);
    }
  }

  const dndActive = (): boolean => {
    const until = dndUntil();
    return dndEnabled() || (until !== null && dndNowMs() < until);
  };

  const desktopActive = (): boolean => pushEnabled() && permission() === 'granted';

  async function handleDesktopToggle(): Promise<void> {
    const operation = ++desktopOperation;
    if (desktopActive()) {
      getState().setPushNotificationsEnabled(false);
      return;
    }

    const next = await requestDesktopNotificationPermission();
    if (!isCurrentDesktopOperation(operation)) return;
    setPermission(next);
    getState().setPushNotificationsEnabled(next === 'granted');
  }

  function handleSoundToggle(): void {
    getState().setSoundEnabled(!soundEnabled());
  }

  function handleCalmToggle(): void {
    setCalmPreset(nextCalmPreset(calmPreset()));
  }

  function handleDndToggle(): void {
    const until = dndUntil();
    const now = Date.now();
    // A click can race the deadline callback while the old "Turn off" label is
    // still painted. Settle that expired override instead of converting the
    // click into a new persistent DND enable.
    if (!dndEnabled() && until !== null && now >= until) {
      setDndNowMs(now);
      getState().setDndUntil(null);
      return;
    }
    const next = !dndActive();
    getState().setDndEnabled(next);
    if (!next) getState().setDndUntil(null);
  }

  return (
    <div
      class="shell-notify-controls"
      role="group"
      aria-labelledby="notify-controls-title"
      aria-describedby="notify-controls-state"
    >
      <span id="notify-controls-title" class="sr-only">Notification controls</span>
      <span id="notify-controls-state" class="sr-only">
        {desktopStateLabel(desktopActive(), permission())}; notification mode {CALM_PRESET_LABELS[calmPreset()]}; notification sound {soundEnabled() ? 'on' : 'off'}; do not disturb {dndActive() ? 'on' : 'off'}.
      </span>
      <button
        type="button"
        class={[
          'shell-notify-btn',
          desktopActive() ? 'shell-notify-btn--on' : '',
          permission() === 'denied' ? 'shell-notify-btn--blocked' : '',
        ].filter(Boolean).join(' ')}
        disabled={permission() === 'unsupported' || permission() === 'denied'}
        title={permissionLabel(desktopActive(), permission())}
        aria-label={permissionLabel(desktopActive(), permission())}
        aria-pressed={desktopActive()}
        onClick={() => void handleDesktopToggle()}
      >
        <span aria-hidden="true">N</span>
        <span class="sr-only">{desktopStateLabel(desktopActive(), permission())}</span>
      </button>
      <button
        type="button"
        class={`shell-notify-btn shell-notify-btn--calm shell-notify-btn--calm-${calmPreset()}`}
        title={calmModeLabel(calmPreset())}
        aria-label={calmModeLabel(calmPreset())}
        aria-pressed={calmPreset() !== 'regular'}
        onClick={handleCalmToggle}
      >
        <span aria-hidden="true">{CALM_PRESET_LABELS[calmPreset()].slice(0, 1)}</span>
        <span class="sr-only">Notification mode {CALM_PRESET_LABELS[calmPreset()]}</span>
      </button>
      <button
        type="button"
        class={`shell-notify-btn${soundEnabled() ? ' shell-notify-btn--on' : ''}`}
        title={soundEnabled() ? 'Mute notification sound' : 'Enable notification sound'}
        aria-label={soundEnabled() ? 'Mute notification sound' : 'Enable notification sound'}
        aria-pressed={soundEnabled()}
        onClick={handleSoundToggle}
      >
        <span aria-hidden="true">♪</span>
        <span class="sr-only">Notification sound {soundEnabled() ? 'on' : 'off'}</span>
      </button>
      <Show when={webPushSupported() && account()}>
        <button
          type="button"
          class={`shell-notify-btn${webPushOn() ? ' shell-notify-btn--on' : ''}`}
          disabled={webPushBusy()}
          title={webPushOn() ? 'Turn off push (tab-closed DMs)' : 'Push DMs to this browser even when the tab is closed'}
          aria-label={webPushOn() ? 'Disable web push' : 'Enable web push'}
          aria-pressed={webPushOn()}
          onClick={() => void handleWebPushToggle()}
        >
          <span aria-hidden="true">P</span>
          <span class="sr-only">Web push {webPushOn() ? 'on' : 'off'}</span>
        </button>
      </Show>
      <button
        type="button"
        class={`shell-notify-btn${dndActive() ? ' shell-notify-btn--dnd' : ''}`}
        title={dndActive() ? 'Turn off do not disturb' : 'Turn on do not disturb'}
        aria-label={dndActive() ? 'Turn off do not disturb' : 'Turn on do not disturb'}
        aria-pressed={dndActive()}
        onClick={handleDndToggle}
      >
        <span aria-hidden="true">D</span>
        <span class="sr-only">Do not disturb {dndActive() ? 'on' : 'off'}</span>
      </button>
    </div>
  );
}
