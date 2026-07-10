import type { IRCClient } from '../irc/client';
import {
  OpcodecWasm, KaguraVoxEncoder, KaguraVisEncoder,
  rgbaToYuv420,
  KAGURAVOX_FRAME_48K,
  type KaguraVoxQuality,
} from './OpcodecWasm';
import { TsumugiSession } from './TsumugiSession';
import { TsumugiGroup } from './TsumugiGroup';
import { TsumugiIdentity } from './TsumugiIdentity';
import { ChunkAssembler } from './ChunkAssembler';
import { TeardownGuard } from './teardownGuard';
import { PeerRegistry } from './PeerRegistry';
import { KaguraCodec, type KaguraCodecTag, decodeKaguraFrame, encodeKaguraFrame } from './kaguraFrame';
import { appendMediaMac, importMediaMacKey } from './mediaMac';
import { MediaStreamRouter, mediaStreamId } from './mediaStream';
import type { IRCMessage } from '../irc/types';
import type {
  CallState, VoiceCallState, MediaKind,
  SuimyakuPeerState, SuimyakuRoomStats, NetworkQualityTier,
  SuimyakuMediaCallbacks, SuimyakuChannelInfo,
} from './types';

// WS media-plane Kagura band ids: media bands are >= 64. band_id discriminates
// how a relayed datagram's payload is handled (the codec tag is informational).
const WS_BAND_AUDIO = 64;          // kaguravox audio, plaintext
const WS_BAND_VIDEO = 65;          // kaguravis video
const WS_BAND_TSUMUGI_AUDIO = 66;  // kaguravox audio, TSUMUGI group-encrypted ciphertext

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type { CallState, VoiceCallState, MediaKind, SuimyakuPeerState, SuimyakuRoomStats, NetworkQualityTier, SuimyakuMediaCallbacks, SuimyakuChannelInfo };

// The mounted engine is a cross-module globalThis-backed singleton. The
// accessors live in `@/lib/mediaEngineMount` so the eager store can read the
// mounted engine WITHOUT statically pulling this heavy module into the initial
// bundle. Re-exported here to preserve this module's public surface for the
// lazy-loaded media call sites (useSuimyakuMedia, VoiceBar) and their tests.
export {
  getMountedSuimyakuMediaEngine,
  setMountedSuimyakuMediaEngine,
} from '@/lib/mediaEngineMount';

// -------------------------------------------------------------------
// Internal constants
// -------------------------------------------------------------------

const SAMPLE_RATE    = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_QUALITY: KaguraVoxQuality = 2;
const VIDEO_QUALITY  = 70;
const VIDEO_FPS      = 60;
const VIDEO_WIDTH    = 1920;
const VIDEO_HEIGHT   = 1080;
const SCREEN_FPS     = 60;
const SCREEN_WIDTH   = 3840;
const SCREEN_HEIGHT  = 2160;
const SPEAKING_RMS   = 0.012;
const SPEAKING_POLL_MS = 120;

// Outbound MCHUNK split constants (chunk size / small-payload threshold / frame
// cap) used to live here, but the IRC media-frame send path (sendFrame) is now
// handled by the browser media datagram path rather than as IRC commands. The
// matching inbound bounds — 120-byte chunks, a 65535 chunk ceiling, and the
// reassembled-frame size cap — are enforced directly in ChunkAssembler
// (MAX_CHUNKS / MAX_CHUNK_BYTES / MAX_FRAME_BYTES), so the sender-side copies
// were dead and have been removed.
const WASM_URL   = '/opcodec_wasm.js';

type VideoCaptureProfile = {
  width: number;
  height: number;
  fps: number;
  quality: number;
  profile: 'camera' | 'screen';
  screenShare?: boolean;
};

type StreamQuality = 'auto' | '1080p60' | '4k60';

const CAMERA_PROFILE: VideoCaptureProfile = {
  width: VIDEO_WIDTH,
  height: VIDEO_HEIGHT,
  fps: VIDEO_FPS,
  quality: VIDEO_QUALITY,
  profile: 'camera',
};

const CAMERA_PROFILE_4K60: VideoCaptureProfile = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  fps: SCREEN_FPS,
  quality: 82,
  profile: 'camera',
};

const SCREEN_PROFILE_4K60: VideoCaptureProfile = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  fps: SCREEN_FPS,
  quality: 85,
  profile: 'screen',
  screenShare: true,
};

const SCREEN_PROFILE_1080P60: VideoCaptureProfile = {
  width: 1920,
  height: 1080,
  fps: 60,
  quality: 82,
  profile: 'screen',
  screenShare: true,
};

/* Adaptive bitrate thresholds */
const BW_TIER_GOOD  = 300_000;
const BW_TIER_FAIR  = 150_000;
const BW_TIER_POOR  =  60_000;
const BW_AUDIO_ONLY =  30_000;

// -------------------------------------------------------------------
// Minimal msgpack helpers
// -------------------------------------------------------------------

function msgpackArray3(a: string, b: string, c: number): Uint8Array {
  const enc = new TextEncoder();
  const aB = enc.encode(a), bB = enc.encode(b);
  const out = new Uint8Array(1 + 1 + aB.length + 1 + bB.length + 3);
  let i = 0;
  out[i++] = 0x93;
  out[i++] = 0xa0 | (aB.length & 0x1f); out.set(aB, i); i += aB.length;
  out[i++] = 0xa0 | (bB.length & 0x1f); out.set(bB, i); i += bB.length;
  out[i++] = 0xcd; out[i++] = (c >> 8) & 0xff; out[i] = c & 0xff;
  return out;
}

function msgpackArray1(a: string): Uint8Array {
  const enc = new TextEncoder();
  const aB = enc.encode(a);
  const out = new Uint8Array(1 + 1 + aB.length);
  let i = 0;
  out[i++] = 0x91; out[i++] = 0xa0 | (aB.length & 0x1f); out.set(aB, i);
  return out;
}

function videoProfileFor(kind: MediaKind, quality: StreamQuality = '4k60', broadcast = false): VideoCaptureProfile {
  if (kind === 'screen') {
    if (quality === '1080p60' || quality === 'auto') return SCREEN_PROFILE_1080P60;
    return SCREEN_PROFILE_4K60;
  }
  if (kind === 'video' && broadcast && quality === '4k60') return CAMERA_PROFILE_4K60;
  return CAMERA_PROFILE;
}

function parseVideoJoinPayload(payload: string): VideoCaptureProfile {
  const [wRaw, hRaw, qRaw, fpsRaw, screenRaw] = payload.trim().split(/\s+/);
  const screenShare = screenRaw === 'screen' || screenRaw === 'true' || screenRaw === '1';
  const fallback = screenShare ? SCREEN_PROFILE_4K60 : CAMERA_PROFILE;
  const width = Number.parseInt(wRaw ?? '', 10);
  const height = Number.parseInt(hRaw ?? '', 10);
  const quality = Number.parseInt(qRaw ?? '', 10);
  const fps = Number.parseInt(fpsRaw ?? '', 10);
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
    quality: Number.isFinite(quality) ? Math.max(0, Math.min(100, quality)) : fallback.quality,
    fps: Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.min(60, fps)) : fallback.fps,
    profile: screenShare ? 'screen' : 'camera',
    screenShare,
  };
}

// -------------------------------------------------------------------
// Main engine
// -------------------------------------------------------------------

export class SuimyakuMediaEngine {
  private client: IRCClient | null = null;
  private readonly cb: SuimyakuMediaCallbacks;
  private readonly defaultKind: MediaKind;

  // --- WS media plane (browser media over binary WebSocket frames) ----------
  /** Server-issued per-stream MAC key for the active call. Null until an
   *  `EVENT <nick> MEDIA MACKEY <#chan> <b64>` arrives — i.e. the server opted
   *  in (`[media].ws_media_relay`). While null, sendFrame stays a no-op. */
  private wsMediaKey: CryptoKey | null = null;
  private wsMyNick = '';
  private wsAudSeq = 0;
  private wsVidSeq = 0;
  private readonly streamRouter = new MediaStreamRouter();
  /** Client this engine's media handlers are currently registered on. */
  private boundMediaClient: IRCClient | null = null;
  // Stable references so they can be added to / removed from the client's
  // subscriber sets across setClient transitions.
  private readonly onMediaServerMessageBound = (msg: IRCMessage) => this.handleMediaServerMessage(msg);
  private readonly onMediaDatagramBound = (data: Uint8Array) => this.handleMediaDatagram(data);

  private wasm:      OpcodecWasm | null = null;
  private wasmReady  = false;

  private localStream: MediaStream | null = null;
  private localKind:   MediaKind | null   = null;
  private activeRoom:  string | null      = null;
  private callState:   CallState          = 'idle';
  private callWith     = '';

  private audEnc: KaguraVoxEncoder | null = null;
  private vidEnc: KaguraVisEncoder | null = null;
  private localVideoProfile: VideoCaptureProfile | null = null;

  private audioCtx:     AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | ScriptProcessorNode | null = null;
  private vidFrameTimer: ReturnType<typeof setInterval> | null = null;
  private vidCanvas:    HTMLCanvasElement | null = null;
  private vidCapture:   HTMLVideoElement | null  = null;

  /* Worker-path state (Chromium: MediaStreamTrackProcessor + OffscreenCanvas) */
  private vidWorker:    Worker | null = null;
  private workerReady   = false;

  private speakingCtx:   AudioContext | null = null;
  private speakingTimer: ReturnType<typeof setInterval> | null = null;

  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly RING_TIMEOUT_MS = 30_000;

