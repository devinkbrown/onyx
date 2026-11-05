import { parseIRCMessage } from '../../../src/lib/irc/parser';
import { validateClientLine } from '../../runtime/client-line-validator';

type ProbeMode = 'standards' | 'cadence-dtls';
type FailureCode = 'NO_CODECS' | 'NO_COMMON_CODEC' | 'BAD_FINGERPRINT' | 'DTLS_UNAVAILABLE'
  | 'SECURE_SIGNALING_REQUIRED' | 'TRANSPORT_UNAVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'UNSUPPORTED' | 'OTHER';
type ProbeStage = 'preflight' | 'wss-open' | 'capability-auth' | 'registration' | 'room-join' | 'browser-offer'
  | 'server-request' | 'server-reply' | 'transport-validation' | 'cleanup';
type ProbeResult = {
  readonly schemaVersion: 1;
  readonly mode: ProbeMode;
  readonly status: 'server-refused' | 'signaling-only' | 'unknown' | 'blocked';
  readonly stage: ProbeStage;
  readonly serverFailureCode: FailureCode | null;
  readonly responseFamily: 'prefixless-fail' | 'server-notice-fail' | 'server-event-offer-ack' | 'server-event-transport' | 'timeout' | 'none';
  readonly requestedCodecs: readonly string[];
  readonly browserCodecs: readonly string[];
  readonly browserFingerprintGenerated: boolean;
  readonly browserFingerprintSent: boolean;
  readonly fingerprintAlgorithm: 'sha-256' | null;
  readonly fingerprintOctets: number | null;
  readonly serverFingerprintFormatValid: boolean | null;
  readonly mediaInterop: false;
  readonly decodedAudioPackets: null;
  readonly decodedVideoFrames: null;
  readonly errorCode: string | null;
};
type ProbeConfig = {
  readonly wsUrl: string;
  readonly account: string;
  readonly password: string;
  readonly room: string;
  readonly mode: ProbeMode;
};
type OwnerContext = {
  readonly networkId: 'onyx-e84-isolated-lab';
  readonly accountId: string;
  readonly endpoint: string;
  readonly issuer: string;
  readonly nick: string;
  readonly physicalRef: string;
  readonly connectionGeneration: 1;
  readonly requestId: string;
  readonly room: string;
};
type PrivateMessage = ReturnType<typeof parseIRCMessage>;
type InboxWaiter = {
  readonly predicate: (message: PrivateMessage) => boolean;
  readonly resolve: (message: PrivateMessage) => void;
  readonly reject: (error: Error) => void;
  timer: number;
};
type ClassifiedReply =
  | { readonly kind: 'failure'; readonly code: FailureCode; readonly family: 'prefixless-fail' | 'server-notice-fail' }
  | { readonly kind: 'offer-ack'; readonly family: 'server-event-offer-ack' }
  | { readonly kind: 'transport'; readonly transport: PrivateTransport; readonly family: 'server-event-transport' }
  | null;
type PrivateTransport = {
  readonly ufrag: string;
  readonly password: string;
  readonly candidateHost: string;
  readonly candidatePort: number;
  readonly fingerprint: string;
  readonly setup: 'passive';
};
type HarnessWindow = Window & {
  __runOnyxE84Probe?: (config: ProbeConfig) => Promise<ProbeResult>;
  __testOnyxE84Parser?: () => Readonly<Record<string, boolean>>;
};

const FAILURE_CODES = new Set<FailureCode>([
  'NO_CODECS', 'NO_COMMON_CODEC', 'BAD_FINGERPRINT', 'DTLS_UNAVAILABLE', 'SECURE_SIGNALING_REQUIRED',
  'TRANSPORT_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'UNSUPPORTED', 'OTHER',
]);
const MAX_IRC_FRAME = 8191;
const MAX_BUFFERED_MESSAGES = 256;
const PHASE_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 45_000;

function safeFailureCode(raw: string | undefined): FailureCode {
  return raw && FAILURE_CODES.has(raw as FailureCode) ? raw as FailureCode : 'OTHER';
}

function isOwnedSaslChallenge(message: PrivateMessage, ownerCurrent: () => boolean): boolean {
  return ownerCurrent() && message.command === 'AUTHENTICATE' && message.prefix === null
    && message.params.length === 1 && message.params[0] === '+';
}

function finiteErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.name : '';
  return ['NotSupportedError', 'OperationError', 'InvalidStateError', 'SecurityError'].includes(value)
    ? `browser-${value.replace('Error', '').toLowerCase()}`
    : 'browser-probe-failed';
}

function failureResult(mode: ProbeMode, stage: ProbeStage, errorCode: string, requestedCodecs: string[] = [], browserCodecs: string[] = [], generated = false, sent = false): ProbeResult {
  return {
    schemaVersion: 1, mode, status: 'unknown', stage, serverFailureCode: null, responseFamily: 'none',
    requestedCodecs, browserCodecs, browserFingerprintGenerated: generated, browserFingerprintSent: sent,
    fingerprintAlgorithm: generated ? 'sha-256' : null, fingerprintOctets: generated ? 32 : null,
    serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null, decodedVideoFrames: null, errorCode,
  };
}

function validateConfig(config: ProbeConfig): void {
  if (!config || !['standards', 'cadence-dtls'].includes(config.mode)) throw new Error('invalid-config');
  if (typeof config.account !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{5,31}$/u.test(config.account)) throw new Error('invalid-config');
  if (typeof config.password !== 'string' || config.password.length < 8 || config.password.length > 128 || /[\0\r\n]/u.test(config.password)) throw new Error('invalid-config');
  if (typeof config.room !== 'string' || !/^#e84-[a-f0-9]{12}$/u.test(config.room)) throw new Error('invalid-config');
  const url = new URL(config.wsUrl);
  if (url.protocol !== 'wss:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash || url.search || url.pathname !== '/') {
    throw new Error('invalid-config');
  }
}

function sendValidated(socket: WebSocket, line: string, ownerCurrent: () => boolean): void {
  if (!ownerCurrent() || socket.readyState !== WebSocket.OPEN) throw new Error('owner-unavailable');
  const valid = validateClientLine(line);
  if (!valid.valid || valid.byteLength > MAX_IRC_FRAME) throw new Error('invalid-client-line');
  socket.send(line);
}

function fingerprintFromSdp(sdp: string): string {
  if (sdp.length > 64 * 1024 || /\0/u.test(sdp)) throw new Error('invalid-local-sdp');
  for (let index = 0; index < sdp.length; index += 1) {
    if (sdp.charCodeAt(index) === 0x0d && sdp.charCodeAt(index + 1) !== 0x0a) throw new Error('invalid-local-sdp');
  }
  const lines = sdp.replace(/\r\n/gu, '\n').split('\n');
  if (lines.some(line => /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(line))) throw new Error('invalid-local-sdp');
  const fingerprints: string[] = [];
  for (const line of lines) {
    if (!line.toLowerCase().startsWith('a=fingerprint:sha-256')) continue;
    const match = line.match(/^a=fingerprint:sha-256[ \t]+([A-Fa-f0-9:]+)[ \t]*$/iu);
    if (!match) throw new Error('invalid-fingerprint');
    fingerprints.push(normalizeFingerprint(match[1] ?? ''));
  }
  if (fingerprints.length < 1) throw new Error('browser-fingerprint-unavailable');
  const values = new Set(fingerprints);
  if (values.size !== 1) throw new Error('browser-fingerprint-conflict');
  return [...values][0] ?? '';
}

function normalizeFingerprint(value: string): string {
  const octets = value.split(':');
  if (octets.length !== 32 || octets.some(octet => !/^[a-fA-F0-9]{2}$/u.test(octet))) throw new Error('invalid-fingerprint');
  return octets.map(octet => octet.toUpperCase()).join(':');
}

function fingerprintOctets(value: string): number | null {
  try { normalizeFingerprint(value); return 32; } catch { return null; }
}

function parsePrivateTransport(details: string): PrivateTransport | null {
  if (!details || details.length > 1024 || /[\0\r\n]/u.test(details) || /(?:^|\s)(?:srtp=|a=crypto)/iu.test(details)) return null;
  const tokens = details.split(/\s+/u);
  if (tokens.length !== 6 || tokens.some(token => token.length === 0 || token.length > 256)) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const equals = token.indexOf('=');
    if (equals <= 0) {
      if (index === 4 && tokens[index - 1] === 'fingerprint=sha-256') continue;
      return null;
    }
    const key = token.slice(0, equals);
    const value = token.slice(equals + 1);
    if (values.has(key)) return null;
    values.set(key, value);
  }
  const ufrag = values.get('ufrag');
  const password = values.get('pwd');
  const candidate = values.get('candidate');
  const fingerprintAlgorithm = values.get('fingerprint');
  const setup = values.get('setup');
  // The actual formatter splits the SHA-256 digest into the token after fingerprint=sha-256.
  const digestIndex = tokens.findIndex(token => token === 'fingerprint=sha-256');
  const digest = digestIndex >= 0 ? tokens[digestIndex + 1] : undefined;
  if (!ufrag || !/^[A-Za-z0-9+/_-]{1,256}$/u.test(ufrag) || !password || !/^[A-Za-z0-9+/_-]{1,256}$/u.test(password)
    || !candidate || fingerprintAlgorithm !== 'sha-256' || !digest || setup !== 'passive' || values.size !== 5) return null;
  const candidateMatch = candidate.match(/^(.+):([0-9]{1,5})$/u);
  if (!candidateMatch) return null;
  const candidateHost = candidateMatch[1] ?? '';
  const candidatePort = Number(candidateMatch[2]);
  if (!isIpAddress(candidateHost) || !Number.isInteger(candidatePort) || candidatePort < 1 || candidatePort > 65535) return null;
  let fingerprint: string;
  try { fingerprint = normalizeFingerprint(digest); } catch { return null; }
  return Object.freeze({ ufrag, password, candidateHost, candidatePort, fingerprint, setup: 'passive' });
}

