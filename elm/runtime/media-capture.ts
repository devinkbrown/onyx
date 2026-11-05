// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerSnapshot } from './contracts';

export type CaptureKind = 'voice' | 'camera' | 'screen';
export interface GestureCaptureIntent { readonly ref: string; readonly owner: OwnerSnapshot; readonly kind: CaptureKind; readonly room: string; /** Private browser ID resolved from the current device directory. */ readonly deviceId?: string }
export interface CaptureReadiness { readonly available: boolean; readonly reason: 'permission-required' | 'unsupported' | 'stale-owner' | 'expired' | 'device-missing' | 'capture-failed' | 'transport-unavailable' | 'activation-barrier' | null }
export interface CaptureLease { readonly stream: MediaStream; readonly audioContext: AudioContext | null; readonly deviceId: string | null }
interface CaptureEntry { readonly intent: GestureCaptureIntent; readonly generation: number; stream: MediaStream | null; promise: Promise<MediaStream> | null; pending: boolean; audioContext: AudioContext | null; audioReady: Promise<void> | null; audioError: unknown | null; expiresAt: number; expiryTimer: ReturnType<typeof setTimeout> | null; claimed: boolean }

/** Private gesture-to-capture bridge. Stream and context references stay in JS. */
export function createMediaCapture(deps: {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly mediaDevices?: MediaDevices | null;
  readonly audioContextFactory?: () => AudioContext;
  readonly now?: () => number;
  readonly lifetimeMs?: number;
}): {
  prepareFromGesture(intent: GestureCaptureIntent): CaptureReadiness;
  claim(ref: string, owner: OwnerSnapshot, room: string): Promise<CaptureLease | null>;
  release(ref: string, owner: OwnerSnapshot, room: string): void;
  retireOwner(owner: OwnerSnapshot): void;
  hasActiveWork(owner: OwnerSnapshot): boolean;
  dispose(): void;
} {
  const devices = deps.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
  const now = deps.now ?? (() => performance.now());
  const entries = new Map<string, CaptureEntry>();
  let generation = 0;
  let disposed = false;
  const lifetime = Math.max(1000, Math.min(deps.lifetimeMs ?? 10_000, 30_000));
  const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot) => a.ownerRef === b.ownerRef && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.networkId === b.networkId && a.accountId === b.accountId
    && a.physicalRef === b.physicalRef;
  const stop = (entry: CaptureEntry) => {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = null;
    for (const track of entry.stream?.getTracks() ?? []) { try { track.stop(); } catch { /* stop best effort */ } }
    entry.stream = null;
    const context = entry.audioContext; entry.audioContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  const valid = (entry: CaptureEntry, owner: OwnerSnapshot, room: string) => !disposed && now() <= entry.expiresAt
    && entry.intent.room === room && sameOwner(entry.intent.owner, owner) && deps.isCurrent(owner)
    && sameOwner(deps.ownerSnapshot(), owner) && entries.get(entry.intent.ref) === entry;
  const prepareFromGesture = (intent: GestureCaptureIntent): CaptureReadiness => {
    if (disposed || !deps.isCurrent(intent.owner) || !sameOwner(deps.ownerSnapshot(), intent.owner)) return { available: false, reason: 'stale-owner' };
    if (!devices) return { available: false, reason: 'unsupported' };
    if (intent.ref.length < 16 || intent.ref.length > 128 || !intent.room || /[\r\n\u0000]/u.test(intent.room)) return { available: false, reason: 'capture-failed' };
    if (intent.kind === 'screen' && !devices.getDisplayMedia) return { available: false, reason: 'unsupported' };
    if (intent.kind !== 'screen' && !devices.getUserMedia) return { available: false, reason: 'unsupported' };
    const prior = entries.get(intent.ref);
    if (prior) stop(prior);
    const entry: CaptureEntry = { intent, generation: ++generation, stream: null, promise: null, pending: true, audioContext: null, audioReady: null,
      audioError: null, expiresAt: now() + lifetime, expiryTimer: null, claimed: false };
    entries.set(intent.ref, entry);
    entry.expiryTimer = setTimeout(() => { if (entries.get(intent.ref) === entry) { stop(entry); entries.delete(intent.ref); } }, lifetime);
    try {
      // Both the actual capture request and playback context resume are invoked
      // synchronously in the trusted call-control handler.
      if (intent.kind !== 'screen' && deps.audioContextFactory) {
        entry.audioContext = deps.audioContextFactory();
        entry.audioReady = entry.audioContext.resume().then(() => undefined).catch(error => { entry.audioError = error; throw error; });
        void entry.audioReady.catch(() => {});
      }
      const audio: MediaTrackConstraints | boolean = intent.deviceId
        ? { deviceId: { exact: intent.deviceId } }
        : true;
      const constraints: MediaStreamConstraints = intent.kind === 'voice'
        ? { audio, video: false }
        : intent.kind === 'camera' ? { audio, video: { facingMode: 'user' } }
          : { audio: false, video: true };
      const streamPromise = intent.kind === 'screen'
        ? devices.getDisplayMedia!({ video: true, audio: false })
        : devices.getUserMedia!(constraints);
      entry.promise = streamPromise.then(async stream => {
        if (!valid(entry, intent.owner, intent.room)) { for (const track of stream.getTracks()) track.stop(); throw new Error('Capture intent expired'); }
        entry.stream = stream;
        await entry.audioReady;
        if (!valid(entry, intent.owner, intent.room)) { stop(entry); throw new Error('Capture owner changed'); }
        return stream;
      }).catch(error => { stop(entry); if (entries.get(intent.ref) === entry) entries.delete(intent.ref); throw error; })
        .finally(() => { entry.pending = false; });
      void entry.promise.catch(() => {});
      return { available: true, reason: null };
    } catch { stop(entry); entries.delete(intent.ref); return { available: false, reason: 'capture-failed' }; }
  };
  return {
    prepareFromGesture,
    async claim(ref, owner, room) {
      const entry = entries.get(ref);
      if (!entry) return null;
      if (!sameOwner(entry.intent.owner, owner) || entry.intent.room !== room) return null;
      if (entry.claimed) return null;
      if (now() > entry.expiresAt || !valid(entry, owner, room)) { stop(entry); entries.delete(ref); return null; }
      entry.claimed = true;
      try {
        const stream = entry.stream ?? await entry.promise;
        if (!stream) { stop(entry); return null; }
        await entry.audioReady;
        if (!valid(entry, owner, room)) { stop(entry); return null; }
        if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
        entry.expiryTimer = null;
        entries.delete(ref); entry.stream = null;
        const audioContext = entry.audioContext; entry.audioContext = null;
        return { stream, audioContext, deviceId: entry.intent.deviceId ?? null };
      } catch { stop(entry); entries.delete(ref); return null; }
    },
    release(ref, owner, room) { const entry = entries.get(ref); if (!entry || !sameOwner(entry.intent.owner, owner) || entry.intent.room !== room) return; stop(entry); entries.delete(ref); },
    retireOwner(owner) { for (const [ref, entry] of entries) if (sameOwner(entry.intent.owner, owner)) { stop(entry); entries.delete(ref); } },
    hasActiveWork(candidate) {
      if (disposed || !deps.isCurrent(candidate) || !sameOwner(deps.ownerSnapshot(), candidate)) return false;
      let active = false;
      for (const [ref, entry] of entries) {
        if (!sameOwner(entry.intent.owner, candidate)) continue;
        if (!valid(entry, candidate, entry.intent.room)) {
          stop(entry);
          entries.delete(ref);
          continue;
        }
        // A claimed entry stays active while the asynchronous claim is still
        // resolving; successful claim removes it before handing off the stream.
        if (entry.pending || entry.stream?.getTracks().some(track => track.readyState === 'live')) active = true;
      }
      return active;
    },
    dispose() { if (disposed) return; disposed = true; for (const entry of entries.values()) stop(entry); entries.clear(); },
  };
}
