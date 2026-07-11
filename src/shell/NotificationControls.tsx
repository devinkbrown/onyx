// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal, onMount, Show, type JSX } from 'solid-js';

import { useStore, getState, selectAccount } from '@/lib/store';
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '@/lib/notifications';
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

function permissionLabel(permission: DesktopNotificationPermission): string {
  if (permission === 'unsupported') return 'Desktop notifications are not supported';
  if (permission === 'denied') return 'Desktop notifications are blocked by the browser';
  if (permission === 'granted') return 'Desktop notifications are enabled';
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

  onMount(() => {
    void webPushActive().then(setWebPushOn);
  });

  async function handleWebPushToggle(): Promise<void> {
    if (webPushBusy()) return;
    setWebPushBusy(true);
    try {
      if (webPushOn()) {
        await disableWebPush();
        setWebPushOn(false);
        getState().addToast({ variant: 'info', title: 'Push off', description: 'This browser will no longer be nudged while closed.' });
      } else {
        const result = await enableWebPush();
        if (result.ok) {
          setWebPushOn(true);
          getState().addToast({ variant: 'success', title: 'Push on', description: 'DMs reach this browser even with the tab closed.' });
        } else {
          getState().addToast({ variant: 'warning', title: 'Push unavailable', description: result.reason });
        }
      }
    } finally {
      setWebPushBusy(false);
    }
  }

  const dndActive = (): boolean => {
    const until = dndUntil();
    return dndEnabled() || (until !== null && Date.now() < until);
  };

  const desktopActive = (): boolean => pushEnabled() && permission() === 'granted';

  async function handleDesktopToggle(): Promise<void> {
    if (desktopActive()) {
      getState().setPushNotificationsEnabled(false);
      return;
    }

    const next = await requestDesktopNotificationPermission();
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
        title={permissionLabel(permission())}
        aria-label={permissionLabel(permission())}
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
