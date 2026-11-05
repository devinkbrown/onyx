import {
  makeRequestId,
  type EndpointId,
  type OwnerSnapshot,
  type RequestId,
  type SendAdmission,
  type Transport,
  type ValidatedLineGroupIntent,
  type ValidatedLineIntent,
  type BinaryIntent,
  type AuthenticatedServerEvent,
  type PrivateIngressEvent,
} from './contracts';
import { parseIRCMessage } from '../../src/lib/irc/parser';
import { validateClientLine } from './client-line-validator';

export interface TransportOwnerDependencies {
  readonly socketFactory?: (url: string, protocols: readonly string[]) => WebSocket;
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrentOwner: (owner: OwnerSnapshot) => boolean;
  readonly authenticatedPrefix: () => string | null;
  /** Bootstrap-only callback for a bounded server-shaped 001 candidate.
   * The runtime must match tentative CAP identity before learning it. */
  readonly onWelcomeCandidate?: (line: string, owner: OwnerSnapshot) => void;
  /** Synchronous ordering seam before any ingress consumer can handle a line.
   * Throwing fails closed; ownership and transport attempt are rechecked after it. */
  readonly beforeIngressLine?: (line: string, owner: OwnerSnapshot) => void;
  /** Synchronous ordering seam before a validated line is admitted to the wire.
   * Throwing fails closed; ownership and transport attempt are rechecked after it. */
  readonly beforeSend?: (owner: OwnerSnapshot) => void;
  readonly endpoint: () => EndpointId;
  readonly mediaReady?: () => boolean;
  readonly consumePrivateLine: (line: string, prefix: string | null, owner: OwnerSnapshot) => boolean;
  readonly onPublicLine: (line: string, owner: OwnerSnapshot) => void;
  readonly onBinary: (bytes: Uint8Array, owner: OwnerSnapshot) => void;
  readonly onState: (state: 'connecting' | 'live' | 'offline', owner: OwnerSnapshot) => void;
  readonly maxBufferedAmount?: number;
}

export interface AlternativeDriver {
  sendLine(intent: ValidatedLineIntent): SendAdmission;
  isOpen(): boolean;
  close(): void;
}
export interface AlternativeConnectIntent {
  readonly owner: OwnerSnapshot;
  readonly endpoint: EndpointId;
  readonly requestId: RequestId;
  readonly open: (sink: { opened(): void; line(value: string): void; closed(): void }) => AlternativeDriver;
}

const TEXT_PROTOCOL = 'text.ircv3.net';
const BINARY_PROTOCOL = 'onyx.irc-media.v1';
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_GROUP_LINE_BYTES = 64 * 1024;
const UNKNOWN_SENSITIVE_MARKER = /(?:AUTHENTICATE|E2EEGROUP|E2EE[._-](?:KEYPACKAGE|COMMIT|WELCOME)|E2EEKEY|SESSION\s+(?:TOKEN|MTOKEN)|SESSIONTOKEN|MEDIA\s+MACKEY)/iu;
const SUPPORTED_SENSITIVE_ENVELOPES = new Set([
  'AUTHENTICATE', 'E2EEGROUP', 'E2EE.KEYPACKAGE', 'E2EE.COMMIT', 'E2EE.WELCOME', 'E2EEKEY',
  'EVENT', 'FAIL', 'NOTICE', 'PRIVMSG', 'WARN',
]);
function isUnknownSensitiveEnvelope(line: string, command: string): boolean {
  if (!UNKNOWN_SENSITIVE_MARKER.test(line.replace(/\u0000/gu, ' '))) return false;
  const normalizedCommand = command.toUpperCase();
  return !SUPPORTED_SENSITIVE_ENVELOPES.has(normalizedCommand) && !/^\d{3}$/u.test(normalizedCommand);
}

/** Socket owner with generation fencing at every event and admission point.
 * The caller advances OwnerSnapshot before retiring the previous connection. */
