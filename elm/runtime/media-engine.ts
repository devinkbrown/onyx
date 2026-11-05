// SPDX-License-Identifier: AGPL-3.0-or-later
import { makeConversationId, makeRequestId, type ConversationId, type MediaCallRef, type OwnerSnapshot, type PrivateIngressEvent, type RequestContext, type RequestId, type RuntimeFactoryContext } from './contracts';
import { CadenceMediaEngine } from '../../src/lib/cadence-media/MediaEngine';
import { createMediaCapture, type CaptureKind } from './media-capture';
import { createMediaTelemetry, type MediaTelemetrySnapshot } from './media-telemetry';
import type { MediaIdentityAdapter, MediaIdentityContext } from '../../src/lib/cadence-media/types';
import type { MediaQualityPolicy, MediaQualityObservation } from '../../src/lib/cadence-media/types';
import { createMediaDevices } from './media-devices';
import type { MediaCallContext, MediaConsentIntent, MediaControlSnapshot, MediaDeviceSnapshot, MediaEffectState, MediaInputIntent, MediaOutputIntent, MediaRecordingIntent, MediaRecordingSnapshot, MediaSoundcheckSnapshot } from './media-control-types';
import type { MediaDeviceDirectorySnapshot } from './media-control-types';
import type { MediaRecordingControlResult } from './media-recording-control';

export type MediaReason = 'permission-required' | 'permission-denied' | 'device-missing' | 'identity-unavailable' | 'transport-unavailable' | 'codec-unavailable' | 'untrusted-peer' | 'owner-changed' | 'unsupported' | 'failed' | null;
export type CapturePurpose = 'cadence-call' | 'local-preview' | 'webrtc-call' | 'soundcheck';
export interface MediaStatus { readonly owner: OwnerSnapshot; readonly state: 'idle' | 'preparing' | 'ready' | 'in-call' | 'degraded' | 'failed'; readonly conversationId: ConversationId | null; readonly kind: 'voice' | 'video' | 'screen' | null; readonly muted: boolean; readonly deafened: boolean; readonly recording: 'unavailable' | 'idle' | 'pending' | 'active' | 'failed'; readonly reason: MediaReason; readonly peers: number; readonly telemetry: MediaTelemetrySnapshot }
export interface MediaQualityStatus extends MediaQualityObservation { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: string; readonly desiredPolicy: MediaQualityPolicy }
export interface SetMediaQualityIntent { readonly context: RequestContext; readonly conversationId: ConversationId; readonly callRef: string; readonly policy: MediaQualityPolicy }
export interface MediaQualitySnapshotIntent { readonly context: RequestContext; readonly conversationId: ConversationId; readonly callRef: string }
export type MediaRequest = RequestContext;
export interface MediaJoinIntent extends MediaRequest { readonly conversationId: ConversationId; readonly kind: 'voice' | 'video'; readonly captureRef: string; readonly callRef?: string }
export interface MediaLeaveIntent extends MediaRequest { readonly conversationId: ConversationId | null }
export interface DeviceIntent extends MediaRequest { readonly deviceId: string | null; readonly volumePercent?: number }
export interface MuteIntent extends MediaRequest { readonly muted: boolean }
export interface DeafenIntent extends MediaRequest { readonly deafened: boolean }
export interface CaptureIntent extends MediaRequest { readonly conversationId: ConversationId; readonly captureRef: string; readonly kind: 'camera' | 'screen'; readonly callRef?: string }
export interface PublicationIntent extends MediaRequest { readonly conversationId: ConversationId; readonly previewRef: string; readonly callRef?: string }
export interface StopIntent extends MediaRequest { readonly conversationId: ConversationId | null }
export interface ConsentIntent extends MediaRequest { readonly conversationId: ConversationId; readonly consent: 'granted' | 'denied'; readonly policyRevision: string }
export interface RecordingIntent extends MediaRequest { readonly conversationId: ConversationId; readonly action: 'start' | 'stop'; readonly consentRevision: string }
export interface SoundcheckIntent extends MediaRequest { readonly captureRef: string; readonly durationMs?: number }
export interface SoundcheckResult { readonly owner: OwnerSnapshot; readonly state: 'input-signal-detected' | 'silence' | 'permission-denied' | 'unavailable' | 'stale-owner'; readonly rms: number | null; readonly sampledFrames: number }
export interface PreviewRef { readonly id: string; readonly ownerRef: string; readonly conversationId: ConversationId }
export interface MediaPublicListener { (status: MediaStatus): void }
export interface MediaEngineDependencies extends RuntimeFactoryContext {
  /** Construct with scoped, purpose-specific identity verification/signing. */
  readonly createEngine: (owner: OwnerSnapshot, callbacks: import('../../src/lib/cadence-media/types').CadenceMediaCallbacks, identity: MediaIdentityAdapter, identityContext: (room: ConversationId, callRef: string) => MediaIdentityContext | null) => CadenceMediaEngine;
  readonly mediaIdentity: MediaIdentityAdapter;
  readonly verifyPeerMediaKey: (owner: OwnerSnapshot, input: { readonly peerNick: string; readonly publicKeyB64url: string; readonly attachmentId: string; readonly trustBinding: string }) => Promise<boolean>;
  readonly currentNick: (owner: OwnerSnapshot) => string;
  readonly recordingControl?: {
    inspect(context: MediaCallContext): MediaRecordingSnapshot;
    refresh(context: MediaCallContext): Promise<{ readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly requestId: RequestId | null; readonly recording: MediaRecordingSnapshot }>;
    setConsent(intent: MediaConsentIntent): Promise<{ readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly requestId: RequestId | null; readonly recording: MediaRecordingSnapshot }>;
    requestRecording(intent: MediaRecordingIntent): Promise<{ readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly requestId: RequestId | null; readonly recording: MediaRecordingSnapshot }>;
    consumePrivateIngress(event: PrivateIngressEvent): boolean;
    retireOwner(previous: OwnerSnapshot, next: OwnerSnapshot): void;
    retireCall(context: MediaCallContext): void;
    dispose(): void;
  };
  readonly isBinaryTransportReady: (owner: OwnerSnapshot) => boolean;
  readonly mediaDevices?: MediaDevices | null;
  /** Shared gesture capture broker, constructed by the composition root so a
   * trusted DOM click can synchronously open the actual stream before Elm runs. */
  readonly captureBroker?: ReturnType<typeof createMediaCapture>;
  readonly deviceDirectory?: ReturnType<typeof createMediaDevices>;
}

const newOpaqueId = () => globalThis.crypto.randomUUID();
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot) => a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;

