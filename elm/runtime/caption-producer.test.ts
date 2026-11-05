import { describe, expect, it } from 'vitest';
import { createCaptionProducer } from './caption-producer';
import { makeAccountGeneration, makeConnectionGeneration, makeConversationId, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeRequestId, type MediaCallRef, type OwnerSnapshot } from './contracts';

function owner(): OwnerSnapshot {
  return { networkId: makeNetworkId('custom:wss://caption.test/irc')!, accountId: null,
    accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')! };
}

describe('caption call ownership', () => {
  it('stops by exact owner, room and callRef even when stop has a new requestId', async () => {
    const currentOwner = owner();
    const callRef = 'caption-call-ref' as MediaCallRef;
    let aborts = 0;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((event: never) => void) | null = null;
      onerror: ((event: never) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {}
      abort() { aborts++; }
    }
    const producer = createCaptionProducer({
      ownerSnapshot: () => currentOwner,
      isCurrent: candidate => candidate.ownerRef === currentOwner.ownerRef,
      isCallCurrent: context => context.callRef === callRef && context.conversationId === makeConversationId('#room'),
      getOwnedLocalAudioTrack: async () => ({ kind: 'audio', readyState: 'live', stop() {}, addEventListener() {} } as unknown as MediaStreamTrack),
      captionConsent: async () => ({ activeMember: true, localConsent: true, policyRevision: 'opaque-roster-revision' }),
      onRetirement: () => ({ dispose() {} }), sendCaption: () => ({ kind: 'transport-admitted' }), onObservation: () => {},
      speechApi: FakeRecognition as never,
    });
    const context = { schemaVersion: 1 as const, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, owner: currentOwner,
      conversationId: makeConversationId('#room')!, callRef };
    const started = await producer.start({ context, language: 'en-US', mode: 'browser-service', browserServiceConsent: true });
    expect(started.state).toBe('listening');
    expect(started.source).toBe('browser-service');
    expect(started.serverVisible).toBe(true);
    producer.stop({ ...context, requestId: makeRequestId('bcdefghijklmnopqrstuvw')!, callRef: 'other-call' as MediaCallRef });
    expect(aborts).toBe(0);
    producer.stop({ ...context, requestId: makeRequestId('bcdefghijklmnopqrstuvw')! });
    expect(aborts).toBe(1);
    expect(producer.snapshot()?.state).toBe('stopped');
    producer.dispose();
  });

  it('does not publish a stale completion after the owner changes during consent lookup', async () => {
    let currentOwner = owner();
    const oldOwner = currentOwner;
    let finishConsent!: (value: { activeMember: boolean; localConsent: boolean; policyRevision: string }) => void;
    const observations: string[] = [];
    class FakeRecognition {
      continuous = false; interimResults = false; lang = '';
      onresult = null; onerror = null; onend = null;
      start() {} stop() {} abort() {}
    }
    const callRef = 'caption-call-ref' as MediaCallRef;
    const context = { schemaVersion: 1 as const, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, owner: oldOwner,
      conversationId: makeConversationId('#room')!, callRef };
    const producer = createCaptionProducer({
      ownerSnapshot: () => currentOwner,
      isCurrent: candidate => candidate.ownerRef === currentOwner.ownerRef,
      isCallCurrent: candidate => candidate.callRef === callRef,
      getOwnedLocalAudioTrack: async () => null,
      captionConsent: () => new Promise(resolve => { finishConsent = resolve; }),
      onRetirement: () => ({ dispose() {} }), sendCaption: () => ({ kind: 'transport-admitted' }),
      onObservation: observation => observations.push(observation.state), speechApi: FakeRecognition as never,
    });
    const starting = producer.start({ context, language: 'en-US', mode: 'browser-service', browserServiceConsent: true });
    currentOwner = { ...oldOwner, ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!, connectionGeneration: makeConnectionGeneration(2)! };
    finishConsent({ activeMember: true, localConsent: true, policyRevision: 'revision' });
    const result = await starting;
    expect(result.state).toBe('stopped');
    expect(observations).toEqual(['preparing']);
    expect(producer.snapshot()?.owner.ownerRef).toBe(oldOwner.ownerRef);
    producer.dispose();
  });
});