export function createTransportOwner(deps: TransportOwnerDependencies): Transport & {
  connect(url: string): SendAdmission;
  connectAlternative(intent: AlternativeConnectIntent): SendAdmission;
  supportsBinaryMedia(): boolean;
  close(): void;
  isOpen(): boolean;
} {
  let socket: WebSocket | null = null;
  let disposed = false;
  let socketEpoch = 0;
  let alternativeEpoch = 0;
  let alternative: AlternativeDriver | null = null;
  let binarySocketBinding: OwnerSnapshot | null = null;
  const serverListeners = new Set<(event: AuthenticatedServerEvent) => void>();
  const privateIngressListeners = new Set<(event: { readonly schemaVersion: 1; readonly requestId: RequestId; readonly owner: OwnerSnapshot; readonly payload: PrivateIngressEvent }) => boolean | void>();
  const binaryListeners = new Set<(event: { readonly schemaVersion: 1; readonly requestId: RequestId; readonly owner: OwnerSnapshot; readonly payload: Uint8Array }) => void>();
  const current = (owner: OwnerSnapshot): boolean => !disposed && deps.isCurrentOwner(owner) && sameOwner(owner, deps.currentOwner());
  const beforeIngress = (line: string, owner: OwnerSnapshot): boolean => {
    try { deps.beforeIngressLine?.(line, owner); return true; }
    catch { return false; }
  };
  const beforeWireSend = (owner: OwnerSnapshot): boolean => {
    try { deps.beforeSend?.(owner); return true; }
    catch { return false; }
  };
  const requestId = (): RequestId => {
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const id = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    const validated = makeRequestId(id);
    if (!validated) throw new Error('random request id was invalid');
    return validated;
  };
  const publishState = (state: 'connecting' | 'live' | 'offline', owner: OwnerSnapshot) => { if (current(owner)) deps.onState(state, owner); };
  const physicalCurrent = (captured: OwnerSnapshot) => {
    const live = deps.currentOwner();
    return !disposed && live.networkId === captured.networkId && live.connectionGeneration === captured.connectionGeneration
      && live.physicalRef === captured.physicalRef && deps.isCurrentOwner(live);
  };
  const retireAlternative = () => { alternativeEpoch++; const old = alternative; alternative = null; try { old?.close(); } catch { /* retired driver */ } };
  const alternativeLine = (line: string, valid: () => boolean) => {
    if (!valid() || line.length > MAX_FRAME_BYTES || /[\u0000\r\n]/u.test(line)) return;
    const parsed = parseIRCMessage(line);
    if (isUnknownSensitiveEnvelope(line, parsed.command)) return;
    const owner = deps.currentOwner();
    if (!current(owner) || !beforeIngress(line, owner) || !valid() || !current(owner)) return;
    if (deps.consumePrivateLine(line, deps.authenticatedPrefix(), owner) || !valid()) return;
    const mediaFamily = parsed.command === 'EVENT' && parsed.params[1]?.toUpperCase() === 'MEDIA' ? parsed.params[2]?.toUpperCase() : null;
    let consumed = ['MACKEY', 'NATIVE-MACKEY', 'TRANSPORT', 'NATIVE'].includes(mediaFamily ?? '')
      || parsed.command === 'EVENT' && parsed.params[1]?.toUpperCase() === 'WEBAUTHN'
      || parsed.command === 'NOTICE' && /^OUTHOOK(?::|\s)/iu.test(parsed.params[1] ?? '');
    let serverPrefix = deps.authenticatedPrefix();
    const welcomePrefix = parsed.command === '001' ? parsed.prefix : null;
    if (serverPrefix === null && welcomePrefix && welcomePrefix.length <= 512 && !/[!@\s\u0000-\u001f\u007f]/u.test(welcomePrefix)) {
      deps.onWelcomeCandidate?.(line, deps.currentOwner());
      if (!valid()) return;
      serverPrefix = deps.authenticatedPrefix();
    }
    const sourceKind: PrivateIngressEvent['sourceKind'] = !parsed.prefix ? 'prefixless-protocol'
      : serverPrefix !== null && parsed.prefix === serverPrefix && !/[!@]/u.test(parsed.prefix) ? 'server' : 'user';
    const fresh = deps.currentOwner();
    const event = { schemaVersion: 1 as const, requestId: requestId(), owner: fresh, payload: { line, owner: fresh, sourceKind } };
    privateIngressListeners.forEach(listener => { try { if (listener(event) === true) consumed = true; } catch { /* fail closed */ } });
    if (!valid() || consumed) return;
    deps.onPublicLine(line, deps.currentOwner());
    if (!valid()) return;
    const prefix = /^:([^!\s]+)(?:\s|$)/u.exec(line)?.[1];
    const currentOwner = deps.currentOwner();
    if (prefix && deps.authenticatedPrefix() === prefix) serverListeners.forEach(listener => listener({
      line, networkId: currentOwner.networkId, accountId: currentOwner.accountId, authentication: 'server',
      connectionGeneration: currentOwner.connectionGeneration, accountGeneration: currentOwner.accountGeneration, serverEndpointId: deps.endpoint(),
    }));
  };
  const connectAlternative = (intent: AlternativeConnectIntent): SendAdmission => {
    if (!current(intent.owner)) return { kind: 'blocked', reason: 'owner-changed' };
    socketEpoch++;
    const oldSocket = socket;
    socket = null;
    binarySocketBinding = null;
    try { oldSocket?.close(); } catch { /* prior transport retired */ }
    retireAlternative();
    const epoch = alternativeEpoch;
    const valid = () => alternativeEpoch === epoch && physicalCurrent(intent.owner);
    const pending: Array<() => void> = [];
    let binding = false;
    const deliver = (callback: () => void) => {
      if (!valid()) return;
      if (!binding) pending.push(() => { if (valid()) callback(); });
      else callback();
    };
    let driver: AlternativeDriver | null = null;
    try {
      driver = intent.open({
        opened: () => deliver(() => publishState('live', deps.currentOwner())),
        line: value => deliver(() => alternativeLine(value, valid)),
        closed: () => deliver(() => { if (alternativeEpoch !== epoch) return; alternative = null; alternativeEpoch++; publishState('offline', deps.currentOwner()); }),
      });
    } catch { return { kind: 'blocked', reason: 'offline' }; }
    if (!valid() || !driver || typeof driver.sendLine !== 'function' || typeof driver.isOpen !== 'function' || typeof driver.close !== 'function') {
      try { driver?.close(); } catch { /* failed binding */ }
      return { kind: 'blocked', reason: 'offline' };
    }
    alternative = driver;
    publishState('connecting', intent.owner);
    binding = true;
    pending.splice(0).forEach(callback => callback());
    return { kind: 'transport-admitted' };
  };
  function connect(url: string): SendAdmission {
    const owner = deps.currentOwner();
    if (!current(owner)) return { kind: 'blocked', reason: 'owner-changed' };
    if (!/^wss:\/\//u.test(url) || url.length > 2048 || /[\u0000-\u0020\u007f]/u.test(url)) return { kind: 'blocked', reason: 'invalid-intent' };
    const epoch = ++socketEpoch;
    retireAlternative();
    const previous = socket;
    socket = null;
    binarySocketBinding = null;
    try { previous?.close(); } catch { /* retired socket */ }
    try { socket = (deps.socketFactory ?? ((href, protocols) => new WebSocket(href, [...protocols])))(url, deps.mediaReady?.() ? [BINARY_PROTOCOL, TEXT_PROTOCOL] : [TEXT_PROTOCOL]); }
    catch { publishState('offline', owner); return { kind: 'blocked', reason: 'offline' }; }
    const active = socket;
    const socketCurrent = (): boolean => {
      const live = deps.currentOwner();
      return !disposed && socketEpoch === epoch && socket === active && deps.isCurrentOwner(live)
        && live.connectionGeneration === owner.connectionGeneration && live.physicalRef === owner.physicalRef
        && live.networkId === owner.networkId;
    };
    publishState('connecting', owner);
    active.binaryType = 'arraybuffer';
    active.addEventListener('open', () => {
      if (!socketCurrent()) { try { active.close(); } catch { /* retired socket */ } return; }
      if (active.protocol !== TEXT_PROTOCOL && active.protocol !== BINARY_PROTOCOL) { try { active.close(1002, 'Unsupported WebSocket protocol'); } catch { /* closed */ } return; }
      binarySocketBinding = active.protocol === BINARY_PROTOCOL ? owner : null;
      publishState('live', owner);
    });
    active.addEventListener('message', event => {
      if (!socketCurrent() || (active.protocol !== TEXT_PROTOCOL && active.protocol !== BINARY_PROTOCOL)) return;
      if (event.data instanceof ArrayBuffer) {
        if (active.protocol !== BINARY_PROTOCOL || event.data.byteLength > MAX_FRAME_BYTES) { try { active.close(1002, 'Invalid binary frame'); } catch { /* closed */ } return; }
        const bytes = new Uint8Array(event.data.slice(0));
        const ingressOwner = deps.currentOwner();
        if (!socketCurrent() || !current(ingressOwner)) return;
        deps.onBinary(bytes, ingressOwner);
        if (!socketCurrent() || !current(ingressOwner)) return;
        const envelope = { schemaVersion: 1 as const, requestId: requestId(), owner: ingressOwner, payload: bytes };
        for (const listener of binaryListeners) {
          if (!socketCurrent() || !current(ingressOwner)) return;
          listener(envelope);
          if (!socketCurrent() || !current(ingressOwner)) return;
        }
        return;
      }
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > MAX_FRAME_BYTES) { try { active.close(1002, 'Invalid text frame'); } catch { /* closed */ } return; }
      const frameLines = event.data.split('\n').map(line => line.replace(/\r$/u, '')).filter(Boolean);
      for (const line of frameLines) {
        if (!socketCurrent()) return;
        const safe = line.length <= MAX_FRAME_BYTES && !/[\u0000\r\n]/u.test(line) ? line : null;
        if (safe === null) continue;
        const parsed = parseIRCMessage(safe);
        if (isUnknownSensitiveEnvelope(safe, parsed.command)) continue;
        const ingressOwner = deps.currentOwner();
        if (!socketCurrent() || !current(ingressOwner)) return;
        if (!beforeIngress(safe, ingressOwner)) continue;
        if (!socketCurrent() || !current(ingressOwner)) return;
        const learnedPrefix = deps.authenticatedPrefix();
        if (deps.consumePrivateLine(safe, learnedPrefix, ingressOwner)) continue;
        if (!socketCurrent() || !current(ingressOwner)) return;
        /* Caller-private Event Spine replies use structured parameters:
           `EVENT <nick> MEDIA <verb> <room> <detail>`. Keep keys and transport
           candidates out of public projection even when Cadence is unmounted;
           private listeners get the source-shaped line first. */
        const mediaFamily = parsed.command === 'EVENT' && parsed.params[1]?.toUpperCase() === 'MEDIA'
          ? parsed.params[2]?.toUpperCase() : null;
        const privateMediaReply = ['MACKEY', 'NATIVE-MACKEY', 'TRANSPORT', 'NATIVE'].includes(mediaFamily ?? '');
        const privateWebAuthnEvent = parsed.command === 'EVENT' && parsed.params[1]?.toUpperCase() === 'WEBAUTHN';
        // OUTHOOK LIST carries its full configured URL in a NOTICE. Keep all
        // OUTHOOK replies private, including late or unsolicited replies.
        const privateOutHookReply = parsed.command === 'NOTICE' && /^OUTHOOK(?::|\s)/iu.test(parsed.params[1] ?? '');
        let serverPrefix = deps.authenticatedPrefix();
        let lineOwner = ingressOwner;
        const welcomePrefix = parsed.command === '001' ? parsed.prefix : null;
        if (serverPrefix === null && welcomePrefix && welcomePrefix.length <= 512 && !/[!@\s\u0000-\u001f\u007f]/u.test(welcomePrefix)) {
          deps.onWelcomeCandidate?.(safe, lineOwner);
          if (!socketCurrent()) return;
          // A validated welcome may complete a staged account proof and rotate
          // the owner on this still-current physical socket. Rebase this line
          // only at that explicit trusted handoff point.
          lineOwner = deps.currentOwner();
          if (!current(lineOwner)) return;
          serverPrefix = deps.authenticatedPrefix();
        }
        const sourceKind: PrivateIngressEvent['sourceKind'] = !parsed.prefix
          ? 'prefixless-protocol'
          : serverPrefix !== null && parsed.prefix === serverPrefix && !/[!@]/u.test(parsed.prefix)
            ? 'server'
            : 'user';
        const privateEnvelope = { schemaVersion: 1 as const, requestId: requestId(), owner: lineOwner, payload: { line: safe, owner: lineOwner, sourceKind } };
        let privatelyConsumed = privateMediaReply || privateWebAuthnEvent || privateOutHookReply;
        for (const listener of privateIngressListeners) {
          if (!socketCurrent() || !current(lineOwner)) return;
          try { if (listener(privateEnvelope) === true) privatelyConsumed = true; }
          catch { /* malformed/private handler failure must never authorize projection */ }
          if (!socketCurrent() || !current(lineOwner)) return;
        }
        if (privatelyConsumed) continue;
        deps.onPublicLine(safe, lineOwner);
        if (!socketCurrent() || !current(lineOwner)) return;
        const prefixMatch = /^:([^!\s]+)(?:\s|$)/u.exec(safe);
        const currentPrefix = deps.authenticatedPrefix();
        if (prefixMatch?.[1] && currentPrefix !== null && prefixMatch[1] === currentPrefix) {
          if (!socketCurrent() || !current(lineOwner)) return;
          const authenticated: AuthenticatedServerEvent = { line: safe, networkId: lineOwner.networkId, accountId: lineOwner.accountId, authentication: 'server', connectionGeneration: lineOwner.connectionGeneration, accountGeneration: lineOwner.accountGeneration, serverEndpointId: deps.endpoint() };
          for (const listener of serverListeners) {
            if (!socketCurrent() || !current(lineOwner)) return;
            listener(authenticated);
            if (!socketCurrent() || !current(lineOwner)) return;
          }
        }
      }
    });
    active.addEventListener('close', () => { if (socketCurrent()) { binarySocketBinding = null; publishState('offline', deps.currentOwner()); } });
    active.addEventListener('error', () => { if (socketCurrent()) { binarySocketBinding = null; publishState('offline', deps.currentOwner()); } });
    return { kind: 'transport-admitted' };
  }
  const sendLineInternal = (intent: ValidatedLineIntent, runBeforeSend: boolean): SendAdmission => {
    const owner = deps.currentOwner();
    if (!sameOwner(intent.owner, owner)) return { kind: 'blocked', reason: 'owner-changed' };
    if (!current(owner)) return { kind: 'blocked', reason: 'owner-changed' };
    if (!validateClientLine(intent.line).valid) return { kind: 'blocked', reason: 'invalid-intent' };
    const activeAlternative = alternative;
    if (activeAlternative) {
      const activeEpoch = alternativeEpoch;
      try { if (!activeAlternative.isOpen()) return { kind: 'blocked', reason: 'offline' }; }
      catch { return { kind: 'unknown', reason: 'transport-error' }; }
      if (runBeforeSend && !beforeWireSend(owner)) return { kind: 'blocked', reason: 'policy' };
      if (!current(owner) || !sameOwner(intent.owner, deps.currentOwner())) return { kind: 'blocked', reason: 'owner-changed' };
      if (alternative !== activeAlternative || alternativeEpoch !== activeEpoch) return { kind: 'blocked', reason: 'offline' };
      try { return activeAlternative.isOpen() ? activeAlternative.sendLine(intent) : { kind: 'blocked', reason: 'offline' }; }
      catch { return { kind: 'unknown', reason: 'transport-error' }; }
    }
    const activeSocket = socket;
    const activeEpoch = socketEpoch;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || (activeSocket.protocol !== TEXT_PROTOCOL && activeSocket.protocol !== BINARY_PROTOCOL)) return { kind: 'blocked', reason: 'offline' };
    if (activeSocket.bufferedAmount > (deps.maxBufferedAmount ?? 1024 * 1024)) return { kind: 'blocked', reason: 'backpressure' };
    if (runBeforeSend && !beforeWireSend(owner)) return { kind: 'blocked', reason: 'policy' };
    if (!current(owner) || !sameOwner(intent.owner, deps.currentOwner())) return { kind: 'blocked', reason: 'owner-changed' };
    if (socket !== activeSocket || socketEpoch !== activeEpoch) return { kind: 'blocked', reason: 'offline' };
    if (activeSocket.readyState !== WebSocket.OPEN || (activeSocket.protocol !== TEXT_PROTOCOL && activeSocket.protocol !== BINARY_PROTOCOL)) return { kind: 'blocked', reason: 'offline' };
    if (activeSocket.bufferedAmount > (deps.maxBufferedAmount ?? 1024 * 1024)) return { kind: 'blocked', reason: 'backpressure' };
    try { activeSocket.send(intent.line); return { kind: 'transport-admitted' }; }
    catch { return { kind: 'unknown', reason: 'transport-error' }; }
  };
  const sendLine = (intent: ValidatedLineIntent): SendAdmission => sendLineInternal(intent, true);
  const sendLineGroup = (intent: ValidatedLineGroupIntent): readonly SendAdmission[] => {
    if (!Array.isArray(intent.lines) || intent.lines.length === 0 || intent.lines.length > 1024) {
      return [{ kind: 'blocked', reason: 'invalid-intent' }];
    }
    const validated = intent.lines.map(line => typeof line === 'string' ? validateClientLine(line) : null);
    const total = validated.reduce((sum, item) => sum + (item?.valid ? item.byteLength : 0), 0);
    if (validated.some(item => item === null || !item.valid || item.byteLength > MAX_GROUP_LINE_BYTES) || total > 256 * 1024) {
      return [{ kind: 'blocked', reason: 'invalid-intent' }];
    }
    // No await occurs in this loop. A browser task or another transport send
    // cannot interleave a command between the lines of the group. Keep one
    // result per attempted line so callers can classify partial writes as
    // delivery-unknown without retrying them.
    const results: SendAdmission[] = [];
    for (let index = 0; index < intent.lines.length; index += 1) {
      const line = intent.lines[index];
      if (line === undefined) break;
      // The barrier runs once before the group. That keeps the group contiguous
      // if the synchronous hook drains older queued lines through this transport.
      const admission = sendLineInternal({ line, requestId: intent.requestId, owner: intent.owner }, index === 0);
      results.push(admission);
      if (admission.kind !== 'transport-admitted') {
        for (let rest = index + 1; rest < intent.lines.length; rest += 1) {
          results.push({ kind: 'blocked', reason: 'offline' });
        }
        break;
      }
    }
    return results;
  };
  const sendBinary = (intent: BinaryIntent): SendAdmission => {
    const owner = deps.currentOwner();
    if (!sameOwner(intent.owner, owner)) return { kind: 'blocked', reason: 'owner-changed' };
    if (!current(owner)) return { kind: 'blocked', reason: 'owner-changed' };
    if (intent.bytes.byteLength === 0 || intent.bytes.byteLength > MAX_FRAME_BYTES) return { kind: 'blocked', reason: 'invalid-intent' };
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.protocol !== BINARY_PROTOCOL) return { kind: 'blocked', reason: 'offline' };
    if (socket.bufferedAmount > (deps.maxBufferedAmount ?? 1024 * 1024)) return { kind: 'blocked', reason: 'backpressure' };
    try { socket.send(intent.bytes.slice()); return { kind: 'transport-admitted' }; } catch { return { kind: 'unknown', reason: 'transport-error' }; }
  };
  return {
    ownerSnapshot: deps.currentOwner,
    isCurrent: current,
    sendLine,
    sendLineGroup,
    sendBinary,
    connect,
    connectAlternative,
    supportsBinaryMedia() {
      return !!socket && socket.readyState === WebSocket.OPEN && socket.protocol === BINARY_PROTOCOL
        && binarySocketBinding !== null && physicalCurrent(binarySocketBinding);
    },
    isOpen() { return alternative?.isOpen() ?? (!!socket && socket.readyState === WebSocket.OPEN); },
    close() { socketEpoch += 1; binarySocketBinding = null; const old = socket; socket = null; try { old?.close(); } catch { /* already closed */ } retireAlternative(); },
    onAuthenticatedServerEvent(listener) { serverListeners.add(listener); return { dispose: () => serverListeners.delete(listener) }; },
    onPrivateIngress(listener) { privateIngressListeners.add(listener); return { dispose: () => privateIngressListeners.delete(listener) }; },
    onBinary(listener) { binaryListeners.add(listener); return { dispose: () => binaryListeners.delete(listener) }; },
    dispose() { this.close(); disposed = true; serverListeners.clear(); privateIngressListeners.clear(); binaryListeners.clear(); },
  };
}

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
