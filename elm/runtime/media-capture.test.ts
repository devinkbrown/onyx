import { describe, expect, it } from 'vitest';
import { createMediaCapture } from './media-capture';
import { makeAccountGeneration, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef } from './contracts';
import type { OwnerSnapshot } from './contracts';

function makeOwner(): OwnerSnapshot {
  return {
    networkId: makeNetworkId('custom:wss://capture.test/irc')!, accountId: null,
    accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!,
    ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
  };
}

function streamWithTrack() {
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

describe('media capture activity ownership', () => {
  it('counts pending and live leases and clears released or claimed leases', async () => {
    const owner = makeOwner();
    const captured = streamWithTrack();
    let resolveCapture!: (stream: MediaStream) => void;
    const broker = createMediaCapture({
      ownerSnapshot: () => owner, isCurrent: candidate => candidate.ownerRef === owner.ownerRef,
      mediaDevices: { getUserMedia: () => new Promise<MediaStream>(resolve => { resolveCapture = resolve; }) } as unknown as MediaDevices,
      now: () => 10,
    });
    const intent = { ref: 'capture-reference-0001', owner, kind: 'voice' as const, room: 'soundcheck' };
    expect(broker.prepareFromGesture(intent).available).toBe(true);
    expect(broker.hasActiveWork(owner)).toBe(true);
    resolveCapture(captured.stream);
    await Promise.resolve();
    await Promise.resolve();
    expect(broker.hasActiveWork(owner)).toBe(true);
    broker.release(intent.ref, owner, intent.room);
    expect(captured.track.readyState).toBe('ended');
    expect(broker.hasActiveWork(owner)).toBe(false);

    const second = streamWithTrack();
    // A separate broker makes the claim transfer observable without restarting
    // the previously closed lease.
    const claimedBroker = createMediaCapture({
      ownerSnapshot: () => owner, isCurrent: candidate => candidate.ownerRef === owner.ownerRef,
      mediaDevices: { getUserMedia: async () => second.stream } as unknown as MediaDevices,
      now: () => 10,
    });
    const claimedIntent = { ...intent, ref: 'capture-reference-0002' };
    claimedBroker.prepareFromGesture(claimedIntent);
    await Promise.resolve();
    await Promise.resolve();
    const lease = await claimedBroker.claim(claimedIntent.ref, owner, claimedIntent.room);
    expect(lease?.stream).toBe(second.stream);
    expect(claimedBroker.hasActiveWork(owner)).toBe(false);
    second.track.stop();
    claimedBroker.dispose();
    broker.dispose();
  });

  it('expires stale leases during activity checks and rejects stale owners', async () => {
    const owner = makeOwner();
    const staleOwner = { ...owner, ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')! };
    let now = 10;
    const captured = streamWithTrack();
    const broker = createMediaCapture({
      ownerSnapshot: () => owner, isCurrent: candidate => candidate.ownerRef === owner.ownerRef,
      mediaDevices: { getUserMedia: async () => captured.stream } as unknown as MediaDevices,
      now: () => now, lifetimeMs: 1000,
    });
    const intent = { ref: 'capture-reference-0003', owner, kind: 'voice' as const, room: 'soundcheck' };
    broker.prepareFromGesture(intent);
    await Promise.resolve();
    await Promise.resolve();
    expect(broker.hasActiveWork(staleOwner)).toBe(false);
    expect(broker.hasActiveWork(owner)).toBe(true);
    now += 1001;
    expect(broker.hasActiveWork(owner)).toBe(false);
    expect(captured.track.readyState).toBe('ended');
    broker.dispose();
  });
});
