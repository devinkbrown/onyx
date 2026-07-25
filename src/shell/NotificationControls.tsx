// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack, type JSX } from 'solid-js';

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
import { isQuietHoursActive } from '@/lib/notifications/quietHours';
import { loadSmartMute } from '@/lib/notifications/smartMuteMemory';
import { Popover } from '@/primitives/Popover';
import { selectDeviceMemoryOwner } from '@/lib/store';
import {
  disableWebPush,
  enableWebPush,
  recoverWebPush,
  webPushActive,
  webPushIntentDesired,
  webPushSupported,
} from '@/lib/notifications/webPush';

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

/** Hour options 0–23 for the quiet-hours schedule selects. */
const QUIET_HOUR_OPTIONS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

function formatQuietHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

function quietHoursSummary(start: number, end: number): string {
  if (start === end) return 'quiet hours off';
  return `quiet hours ${formatQuietHour(start)} to ${formatQuietHour(end)}`;
}

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
  const dndQuietStart = useStore((s) => s.dndQuietStart);
  const dndQuietEnd = useStore((s) => s.dndQuietEnd);
  const account = useStore(selectAccount);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  const connectionStatus = useStore((s) => s.connectionStatus);
  const smartMuteSummary = (): string => {
    const owner = memoryOwner();
    if (!owner) return 'smart mute off';
    const rules = loadSmartMute(owner);
    if (rules.keywords.length === 0 && !rules.muteSystemNoise) return 'smart mute off';
    const bits: string[] = [];
    if (rules.keywords.length > 0) bits.push(`${rules.keywords.length} keyword mute${rules.keywords.length === 1 ? '' : 's'}`);
    if (rules.muteSystemNoise) bits.push('system alerts muted');
    return bits.join(', ');
  };
  const webPushOwnerScope = useStore((s) => (
    s.server ? JSON.stringify([s.server.url, selectAccount(s)]) : null
  ));
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());
  const [webPushOn, setWebPushOn] = createSignal(false);
  const [webPushBusy, setWebPushBusy] = createSignal(false);
  const [quietHoursOpen, setQuietHoursOpen] = createSignal(false);
  const [dndNowMs, setDndNowMs] = createSignal(Date.now());
  // Bumps to re-run recovery after an external permission grant or SW update
  // without treating those events as a user toggle.
  const [webPushRecoveryEpoch, setWebPushRecoveryEpoch] = createSignal(0);
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

  // A PushSubscription is browser-global. Reconcile it whenever the connected
  // server/account owner changes so a replacement account cannot inherit the
  // prior owner's endpoint. A fully disconnected client deliberately skips
  // recovery (push must keep working while the tab is closed) and only refreshes
  // the active bit. When connected + prior intent, recoverWebPush re-binds a
  // missing/expired endpoint and re-sends WEBPUSH SUBSCRIBE — always with a
  // typed reason, never a silent no-op.
  createEffect(() => {
    const ownerScope = webPushOwnerScope();
    const connected = connectionStatus() === 'connected';
    webPushRecoveryEpoch(); // subscribe to external recovery triggers
    const operation = ++webPushOperation;
    setWebPushBusy(false);
    setWebPushOn(false);
    if (ownerScope === null) return;
    void (async () => {
      try {
        let active = await webPushActive();
        if (!isCurrentWebPushOperation(operation)) return;
        if (!active && connected && webPushIntentDesired()) {
          const recovered = await recoverWebPush();
          if (!isCurrentWebPushOperation(operation)) return;
          active = recovered.ok;
        }
        if (isCurrentWebPushOperation(operation)) setWebPushOn(active);
      } catch {
        if (isCurrentWebPushOperation(operation)) setWebPushOn(false);
      }
    })();
  });

  onMount(() => {
    const stopMonitoring = monitorDesktopNotificationPermission((nextPermission) => {
      if (disposed) return;
      const previous = untrack(permission);
      if (nextPermission === previous) return;
      // An external browser/site-settings change supersedes a pending prompt
      // completion. It updates only the displayed permission; desktop prefs are
      // never enabled automatically. Web-push recovery may re-bind when the
      // user previously opted in and permission becomes granted.
      desktopOperation += 1;
      setPermission(nextPermission);
      if (nextPermission === 'granted' && webPushIntentDesired()) {
        setWebPushRecoveryEpoch((epoch) => epoch + 1);
      }
    }, { readPermission: getDesktopNotificationPermission });
    onCleanup(stopMonitoring);

    // A waiting worker that claims this page can drop or replace the push
    // subscription surface. Re-run recovery without a full reload.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const onControllerChange = () => {
        if (disposed) return;
        if (webPushIntentDesired()) setWebPushRecoveryEpoch((epoch) => epoch + 1);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      onCleanup(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      });
    }
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
      if (disposed) return;
      const current = getState();
      if (enable && (selectAccount(current) !== startingAccount || current.client !== startingClient)) {
        setWebPushOn(false);
        setWebPushBusy(false);
        current.addToast({
          variant: 'warning',
          title: 'Push setup changed',
          description: 'Your account or connection changed before push setup finished. Try again.',
        });
      } else if (!isCurrentWebPushOperation(operation)) {
        return;
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

  /** Standing quiet-hours window currently silencing (independent of the D toggle). */
  const quietHoursSilencing = (): boolean => isQuietHoursActive({
    enabled: true,
    startMinute: dndQuietStart() * 60,
    endMinute: dndQuietEnd() * 60,
  }, new Date(dndNowMs()));

  const desktopActive = (): boolean => pushEnabled() && permission() === 'granted';

  function handleQuietStartChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    const next = Number(event.currentTarget.value);
    getState().setDndQuietHours(next, dndQuietEnd());
  }

  function handleQuietEndChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    const next = Number(event.currentTarget.value);
    getState().setDndQuietHours(dndQuietStart(), next);
  }

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
        {desktopStateLabel(desktopActive(), permission())}; notification mode {CALM_PRESET_LABELS[calmPreset()]}; notification sound {soundEnabled() ? 'on' : 'off'}; do not disturb {dndActive() ? 'on' : 'off'}; {quietHoursSummary(dndQuietStart(), dndQuietEnd())}{quietHoursSilencing() ? ', currently active' : ''}; {smartMuteSummary()}.
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
      <span class="shell-notify-quiet-popover">
        <Popover
          open={quietHoursOpen()}
          onOpenChange={setQuietHoursOpen}
          placement="bottom"
          panelLabel="Quiet hours"
          trigger={
            <span
              class={`shell-notify-btn shell-notify-quiet-trigger${quietHoursSilencing() ? ' shell-notify-quiet-trigger--active' : ''}`}
              title={`Quiet hours — ${quietHoursSummary(dndQuietStart(), dndQuietEnd())}`}
            >
              <span aria-hidden="true">Q</span>
              <span class="sr-only">Quiet hours</span>
            </span>
          }
        >
          <div class="shell-notify-quiet-panel">
          <div class="shell-notify-quiet-head">
            <p class="shell-notify-quiet-title">Quiet hours</p>
            <p class="shell-notify-quiet-summary">{quietHoursSummary(dndQuietStart(), dndQuietEnd())}</p>
          </div>
          <p class="shell-notify-quiet-copy">Silence alerts on this daily schedule.</p>
          <div class="shell-notify-quiet-range">
            <label class="shell-notify-quiet-field">
              <span>Start</span>
              <select
                class="shell-notify-quiet-select"
                aria-label="Quiet hours start"
                value={dndQuietStart()}
                onChange={handleQuietStartChange}
              >
                <For each={QUIET_HOUR_OPTIONS}>
                  {(hour) => <option value={hour}>{formatQuietHour(hour)}</option>}
                </For>
              </select>
            </label>
            <span class="shell-notify-quiet-sep" aria-hidden="true">→</span>
            <label class="shell-notify-quiet-field">
              <span>End</span>
              <select
                class="shell-notify-quiet-select"
                aria-label="Quiet hours end"
                value={dndQuietEnd()}
                onChange={handleQuietEndChange}
              >
                <For each={QUIET_HOUR_OPTIONS}>
                  {(hour) => <option value={hour}>{formatQuietHour(hour)}</option>}
                </For>
              </select>
            </label>
          </div>
          </div>
        </Popover>
      </span>
    </div>
  );
}
