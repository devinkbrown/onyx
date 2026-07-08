// -------------------------------------------------------------------
// Public types — exported from suimyaku-media
// -------------------------------------------------------------------

export type CallState     = 'idle' | 'ringing_out' | 'ringing_in' | 'in_call';
export type VoiceCallState = CallState;
export type MediaKind     = 'voice' | 'video' | 'screen';

export interface SuimyakuPeerState {
  nick:     string;
  channel:  string | null;
  kind:     MediaKind;
  speaking: boolean;
  muted:    boolean;
  hasVideo: boolean;
  canvas:   HTMLCanvasElement | null;
}

export interface SuimyakuRoomStats {
  active_senders: number;
  total_viewers:  number;
  video_fps:      number;
  audio_kbps:     number;
}

/** 0 = excellent  1 = good  2 = fair  3 = poor */
export type NetworkQualityTier = 0 | 1 | 2 | 3;

export interface SuimyakuChannelInfo {
  voiceCount: number;
  voiceMax:   number;
  videoCount: number;
  videoMax:   number;
  flags:      number;
}

export interface SuimyakuMediaCallbacks {
  onCallState:       (state: CallState, nick: string, channel: string | null) => void;
  onPeerState?:      (peer: SuimyakuPeerState) => void;
  onPeerLeft:        (nick: string) => void;
  onPeerSpeaking?:   (nick: string, speaking: boolean) => void;
  onLocalStream:     (stream: MediaStream | null) => void;
  onRoomStats?:      (channel: string, stats: SuimyakuRoomStats) => void;
  onError:           (msg: string) => void;
  onDecodeError?:    (peer: string, type: MediaKind, err: unknown) => void;
  onAudioLevel?:     (nick: string, level: number) => void;
  onPresence?:       (nick: string, available: boolean) => void;
  onNetworkQuality?: (tier: NetworkQualityTier, suggestedBps: number) => void;
  onReaction?:       (nick: string, emoji: string) => void;
  onRecordingAlert?: (nick: string, started: boolean) => void;
  onRoomNearFull?:   () => void;
  onRecordConsent?:  (nick: string) => void;
  onChannelInfo?:    (channel: string, info: SuimyakuChannelInfo) => void;
  onTsumugiState?:      (nick: string, epoch: number, fingerprint: string) => void;
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
