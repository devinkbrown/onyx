// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * voice-core.ts — the `window.OnyxVoiceEngine` adapter for the Elm client.
 *
 * Wraps the real Cadence media engine (src/lib/cadence-media/MediaEngine.ts)
 * behind exactly the surface elm/ports.js calls, and plays the part the
 * SolidJS IRC client + store played for it:
 *
 *   - a client shim (`binaryHandlers`, `extraMessageHandlers`, `sendRaw`,
 *     `send`, `sendBinary`, `currentNick`) over the ONE socket ports.js owns
 *     (`attachTransport` / `transportOpen` / `transportClosed`);
 *   - the inbound line tap (`receiveLine`): raw lines go to the engine's
 *     media-plane handler, and `NOTE MEDIA` / `EVENT … MEDIA` lines are
 *     re-shaped and forwarded to `handleMediaMessage` exactly like
 *     store.ts `_handleMessage` (the oracle glue);
 *   - binary datagrams (`receiveMediaFrame`) fan out to `binaryHandlers`;
 *   - engine callbacks become `subscribe(push)` events in the shape
 *     ports.js `mountVoiceFeedPush` folds ({state…}, {peer}, {peerLeft},
 *     {localStream}) plus confirmed trust/media fields through `push.local`.
 *
 * The engine itself is injected (`createEngine`) so this file stays testable
 * in node with a fake (elm/voiceEngine.smoke.mjs); voice-engine.ts wires the
 * real one. Nothing here talks to the network on its own: every byte goes
 * through the transport ports.js attached.
 */
import { formatIRCLine, parseIRCMessage } from '@/lib/irc/parser';
import type { IRCMessage } from '@/lib/irc/types';
import type {
  CadenceMediaCallbacks,
  CadencePeerState,
  CallState,
  MediaKind,
} from '@/lib/cadence-media/types';
import type { AudioUnlock, PlatformInfo } from './platform';

/** The engine surface the adapter drives (CadenceMediaEngine satisfies it). */
export interface VoiceEngineCore {
  setClient(client: VoiceClientShim | null): void;
  joinVoice(channel: string, preacquired?: MediaStream | null): Promise<void>;
  joinVideo(channel: string, preacquired?: MediaStream | null): Promise<void>;
  leaveRoom(channel: string): void;
  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  setOutput(deviceId: string | null, volumePercent: number): void;
  startCamera(channel?: string): Promise<void>;
  stopCamera(): void;
  startScreenShare(channel?: string): Promise<void>;
  stopBroadcast(channel?: string): void;
  startCall(nick: string, kind?: MediaKind): Promise<void>;
  acceptIncomingCall(): Promise<void>;
  rejectCall(nick: string): void;
  hangup(nick: string): void;
  getPeers(): Map<string, CadencePeerState>;
  getScreenStream(nick: string): MediaStream | null;
  getLocalStream(): MediaStream | null;
  getLocalKind(): MediaKind | null;
  getCallState(): { callState: CallState; callWith: string; callChannel: string | null };
  handleMediaMessage(fromNick: string, channel: string, subtype: string, payload: string): void;
  setPushToTalk(enabled: boolean): void;
  pttPress(): void;
  pttRelease(): void;
  getLocalMediaE2eeFingerprint?(): Promise<string>;
  getNetworkStats?(): Record<string, number>;
}

/** What ports.js hands over: the one socket it owns. */
export interface VoiceTransport {
  sendLine(line: string): unknown;
  sendBinary(bytes: Uint8Array): boolean;
  /** The WebSocket endpoint (owner bucket for media key pins). */
  url?(): string;
}

export interface VoicePush {
  (event: Record<string, unknown>): void;
  local?: (fields: Record<string, unknown>) => void;
}

export interface VoiceAdapterOptions {
  createEngine(callbacks: CadenceMediaCallbacks): VoiceEngineCore;
  /** TOFU gate for a peer's media handshake key (keyPinning in the bundle). */
  verifyPeerMediaKey?(
    owner: { serverUrl: string; identity: string },
    nick: string,
    publicKeyB64url: string,
    attachmentId: string,
    trustBinding: string,
  ): Promise<boolean>;
  log?(message: string): void;
  /** Capture (navigator.mediaDevices.getUserMedia). Called SYNCHRONOUSLY from
   *  the join/camera click path so WebKit keeps the user-gesture activation. */
  getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** IDENTITY ADD claim for the device signing key the engine signs media
   *  handshakes with (deviceSign in the bundle). */
  enrollIdentity?(account: string): Promise<{ label: string; publicHex: string; sig: string } | null>;
  /** WebKit audio unlock / session control (platform.ts). */
  audio?: AudioUnlock;
  platform?: PlatformInfo;
  /** navigator.userActivation.isActive, for the gesture diagnostics. */
  userActivation?(): boolean | null;
}

/** The engine reads these members of its IRC client and nothing else. */
export interface VoiceClientShim {
  readonly binaryHandlers: Set<(data: Uint8Array) => void>;
  readonly extraMessageHandlers: Set<(msg: IRCMessage) => void>;
  readonly currentNick: string;
  readonly admitsMediaBinary: boolean;
  sendRaw(command: string, ...params: string[]): void;
  send(line: string): void;
  sendBinary(bytes: Uint8Array): boolean;
}

