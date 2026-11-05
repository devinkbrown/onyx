import { describe, expect, it } from 'vitest';
import { createMediaDevices } from './media-devices';
import { makeAccountGeneration, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, type OwnerSnapshot } from './contracts';

function owner(ref = 'abcdefghijklmnopqrstuv'): OwnerSnapshot {
  return { networkId: makeNetworkId('custom:wss://devices.test/irc')!, accountId: null,
    accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef(ref)! };
}

describe('private media device directory', () => {
  it('returns opaque refs and generic labels before browser permission reveals labels', async () => {
    const current = owner();
    const storage = new Map<string, string>();
    const service = createMediaDevices({ ownerSnapshot: () => current, isCurrent: candidate => candidate.ownerRef === current.ownerRef,
      mediaDevices: { enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'private-microphone-id', label: '' },
        { kind: 'audiooutput', deviceId: 'private-speaker-id', label: '' },
      ] } as unknown as MediaDevices,
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
      now: () => 10,
    });
    const rows = await service.refresh(current);
    expect(rows?.inputs).toHaveLength(1);
    expect(rows?.outputs).toHaveLength(1);
    expect(rows?.inputs[0]?.label).toBe('Microphone 1');
    expect(rows?.outputs[0]?.label).toBe('Speaker 1');
    expect(rows?.inputs[0]?.ref).not.toContain('private-microphone-id');
    expect(service.resolveInput(current, rows?.inputs[0]?.ref ?? null)).toBe('private-microphone-id');
    expect(service.selectInput(current, rows?.inputs[0]?.ref ?? null)).toBe(true);
    expect(service.preferredInputDeviceId(current)).toBe('private-microphone-id');
    service.dispose();
  });

  it('expires refs on devicechange and rejects refs from stale owners', async () => {
    const current = owner();
    const stale = owner('bcdefghijklmnopqrstuvw');
    const listener: { current: (() => void) | null } = { current: null };
    const service = createMediaDevices({ ownerSnapshot: () => current, isCurrent: candidate => candidate.ownerRef === current.ownerRef,
      mediaDevices: { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Microphone' }],
        addEventListener(_name: string, callback: EventListenerOrEventListenerObject) { listener.current = callback as () => void; }, removeEventListener() {} } as unknown as MediaDevices,
      now: () => 10,
    });
    const first = await service.refresh(current);
    const ref = first?.inputs[0]?.ref ?? null;
    expect(service.resolveInput(current, ref)).toBe('mic-1');
    expect(service.resolveInput(stale, ref)).toBeNull();
    listener.current?.();
    expect(service.resolveInput(current, ref)).toBeNull();
    service.dispose();
  });

  it('keeps saved private preferences after UI refs expire without resolving them as default', async () => {
    const current = owner();
    let now = 0;
    const storage = new Map<string, string>();
    const service = createMediaDevices({ ownerSnapshot: () => current, isCurrent: candidate => candidate.ownerRef === current.ownerRef,
      mediaDevices: { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'private-selected-mic', label: 'Selected' }] } as unknown as MediaDevices,
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
      now: () => now, refLifetimeMs: 1000,
    });
    const rows = await service.refresh(current);
    const ref = rows?.inputs[0]?.ref ?? null;
    expect(ref).not.toBeNull();
    expect(service.selectInput(current, ref)).toBe(true);
    expect(service.preferredInputDeviceId(current)).toBe('private-selected-mic');
    now = 1001;
    expect(service.resolveInput(current, ref)).toBeNull();
    expect(service.preferredInputDeviceId(current)).toBe('private-selected-mic');
    service.dispose();
  });

  it('restores private input and output preferences before inventory has produced UI refs', () => {
    const current = owner();
    const storage = new Map<string, string>([
      ['onyx:media-input-device', 'private-mic'],
      ['onyx:media-output-device', 'private-speaker'],
    ]);
    const service = createMediaDevices({ ownerSnapshot: () => current, isCurrent: candidate => candidate.ownerRef === current.ownerRef,
      mediaDevices: { enumerateDevices: async () => [] } as unknown as MediaDevices,
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
    });
    expect(service.preferredInputDeviceId(current)).toBe('private-mic');
    expect(service.preferredOutputDeviceId?.(current)).toBe('private-speaker');
    expect(service.snapshot(current).inputs).toEqual([]);
    expect(service.snapshot(current).outputs).toEqual([]);
    service.dispose();
  });
});
