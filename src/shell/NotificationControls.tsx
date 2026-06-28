import { createSignal, type JSX } from 'solid-js';

import { useStore, getState } from '@/lib/store';
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '@/lib/notifications';

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
  const [permission, setPermission] = createSignal(getDesktopNotificationPermission());

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
