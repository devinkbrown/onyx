'use client';

import {
  KaguraVoxDecoder, KaguraVisDecoder,
  OpcodecWasm,
  yuv420ToRgba,
  KAGURAVOX_FRAME_48K,
  type KaguraVoxQuality,
} from './OpcodecWasm';
import type { SuimyakuPeerState, MediaKind } from './types';

// -------------------------------------------------------------------
// Per-peer decoder state
// -------------------------------------------------------------------

export interface PeerMedia {
  state:          SuimyakuPeerState;
  audDec:         KaguraVoxDecoder | null;
  vidDec:         KaguraVisDecoder | null;
  screenVidDec:   KaguraVisDecoder | null;
  audCtx:         AudioContext | null;
  vidCanvas:      HTMLCanvasElement | null;
  screenCanvas:   HTMLCanvasElement | null;
  screenStream:   MediaStream | null;
  panner:         StereoPannerNode | null;
  outputGain:     GainNode | null;
  lastKeyW:       number;
  lastKeyH:       number;
  lastScreenKeyW: number;
  lastScreenKeyH: number;
  videoW:         number;
  videoH:         number;
  screenW:        number;
  screenH:        number;
  videoFps:       number;
  screenFps:      number;
  /** Cached ImageData for camera video rendering — avoids per-frame allocation. */
  vidImageData:   ImageData | null;
  /** Cached ImageData for screen video rendering — avoids per-frame allocation. */
  screenImageData: ImageData | null;
}

// Max concurrent peers tracked before we start refusing new entries.
// Bounds memory growth from a flood of spurious MEDIA commands.
const MAX_PEERS = 64;

// -------------------------------------------------------------------
// Registry — creates, tracks, and tears down per-peer state
// -------------------------------------------------------------------

export class PeerRegistry {
  private peers = new Map<string, PeerMedia>();
  private detachedPeers = new WeakSet<PeerMedia>();

  /** Accumulated inter-arrival jitter (EMA) */
  lastJitterMs = 0;
  private lastDecodeAt = 0;

  private wasm: OpcodecWasm | null = null;
  private readonly sampleRate: number;
  private readonly audioQuality: () => KaguraVoxQuality;
  private readonly videoW: number;
  private readonly videoH: number;
  private readonly speakingRms: number;
  private outputDeviceId: string | null = null;
  private outputVolume = 0.8;
  private deafened = false;

  readonly peerLevels    = new Map<string, number>();
  readonly decodeErrors  = new Map<string, number>();

  onPeerStateChanged?: (state: SuimyakuPeerState) => void;
  onPeerLeft?:         (nick: string) => void;
  onPeerSpeaking?:     (nick: string, speaking: boolean) => void;

  constructor(opts: {
    sampleRate:   number;
    audioQuality: () => KaguraVoxQuality;
    videoW:       number;
    videoH:       number;
    speakingRms:  number;
  }) {
    this.sampleRate   = opts.sampleRate;
    this.audioQuality = opts.audioQuality;
    this.videoW       = opts.videoW;
    this.videoH       = opts.videoH;
    this.speakingRms  = opts.speakingRms;
  }

  setWasm(wasm: OpcodecWasm) { this.wasm = wasm; }

  private createPeerMedia(nick: string, channel: string | null, kind: MediaKind): PeerMedia {
    return {
      state: { nick, channel, kind, speaking: false, muted: false, hasVideo: false, canvas: null },
      audDec: null, vidDec: null, audCtx: null,
      screenVidDec: null, vidCanvas: null, screenCanvas: null, screenStream: null,
      panner: null, outputGain: null, lastKeyW: 0, lastKeyH: 0, lastScreenKeyW: 0, lastScreenKeyH: 0,
      videoW: this.videoW, videoH: this.videoH, screenW: this.videoW, screenH: this.videoH,
      videoFps: 60, screenFps: 60,
      vidImageData: null, screenImageData: null,
    };
  }

  private isDetached(pm: PeerMedia): boolean {
    return this.detachedPeers.has(pm);
  }

  private safeDestroy(decoder: { destroy: () => void } | null): void {
    try { decoder?.destroy(); } catch { /* teardown best-effort */ }
  }

  private safeDisconnect(node: { disconnect: () => void } | null): void {
    try { node?.disconnect(); } catch { /* teardown best-effort */ }
  }

  private safeClose(ctx: AudioContext | null): void {
    try { ctx?.close().catch(() => {}); } catch { /* teardown best-effort */ }
  }

