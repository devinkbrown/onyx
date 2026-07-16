// SPDX-License-Identifier: AGPL-3.0-or-later

/** Conferencing actions added to Media Session after TypeScript's base DOM set. */
export type CallMediaSessionAction =
  | 'togglemicrophone'
  | 'togglecamera'
  | 'hangup';

type CallMediaSessionActionHandler = () => void;

/**
 * Deliberately small structural view of MediaSession. The conferencing actions
 * are newer than the MediaSessionAction union in some TypeScript DOM releases,
 * so callers must remain runtime-feature-detected even when the base API exists.
 */
export interface CallMediaSession {
  metadata: MediaMetadata | null;
  setActionHandler(
    action: CallMediaSessionAction,
    handler: CallMediaSessionActionHandler | null,
  ): void;
  setMicrophoneActive?(active: boolean): Promise<void>;
  setCameraActive?(active: boolean): Promise<void>;
}

export interface CallMediaSessionState {
  active: boolean;
  muted: boolean;
  cameraOn: boolean;
}

export interface CallMediaSessionController {
  update(state: CallMediaSessionState): void;
  dispose(): void;
}

interface CallMediaSessionOptions {
  session?: CallMediaSession;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onHangup: () => void;
}

function browserCallMediaSession(): CallMediaSession | undefined {
  if (typeof navigator === 'undefined') return undefined;
  try {
    return navigator.mediaSession as unknown as CallMediaSession;
  } catch {
    // Capability getters can throw in restricted browsing contexts.
    return undefined;
  }
}

function callMetadata(): MediaMetadata | null {
  if (typeof MediaMetadata === 'undefined') return null;
  try {
    // Avoid exposing a channel or correspondent on the lock screen. The OS can
    // still identify Onyx and surface the registered call controls.
    return new MediaMetadata({ title: 'Onyx voice call', artist: 'Onyx' });
  } catch {
    return null;
  }
}

function setCaptureState(
  setter: ((active: boolean) => Promise<void>) | undefined,
  active: boolean,
): void {
  if (!setter) return;
  try {
    void setter(active).catch(() => {
      // Capture-state hints are advisory; media behavior remains in the store.
    });
  } catch {
    // Some partial implementations expose a method that still throws.
  }
}

/**
 * Publish an accepted Onyx call to browser/OS conferencing controls.
 *
 * No handler is installed until update({ active: true }). Unsupported actions
 * are skipped independently because browsers often ship the Media Session base
 * API before its conferencing extensions. Deactivation and disposal clear only
 * handlers this controller installed and restore the preceding metadata.
 */
export function createCallMediaSessionController(
  options: CallMediaSessionOptions,
): CallMediaSessionController {
  const session = options.session ?? browserCallMediaSession();
  let disposed = false;
  let active = false;
  let previousMetadata: MediaMetadata | null = null;
  let lastMicrophoneActive: boolean | null = null;
  let lastCameraActive: boolean | null = null;
  const installedActions = new Set<CallMediaSessionAction>();

  const actions: ReadonlyArray<readonly [CallMediaSessionAction, CallMediaSessionActionHandler]> = [
    ['togglemicrophone', options.onToggleMicrophone],
    ['togglecamera', options.onToggleCamera],
    ['hangup', options.onHangup],
  ];

  const install = () => {
    if (!session) return;
    previousMetadata = session.metadata;
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
        installedActions.add(action);
      } catch {
        // An unsupported conferencing action must not hide the actions that do
        // exist in this browser.
      }
    }
    const metadata = callMetadata();
    if (metadata) {
      try { session.metadata = metadata; } catch {}
    }
  };

  const clear = () => {
    if (!session) return;
    for (const action of installedActions) {
      try { session.setActionHandler(action, null); } catch {}
    }
    installedActions.clear();
    try { session.metadata = previousMetadata; } catch {}
    previousMetadata = null;
  };

  return {
    update(state) {
      if (disposed || !session) return;
      if (!state.active) {
        if (!active) return;
        active = false;
        if (lastMicrophoneActive !== false) {
          setCaptureState(session.setMicrophoneActive?.bind(session), false);
        }
        if (lastCameraActive !== false) {
          setCaptureState(session.setCameraActive?.bind(session), false);
        }
        lastMicrophoneActive = null;
        lastCameraActive = null;
        clear();
        return;
      }

      if (!active) {
        active = true;
        install();
      }

      const microphoneActive = !state.muted;
      if (lastMicrophoneActive !== microphoneActive) {
        lastMicrophoneActive = microphoneActive;
        setCaptureState(session.setMicrophoneActive?.bind(session), microphoneActive);
      }
      if (lastCameraActive !== state.cameraOn) {
        lastCameraActive = state.cameraOn;
        setCaptureState(session.setCameraActive?.bind(session), state.cameraOn);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (session && active) {
        setCaptureState(session.setMicrophoneActive?.bind(session), false);
        setCaptureState(session.setCameraActive?.bind(session), false);
        active = false;
        clear();
      }
      lastMicrophoneActive = null;
      lastCameraActive = null;
    },
  };
}