function isIpAddress(host: string): boolean {
  if (host.length > 64 || /[\0\r\n%]/u.test(host)) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host)) return host.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
  if (!host.includes(':') || !/^[0-9a-fA-F:]+$/u.test(host)) return false;
  if (host.includes(':::')) return false;
  const pieces = host.split(':');
  const double = host.includes('::');
  if (pieces.some(part => part.length > 4)) return false;
  const nonEmpty = pieces.filter(Boolean).length;
  return double ? nonEmpty < 8 : nonEmpty === 8;
}

function sameLabel(message: PrivateMessage, expectedLabel: string | null): boolean {
  const actual = message.tags.label;
  if (actual === undefined) return true;
  return expectedLabel !== null && actual === expectedLabel;
}

function classifyPrivateReply(raw: string, context: { issuer: string; nick: string; room: string; label: string | null }): ClassifiedReply {
  if (raw.length > MAX_IRC_FRAME || /[\0\r\n]/u.test(raw)) return null;
  const message = parseIRCMessage(raw);
  if (!sameLabel(message, context.label)) return null;
  if (message.command === 'FAIL' && message.prefix === null && message.params[0] === 'MEDIA') {
    const code = safeFailureCode(message.params[1]);
    return { kind: 'failure', code, family: 'prefixless-fail' };
  }
  if (message.command === 'WARN' && message.prefix === null && message.params[0] === 'MEDIA') {
    const code = safeFailureCode(message.params[1]);
    return { kind: 'failure', code, family: 'prefixless-fail' };
  }
  if (message.command === 'NOTICE' && message.prefix === context.issuer && message.params.length === 2
    && message.params[0]?.toLowerCase() === context.nick.toLowerCase()) {
    const body = message.params[1] ?? '';
    const fail = body.match(/^(FAIL|WARN) MEDIA ([A-Z0-9_]{1,40}):/u);
    if (fail) return { kind: 'failure', code: safeFailureCode(fail[2]), family: 'server-notice-fail' };
  }
  if (message.command !== 'EVENT' || message.prefix !== context.issuer || message.params[0]?.toLowerCase() !== context.nick.toLowerCase()
    || message.params[1] !== 'MEDIA' || message.params[3] !== context.room) return null;
  const action = message.params[2];
  if (action === 'OFFER-ACK') return { kind: 'offer-ack', family: 'server-event-offer-ack' };
  if (action !== 'TRANSPORT') return null;
  const details = message.params.slice(4).join(' ');
  const transport = parsePrivateTransport(details);
  return transport ? { kind: 'transport', transport, family: 'server-event-transport' } : null;
}

