// SPDX-License-Identifier: AGPL-3.0-or-later
// -------------------------------------------------------------------
// Public types — exported from cadence-media
// -------------------------------------------------------------------

export type CallState     = 'idle' | 'ringing_out' | 'ringing_in' | 'in_call';
export type VoiceCallState = CallState;
export type MediaKind     = 'voice' | 'video' | 'screen';

export interface CadencePeerState {
  nick:     string;
  channel:  string | null;
  kind:     MediaKind;
  speaking: boolean;
  muted:    boolean;
  hasVideo: boolean;
  canvas:   HTMLCanvasElement | null;
}

export interface CadenceRoomStats {
  active_senders: number;
  total_viewers:  number;
  video_fps:      number;
  audio_kbps:     number;
  /**
   * Optional mesh SFU cascade advertisement (remote forwarder count).
   * Absent when the media plane has not published topology yet.
   */
  remote_forwarders?: number;
  /** Optional path loss fraction [0,1] when the SFU advertises it on STATS. */
  packet_loss?: number;
  /** Optional explicit local-SFU flag from room STATS. */
  local_sfu?: boolean;
}

/** 0 = excellent  1 = good  2 = fair  3 = poor */
export type NetworkQualityTier = 0 | 1 | 2 | 3;

export interface CadenceChannelInfo {
  voiceCount: number;
  voiceMax:   number;
  videoCount: number;
  videoMax:   number;
  flags:      number;
}

export interface CadenceMediaCallbacks {
  onCallState:       (state: CallState, nick: string, channel: string | null) => void;
  onPeerState?:      (peer: CadencePeerState) => void;
  onPeerLeft:        (nick: string) => void;
  onPeerSpeaking?:   (nick: string, speaking: boolean) => void;
  onLocalStream:     (stream: MediaStream | null) => void;
  onRoomStats?:      (channel: string, stats: CadenceRoomStats) => void;
  onError:           (msg: string) => void;
  onDecodeError?:    (peer: string, type: MediaKind, err: unknown) => void;
  onAudioLevel?:     (nick: string, level: number) => void;
  onPresence?:       (nick: string, available: boolean) => void;
  onNetworkQuality?: (tier: NetworkQualityTier, suggestedBps: number) => void;
  onReaction?:       (nick: string, emoji: string) => void;
  onRecordingAlert?: (nick: string, started: boolean) => void;
  onRoomNearFull?:   () => void;
  onRecordConsent?:  (nick: string) => void;
  onChannelInfo?:    (channel: string, info: CadenceChannelInfo) => void;
  onMooringState?:      (nick: string, epoch: number, fingerprint: string) => void;
  /** Negotiated media E2EE state. A closed padlock is permitted only while active. */
  onMediaE2eeState?:    (active: boolean, degraded: boolean, epoch: number) => void;
  /** Bind a presented media handshake key to the peer's pinned account key. */
  verifyPeerMediaKey?:  (
    nick: string,
    publicKeyB64url: string,
    attachmentId: string,
    trustBinding: string,
  ) => Promise<boolean>;
  enableVideoCalls?: () => boolean;
  enableVoiceCalls?: () => boolean;
  getMediaQuality?:  () => { audioQuality: 0 | 1 | 2; videoQuality: number; noiseSuppress: boolean };
  getMediaSettings?: () => {
    inputDeviceId: string | null;
    cameraDeviceId: string | null;
    outputDeviceId: string | null;
    outputVolume: number;
    noiseSuppression: boolean;
    echoCancellation: boolean;
  };
  getLocalNick?:      () => string;
}
