// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * voice-engine.ts — bundle entry that mounts `window.OnyxVoiceEngine` for the
 * Elm client (built by elm/tools/build.sh → voice.<hash>.js, loaded by
 * elm/index.html BEFORE ports.js so `mountVoiceFeed` finds it).
 *
 * The real Cadence engine runs here unchanged; voice-core.ts adapts it to the
 * ports.js contract. Browser glue lives here:
 *   - media key trust: the same TOFU pin store the SolidJS client used
 *     (`onyx-key-pins`, subject `<nick>#media-device#<binding>`);
 *   - device-key enrollment (`IDENTITY ADD`, the label/transcript the
 *     attribution flow uses) so the server admits our E2EE handshake;
 *   - WebKit/iOS: capture inside the gesture, AudioContext unlock/resume,
 *     the call audio session, and recovery on foreground / route change.
 */
import { CadenceMediaEngine } from '@/lib/cadence-media/MediaEngine';
import { peerKeyStatus, pinPeerTrustBinding } from '@/lib/e2ee/keyPinning';
import { buildIdentityTranscript, deviceLabel, deviceSigningKeys, signHex } from '@/lib/e2ee/deviceSign';
import { createVoiceAdapter } from './voice-core';
import { detectPlatform, installAudioUnlock } from './platform';

declare global {
  interface Window {
    OnyxVoiceEngine?: unknown;
    __onyxVideoWorkerUrl?: string;
  }
}

declare const __ONYX_VIDEO_WORKER__: string;

(function mountOnyxVoiceEngine() {
  if (typeof window === 'undefined' || window.OnyxVoiceEngine) return;
  // The video encode worker ships next to this script (hashed by build.sh);
  // MediaEngine resolves it through `__onyxVideoWorkerUrl` (build-voice.mjs).
  try {
    const self = document.currentScript as HTMLScriptElement | null;
    if (self && self.src && __ONYX_VIDEO_WORKER__) {
      window.__onyxVideoWorkerUrl = new URL(__ONYX_VIDEO_WORKER__, self.src).href;
    }
  } catch { /* video falls back to the main-thread encoder */ }

  const platform = detectPlatform(navigator as never, window);
  // Before the engine exists, so every AudioContext it makes is tracked.
  const audio = installAudioUnlock(window);
  const md = navigator.mediaDevices;

  const adapter = createVoiceAdapter({
    // Cameras: cadencevis keyframes are near-lossless (~1.9 bytes/pixel), so
    // the Elm build sends a phone-sized 320x176 @ 12 fps camera (~2 Mbit/s)
    // instead of the engine's 1080p60 default, which no encoder size ladder
    // step, mobile uplink, or default server SendQ can carry.
    createEngine: (callbacks) => new CadenceMediaEngine(callbacks, {
      kind: 'voice',
      camera: { width: 320, height: 176, fps: 12, quality: 40 },
    }),
    platform,
    audio,
    getUserMedia: md && typeof md.getUserMedia === 'function'
      ? (constraints) => md.getUserMedia(constraints)
      : undefined,
    userActivation: () => {
      const ua = (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation;
      return ua ? ua.isActive : null;
    },
    async enrollIdentity(account) {
      const keys = await deviceSigningKeys();
      if (!keys) return null;
      const label = deviceLabel(keys.publicHex);
      const transcript = buildIdentityTranscript(account, label, keys.publicRaw);
      if (!transcript) return null;
      const sig = await signHex(transcript);
      return sig ? { label, publicHex: keys.publicHex, sig } : null;
    },
    async verifyPeerMediaKey(owner, nick, _publicKeyB64url, _attachmentId, trustBinding) {
      const subject = `${nick.toLowerCase()}#media-device#${trustBinding}`;
      const verdict = await peerKeyStatus(subject, trustBinding, owner);
      if (verdict === 'changed' || verdict === 'unreadable') return false;
      if (verdict === 'first-use') return pinPeerTrustBinding(subject, trustBinding, owner);
      return true;
    },
    log(message) {
      try { console.warn(`[onyx] ${message}`); } catch { /* no console */ }
    },
  });

  // Recovery: foreground return, bfcache restore, audio route changes, and
  // any tap (WebKit may only grant capture/audio again inside a gesture).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') adapter.recover('visible');
  });
  window.addEventListener('pageshow', () => adapter.recover('pageshow'));
  window.addEventListener('focus', () => adapter.recover('focus'));
  try { md?.addEventListener('devicechange', () => adapter.recover('route-change')); } catch { /* old WebKit */ }
  window.addEventListener('pointerdown', () => adapter.recover('gesture', true), { capture: true, passive: true });

  // Video stays OFF on the live network for now: the cadencevis codec runs
  // ~2 Mbit/s per camera, and the production node's stock 1 MiB SendQ can
  // disconnect the OTHER people in the call. Voice is unaffected. Flip this
  // once the codec is lighter or the SendQ is raised (the UI follows it via
  // the `cameraSupported` capability).
  const VIDEO_ENABLED = false;
  const startCamera = adapter.startCamera.bind(adapter);
  const joinVoice = adapter.joinVoice.bind(adapter);
  Object.assign(adapter, {
    videoEnabled: VIDEO_ENABLED,
    startCamera: (channel?: string) => (VIDEO_ENABLED ? startCamera(channel) : Promise.resolve(false)),
    // "Join with video" must not reach engine.joinVideo either.
    joinVoice: (channel: string, opts?: { video?: boolean }) =>
      joinVoice(channel, { ...(opts || {}), video: VIDEO_ENABLED && !!(opts && opts.video) }),
  });

  window.OnyxVoiceEngine = adapter;
})();
