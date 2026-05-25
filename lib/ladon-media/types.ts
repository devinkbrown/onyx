'use client';

// -------------------------------------------------------------------
// Public types — exported from ladon-media
// -------------------------------------------------------------------

export type CallState     = 'idle' | 'ringing_out' | 'ringing_in' | 'in_call';
export type VoiceCallState = CallState;
export type MediaKind     = 'voice' | 'video' | 'screen';

export interface LadonPeerState {
  nick:     string;
  channel:  string | null;
  kind:     MediaKind;
  speaking: boolean;
  muted:    boolean;
  hasVideo: boolean;
  canvas:   HTMLCanvasElement | null;
}

export interface LadonRoomStats {
  active_senders: number;
  total_viewers:  number;
  video_fps:      number;
  audio_kbps:     number;
}

/** 0 = excellent  1 = good  2 = fair  3 = poor */
export type NetworkQualityTier = 0 | 1 | 2 | 3;

export interface LadonChannelInfo {
  voiceCount: number;
  voiceMax:   number;
  videoCount: number;
  videoMax:   number;
  flags:      number;
}

export interface LadonMediaCallbacks {
  onCallState:       (state: CallState, nick: string, channel: string | null) => void;
  onPeerState?:      (peer: LadonPeerState) => void;
  onPeerLeft:        (nick: string) => void;
  onPeerSpeaking?:   (nick: string, speaking: boolean) => void;
  onLocalStream:     (stream: MediaStream | null) => void;
  onRoomStats?:      (channel: string, stats: LadonRoomStats) => void;
  onError:           (msg: string) => void;
  onDecodeError?:    (peer: string, type: MediaKind, err: unknown) => void;
  onAudioLevel?:     (nick: string, level: number) => void;
  onPresence?:       (nick: string, available: boolean) => void;
  onNetworkQuality?: (tier: NetworkQualityTier, suggestedBps: number) => void;
  onReaction?:       (nick: string, emoji: string) => void;
  onRecordingAlert?: (nick: string, started: boolean) => void;
  onRoomNearFull?:   () => void;
  onRecordConsent?:  (nick: string) => void;
  onChannelInfo?:    (channel: string, info: LadonChannelInfo) => void;
  onVeilState?:      (nick: string, epoch: number, fingerprint: string) => void;
  enableVideoCalls?: () => boolean;
  enableVoiceCalls?: () => boolean;
  getMediaQuality?:  () => { audioQuality: 0 | 1 | 2; videoQuality: number; noiseSuppress: boolean };
}
