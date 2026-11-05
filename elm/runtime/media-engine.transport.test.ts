import { describe, expect, it } from 'vitest';
import { createMediaEngine } from './media-engine';
import { makeAccountGeneration, makeConnectionGeneration, makeConversationId, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeRequestId, type OwnerSnapshot } from './contracts';
import type { CadenceMediaEngine } from '../../src/lib/cadence-media/MediaEngine';
import type { CadenceMediaCallbacks } from '../../src/lib/cadence-media/types';

function makeHarness(binaryReady: boolean, directory?: NonNullable<Parameters<typeof createMediaEngine>[0]['deviceDirectory']>) {
  let owner: OwnerSnapshot = {
    networkId: makeNetworkId('custom:wss://media.test/irc')!, accountId: null,
    accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
  };
  let joinCalls = 0;
  let captureClaims = 0;
  let capturePreparations = 0;
  let captureWork = false;
  let claimGate: (() => void) | null = null;
  let claimRelease: (() => void) | null = null;
  type OutputEffect = { readonly state: 'applied' | 'unsupported' | 'rejected' | 'deferred'; readonly reason: string | null; readonly contexts: number; readonly deviceId: string | null; readonly volumeState: 'applied' | 'deferred'; readonly volume: number };
  let outputEffect: OutputEffect = { state: 'deferred', reason: null, contexts: 0, deviceId: null, volumeState: 'deferred', volume: 0.8 };
  let outputBehavior: (deviceId: string | null, volumePercent: number) => Promise<OutputEffect> = async () => outputEffect;
  const outputCalls: Array<{ deviceId: string | null; volumePercent: number }> = [];
  let engineCallbacks: CadenceMediaCallbacks | null = null;
  const retiredCalls: unknown[] = [];
  const previewTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  let useLivePreviewTrack = false;
  let callState: { callState: 'idle' | 'in_call'; callWith: string; callChannel: string | null } = { callState: 'idle', callWith: '', callChannel: null };
  const fakeEngine = {
    joinVoice: async (room: string) => { joinCalls++; callState = { callState: 'in_call', callWith: '', callChannel: room }; },
    joinVideo: async (room: string) => { joinCalls++; callState = { callState: 'in_call', callWith: '', callChannel: room }; },
    leaveRoom: () => { callState = { callState: 'idle', callWith: '', callChannel: null }; engineCallbacks?.onCallState('idle', '', null); },
    getCallState: () => callState,
    getLocalKind: () => 'voice', getPeers: () => new Map(),
    setQualityPolicy() {}, getQualityObservation: () => ({ observedNetworkTier: 1, observedAudioQuality: 1, videoState: 'inactive' }),
    getMediaCounters: () => null,
    getCallRef: () => 'cadence-call-reference',
    getOutputEffect: () => outputEffect,
    setOutput: async (deviceId: string | null, volumePercent: number) => { outputCalls.push({ deviceId, volumePercent }); return outputBehavior(deviceId, volumePercent); },
    recoverAudio: async () => ({ state: 'deferred', reason: null }),
    replaceAudioInput: async () => true,
    setClient() {}, setMuted() {}, setDeafened() {}, receiveBinary() {},
  } as unknown as CadenceMediaEngine;
  const media = createMediaEngine({
    ownerSnapshot: () => owner, isCurrent: candidate => candidate.ownerRef === owner.ownerRef, transport: {} as never,
    privateIdentity: {} as never, emit() {}, platform: {} as never,
    isBinaryTransportReady: () => binaryReady,
    createEngine: (_owner, callbacks) => { engineCallbacks = callbacks; return fakeEngine; }, mediaIdentity: {} as never, verifyPeerMediaKey: async () => true,
    currentNick: () => 'alice',
    recordingControl: {
      inspect: () => ({ ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle', actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null }),
      refresh: async context => ({ owner: context.owner, conversationId: context.conversationId, callRef: context.callRef, requestId: context.requestId, recording: { ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle', actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null } }),
      setConsent: async intent => ({ owner: intent.owner, conversationId: intent.conversationId, callRef: intent.callRef, requestId: intent.requestId, recording: { ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle', actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null } }),
      requestRecording: async intent => ({ owner: intent.owner, conversationId: intent.conversationId, callRef: intent.callRef, requestId: intent.requestId, recording: { ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle', actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null } }),
      consumePrivateIngress: () => false, retireOwner: () => {}, retireCall: context => { retiredCalls.push(context); }, dispose: () => {},
    },
    ...(directory ? { deviceDirectory: directory } : {}),
    captureBroker: {
      prepareFromGesture() { capturePreparations++; return { available: true, reason: null }; },
      async claim() { captureClaims++; if (claimGate) await new Promise<void>(resolve => { claimRelease = resolve; }); return { stream: { getTracks: () => useLivePreviewTrack ? [previewTrack] : [] } as unknown as MediaStream, audioContext: null, deviceId: null }; },
      hasActiveWork() { return captureWork; },
      retireOwner() {},
      dispose() {},
    } as never,
  });
  const req = { schemaVersion: 1 as const, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, owner,
    conversationId: makeConversationId('#room')!, kind: 'voice' as const, captureRef: 'capture-ref', callRef: 'call-ref' };
  return { media, req, get owner() { return owner; }, setOwner(next: OwnerSnapshot) { owner = next; }, get joinCalls() { return joinCalls; }, get captureClaims() { return captureClaims; }, get capturePreparations() { return capturePreparations; },
    outputCalls, retiredCalls, setCallState(value: typeof callState) { callState = value; engineCallbacks?.onCallState(value.callState, value.callWith, value.callChannel); },
    setOutputEffect(value: OutputEffect) { outputEffect = value; }, setOutputBehavior(value: typeof outputBehavior) { outputBehavior = value; },
    setCaptureWork(value: boolean) { captureWork = value; }, useLivePreviewTrack() { useLivePreviewTrack = true; },
    delayClaim() { claimGate = () => {}; }, releaseClaim() { claimRelease?.(); }, get track() { return previewTrack; } };
}

describe('media binary transport gate', () => {
  it('blocks a call before capture or MEDIA join when the active transport is text-only', async () => {
    const h = makeHarness(false);
    const result = await h.media.join(h.req);
    expect(result.reason).toBe('transport-unavailable');
    expect(result.state).not.toBe('in-call');
    expect(h.captureClaims).toBe(0);
    expect(h.joinCalls).toBe(0);
  });

  it('allows voice join when the current WebSocket negotiated binary media', async () => {
    const h = makeHarness(true);
    const result = await h.media.join(h.req);
    expect(result.reason).toBeNull();
    expect(result.state).toBe('in-call');
    expect(h.captureClaims).toBe(1);
    expect(h.joinCalls).toBe(1);
    h.media.dispose();
  });

  it('refuses Cadence permission capture on text transport while preserving local preview capture', () => {
    const h = makeHarness(false);
    const blocked = h.media.prepareCaptureFromGesture('capture-ref', h.owner, h.req.conversationId, 'voice', 'cadence-call');
    expect(blocked).toEqual({ available: false, reason: 'transport-unavailable' });
    expect(h.capturePreparations).toBe(0);
    const preview = h.media.prepareCaptureFromGesture('preview-ref', h.owner, h.req.conversationId, 'camera', 'local-preview');
    expect(preview.available).toBe(true);
    expect(h.capturePreparations).toBe(1);
    h.media.dispose();
  });

  it('rejects an expired explicit device ref without falling through to the preferred/default input', () => {
    let preferenceReads = 0;
    const directory = {
      snapshot: () => ({ inputs: [], outputs: [], inputSupported: true, outputSelectionSupported: false }),
      selectedInputRef: () => null, selectedOutputRef: () => null,
      resolveInput: () => null, resolveOutput: () => null,
      preferredInputDeviceId: () => { preferenceReads++; return 'private-default-fallback'; },
      selectInput: () => false, selectOutput: () => false,
      async refresh() { return null; }, retireOwner() {}, dispose() {},
    } as unknown as NonNullable<Parameters<typeof createMediaEngine>[0]['deviceDirectory']>;
    const h = makeHarness(true, directory);
    const result = h.media.prepareCaptureFromGesture('capture-ref', h.owner, h.req.conversationId, 'voice', 'cadence-call', 'expired-device-ref');
    expect(result).toEqual({ available: false, reason: 'device-missing' });
    expect(preferenceReads).toBe(0);
    expect(h.capturePreparations).toBe(0);
    h.media.dispose();
  });

  it('resets the desired quality policy when the owning physical session retires', async () => {
    const h = makeHarness(true);
    const first = await h.media.join(h.req);
    expect(first.state).toBe('in-call');
    expect(h.media.setQuality({ context: { schemaVersion: 1, requestId: h.req.requestId, owner: h.owner },
      conversationId: h.req.conversationId, callRef: h.req.callRef, policy: 'balanced' })?.desiredPolicy).toBe('balanced');
    const prior = h.owner;
    const next = { ...prior, ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!, connectionGeneration: makeConnectionGeneration(2)! };
    h.media.retireOwner(prior, next);
    h.setOwner(next);
    const nextRequest = { ...h.req, owner: next, requestId: makeRequestId('bcdefghijklmnopqrstuvw')!, callRef: 'next-call-ref' };
    await h.media.join(nextRequest);
    expect(h.media.qualitySnapshot({ context: { schemaVersion: 1, requestId: nextRequest.requestId, owner: next },
      conversationId: nextRequest.conversationId, callRef: nextRequest.callRef })?.desiredPolicy).toBe('auto');
    h.media.dispose();
  });

  it('reports actual call work and returns idle after leave even while the engine remains constructed', async () => {
    const h = makeHarness(true);
    expect(h.media.hasActiveWork(h.owner)).toBe(false);
    await h.media.join(h.req);
    expect(h.media.hasActiveWork(h.owner)).toBe(true);
    await h.media.leave({ schemaVersion: 1, requestId: h.req.requestId, owner: h.owner, conversationId: h.req.conversationId });
    expect(h.media.snapshot().state).toBe('ready');
    expect(h.media.hasActiveWork(h.owner)).toBe(false);
    h.media.dispose();
  });

  it('retires recording and quality call ownership when Cadence goes idle without a channel', async () => {
    const h = makeHarness(true);
    await h.media.join(h.req);
    h.setCallState({ callState: 'idle', callWith: '', callChannel: null });
    expect(h.retiredCalls).toHaveLength(1);
    expect(h.retiredCalls[0]).toMatchObject({ conversationId: h.req.conversationId, callRef: 'call-ref', owner: h.owner });
    expect(h.media.qualitySnapshot({ context: { schemaVersion: 1, requestId: h.req.requestId, owner: h.owner },
      conversationId: h.req.conversationId, callRef: h.req.callRef! })).toBeNull();
    h.media.dispose();
  });

  it('reports pending capture and live local preview work, then clears it on preview cleanup', async () => {
    const h = makeHarness(true);
    h.setCaptureWork(true);
    expect(h.media.hasActiveWork(h.owner)).toBe(true);
    h.setCaptureWork(false);
    h.useLivePreviewTrack();
    const previewIntent = { ...h.req, kind: 'camera' as const };
    const previewRef = await h.media.previewCamera(previewIntent);
    expect(previewRef).not.toBeNull();
    expect(h.media.hasActiveWork(h.owner)).toBe(true);
    h.media.retirePreview(previewRef!);
    expect(h.track.readyState).toBe('ended');
    expect(h.media.hasActiveWork(h.owner)).toBe(false);
    h.media.dispose();
  });

  it('counts a permission or claim operation only while its owner generation is current', async () => {
    const h = makeHarness(true);
    h.delayClaim();
    const joining = h.media.join(h.req);
    await Promise.resolve();
    expect(h.media.hasActiveWork(h.owner)).toBe(true);
    const prior = h.owner;
    const next = { ...prior, ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!, connectionGeneration: makeConnectionGeneration(2)! };
    h.media.retireOwner(prior, next);
    h.setOwner(next);
    expect(h.media.hasActiveWork(prior)).toBe(false);
    h.releaseClaim();
    await joining;
    expect(h.media.hasActiveWork(next)).toBe(false);
    h.media.dispose();
  });

  it('preserves a rejected output request while retaining independently observed prior volume', async () => {
    const appliedRef = 'opaque-applied-output';
    const directory = {
      snapshot: () => ({ inputs: [], outputs: [{ ref: appliedRef, label: 'Studio output' }], inputSupported: true, outputSelectionSupported: true }),
      selectedInputRef: () => null, selectedOutputRef: () => null,
      resolveInput: () => null, resolveOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === appliedRef ? 'private-speaker-id' : null,
      preferredInputDeviceId: () => null,
      selectInput: () => true, selectOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === appliedRef,
      async refresh() { return null; }, retireOwner() {}, dispose() {},
    } as unknown as NonNullable<Parameters<typeof createMediaEngine>[0]['deviceDirectory']>;
    const h = makeHarness(true, directory);
    await h.media.join(h.req);
    h.setOutputBehavior(async deviceId => ({ state: 'applied', reason: null, contexts: 1, deviceId, volumeState: 'applied', volume: 0.64 }));
    const applied = await h.media.setMediaOutput({ schemaVersion: 1, requestId: h.req.requestId, owner: h.owner,
      deviceRef: appliedRef, volumePercent: 64 });
    expect(applied?.devices.appliedOutputRef).toBe(appliedRef);
    h.setOutputEffect({ state: 'applied', reason: null, contexts: 1, deviceId: 'private-speaker-id', volumeState: 'applied', volume: 0.64 });
    const result = await h.media.setMediaOutput({ schemaVersion: 1, requestId: h.req.requestId, owner: h.owner,
      deviceRef: 'expired-output-ref', volumePercent: 80 });
    expect(result?.devices.outputState).toBe('rejected');
    expect(result?.devices.outputReason).toBe('device-ref-expired');
    expect(result?.devices.appliedOutputRef).toBe(appliedRef);
    expect(result?.devices.appliedVolumePercent).toBe(64);
    h.media.dispose();
  });

  it('does not queue a second activation-sensitive output selection behind a pending one', async () => {
    const outputRef = 'opaque-output-reference';
    const directory = {
      snapshot: () => ({ inputs: [], outputs: [{ ref: outputRef, label: 'Studio output' }], inputSupported: true, outputSelectionSupported: true }),
      selectedInputRef: () => null, selectedOutputRef: () => null,
      resolveInput: () => null, resolveOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === outputRef ? 'private-speaker-id' : null,
      preferredInputDeviceId: () => null,
      selectInput: () => true, selectOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === outputRef || ref === null,
      async refresh() { return null; }, retireOwner() {}, dispose() {},
    } as unknown as NonNullable<Parameters<typeof createMediaEngine>[0]['deviceDirectory']>;
    const h = makeHarness(true, directory);
    await h.media.join(h.req);
    let finish!: (value: { state: 'applied'; reason: null; contexts: 1; deviceId: string; volumeState: 'applied'; volume: number }) => void;
    h.setOutputBehavior(() => new Promise(resolve => { finish = resolve; }));
    const intent = { schemaVersion: 1 as const, requestId: h.req.requestId, owner: h.owner, deviceRef: outputRef, volumePercent: 65 };
    const pending = h.media.setMediaOutput(intent);
    const callsAfterFirst = h.outputCalls.length;
    const busy = await h.media.setMediaOutput({ ...intent, requestId: makeRequestId('bcdefghijklmnopqrstuvw')! });
    expect(busy?.devices.outputState).toBe('deferred');
    expect(busy?.devices.outputReason).toBe('output-selection-busy-retry');
    expect(h.outputCalls.length).toBe(callsAfterFirst);
    finish({ state: 'applied', reason: null, contexts: 1, deviceId: 'private-speaker-id', volumeState: 'applied', volume: 0.65 });
    await pending;
    h.media.dispose();
  });

  it('retires a pending output effect with its physical owner and does not publish it under the next owner', async () => {
    const outputRef = 'opaque-output-reference';
    const directory = {
      snapshot: () => ({ inputs: [], outputs: [{ ref: outputRef, label: 'Studio output' }], inputSupported: true, outputSelectionSupported: true }),
      selectedInputRef: () => null, selectedOutputRef: () => null,
      resolveInput: () => null, resolveOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === outputRef ? 'private-speaker-id' : null,
      preferredInputDeviceId: () => null, selectInput: () => true,
      selectOutput: (_owner: OwnerSnapshot, ref: string | null) => ref === outputRef || ref === null,
      async refresh() { return null; }, retireOwner() {}, dispose() {},
    } as unknown as NonNullable<Parameters<typeof createMediaEngine>[0]['deviceDirectory']>;
    const h = makeHarness(true, directory);
    await h.media.join(h.req);
    let finish!: (value: { state: 'applied'; reason: null; contexts: 1; deviceId: string; volumeState: 'applied'; volume: number }) => void;
    h.setOutputBehavior(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.media.setMediaOutput({ schemaVersion: 1, requestId: h.req.requestId, owner: h.owner, deviceRef: outputRef, volumePercent: 70 });
    const prior = h.owner;
    const next = { ...prior, ownerRef: makeOwnerRef('bcdefghijklmnopqrstuvw')!, connectionGeneration: makeConnectionGeneration(2)!, physicalRef: makeLocalPhysicalEpoch('abcdef0123456789abcdef0123456789')! };
    h.media.retireOwner(prior, next);
    h.setOwner(next);
    finish({ state: 'applied', reason: null, contexts: 1, deviceId: 'private-speaker-id', volumeState: 'applied', volume: 0.7 });
    await expect(pending).resolves.toBeNull();
    const snapshot = h.media.inspect({ schemaVersion: 1, requestId: makeRequestId('bcdefghijklmnopqrstuvw')!, owner: next });
    expect(snapshot?.devices.requestedOutputRef).toBeNull();
    expect(snapshot?.devices.outputState).toBe('idle');
    h.media.dispose();
  });
});
