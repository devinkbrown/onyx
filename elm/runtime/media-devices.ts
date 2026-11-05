// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerSnapshot } from './contracts';
import type { MediaDeviceChoice, MediaDeviceDirectorySnapshot } from './media-control-types';

const INPUT_PREF = 'onyx:media-input-device';
const OUTPUT_PREF = 'onyx:media-output-device';
const REF_LIFETIME_MS = 30 * 60 * 1000;

interface DeviceRefEntry { readonly owner: OwnerSnapshot; readonly kind: 'input' | 'output'; readonly deviceId: string; readonly expiresAt: number }
function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef;
}

/** Maps short-lived UI refs to private browser device IDs. Labels appear only
 * in device rows; private browser IDs stay in this runtime and storage. */
export function createMediaDevices(deps: {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly mediaDevices?: MediaDevices | null;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  readonly now?: () => number;
  readonly refLifetimeMs?: number;
  readonly onChange?: () => void;
}): {
  refresh(owner: OwnerSnapshot): Promise<MediaDeviceDirectorySnapshot | null>;
  snapshot(owner: OwnerSnapshot): MediaDeviceDirectorySnapshot;
  resolveInput(owner: OwnerSnapshot, ref: string | null): string | null;
  resolveOutput(owner: OwnerSnapshot, ref: string | null): string | null;
  preferredInputDeviceId(owner: OwnerSnapshot): string | null;
  preferredOutputDeviceId?(owner: OwnerSnapshot): string | null;
  selectedInputRef(owner: OwnerSnapshot): string | null;
  selectedOutputRef(owner: OwnerSnapshot): string | null;
  selectInput(owner: OwnerSnapshot, ref: string | null): boolean;
  selectOutput(owner: OwnerSnapshot, ref: string | null): boolean;
  retireOwner(owner: OwnerSnapshot): void;
  dispose(): void;
} {
  const devices = deps.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
  const storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const now = deps.now ?? (() => performance.now());
  const lifetime = Math.max(1000, Math.min(deps.refLifetimeMs ?? REF_LIFETIME_MS, 60 * 60 * 1000));
  const refs = new Map<string, DeviceRefEntry>();
  let owner: OwnerSnapshot | null = null;
  let inputs: MediaDeviceChoice[] = [];
  let outputs: MediaDeviceChoice[] = [];
  let inputSupported = !!devices?.getUserMedia;
  let outputSelectionSupported = typeof AudioContext !== 'undefined'
    && typeof (AudioContext.prototype as AudioContext & { setSinkId?: unknown }).setSinkId === 'function';
  let enumerationGeneration = 0;
  let disposed = false;
  const readPreference = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const writePreference = (key: string, value: string | null) => {
    try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, value); } catch { /* preference persistence is best effort */ }
  };
  const current = (candidate: OwnerSnapshot) => !disposed && deps.isCurrent(candidate) && sameOwner(deps.ownerSnapshot(), candidate);
  const makeRef = () => globalThis.crypto.randomUUID();
  const invalidateRefs = () => { refs.clear(); inputs = []; outputs = []; };
  const cleanupExpired = () => { for (const [ref, entry] of refs) if (now() > entry.expiresAt) refs.delete(ref); };
  const selectedRef = (candidate: OwnerSnapshot, kind: 'input' | 'output'): string | null => {
    if (!current(candidate) || !owner || !sameOwner(owner, candidate)) return null;
    cleanupExpired();
    const preference = readPreference(kind === 'input' ? INPUT_PREF : OUTPUT_PREF);
    for (const [ref, entry] of refs) if (entry.kind === kind && entry.deviceId === preference && sameOwner(entry.owner, candidate)) return ref;
    return null;
  };
  const devicechange = () => {
    if (disposed) return;
    enumerationGeneration++;
    invalidateRefs();
    const liveOwner = deps.ownerSnapshot();
    deps.onChange?.();
    void refresh(liveOwner);
  };
  devices?.addEventListener?.('devicechange', devicechange);
  const refresh = async (candidate: OwnerSnapshot): Promise<MediaDeviceDirectorySnapshot | null> => {
    if (!current(candidate)) return null;
    const generation = ++enumerationGeneration;
    owner = candidate;
    invalidateRefs();
    inputSupported = !!devices?.getUserMedia;
    outputSelectionSupported = typeof AudioContext !== 'undefined'
      && typeof (AudioContext.prototype as AudioContext & { setSinkId?: unknown }).setSinkId === 'function';
    if (!devices?.enumerateDevices) {
      deps.onChange?.();
      return snapshot(candidate);
    }
    try {
      const listed = await devices.enumerateDevices();
      if (!current(candidate) || generation !== enumerationGeneration) return null;
      const nowMs = now();
      let inputIndex = 0; let outputIndex = 0;
      for (const device of listed) {
        if (!device.deviceId) continue;
        const isInput = device.kind === 'audioinput';
        const isOutput = device.kind === 'audiooutput';
        if (!isInput && !isOutput) continue;
        const kind = isInput ? 'input' : 'output';
        const ref = makeRef();
        refs.set(ref, { owner: candidate, kind, deviceId: device.deviceId, expiresAt: nowMs + lifetime });
        const ordinal = isInput ? ++inputIndex : ++outputIndex;
        const label = device.label.trim() || `${isInput ? 'Microphone' : 'Speaker'} ${ordinal}`;
        (isInput ? inputs : outputs).push({ ref, label });
      }
      deps.onChange?.();
      return snapshot(candidate);
    } catch {
      if (current(candidate) && generation === enumerationGeneration) deps.onChange?.();
      return current(candidate) ? snapshot(candidate) : null;
    }
  };
  const snapshot = (candidate: OwnerSnapshot): MediaDeviceDirectorySnapshot => {
    if (!current(candidate) || !owner || !sameOwner(owner, candidate)) return { inputs: [], outputs: [], inputSupported: false, outputSelectionSupported: false };
    cleanupExpired();
    const validRefs = new Set(refs.keys());
    return {
      inputs: inputs.filter(row => validRefs.has(row.ref)), outputs: outputs.filter(row => validRefs.has(row.ref)),
      inputSupported, outputSelectionSupported,
    };
  };
  const resolve = (candidate: OwnerSnapshot, ref: string | null, kind: 'input' | 'output'): string | null => {
    if (!ref || !current(candidate)) return null;
    cleanupExpired();
    const entry = refs.get(ref);
    return entry && entry.kind === kind && sameOwner(entry.owner, candidate) ? entry.deviceId : null;
  };
  return {
    refresh, snapshot,
    resolveInput(candidate, ref) { return resolve(candidate, ref, 'input'); },
    resolveOutput(candidate, ref) { return resolve(candidate, ref, 'output'); },
    preferredInputDeviceId(candidate) {
      return current(candidate) ? readPreference(INPUT_PREF) : null;
    },
    preferredOutputDeviceId(candidate) { return current(candidate) ? readPreference(OUTPUT_PREF) : null; },
    selectedInputRef(candidate) { return selectedRef(candidate, 'input'); },
    selectedOutputRef(candidate) { return selectedRef(candidate, 'output'); },
    selectInput(candidate, ref) {
      if (!current(candidate)) return false;
      if (ref === null) { writePreference(INPUT_PREF, null); deps.onChange?.(); return true; }
      const id = resolve(candidate, ref, 'input');
      if (!id) return false;
      writePreference(INPUT_PREF, id); deps.onChange?.(); return true;
    },
    selectOutput(candidate, ref) {
      if (!current(candidate)) return false;
      if (ref === null) { writePreference(OUTPUT_PREF, null); deps.onChange?.(); return true; }
      const id = resolve(candidate, ref, 'output');
      if (!id) return false;
      writePreference(OUTPUT_PREF, id); deps.onChange?.(); return true;
    },
    retireOwner(candidate) {
      if (!owner || !sameOwner(owner, candidate)) return;
      enumerationGeneration++; owner = null; invalidateRefs(); deps.onChange?.();
    },
    dispose() { if (disposed) return; disposed = true; enumerationGeneration++; devices?.removeEventListener?.('devicechange', devicechange); owner = null; invalidateRefs(); },
  };
}