  private readonly registry = new PeerRegistry({
    sampleRate:   SAMPLE_RATE,
    audioQuality: () => this.audioQuality,
    videoW:       VIDEO_WIDTH,
    videoH:       VIDEO_HEIGHT,
    speakingRms:  SPEAKING_RMS,
  });

  private readonly assembler = new ChunkAssembler();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  private localFid = 0;

  private presenceList      = new Set<string>();
  private negotiatedBitrate = new Map<string, number>();
  private audioLevelTimer: ReturnType<typeof setInterval> | null = null;
  private tsumugiSessions = new Map<string, TsumugiSession>();
  private tsumugiGroupKey: TsumugiGroup | null = null;
  private tsumugiGroupKeyPromise: Promise<TsumugiGroup> | null = null;
  // Fences async crypto write-backs so a continuation scheduled during call A
  // cannot resurrect/clobber E2EE key state after hangup or into a later call.
  private readonly callGuard = new TeardownGuard();
  private tsumugiIdentity: TsumugiIdentity | null = null;
  private tsumugiIdentityPromise: Promise<TsumugiIdentity> | null = null;
  private incomingKind: MediaKind;

  /* PTT */
  private pttMode   = false;
  private pttActive = false;

  /* Recording */
  private recorder:   MediaRecorder | null = null;
  private recChunks:  Blob[] = [];
  private recMimeType = 'video/webm;codecs=opus';
  private nearCapacityFired = false;

  /* Adaptive network */
  private suggestedBps     = 0;
  private networkTier: NetworkQualityTier = 0;
  private prevNetworkTier: NetworkQualityTier = 0;
  private videoSkipCount   = 0;
  private audioQuality: KaguraVoxQuality = AUDIO_QUALITY;

  private lastLossRate  = 0;
  private lastDecodeAt  = 0;

  constructor(callbacks: SuimyakuMediaCallbacks, options: { kind: MediaKind } = { kind: 'video' }) {
    this.cb          = callbacks;
    this.defaultKind = options.kind;
    this.incomingKind = options.kind;

    this.registry.onPeerStateChanged = s => this.cb.onPeerState?.(s);
    this.registry.onPeerLeft         = n => this.cb.onPeerLeft(n);
    this.registry.onPeerSpeaking     = (n, s) => this.cb.onPeerSpeaking?.(n, s);
  }