function createInbox(socket: WebSocket, ownerCurrent: () => boolean): {
  waitFor(predicate: (message: PrivateMessage) => boolean, timeoutMs: number): Promise<PrivateMessage>;
  send(line: string): void;
  close(): void;
} {
  const messages: PrivateMessage[] = [];
  const waiters = new Set<InboxWaiter>();
  let failed: string | null = null;
  const clearWaiter = (waiter: InboxWaiter) => { clearTimeout(waiter.timer); waiters.delete(waiter); };
  const rejectAll = (code: string) => {
    failed = code;
    for (const waiter of [...waiters]) { clearWaiter(waiter); waiter.reject(new Error(code)); }
  };
  const onMessage = (event: MessageEvent<string>) => {
    if (typeof event.data !== 'string' || event.data.length > MAX_IRC_FRAME || !ownerCurrent()) return;
    for (const raw of event.data.split(/\r?\n/u)) {
      if (!raw) continue;
      if (raw.length > MAX_IRC_FRAME) { rejectAll('server-line-too-long'); return; }
      const message = parseIRCMessage(raw);
      if (message.command === 'PING') {
        const token = message.params.at(-1);
        if (token && !/[\0\r\n]/u.test(token)) {
          try { sendValidated(socket, `PONG :${token}`, ownerCurrent); } catch { rejectAll('transport-unavailable'); }
        }
      }
      if (message.prefix && !message.prefix.includes('!') && !message.prefix.includes('@')) {
        // The first server prefix is learned from actual source traffic and is later pinned to 001.
        (inboxState as { issuer: string | null }).issuer ??= message.prefix;
      }
      if (messages.length >= MAX_BUFFERED_MESSAGES) { rejectAll('server-message-limit'); return; }
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(message)) continue;
        clearWaiter(waiter);
        const messageIndex = messages.indexOf(message);
        if (messageIndex >= 0) messages.splice(messageIndex, 1);
        waiter.resolve(message);
      }
    }
  };
  const onClose = () => rejectAll('websocket-closed');
  const onError = () => rejectAll('websocket-error');
  const inboxState = { issuer: null as string | null };
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', onError);
  return {
    waitFor(predicate, timeoutMs) {
      if (!ownerCurrent()) return Promise.reject(new Error('owner-retired'));
      const existingIndex = messages.findIndex(predicate);
      if (existingIndex >= 0) return Promise.resolve(messages.splice(existingIndex, 1)[0]!);
      if (failed) return Promise.reject(new Error(failed));
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: 0 };
        waiter.timer = window.setTimeout(() => { clearWaiter(waiter); reject(new Error('response-timeout')); }, timeoutMs);
        waiters.add(waiter);
      });
    },
    send(line) { sendValidated(socket, line, ownerCurrent); },
    close() {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      rejectAll('harness-closed');
      messages.length = 0;
      inboxState.issuer = null;
    },
  };
}

