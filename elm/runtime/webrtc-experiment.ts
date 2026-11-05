// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerSnapshot, RequestContext } from './contracts';
import type { CaptureKind, CaptureLease } from './media-capture';

export interface WebRtcExperimentContext extends RequestContext {
  readonly conversationId: string;
}
export interface InteropObservation {
  readonly owner: OwnerSnapshot;
  readonly requestId: string;
  readonly state: 'completed' | 'connected-no-media' | 'unsupported' | 'failed' | 'cancelled' | 'stale-owner';
  readonly reason: string | null;
  readonly audioCodec: string | null;
  readonly videoCodec: string | null;
  readonly iceState: string;
  readonly dtlsState: string;
  readonly connectionState: string;
  readonly transportClass: 'udp' | 'tcp' | 'unknown';
  readonly inboundBytes: number | null;
  readonly inboundPackets: number | null;
  readonly decodedFrames: number | null;
  readonly durationMs: number;
  readonly scope: 'same-browser-local-loopback-only';
}
export interface WebRtcExperimentDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly claimCaptureLease: (captureRef: string, owner: OwnerSnapshot, room: string) => Promise<CaptureLease | null>;
  readonly onObservation: (observation: InteropObservation) => void;
  readonly rtcFactory?: () => RTCPeerConnection;
  readonly now?: () => number;
}

const SDP_MAX = 64 * 1024;
const CANDIDATE_MAX = 128;
const PHASE_MS = 10_000;
const TOTAL_MS = 30_000;
const AUDIO_CODEC = /^opus\/48000(?:\/2)?$/i;
const VIDEO_CODECS = ['vp8', 'vp9', 'av1', 'h264'];
const SDP_CONTROL = /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

/** Manual remote probes use an out-of-band fingerprint and no signaling URL. */
export function verifyOutOfBandFingerprint(expected: string, observed: string): boolean {
  const normalize = (value: string) => value.replace(/:/gu, '').toLowerCase();
  const expectedHex = normalize(expected);
  const observedHex = normalize(observed);
  return /^[0-9a-f]{64}$/u.test(expectedHex) && /^[0-9a-f]{64}$/u.test(observedHex) && expectedHex === observedHex;
}