/** Runtime facade around the existing Cadence engine. Streams stay private. */
export function createMediaEngine(deps: MediaEngineDependencies): {
  subscribe(listener: MediaPublicListener): () => void;
  subscribeControl(listener: (snapshot: MediaControlSnapshot) => void): () => void;
  inspect(context: RequestContext): MediaControlSnapshot | null;
  refreshDevices(context: RequestContext): Promise<MediaControlSnapshot | null>;
  setMediaInput(intent: MediaInputIntent): Promise<MediaControlSnapshot | null>;
  setMediaOutput(intent: MediaOutputIntent): Promise<MediaControlSnapshot | null>;
  setMediaConsent(intent: MediaConsentIntent): Promise<MediaControlSnapshot | null>;
  requestRecording(intent: MediaRecordingIntent): Promise<MediaControlSnapshot | null>;
  refreshRecording(context: MediaCallContext): Promise<MediaControlSnapshot | null>;
  consumePrivateIngress(event: PrivateIngressEvent): boolean;
  onRecordingControlResult(result: MediaRecordingControlResult): void;
  recoverAudio(context: MediaCallContext): Promise<{ readonly state: MediaEffectState; readonly reason: string | null }>;
  soundcheck(req: SoundcheckIntent): Promise<SoundcheckResult>;
  join(req: MediaJoinIntent): Promise<MediaStatus>;
  leave(req: MediaLeaveIntent): Promise<MediaStatus>;
  setInput(req: DeviceIntent): Promise<MediaStatus>;
  setOutput(req: DeviceIntent): Promise<MediaStatus>;
  setMuted(req: MuteIntent): void;
  setDeafened(req: DeafenIntent): void;
  setQuality(req: SetMediaQualityIntent): MediaQualityStatus | null;
  qualitySnapshot(req: MediaQualitySnapshotIntent): MediaQualityStatus | null;
  cloneLocalAudioTrack(req: MediaCallContext): MediaStreamTrack | null;
  prepareCaptureFromGesture(intentRef: string, owner: OwnerSnapshot, conversationId: ConversationId, kind: CaptureKind, purpose?: CapturePurpose, deviceRef?: string | null): { readonly available: boolean; readonly reason: string | null };
  previewCamera(req: CaptureIntent): Promise<PreviewRef | null>;
  attachPreview(ref: PreviewRef, video: HTMLVideoElement): boolean;
  retirePreview(ref: PreviewRef): void;
  publishCamera(req: PublicationIntent): Promise<MediaStatus>;
  startScreen(req: CaptureIntent): Promise<MediaStatus>;
  stopScreen(req: StopIntent): void;
  setConsent(req: ConsentIntent): Promise<MediaStatus>;
  record(req: RecordingIntent): Promise<MediaStatus>;
  receiveBinary(frame: Uint8Array, owner: OwnerSnapshot): void;
  hasActiveWork(owner: OwnerSnapshot): boolean;
  snapshot(): MediaStatus;
  retireOwner(previous: OwnerSnapshot, next: OwnerSnapshot): void;
  dispose(): void;
} {
  const listeners = new Set<MediaPublicListener>();
  const capture = deps.captureBroker ?? createMediaCapture({ ownerSnapshot: deps.ownerSnapshot, isCurrent: deps.isCurrent,
    ...(deps.mediaDevices !== undefined ? { mediaDevices: deps.mediaDevices } : {}),
    audioContextFactory: () => new AudioContext({ sampleRate: 48_000 }) });
  let publishControl: () => void = () => {};
  const deviceDirectory = deps.deviceDirectory ?? createMediaDevices({ ownerSnapshot: deps.ownerSnapshot, isCurrent: deps.isCurrent,
    ...(deps.mediaDevices !== undefined ? { mediaDevices: deps.mediaDevices } : {}), onChange: () => publishControl() });
  const controlListeners = new Set<(value: MediaControlSnapshot) => void>();
  const previewStreams = new Map<string, { owner: OwnerSnapshot; stream: MediaStream; audioContext: AudioContext | null; deviceId: string | null; video: HTMLVideoElement | null; conversationId: ConversationId }>();
  const soundcheckResources = new Set<{ readonly owner: OwnerSnapshot; readonly stream: MediaStream; context: AudioContext | null; source: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null; cleaned: boolean }>();
  const stopSoundcheckResource = (resource: { readonly stream: MediaStream; context: AudioContext | null; source: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null; cleaned: boolean }) => {
    if (resource.cleaned) return;
    resource.cleaned = true;
    try { resource.source?.disconnect(); } catch { /* best-effort cleanup */ }
    try { resource.analyser?.disconnect(); } catch { /* best-effort cleanup */ }
    resource.stream.getTracks().forEach(track => { try { track.stop(); } catch { /* best-effort cleanup */ } });
    void resource.context?.close().catch(() => {});
  };
  const retireSoundchecks = (retiredOwner?: OwnerSnapshot) => {
    for (const resource of soundcheckResources) if (!retiredOwner || sameOwner(resource.owner, retiredOwner)) {
      stopSoundcheckResource(resource);
      soundcheckResources.delete(resource);
    }
  };
  let owner = deps.ownerSnapshot();
  let muted = false;
  let deafened = false;
  let recording: MediaStatus['recording'] = 'idle';
  let lastError: MediaReason = null;
  let disposed = false;
  let engine: CadenceMediaEngine | null = null;
  let activeRequestId: RequestId | null = null;
  let desiredQualityPolicy: MediaQualityPolicy = 'auto';
  let activeCallRef: string | null = null;
  let activeEngineCallRef: string | null = null;
  let activeCallConversationId: ConversationId | null = null;
  let controlSequence = 0;
  let soundcheckSnapshot: MediaSoundcheckSnapshot | null = null;
  let requestedInputRef: string | null = null;
  let appliedInputRef: string | null = null;
  let inputState: MediaDeviceSnapshot['inputState'] = 'idle';
  let inputReason: string | null = null;
  let requestedOutputRef: string | null = null;
  let requestedOutputDeviceId: string | null = null;
  let appliedOutputRef: string | null = null;
  let outputState: MediaDeviceSnapshot['outputState'] = 'idle';
  let outputReason: string | null = null;
  let requestedVolumePercent = 80;
  let appliedVolumePercent: number | null = null;
  let inputEffectGeneration = 0;
  let outputEffectGeneration = 0;
  let inputEffectQueue: Promise<void> = Promise.resolve();
  let outputOperationToken: object | null = null;
  let telemetryTimer: ReturnType<typeof setInterval> | null = null;
  const emptyRecording: MediaRecordingSnapshot = { ownConsent: 'unknown', consentRequest: 'idle', desiredAction: null, requestState: 'idle', actual: 'unknown', rosterState: 'unknown', allConsented: null, policyRevision: null, reason: null };
  const binaryReady = (requestOwner: OwnerSnapshot) => deps.isCurrent(requestOwner) && deps.isBinaryTransportReady(requestOwner);
  let listenerGeneration = 0;
  let callGeneration = 0;
  const inFlightWork = new Set<{ readonly owner: OwnerSnapshot; readonly generation: number }>();
  const beginWork = (workOwner: OwnerSnapshot, generation = callGeneration) => {
    const operation = { owner: workOwner, generation };
    inFlightWork.add(operation);
    return () => { inFlightWork.delete(operation); };
  };
  const withWork = async <T>(workOwner: OwnerSnapshot, generation: number, action: () => Promise<T>): Promise<T> => {
    const finishWork = beginWork(workOwner, generation);
    try { return await action(); } finally { finishWork(); }
  };
  const clearWork = (workOwner?: OwnerSnapshot) => {
    for (const operation of inFlightWork) if (!workOwner || sameOwner(operation.owner, workOwner)) inFlightWork.delete(operation);
  };
  const identityContextCurrent = () => !disposed && deps.isCurrent(owner) && sameOwner(owner, deps.ownerSnapshot());
  const counterSource = () => {
    return engine?.getMediaCounters() ?? null;
  };
  const telemetry = createMediaTelemetry(counterSource);
  const status = (): MediaStatus => {
    const call = engine?.getCallState();
    const mediaState = call?.callState === 'in_call' ? 'in-call' : lastError ? 'failed' : engine ? 'ready' : 'idle';
    return { owner, state: mediaState, conversationId: (call?.callChannel as ConversationId | null) ?? null,
      kind: engine?.getLocalKind() ?? null, muted, deafened, recording, reason: lastError, peers: engine?.getPeers().size ?? 0, telemetry: telemetry.snapshot() };
  };
  const publish = () => { const value = status(); for (const listener of [...listeners]) { try { listener(value); } catch { /* observers are isolated */ } } publishControl(); };
  const startTelemetry = () => {
    if (telemetryTimer !== null) return;
    telemetryTimer = setInterval(() => {
      if (disposed || !actualCall()) { if (telemetryTimer !== null) clearInterval(telemetryTimer); telemetryTimer = null; return; }
      publish();
    }, 1000);
  };
  const stopTelemetry = () => { if (telemetryTimer !== null) clearInterval(telemetryTimer); telemetryTimer = null; telemetry.reset(); };
  const contextValid = (req: RequestContext) => !disposed && sameOwner(owner, req.owner) && deps.isCurrent(req.owner) && sameOwner(deps.ownerSnapshot(), req.owner);
  const actualCall = (): MediaControlSnapshot['call'] => {
    try {
      const call = engine?.getCallState();
      const conversationId = call?.callState === 'in_call' && typeof call.callChannel === 'string' ? makeConversationId(call.callChannel) : null;
      if (!conversationId || !activeCallRef || !activeEngineCallRef || engine?.getCallRef() !== activeEngineCallRef) return null;
      return { conversationId, callRef: activeCallRef as MediaCallRef };
    } catch { return null; }
  };
  const retireLostCall = (candidate: OwnerSnapshot): void => {
    const callRef = activeCallRef;
    const conversationId = activeCallConversationId;
    if (!callRef || !conversationId) return;
    if (deps.recordingControl) deps.recordingControl.retireCall({ schemaVersion: 1,
      requestId: activeRequestId ?? makeRequestId(newOpaqueId())!, owner: candidate, conversationId, callRef: callRef as MediaCallRef });
    activeCallRef = null; activeEngineCallRef = null; activeCallConversationId = null; recording = 'idle'; stopTelemetry();
  };
  const makeControlSnapshot = (context: RequestContext): MediaControlSnapshot | null => {
    if (!contextValid(context)) return null;
    const call = actualCall();
    const directory: MediaDeviceDirectorySnapshot = deviceDirectory.snapshot(context.owner);
    const recordingView = call && deps.recordingControl
      ? deps.recordingControl.inspect({ ...context, conversationId: call.conversationId, callRef: call.callRef })
      : emptyRecording;
    const outputObservation = engine?.getOutputEffect();
    const currentAppliedInputRef = appliedInputRef !== null && deviceDirectory.resolveInput(context.owner, appliedInputRef) !== null ? appliedInputRef : null;
    const currentAppliedOutputRef = appliedOutputRef !== null && deviceDirectory.resolveOutput(context.owner, appliedOutputRef) !== null ? appliedOutputRef : null;
    const outputObservationMatchesRequest = !!outputObservation && outputObservation.deviceId === requestedOutputDeviceId
      && outputState !== 'rejected' && outputReason !== 'output-selection-busy-retry';
    const projectedAppliedOutputRef = outputObservationMatchesRequest && outputObservation?.state === 'applied'
      ? requestedOutputRef !== null && deviceDirectory.resolveOutput(context.owner, requestedOutputRef) === requestedOutputDeviceId ? requestedOutputRef : null
      : currentAppliedOutputRef;
    const devices: MediaDeviceSnapshot = {
      inputs: directory.inputs, outputs: directory.outputs,
      selectedInputRef: deviceDirectory.selectedInputRef(context.owner), requestedInputRef, appliedInputRef: currentAppliedInputRef, inputState, inputReason,
      selectedOutputRef: deviceDirectory.selectedOutputRef(context.owner), requestedOutputRef, appliedOutputRef: projectedAppliedOutputRef,
      outputState: outputObservationMatchesRequest && outputObservation?.state === 'applied' ? 'applied'
        : outputObservationMatchesRequest && outputObservation?.state === 'unsupported' ? 'unknown'
          : outputObservationMatchesRequest && outputObservation?.state === 'rejected' ? 'rejected' : outputState,
      outputReason: outputObservationMatchesRequest ? outputObservation?.reason ?? outputReason : outputReason,
      requestedVolumePercent,
      appliedVolumePercent: outputObservation?.volumeState === 'applied' ? Math.round(outputObservation.volume * 100) : appliedVolumePercent,
    };
    return { owner: context.owner, sequence: controlSequence, call, reason: lastError, muted, deafened, devices,
      soundcheck: soundcheckSnapshot, recording: recordingView, telemetry: telemetry.snapshot(), caption: null, webRtc: null };
  };
  const snapshotContext = (): RequestContext => ({ schemaVersion: 1, requestId: activeRequestId ?? makeRequestId(newOpaqueId())!, owner });
  const inspect = (context: RequestContext): MediaControlSnapshot | null => makeControlSnapshot(context);
  const captureMatchesInput = (candidate: OwnerSnapshot, deviceId: string | null): boolean => {
    return deviceDirectory.preferredInputDeviceId(candidate) === deviceId;
  };
  const publishControlSnapshot = () => {
    if (disposed || !deps.isCurrent(owner) || !sameOwner(owner, deps.ownerSnapshot())) return;
    controlSequence++;
    const value = makeControlSnapshot(snapshotContext());
    if (!value) return;
    for (const listener of [...controlListeners]) { try { listener(value); } catch { /* observers are isolated */ } }
  };
  publishControl = publishControlSnapshot;
  const subscribeControl = (listener: (snapshot: MediaControlSnapshot) => void) => {
    if (disposed) return () => {};
    controlListeners.add(listener);
    const initial = makeControlSnapshot(snapshotContext());
    if (initial) { try { listener(initial); } catch { /* observers are isolated */ } }
    return () => controlListeners.delete(listener);
  };
  const ensureEngine = (forOwner: OwnerSnapshot) => {
    if (!contextValid({ schemaVersion: 1, requestId: 'AAAAAAAAAAAAAAAAAAAAAA' as never, owner: forOwner })) return null;
    if (!engine) {
      const ownGeneration = ++listenerGeneration;
      const callbacks: import('../../src/lib/cadence-media/types').CadenceMediaCallbacks = {
        onCallState: state => { if (ownGeneration === listenerGeneration && identityContextCurrent()) { if (state === 'idle') retireLostCall(forOwner); publish(); } },
        onPeerLeft: () => { if (ownGeneration === listenerGeneration && identityContextCurrent()) publish(); },
        onLocalStream: () => { if (ownGeneration === listenerGeneration && identityContextCurrent()) publish(); },
        onError: () => { if (ownGeneration === listenerGeneration && identityContextCurrent()) { lastError = 'failed'; publish(); } },
        onNetworkQuality: () => { if (ownGeneration === listenerGeneration && identityContextCurrent()) publish(); },
        onMediaE2eeState: (active, degraded) => { if (ownGeneration === listenerGeneration && identityContextCurrent()) { lastError = active ? null : degraded ? 'untrusted-peer' : lastError; publish(); } },
        getLocalNick: () => deps.currentNick(owner),
        verifyPeerMediaKey: async (peerNick, publicKeyB64url, attachmentId, trustBinding) => contextValid({ schemaVersion: 1, requestId: 'AAAAAAAAAAAAAAAAAAAAAA' as never, owner: forOwner })
          && deps.verifyPeerMediaKey(forOwner, { peerNick, publicKeyB64url, attachmentId, trustBinding }),
      };
      engine = deps.createEngine(forOwner, callbacks, deps.mediaIdentity,
        (room, callRef) => activeRequestId && contextValid({ schemaVersion: 1, requestId: activeRequestId, owner: forOwner })
          ? { owner: forOwner, conversationId: room, requestId: activeRequestId, callRef }
          : null);
      engine.setMuted(muted);
      engine.setDeafened(deafened);
      const outputId = deviceDirectory.preferredOutputDeviceId?.(forOwner) ?? null;
      requestedOutputDeviceId = outputId;
      void engine.setOutput(outputId, requestedVolumePercent);
    }
    return engine;
  };
  const subscribe = (listener: MediaPublicListener) => { if (disposed) return () => {}; listeners.add(listener); listener(status()); return () => listeners.delete(listener); };
  const join = async (req: MediaJoinIntent): Promise<MediaStatus> => {
    if (!contextValid(req)) return { ...status(), reason: 'owner-changed' };
    if (!binaryReady(req.owner)) return { ...status(), reason: 'transport-unavailable' };
    const previousCall = actualCall();
    if (previousCall && (previousCall.conversationId !== req.conversationId || (req.callRef && previousCall.callRef !== req.callRef))) {
      deps.recordingControl?.retireCall({ schemaVersion: 1, requestId: req.requestId, owner: req.owner,
        conversationId: previousCall.conversationId, callRef: previousCall.callRef });
      stopTelemetry(); callGeneration++; activeCallRef = null; activeEngineCallRef = null; activeCallConversationId = null;
      recording = 'idle'; soundcheckSnapshot = null;
    }
    activeRequestId = req.requestId;
    recording = 'idle';
    const active = ensureEngine(req.owner);
    if (!active) return { ...status(), state: 'failed', reason: 'owner-changed' };
    const generation = ++callGeneration;
    const finishWork = beginWork(req.owner, generation);
    try {
    lastError = null;
    const lease = await capture.claim(req.captureRef, req.owner, req.conversationId);
    const stream = lease?.stream ?? null;
    if (generation !== callGeneration || !contextValid(req)) { stream?.getTracks().forEach(track => track.stop()); await lease?.audioContext?.close().catch(() => {}); return { ...status(), reason: 'owner-changed' }; }
    if (!lease || !stream) { lastError = 'permission-required'; publish(); return { ...status(), reason: 'permission-required' }; }
    if ((req.kind === 'voice' || req.kind === 'video') && !captureMatchesInput(req.owner, lease.deviceId)) { stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {}); lastError = 'device-missing'; publish(); return { ...status(), reason: 'device-missing' }; }
    try {
      if (generation !== callGeneration || !contextValid(req)) {
        stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        return { ...status(), reason: 'owner-changed' };
      }
      if (!binaryReady(req.owner)) {
        stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        return { ...status(), reason: 'transport-unavailable' };
      }
      if (req.kind === 'voice') await active.joinVoice(req.conversationId, stream, lease.audioContext);
      else await active.joinVideo(req.conversationId, stream, lease.audioContext);
      if (generation !== callGeneration || !contextValid(req)) return { ...status(), reason: 'owner-changed' };
      activeCallRef = req.callRef ?? active.getCallRef(); activeEngineCallRef = active.getCallRef();
      activeCallConversationId = req.conversationId;
      const selectedInput = deviceDirectory.selectedInputRef(req.owner);
      appliedInputRef = selectedInput !== null && deviceDirectory.resolveInput(req.owner, selectedInput) === lease.deviceId ? selectedInput : null;
      inputState = 'applied'; inputReason = null;
      startTelemetry();
      publish();
      const callRef = activeCallRef as MediaCallRef;
      void refreshRecording({ ...req, callRef }).catch(() => {});
      return status();
    } catch (error) { if (!contextValid(req) || generation !== callGeneration) return { ...status(), reason: 'owner-changed' }; lastError = `${error}`.includes('Codec') ? 'codec-unavailable' : 'failed'; publish(); return status(); }
    } finally { finishWork(); }
  };
  const leave = async (req: MediaLeaveIntent): Promise<MediaStatus> => {
    if (!contextValid(req)) return { ...status(), reason: 'owner-changed' };
    const priorCall = actualCall();
    if (priorCall && deps.recordingControl) deps.recordingControl.retireCall({ ...req, conversationId: priorCall.conversationId, callRef: priorCall.callRef });
    stopTelemetry();
    callGeneration++;
    retireSoundchecks(req.owner);
    clearWork(req.owner);
    capture.retireOwner(req.owner);
    activeRequestId = null;
    activeCallRef = null; activeEngineCallRef = null; activeCallConversationId = null;
    if (req.conversationId) engine?.leaveRoom(req.conversationId);
    else engine?.leaveRoom('');
    for (const [id, preview] of previewStreams) if (sameOwner(preview.owner, req.owner)) { preview.stream.getTracks().forEach(t => t.stop()); previewStreams.delete(id); }
    recording = 'idle'; soundcheckSnapshot = null; lastError = null; publish(); return status();
  };
  const prepareCaptureFromGesture = (intentRef: string, requestOwner: OwnerSnapshot, conversationId: ConversationId, kind: CaptureKind, purpose: CapturePurpose = 'cadence-call', deviceRef?: string | null) => {
    if (!sameOwner(owner, requestOwner) || !deps.isCurrent(requestOwner)) return { available: false, reason: 'stale-owner' };
    if (purpose === 'cadence-call' && !binaryReady(requestOwner)) return { available: false, reason: 'transport-unavailable' };
    const deviceId = deviceRef === undefined ? deviceDirectory.preferredInputDeviceId(requestOwner)
      : deviceRef === null ? null : deviceDirectory.resolveInput(requestOwner, deviceRef);
    if (deviceRef !== undefined && deviceRef !== null && !deviceId) return { available: false, reason: 'device-missing' };
    if (deviceRef === null) deviceDirectory.selectInput(requestOwner, null);
    else if (deviceRef !== undefined && !deviceDirectory.selectInput(requestOwner, deviceRef)) return { available: false, reason: 'device-missing' };
    const prepared = capture.prepareFromGesture({ ref: intentRef, owner: requestOwner, kind, room: conversationId, ...(kind !== 'screen' && deviceId ? { deviceId } : {}) });
    if (!prepared.available) lastError = prepared.reason === 'unsupported' ? 'unsupported' : 'permission-required';
    publish(); return prepared;
  };
  const soundcheck = async (req: SoundcheckIntent): Promise<SoundcheckResult> => {
    if (!contextValid(req)) return { owner: req.owner, state: 'stale-owner', rms: null, sampledFrames: 0 };
    const generation = callGeneration;
    const result = await withWork<SoundcheckResult>(req.owner, generation, async (): Promise<SoundcheckResult> => {
    const lease = await capture.claim(req.captureRef, req.owner, 'soundcheck');
    const stream = lease?.stream ?? null;
    if (generation !== callGeneration) { stream?.getTracks().forEach(t => t.stop()); await lease?.audioContext?.close().catch(() => {}); return { owner: req.owner, state: 'stale-owner', rms: null, sampledFrames: 0 }; }
    if (!lease || !stream || !contextValid(req)) { stream?.getTracks().forEach(t => t.stop()); await lease?.audioContext?.close().catch(() => {}); return { owner: req.owner, state: 'permission-denied', rms: null, sampledFrames: 0 }; }
    if (!captureMatchesInput(req.owner, lease.deviceId)) { stream.getTracks().forEach(t => t.stop()); await lease.audioContext?.close().catch(() => {}); return { owner: req.owner, state: 'unavailable', rms: null, sampledFrames: 0 }; }
    const resource = { owner: req.owner, stream, context: lease.audioContext, source: null as MediaStreamAudioSourceNode | null,
      analyser: null as AnalyserNode | null, cleaned: false };
    soundcheckResources.add(resource);
    let ctx: AudioContext | null = lease.audioContext;
    try {
      ctx ??= new AudioContext(); await ctx.resume();
      resource.context = ctx;
      const source = ctx.createMediaStreamSource(stream); const analyser = ctx.createAnalyser(); resource.source = source; resource.analyser = analyser; analyser.fftSize = 1024; source.connect(analyser);
      const data = new Float32Array(analyser.fftSize); const end = performance.now() + Math.max(250, Math.min(req.durationMs ?? 1500, 3000));
      let sum = 0; let frames = 0;
      while (performance.now() < end && contextValid(req) && generation === callGeneration) { analyser.getFloatTimeDomainData(data); let energy = 0; for (const sample of data) energy += sample * sample; sum += Math.sqrt(energy / data.length); frames++; await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); }
      const rms = frames ? sum / frames : null;
      const state: SoundcheckResult['state'] = !contextValid(req) || generation !== callGeneration ? 'stale-owner' : rms !== null && rms > 0.003 ? 'input-signal-detected' : 'silence';
      return { owner: req.owner, state, rms, sampledFrames: frames };
    } catch { return { owner: req.owner, state: 'unavailable', rms: null, sampledFrames: 0 }; }
    finally { stopSoundcheckResource(resource); soundcheckResources.delete(resource); }
    });
    if (contextValid(req)) {
      soundcheckSnapshot = { state: result.state, rms: result.rms, sampledFrames: result.sampledFrames };
      publish();
    }
    return result;
  };
  const previewCamera = async (req: CaptureIntent): Promise<PreviewRef | null> => {
    if (req.kind !== 'camera' || !contextValid(req)) return null;
    const generation = callGeneration;
    return withWork(req.owner, generation, async () => {
    const lease = await capture.claim(req.captureRef, req.owner, req.conversationId);
    const stream = lease?.stream ?? null;
    if (!lease || !stream || !contextValid(req) || generation !== callGeneration) { stream?.getTracks().forEach(t => t.stop()); await lease?.audioContext?.close().catch(() => {}); return null; }
    if (!captureMatchesInput(req.owner, lease.deviceId)) { stream.getTracks().forEach(t => t.stop()); await lease.audioContext?.close().catch(() => {}); return null; }
    const id = newOpaqueId(); previewStreams.set(id, { owner: req.owner, stream, audioContext: lease.audioContext, deviceId: lease.deviceId, video: null, conversationId: req.conversationId });
    return { id, ownerRef: req.owner.ownerRef, conversationId: req.conversationId };
    });
  };
  const attachPreview = (ref: PreviewRef, video: HTMLVideoElement) => {
    const item = previewStreams.get(ref.id);
    if (!item || item.owner.ownerRef !== ref.ownerRef || !identityContextCurrent()) return false;
    video.muted = true; video.playsInline = true; video.srcObject = item.stream; item.video = video;
    void video.play().catch(() => {}); return true;
  };
  const retirePreview = (ref: PreviewRef) => { const item = previewStreams.get(ref.id); if (!item || item.owner.ownerRef !== ref.ownerRef) return; if (item.video?.srcObject === item.stream) item.video.srcObject = null; item.stream.getTracks().forEach(t => t.stop()); void item.audioContext?.close().catch(() => {}); previewStreams.delete(ref.id); };
  const publishCamera = async (req: PublicationIntent): Promise<MediaStatus> => {
    const preview = previewStreams.get(req.previewRef);
    if (!preview || !contextValid(req) || !sameOwner(preview.owner, req.owner) || preview.conversationId !== req.conversationId) return { ...status(), reason: 'owner-changed' };
    if (!captureMatchesInput(req.owner, preview.deviceId)) return { ...status(), reason: 'device-missing' };
    if (!binaryReady(req.owner)) return { ...status(), reason: 'transport-unavailable' };
    const active = ensureEngine(req.owner); if (!active) return { ...status(), reason: 'owner-changed' };
    // A prior failed attempt must not make this new valid publication look
    // failed after it succeeds. Errors raised during this attempt remain.
    lastError = null;
    activeRequestId = req.requestId;
    const generation = ++callGeneration;
    return withWork(req.owner, generation, async () => {
    try { if (!binaryReady(req.owner)) return { ...status(), reason: 'transport-unavailable' }; await active.joinVideo(req.conversationId, preview.stream, preview.audioContext); if (generation !== callGeneration || !contextValid(req)) return { ...status(), reason: 'owner-changed' }; activeCallRef = req.callRef ?? active.getCallRef(); activeEngineCallRef = active.getCallRef(); activeCallConversationId = req.conversationId; const selectedInput=deviceDirectory.selectedInputRef(req.owner);appliedInputRef=selectedInput!==null&&deviceDirectory.resolveInput(req.owner,selectedInput)===preview.deviceId?selectedInput:null;inputState='applied';inputReason=null;if (preview.video?.srcObject === preview.stream) preview.video.srcObject = null; previewStreams.delete(req.previewRef); startTelemetry(); publish(); return status(); }
    catch { if (!contextValid(req) || generation !== callGeneration) return { ...status(), reason: 'owner-changed' }; lastError = 'failed'; publish(); return status(); }
    });
  };
  const startScreen = async (req: CaptureIntent): Promise<MediaStatus> => {
    if (req.kind !== 'screen' || !contextValid(req)) return { ...status(), reason: 'owner-changed' };
    if (!binaryReady(req.owner)) return { ...status(), reason: 'transport-unavailable' };
    lastError = null;
    activeRequestId = req.requestId;
    const generation = ++callGeneration;
    return withWork(req.owner, generation, async () => {
    const lease = await capture.claim(req.captureRef, req.owner, req.conversationId);
    const stream = lease?.stream ?? null;
    if (!lease || !stream || !contextValid(req) || generation !== callGeneration) { stream?.getTracks().forEach(t => t.stop()); await lease?.audioContext?.close().catch(() => {}); return { ...status(), reason: generation !== callGeneration ? 'owner-changed' : 'permission-required' }; }
    if (!binaryReady(req.owner)) { stream.getTracks().forEach(t => t.stop()); await lease.audioContext?.close().catch(() => {}); return { ...status(), reason: 'transport-unavailable' }; }
    const active = ensureEngine(req.owner); if (!active) { stream.getTracks().forEach(t => t.stop()); return { ...status(), reason: 'owner-changed' }; }
    try { await active.startBroadcast(req.conversationId, 'screen', '4k60', stream); if (generation !== callGeneration || !contextValid(req)) return { ...status(), reason: 'owner-changed' }; activeCallRef = req.callRef ?? active.getCallRef(); activeEngineCallRef = active.getCallRef(); activeCallConversationId = req.conversationId; publish(); return status(); }
    catch { stream.getTracks().forEach(t => t.stop()); await lease.audioContext?.close().catch(() => {}); if (!contextValid(req) || generation !== callGeneration) return { ...status(), reason: 'owner-changed' }; lastError = 'failed'; publish(); return status(); }
    });
  };
  const stopScreen = (req: StopIntent) => { if (!contextValid(req)) return; engine?.stopScreenShare(); publish(); };
  const setInput = async (req: DeviceIntent): Promise<MediaStatus> => {
    if (!contextValid(req)) return { ...status(), reason: 'owner-changed' };
    const generation = callGeneration;
    return withWork(req.owner, generation, async () => {
    const track = engine?.getLocalStream()?.getAudioTracks()[0];
    if (!track) return { ...status(), reason: 'device-missing' };
    try { await track.applyConstraints(req.deviceId ? { deviceId: { exact: req.deviceId } } : {}); if (!contextValid(req) || generation !== callGeneration) return { ...status(), reason: 'owner-changed' }; return status(); }
    catch { if (!contextValid(req) || generation !== callGeneration) return { ...status(), reason: 'owner-changed' }; lastError = 'device-missing'; publish(); return status(); }
    });
  };
  const setOutput = async (req: DeviceIntent): Promise<MediaStatus> => { if (!contextValid(req)) return { ...status(), reason: 'owner-changed' }; engine?.setOutput(req.deviceId, Math.max(0, Math.min(100, req.volumePercent ?? 80))); return status(); };
  const refreshDevices = async (context: RequestContext): Promise<MediaControlSnapshot | null> => {
    if (!contextValid(context)) return null;
    await deviceDirectory.refresh(context.owner);
    if (!contextValid(context)) return null;
    publishControl(); return inspect(context);
  };
  const setMediaInput = async (intent: MediaInputIntent): Promise<MediaControlSnapshot | null> => {
    if (!contextValid(intent)) return null;
    const effectGeneration = ++inputEffectGeneration;
    requestedInputRef = intent.deviceRef;
    inputReason = null;
    const deviceId = intent.deviceRef === null ? null : deviceDirectory.resolveInput(intent.owner, intent.deviceRef);
    if (intent.deviceRef !== null && !deviceId) { inputState = 'rejected'; inputReason = 'device-ref-expired'; publishControl(); return inspect(intent); }
    const call = actualCall();
    const exactLiveCall = intent.conversationId !== null && intent.callRef !== null && call?.conversationId === intent.conversationId && call.callRef === intent.callRef;
    if (intent.conversationId !== null || intent.callRef !== null) {
      if (!exactLiveCall) { inputState = 'rejected'; inputReason = 'call-changed'; publishControl(); return inspect(intent); }
    }
    if (!exactLiveCall) {
      if (!deviceDirectory.selectInput(intent.owner, intent.deviceRef)) { inputState = 'rejected'; inputReason = 'device-ref-expired'; }
      else { inputState = 'deferred'; inputReason = null; }
      publishControl(); return inspect(intent);
    }
    if (!intent.captureRef) { inputState = 'rejected'; inputReason = 'fresh-capture-required'; publishControl(); return inspect(intent); }
    inputState = 'pending'; publishControl();
    const generation = callGeneration;
    const context: MediaCallContext = { ...intent, conversationId: intent.conversationId!, callRef: intent.callRef! };
    const operation = inputEffectQueue.then(() => withWork(intent.owner, generation, async () => {
      if (effectGeneration !== inputEffectGeneration) { capture.release(intent.captureRef!, intent.owner, context.conversationId); return null; }
      const lease = await capture.claim(intent.captureRef!, intent.owner, context.conversationId);
      if (!lease || !contextValid(intent) || generation !== callGeneration || actualCall()?.callRef !== context.callRef) {
        lease?.stream.getTracks().forEach(track => track.stop()); await lease?.audioContext?.close().catch(() => {});
        if (contextValid(intent)) { inputState = 'rejected'; inputReason = 'capture-unavailable'; publishControl(); }
        return inspect(intent);
      }
      if (deviceId !== lease.deviceId) {
        lease.stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        inputState = 'rejected'; inputReason = 'capture-device-mismatch'; publishControl(); return inspect(intent);
      }
      const active = engine;
      if (!active || typeof active.replaceAudioInput !== 'function') {
        lease.stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        inputState = 'rejected'; inputReason = 'audio-input-switch-unsupported'; publishControl(); return inspect(intent);
      }
      if (effectGeneration !== inputEffectGeneration) {
        lease.stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        return inspect(intent);
      }
      if (!deviceDirectory.selectInput(intent.owner, intent.deviceRef)) {
        lease.stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {});
        inputState = 'rejected'; inputReason = 'device-ref-expired'; publishControl(); return inspect(intent);
      }
      let transferred = false;
      try {
        const applied = await active.replaceAudioInput(lease.stream, lease.audioContext);
        if (!contextValid(intent) || generation !== callGeneration || actualCall()?.callRef !== context.callRef) return inspect(intent);
        if (!applied) throw new Error('input-switch-failed');
        transferred = true;
        if (effectGeneration !== inputEffectGeneration) return null;
        appliedInputRef = intent.deviceRef !== null && deviceDirectory.resolveInput(intent.owner, intent.deviceRef) ? intent.deviceRef : null;
        inputState = 'applied'; inputReason = appliedInputRef === null && intent.deviceRef !== null ? 'device-ref-expired-after-apply' : null;
        publishControl(); return inspect(intent);
      } catch (error) {
        if (!transferred) { lease.stream.getTracks().forEach(track => track.stop()); await lease.audioContext?.close().catch(() => {}); }
        if (!contextValid(intent) || generation !== callGeneration) return null;
        if (effectGeneration !== inputEffectGeneration) return null;
        inputState = 'rejected'; inputReason = error instanceof Error && error.message === 'device-ref-expired' ? 'device-ref-expired' : 'input-switch-failed';
        publishControl(); return inspect(intent);
      }
    }));
    inputEffectQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const setMediaOutput = async (intent: MediaOutputIntent): Promise<MediaControlSnapshot | null> => {
    if (!contextValid(intent)) return null;
    const effectGeneration = ++outputEffectGeneration;
    const volumePercent = Math.max(0, Math.min(100, Math.round(intent.volumePercent)));
    requestedOutputRef = intent.deviceRef;
    requestedVolumePercent = volumePercent;
    outputReason = null;
    const deviceId = intent.deviceRef === null ? null : deviceDirectory.resolveOutput(intent.owner, intent.deviceRef);
    if (intent.deviceRef !== null && !deviceId) { outputState = 'rejected'; outputReason = 'device-ref-expired'; publishControl(); return inspect(intent); }
    requestedOutputDeviceId = deviceId;
    if (outputOperationToken !== null) {
      outputState = 'deferred'; outputReason = 'output-selection-busy-retry'; publishControl(); return inspect(intent);
    }
    const operationToken = {};
    outputOperationToken = operationToken;
    if (!deviceDirectory.selectOutput(intent.owner, intent.deviceRef)) {
      if (outputOperationToken === operationToken) outputOperationToken = null;
      outputState = 'rejected'; outputReason = 'device-ref-expired'; publishControl(); return inspect(intent);
    }
    outputState = 'pending'; publishControl();
    const targetEngine = engine;
    if (!targetEngine) {
      if (outputOperationToken === operationToken) outputOperationToken = null;
      if (contextValid(intent) && effectGeneration === outputEffectGeneration) {
        outputState = 'deferred'; appliedOutputRef = null; outputReason = null; publishControl(); return inspect(intent);
      }
      return null;
    }
    // Call setOutput before the first await so browser sink selection remains
    // inside the trusted user gesture. This exact owner/engine binding is
    // checked immediately before that physical effect.
    if (!contextValid(intent) || effectGeneration !== outputEffectGeneration || engine !== targetEngine) {
      if (outputOperationToken === operationToken) outputOperationToken = null;
      return null;
    }
    let pendingEffect: ReturnType<CadenceMediaEngine['setOutput']>;
    try { pendingEffect = targetEngine.setOutput(deviceId, volumePercent); }
    catch {
      if (outputOperationToken === operationToken) outputOperationToken = null;
      if (contextValid(intent) && effectGeneration === outputEffectGeneration) { outputState = 'rejected'; outputReason = 'output-selection-failed'; publishControl(); return inspect(intent); }
      return null;
    }
    try {
      const result = await pendingEffect;
      if (!contextValid(intent) || effectGeneration !== outputEffectGeneration || engine !== targetEngine) return null;
      if (result.volumeState === 'applied') appliedVolumePercent = Math.round(result.volume * 100);
      if (result.state === 'applied') { outputState = 'applied'; appliedOutputRef = intent.deviceRef; outputReason = null; }
      else if (result.state === 'unsupported') { outputState = 'unknown'; outputReason = 'output-selection-unsupported'; }
      else if (result.state === 'deferred') { outputState = 'deferred'; outputReason = result.reason; }
      else { outputState = 'rejected'; outputReason = result.reason ?? 'output-selection-failed'; }
      publishControl(); return inspect(intent);
    } catch {
      if (contextValid(intent) && effectGeneration === outputEffectGeneration && engine === targetEngine) {
        outputState = 'rejected'; outputReason = 'output-selection-failed'; publishControl(); return inspect(intent);
      }
      return null;
    } finally { if (outputOperationToken === operationToken) outputOperationToken = null; }
  };
  const callMatches = (context: MediaCallContext) => contextValid(context) && actualCall()?.conversationId === context.conversationId && actualCall()?.callRef === context.callRef;
  const setMediaConsent = async (intent: MediaConsentIntent): Promise<MediaControlSnapshot | null> => {
    if (!callMatches(intent) || !deps.recordingControl) return null;
    try {
      const result = await deps.recordingControl.setConsent(intent);
      if (!callMatches(intent) || !sameOwner(result.owner, intent.owner) || result.conversationId !== intent.conversationId || result.callRef !== intent.callRef) return null;
      recording = result.recording.consentRequest === 'pending' ? 'pending' : recording;
      publish(); return inspect(intent);
    } catch { return null; }
  };
  const requestRecording = async (intent: MediaRecordingIntent): Promise<MediaControlSnapshot | null> => {
    if (!callMatches(intent) || !deps.recordingControl) return null;
    try {
      const result = await deps.recordingControl.requestRecording(intent);
      if (!callMatches(intent) || !sameOwner(result.owner, intent.owner) || result.conversationId !== intent.conversationId || result.callRef !== intent.callRef) return null;
      recording = result.recording.requestState === 'pending' ? 'pending' : result.recording.actual === 'active' ? 'active' : 'idle';
      publish(); return inspect(intent);
    } catch { return null; }
  };
  const refreshRecording = async (context: MediaCallContext): Promise<MediaControlSnapshot | null> => {
    if (!callMatches(context) || !deps.recordingControl) return null;
    try { const result = await deps.recordingControl.refresh(context); if (!callMatches(context) || !sameOwner(result.owner, context.owner) || result.callRef !== context.callRef || result.conversationId !== context.conversationId) return null; publish(); return inspect(context); }
    catch { return null; }
  };
  const consumePrivateIngress = (event: PrivateIngressEvent): boolean => {
    if (disposed || !deps.recordingControl || !sameOwner(event.owner, owner) || !deps.isCurrent(event.owner)) return false;
    const consumed = deps.recordingControl.consumePrivateIngress(event);
    if (consumed) publishControl();
    return consumed;
  };
  const recoverAudio = async (context: MediaCallContext): Promise<{ readonly state: MediaEffectState; readonly reason: string | null }> => {
    if (!callMatches(context) || !engine) return { state: 'rejected', reason: 'call-changed' };
    try { const result = await engine.recoverAudio(); if (!callMatches(context)) return { state: 'rejected', reason: 'call-changed' }; publishControl(); return result; }
    catch { return { state: 'rejected', reason: 'audio-recovery-failed' }; }
  };
  const setMuted = (req: MuteIntent) => { if (!contextValid(req)) return; muted = req.muted; engine?.setMuted(req.muted); publish(); };
  const setDeafened = (req: DeafenIntent) => { if (!contextValid(req)) return; deafened = req.deafened; engine?.setDeafened(req.deafened); publish(); };
  const qualitySnapshot = (req: MediaQualitySnapshotIntent): MediaQualityStatus | null => {
    if (!contextValid(req.context) || !engine || activeCallRef !== req.callRef || activeEngineCallRef === null
      || engine.getCallState().callState !== 'in_call' || engine.getCallState().callChannel !== req.conversationId
      || engine.getCallRef() !== activeEngineCallRef) return null;
    return { owner: req.context.owner, conversationId: req.conversationId, callRef: req.callRef,
      desiredPolicy: desiredQualityPolicy, ...engine.getQualityObservation() };
  };
  const setQuality = (req: SetMediaQualityIntent): MediaQualityStatus | null => {
    if (!qualitySnapshot(req)) return null;
    const active = engine;
    if (!active) return null;
    try {
      active.setQualityPolicy(req.policy);
      desiredQualityPolicy = req.policy;
      publish();
      return qualitySnapshot(req);
    } catch { return null; }
  };
  const cloneLocalAudioTrack = (req: MediaCallContext): MediaStreamTrack | null => {
    const active = engine;
    if (!active || !callMatches(req) || engine !== active) return null;
    const track=active.getLocalStream()?.getAudioTracks()[0];
    if(!track||track.readyState!=='live')return null;
    try{return track.clone();}catch{return null;}
  };
  const setConsent = async (req: ConsentIntent): Promise<MediaStatus> => {
    const call = actualCall();
    if (!contextValid(req) || !call || call.conversationId !== req.conversationId || !deps.recordingControl) return { ...status(), reason: 'owner-changed' };
    const result = await setMediaConsent({ ...req, callRef: call.callRef });
    return result ? status() : { ...status(), reason: 'owner-changed' };
  };
  const record = async (req: RecordingIntent): Promise<MediaStatus> => {
    const call = actualCall();
    if (!contextValid(req) || !call || call.conversationId !== req.conversationId || !deps.recordingControl) return { ...status(), reason: 'owner-changed' };
    const result = await requestRecording({ ...req, callRef: call.callRef });
    return result ? status() : { ...status(), reason: 'owner-changed' };
  };
  const onRecordingControlResult = (result: MediaRecordingControlResult): void => {
    const call = actualCall();
    if (!call || !sameOwner(owner, result.owner) || call.conversationId !== result.conversationId || call.callRef !== result.callRef || !deps.isCurrent(result.owner)) return;
    const view = result.recording;
    recording = view.actual === 'active' ? 'active'
      : view.requestState === 'pending' || view.consentRequest === 'pending' ? 'pending'
        : view.requestState === 'rejected' || view.consentRequest === 'rejected' ? 'failed' : 'idle';
    publish();
  };
  const receiveBinary = (frame: Uint8Array, frameOwner: OwnerSnapshot) => {
    if (!engine || !sameOwner(owner, frameOwner) || !deps.isCurrent(frameOwner) || !(frame instanceof Uint8Array)) return;
    // The actual private media ingress is normally intercepted by the scoped
    // transport adapter before public line projection. This facade refuses
    // stale-owner bytes and never exposes them in public status.
    engine.receiveBinary(frame);
  };
  const hasActiveWork = (candidate: OwnerSnapshot): boolean => {
    if (!contextValid({ schemaVersion: 1, requestId: 'AAAAAAAAAAAAAAAAAAAAAA' as never, owner: candidate })) return false;
    let callActive = false;
    try {
      const call = engine?.getCallState();
      callActive = call?.callState === 'in_call' && typeof call.callChannel === 'string' && call.callChannel.length > 0;
    } catch { callActive = false; }
    if (callActive || recording === 'pending' || recording === 'active') return true;
    if ([...soundcheckResources].some(resource => sameOwner(resource.owner, candidate)
      && !resource.cleaned && resource.stream.getTracks().some(track => track.readyState === 'live'))) return true;
    if ([...previewStreams.values()].some(item => sameOwner(item.owner, candidate)
      && item.stream.getTracks().some(track => track.readyState === 'live'))) return true;
    if ([...inFlightWork].some(operation => sameOwner(operation.owner, candidate) && operation.generation === callGeneration)) return true;
    try { return capture.hasActiveWork?.(candidate) ?? false; } catch { return false; }
  };
  const retireOwner = (previous:OwnerSnapshot,next:OwnerSnapshot):void=>{
    if(disposed||owner.ownerRef!==previous.ownerRef)return;
    outputEffectGeneration++; outputOperationToken = null;
    deps.recordingControl?.retireOwner(previous, next);
    stopTelemetry();
    callGeneration++;retireSoundchecks(previous);clearWork(previous);listenerGeneration++;activeRequestId=null;activeCallRef=null;activeEngineCallRef=null;activeCallConversationId=null;capture.retireOwner(previous);
    try{engine?.leaveRoom('');}catch{/* old room teardown is best effort */}
    try{engine?.setClient(null);}catch{/* client detachment is best effort */}
    engine=null;owner=next;recording='idle';desiredQualityPolicy='auto';lastError=null;
    deviceDirectory.retireOwner(previous); soundcheckSnapshot=null; telemetry.reset(); requestedInputRef=null; appliedInputRef=null; inputState='idle'; inputReason=null; requestedOutputRef=null; requestedOutputDeviceId=null; appliedOutputRef=null; outputState='idle'; outputReason=null; appliedVolumePercent=null;
    for(const item of previewStreams.values()){if(item.video?.srcObject===item.stream)item.video.srcObject=null;item.stream.getTracks().forEach(t=>t.stop());void item.audioContext?.close().catch(()=>{});}
    previewStreams.clear();publish();
  };
  return {
    subscribe, subscribeControl, inspect, refreshDevices, setMediaInput, setMediaOutput, setMediaConsent, requestRecording, refreshRecording, consumePrivateIngress, onRecordingControlResult, recoverAudio,
    soundcheck, join, leave, setInput, setOutput, setMuted, setDeafened, setQuality, qualitySnapshot, cloneLocalAudioTrack,
    prepareCaptureFromGesture, previewCamera, attachPreview, retirePreview, publishCamera, startScreen, stopScreen,
    setConsent, record, receiveBinary, hasActiveWork, snapshot: status, retireOwner,
    dispose() {
      if (disposed) return; disposed = true; stopTelemetry(); callGeneration++; retireSoundchecks(); clearWork(); listenerGeneration++;
      outputEffectGeneration++; outputOperationToken = null;
      deps.recordingControl?.dispose(); deviceDirectory.dispose(); capture.dispose(); telemetry.dispose();
      for (const item of previewStreams.values()) { if (item.video?.srcObject === item.stream) item.video.srcObject = null; item.stream.getTracks().forEach(t => t.stop()); void item.audioContext?.close().catch(() => {}); } previewStreams.clear();
      activeCallRef = null; activeEngineCallRef = null; activeCallConversationId = null; engine?.setClient(null); engine = null; listeners.clear(); controlListeners.clear();
    },
  };
}