function randomToken(bytes = 16): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function registerProtectedOwner(config: ProbeConfig, inbox: ReturnType<typeof createInbox>, ownerCurrent: () => boolean): Promise<OwnerContext> {
  inbox.send('CAP LS 302');
  const capLines: PrivateMessage[] = [];
  let cap: PrivateMessage;
  do {
    cap = await inbox.waitFor(message => message.command === 'CAP' && message.params[1] === 'LS', PHASE_TIMEOUT_MS);
    capLines.push(cap);
  } while (cap.params[2] === '*');
  const capabilityText = capLines.map(message => message.params.at(-1) ?? '').join(' ');
  const saslAdvert = capabilityText.match(/(?:^|\s)sasl=([^\s]+)/iu)?.[1] ?? '';
  if (!saslAdvert.split(',').some(mechanism => mechanism.toUpperCase() === 'PLAIN')) throw new Error('sasl-unavailable');
  const issuer = cap.prefix;
  if (!issuer || issuer.includes('!') || issuer.includes('@')) throw new Error('server-issuer-unavailable');

  inbox.send('CAP REQ :sasl');
  const capReply = await inbox.waitFor(message => message.command === 'CAP' && ['ACK', 'NAK'].includes(message.params[1] ?? ''), PHASE_TIMEOUT_MS);
  const acknowledgedCapabilities = capReply.params.at(-1)?.split(/\s+/u).map(value => value.toLowerCase()) ?? [];
  if (capReply.prefix !== issuer || capReply.params[1] !== 'ACK'
    || !acknowledgedCapabilities.some(value => value === 'sasl' || value.startsWith('sasl='))) throw new Error('sasl-unavailable');

  inbox.send('AUTHENTICATE PLAIN');
  const challenge = await inbox.waitFor(message => message.command === 'AUTHENTICATE', PHASE_TIMEOUT_MS);
  if (!isOwnedSaslChallenge(challenge, ownerCurrent)) throw new Error('sasl-challenge-invalid');
  const payload = btoa(`\0${config.account}\0${config.password}`);
  if (payload.length > 400) throw new Error('sasl-payload-too-long');
  inbox.send(`AUTHENTICATE ${payload}`);
  const saslResult = await inbox.waitFor(message => message.command === '903' || message.command === '904' || message.command === '905' || message.command === '907', PHASE_TIMEOUT_MS);
  if (saslResult.prefix !== issuer || saslResult.command !== '903') throw new Error('sasl-authentication-failed');
  if (!ownerCurrent()) throw new Error('owner-retired');

  const nick = `E84${randomToken(4)}`;
  inbox.send('CAP END');
  inbox.send(`NICK ${nick}`);
  inbox.send('USER e84probe 0 * :Onyx Server WebRTC investigation');
  const welcome = await inbox.waitFor(message => message.command === '001', PHASE_TIMEOUT_MS);
  if (welcome.prefix !== issuer || !welcome.params[0]) throw new Error('registration-invalid');
  const actualNick = welcome.params[0];
  const account = config.account.toLowerCase();
  const physicalRef = `e84-${randomToken(16)}`;
  const endpoint = new URL(config.wsUrl).origin;
  const owner: OwnerContext = Object.freeze({
    networkId: 'onyx-e84-isolated-lab', accountId: account, endpoint, issuer,
    nick: actualNick, physicalRef, connectionGeneration: 1, requestId: randomToken(), room: config.room,
  });
  if (welcome.prefix !== owner.issuer || !ownerCurrent()) throw new Error('owner-currentness-failed');
  inbox.send(`JOIN ${owner.room}`);
  let sawJoin = false;
  let sawEnd = false;
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while ((!sawJoin || !sawEnd) && Date.now() < deadline) {
    const message = await inbox.waitFor(row => row.command === 'JOIN' && row.nick?.toLowerCase() === owner.nick.toLowerCase() && row.params[0] === owner.room
      || row.command === '366' && row.prefix === owner.issuer && row.params[0]?.toLowerCase() === owner.nick.toLowerCase() && row.params[1] === owner.room, Math.max(1, deadline - Date.now()));
    if (message.command === 'JOIN') sawJoin = true;
    if (message.command === '366') sawEnd = true;
  }
  if (!sawJoin || !sawEnd || !ownerCurrent()) throw new Error('room-join-failed');
  return owner;
}

async function makeBrowserOffer(mode: ProbeMode): Promise<{ peer: RTCPeerConnection; fingerprint: string; codecs: string[]; requestedCodecs: string[] }> {
  if (typeof RTCPeerConnection === 'undefined' || typeof RTCPeerConnection.generateCertificate !== 'function') throw new Error('browser-rtc-certificate-unavailable');
  const certificateAlgorithm: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
  const certificate = await RTCPeerConnection.generateCertificate(certificateAlgorithm);
  const peer = new RTCPeerConnection({ iceServers: [], certificates: [certificate] });
  try {
    peer.addTransceiver('audio', { direction: 'recvonly' });
    peer.addTransceiver('video', { direction: 'recvonly' });
    const offer = await peer.createOffer();
    if (!offer.sdp || offer.sdp.length > 64 * 1024) throw new Error('browser-offer-unavailable');
    await peer.setLocalDescription(offer);
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error('browser-offer-unavailable');
    const fingerprint = fingerprintFromSdp(sdp);
    const audio = RTCRtpSender.getCapabilities('audio')?.codecs ?? [];
    const video = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const codecs: string[] = [];
    if (audio.some(codec => codec.mimeType.toLowerCase() === 'audio/opus')) codecs.push('audio/opus');
    if (video.some(codec => codec.mimeType.toLowerCase() === 'video/vp8')) codecs.push('video/VP8');
    const requestedCodecs = mode === 'standards'
      ? [audio.some(codec => codec.mimeType.toLowerCase() === 'audio/opus') ? 'opus' : null,
        video.some(codec => codec.mimeType.toLowerCase() === 'video/vp8') ? 'vp8' : null].filter((value): value is string => value !== null)
      : ['cadencevox'];
    if (requestedCodecs.length === 0 || (mode === 'standards' && !requestedCodecs.includes('opus'))) {
      throw new Error('required-browser-codec-unavailable');
    }
    return { peer, fingerprint, codecs, requestedCodecs };
  } catch (error) {
    try { peer.close(); } catch { /* preserve the finite original failure */ }
    throw error;
  }
}

