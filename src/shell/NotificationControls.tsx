import { createSignal, onMount, Show, type JSX } from 'solid-js';

import { useStore, getState, selectAccount } from '@/lib/store';
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '@/lib/notifications';
import { disableWebPush, enableWebPush, webPushActive, webPushSupported } from '@/lib/notifications/webPush';

function permissionLabel(permission: DesktopNotificationPermission): string {
  if (permission === 'unsupported') return 'Desktop notifications are not supported';
  if (permission === 'denied') return 'Desktop notifications are blocked by the browser';
  if (permission === 'granted') return 'Desktop notifications are enabled';
  return 'Enable desktop notifications';
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

  function handleDndToggle(): void {
    const next = !dndActive();
    getState().setDndEnabled(next);
    if (!next) getState().setDndUntil(null);
  }

  return (
    <div class="shell-notify-controls" role="group" aria-label="Notification controls">
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
      </button>
    </div>
  );
}