function ownerSame(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef;
}
function wait<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return; }
    const timer = setTimeout(() => finish(() => reject(new Error('phase-timeout'))), ms);
    const aborted = () => finish(() => reject(new Error('cancelled')));
    const finish = (settle: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', aborted); settle(); };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
function inspectSdp(sdp: string, expectedKind: 'audio' | 'audio-video', role: 'offer' | 'answer'): { fingerprint: string; mids: string[]; audio: string; video: string | null } {
  if (sdp.length > SDP_MAX || SDP_CONTROL.test(sdp) || !sdp.startsWith('v=0\r\n')) throw new Error('invalid-sdp');
  if (/^a=crypto:/mi.test(sdp)) throw new Error('sdes-rejected');
  const fingerprints = [...sdp.matchAll(/^a=fingerprint:sha-256 ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\r?$/gmi)].map(match => match[1] ?? '');
  const fingerprint = fingerprints[0];
  if (fingerprints.length !== 1) throw new Error('conflicting-dtls-fingerprint');
  if (!fingerprint) throw new Error('dtls-fingerprint-missing');
  const mids = [...sdp.matchAll(/^a=mid:([^\r\n]+)$/gmi)].map(match => match[1] ?? '');
  if (!mids.length || mids.length > 2 || new Set(mids).size !== mids.length) throw new Error('invalid-mid-bundle');
  const ufrags = [...sdp.matchAll(/^a=ice-ufrag:([^\r\n]+)$/gmi)].map(match => match[1] ?? '');
  const passwords = [...sdp.matchAll(/^a=ice-pwd:([^\r\n]+)$/gmi)].map(match => match[1] ?? '');
  if (!ufrags.length || ufrags.some(item => item.length < 4 || item.length > 256) || !passwords.length || passwords.some(item => item.length < 22 || item.length > 256)) throw new Error('invalid-ice-credentials');
  if (!/^a=group:BUNDLE(?: [^\r\n]+)+$/mi.test(sdp)) throw new Error('invalid-dtls-role-or-bundle');
  const setups = [...sdp.matchAll(/^a=setup:(actpass|active|passive)\r?$/gmi)].map(match => match[1] ?? '');
  if (!setups.length || new Set(setups).size !== 1 || (role === 'offer' && setups[0] !== 'actpass') || (role === 'answer' && setups[0] === 'actpass')) throw new Error('invalid-dtls-role-or-bundle');
  const sections = sdp.split(/(?=^m=)/mi).filter(section => section.startsWith('m='));
  const audioSection = sections.find(section => /^m=audio\s/u.test(section));
  const videoSection = sections.find(section => /^m=video\s/u.test(section));
  const payloads = (section: string | undefined, kind: string): string[] => {
    const match = section ? new RegExp(`^m=${kind} (\\d+) UDP/TLS/RTP/SAVPF ([^\\r\\n]+)`, 'mi').exec(section) : null;
    if (!match || match[1] === '0' || !/^a=rtcp-mux\r?$/mi.test(section ?? '')) throw new Error(`${kind}-rtp-unavailable`);
    return (match[2] ?? '').split(/\s+/u);
  };
  const audioPayloads = payloads(audioSection, 'audio');
  const videoPayloadList = expectedKind === 'audio-video' ? payloads(videoSection, 'video') : [];
  const hasOpus = audioPayloads.some(payload => new RegExp(`^a=rtpmap:${payload} opus/48000(?:/2)?\\r?$`, 'mi').test(audioSection ?? ''));
  if (!hasOpus) throw new Error('opus-48k-unavailable');
  const videoCodec = videoPayloadList.map(payload => {
    const name = new RegExp(`^a=rtpmap:${payload} ([^/]+)/`, 'mi').exec(videoSection ?? '')?.[1]?.toLowerCase() ?? '';
    return VIDEO_CODECS.includes(name) ? name : '';
  }).find(Boolean) ?? null;
  if (expectedKind === 'audio-video' && !videoCodec) throw new Error('supported-video-codec-unavailable');
  return { fingerprint, mids, audio: 'opus/48000', video: videoCodec };
}

/** Bounded native RTCPeerConnection loopback probe; never used by normal calls. */
export function createWebRtcExperiment(deps: WebRtcExperimentDependencies): {
  runLocal(input: { readonly context: WebRtcExperimentContext; readonly captureRef: string; readonly kind: 'audio' | 'audio-video' }): Promise<InteropObservation>;
  stop(context: WebRtcExperimentContext): void;
  dispose(): void;
} {
  const now = deps.now ?? (() => performance.now());
  const factory = deps.rtcFactory ?? (() => new RTCPeerConnection({ iceServers: [] }));
  let active: { readonly context: WebRtcExperimentContext; readonly controller: AbortController; readonly peers: Set<RTCPeerConnection>; readonly streams: Set<MediaStream>; readonly elements: Set<HTMLMediaElement>; readonly listeners: Array<() => void>; readonly timers: Set<ReturnType<typeof setTimeout>>; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  let disposed = false;
  const current = (context: WebRtcExperimentContext, generation: AbortSignal) => !disposed && !generation.aborted
    && deps.isCurrent(context.owner) && ownerSame(deps.ownerSnapshot(), context.owner)
    && active?.context.requestId === context.requestId;
  const cleanup = (run: NonNullable<typeof active>) => {
    clearTimeout(run.timer);
    run.controller.abort();
    for (const timer of run.timers) clearTimeout(timer);
    run.timers.clear();
    for (const remove of run.listeners) remove();
    run.listeners.length = 0;
    for (const peer of run.peers) { peer.onicecandidate = null; peer.ontrack = null; peer.onconnectionstatechange = null; try { peer.close(); } catch { /* already closed */ } }
    for (const element of run.elements) { element.pause(); element.srcObject = null; element.remove(); }
    for (const stream of run.streams) for (const track of stream.getTracks()) { try { track.stop(); } catch { /* stop best effort */ } }
  };
  const emit = (observation: InteropObservation) => { try { deps.onObservation(observation); } catch { /* observers isolated */ } };
  const runLocal = async (input: { readonly context: WebRtcExperimentContext; readonly captureRef: string; readonly kind: 'audio' | 'audio-video' }): Promise<InteropObservation> => {
    const { context } = input;
    const started = now();
    const unsupported = (reason: string, state: InteropObservation['state'] = 'unsupported'): InteropObservation => ({ owner: context.owner, requestId: context.requestId, state, reason, audioCodec: null, videoCodec: null, iceState: 'unknown', dtlsState: 'unknown', connectionState: 'unknown', transportClass: 'unknown', inboundBytes: null, inboundPackets: null, decodedFrames: null, durationMs: Math.max(0, now() - started), scope: 'same-browser-local-loopback-only' });
    if (disposed || !context.conversationId || !deps.isCurrent(context.owner) || !ownerSame(deps.ownerSnapshot(), context.owner)) return unsupported('stale-owner', 'stale-owner');
    if (typeof RTCPeerConnection === 'undefined' && !deps.rtcFactory) return unsupported('api-unavailable');
    if (active) { cleanup(active); active = null; }
    const controller = new AbortController();
    const run = { context, controller, peers: new Set<RTCPeerConnection>(), streams: new Set<MediaStream>(), elements: new Set<HTMLMediaElement>(), listeners: [] as Array<() => void>, timers: new Set<ReturnType<typeof setTimeout>>(), timer: setTimeout(() => controller.abort(), TOTAL_MS) };
    active = run;
    let lease: CaptureLease | null = null;
    let audioCodec: string | null = null;
    let videoCodec: string | null = null;
    let iceState = 'new'; let dtlsState = 'new'; let connectionState = 'new';
    try {
      const claimPromise = deps.claimCaptureLease(input.captureRef, context.owner, context.conversationId);
      void claimPromise.then(late => {
        if (!controller.signal.aborted || !late) return;
        for (const ownedTrack of late.stream.getTracks()) { try { ownedTrack.stop(); } catch { /* best effort */ } }
        void late.audioContext?.close().catch(() => {});
      }, () => {});
      lease = await wait(claimPromise, TOTAL_MS, controller.signal);
      if (!current(context, controller.signal)) throw new Error('stale-owner');
      if (!lease) throw new Error('capture-unavailable');
      const source = lease.stream;
      const clones: MediaStreamTrack[] = [];
      for (const track of source.getTracks()) {
        if ((track.kind === 'audio') || (input.kind === 'audio-video' && track.kind === 'video')) {
          const clone = track.clone(); clones.push(clone); run.streams.add(new MediaStream([clone]));
        }
      }
      if (!clones.some(track => track.kind === 'audio') || (input.kind === 'audio-video' && !clones.some(track => track.kind === 'video'))) throw new Error('requested-capture-track-missing');
      const localStream = new MediaStream(clones); run.streams.add(localStream);
      const left = factory(); run.peers.add(left);
      const right = factory(); run.peers.add(right);
      left.onicecandidate = event => { if (event.candidate) { /* native local candidate collection is bounded below */ } };
      right.onicecandidate = event => { if (event.candidate) { /* no candidate values enter telemetry */ } };
      let candidateCountLeft = 0; let candidateCountRight = 0;
      const countLeft = () => { candidateCountLeft++; if (candidateCountLeft > CANDIDATE_MAX) controller.abort(); };
      const countRight = () => { candidateCountRight++; if (candidateCountRight > CANDIDATE_MAX) controller.abort(); };
      left.onicecandidate = event => { if (event.candidate) countLeft(); };
      right.onicecandidate = event => { if (event.candidate) countRight(); };
      const consumeTrack = (event: RTCTrackEvent) => {
        const remote = event.streams[0];
        if (!current(context, controller.signal) || !remote || typeof document === 'undefined') return;
        run.streams.add(remote);
        const element = document.createElement(event.track.kind === 'audio' ? 'audio' : 'video');
        element.autoplay = true; element.muted = true;
        if (element instanceof HTMLVideoElement) element.playsInline = true;
        element.srcObject = remote;
        run.elements.add(element);
        void element.play().catch(() => {});
      };
      left.ontrack = consumeTrack;
      right.ontrack = consumeTrack;
      for (const track of clones) left.addTrack(track, localStream);
      const audioCaps = RTCRtpSender.getCapabilities('audio')?.codecs ?? [];
      const receiveAudioCaps = RTCRtpReceiver.getCapabilities('audio')?.codecs ?? [];
      const opus = audioCaps.find(codec => AUDIO_CODEC.test(`${codec.mimeType.split('/').at(-1)}/${codec.clockRate}${codec.channels ? `/${codec.channels}` : ''}`)
        && receiveAudioCaps.some(other => other.mimeType.toLowerCase() === codec.mimeType.toLowerCase() && other.clockRate === codec.clockRate));
      if (!opus) throw new Error('opus-48k-unavailable');
      if (input.kind === 'audio-video') {
        const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
        const receiveCaps = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
        const selected = caps.find(codec => VIDEO_CODECS.includes(codec.mimeType.split('/').at(-1)?.toLowerCase() ?? '')
          && receiveCaps.some(other => other.mimeType.toLowerCase() === codec.mimeType.toLowerCase() && other.clockRate === codec.clockRate));
        if (!selected) throw new Error('supported-video-codec-unavailable');
      }
      const phase = async <T>(promise: Promise<T>) => wait(promise, PHASE_MS, controller.signal);
      const offer = await phase(left.createOffer());
      if (!current(context, controller.signal)) throw new Error('stale-owner');
      if (!offer.sdp || offer.sdp.length > SDP_MAX) throw new Error('sdp-size-limit');
      await phase(left.setLocalDescription(offer));
      await phase(new Promise<void>((resolve, reject) => {
        if (left.iceGatheringState === 'complete') { resolve(); return; }
        const timeout = setTimeout(() => reject(new Error('ice-gathering-timeout')), PHASE_MS); run.timers.add(timeout);
        const listener = () => { if (left.iceGatheringState === 'complete') { clearTimeout(timeout); run.timers.delete(timeout); left.removeEventListener('icegatheringstatechange', listener); resolve(); } };
        left.addEventListener('icegatheringstatechange', listener); run.listeners.push(() => left.removeEventListener('icegatheringstatechange', listener));
      }));
      if (!current(context, controller.signal)) throw new Error('stale-owner');
      const localOffer = left.localDescription?.sdp ?? '';
      const offerFacts = inspectSdp(localOffer, input.kind, 'offer');
      if (localOffer.length > SDP_MAX) throw new Error('sdp-size-limit');
      await phase(right.setRemoteDescription(left.localDescription!));
      const answer = await phase(right.createAnswer());
      if (!answer.sdp || answer.sdp.length > SDP_MAX) throw new Error('sdp-size-limit');
      await phase(right.setLocalDescription(answer));
      await phase(new Promise<void>((resolve, reject) => {
        if (right.iceGatheringState === 'complete') { resolve(); return; }
        const timeout = setTimeout(() => reject(new Error('ice-gathering-timeout')), PHASE_MS); run.timers.add(timeout);
        const listener = () => { if (right.iceGatheringState === 'complete') { clearTimeout(timeout); run.timers.delete(timeout); right.removeEventListener('icegatheringstatechange', listener); resolve(); } };
        right.addEventListener('icegatheringstatechange', listener); run.listeners.push(() => right.removeEventListener('icegatheringstatechange', listener));
      }));
      if (!current(context, controller.signal)) throw new Error('stale-owner');
      const localAnswer = right.localDescription?.sdp ?? '';
      const answerFacts = inspectSdp(localAnswer, input.kind, 'answer');
      if (offerFacts.fingerprint === answerFacts.fingerprint) throw new Error('loopback-dtls-fingerprint-not-distinct');
      await phase(left.setRemoteDescription(right.localDescription!));
      const connected = await phase(new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!current(context, controller.signal)) { reject(new Error('stale-owner')); return; }
          if (left.connectionState === 'connected' && right.connectionState === 'connected') { resolve(); return; }
          if (['failed', 'closed'].includes(left.connectionState) || ['failed', 'closed'].includes(right.connectionState)) reject(new Error('connection-failed'));
        };
        left.addEventListener('connectionstatechange', check); right.addEventListener('connectionstatechange', check);
        run.listeners.push(() => left.removeEventListener('connectionstatechange', check), () => right.removeEventListener('connectionstatechange', check));
        check();
      }));
      void connected;
      if (!current(context, controller.signal)) throw new Error('stale-owner');
      iceState = `${left.iceConnectionState}/${right.iceConnectionState}`;
      connectionState = `${left.connectionState}/${right.connectionState}`;
      let stats: RTCStatsReport | null = null;
      const mediaDeadline = Math.min(started + TOTAL_MS, now() + 3_000);
      do {
        if (!current(context, controller.signal)) throw new Error('stale-owner');
        stats = await phase(right.getStats());
        const inbound = [...stats.values()].filter(report => report.type === 'inbound-rtp' && !report.isRemote);
        if (inbound.some(report => Number(report.packetsReceived ?? 0) > 0) && (input.kind === 'audio' || inbound.some(report => report.kind === 'video' && Number(report.framesDecoded ?? 0) > 0))) break;
        await phase(new Promise(resolve => setTimeout(resolve, 100)));
      } while (now() < mediaDeadline);
      if (!stats) throw new Error('stats-unavailable');
      let inboundBytes = 0; let inboundPackets = 0; let observed = false;
      let decodedFrames = 0; let decodedFramesObserved = false;
      let observedAudioCodec: string | null = null;
      let observedVideoCodec: string | null = null;
      let transportClass: InteropObservation['transportClass'] = 'unknown';
      const selectedPairIds = new Set<string>();
      stats.forEach(report => {
        if (report.type === 'transport' && typeof report.selectedCandidatePairId === 'string') selectedPairIds.add(report.selectedCandidatePairId);
      });
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && selectedPairIds.has(report.id)) {
          const local = stats.get(report.localCandidateId ?? '');
          const protocol = local?.protocol;
          transportClass = protocol === 'udp' ? 'udp' : protocol === 'tcp' ? 'tcp' : 'unknown';
        }
        if (report.type === 'inbound-rtp' && !report.isRemote) {
          observed = true; inboundBytes += Number(report.bytesReceived ?? 0); inboundPackets += Number(report.packetsReceived ?? 0);
          if (typeof report.framesDecoded === 'number') { decodedFrames += report.framesDecoded; decodedFramesObserved = true; }
          const codecReport = typeof report.codecId === 'string' ? stats.get(report.codecId) : null;
          const mime = typeof codecReport?.mimeType === 'string' ? codecReport.mimeType.toLowerCase() : null;
          if (mime?.startsWith('audio/')) observedAudioCodec = mime === 'audio/opus' && codecReport?.clockRate === 48000 ? 'opus/48000' : mime;
          if (mime?.startsWith('video/')) observedVideoCodec = mime.slice('video/'.length);
        }
      });
      if (observedAudioCodec) audioCodec = observedAudioCodec;
      if (observedVideoCodec) videoCodec = observedVideoCodec;
      const dtlsStates = [...left.getSenders(), ...right.getSenders()].map(sender => sender.transport?.state).filter((value): value is RTCDtlsTransportState => !!value);
      dtlsState = dtlsStates.length ? [...new Set(dtlsStates)].join('/') : 'unavailable';
      const mediaObserved = observed && inboundPackets > 0 && (input.kind === 'audio' || (decodedFramesObserved && decodedFrames > 0));
      const observation: InteropObservation = { owner: context.owner, requestId: context.requestId, state: mediaObserved ? 'completed' : 'connected-no-media', reason: mediaObserved ? null : 'connected-without-inbound-media', audioCodec, videoCodec, iceState, dtlsState, connectionState, transportClass, inboundBytes: observed ? inboundBytes : null, inboundPackets: observed ? inboundPackets : null, decodedFrames: decodedFramesObserved ? decodedFrames : null, durationMs: Math.max(0, now() - started), scope: 'same-browser-local-loopback-only' };
      emit(observation); return observation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'experiment-failed';
      const state: InteropObservation['state'] = message === 'stale-owner' ? 'stale-owner' : message === 'cancelled' || controller.signal.aborted ? 'cancelled' : 'failed';
      const observation = { ...unsupported(message, state), audioCodec, videoCodec, iceState, dtlsState, connectionState };
      emit(observation); return observation;
    } finally {
      if (lease) {
        for (const track of lease.stream.getTracks()) { try { track.stop(); } catch { /* owned capture retired */ } }
        await lease.audioContext?.close().catch(() => {});
      }
      cleanup(run);
      if (active === run) active = null;
    }
  };
  return {
    runLocal,
    stop(context) { if (active?.context.requestId === context.requestId && ownerSame(active.context.owner, context.owner)) { cleanup(active); active = null; } },
    dispose() { if (disposed) return; disposed = true; if (active) cleanup(active); active = null; },
  };
}