async function runProbe(config: ProbeConfig): Promise<ProbeResult> {
  let stage: ProbeStage = 'preflight';
  let socket: WebSocket | null = null;
  let inbox: ReturnType<typeof createInbox> | null = null;
  let peer: RTCPeerConnection | null = null;
  let retired = false;
  let result = failureResult(config.mode, stage, 'not-started');
  let activeOwner: OwnerContext | null = null;
  let serverOfferAccepted = false;
  let requestLabel: string | null = null;
  const requestedCodecs: string[] = [];
  const browserCodecs: string[] = [];
  let fingerprintGenerated = false;
  let fingerprintSent = false;
  let sentFingerprint: string | null = null;
  let totalDeadlineReached = false;
  const deadline = window.setTimeout(() => { totalDeadlineReached = true; retired = true; socket?.close(); }, TOTAL_TIMEOUT_MS);
  const ownerCurrent = () => !retired && socket?.readyState === WebSocket.OPEN;
  try {
    validateConfig(config);
    stage = 'wss-open';
    socket = new WebSocket(config.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('wss-open-timeout')), PHASE_TIMEOUT_MS);
      socket?.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket?.addEventListener('error', () => { clearTimeout(timer); reject(new Error('wss-open-failed')); }, { once: true });
    });
    if (!socket) throw new Error('wss-open-failed');
    inbox = createInbox(socket, ownerCurrent);
    stage = 'capability-auth';
    const registeredOwner = await registerProtectedOwner(config, inbox, ownerCurrent);
    activeOwner = registeredOwner;
    stage = 'room-join';
    stage = 'browser-offer';
    const offer = await makeBrowserOffer(config.mode);
    peer = offer.peer;
    requestedCodecs.push(...offer.requestedCodecs);
    browserCodecs.push(...offer.codecs);
    fingerprintGenerated = true;
    sentFingerprint = offer.fingerprint;
    stage = 'server-request';
    requestLabel = null; // No labeled-response request was made; exactly one operation is outstanding.
    const requestOwner = registeredOwner;
    const requestId = requestOwner.requestId;
    const isCurrentAttempt = () => ownerCurrent() && activeOwner === requestOwner && requestOwner.requestId === requestId;
    if (!isCurrentAttempt()) throw new Error('owner-retired');
    const codecList = offer.requestedCodecs.join(',');
    const line = `MEDIA OFFER ${registeredOwner.room} ${codecList} transport=webrtc fingerprint=sha-256:${offer.fingerprint} setup=active`;
    inbox.send(line);
    fingerprintSent = true;
    const responseDeadline = Date.now() + PHASE_TIMEOUT_MS;
    let response: ClassifiedReply = null;
    stage = 'server-reply';
    while (!response && Date.now() < responseDeadline) {
      const remaining = Math.max(1, responseDeadline - Date.now());
      const message = await inbox.waitFor(row => {
        const parsed = classifyPrivateReply(renderIrcMessage(row), {
          issuer: registeredOwner.issuer, nick: registeredOwner.nick, room: registeredOwner.room, label: requestLabel,
        });
        return parsed !== null;
      }, remaining);
      response = classifyPrivateReply(renderIrcMessage(message), {
        issuer: registeredOwner.issuer, nick: registeredOwner.nick, room: registeredOwner.room, label: requestLabel,
      });
      if (!isCurrentAttempt()) throw new Error('owner-retired');
    }
    if (!response) throw new Error('response-timeout');
    if (response.kind === 'offer-ack') serverOfferAccepted = true;
    if (response.kind === 'failure') {
      result = {
        schemaVersion: 1, mode: config.mode, status: 'server-refused', stage: 'server-reply',
        serverFailureCode: response.code, responseFamily: response.family, requestedCodecs, browserCodecs,
        browserFingerprintGenerated: fingerprintGenerated, browserFingerprintSent: fingerprintSent,
        fingerprintAlgorithm: 'sha-256', fingerprintOctets: fingerprintOctets(sentFingerprint ?? ''),
        serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null, decodedVideoFrames: null, errorCode: null,
      };
    } else if (response.kind === 'offer-ack' && config.mode === 'cadence-dtls') {
      stage = 'transport-validation';
      const transportMessage = await inbox.waitFor(row => classifyPrivateReply(renderIrcMessage(row), {
        issuer: registeredOwner.issuer, nick: registeredOwner.nick, room: registeredOwner.room, label: requestLabel,
      })?.kind === 'transport', PHASE_TIMEOUT_MS);
      const transportReply = classifyPrivateReply(renderIrcMessage(transportMessage), {
        issuer: registeredOwner.issuer, nick: registeredOwner.nick, room: registeredOwner.room, label: requestLabel,
      });
      if (!transportReply || transportReply.kind !== 'transport' || !isCurrentAttempt()) throw new Error('transport-unvalidated');
      // Keep the returned credentials in this lexical operation only. Never feed them to another peer or persist them.
      const privateTransport = transportReply.transport;
      const serverFingerprintFormatValid = fingerprintOctets(privateTransport.fingerprint) === 32;
      void privateTransport.ufrag; void privateTransport.password; void privateTransport.candidateHost; void privateTransport.candidatePort;
      result = {
        schemaVersion: 1, mode: config.mode, status: 'signaling-only', stage: 'transport-validation',
        serverFailureCode: null, responseFamily: 'server-event-transport', requestedCodecs, browserCodecs,
        browserFingerprintGenerated: true, browserFingerprintSent: true, fingerprintAlgorithm: 'sha-256', fingerprintOctets: 32,
        serverFingerprintFormatValid, mediaInterop: false, decodedAudioPackets: null, decodedVideoFrames: null, errorCode: null,
      };
    } else {
      throw new Error('unexpected-server-acceptance');
    }
  } catch (error) {
    const code = totalDeadlineReached ? 'investigation-deadline' : finiteErrorCode(error);
    const stageForResult = stage;
    if ((error instanceof Error ? error.message : '') === 'response-timeout') {
      result = { ...failureResult(config.mode, stageForResult, 'server-response-timeout', requestedCodecs, browserCodecs, fingerprintGenerated, fingerprintSent), responseFamily: 'timeout' };
    } else {
      result = failureResult(config.mode, stageForResult, code, requestedCodecs, browserCodecs, fingerprintGenerated, fingerprintSent);
    }
  } finally {
    clearTimeout(deadline);
    if (activeOwner && serverOfferAccepted && socket?.readyState === WebSocket.OPEN) {
      try { sendValidated(socket, `MEDIA LEAVE ${activeOwner.room}`, () => !retired && socket?.readyState === WebSocket.OPEN); } catch { /* owner or socket already retired */ }
    }
    retired = true;
    inbox?.close();
    if (peer) {
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      try { peer.close(); } catch { /* already closed */ }
      peer = null;
    }
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    // Drop all application references to the only local fingerprint/SDP and authenticated owner.
    sentFingerprint = null;
    activeOwner = null;
  }
  return result;
}

