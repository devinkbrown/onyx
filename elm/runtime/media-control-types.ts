// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ConversationId, MediaCallRef, OwnerSnapshot, RequestContext } from './contracts';
import type { MediaTelemetrySnapshot } from './media-telemetry';

export type MediaEffectState = 'idle' | 'pending' | 'applied' | 'deferred' | 'unknown' | 'rejected';
export type MediaConsentValue = 'unknown' | 'granted' | 'denied';
export type MediaRequestState = 'idle' | 'pending' | 'unknown' | 'rejected';
export type MediaRecordingActual = 'unknown' | 'inactive' | 'active';
export type MediaRosterState = 'unknown' | 'pending' | 'complete' | 'stale';

export interface MediaDeviceChoice { readonly ref: string; readonly label: string }
export interface MediaDeviceDirectorySnapshot {
  readonly inputs: readonly MediaDeviceChoice[];
  readonly outputs: readonly MediaDeviceChoice[];
  readonly inputSupported: boolean;
  readonly outputSelectionSupported: boolean;
}
export interface MediaDeviceSnapshot {
  readonly inputs: readonly MediaDeviceChoice[];
  readonly outputs: readonly MediaDeviceChoice[];
  readonly selectedInputRef: string | null;
  readonly requestedInputRef: string | null;
  readonly appliedInputRef: string | null;
  readonly inputState: MediaEffectState;
  readonly inputReason: string | null;
  readonly selectedOutputRef: string | null;
  readonly requestedOutputRef: string | null;
  readonly appliedOutputRef: string | null;
  readonly outputState: MediaEffectState;
  readonly outputReason: string | null;
  readonly requestedVolumePercent: number;
  readonly appliedVolumePercent: number | null;
}

export interface MediaSoundcheckSnapshot {
  readonly state: 'input-signal-detected' | 'silence' | 'permission-denied' | 'unavailable' | 'stale-owner';
  readonly rms: number | null;
  readonly sampledFrames: number;
}

export interface MediaRecordingSnapshot {
  readonly ownConsent: MediaConsentValue;
  readonly consentRequest: MediaRequestState;
  readonly desiredAction: 'start' | 'stop' | null;
  readonly requestState: MediaRequestState;
  readonly actual: MediaRecordingActual;
  readonly rosterState: MediaRosterState;
  readonly allConsented: boolean | null;
  /** Opaque digest of the exact complete server roster/consent observation. */
  readonly policyRevision: string | null;
  readonly reason: string | null;
}

export interface MediaCaptionSnapshot {
  readonly owner: OwnerSnapshot;
  readonly conversationId: ConversationId;
  readonly callRef: MediaCallRef;
  readonly state: 'idle' | 'preparing' | 'ready' | 'listening' | 'unavailable' | 'failed' | 'stopped';
  readonly reason: string | null;
  readonly mode: 'local' | 'browser-service' | null;
  readonly language: string | null;
  readonly source: 'local-participant-microphone' | 'browser-service' | null;
  readonly accuracy: 'unknown' | null;
  readonly interimText: string | null;
  readonly serverVisible: true;
}

export interface MediaLocalWebRtcSnapshot {
  readonly owner: OwnerSnapshot;
  readonly scope: 'same-browser-loopback';
  readonly reason: string | null;
  readonly connectionState: string | null;
  readonly bytes: number | null;
  readonly packets: number | null;
  readonly frames: number | null;
  readonly durationMs: number | null;
}

export interface MediaControlSnapshot {
  readonly owner: OwnerSnapshot;
  readonly sequence: number;
  readonly call: { readonly conversationId: ConversationId; readonly callRef: MediaCallRef } | null;
  readonly reason: string | null;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly devices: MediaDeviceSnapshot;
  readonly soundcheck: MediaSoundcheckSnapshot | null;
  readonly recording: MediaRecordingSnapshot;
  readonly telemetry: MediaTelemetrySnapshot;
  readonly caption: MediaCaptionSnapshot | null;
  readonly webRtc: MediaLocalWebRtcSnapshot | null;
}

export interface MediaCallContext extends RequestContext {
  readonly conversationId: ConversationId;
  readonly callRef: MediaCallRef;
}

export interface MediaInputIntent extends RequestContext {
  readonly deviceRef: string | null;
  readonly conversationId: ConversationId | null;
  readonly callRef: MediaCallRef | null;
  readonly captureRef: string | null;
}

export interface MediaOutputIntent extends RequestContext {
  readonly deviceRef: string | null;
  readonly volumePercent: number;
}

export interface MediaRecordingIntent extends MediaCallContext {
  readonly action: 'start' | 'stop';
  readonly consentRevision: string | null;
}

export interface MediaConsentIntent extends MediaCallContext {
  readonly consent: 'granted' | 'denied';
  readonly policyRevision: string | null;
}

/** Shared backend facade contract. Elm's bridge serializes only snapshots and
 * opaque refs; browser device IDs, streams and contexts remain private. */
export interface MediaControlBackend {
  subscribeControl(listener: (snapshot: MediaControlSnapshot) => void): () => void;
  inspect(context: RequestContext): MediaControlSnapshot | null;
  refreshDevices(context: RequestContext): Promise<MediaControlSnapshot | null>;
  setMediaInput(intent: MediaInputIntent): Promise<MediaControlSnapshot | null>;
  setMediaOutput(intent: MediaOutputIntent): Promise<MediaControlSnapshot | null>;
  setMediaConsent(intent: MediaConsentIntent): Promise<MediaControlSnapshot | null>;
  requestRecording(intent: MediaRecordingIntent): Promise<MediaControlSnapshot | null>;
  refreshRecording(context: MediaCallContext): Promise<MediaControlSnapshot | null>;
  recoverAudio(context: MediaCallContext): Promise<{ readonly state: MediaEffectState; readonly reason: string | null }>;
}