const MAX_NICK = 256;
const MAX_TARGET = 512;
const MAX_TRACKED_FINGERPRINTS = 64;
const CHANNEL_SIGILS = '#&';

/** `_validInboundWireToken`: non-empty, bounded, no C0/space/DEL. */
function validWireToken(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/[\u0000- \u007f]/u.test(value);
}

/** `_normalizeTypingToken`: a wire token that is not `:`-led and has no comma. */
function validActor(value: string): boolean {
  return validWireToken(value, MAX_NICK) && !value.startsWith(':') && !value.includes(',');
}

function validChannel(value: string): boolean {
  return value.length > 0
    && CHANNEL_SIGILS.includes(value[0]!)
    && validWireToken(value, MAX_TARGET)
    && !value.includes(',');
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      const n: unknown = data[i];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255) return null;
      out[i] = n;
    }
    return out;
  }
  return null;
}

/**
 * v3/rx-calls — an engine `onError` line → the call UI's error word, so
 * media failures are never silent. Join / ring / share failures have
 * their own paths (the failed banner, the ring dialog, `screenError`):
 * null here. The UI shows calm copy per word, never the raw engine text.
 */
export function classifyMediaError(message: string): string | null {
  const m = String(message || '').trim();
  if (!m) return null;
  if (/^(Voice|Video) join failed|^Call start failed|^Accept failed|^Already in a session|^No active room for|^Screen share failed|^Stream start failed/i.test(m)) return null;
  if (/^Codec unavailable/i.test(m)) return 'codec';
  if (/^You were removed from/i.test(m)) return 'removed';
  if (/^Media request timed out/i.test(m)) return 'timeout';
  if (/video encod|encoder|encode worker/i.test(m)) return 'encoder';
  return 'media';
}

/** Per-peer decode notices are rate-limited to one a minute. */
const DECODE_NOTICE_MS = 60_000;

function errorFrom(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' && reason ? reason : fallback);
}

type StoredSettings = {
  inputDeviceId: string | null;
  cameraDeviceId: string | null;
  outputDeviceId: string | null;
  outputVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
};

function readSettings(raw: unknown, prev: StoredSettings): StoredSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prev;
  const r = raw as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= 600 ? v : null);
  return {
    inputDeviceId: id(r.inputDeviceId),
    cameraDeviceId: id(r.cameraDeviceId),
    outputDeviceId: id(r.outputDeviceId),
    outputVolume: typeof r.outputVolume === 'number' && Number.isFinite(r.outputVolume)
      ? Math.max(0, Math.min(100, r.outputVolume)) : prev.outputVolume,
    noiseSuppression: typeof r.noiseSuppression === 'boolean' ? r.noiseSuppression : prev.noiseSuppression,
    echoCancellation: typeof r.echoCancellation === 'boolean' ? r.echoCancellation : prev.echoCancellation,
  };
}

export interface OnyxVoiceAdapter {
  subscribe(push: VoicePush): void;
  attachTransport(transport: VoiceTransport): void;
  transportOpen(): void;
  transportClosed(): void;
  receiveLine(line: string): void;
  receiveMediaFrame(bytes: unknown): void;
  joinVoice(channel: string, opts?: { video?: boolean }): Promise<void>;
  leaveRoom(channel: string): void;
  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  setOutput(deviceId: string | null, volumePercent: number): void;
  applyVoiceSettings(raw: unknown): void;
  setPushToTalk(enabled: boolean): void;
  pttPress(): void;
  pttRelease(): void;
  startCall(peer: string, kind?: string): Promise<void>;
  acceptIncomingCall(): Promise<void>;
  rejectCall(peer: string): void;
  hangup(peer: string): void;
  startCamera(channel?: string): Promise<boolean>;
  stopCamera(): void;
  startScreenShare(channel?: string): Promise<boolean>;
  stopScreenShare(channel?: string): Promise<void>;
  getPeers(): Map<string, CadencePeerState>;
  getScreenStream(nick: string): MediaStream | null;
  streamForTile(tile: string): MediaStream | null;
  /** Re-establish audio after backgrounding / a route change / an ended track
   *  (`gesture`: called synchronously inside a tap, so capture may restart). */
  recover(reason?: string, gesture?: boolean): void;
  /** v3/rx-calls: a peer's pinned media key changed — the handshake was
   *  refused; tell the call UI (voice-engine.ts verifyPeerMediaKey). */
  peerKeyChanged(nick: string): void;
  /** Diagnostics for tests and the e2e harness (no key material). */
  stats(): Record<string, unknown>;
}