function renderIrcMessage(message: PrivateMessage): string {
  // The renderer is used only inside this private parser boundary; it never becomes an observable or logged value.
  const tags = Object.entries(message.tags).map(([key, value]) => value ? `${key}=${value}` : key);
  const prefix = message.prefix ? `:${message.prefix} ` : '';
  const params = message.params.map((value, index) => index === message.params.length - 1 && (value.includes(' ') || value.startsWith(':')) ? `:${value}` : value);
  return `${tags.length ? `@${tags.join(';')} ` : ''}${prefix}${message.command}${params.length ? ` ${params.join(' ')}` : ''}`;
}

async function runWithDeadline(config: ProbeConfig): Promise<ProbeResult> {
  try { return await runProbe(config); }
  catch { return failureResult(config.mode, 'preflight', 'probe-start-failed'); }
}

const target = window as HarnessWindow;
target.__testOnyxE84Parser = () => {
  const digest = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':').toUpperCase();
  const issuer = 'lab-server.invalid';
  const nick = 'E84Fixture';
  const room = '#e84-abcdef012345';
  const context = { issuer, nick, room, label: null };
  const failure = classifyPrivateReply('FAIL MEDIA NO_CODECS :No supported codec', context);
  const inventedPrefixedFailure = classifyPrivateReply(':lab-server.invalid FAIL MEDIA NO_CODECS :No supported codec', context);
  const saslChallenge = isOwnedSaslChallenge(parseIRCMessage('AUTHENTICATE +'), () => true);
  const prefixedSaslChallengeRejected = !isOwnedSaslChallenge(parseIRCMessage(':lab-server.invalid AUTHENTICATE +'), () => true);
  const retiredSaslChallengeRejected = !isOwnedSaslChallenge(parseIRCMessage('AUTHENTICATE +'), () => false);
  const wrongIssuer = classifyPrivateReply(':other.invalid NOTICE E84Fixture :FAIL MEDIA NO_CODECS: rejected', context);
  const wrongNick = classifyPrivateReply(`:lab-server.invalid EVENT Other MEDIA OFFER-ACK ${room} accepted`, context);
  const transport = `:lab-server.invalid EVENT E84Fixture MEDIA TRANSPORT ${room} ufrag=u1 pwd=p1 candidate=127.0.0.1:3478 fingerprint=sha-256 ${digest} setup=passive`;
  const validTransport = classifyPrivateReply(transport, context);
  const duplicateFingerprint = classifyPrivateReply(`${transport} fingerprint=sha-256 ${digest}`, context);
  const downgrade = classifyPrivateReply(transport.replace('setup=passive', 'srtp=AAAA setup=passive'), context);
  const crlfFingerprintAccepted = (() => {
    try { return fingerprintFromSdp(`v=0\r\na=fingerprint:sha-256 ${digest}\r\n`) === digest; } catch { return false; }
  })();
  const conflictingFingerprintRejected = (() => {
    try { fingerprintFromSdp(`a=fingerprint:sha-256 ${digest}\na=fingerprint:sha-256 ${'FF:'.repeat(31)}FF\n`); return false; } catch { return true; }
  })();
  const bareCarriageReturnRejected = (() => {
    try { fingerprintFromSdp(`a=fingerprint:sha-256 ${digest}\r`); return false; } catch { return true; }
  })();
  const nulSdpRejected = (() => {
    try { fingerprintFromSdp(`a=fingerprint:sha-256 ${digest}\0\n`); return false; } catch { return true; }
  })();
  return Object.freeze({
    sourceFailAccepted: failure?.kind === 'failure' && failure.code === 'NO_CODECS',
    inventedPrefixedFailureIgnored: inventedPrefixedFailure === null,
    ownedPrefixlessSaslChallengeAccepted: saslChallenge,
    prefixedSaslChallengeRejected,
    retiredSaslChallengeRejected,
    wrongIssuerIgnored: wrongIssuer === null,
    wrongRecipientIgnored: wrongNick === null,
    actualSpaceFingerprintAccepted: validTransport?.kind === 'transport',
    duplicateFingerprintRejected: duplicateFingerprint === null,
    sdesDowngradeRejected: downgrade === null,
    crlfFingerprintAccepted,
    conflictingFingerprintRejected,
    bareCarriageReturnRejected,
    nulSdpRejected,
  });
};
target.__runOnyxE84Probe = async (config: ProbeConfig): Promise<ProbeResult> => {
  const status = document.getElementById('status');
  const button = document.getElementById('run') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  if (status) status.textContent = 'Investigation running; private protocol details are not displayed.';
  const result = await runWithDeadline(config);
  if (status) status.textContent = `Investigation finished: ${result.status}.`;
  if (button) button.disabled = false;
  return result;
};

document.getElementById('run')?.addEventListener('click', () => {
  const status = document.getElementById('status');
  if (status) status.textContent = 'Select the probe mode in the isolated runner.';
});

export { classifyPrivateReply, fingerprintFromSdp, isIpAddress, normalizeFingerprint, parsePrivateTransport, runWithDeadline };