  setClient(client: IRCClient | null) {
    const prev = this.client;
    this.client = client;
    // Move the media-plane subscriptions to the new client (binary datagrams +
    // EVENT MEDIA MACKEY/JOIN/ROSTER), tolerating repeat calls with the same client.
    if (this.boundMediaClient && this.boundMediaClient !== client) {
      this.boundMediaClient.binaryHandlers.delete(this.onMediaDatagramBound);
      this.boundMediaClient.extraMessageHandlers.delete(this.onMediaServerMessageBound);
      this.boundMediaClient = null;
    }
    if (client && this.boundMediaClient !== client) {
      client.binaryHandlers.add(this.onMediaDatagramBound);
      client.extraMessageHandlers.add(this.onMediaServerMessageBound);
      this.boundMediaClient = client;
    }
    if (!client && this.callState !== 'idle') { this.setIdle(); return; }
    if (client && !prev && this.callState === 'in_call' && this.activeRoom) {
      const room = this.activeRoom;
      setTimeout(() => {
        if (this.client && this.activeRoom === room) {
          this.mediaframeCmd(room, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
          if (this.localKind === 'video' || this.localKind === 'screen') {
            const profile = this.localVideoProfile ?? videoProfileFor(this.localKind);
            this.mediaframeCmd(
              room,
              'VIDEO_JOIN',
              `${profile.width} ${profile.height} ${profile.quality} ${profile.fps}${profile.screenShare ? ' screen' : ''}`,
            );
          }
          this.mediaframeCmd(room, 'ROSTER');
        }
      }, 500);
    }
  }

  getNetworkStats(): {
    suggestedBps: number; tier: NetworkQualityTier;
    jitterMs: number; lossRate: number;
    framesEncoded: number; framesDecoded: number;
    dtxSuppressedCount: number; noiseDb: number;
  } {
    return {
      suggestedBps:       this.suggestedBps,
      tier:               this.networkTier,
      jitterMs:           this.registry.lastJitterMs,
      lossRate:           this.lastLossRate,
      framesEncoded:      this.audEnc?.framesEncoded ?? 0,
      framesDecoded:      this.registry.totalFramesDecoded(),
      dtxSuppressedCount: this.audEnc?.dtxSuppressedCount ?? 0,
      noiseDb:            this.audEnc?.getNoiseDb() ?? -100,
    };
  }

  getLocalStream()  { return this.localStream; }
  getLocalKind()    { return this.localKind; }
  getCallState()    { return { callState: this.callState, callWith: this.callWith, callChannel: this.activeRoom }; }

  getPeers(): Map<string, SuimyakuPeerState> {
    const out = new Map<string, SuimyakuPeerState>();
    for (const pm of this.registry.all()) out.set(pm.state.nick, pm.state);
    return out;
  }

  getPresenceList(): string[] { return Array.from(this.presenceList); }

  setOutput(deviceId: string | null, volumePercent: number): void {
    this.registry.setOutput(deviceId, volumePercent / 100);
  }

  setDeafened(deafened: boolean): void {
    this.registry.setDeafened(deafened);
    if (this.activeRoom) this.mediaframeCmd(this.activeRoom, deafened ? 'DEAFEN' : 'UNDEAFEN');
  }

  async getLocalTsumugiFingerprint(): Promise<string> {
    const id = await this.ensureTsumugiIdentity();
    return id.getFingerprint();
  }

  private ensureTsumugiIdentity(): Promise<TsumugiIdentity> {
    if (this.tsumugiIdentity) return Promise.resolve(this.tsumugiIdentity);
    // Memoize the in-flight load so concurrent callers share one identity,
    // and reset on failure so a later call can retry instead of spinning
    // forever (TsumugiIdentity.load() can reject in insecure contexts).
    if (!this.tsumugiIdentityPromise) {
      this.tsumugiIdentityPromise = TsumugiIdentity.load()
        .then(id => { this.tsumugiIdentity = id; return id; })
        .catch(err => { this.tsumugiIdentityPromise = null; throw err; });
    }
    return this.tsumugiIdentityPromise;
  }

  getScreenStream(nick: string): MediaStream | null {
    return this.registry.getScreenStream(nick);
  }

  resetPeerStream(nick: string) { this.registry.reset(nick); }

  // ----------------------------------------------------------------
  // WASM bootstrap
  // ----------------------------------------------------------------

  private async ensureWasm(): Promise<OpcodecWasm> {
    if (this.wasm) return this.wasm;
    const w = await OpcodecWasm.load(WASM_URL);
    this.wasm = w;
    this.wasmReady = true;
    this.registry.setWasm(w);
    return w;
  }

  // ----------------------------------------------------------------
  // Media capture
  // ----------------------------------------------------------------

  private mediaAllowed(kind: MediaKind) {
    if (kind === 'voice') return this.cb.enableVoiceCalls?.() ?? true;
    return this.cb.enableVideoCalls?.() ?? true;
  }

  private async capture(kind: MediaKind, quality: StreamQuality = '4k60', broadcast = false): Promise<MediaStream> {
    if (this.localStream && this.localKind === kind) return this.localStream;
    if (this.localStream) this.releaseMedia();
    if (!this.mediaAllowed(kind)) throw new Error(`${kind} media is disabled`);
    const devs = navigator.mediaDevices;
    if (!devs) throw new Error('Media devices unavailable');
    const profile = videoProfileFor(kind, quality, broadcast);
    const settings = this.cb.getMediaSettings?.();
    const audio: boolean | MediaTrackConstraints = kind === 'screen'
      ? true
      : {
          deviceId: settings?.inputDeviceId ? { exact: settings.inputDeviceId } : undefined,
          noiseSuppression: settings?.noiseSuppression ?? true,
          echoCancellation: settings?.echoCancellation ?? true,
        };
    const stream = kind === 'screen'
      ? await devs.getDisplayMedia({
          video: {
            width: { ideal: profile.width, max: profile.width },
            height: { ideal: profile.height, max: profile.height },
            frameRate: { ideal: profile.fps, max: profile.fps },
          },
          audio: true,
        })
      : await devs.getUserMedia({
          audio,
          video: kind === 'video'
            ? {
                deviceId: settings?.cameraDeviceId ? { exact: settings.cameraDeviceId } : undefined,
                width: { ideal: profile.width, max: profile.width },
                height: { ideal: profile.height, max: profile.height },
                frameRate: { ideal: profile.fps, max: profile.fps },
              }
            : false,
        });
    this.localStream = stream;
    this.localKind   = kind;
    this.cb.onLocalStream(stream);
    stream.getTracks().forEach(t => {
      t.addEventListener('ended', () => {
        if (this.localStream !== stream) return;
        if (kind === 'screen') { this.releaseMedia(); return; }
        if (stream.getTracks().every(x => x.readyState === 'ended')) this.releaseMedia();
      });
    });
    return stream;
  }

  private releaseMedia() {
    if (this.callState === 'in_call' && this.activeRoom) {
      const ch = this.activeRoom;
      if (this.localKind === 'voice' || this.localKind === 'video') this.mediaframeCmd(ch, 'VOICE_LEAVE');
      if (this.localKind === 'video') this.mediaframeCmd(ch, 'VIDEO_LEAVE');
      if (this.localKind === 'screen') this.mediaframeCmd(ch, 'VIDEO_LEAVE');
    }
    this.stopAudioCapture();
    this.stopVideoCapture();
    this.stopSpeakingMeter();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.localKind   = null;
    this.localVideoProfile = null;
    this.cb.onLocalStream(null);
  }

  // ----------------------------------------------------------------
  // Audio capture + encode loop
  // ----------------------------------------------------------------

  private async startAudioCapture(stream: MediaStream) {
    this.stopAudioCapture();
    let wasm: OpcodecWasm;
    try {
      wasm = await this.ensureWasm();
      const mq = this.cb.getMediaQuality?.();
      const aq: 0 | 1 | 2 = mq?.audioQuality ?? (AUDIO_QUALITY as 0 | 1 | 2);
      const ns2 = mq?.noiseSuppress ?? true;
      this.audEnc = wasm.audioEncoder(SAMPLE_RATE, aq, ns2);
    } catch {
      this.cb.onError('Codec unavailable — audio capture disabled');
      this.setIdle();
      return;
    }
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.audioCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const FRAME = KAGURAVOX_FRAME_48K * AUDIO_CHANNELS;
    let useWorklet = false;
    try {
      await ctx.audioWorklet.addModule(
        'data:application/javascript,' + encodeURIComponent(AUDIO_WORKLET_CODE),
      );
      useWorklet = true;
    } catch { /* fallback */ }

    if (useWorklet) {
      const node = new AudioWorkletNode(ctx, 'kaguravox-capture', {
        processorOptions: { frameSize: FRAME },
      });
      node.port.onmessage = (e: MessageEvent) => this.onAudioFrame(e.data as Int16Array);
      src.connect(node);
      this.audioWorklet = node;
    } else {
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      // Persistent mono accumulator. Each callback delivers up to 4096
      // samples; we must drain ALL complete 960-sample frames and keep the
      // remainder, not emit one frame and discard the rest (which dropped
      // ~76% of audio at a 4096 buffer size).
      let acc = new Float32Array(0);
      proc.onaudioprocess = (e) => {
        const ch0 = e.inputBuffer.getChannelData(0);
        const merged = new Float32Array(acc.length + ch0.length);
        merged.set(acc, 0); merged.set(ch0, acc.length);
        acc = merged;
        let off = 0;
        while (acc.length - off >= KAGURAVOX_FRAME_48K) {
          const i16 = new Int16Array(FRAME);
          for (let s = 0; s < KAGURAVOX_FRAME_48K; s++) {
            const v = Math.max(-1, Math.min(1, acc[off + s]!));
            i16[s * 2]     = v * 32767;
            i16[s * 2 + 1] = v * 32767;
          }
          this.onAudioFrame(i16);
          off += KAGURAVOX_FRAME_48K;
        }
        acc = acc.slice(off);
      };
      src.connect(proc); proc.connect(ctx.destination);
      this.audioWorklet = proc;
    }
  }

  private onAudioFrame(i16: Int16Array) {
    if (!this.audEnc || !this.activeRoom) return;
    const encoded = this.audEnc.encode(i16);
    if (!encoded || !encoded.length) return;
    /* Use TSUMUGI group encryption if a group key is established (multi-party room) */
    if (this.tsumugiGroupKey) {
      this.tsumugiGroupKey.encrypt(encoded).then(ct => {
        if (this.activeRoom) this.sendFrame(this.activeRoom, 'TSUMUGI_DATA', ct);
      }).catch(() => { if (this.activeRoom) this.sendFrame(this.activeRoom, 'AUDIO', encoded); });
      return;
    }
    /* Use per-peer TSUMUGI for 1:1 (no active room participants besides 1 peer) */
    const [singleNick, singleVs] = this.tsumugiSessions.size === 1
      ? [...this.tsumugiSessions.entries()][0]!
      : [null, null];
    if (singleVs?.established && !this.activeRoom.startsWith('#')) {
      singleVs.encrypt(encoded).then((ct: Uint8Array) => {
        void ct;
      }).catch(() => { if (this.activeRoom) this.sendFrame(this.activeRoom, 'AUDIO', encoded); });
      void singleNick; // suppress unused warning
      return;
    }
    this.sendFrame(this.activeRoom, 'AUDIO', encoded);
  }

  private stopAudioCapture() {
    if (this.audioWorklet) (this.audioWorklet as AudioWorkletNode | ScriptProcessorNode).disconnect();
    this.audioWorklet = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.audEnc?.destroy();
    this.audEnc = null;
  }

  // ----------------------------------------------------------------
  // Video capture + encode loop
  //
  // Two paths:
  //
  //  Worker path (Chromium — preferred)
  //    Requires MediaStreamTrackProcessor + OffscreenCanvas.  The video track
  //    is handed off to videoEncodeWorker.ts which owns the full
  //    capture → YUV → WASM-encode pipeline off the main thread.  Encoded
  //    Uint8Array frames are posted back here and forwarded to sendFrame().
  //
  //  Fallback path (Safari / Firefox)
  //    The original setInterval / drawImage / getImageData / rgbaToYuv420 loop
  //    runs on the main thread exactly as before, with adaptive downscaling
  //    added for tiers 1-3.
  // ----------------------------------------------------------------

  /** True when MediaStreamTrackProcessor and OffscreenCanvas are both available. */
  private static supportsWorkerCapture(): boolean {
    return (
      typeof (globalThis as Record<string, unknown>).MediaStreamTrackProcessor === 'function' &&
      typeof OffscreenCanvas !== 'undefined'
    );
  }

  private async startVideoCapture(
    stream: MediaStream,
    profile: VideoCaptureProfile = CAMERA_PROFILE,
  ) {
    this.stopVideoCapture();
    this.localVideoProfile = profile;

    if (SuimyakuMediaEngine.supportsWorkerCapture()) {
      await this.startVideoCaptureWorker(stream, profile);
    } else {
      await this.startVideoCaptureFallback(stream, profile);
    }
  }

  // ── Worker path ──────────────────────────────────────────────────

  private async startVideoCaptureWorker(
    stream: MediaStream,
    profile: VideoCaptureProfile,
  ): Promise<void> {
    /* Pre-load WASM on the main thread too (for VIDEO_KEYREQ fallback and
     * any future main-thread codec use). Fire-and-forget. */
    this.ensureWasm().catch(() => {});

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      /* No video track — fall back silently. */
      await this.startVideoCaptureFallback(stream, profile);
      return;
    }

    /* Spawn the encode worker. Vite resolves the URL at bundle time and code-
     * splits the worker module. It MUST be a module worker (`type: 'module'`):
     * videoEncodeWorker.ts uses ES `import`, which a classic worker rejects with
     * "Cannot use import statement outside a module" (breaks video encoding). */
    const worker = new Worker(new URL('./videoEncodeWorker.ts', import.meta.url), { type: 'module' });
    this.vidWorker   = worker;
    this.workerReady = false;

    /* Handle frames and diagnostics posted back from the worker. */
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as {
        type: 'encoded' | 'ready' | 'error';
        data?: Uint8Array;
        ftype?: 'KEYFRAME' | 'FRAME';
        msg?: string;
      };
      if (msg.type === 'ready') {
        this.workerReady = true;
        return;
      }
      if (msg.type === 'error') {
        console.warn('[suimyaku/worker]', msg.msg);
        return;
      }
      if (msg.type === 'encoded' && msg.data && msg.ftype && this.activeRoom) {
        /* Keyframe gate: when tier >= 2 only forward keyframes. */
        if (this.networkTier >= 2 && msg.ftype !== 'KEYFRAME') return;
        this.sendFrame(this.activeRoom, msg.ftype, msg.data);
      }
    };

    worker.onerror = (ev) => {
      console.error('[suimyaku/worker] uncaught:', ev.message);
    };

    /* Clone the video track so the worker can consume it independently via
     * MediaStreamTrackProcessor without interfering with the original stream. */
    const clonedTrack = videoTrack.clone();

    const initBase = {
      type:       'init' as const,
      wasmUrl:    WASM_URL,
      encWidth:   profile.width,
      encHeight:  profile.height,
      encQuality: profile.quality,
      encProfile: profile.profile,
      encFps:     profile.fps,
    };

    /* A MediaStreamTrack is NOT transferable in every Chromium. Prefer
     * transferring the raw track when the platform supports it; otherwise
     * create the MediaStreamTrackProcessor here and transfer its `.readable`
     * (a ReadableStream IS transferable). If neither works, fall back to the
     * main-thread capture path so the join never crashes. */
    if (SuimyakuMediaEngine.supportsTransferableMediaStreamTrack()) {
      try {
        worker.postMessage(
          { ...initBase, track: clonedTrack },
          [clonedTrack] as unknown as Transferable[],
        );
        return;
      } catch {
        /* Track transfer rejected at runtime — fall through to readable path. */
      }
    }

    const ProcessorCtor = (globalThis as Record<string, unknown>).MediaStreamTrackProcessor as
      | (new (opts: { track: MediaStreamTrack }) => { readable: ReadableStream })
      | undefined;
    if (ProcessorCtor) {
      try {
        const processor = new ProcessorCtor({ track: clonedTrack });
        const readable = processor.readable;
        worker.postMessage(
          { ...initBase, readable },
          [readable] as unknown as Transferable[],
        );
        return;
      } catch {
        /* readable transfer failed too — fall through to main-thread path. */
      }
    }