export function createVoiceAdapter(options: VoiceAdapterOptions): OnyxVoiceAdapter {
  const log = options.log ?? (() => {});
  const subscribers: VoicePush[] = [];
  let transport: VoiceTransport | null = null;
  let open = false;
  let ourNick = '';
  let account = '';
  /** Channel whose join resolved (the engine accepts MUTE etc. from here on). */
  let joinedRoom: string | null = null;
  let desiredMuted = false;
  let pttEnabled = false;
  let settings: StoredSettings = {
    inputDeviceId: null,
    cameraDeviceId: null,
    outputDeviceId: null,
    outputVolume: 80,
    noiseSuppression: true,
    echoCancellation: true,
  };
  /** Internal restarts (screen share end → voice) hide the transient idle. */
  let suppressIdle = false;
  let lastState: CallState = 'idle';
  const fingerprints: Record<string, string> = {};
  const counters = {
    linesIn: 0,
    mediaLinesForwarded: 0,
    framesIn: 0,
    framesInBytes: 0,
    framesOut: 0,
    framesOutBytes: 0,
    linesOut: 0,
    localSpeaking: false,
    e2eeActive: false,
    e2eeDegraded: false,
    lastError: '',
    /** Server-side evidence (diagnostics only): `IDENTITY ADDED`, the last
     *  `FAIL MEDIA <code>`, and `404 … Media frame rejected` notices. */
    identityEnrolled: false,
    lastMediaFail: '',
    framesRejected: 0,
    /** navigator.userActivation.isActive when the join reached the adapter. */
    joinGesture: null as boolean | null,
    recoveries: 0,
  };
  const platform: PlatformInfo = options.platform ?? { ios: false, standalone: false, canShareScreen: true, canCapture: true };
  /** Account whose device key the server confirmed on this connection. */
  let enrolledFor = '';
  let enrollWait: { label: string; resolve: () => void; reject: (err: Error) => void } | null = null;
  /** v3/rx-calls: the join in flight (capture / enrollment), and whether
   *  Leave cancelled it before the engine joined. */
  let pendingJoin: { channel: string; seq: number } | null = null;
  let joinSeq = 0;
  let cancelledSeq = 0;
  /** v3/rx-calls: device-key labels the SERVER confirmed on this
   *  connection (`IDENTITY ADDED`, e.g. from the Elm client's own
   *  enrollment at sign-in) → the account they were confirmed for. */
  const confirmedLabels = new Map<string, string>();
  /** v3/rx-calls: last decode notice per peer (lowercase nick → ms). */
  const decodeNoticed: Record<string, number> = {};
  let recovering = false;
  let recoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Speaking state we last told the server (MEDIA SPEAKING), and the
   *  hang-over timer that keeps one breath from flapping it. */
  let speakingSent = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Outbound `MEDIA JOIN <chan>` seen during the current join attempt. */
  let joinSentFor: string | null = null;

  function emit(event: Record<string, unknown>): void {
    for (const push of subscribers) {
      try { push(event); } catch { /* a subscriber failure never stops the engine */ }
    }
  }

  function emitLocal(fields: Record<string, unknown>): void {
    // Every snapshot restates the platform's share capability so ports.js
    // never back-fills its desktop probe over an iPhone's "no share".
    const merged = { shareSupported: platform.canShareScreen, ...fields };
    for (const push of subscribers) {
      try { if (typeof push.local === 'function') push.local(merged); } catch { /* best-effort */ }
    }
  }

  const shim: VoiceClientShim = {
    binaryHandlers: new Set(),
    extraMessageHandlers: new Set(),
    get currentNick() { return ourNick; },
    get admitsMediaBinary() { return open; },
    sendRaw(command: string, ...params: string[]) {
      if (command.toUpperCase() === 'MEDIA' && (params[0] ?? '').toUpperCase() === 'JOIN' && params[1]) {
        joinSentFor = params[1];
      }
      shim.send(formatIRCLine(command, ...params));
    },
    send(line: string) {
      if (!transport || !open) return;
      counters.linesOut += 1;
      try { transport.sendLine(line); } catch { /* socket gone */ }
    },
    sendBinary(bytes: Uint8Array) {
      if (!transport || !open) return false;
      let ok: boolean;
      try { ok = transport.sendBinary(bytes) === true; } catch { ok = false; }
      if (ok) {
        counters.framesOut += 1;
        counters.framesOutBytes += bytes.byteLength;
      }
      return ok;
    },
  };

  // The callbacks below close over `engine`; they only fire once it runs.
  const engineRef: { current: VoiceEngineCore | null } = { current: null };
  const engineOf = (): VoiceEngineCore => engineRef.current!;

  function localKindOr(fallback: MediaKind): MediaKind {
    return engine.getLocalKind() ?? fallback;
  }

  function hasLocalVideo(): boolean {
    const stream = engine.getLocalStream();
    return !!stream && stream.getVideoTracks().some((t) => t.readyState !== 'ended');
  }

  function peerEvent(peer: CadencePeerState): Record<string, unknown> {
    // A peer whose camera frames decode is a video peer even when the engine
    // first met it as voice (its kind is set on join only).
    const kind = peer.hasVideo && peer.kind === 'voice' ? 'video' : peer.kind;
    return {
      nick: peer.nick,
      kind,
      hasVideo: peer.hasVideo === true,
      speaking: peer.speaking === true,
      muted: peer.muted === true,
    };
  }

  function findPeer(nick: string): CadencePeerState | null {
    const lower = nick.toLowerCase();
    for (const [key, state] of engine.getPeers()) {
      if (key.toLowerCase() === lower) return state;
    }
    return null;
  }

  const callbacks: CadenceMediaCallbacks = {
    onCallState(state, nick, channel) {
      lastState = state;
      if (state === 'idle') {
        joinedRoom = null;
        speakingSent = false;
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        for (const key of Object.keys(fingerprints)) delete fingerprints[key];
        if (suppressIdle) return;
        options.audio?.setCallSession(false);
        emit({ state, nick: '', channel: null });
        return;
      }
      // The bar must never offer screen share where the platform has none
      // (iPhone/iPad WebKit has no display picker).
      emit({
        state,
        nick: typeof nick === 'string' ? nick : '',
        channel: channel ?? null,
        shareSupported: platform.canShareScreen,
      });
    },
    onPeerState(peer) {
      emit({ peer: peerEvent(peer) });
    },
    onPeerLeft(nick) {
      if (typeof nick !== 'string' || !nick) return;
      delete fingerprints[nick.toLowerCase()];
      emit({ peerLeft: nick });
    },
    onPeerSpeaking(nick, speaking) {
      if (nick === 'local') {
        counters.localSpeaking = speaking;
        announceSpeaking(speaking);
        if (ourNick && lastState !== 'idle') {
          emit({
            peer: {
              nick: ourNick,
              kind: localKindOr('voice'),
              speaking: speaking && !desiredMuted,
              muted: desiredMuted,
              hasVideo: hasLocalVideo(),
            },
          });
        }
        return;
      }
      const peer = findPeer(nick);
      if (peer) emit({ peer: peerEvent(peer) });
    },
    onLocalStream(stream) {
      emit({ localStream: stream ?? null });
      if (lastState !== 'idle') {
        const kind = engine.getLocalKind();
        emitLocal({ camera: kind === 'video' && !!stream, screen: kind === 'screen' && !!stream });
      }
      // Capture died under a live call (iOS interruption, unplugged mic, a
      // revoked permission): the engine already left the media room, so
      // rejoin with fresh capture instead of sitting in a silent call.
      if (!stream && joinedRoom && lastState === 'in_call' && !recovering) scheduleRecover('capture-ended');
    },
    onError(message) {
      counters.lastError = String(message).slice(0, 300);
      log(`voice: ${counters.lastError}`);
      // v3/rx-calls: never silent. A removal ended the call already (the
      // engine went idle first), so it rides a second idle snapshot; any
      // other in-call failure rides the live snapshot.
      const kind = classifyMediaError(counters.lastError);
      if (!kind) return;
      if (kind === 'removed') {
        emit({ state: 'idle', nick: '', channel: null, errorKind: kind, mediaError: counters.lastError.slice(0, 160) });
      } else if (lastState !== 'idle') {
        emitLocal({ errorKind: kind });
      }
    },
    onDecodeError(peer, type, err) {
      log(`voice: decode ${type} from ${peer}: ${err instanceof Error ? err.message : String(err)}`);
      if (lastState === 'idle' || typeof peer !== 'string' || !peer) return;
      const key = peer.toLowerCase();
      const now = Date.now();
      if (decodeNoticed[key] !== undefined && now - decodeNoticed[key] < DECODE_NOTICE_MS) return;
      decodeNoticed[key] = now;
      emitLocal({ errorKind: 'decode', errorPeer: peer, errorMedia: type === 'video' || type === 'screen' ? type : 'voice' });
    },
    onNetworkQuality(tier) {
      if (lastState !== 'idle') emitLocal({ qualityTier: tier });
    },
    onMooringState(nick, _epoch, fingerprint) {
      if (typeof nick !== 'string' || !nick || typeof fingerprint !== 'string') return;
      const key = nick.toLowerCase();
      if (!(key in fingerprints) && Object.keys(fingerprints).length >= MAX_TRACKED_FINGERPRINTS) return;
      fingerprints[key] = fingerprint;
      if (lastState !== 'idle') emitLocal({ peerFingerprints: { ...fingerprints } });
    },
    onMediaE2eeState(active, degraded) {
      counters.e2eeActive = active;
      counters.e2eeDegraded = degraded;
      if (lastState !== 'idle') emitLocal({ e2eeActive: active, e2eeDegraded: degraded });
    },
    verifyPeerMediaKey: options.verifyPeerMediaKey
      ? (nick, pub, attachment, binding) => {
        const serverUrl = transport && typeof transport.url === 'function' ? transport.url() : '';
        const identity = (account || ourNick).trim();
        if (!serverUrl || !identity) return Promise.resolve(false);
        return options.verifyPeerMediaKey!({ serverUrl, identity }, nick, pub, attachment, binding);
      }
      : undefined,
    enableVideoCalls: () => true,
    enableVoiceCalls: () => true,
    getMediaSettings: () => ({ ...settings }),
    getLocalNick: () => ourNick,
  };

  engineRef.current = options.createEngine(callbacks);
  const engine = engineOf();

  /**
   * Local voice activity → `MEDIA SPEAKING <#chan> voice on|off`. The server
   * re-broadcasts it as SPEAKING / SILENT to every member (us included), the
   * one speaking signal that reaches cross-node peers and the Elm roster.
   * Rising edges go out at once; silence waits out a short hang-over.
   */
  function announceSpeaking(active: boolean): void {
    const on = active && !desiredMuted && !!joinedRoom;
    if (on) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (!speakingSent && joinedRoom) {
        speakingSent = true;
        shim.sendRaw('MEDIA', 'SPEAKING', joinedRoom, 'voice', 'on');
      }
      return;
    }
    if (!speakingSent || silenceTimer) return;
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!speakingSent) return;
      speakingSent = false;
      if (joinedRoom) shim.sendRaw('MEDIA', 'SPEAKING', joinedRoom, 'voice', 'off');
    }, desiredMuted ? 0 : 450);
  }

  /** Re-apply local intent the engine resets on every (re)join. */
  function afterJoin(channel: string): void {
    joinedRoom = channel;
    if (pttEnabled) {
      try { engine.setPushToTalk(true); } catch { /* best-effort */ }
    }
    if (desiredMuted) {
      try { engine.setMuted(true); } catch { /* best-effort */ }
    }
    const fingerprint = engine.getLocalMediaE2eeFingerprint;
    if (typeof fingerprint === 'function') {
      emitLocal({ fingerprintPending: true });
      fingerprint.call(engine).then(
        (code) => emitLocal({ localFingerprint: code }),
        () => emitLocal({ localFingerprint: null }),
      );
    }
  }

  /** A failed join must not leave the server holding us in the room. */
  function abandonJoin(channel: string): void {
    const sent = !!joinSentFor && joinSentFor.toLowerCase() === channel.toLowerCase();
    const kind = engine.getLocalKind();
    if (engine.getCallState().callState !== 'idle') {
      try { engine.leaveRoom(channel); } catch { /* best-effort */ }
    }
    // leaveRoom only sends LEAVE while local media is held; a join that died
    // after `MEDIA JOIN` but before capture settled still owes the server one.
    if (sent && kind === null) shim.sendRaw('MEDIA', 'LEAVE', channel);
    joinedRoom = null;
  }

  /** Mirror of store.ts `_handleMessage`: EVENT MEDIA re-shape + NOTE MEDIA forward. */
  function forwardMedia(msg: IRCMessage): void {
    let params: string[] | null = null;
    let nick = msg.nick ?? '';
    if (msg.command === 'EVENT' && (msg.params[1] ?? '').toUpperCase() === 'MEDIA') {
      const p = msg.params;
      params = ['MEDIA', p[3] ?? '', p[2] ?? '', p[4] ?? '', ...p.slice(5)];
      nick = '';
    } else if ((msg.command === 'NOTE' || msg.command === 'WARN' || msg.command === 'FAIL') && msg.params[0] === 'MEDIA') {
      params = msg.params;
    }
    if (!params) return;
    const channel = params[1] ?? '';
    const verb = (params[2] ?? '').toUpperCase();
    if (verb === 'CAPTION' || verb === 'TRANSCRIPT') return;
    const e2ee = verb === 'E2EE-HANDSHAKE' || verb === 'E2EE-GROUPKEY' || verb === 'E2EE-DETACH';
    const presence = verb === 'JOIN' || verb === 'LEAVE' || verb === 'ROSTER'
      || verb === 'MUTE' || verb === 'UNMUTE' || verb === 'SPEAKING' || verb === 'SILENT'
      || verb === 'HAND' || verb === 'REACT' || e2ee;
    const actor = presence ? (params[3] || nick || '') : '';
    if (!validChannel(channel)) return;
    if (presence && !validActor(actor)) return;
    const routed = engineControl(verb, params);
    if (!routed) return;
    counters.mediaLinesForwarded += 1;
    try {
      engine.handleMediaMessage(actor, channel, routed.verb, routed.detail);
    } catch (err) {
      log(`voice: media line handler threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Server presence verbs → the engine's control vocabulary. The SolidJS
   * store forwarded the raw tail (`<nick> <kind>`), so the engine read the
   * nick as the kind (every JOIN became voice-only), took `MUTE … video`
   * (camera off) for a mic mute, and parsed `SPEAKING … voice` as silence.
   *   JOIN <kind>            → JOIN with the kind token
   *   MUTE video             → VIDEO_LEAVE (camera off; voice stays)
   *   UNMUTE video           → (nothing: video resumes with the next keyframe)
   *   MUTE|UNMUTE voice      → MUTE|UNMUTE
   *   SPEAKING|SILENT voice  → SPEAKING `<nick> 1|0`
   *   E2EE-*                 → payload after the actor (as before)
   * Everything else keeps the store's raw tail.
   */
  function engineControl(verb: string, params: string[]): { verb: string; detail: string } | null {
    const kind = (params[4] ?? '').toLowerCase();
    switch (verb) {
      case 'E2EE-HANDSHAKE':
      case 'E2EE-GROUPKEY':
      case 'E2EE-DETACH':
        return { verb, detail: params.slice(4).join(' ') };
      case 'JOIN':
        return { verb, detail: kind || 'voice' };
      case 'MUTE':
        return kind === 'video' ? { verb: 'VIDEO_LEAVE', detail: '' } : { verb, detail: '' };
      case 'UNMUTE':
        return kind === 'video' ? null : { verb, detail: '' };
      case 'SPEAKING':
      case 'SILENT':
        if (kind && kind !== 'voice' && kind !== 'audio') return null;
        return { verb: 'SPEAKING', detail: `${params[3] ?? ''} ${verb === 'SPEAKING' ? 1 : 0}` };
      default:
        return { verb, detail: params.slice(3).join(' ') };
    }
  }

  function trackIdentity(msg: IRCMessage): void {
    if (msg.command === '001' && typeof msg.params[0] === 'string' && msg.params[0]) {
      ourNick = msg.params[0];
    } else if (msg.command === 'NICK' && msg.nick && ourNick
      && msg.nick.toLowerCase() === ourNick.toLowerCase() && msg.params[0]) {
      ourNick = msg.params[0];
    } else if (msg.command === '900' && typeof msg.params[2] === 'string') {
      if (account.toLowerCase() !== msg.params[2].toLowerCase()) enrolledFor = '';
      account = msg.params[2];
    } else if (msg.command === '901') {
      account = '';
      enrolledFor = '';
    } else if (msg.command === 'NOTICE' && /^IDENTITY ADDED\b/.test(msg.params[1] ?? '')) {
      counters.identityEnrolled = true;
      const label = (msg.params[1] ?? '').slice('IDENTITY ADDED label='.length).trim();
      // Server-originated only (a user NOTICE carries nick!user@host).
      if (msg.nick === null && label && account && confirmedLabels.size < 16) confirmedLabels.set(label, account.toLowerCase());
      if (enrollWait && label === enrollWait.label) {
        const wait = enrollWait;
        enrollWait = null;
        wait.resolve();
      }
    } else if (msg.command === 'FAIL' && msg.params[0] === 'IDENTITY' && enrollWait) {
      const wait = enrollWait;
      enrollWait = null;
      wait.reject(new Error(`The server refused the call encryption key (${String(msg.params[1] ?? '').slice(0, 32)})`));
    } else if (msg.command === 'FAIL' && msg.params[0] === 'MEDIA') {
      counters.lastMediaFail = String(msg.params[1] ?? '').slice(0, 64);
    } else if (msg.command === '404' && /media|call/i.test(msg.params[msg.params.length - 1] ?? '')) {
      counters.framesRejected += 1;
    }
  }

  function named(message: string, name: string): Error {
    const err = new Error(message);
    err.name = name;
    return err;
  }

  function stopStream(stream: MediaStream | null): void {
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
  }

  function constraintsFor(video: boolean, preferred: boolean): MediaStreamConstraints {
    const audio: MediaTrackConstraints = {
      noiseSuppression: settings.noiseSuppression,
      echoCancellation: settings.echoCancellation,
      autoGainControl: true,
    };
    if (preferred && settings.inputDeviceId) audio.deviceId = { exact: settings.inputDeviceId };
    if (!video) return { audio, video: false };
    // A modest camera source: the engine encodes a small camera profile
    // (voice-engine.ts), so there is no point capturing more than this.
    const cam: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 12, max: 15 },
    };
    if (preferred && settings.cameraDeviceId) cam.deviceId = { exact: settings.cameraDeviceId };
    else cam.facingMode = 'user';
    return { audio, video: preferred ? cam : true };
  }

  /**
   * Start capture NOW — synchronously inside the click → port → adapter
   * call, before any await — so WebKit (iOS Safari, the installed PWA) still
   * sees the user gesture. A stale device id / over-strict ideal retries
   * once with bare constraints (the engine's own ladder, minus the gesture
   * loss). Null when no capture function was injected (the engine captures).
   */
  function capture(video: boolean): Promise<MediaStream | null> {
    const gum = options.getUserMedia;
    if (!gum) return Promise.resolve(null);
    let first: Promise<MediaStream>;
    try { first = gum(constraintsFor(video, true)); } catch (err) { return Promise.reject(err); }
    return first.catch((err: unknown) => {
      const name = err && typeof err === 'object' ? String((err as { name?: unknown }).name ?? '') : '';
      if (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError') {
        return gum(constraintsFor(video, false));
      }
      throw err;
    });
  }

  /**
   * Media E2EE handshakes are signed with the device key and the server only
   * admits them once that key is enrolled on the account (`IDENTITY ADD`,
   * idempotent per label). The Elm attribution flow enrolls only when the
   * node advertises ACCOUNTRESIDENCE, so the call path guarantees it here.
   */
  async function ensureEnrolled(): Promise<void> {
    if (!options.enrollIdentity) return;
    if (!account) {
      throw named('Calls are end-to-end encrypted and need an Onyx account. Sign in, then join.', 'AccountRequiredError');
    }
    if (enrolledFor === account.toLowerCase()) return;
    const claim = await options.enrollIdentity(account);
    if (!claim) throw named('This browser could not create the call encryption key.', 'EncryptionKeyError');
    // v3/rx-calls: the Elm client enrolls this same device key at sign-in;
    // when the server already confirmed it on this connection, skip the
    // round trip (this path stays as the belt-and-braces fallback).
    if (confirmedLabels.get(claim.label) === account.toLowerCase()) {
      enrolledFor = account.toLowerCase();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (enrollWait && enrollWait.label === claim.label) {
          enrollWait = null;
          reject(named('The server did not confirm the call encryption key.', 'EncryptionKeyError'));
        }
      }, 20000);
      const settle = (fn: () => void) => { clearTimeout(timer); fn(); };
      enrollWait = {
        label: claim.label,
        resolve: () => settle(resolve),
        reject: (err) => settle(() => reject(err)),
      };
      shim.sendRaw('IDENTITY', 'ADD', claim.label, claim.publicHex, claim.sig);
    });
    enrolledFor = account.toLowerCase();
  }

  async function join(channel: string, video: boolean, media: Promise<MediaStream | null>): Promise<void> {
    if (!open) {
      media.then(stopStream, () => {});
      throw new Error('Not connected');
    }
    joinSentFor = null;
    counters.lastError = ''; // v3/rx-calls: errors are per attempt
    joinSeq += 1;
    const seq = joinSeq;
    pendingJoin = { channel, seq };
    const cancelled = () => {
      if (cancelledSeq !== seq) return;
      throw named('The join was cancelled', 'AbortError');
    };
    let stream: MediaStream | null = null;
    try {
      stream = await media;
      cancelled();
      await ensureEnrolled();
      cancelled();
      if (video) await engine.joinVideo(channel, stream);
      else await engine.joinVoice(channel, stream);
    } catch (err) {
      if (pendingJoin && pendingJoin.seq === seq) pendingJoin = null;
      if (stream && engine.getLocalStream() !== stream) stopStream(stream);
      abandonJoin(channel);
      if (lastState === 'idle') options.audio?.setCallSession(false);
      // v3/rx-calls: the engine reports a missing codec through onError and
      // then rethrows; name it so the bridge classifies it (`codec`).
      if (classifyMediaError(counters.lastError) === 'codec' && !(err instanceof Error && err.name !== 'Error')) {
        throw named(counters.lastError || 'Codec unavailable', 'CodecError');
      }
      throw errorFrom(err, 'Voice join failed');
    }
    if (pendingJoin && pendingJoin.seq === seq) pendingJoin = null;
    if (engine.getCallState().callState !== 'in_call' || !engine.getLocalStream()) {
      abandonJoin(channel);
      throw new Error(counters.lastError || 'Voice join failed');
    }
    afterJoin(channel);
  }

  /** Gesture-path entry: unlock audio + start capture before any await. */
  function startJoin(channel: string, video: boolean): Promise<void> {
    try { counters.joinGesture = options.userActivation ? options.userActivation() : null; } catch { counters.joinGesture = null; }
    options.audio?.unlock();
    options.audio?.setCallSession(true);
    return join(channel, video, capture(video));
  }

  function scheduleRecover(reason: string): void {
    if (recoverTimer) return;
    recoverTimer = setTimeout(() => {
      recoverTimer = null;
      void recoverNow(reason);
    }, 400);
  }

  /** In a live call whose microphone capture is gone. */
  function needsRecovery(): boolean {
    if (!joinedRoom || lastState !== 'in_call' || recovering || !open) return false;
    const stream = engine.getLocalStream();
    return !(stream && stream.getAudioTracks().some((t) => t.readyState === 'live'));
  }

  /** Rejoin the room with fresh capture when the mic died under a live call. */
  async function recoverNow(reason: string, media?: Promise<MediaStream | null>): Promise<void> {
    options.audio?.resumeAll();
    const room = joinedRoom;
    if (!room || !needsRecovery()) {
      if (media) media.then(stopStream, () => {});
      return;
    }
    recovering = true;
    counters.recoveries += 1;
    log(`voice: recovering capture (${reason})`);
    try {
      await join(room, false, media ?? capture(false));
    } catch (err) {
      // Outside a gesture WebKit may refuse capture; the next tap retries
      // (voice-engine.ts routes taps to recover(…, true)).
      log(`voice: recovery deferred: ${err instanceof Error ? err.message : String(err)}`);
      // v3/rx-calls: a failed rejoin left the room — say why, once.
      if (lastState === 'idle') emit({ state: 'idle', nick: '', channel: null, errorKind: 'capture' });
    } finally {
      recovering = false;
    }
  }

  return {
    subscribe(push) {
      if (typeof push === 'function' && !subscribers.includes(push)) subscribers.push(push);
    },
    attachTransport(t) {
      transport = t && typeof t.sendLine === 'function' && typeof t.sendBinary === 'function' ? t : null;
    },
    transportOpen() {
      open = true;
      engine.setClient(shim);
    },
    transportClosed() {
      open = false;
      ourNick = '';
      account = '';
      enrolledFor = '';
      confirmedLabels.clear();
      if (enrollWait) {
        const wait = enrollWait;
        enrollWait = null;
        wait.reject(new Error('Disconnected'));
      }
      engine.setClient(null);
    },
    receiveLine(line) {
      if (typeof line !== 'string' || !line) return;
      counters.linesIn += 1;
      let msg: IRCMessage;
      try { msg = parseIRCMessage(line); } catch { return; }
      trackIdentity(msg);
      const relevant = msg.command === 'EVENT' || (msg.params[0] === 'MEDIA'
        && (msg.command === 'NOTE' || msg.command === 'WARN' || msg.command === 'FAIL'));
      if (!relevant) return;
      for (const handler of shim.extraMessageHandlers) {
        try { handler(msg); } catch { /* engine handler is best-effort */ }
      }
      forwardMedia(msg);
    },
    receiveMediaFrame(data) {
      const bytes = toBytes(data);
      if (!bytes || bytes.byteLength === 0) return;
      counters.framesIn += 1;
      counters.framesInBytes += bytes.byteLength;
      for (const handler of shim.binaryHandlers) {
        try { handler(bytes); } catch { /* one bad frame never stops the plane */ }
      }
    },
    joinVoice(channel, opts) {
      return startJoin(channel, !!(opts && opts.video));
    },
    leaveRoom(channel) {
      // v3/rx-calls: Leave while capture / enrollment is still running
      // cancels the join (it would otherwise land after the user left).
      if (pendingJoin && !joinedRoom && typeof channel === 'string' && pendingJoin.channel.toLowerCase() === channel.toLowerCase()) {
        cancelledSeq = pendingJoin.seq;
      }
      joinedRoom = null;
      engine.leaveRoom(channel);
    },
    setMuted(muted) {
      desiredMuted = !!muted;
      if (joinedRoom) engine.setMuted(desiredMuted);
      if (desiredMuted) announceSpeaking(false);
    },
    setDeafened(deafened) {
      engine.setDeafened(!!deafened);
    },
    setOutput(deviceId, volumePercent) {
      const volume = typeof volumePercent === 'number' && Number.isFinite(volumePercent)
        ? Math.max(0, Math.min(100, volumePercent)) : 80;
      settings = { ...settings, outputDeviceId: deviceId || null, outputVolume: volume };
      engine.setOutput(deviceId || null, volume);
    },
    applyVoiceSettings(raw) {
      settings = readSettings(raw, settings);
    },
    setPushToTalk(enabled) {
      pttEnabled = !!enabled;
      if (joinedRoom) engine.setPushToTalk(pttEnabled);
    },
    pttPress() { engine.pttPress(); },
    pttRelease() { engine.pttRelease(); },
    startCall() {
      // Onyx Server's MEDIA plane only takes channel targets (a nick is 403,
      // media_cmd.zig) and has no ring/accept verb, and the engine's 1:1 path
      // puts nothing on the wire — "ringing" would be a phantom. Fail closed.
      const err = new Error('Direct calls are not available on this server yet. Start a call in a room instead.');
      err.name = 'NotSupportedError';
      return Promise.reject(err);
    },
    acceptIncomingCall() {
      return engine.acceptIncomingCall();
    },
    rejectCall(peer) { engine.rejectCall(peer); },
    hangup(peer) { engine.hangup(peer); },
    async startCamera(channel) {
      const room = channel || joinedRoom || '';
      if (!room) return false;
      // Capture audio+video inside the click (WebKit gesture), then let the
      // engine re-announce the join with the camera stream.
      options.audio?.unlock();
      const media = capture(true);
      let stream: MediaStream | null = null;
      try {
        stream = await media;
        await engine.joinVideo(room, stream);
      } catch (err) {
        if (stream && engine.getLocalStream() !== stream) stopStream(stream);
        log(`voice: camera failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
      const ok = engine.getLocalKind() === 'video' && hasLocalVideo();
      if (ok) afterJoin(room);
      return ok;
    },
    stopCamera() {
      engine.stopCamera();
    },
    async startScreenShare(channel) {
      const room = channel || joinedRoom || '';
      if (!room || !platform.canShareScreen) return false;
      options.audio?.unlock();
      await engine.startScreenShare(room);
      const ok = engine.getLocalKind() === 'screen';
      if (ok) joinedRoom = room;
      return ok;
    },
    async stopScreenShare(channel) {
      const room = channel || joinedRoom || '';
      if (!room || engine.getLocalKind() !== 'screen') return;
      // The engine has no share-only stop: end the screen publisher, then
      // rejoin the room as voice so the call carries on.
      suppressIdle = true;
      try {
        engine.stopBroadcast(room);
      } finally {
        suppressIdle = false;
      }
      await join(room, false, capture(false));
    },
    getPeers() { return engine.getPeers(); },
    getScreenStream(nick) { return engine.getScreenStream(nick); },
    streamForTile(tile) {
      if (tile !== 'self' && tile !== 'self-screen') return null;
      const kind = engine.getLocalKind();
      const stream = engine.getLocalStream();
      if (!stream) return null;
      if (tile === 'self' && kind === 'video' && hasLocalVideo()) return stream;
      if (tile === 'self-screen' && kind === 'screen') return stream;
      return null;
    },
    recover(reason, gesture) {
      options.audio?.resumeAll();
      if (!needsRecovery()) return;
      const why = typeof reason === 'string' ? reason : 'recover';
      // Inside a tap: capture synchronously so WebKit honours the gesture.
      if (gesture) void recoverNow(why, capture(false));
      else scheduleRecover(why);
    },
    peerKeyChanged(nick) {
      if (typeof nick !== 'string' || !nick || nick.length > 256 || lastState === 'idle') return;
      emitLocal({ errorKind: 'peer_key', errorPeer: nick });
    },
    stats() {
      let net: Record<string, number>;
      try { net = engine.getNetworkStats ? engine.getNetworkStats() : {}; } catch { net = {}; }
      const call = engine.getCallState();
      return {
        ...counters,
        nick: ourNick,
        account,
        open,
        joinedRoom,
        callState: call.callState,
        callChannel: call.callChannel,
        localKind: engine.getLocalKind(),
        peers: [...engine.getPeers().values()].map((p) => ({
          nick: p.nick, kind: p.kind, speaking: p.speaking, muted: p.muted, hasVideo: p.hasVideo,
          /** A decoded camera frame exists (the tile has pixels to bind). */
          videoFrames: !!p.canvas,
        })),
        framesDecoded: typeof net.framesDecoded === 'number' ? net.framesDecoded : 0,
        framesEncoded: typeof net.framesEncoded === 'number' ? net.framesEncoded : 0,
        platform,
        audioStalled: options.audio ? options.audio.stalled() : 0,
        enrolled: enrolledFor !== '',
      };
    },
  };
}