  private safeStopStream(stream: MediaStream | null): void {
    for (const track of stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* teardown best-effort */ }
    }
  }

  get(nick: string): PeerMedia | undefined {
    return this.peers.get(nick.toLowerCase());
  }

  getOrCreate(nick: string, channel: string | null, kind: MediaKind): PeerMedia {
    const key = nick.toLowerCase();
    let pm = this.peers.get(key);
    if (pm) return pm;

    // Guard against unbounded peer map growth from malformed streams.
    if (this.peers.size >= MAX_PEERS) {
      // Return a transient, detached PeerMedia so callers never get null,
      // but do not register it so it doesn't consume tracked state.
      const detached = this.createPeerMedia(nick, channel, kind);
      this.detachedPeers.add(detached);
      return detached;
    }

    pm = this.createPeerMedia(nick, channel, kind);
    this.peers.set(key, pm);
    this.updateSpatialAudio();
    this.onPeerStateChanged?.(pm.state);
    return pm;
  }

  remove(nick: string) {
    const key = nick.toLowerCase();
    const pm  = this.peers.get(key);
    if (!pm) return;
    const stateNick = pm.state.nick;
    this.safeDestroy(pm.audDec);
    this.safeDestroy(pm.vidDec);
    this.safeDestroy(pm.screenVidDec);
    this.safeClose(pm.audCtx);
    this.safeDisconnect(pm.panner);
    this.safeDisconnect(pm.outputGain);
    this.safeStopStream(pm.screenStream);
    this.peers.delete(key);
    this.peerLevels.delete(key);
    this.decodeErrors.delete(key);
    this.updateSpatialAudio();
    this.onPeerLeft?.(stateNick);
  }

  reset(nick: string) {
    const pm = this.peers.get(nick.toLowerCase());
    if (!pm) return;
    this.safeDestroy(pm.audDec);       pm.audDec       = null;
    this.safeDestroy(pm.vidDec);       pm.vidDec       = null;
    this.safeDestroy(pm.screenVidDec); pm.screenVidDec = null;
    this.safeClose(pm.audCtx);         pm.audCtx       = null;
    this.safeDisconnect(pm.panner);    pm.panner       = null;
    this.safeDisconnect(pm.outputGain); pm.outputGain  = null;
    this.safeStopStream(pm.screenStream);
    pm.screenStream  = null;
    pm.screenCanvas  = null;
    pm.vidCanvas     = null;
    pm.state.canvas  = null;
    pm.vidImageData   = null;
    pm.screenImageData = null;
    this.decodeErrors.set(nick.toLowerCase(), 0);
  }

  all(): IterableIterator<PeerMedia> {
    return this.peers.values();
  }

  allNicks(): IterableIterator<string> {
    return this.peers.keys();
  }

  clear() {
    for (const nick of Array.from(this.peers.keys())) this.remove(nick);
  }

  getScreenStream(nick: string): MediaStream | null {
    return this.peers.get(nick.toLowerCase())?.screenStream ?? null;
  }

  setOutput(deviceId: string | null, volume: number): void {
    this.outputDeviceId = deviceId;
    this.outputVolume = Math.max(0, Math.min(1, volume));
    for (const pm of this.peers.values()) {
      if (pm.outputGain) pm.outputGain.gain.value = this.deafened ? 0 : this.outputVolume;
      this.applySink(pm);
    }
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const pm of this.peers.values()) {
      if (pm.outputGain) pm.outputGain.gain.value = deafened ? 0 : this.outputVolume;
      if (pm.audCtx) {
        if (deafened) pm.audCtx.suspend().catch(() => {});
        else pm.audCtx.resume().catch(() => {});
      }
    }
  }

  setVideoParams(nick: string, width: number, height: number, kind: MediaKind, fps = 60): void {
    const pm = this.getOrCreate(nick, null, kind);
    if (this.isDetached(pm)) return;
    if (kind === 'screen') {
      if (pm.screenW !== width || pm.screenH !== height) {
        this.safeDestroy(pm.screenVidDec);
        pm.screenVidDec  = null;
        pm.screenCanvas  = null;
        pm.screenImageData = null;
        this.safeStopStream(pm.screenStream);
        pm.screenStream  = null;
      }
      pm.screenW   = width;
      pm.screenH   = height;
      pm.screenFps = fps;
    } else {
      if (pm.videoW !== width || pm.videoH !== height) {
        this.safeDestroy(pm.vidDec);
        pm.vidDec       = null;
        pm.vidCanvas    = null;
        pm.vidImageData  = null;
        pm.state.canvas = null;
      }
      pm.videoW   = width;
      pm.videoH   = height;
      pm.videoFps = fps;
    }
    pm.state.kind     = kind;
    pm.state.hasVideo = true;
    this.onPeerStateChanged?.(pm.state);
  }

  totalFramesDecoded(): number {
    let n = 0;
    for (const pm of this.peers.values()) n += pm.audDec?.framesDecoded ?? 0;
    return n;
  }

  // ----------------------------------------------------------------
  // Decode helpers
  // ----------------------------------------------------------------

  async decodeAudio(pm: PeerMedia, frame: Uint8Array): Promise<void> {
    if (!this.wasm || this.isDetached(pm)) return;
    if (!pm.audDec) pm.audDec = this.wasm.audioDecoder(this.sampleRate, this.audioQuality());
    if (!pm.audCtx) pm.audCtx = new AudioContext({ sampleRate: this.sampleRate });

    let pcm: Int16Array;
    try {
      pcm = pm.audDec.decode(frame);
    } catch {
      const key = pm.state.nick.toLowerCase();
      this.decodeErrors.set(key, (this.decodeErrors.get(key) ?? 0) + 1);
      return;
    }

    const ctx = pm.audCtx;
    this.applySink(pm);
    // KaguraVoxDecoder returns KAGURAVOX_FRAME_48K mono Int16 samples.
    // Create a stereo AudioBuffer and copy the same mono data to both channels.
    const buf = ctx.createBuffer(2, KAGURAVOX_FRAME_48K, this.sampleRate);
    const monoSamples = Math.min(pcm.length, KAGURAVOX_FRAME_48K);
    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      for (let i = 0; i < monoSamples; i++) {
        out[i] = pcm[i]! / 32768;
      }
    }

    /* RMS energy for VAD level metering (mono signal) */
    let sumSq = 0;
    for (let i = 0; i < monoSamples; i++) { const s = pcm[i]! / 32768; sumSq += s * s; }
    const rms = Math.sqrt(sumSq / Math.max(1, monoSamples));
    this.peerLevels.set(pm.state.nick.toLowerCase(), Math.min(1, rms / 0.1));

    /* Inter-arrival jitter (EMA) */
    const now = Date.now();
    if (this.lastDecodeAt > 0) {
      const iat      = now - this.lastDecodeAt;
      const expected = (KAGURAVOX_FRAME_48K / this.sampleRate) * 1000;
      const diff     = Math.abs(iat - expected);
      this.lastJitterMs = this.lastJitterMs * 0.9 + diff * 0.1;
    }
    this.lastDecodeAt = now;

    const prevSpeaking = pm.state.speaking;
    pm.state.speaking  = rms > this.speakingRms;
    if (pm.state.speaking !== prevSpeaking) {
      this.onPeerSpeaking?.(pm.state.nick, pm.state.speaking);
      this.onPeerStateChanged?.(pm.state);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (!pm.panner) pm.panner = ctx.createStereoPanner();
    if (!pm.outputGain) {
      pm.outputGain = ctx.createGain();
      pm.outputGain.gain.value = this.deafened ? 0 : this.outputVolume;
      pm.panner.connect(pm.outputGain);
      pm.outputGain.connect(ctx.destination);
    }
    src.connect(pm.panner);
    src.start(ctx.currentTime);
  }

  private applySink(pm: PeerMedia): void {
    if (!pm.audCtx) return;
    const ctxWithSink = pm.audCtx as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
    if (typeof ctxWithSink.setSinkId !== 'function') return;
    ctxWithSink.setSinkId(this.outputDeviceId ?? '').catch(() => {});
  }

  async decodeVideo(pm: PeerMedia, frame: Uint8Array, ftype: string): Promise<void> {
    if (!this.wasm || this.isDetached(pm)) return;
    const isKey = ftype === 'KEYFRAME';
    const W = pm.videoW || this.videoW, H = pm.videoH || this.videoH;

    // Don't feed a delta frame into a non-existent decoder — the codec
    // needs a keyframe to establish its reference frame.
    if (!pm.vidDec && !isKey) return;

    if (!pm.vidDec || (isKey && (pm.lastKeyW !== W || pm.lastKeyH !== H))) {
      this.safeDestroy(pm.vidDec);
      pm.vidDec       = this.wasm.videoDecoder(W, H);
      pm.lastKeyW     = W;
      pm.lastKeyH     = H;
      pm.vidImageData  = null;   // dimensions changed; cached ImageData is stale
    }

    let planes: { y: Uint8Array; u: Uint8Array; v: Uint8Array } | null;
    try {
      planes = pm.vidDec.decode(frame);
    } catch {
      const key = pm.state.nick.toLowerCase();
      this.decodeErrors.set(key, (this.decodeErrors.get(key) ?? 0) + 1);
      this.safeDestroy(pm.vidDec);
      pm.vidDec = null;   // force re-sync on next keyframe
      return;
    }
    if (!planes) return;

    if (!pm.vidCanvas) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      pm.vidCanvas    = c;
      pm.state.canvas = c;
      pm.state.hasVideo = true;
      this.onPeerStateChanged?.(pm.state);
    }
    const ctx2 = pm.vidCanvas.getContext('2d');
    if (!ctx2) return;

    // Reuse the cached ImageData to avoid a large heap allocation every frame.
    if (!pm.vidImageData || pm.vidImageData.width !== W || pm.vidImageData.height !== H) {
      pm.vidImageData = ctx2.createImageData(W, H);
    }
    yuv420ToRgba(planes.y, planes.u, planes.v, W, H, pm.vidImageData.data);
    ctx2.putImageData(pm.vidImageData, 0, 0);
  }

  async decodeScreenVideo(pm: PeerMedia, frame: Uint8Array, ftype: string): Promise<void> {
    if (!this.wasm || this.isDetached(pm)) return;
    const isKey = ftype === 'KEYFRAME';
    const W = pm.screenW || this.videoW, H = pm.screenH || this.videoH;

    // Don't feed a delta frame into a non-existent decoder.
    if (!pm.screenVidDec && !isKey) return;

    if (!pm.screenVidDec || (isKey && (pm.lastScreenKeyW !== W || pm.lastScreenKeyH !== H))) {
      this.safeDestroy(pm.screenVidDec);
      pm.screenVidDec   = this.wasm.videoDecoder(W, H);
      pm.lastScreenKeyW = W;
      pm.lastScreenKeyH = H;
      pm.screenImageData = null;  // dimensions changed; cached ImageData is stale
    }

    let planes: { y: Uint8Array; u: Uint8Array; v: Uint8Array } | null;
    try {
      planes = pm.screenVidDec.decode(frame);
    } catch {
      const key = pm.state.nick.toLowerCase();
      this.decodeErrors.set(key, (this.decodeErrors.get(key) ?? 0) + 1);
      this.safeDestroy(pm.screenVidDec);
      pm.screenVidDec = null;   // force re-sync on next keyframe
      return;
    }
    if (!planes) return;

    if (!pm.screenCanvas) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      pm.screenCanvas = c;
      pm.screenStream = (c as HTMLCanvasElement & { captureStream(fps?: number): MediaStream })
        .captureStream(pm.screenFps || 60);
      pm.state.hasVideo = true;
      this.onPeerStateChanged?.(pm.state);
    }
    const ctx2 = pm.screenCanvas.getContext('2d');
    if (!ctx2) return;

    // Reuse cached ImageData.
    if (!pm.screenImageData || pm.screenImageData.width !== W || pm.screenImageData.height !== H) {
      pm.screenImageData = ctx2.createImageData(W, H);
    }
    yuv420ToRgba(planes.y, planes.u, planes.v, W, H, pm.screenImageData.data);
    ctx2.putImageData(pm.screenImageData, 0, 0);
  }

  // ----------------------------------------------------------------
  // Spatial audio (stereo panning spread across peers)
  // ----------------------------------------------------------------

  /**
   * Apply a manual stereo pan (-1..+1) for a specific nick.
   * Used by the SpatialPad UI for listener-centric panning.
   * Falls back silently if no AudioContext exists yet for the peer.
   */
  setPanForNick(nick: string, pan: number): void {
    const key = nick.toLowerCase();
    for (const pm of this.peers.values()) {
      if (pm.state.nick.toLowerCase() !== key) continue;
      if (!pm.audCtx) return;
      if (!pm.panner) pm.panner = pm.audCtx.createStereoPanner();
      pm.panner.pan.value = Math.max(-1, Math.min(1, pan));
      return;
    }
  }

  private updateSpatialAudio() {
    const list = Array.from(this.peers.values());
    list.forEach((pm, idx) => {
      if (!pm.audCtx) return;
      const panValue = list.length <= 1
        ? 0
        : ((idx / Math.max(1, list.length - 1)) * 2 - 1) * 0.6;
      if (!pm.panner) pm.panner = pm.audCtx.createStereoPanner();
      pm.panner.pan.value = panValue;
    });
  }
}