    /* Last resort: tear down the worker and use the main-thread encode loop. */
    clonedTrack.stop();
    worker.postMessage({ type: 'stop' });
    worker.terminate();
    this.vidWorker   = null;
    this.workerReady = false;
    await this.startVideoCaptureFallback(stream, profile);
  }

  /** True when a MediaStreamTrack can be structured-cloned/transferred to a worker. */
  private static supportsTransferableMediaStreamTrack(): boolean {
    const Ctor = (globalThis as Record<string, unknown>).MediaStreamTrack as
      | { prototype?: { transfer?: unknown } }
      | undefined;
    // Chromium exposes `MediaStreamTrack.prototype.transfer` (the
    // transferable-streams / serializable-track API) only when tracks may be
    // moved across realms. Absence means postMessage transfer will throw
    // DataCloneError, so we must use the readable-stream path instead.
    return typeof Ctor?.prototype?.transfer === 'function';
  }

  // ── Fallback path (main thread — Safari / Firefox) ────────────────

  private async startVideoCaptureFallback(
    stream: MediaStream,
    profile: VideoCaptureProfile,
  ): Promise<void> {
    const wasm = await this.ensureWasm();
    this.vidEnc = wasm.videoEncoder(
      profile.width,
      profile.height,
      profile.quality,
      profile.profile,
      profile.fps,
    );
    const video = document.createElement('video');
    video.srcObject = stream; video.muted = true;
    await video.play();
    this.vidCapture = video;
    const canvas = document.createElement('canvas');
    canvas.width = profile.width; canvas.height = profile.height;
    this.vidCanvas = canvas;
    this.vidFrameTimer = setInterval(() => this.onVideoTick(), 1000 / profile.fps);
  }

  /**
   * Main-thread fallback tick: drawImage → getImageData → rgbaToYuv420 → encode.
   * Only used when MediaStreamTrackProcessor / OffscreenCanvas are unavailable
   * (Safari, Firefox).
   *
   * Adaptive degradation in this path:
   *   Tier 0 — every frame,  full profile resolution
   *   Tier 1 — every 2nd frame (frame-skip), downscale canvas to 1080p cap
   *   Tier 2 — every 4th frame (keyframe-gate), downscale canvas to 720p cap
   *   Tier 3 — every 4th frame, downscale canvas to 480p cap
   */
  private onVideoTick() {
    if (!this.vidEnc || !this.vidCapture || !this.vidCanvas || !this.activeRoom) return;
    this.videoSkipCount++;
    const skipMod = this.networkTier === 0 ? 1 : this.networkTier === 1 ? 2 : 4;
    if (this.videoSkipCount % skipMod !== 0) return;
    const keyframeOnly = this.networkTier >= 2;

    /* Adaptive downscale: resize the draw canvas to the tier resolution cap.
     * This reduces getImageData payload and speeds up rgbaToYuv420 proportionally. */
    const profile = this.localVideoProfile!;
    const capW =
      this.networkTier === 0 ? profile.width
      : this.networkTier === 1 ? Math.min(profile.width, 1920)
      : this.networkTier === 2 ? Math.min(profile.width, 1280)
      : Math.min(profile.width, 854);
    const aspectRatio = profile.height / profile.width;
    const rawH = Math.round(capW * aspectRatio);
    /* Force even dimensions (YUV420 planes require even width/height). */
    const drawW = capW % 2 === 0 ? capW : capW - 1;
    const drawH = rawH % 2 === 0 ? rawH : rawH - 1;

    if (this.vidCanvas.width !== drawW || this.vidCanvas.height !== drawH) {
      /* Dimensions changed — rebuild canvas and encoder at new size. */
      if (this.wasm) {
        this.vidEnc.destroy();
        this.vidEnc = this.wasm.videoEncoder(
          drawW, drawH, profile.quality, profile.profile, profile.fps,
        );
      }
      this.vidCanvas.width  = drawW;
      this.vidCanvas.height = drawH;
    }

    const ctx = this.vidCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.vidCapture, 0, 0, drawW, drawH);
    const { y, u, v } = rgbaToYuv420(
      ctx.getImageData(0, 0, drawW, drawH).data,
      drawW, drawH,
    );
    const encoded = this.vidEnc.encode(y, u, v, keyframeOnly);
    if (!encoded.length) return;
    const ftype = encoded[0] === 0xFF ? 'KEYFRAME' : 'FRAME';
    if (keyframeOnly && ftype !== 'KEYFRAME') return;
    this.sendFrame(this.activeRoom, ftype, encoded);
  }

  private stopVideoCapture() {
    /* Worker path teardown. */
    if (this.vidWorker) {
      this.vidWorker.postMessage({ type: 'stop' });
      this.vidWorker.terminate();
      this.vidWorker   = null;
      this.workerReady = false;
    }
    /* Fallback path teardown. */
    if (this.vidFrameTimer) clearInterval(this.vidFrameTimer);
    this.vidFrameTimer = null;
    this.vidCapture?.pause(); this.vidCapture = null; this.vidCanvas = null;
    this.vidEnc?.destroy(); this.vidEnc = null;
    this.localVideoProfile = null;
  }

  // ----------------------------------------------------------------
  // Speaking meter (local VAD)
  // ----------------------------------------------------------------

  private startSpeakingMeter(stream: MediaStream) {
    this.stopSpeakingMeter();
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let wasSpeaking = false;
      this.speakingCtx = ctx;
      this.speakingTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (const s of data) sum += s * s;
        const speaking = Math.sqrt(sum / data.length) > SPEAKING_RMS;
        if (speaking === wasSpeaking) return;
        wasSpeaking = speaking;
        this.cb.onPeerSpeaking?.('local', speaking);
      }, SPEAKING_POLL_MS);
    } catch { /* no-op */ }
  }

  private stopSpeakingMeter() {
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    this.speakingTimer = null;
    this.speakingCtx?.close().catch(() => {});
    this.speakingCtx = null;
  }

  // ----------------------------------------------------------------
  // Frame send (Suimyaku media transport)
  // ----------------------------------------------------------------

  private static toB64(data: Uint8Array): string {
    let s = ''; const len = data.length;
    for (let i = 0; i < len; i++) s += String.fromCharCode(data[i]!);
    return btoa(s);
  }

  /**
   * Transmit one encoded media frame over the WS media plane: wrap it in a
   * Kagura datagram, append the per-stream MAC, and send a binary WebSocket
   * frame. No-op until the server has issued a MAC key (ws_media_relay on), so
   * on servers without the WS media plane this stays the historical no-op.
   */
  private sendFrame(channel: string, ftype: string, data: Uint8Array) {
    const client = this.client;
    if (!client || !this.wsMediaKey || channel !== this.activeRoom || !this.wsMyNick) return;
    if (!data.length) return;

    let bandId: number;
    let codec: KaguraCodecTag;
    let keyframe = false;
    let kind: 'audio' | 'video';
    switch (ftype) {
      case 'AUDIO':        bandId = WS_BAND_AUDIO;         codec = KaguraCodec.kaguravoxAudio; kind = 'audio'; break;
      case 'TSUMUGI_DATA': bandId = WS_BAND_TSUMUGI_AUDIO; codec = KaguraCodec.kaguravoxAudio; kind = 'audio'; break;
      case 'KEYFRAME':     bandId = WS_BAND_VIDEO;         codec = KaguraCodec.kaguravisVideo; keyframe = true; kind = 'video'; break;
      case 'FRAME':        bandId = WS_BAND_VIDEO;         codec = KaguraCodec.kaguravisVideo; kind = 'video'; break;
      default: return;
    }

    // Sequence is assigned synchronously (before the async MAC) so per-stream
    // ordering is stable even if two sends race.
    const sequence = (kind === 'audio' ? this.wsAudSeq++ : this.wsVidSeq++) >>> 0;
    const frame = encodeKaguraFrame({
      bandId,
      streamId: mediaStreamId(channel, this.wsMyNick, kind),
      sequence,
      timestamp: Date.now(),
      keyframe,
      codec,
      payload: data,
    });

    const key = this.wsMediaKey;
    appendMediaMac(key, frame)
      .then((datagram) => { if (this.client === client) client.sendBinary(datagram); })
      .catch(() => { /* a MAC failure drops one media frame; loss-tolerant */ });
  }

  /** Observe MEDIA control events to drive the WS media plane. EVENT MEDIA orders
   * fields as `<verb> <#chan> [detail...]`, covering caller-targeted replies
   * (MACKEY, ROSTER) and live presence feed (JOIN, LEAVE, speaking state). */
  private handleMediaServerMessage(msg: IRCMessage) {
    let channel: string | undefined;
    let verb: string | undefined;
    let arg: string | undefined;
    if (msg.command === 'NOTE' && msg.params[0] === 'MEDIA') {
      channel = msg.params[1]; verb = msg.params[2]; arg = msg.params[3];
    } else if (msg.command === 'EVENT' && (msg.params[1] ?? '').toUpperCase() === 'MEDIA') {
      verb = msg.params[2]; channel = msg.params[3]; arg = msg.params[4];
    } else {
      return;
    }
    if (!channel || !verb || channel !== this.activeRoom) return;

    if (verb === 'MACKEY') {
      const b64 = arg;
      if (!b64) return;
      this.wsMyNick = this.client?.currentNick ?? this.wsMyNick;
      this.wsAudSeq = 0;
      this.wsVidSeq = 0;
      this.streamRouter.setRoster(channel, this.wsMyNick ? [this.wsMyNick] : []);
      try {
        importMediaMacKey(base64ToBytes(b64))
          .then((k) => { this.wsMediaKey = k; })
          .catch(() => {});
      } catch { /* malformed key — stay a no-op */ }
    } else if (verb === 'JOIN' || verb === 'ROSTER') {
      if (arg) this.streamRouter.addParticipant(arg);
    }
  }

  /** Decode one inbound media datagram and route it to the sending peer. */
  private handleMediaDatagram(data: Uint8Array) {
    const room = this.activeRoom;
    if (!room) return;
    const frame = decodeKaguraFrame(data);
    if (!frame) return;
    const src = this.streamRouter.resolve(frame.streamId);
    if (!src) return; // unknown stream (not a current roster participant)

    if (frame.bandId === WS_BAND_TSUMUGI_AUDIO) {
      const groupKey = this.tsumugiGroupKey;
      if (!groupKey) return; // can't decrypt without the group key
      const payload = frame.payload;
      groupKey.decrypt(payload)
        .then((pcm) => {
          const pm = this.registry.getOrCreate(src.nick, room, 'voice');
          void this.registry.decodeAudio(pm, pcm);
        })
        .catch(() => {});
      return;
    }
    if (src.kind === 'audio') {
      const pm = this.registry.getOrCreate(src.nick, room, 'voice');
      void this.registry.decodeAudio(pm, frame.payload);
    } else {
      const pm = this.registry.getOrCreate(src.nick, room, 'video');
      void this.registry.decodeVideo(pm, frame.payload, frame.keyframe ? 'KEYFRAME' : 'FRAME');
    }
  }

  private mediaframeCmd(channel: string, subtype: string, payload = '') {
    if (!this.client) return;
    switch (subtype) {
      case 'VOICE_JOIN':
        this.client.sendRaw('MEDIA', 'JOIN', channel, 'voice');
        this.client.sendRaw('MEDIA', 'OFFER', channel, 'kaguravox,kaguravis', 'transport=webrtc');
        break;
      case 'VIDEO_JOIN':
        this.client.sendRaw('MEDIA', 'JOIN', channel, payload.includes('screen') ? 'screen' : 'video');
        this.client.sendRaw('MEDIA', 'OFFER', channel, 'kaguravox,kaguravis', 'transport=webrtc');
        break;
      case 'VOICE_LEAVE':
      case 'VIDEO_LEAVE':
        this.client.sendRaw('MEDIA', 'LEAVE', channel);
        break;
      case 'MUTE':
      case 'UNMUTE':
        this.client.sendRaw('MEDIA', subtype, channel, 'voice');
        break;
      case 'ROSTER':
        this.client.sendRaw('MEDIA', 'ROSTER', channel);
        break;
      case 'REACTION':
        if (payload) this.client.sendRaw('MEDIA', 'REACT', channel, payload);
        break;
      default:
        break;
    }
  }

  // ----------------------------------------------------------------
  // Public join / leave
  // ----------------------------------------------------------------

  async joinVoice(channel: string) {
    try {
      const stream = await this.capture('voice');
      await this.ensureWasm();
      this.setActiveRoom(channel);
      this.mediaframeCmd(channel, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
      this.mediaframeCmd(channel, 'ROSTER');
      this.sendTsumugiHandshake(channel).catch(() => {});
      await this.startAudioCapture(stream);
      this.startSpeakingMeter(stream);
      this.startGc();
    } catch (err) {
      this.cb.onError(`Voice join failed: ${err}`);
    }
  }

  async joinVideo(channel: string) {
    try {
      const stream = await this.capture('video');
      const profile = videoProfileFor('video');
      await this.ensureWasm();
      this.setActiveRoom(channel);
      this.mediaframeCmd(channel, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
      this.mediaframeCmd(channel, 'VIDEO_JOIN',
        `${profile.width} ${profile.height} ${profile.quality} ${profile.fps}`);
      this.mediaframeCmd(channel, 'ROSTER');
      this.sendTsumugiHandshake(channel).catch(() => {});
      await this.startAudioCapture(stream);
      await this.startVideoCapture(stream, profile);
      this.startSpeakingMeter(stream);
      this.startGc();
    } catch (err) {
      this.cb.onError(`Video join failed: ${err}`);
    }
  }

  leaveRoom(channel: string) {
    const ch = channel || this.activeRoom || '';
    if (this.localKind === 'voice' || this.localKind === 'video') this.mediaframeCmd(ch, 'VOICE_LEAVE');
    if (this.localKind === 'video') this.mediaframeCmd(ch, 'VIDEO_LEAVE');
    this.setIdle();
  }

  setMuted(muted: boolean) {
    if (!this.activeRoom) return;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    this.mediaframeCmd(this.activeRoom, muted ? 'MUTE' : 'UNMUTE');
  }

  async startCamera(channel?: string) {
    const target = channel ?? this.activeRoom;
    if (!target) { this.cb.onError('No active room for camera'); return; }
    await this.joinVideo(target);
  }

  stopCamera() {
    if (!this.activeRoom || this.localKind !== 'video' || !this.localStream) return;
    this.stopVideoCapture();
    this.localStream.getVideoTracks().forEach(t => t.stop());
    this.mediaframeCmd(this.activeRoom, 'VIDEO_LEAVE');
    this.localKind = 'voice';
    this.cb.onLocalStream(this.localStream);
  }

  requestKeyframe(channel: string) { this.mediaframeCmd(channel, 'VIDEO_KEYREQ'); }

  // ----------------------------------------------------------------
  // Wave-2 public API
  // ----------------------------------------------------------------

  setPushToTalk(enabled: boolean) {
    this.pttMode = enabled;
    if (!enabled) { this.pttActive = false; this.applyPttMute(false); }
    else { this.applyPttMute(true); }
  }

  pttPress()   { if (!this.pttMode) return; this.pttActive = true;  this.applyPttMute(false); }
  pttRelease() { if (!this.pttMode) return; this.pttActive = false; this.applyPttMute(true); }

  private applyPttMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }

  sendReaction(emoji: string) {
    if (!this.activeRoom) return;
    this.mediaframeCmd(this.activeRoom, 'REACTION', emoji);
  }

  kickParticipant(targetNick: string, reason = '') {
    if (!this.activeRoom) return;
    this.mediaframeCmd(this.activeRoom, 'VOICE_KICK',
      JSON.stringify({ target: targetNick, reason }));
  }

  startRecording() {
    if (this.recorder || !this.localStream) return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=opus') ? 'video/webm;codecs=opus' : 'audio/webm';
    this.recMimeType = mimeType; this.recChunks = [];
    try {
      this.recorder = new MediaRecorder(this.localStream, { mimeType });
      this.recorder.ondataavailable = e => { if (e.data.size > 0) this.recChunks.push(e.data); };
      this.recorder.start(1000);
    } catch { this.recorder = null; return; }
    if (this.activeRoom) this.mediaframeCmd(this.activeRoom, 'RECORD_START');
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this.recorder) return null;
    return new Promise(resolve => {
      const rec = this.recorder!;
      rec.onstop = () => {
        resolve(new Blob(this.recChunks, { type: this.recMimeType }));
        this.recChunks = []; this.recorder = null;
      };
      rec.stop();
      if (this.activeRoom) this.mediaframeCmd(this.activeRoom, 'RECORD_STOP');
    });
  }

  async startScreenShare(channel?: string) {
    const target = channel ?? this.activeRoom;
    if (!target) { this.cb.onError('No active room for screen share'); return; }
    try {
      const profile = videoProfileFor('screen');
      await this.capture('screen');
      this.setActiveRoom(target);
      this.mediaframeCmd(target, 'VIDEO_JOIN',
        `${profile.width} ${profile.height} ${profile.quality} ${profile.fps} screen`);
      this.mediaframeCmd(target, 'ROSTER');
      this.sendTsumugiHandshake(target).catch(() => {});
      if (this.localStream) await this.startVideoCapture(this.localStream, profile);
    } catch (err) {
      this.cb.onError(`Screen share failed: ${err}`);
    }
  }

  async startBroadcast(channel: string, kind: 'camera' | 'screen', quality: StreamQuality = '4k60') {
    try {
      const mediaKind: MediaKind = kind === 'screen' ? 'screen' : 'video';
      const stream = await this.capture(mediaKind, quality, true);
      const profile = videoProfileFor(mediaKind, quality, true);
      await this.ensureWasm();
      this.setActiveRoom(channel);
      if (stream.getAudioTracks().length > 0) {
        this.mediaframeCmd(channel, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
        await this.startAudioCapture(stream);
        this.startSpeakingMeter(stream);
      }
      this.mediaframeCmd(channel, 'VIDEO_JOIN',
        `${profile.width} ${profile.height} ${profile.quality} ${profile.fps}${profile.screenShare ? ' screen' : ''}`);
      this.mediaframeCmd(channel, 'ROSTER');
      this.sendTsumugiHandshake(channel).catch(() => {});
      await this.startVideoCapture(stream, profile);
      this.startGc();
    } catch (err) {
      this.cb.onError(`Stream start failed: ${err}`);
    }
  }

  stopBroadcast(channel?: string) {
    const target = channel ?? this.activeRoom ?? '';
    if (target) {
      this.mediaframeCmd(target, 'VIDEO_LEAVE');
      this.mediaframeCmd(target, 'VOICE_LEAVE');
    }
    this.setIdle();
  }

  // ----------------------------------------------------------------
  // 1:1 signalling (legacy compat)
  // ----------------------------------------------------------------

  async startCall(nick: string, kind: MediaKind = this.defaultKind) {
    if (this.callState !== 'idle') { this.cb.onError('Already in a session'); return; }
    try {
      const stream = await this.capture(kind);
      await this.ensureWasm();
      this.setCallState('ringing_out', nick, null);
      this.startRingTimer(nick);
      void nick; void kind;
      this.sendTsumugiHandshake(nick).catch(() => {});
      if (kind === 'voice' || kind === 'video') { await this.startAudioCapture(stream); this.startSpeakingMeter(stream); }
      if (kind === 'video') await this.startVideoCapture(stream);
    } catch (err) { this.cb.onError(`Call start failed: ${err}`); }
  }

  hangup(nick: string)   { void nick; this.setIdle(); }
  rejectCall(nick: string) { void nick; this.setIdle(); }

  noteIncomingCall(nick: string, kind: MediaKind = this.defaultKind) {
    this.incomingKind = kind;
    this.setCallState('ringing_in', nick, null);
    this.startRingTimer(nick);
  }

  /** Local-preview stereo pan for a remote peer (SpatialPad UI). */
  setPeerPan(nick: string, pan: number): void {
    this.registry.setPanForNick(nick, pan);
  }

  async acceptIncomingCall() {
    if (!this.callWith) return;
    try {
      const kind = this.incomingKind;
      const stream = await this.capture(kind);
      await this.ensureWasm();
      this.clearRingTimer();
      this.activeRoom = this.callWith;
      this.setCallState('in_call', this.callWith, null);
      this.mediaframeCmd(this.callWith, 'ACCEPT');
      this.mediaframeCmd(this.callWith, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
      if (kind === 'video') {
        const profile = videoProfileFor('video');
        this.mediaframeCmd(this.callWith, 'VIDEO_JOIN', `${profile.width} ${profile.height} ${profile.quality} ${profile.fps}`);
      }
      this.sendTsumugiHandshake(this.callWith).catch(() => {});
      if (kind === 'voice' || kind === 'video') {
        await this.startAudioCapture(stream); this.startSpeakingMeter(stream);
      }
      if (kind === 'video') await this.startVideoCapture(stream);
    } catch (err) { this.cb.onError(`Accept failed: ${err}`); }
  }

  // ----------------------------------------------------------------
  // Inbound message dispatcher
  // ----------------------------------------------------------------

  handleMediaMessage(fromNick: string, channel: string, subtype: string, payload: string) {
    if (subtype.startsWith('MCHUNK/')) {
      const parts = subtype.slice(7).split('/');
      if (parts.length < 4) return;
      const serverChunk = parts.length >= 5;
      const ftype = parts[0];
      const senderNick = serverChunk ? parts[1] : fromNick;
      const fidS = serverChunk ? parts[2] : parts[1];
      const nS = serverChunk ? parts[3] : parts[2];
      const totalS = serverChunk ? parts[4] : parts[3];
      const fid = parseInt(fidS!, 10), n = parseInt(nS!, 10), total = parseInt(totalS!, 10);
      if (isNaN(fid) || isNaN(n) || isNaN(total)) return;
      const chunk = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
      const frame = this.assembler.ingest(senderNick!, ftype!, fid, n, total, chunk);
      if (frame) this.dispatchFrame(senderNick!, channel, ftype!, frame);
      return;
    }

    if (subtype.includes('/')) {
      const [legacyType, senderNick] = subtype.split('/', 2);
      if (senderNick && (legacyType === 'AUDIO_FRAME' || legacyType === 'VIDEO_FRAME' || legacyType === 'VIDEO_KEYFRAME')) {
        const ftype = legacyType === 'AUDIO_FRAME'
          ? 'AUDIO'
          : legacyType === 'VIDEO_KEYFRAME' ? 'KEYFRAME' : 'FRAME';
        this.dispatchFrame(senderNick, channel, ftype,
                           Uint8Array.from(atob(payload), c => c.charCodeAt(0)));
        return;
      }
    }

    if (subtype === 'AUDIO' || subtype === 'KEYFRAME' || subtype === 'FRAME') {
      this.dispatchFrame(fromNick, channel, subtype,
                         Uint8Array.from(atob(payload), c => c.charCodeAt(0)));
      return;
    }

    this.handleControl(fromNick, channel, subtype, payload);
  }

  private handleControl(fromNick: string, channel: string, subtype: string, payload: string) {
    switch (subtype) {
      case 'VOICE_JOIN': {
        const pm = this.registry.getOrCreate(fromNick, channel, 'voice');
        this.cb.onPeerState?.(pm.state);
        if (this.callState === 'in_call' && this.activeRoom) {
          const localNick = this.getLocalNick();
          this.sendFrame(this.activeRoom, 'NEGO_OFFER', msgpackArray3(localNick, 'opus', 2000));
        }
        break;
      }
      case 'VIDEO_JOIN': {
        const profile = parseVideoJoinPayload(payload);
        const pm = this.registry.getOrCreate(fromNick, channel, 'video');
        this.registry.setVideoParams(fromNick, profile.width, profile.height, profile.screenShare ? 'screen' : 'video', profile.fps);
        this.cb.onPeerState?.(pm.state);
        break;
      }
      case 'VOICE_LEAVE':
      case 'VIDEO_LEAVE': {
        const pm = this.registry.get(fromNick);
        if (pm) {
          if (subtype === 'VIDEO_LEAVE') {
            pm.vidDec?.destroy(); pm.vidDec = null; pm.vidCanvas = null;
            pm.screenVidDec?.destroy(); pm.screenVidDec = null; pm.screenCanvas = null;
            pm.screenStream?.getTracks().forEach(t => t.stop()); pm.screenStream = null;
            pm.state.canvas = null; pm.state.hasVideo = false;
          }
          else { pm.audDec?.destroy(); pm.audDec = null; }
          this.cb.onPeerState?.(pm.state);
        }
        break;
      }
      case 'VIDEO_KEYREQ':
        /* Worker path: forward a keyreq message; the worker will force the
         * next encode to be a keyframe. */
        if (this.vidWorker) {
          this.vidWorker.postMessage({ type: 'keyreq' });
        } else if (this.vidEnc && this.activeRoom && this.vidCapture && this.vidCanvas) {
          /* Fallback path: encode a keyframe synchronously on the main thread. */
          const ctx = this.vidCanvas.getContext('2d', { willReadFrequently: true });
          const w = this.vidCanvas.width;
          const h = this.vidCanvas.height;
          if (ctx) {
            ctx.drawImage(this.vidCapture, 0, 0, w, h);
            const { y, u, v } = rgbaToYuv420(
              ctx.getImageData(0, 0, w, h).data, w, h);
            const encoded = this.vidEnc.encode(y, u, v, true);
            if (encoded.length) this.sendFrame(this.activeRoom, 'KEYFRAME', encoded);
          }
        }
        break;
      case 'MUTE':
      case 'VOICE_MUTE': {
        const muteNick = payload.trim() || fromNick;
        const pm = this.registry.get(muteNick) ?? this.registry.get(fromNick);
        if (pm) { pm.state.muted = true; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'UNMUTE':
      case 'VOICE_UNMUTE': {
        const unmuteNick = payload.trim() || fromNick;
        const pm = this.registry.get(unmuteNick) ?? this.registry.get(fromNick);
        if (pm) { pm.state.muted = false; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'DEAFEN': {
        const pm = this.registry.get(fromNick);
        if (pm) { pm.state.muted = true; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'UNDEAFEN': {
        const pm = this.registry.get(fromNick);
        if (pm) { pm.state.muted = false; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'ROSTER': {
        try {
          const roster = JSON.parse(payload) as { voice?: string[]; video?: string[] };
          for (const nick of roster.voice ?? []) this.registry.getOrCreate(nick, channel, 'voice');
          for (const nick of roster.video ?? []) this.registry.getOrCreate(nick, channel, 'video');
        } catch { /* bad JSON */ }
        break;
      }
      case 'STATS': {
        try { this.cb.onRoomStats?.(channel, JSON.parse(payload) as SuimyakuRoomStats); } catch { /* */ }
        break;
      }
      case 'MEDIA_STATS': {
        try {
          const val = JSON.parse(payload);
          const bps = typeof val === 'number' ? val : typeof val?.suggested_bps === 'number' ? val.suggested_bps : 0;
          if (bps > 0) this.applyNetworkBitrate(bps);
        } catch { /* */ }
        break;
      }
      case 'NEGO_OFFER': {
        if (this.activeRoom) {
          const answer = JSON.stringify({ codecs: ['opus'], max_bitrate_kbps: 128 });
          this.sendFrame(this.activeRoom, 'NEGO_ANSWER', new TextEncoder().encode(answer));
        }
        break;
      }
      case 'NEGO_ANSWER': {
        try {
          const ans = JSON.parse(payload) as { max_bitrate_kbps?: number };
          if (ans.max_bitrate_kbps) {
            this.negotiatedBitrate.set(fromNick.toLowerCase(), ans.max_bitrate_kbps);
            (this.audEnc as unknown as { setBitrate?: (n: number) => void })
              ?.setBitrate?.(ans.max_bitrate_kbps * 1000);
          }
        } catch { /* */ }
        break;
      }
      case 'PRESENCE': {
        const available = payload === '1' || payload.toLowerCase() === 'true';
        if (available) this.presenceList.add(fromNick); else this.presenceList.delete(fromNick);
        this.cb.onPresence?.(fromNick, available);
        break;
      }
      case 'SCREEN_DATA': {
        const frame = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        const pm = this.registry.getOrCreate(fromNick, channel, 'screen');
        this.ensureWasm().then(() => {
          this.registry.decodeScreenVideo(pm, frame, 'FRAME').catch(err =>
            this.cb.onDecodeError?.(fromNick, 'screen', err));
        });
        break;
      }
      case 'SCREEN_MUTE': {
        const pm = this.registry.get(fromNick);
        if (pm) { pm.state.muted = true; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'SCREEN_UNMUTE': {
        const pm = this.registry.get(fromNick);
        if (pm) { pm.state.muted = false; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'SCREEN_LEAVE': {
        const nick = payload.trim() || fromNick;
        const pm = this.registry.get(nick);
        if (pm) {
          pm.screenVidDec?.destroy(); pm.screenVidDec = null;
          pm.screenStream?.getTracks().forEach(t => t.stop());
          pm.screenStream = null;
          pm.screenCanvas = null; pm.state.hasVideo = false;
          this.cb.onPeerState?.(pm.state);
        }
        break;
      }
      case 'REACTION':
        if (payload.trim()) this.cb.onReaction?.(fromNick, payload.trim());
        break;
      case 'RECORD_START':
      case 'RECORD_STOP':
        this.cb.onRecordingAlert?.(fromNick, subtype === 'RECORD_START');
        break;
      case 'VOICE_KICK':
      case 'VIDEO_KICK': {
        try {
          const info = JSON.parse(payload) as { target?: string };
          const myNick = this.getLocalNick();
          if (!myNick || info.target?.toLowerCase() === myNick.toLowerCase()) {
            this.setIdle();
            this.cb.onError(`You were removed from ${subtype === 'VOICE_KICK' ? 'voice' : 'video'} by ${fromNick}`);
          }
        } catch { /* non-target */ }
        break;
      }
      case 'CHANNEL_INFO': {
        try {
          const roster = JSON.parse(payload) as Array<{ nick: string }>;
          for (const p of roster) if (p.nick) this.registry.getOrCreate(p.nick, channel, 'voice');
          if (roster.length >= 24 && !this.nearCapacityFired) {
            this.nearCapacityFired = true; this.cb.onRoomNearFull?.();
          }
        } catch { /* */ }
        break;
      }
      case 'CHANNEL_INFO_RESP': {
        try {
          const b = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
          if (b.length >= 9) {
            const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
            this.cb.onChannelInfo?.(channel, {
              voiceCount: view.getUint8(0), voiceMax:   view.getUint8(1),
              videoCount: view.getUint8(2), videoMax:   view.getUint8(3),
              flags:      view.getUint32(4, false),
            });
          }
        } catch { /* */ }
        break;
      }
      case 'MEDIA_PONG':
      case 'MEDIA_PONG2': {
        try {
          const sentAt = parseInt(subtype === 'MEDIA_PONG2' ? payload.split(':')[0]! : payload, 10);
          if (!isNaN(sentAt)) this.cb.onNetworkQuality?.(this.networkTier, Date.now() - sentAt);
        } catch { /* */ }
        break;
      }
      case 'MEDIA_PING2':
        if (this.client && this.activeRoom)
          this.client.send?.(`MEDIA ${this.activeRoom} MEDIA_PONG2 :${payload}`);
        break;
      case 'TSUMUGI_HANDSHAKE': {
        const peerKeyBytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        const existing = this.tsumugiSessions.get(fromNick.toLowerCase());
        const shouldReply = !existing?.established;
        const hsGen = this.callGuard.capture();
        (existing ? Promise.resolve(existing) : this.createTsumugiSession()).then(async vs => {
          await vs.ingestPeerKey(peerKeyBytes);
          // Hangup (or a rejoin) happened while we were establishing — drop this
          // session instead of resurrecting it into an idle/new call.
          if (!this.callGuard.isCurrent(hsGen)) {
            if (!existing) vs.destroy();
            return;
          }
          this.tsumugiSessions.set(fromNick.toLowerCase(), vs);
          if (shouldReply) {
            const ourPub = await this.exportTsumugiPublicKey(vs);
            void ourPub;
          }
          if (this.cb.onTsumugiState) {
            const fp = await vs.getFingerprint();
            this.cb.onTsumugiState(fromNick, vs.epoch, fp);
          }
          /* When all known peers have TSUMUGI sessions and we're in a room,
           * create/refresh the group key and distribute it. */
          if (this.activeRoom) this.maybeDistributeTsumugiGroup().catch(() => {});
        }).catch(() => {});
        break;
      }
      case 'TSUMUGI_RATCHET': {
        const vs = this.tsumugiSessions.get(fromNick.toLowerCase());
        if (vs) vs.ratchet().then(async () => {
          if (this.cb.onTsumugiState) {
            const fp = await vs.getFingerprint();
            this.cb.onTsumugiState(fromNick, vs.epoch, fp);
          }
        }).catch(() => {});
        break;
      }
      case 'TSUMUGI_DATA': {
        const ct = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        /* Try group key first (multi-party) */
        if (this.tsumugiGroupKey) {
          this.tsumugiGroupKey.decrypt(ct)
            .then(pt => this.dispatchFrame(fromNick, channel, 'AUDIO', pt))
            .catch(() => {
              /* Fall back to per-peer session */
              const vs = this.tsumugiSessions.get(fromNick.toLowerCase());
              if (vs?.established)
                vs.decrypt(ct).then(pt => this.dispatchFrame(fromNick, channel, 'AUDIO', pt)).catch(() => {});
            });
        } else {
          const vs = this.tsumugiSessions.get(fromNick.toLowerCase());
          if (!vs?.established) break;
          vs.decrypt(ct).then(pt => this.dispatchFrame(fromNick, channel, 'AUDIO', pt)).catch(() => {});
        }
        break;
      }
      case 'TSUMUGI_GROUP_KEY': {
        /* payload: base64(wrapped_key) or sender:target:base64(wrapped_key) */
        const parts = payload.split(':');
        const wrappedB64 = parts.length >= 3 ? parts.slice(2).join(':') : payload;
        const targetNick = parts.length >= 3 ? parts[1] : '';
        const myNick = this.getLocalNick().toLowerCase();
        if (targetNick && myNick && targetNick.toLowerCase() !== myNick) break;
        const wrapped = Uint8Array.from(atob(wrappedB64), c => c.charCodeAt(0));
        const vs = this.tsumugiSessions.get(fromNick.toLowerCase());
        if (vs?.established) {
          const gkGen = this.callGuard.capture();
          TsumugiGroup.importKey(wrapped, vs).then(group => {
            // Reject a group key that arrived after teardown / into a new call.
            if (!this.callGuard.isCurrent(gkGen)) { group.destroy(); return; }
            this.tsumugiGroupKey?.destroy();
            this.tsumugiGroupKey = group;
          }).catch(() => {});
        }
        break;
      }
      case 'VOICE_DATA':
        this.dispatchFrame(fromNick, channel, 'AUDIO',
                           Uint8Array.from(atob(payload), c => c.charCodeAt(0)));
        break;
      case 'VIDEO_DATA':
        this.dispatchFrame(fromNick, channel, 'FRAME',
                           Uint8Array.from(atob(payload), c => c.charCodeAt(0)));
        break;
      case 'MEDIA_BYE':
        this.registry.remove(fromNick);
        break;
      case 'SPEAKING': {
        const parts = payload.split(' ');
        const peerNick = parts[0] ?? fromNick;
        const speaking = (parts[2] ?? parts[1] ?? '0') === '1';
        const pm = this.registry.get(peerNick);
        if (pm) {
          pm.state.speaking = speaking;
          this.cb.onPeerState?.(pm.state); this.cb.onPeerSpeaking?.(peerNick, speaking);
        }
        break;
      }
      case 'VOICE_ACTIVITY':
      case 'VOICE_SPEAKING': {
        const speaking = payload === '1' || payload === 'true';
        const pm = this.registry.get(fromNick);
        if (pm) { pm.state.speaking = speaking; this.cb.onPeerState?.(pm.state); }
        break;
      }
      case 'RECORD_REQ':
        this.cb.onRecordConsent?.(fromNick);
        break;
      case 'CAPACITY_WARN':
        if (!this.nearCapacityFired) { this.nearCapacityFired = true; this.cb.onRoomNearFull?.(); }
        break;
      case 'RING':
        this.registry.getOrCreate(fromNick, null, 'voice');
        this.noteIncomingCall(fromNick, payload === 'video' ? 'video' : 'voice');
        break;
      case 'ACCEPT':
        this.clearRingTimer();
        this.activeRoom = fromNick;
        this.setCallState('in_call', fromNick, null);
        this.mediaframeCmd(fromNick, 'VOICE_JOIN', `${SAMPLE_RATE} ${AUDIO_CHANNELS}`);
        if (this.localKind === 'video') {
          const profile = this.localVideoProfile ?? videoProfileFor('video');
          this.mediaframeCmd(fromNick, 'VIDEO_JOIN', `${profile.width} ${profile.height} ${profile.quality} ${profile.fps}`);
        }
        this.sendTsumugiHandshake(fromNick).catch(() => {});
        break;
      case 'REJECT':
      case 'HANGUP':
      case 'LEAVE':
        this.registry.remove(fromNick);
        if (!this.activeRoom || subtype !== 'LEAVE') this.setIdle();
        break;
    }
  }

  private dispatchFrame(nick: string, channel: string, ftype: string, frame: Uint8Array) {
    if (!this.wasmReady) {
      this.ensureWasm().then(() => this.dispatchFrame(nick, channel, ftype, frame));
      return;
    }
    const kind: MediaKind = ftype === 'AUDIO' ? 'voice' : 'video';
    const pm = this.registry.getOrCreate(nick, channel, kind);

    const onErr = (type: MediaKind, err: unknown) => {
      const count = (this.registry.decodeErrors.get(nick) ?? 0) + 1;
      this.registry.decodeErrors.set(nick, count);
      this.cb.onDecodeError?.(nick, type, err);
      if (count > 5) this.registry.reset(nick);
    };

    if (ftype === 'AUDIO') {
      this.registry.decodeAudio(pm, frame).catch(err => onErr('voice', err));
    } else if (pm.state.kind === 'screen') {
      this.registry.decodeScreenVideo(pm, frame, ftype).catch(err => onErr('screen', err));
    } else {
      this.registry.decodeVideo(pm, frame, ftype).catch(err => onErr('video', err));
    }
  }

  // ----------------------------------------------------------------
  // State helpers
  // ----------------------------------------------------------------

  private unloadHandler: (() => void) | null = null;

  private setActiveRoom(channel: string) {
    this.activeRoom = channel;
    this.setCallState('in_call', '', channel);
    // Drop any prior call's MAC key/stream map; the new call's MACKEY repopulates.
    this.wsMediaKey = null;
    this.wsAudSeq = 0;
    this.wsVidSeq = 0;
    this.streamRouter.clear();
    if (!this.audioLevelTimer) {
      this.audioLevelTimer = setInterval(() => {
        for (const [nick, level] of this.registry.peerLevels)
          this.cb.onAudioLevel?.(nick, level);
      }, 100);
    }
    if (!this.unloadHandler && typeof window !== 'undefined') {
      this.unloadHandler = () => {
        if (this.activeRoom) this.leaveRoom(this.activeRoom);
        else if (this.callWith) this.hangup(this.callWith);
      };
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  private getLocalNick(): string {
    return this.cb.getLocalNick?.() ?? '';
  }

  private async createTsumugiSession(): Promise<TsumugiSession> {
    try {
      const id = await this.ensureTsumugiIdentity();
      return TsumugiSession.fromKeyPair(id.keyPair);
    } catch {
      return TsumugiSession.create();
    }
  }

  private async exportTsumugiPublicKey(session: TsumugiSession): Promise<Uint8Array> {
    try {
      const id = await this.ensureTsumugiIdentity();
      return id.exportPublicKey();
    } catch {
      return session.exportPublicKey();
    }
  }

  private async sendTsumugiHandshake(target: string): Promise<void> {
    if (!this.client || !target) return;
    const id = await this.ensureTsumugiIdentity();
    const pub = await id.exportPublicKey();
    void target; void pub;
  }

  private setCallState(state: CallState, nick: string, channel: string | null) {
    this.callState = state; this.callWith = nick;
    if (channel !== null) this.activeRoom = channel;
    this.cb.onCallState(state, nick, channel ?? this.activeRoom);
  }

  private setIdle() {
    this.clearRingTimer();
    this.stopAudioCapture(); this.stopVideoCapture(); this.stopSpeakingMeter();
    if (this.audioLevelTimer) { clearInterval(this.audioLevelTimer); this.audioLevelTimer = null; }
    this.registry.peerLevels.clear();
    this.registry.decodeErrors.clear();
    // Invalidate any in-flight crypto continuations before dropping references
    // so a late handshake/group-key promise can't resurrect key material into
    // an idle engine or bleed a previous call's group key into the next call.
    this.callGuard.bump();
    for (const vs of this.tsumugiSessions.values()) vs.destroy();
    this.tsumugiSessions.clear();
    this.tsumugiGroupKey?.destroy();
    this.tsumugiGroupKey = null;
    this.tsumugiGroupKeyPromise = null;
    // WS media plane teardown.
    this.wsMediaKey = null;
    this.wsMyNick = '';
    this.wsAudSeq = 0;
    this.wsVidSeq = 0;
    this.streamRouter.clear();
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
    this.suggestedBps = 0; this.networkTier = 0; this.videoSkipCount = 0;
    this.audioQuality = AUDIO_QUALITY; this.nearCapacityFired = false;
    this.pttMode = false; this.pttActive = false;
    if (this.recorder) { this.recorder.stop(); this.recorder = null; this.recChunks = []; }
    if (this.unloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }
    this.registry.clear();
    this.releaseMedia();
    this.callState = 'idle'; this.callWith = ''; this.activeRoom = null;
    this.cb.onCallState('idle', '', null);
  }

  private startRingTimer(target: string) {
    this.clearRingTimer();
    this.ringTimer = setTimeout(() => {
      if (this.callState === 'ringing_out' || this.callState === 'ringing_in') {
        this.hangup(target); this.cb.onError('Media request timed out');
      }
    }, SuimyakuMediaEngine.RING_TIMEOUT_MS);
  }

  private clearRingTimer() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private applyNetworkBitrate(bps: number) {
    this.suggestedBps = bps;
    const tier: NetworkQualityTier =
      bps >= BW_TIER_GOOD ? 0 : bps >= BW_TIER_FAIR ? 1 : bps >= BW_TIER_POOR ? 2 : 3;
    if (tier !== this.networkTier) {
      this.prevNetworkTier = this.networkTier;
      this.networkTier = tier;
      this.cb.onNetworkQuality?.(tier, bps);

      /* Notify the encode worker of the new tier so it can update its draw
       * canvas resolution.  The fallback path reads this.networkTier directly
       * inside onVideoTick(). */
      if (this.vidWorker) {
        this.vidWorker.postMessage({ type: 'tier', tier });
      }

      if (tier < this.prevNetworkTier && this.activeRoom) {
        for (const pm of this.registry.all()) {
          if (pm.vidDec) this.sendFrame(this.activeRoom, 'VIDEO_KEYREQ', msgpackArray1(pm.state.nick));
        }
      }
      if (this.localKind === 'screen' && this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          const c: MediaTrackConstraints =
            tier === 0 ? {} : tier === 1 ? { width: 1280, height: 720 }
            : tier === 2 ? { width: 854, height: 480 } : { width: 640, height: 360 };
          videoTrack.applyConstraints(c).catch(() => {});
        }
      }
      const targetQ: KaguraVoxQuality = tier <= 1 ? 2 : tier === 2 ? 1 : 0;
      if (targetQ !== this.audioQuality && this.audEnc && this.wasm) {
        this.audioQuality = targetQ;
        this.audEnc.destroy();
        this.audEnc = this.wasm.audioEncoder(SAMPLE_RATE, targetQ);
      }
      if (bps < BW_AUDIO_ONLY && (this.vidEnc || this.vidWorker)) this.stopVideoCapture();
    }
  }

  private async maybeDistributeTsumugiGroup() {
    if (!this.activeRoom || !this.client) return;
    const established = [...this.tsumugiSessions.entries()].filter(([, vs]) => vs.established);
    if (established.length === 0) return;
    const gen = this.callGuard.capture();
    /* Create or reuse group key. Memoize the in-flight creation so two
     * concurrent handshakes resolving in the same tick can't each build a
     * separate group key (the second would clobber the first, making the
     * first peer's traffic undecryptable). */
    let group = this.tsumugiGroupKey;
    if (!group) {
      if (!this.tsumugiGroupKeyPromise) {
        this.tsumugiGroupKeyPromise = TsumugiGroup.create()
          .then(g => {
            // If the call was torn down while creating, don't install the key.
            if (!this.callGuard.isCurrent(gen)) { g.destroy(); return g; }
            this.tsumugiGroupKey = g;
            return g;
          })
          .catch(err => { this.tsumugiGroupKeyPromise = null; throw err; });
      }
      group = await this.tsumugiGroupKeyPromise;
    }
    // A hangup/rejoin during key creation invalidates this distribution pass.
    if (!this.callGuard.isCurrent(gen)) return;
    const myNick = this.getLocalNick();
    for (const [nick, vs] of established) {
      const wrapped = await group.exportKeyFor(vs);
      const b64 = SuimyakuMediaEngine.toB64(wrapped);
      /* TSUMUGI_GROUP_KEY payload: the wrapped key; the server relay identifies target by msgpack */
      void myNick; void nick; void b64;
    }
  }

  private startGc() {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.assembler.gc(), 5000);
  }

  destroy() {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = null;
    this.setIdle();
  }
}

// ----------------------------------------------------------------
// AudioWorklet processor (inlined as data-URL)
// ----------------------------------------------------------------

const AUDIO_WORKLET_CODE = `
class KaguraVoxCapture extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    // frameSize is the interleaved-stereo sample count the encoder expects
    // (KAGURAVOX_FRAME_48K * 2). The mic delivers MONO, so accumulate half that
    // many mono samples per frame, then duplicate each into L and R. The
    // previous code accumulated the full stereo count of mono samples and
    // copied 1:1, which the encoder read as alternating L/R — decimating
    // each channel to 24 kHz with aliasing.
    const stereoFrame = opts.processorOptions.frameSize || 1920;
    this._mono = stereoFrame >> 1;
    this._buf = new Float32Array(this._mono);
    this._pos = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(ch.length - i, this._mono - this._pos);
      for (let k = 0; k < take; k++) {
        const v = Math.max(-1, Math.min(1, ch[i + k]));
        this._buf[this._pos + k] = v;
      }
      this._pos += take; i += take;
      if (this._pos === this._mono) {
        const i16 = new Int16Array(this._mono * 2);
        for (let j = 0; j < this._mono; j++) {
          const s = this._buf[j] * 32767;
          i16[j * 2]     = s;
          i16[j * 2 + 1] = s;
        }
        this.port.postMessage(i16, [i16.buffer]);
        this._pos = 0;
      }
    }
    return true;
  }
}
registerProcessor('kaguravox-capture', KaguraVoxCapture);
`;

// ----------------------------------------------------------------
// Convenience subclasses
// ----------------------------------------------------------------

export class VideoEngine extends SuimyakuMediaEngine {
  constructor(callbacks: SuimyakuMediaCallbacks) { super(callbacks, { kind: 'video' }); }
}

export class VoiceEngine extends SuimyakuMediaEngine {
  constructor(callbacks: SuimyakuMediaCallbacks) { super(callbacks, { kind: 'voice' }); }
}
