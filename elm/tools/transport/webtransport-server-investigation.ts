// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseIRCMessage } from '../../../src/lib/irc/parser';
import {
  makeAccountGeneration, makeConnectionGeneration, makeEndpointId, makeLocalPhysicalEpoch,
  makeAccountId, makeNetworkId, makeOwnerRef, makeRequestId,
  type AccountId, type EndpointId, type OwnerSnapshot, type RequestId,
} from '../../runtime/contracts';
import { createTransportOwner, type AlternativeDriver } from '../../runtime/transport-owner';
import { createWebTransportAdapter, type TransportConnectIntent, type WebTransportLike } from '../../runtime/webtransport-adapter';

type FailureCode =
  | 'invalid-config' | 'insecure-context' | 'api-unavailable' | 'wt-connect-unknown'
  | 'wt-registration-timeout' | 'wt-framing-timeout' | 'wss-connect-unknown'
  | 'wss-sasl-unavailable' | 'wss-auth-refused' | 'wss-registration-timeout'
  | 'wss-join-refused' | 'wss-canary-timeout' | 'fallback-not-confirmed'
  | 'owner-fence-failed' | 'cleanup-incomplete';
type ProbeStage = 'wt-connect' | 'wt-registration' | 'wt-framing' | 'auth-policy' | 'wss-fallback' | 'cleanup';
type ProbeResult = {
  schemaVersion: 2;
  status: 'completed' | 'unknown' | 'blocked';
  stage: ProbeStage;
  failureCode: FailureCode | null;
  wt: {
    ready: boolean;
    registration: 'registered' | 'unknown' | 'blocked';
    rawPingPong: boolean | null;
    textCanary: boolean | null;
    echoAdvertised: boolean | null;
    echoRequest: 'not-attempted' | 'acknowledged' | 'refused' | 'unknown';
    saslMechanisms: string[];
    plainProbe: 'not-sent' | 'challenge-no-secret-sent' | 'source-refused' | 'unknown';
    sessionToken: 'not-attempted' | 'source-refused' | 'unknown';
  };
  wss: {
    ready: boolean;
    auth: 'authenticated' | 'unknown' | 'refused';
    saslMechanisms: string[];
    joined: boolean | null;
    canaryEcho: boolean | null;
  };
  fallback: {
    explicitOnly: true;
    freshOwner: boolean | null;
    staleWtBlocked: boolean | null;
    canaryExactlyOnce: boolean | null;
  };
  externalParity: false;
};
export type E91ProbeConfig = {
  readonly wtUrl: string;
  readonly wssUrl: string;
  readonly certificateSha256Hex: string;
  readonly account: string;
  readonly password: string;
  readonly room: string;
};
type ProbeWindow = Window & { __runOnyxE91Probe?: (config: E91ProbeConfig) => Promise<ProbeResult> };
type ConnectionMode = 'wt' | 'wss';
type ConnectionProof = {
  readonly mode: ConnectionMode;
  readonly owner: OwnerSnapshot;
  nick: string | null;
  issuer: string | null;
  prefixMap: ReadonlyMap<string, string> | null;
};
type CapList =
  | { readonly kind: 'pending' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'complete'; readonly issuer: string; readonly capabilities: string[] };
type CapRequest = 'pending' | 'acknowledged' | 'refused' | 'unknown';

const $ = <T extends HTMLElement>(testId: string): T => {
  const node = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!node) throw new Error('page-control-missing');
  return node;
};
const statusNode = $<HTMLParagraphElement>('e91-status');
const resultNode = $<HTMLPreElement>('e91-result');
const runButton = $<HTMLButtonElement>('e91-run');
const fallbackButton = $<HTMLButtonElement>('e91-confirm-wss-fallback');
const encoder = new TextEncoder();
const MAX_LINES = 1200;
const MAX_CAP_LINES = 64;
const MAX_CAP_TOKENS = 512;
const CAP_TOKEN = /^[A-Za-z0-9][A-Za-z0-9./_-]*(?:=[A-Za-z0-9._/,:+=-]{0,256})?$/u;
const SASL_MECHANISM = /^[A-Z][A-Z0-9-]{0,31}$/u;

function randomRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const value = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  if (!makeRequestId(value)) throw new Error('random-reference-invalid');
  return value;
}
function randomHex32(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;
}
function samePhysicalAttempt(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;
}
function sameIrcName(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}
function serverIssuer(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 255 && !/[!@\s\u0000-\u001f\u007f]/u.test(value);
}
function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}
function capReplyText(params: readonly string[], continuation: boolean): string {
  return params.slice(continuation ? 3 : 2).join(' ').trim();
}
function capTokens(text: string): string[] | null {
  if (text === '') return [];
  const tokens = text.split(/\s+/u);
  if (tokens.length > MAX_CAP_TOKENS || tokens.some(token => token.length > 512 || !CAP_TOKEN.test(token))) return null;
  return tokens;
}
function readCapList(lines: readonly string[]): CapList {
  const replies = lines.map(line => parseIRCMessage(line))
    .filter(parsed => parsed.command === 'CAP' && parsed.params[1]?.toUpperCase() === 'LS');
  if (replies.length === 0) return { kind: 'pending' };
  if (replies.length > MAX_CAP_LINES) return { kind: 'invalid' };

  const first = replies[0];
  if (!first || first.params[0] !== '*' || !serverIssuer(first.prefix)) return { kind: 'invalid' };
  const issuer = first.prefix;
  const capabilities = new Set<string>();
  let ended = false;
  for (const parsed of replies) {
    if (parsed.prefix !== issuer || parsed.params[0] !== '*' || ended) return { kind: 'invalid' };
    const continuation = parsed.params[2] === '*';
    const tokens = capTokens(capReplyText(parsed.params, continuation));
    if (!tokens) return { kind: 'invalid' };
    for (const token of tokens) capabilities.add(token);
    if (!continuation) ended = true;
  }
  return ended ? { kind: 'complete', issuer, capabilities: [...capabilities] } : { kind: 'pending' };
}
function capabilityName(token: string): string {
  const equals = token.indexOf('=');
  return (equals < 0 ? token : token.slice(0, equals)).toLowerCase();
}
function hasCapability(capabilities: readonly string[], expected: string): boolean {
  return capabilities.some(token => capabilityName(token) === expected.toLowerCase());
}
function safeMechanisms(capabilities: readonly string[]): string[] {
  const offered = new Set<string>();
  for (const token of capabilities) {
    const equals = token.indexOf('=');
    if (equals < 0 || token.slice(0, equals).toLowerCase() !== 'sasl') continue;
    for (const raw of token.slice(equals + 1).split(',')) {
      const value = raw.toUpperCase();
      if (SASL_MECHANISM.test(value)) offered.add(value);
    }
  }
  return [...offered].sort();
}
function capRequestReply(lines: readonly string[], issuer: string, requested: readonly string[]): CapRequest {
  const replies = lines.map(line => parseIRCMessage(line)).filter(parsed => parsed.command === 'CAP'
    && parsed.prefix === issuer && parsed.params[0] === '*' && ['ACK', 'NAK'].includes(parsed.params[1]?.toUpperCase() ?? ''));
  const reply = replies[0];
  if (!reply) return 'pending';
  const tokens = capTokens(reply.params.slice(2).join(' ').trim());
  if (!tokens) return 'unknown';
  const received = tokens.map(capabilityName).sort();
  const expected = requested.map(value => value.toLowerCase()).sort();
  if (received.length !== expected.length || received.some((value, index) => value !== expected[index])) return 'unknown';
  return reply.params[1]?.toUpperCase() === 'ACK' ? 'acknowledged' : 'refused';
}
function exactOwnNumeric(
  parsed: ReturnType<typeof parseIRCMessage>, code: string, issuer: string, nick: string,
): boolean {
  return parsed.command === code && parsed.prefix === issuer && parsed.params[0] === nick;
}
function prefixMapFromIsupport(line: string, issuer: string, nick: string): ReadonlyMap<string, string> | null | undefined {
  const parsed = parseIRCMessage(line);
  if (parsed.command !== '005' || parsed.prefix !== issuer || !sameIrcName(parsed.params[0], nick)) return undefined;
  let found = false;
  let prefixMap: Map<string, string> | null = null;
  for (const token of parsed.params.slice(1)) {
    const equals = token.indexOf('=');
    if (equals < 0 || token.slice(0, equals).toUpperCase() !== 'PREFIX') continue;
    if (found) return null;
    found = true;
    const match = /^\(([^()]*)\)(.+)$/u.exec(token.slice(equals + 1));
    const modes = Array.from(match?.[1] ?? '');
    const symbols = Array.from(match?.[2] ?? '');
    if (!match || modes.length === 0 || modes.length !== symbols.length) return null;
    const modeSet = new Set<string>();
    const symbolSet = new Set<string>();
    const next = new Map<string, string>();
    for (let index = 0; index < modes.length; index += 1) {
      const mode = modes[index];
      const symbol = symbols[index];
      if (mode === undefined || symbol === undefined || !/^[A-Za-z]$/u.test(mode)
        || !/^[!-~]$/u.test(symbol) || modeSet.has(mode) || symbolSet.has(symbol)) return null;
      modeSet.add(mode);
      symbolSet.add(symbol);
      next.set(symbol, mode);
    }
    prefixMap = next;
  }
  return found ? prefixMap : undefined;
}
function namesContainsNick(line: string, nick: string, issuer: string, prefixMap: ReadonlyMap<string, string>): boolean {
  const parsed = parseIRCMessage(line);
  if (parsed.command !== '353' || parsed.prefix !== issuer || parsed.params[3] === undefined) return false;
  const prefixSymbols = [...prefixMap.keys()];
  return parsed.params[3].split(/\s+/u).some(entry => {
    let candidate = entry;
    while (candidate.length > 0) {
      const symbol = prefixSymbols.find(value => candidate.startsWith(value));
      if (symbol === undefined) break;
      candidate = candidate.slice(symbol.length);
    }
    return sameIrcName(candidate, nick);
  });
}
function hasNamesJoinProof(
  lines: readonly string[], issuer: string, nick: string, room: string, prefixMap: ReadonlyMap<string, string>,
): boolean {
  const parsed = lines.map(line => parseIRCMessage(line));
  const joinedAt = parsed.findIndex(item => item.command === 'JOIN' && item.prefix !== null
    && sameIrcName(item.nick ?? undefined, nick) && sameIrcName(item.params[0], room));
  if (joinedAt < 0) return false;
  const namesAt = parsed.findIndex((item, index) => index > joinedAt && item.command === '353'
    && item.prefix === issuer && item.params[0] === nick && sameIrcName(item.params[2], room)
    && item.params[3] !== undefined && namesContainsNick(item.raw, nick, issuer, prefixMap));
  if (namesAt < 0) return false;
  const endAt = parsed.findIndex((item, index) => index > namesAt
    && exactOwnNumeric(item, '366', issuer, nick) && sameIrcName(item.params[1], room));
  return endAt > namesAt;
}
function isOwnRoomCanary(
  parsed: ReturnType<typeof parseIRCMessage>, nick: string, room: string, body: string,
): boolean {
  return parsed.command === 'PRIVMSG' && parsed.prefix !== null && parsed.prefix.includes('!')
    && sameIrcName(parsed.nick ?? undefined, nick) && parsed.params.length === 2
    && sameIrcName(parsed.params[0], room) && parsed.params[1] === body;
}
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (predicate()) return true;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  return predicate();
}
function requestId(): RequestId {
  const result = makeRequestId(randomRef());
  if (!result) throw new Error('request-id-invalid');
  return result;
}
function newOwner(networkId: ReturnType<typeof makeNetworkId>, accountId: AccountId | null, connection: number): OwnerSnapshot {
  const owner = {
    networkId, accountId,
    accountGeneration: makeAccountGeneration(accountId ? 1 : 0),
    connectionGeneration: makeConnectionGeneration(connection),
    physicalRef: makeLocalPhysicalEpoch(randomHex32()), ownerRef: makeOwnerRef(randomRef()),
  };
  if (!owner.networkId || owner.accountGeneration === null || owner.connectionGeneration === null || !owner.physicalRef || !owner.ownerRef) {
    throw new Error('owner-invalid');
  }
  return Object.freeze(owner) as OwnerSnapshot;
}
function decodeHash(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function validConfig(input: E91ProbeConfig): boolean {
  if (!input || typeof input !== 'object' || typeof input.wtUrl !== 'string' || typeof input.wssUrl !== 'string'
    || typeof input.certificateSha256Hex !== 'string' || typeof input.account !== 'string'
    || typeof input.password !== 'string' || typeof input.room !== 'string') return false;
  try {
    const wt = new URL(input.wtUrl); const wss = new URL(input.wssUrl);
    return wt.protocol === 'https:' && loopbackHost(wt.hostname) && wt.pathname === '/' && wt.search === ''
      && wt.username === '' && wt.password === '' && wt.hash === ''
      && wss.protocol === 'wss:' && loopbackHost(wss.hostname) && wss.search === ''
      && wss.username === '' && wss.password === '' && wss.hash === ''
      && /^[a-f0-9]{64}$/u.test(input.certificateSha256Hex)
      && /^[A-Za-z][A-Za-z0-9_-]{0,30}$/u.test(input.account)
      && /^#[A-Za-z0-9_-]{1,48}$/u.test(input.room)
      && input.password.length > 0 && encoder.encode(input.password).byteLength <= 256;
  } catch { return false; }
}

async function runProbe(config: E91ProbeConfig): Promise<ProbeResult> {
  const result: ProbeResult = {
    schemaVersion: 2, status: 'unknown', stage: 'wt-connect', failureCode: null,
    wt: { ready: false, registration: 'unknown', rawPingPong: null, textCanary: null, echoAdvertised: null, echoRequest: 'not-attempted', saslMechanisms: [], plainProbe: 'not-sent', sessionToken: 'not-attempted' },
    wss: { ready: false, auth: 'unknown', saslMechanisms: [], joined: null, canaryEcho: null },
    fallback: { explicitOnly: true, freshOwner: null, staleWtBlocked: null, canaryExactlyOnce: null },
    externalParity: false,
  };
  if (!validConfig(config)) { result.status = 'blocked'; result.failureCode = 'invalid-config'; return result; }
  if (!isSecureContext) { result.status = 'blocked'; result.failureCode = 'insecure-context'; return result; }
  if (typeof WebTransport === 'undefined') { result.status = 'blocked'; result.failureCode = 'api-unavailable'; return result; }

  const endpoint: EndpointId | null = makeEndpointId('e91-local');
  const networkId = makeNetworkId(`custom:${new URL(config.wssUrl).origin}${new URL(config.wssUrl).pathname}`);
  if (!endpoint || !networkId) { result.status = 'blocked'; result.failureCode = 'invalid-config'; return result; }
  let owner = newOwner(networkId, null, 1);
  let learnedServerPrefix: string | null = null;
  let connectionMode: ConnectionMode | null = 'wt';
  let connectionProof: ConnectionProof | null = null;
  let expectedWssOwner: OwnerSnapshot | null = null;
  let wssLive = false;
  const lines: string[] = [];
  let lineFloor = 0;
  const wtDriverRef: { current: AlternativeDriver | null } = { current: null };
  let wtIntentOwner: OwnerSnapshot | null = null;
  let wtOpened = false;
  const currentLines = () => lines.slice(lineFloor);
  const pushLine = (line: string, lineOwner: OwnerSnapshot) => {
    const active = connectionProof;
    if (lines.length < MAX_LINES && active && samePhysicalAttempt(active.owner, lineOwner)) {
      if (active.issuer !== null && active.nick !== null) {
        const prefixMap = prefixMapFromIsupport(line, active.issuer, active.nick);
        if (prefixMap !== undefined) active.prefixMap = prefixMap;
      }
      lines.push(line);
    }
  };
  const transport = createTransportOwner({
    currentOwner: () => owner,
    isCurrentOwner: snapshot => sameOwner(owner, snapshot),
    authenticatedPrefix: () => learnedServerPrefix,
    endpoint: () => endpoint,
    consumePrivateLine: () => false,
    onWelcomeCandidate: (line, candidateOwner) => {
      const proof = connectionProof;
      const parsed = parseIRCMessage(line);
      if (proof && proof.issuer && proof.nick && samePhysicalAttempt(proof.owner, candidateOwner)
        && parsed.command === '001' && parsed.prefix === proof.issuer && parsed.params[0] === proof.nick) {
        learnedServerPrefix = proof.issuer;
      }
    },
    onPublicLine: (line, lineOwner) => pushLine(line, lineOwner),
    onBinary: () => undefined,
    onState: (state, stateOwner) => {
      const expected = expectedWssOwner;
      if (connectionMode !== 'wss' || !expected || !samePhysicalAttempt(expected, stateOwner)) return;
      if (state === 'live') wssLive = true;
      else if (state === 'offline') wssLive = false;
    },
  });
  const adapter = createWebTransportAdapter({
    ownerSnapshot: () => owner,
    isCurrent: snapshot => sameOwner(owner, snapshot),
    fallbackWss: async () => undefined,
    isTrustedWebTransportUrl: (url, id) => id === endpoint && url.href === new URL(config.wtUrl).href,
    createConnection: url => {
      const connection = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: decodeHash(config.certificateSha256Hex) }] });
      return connection as unknown as WebTransportLike;
    },
  });
  const send = (line: string, captured: OwnerSnapshot = owner) => transport.sendLine({ line, owner: captured, requestId: requestId() });
  const sendAdmitted = (line: string, captured: OwnerSnapshot = owner): boolean => send(line, captured).kind === 'transport-admitted';
  const waitLine = async (pred: (parsed: ReturnType<typeof parseIRCMessage>) => boolean, timeout = 8_000) =>
    waitFor(() => currentLines().some(line => pred(parseIRCMessage(line))), timeout);
  const requestCapList = async (captured: OwnerSnapshot): Promise<CapList> => {
    lineFloor = lines.length;
    if (!sendAdmitted('CAP LS 302', captured)) return { kind: 'invalid' };
    const finished = await waitFor(() => readCapList(currentLines()).kind !== 'pending', 6_000);
    return finished ? readCapList(currentLines()) : { kind: 'pending' };
  };
  const requestCapabilities = async (
    captured: OwnerSnapshot, issuer: string, requested: readonly string[],
  ): Promise<CapRequest> => {
    lineFloor = lines.length;
    if (!sendAdmitted(`CAP REQ :${requested.join(' ')}`, captured)) return 'unknown';
    const finished = await waitFor(() => capRequestReply(currentLines(), issuer, requested) !== 'pending', 6_000);
    return finished ? capRequestReply(currentLines(), issuer, requested) : 'unknown';
  };

  let cleanupFailed = false;
  try {
    result.stage = 'wt-connect';
    const wtIntent: TransportConnectIntent = {
      schemaVersion: 1, requestId: requestId(), owner, url: config.wtUrl, endpoint,
    };
    const wtProof: ConnectionProof = { mode: 'wt', owner, nick: null, issuer: null, prefixMap: null };
    connectionProof = wtProof;
    wtIntentOwner = owner;
    const wtAdmission = transport.connectAlternative({
      owner, endpoint, requestId: wtIntent.requestId,
      open: sink => {
        const driver = adapter.open(wtIntent, {
          opened: () => { wtOpened = true; sink.opened(); },
          line: value => sink.line(value), closed: () => sink.closed(),
        });
        wtDriverRef.current = driver;
        return driver;
      },
    });
    if (wtAdmission.kind !== 'transport-admitted') {
      result.failureCode = wtAdmission.kind === 'blocked' && wtAdmission.reason === 'offline' ? 'wt-connect-unknown' : 'owner-fence-failed';
      result.status = 'unknown';
    } else if (!(await waitFor(() => wtOpened, 12_000))) {
      result.failureCode = 'wt-connect-unknown'; result.status = 'unknown';
    } else {
      result.wt.ready = true;
      result.stage = 'wt-registration';
      const wtCaps = await requestCapList(owner);
      if (wtCaps.kind !== 'complete') {
        result.failureCode = 'wt-registration-timeout'; result.status = 'unknown';
      } else {
        wtProof.issuer = wtCaps.issuer;
        result.wt.saslMechanisms = safeMechanisms(wtCaps.capabilities);
        const wtEchoAdvertised = hasCapability(wtCaps.capabilities, 'echo-message');
        result.wt.echoAdvertised = wtEchoAdvertised;
        if (wtEchoAdvertised) {
          result.wt.echoRequest = 'unknown';
          const echoRequest = await requestCapabilities(owner, wtCaps.issuer, ['echo-message']);
          result.wt.echoRequest = echoRequest === 'acknowledged' ? 'acknowledged'
            : echoRequest === 'refused' ? 'refused' : 'unknown';
        }
        const wtEchoNegotiated = result.wt.echoAdvertised === true && result.wt.echoRequest === 'acknowledged';
        const wtNick = `E91Guest${randomRef().slice(0, 6)}`;
        wtProof.nick = wtNick;
        const wtPrerequisitesSent = sendAdmitted(`NICK ${wtNick}`, owner)
          && sendAdmitted('USER e91 0 * :Onyx E91 investigation', owner)
          && sendAdmitted('CAP END', owner);
        if (!wtPrerequisitesSent) {
          result.failureCode = 'wt-registration-timeout'; result.status = 'unknown';
        } else if (await waitLine(p => exactOwnNumeric(p, '001', wtCaps.issuer, wtNick), 12_000)) {
          result.wt.registration = 'registered';
          result.stage = 'wt-framing';
          const ping = `e91-${randomRef()}`;
          lineFloor = lines.length;
          if (sendAdmitted(`PING :${ping}`, owner)) {
            result.wt.rawPingPong = await waitLine(p => p.command === 'PONG' && p.prefix === wtCaps.issuer
              && p.params[p.params.length - 1] === ping, 6_000);
          } else result.wt.rawPingPong = false;
          if (result.wt.rawPingPong) {
            result.stage = 'auth-policy';
            lineFloor = lines.length;
            if (sendAdmitted('SESSIONTOKEN', owner)) {
              // The server emits this bare FAIL regardless of standard-replies.
              const refused = await waitLine(p => connectionProof === wtProof
                && sameOwner(owner, wtProof.owner)
                && wtProof.issuer === wtCaps.issuer
                && learnedServerPrefix === wtCaps.issuer
                && p.command === 'FAIL' && p.prefix === null
                && p.params.length === 3
                && p.params[0] === 'SESSIONTOKEN'
                && p.params[1] === 'INSECURE_TRANSPORT'
                && p.params[2] === 'Session tokens require a secure connection', 6_000);
              result.wt.sessionToken = refused ? 'source-refused' : 'unknown';
              if (refused) result.status = 'completed';
              else { result.status = 'unknown'; result.failureCode = 'wt-framing-timeout'; }
            } else {
              result.wt.sessionToken = 'unknown'; result.status = 'unknown'; result.failureCode = 'wt-framing-timeout';
            }
            if (wtEchoNegotiated) {
              result.stage = 'wt-framing';
              lineFloor = lines.length;
              if (sendAdmitted(`JOIN ${config.room}`, owner)) {
                const joined = await waitFor(() => {
                  const prefixMap = wtProof.prefixMap;
                  return prefixMap !== null
                    && hasNamesJoinProof(currentLines(), wtCaps.issuer, wtNick, config.room, prefixMap);
                }, 8_000);
                if (joined) {
                  const wtCanary = `e91-${randomRef()}`;
                  lineFloor = lines.length;
                  if (sendAdmitted(`PRIVMSG ${config.room} :${wtCanary}`, owner)) {
                    result.wt.textCanary = await waitLine(p => isOwnRoomCanary(p, wtNick, config.room, wtCanary), 8_000);
                  } else result.wt.textCanary = false;
                } else {
                  result.failureCode = result.failureCode ?? 'wt-framing-timeout'; result.status = 'unknown';
                }
              } else {
                result.wt.textCanary = false;
                result.failureCode = result.failureCode ?? 'wt-framing-timeout'; result.status = 'unknown';
              }
              if (result.wt.textCanary === false) {
                result.failureCode = result.failureCode ?? 'wt-framing-timeout'; result.status = 'unknown';
              }
            } else {
              result.stage = 'wt-framing';
              result.failureCode = result.failureCode ?? 'wt-framing-timeout'; result.status = 'unknown';
            }
          } else {
            result.status = 'unknown'; result.failureCode = result.failureCode ?? 'wt-framing-timeout';
          }
        } else {
          result.wt.registration = 'unknown'; result.status = 'unknown'; result.failureCode = 'wt-registration-timeout';
        }
      }
    }

    result.stage = 'wss-fallback';
    fallbackButton.hidden = false;
    statusNode.textContent = 'WebTransport observation complete. Confirm a new trusted WSS connection to continue.';
    const confirmed = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { fallbackButton.removeEventListener('click', onClick); resolve(false); }, 120_000);
      const onClick = () => { clearTimeout(timer); fallbackButton.removeEventListener('click', onClick); resolve(true); };
      fallbackButton.addEventListener('click', onClick, { once: true });
    });
    fallbackButton.hidden = true;
    if (!confirmed) {
      result.status = 'unknown'; result.failureCode = 'fallback-not-confirmed';
      return result;
    }

    const beforeWss = owner;
    owner = newOwner(networkId, null, beforeWss.connectionGeneration + 1);
    result.fallback.freshOwner = !sameOwner(beforeWss, owner)
      && owner.connectionGeneration > beforeWss.connectionGeneration && owner.physicalRef !== beforeWss.physicalRef;
    if (!result.fallback.freshOwner) { result.failureCode = 'owner-fence-failed'; result.status = 'unknown'; return result; }

    learnedServerPrefix = null;
    connectionMode = 'wss';
    wssLive = false;
    expectedWssOwner = owner;
    const wssNick = `E91Wss${randomRef().slice(0, 6)}`;
    const wssProof: ConnectionProof = { mode: 'wss', owner, nick: wssNick, issuer: null, prefixMap: null };
    connectionProof = wssProof;
    lineFloor = lines.length;
    const wssAdmission = transport.connect(config.wssUrl);
    if (wssAdmission.kind !== 'transport-admitted') {
      result.status = 'unknown'; result.failureCode = 'wss-connect-unknown'; return result;
    }
    if (!(await waitFor(() => wssLive, 10_000))) {
      result.status = 'unknown'; result.failureCode = 'wss-connect-unknown'; return result;
    }
    result.wss.ready = true;

    const wssCaps = await requestCapList(owner);
    if (wssCaps.kind !== 'complete') {
      result.status = 'unknown'; result.failureCode = 'wss-sasl-unavailable'; return result;
    }
    wssProof.issuer = wssCaps.issuer;
    result.wss.saslMechanisms = safeMechanisms(wssCaps.capabilities);
    if (!result.wss.saslMechanisms.includes('PLAIN')) {
      result.wss.auth = 'refused'; result.status = 'completed'; result.failureCode = 'wss-sasl-unavailable';
      return result;
    }
    const wssEchoAdvertised = hasCapability(wssCaps.capabilities, 'echo-message');
    const wssCapabilities = wssEchoAdvertised ? ['sasl', 'echo-message'] : ['sasl'];
    const capRequest = await requestCapabilities(owner, wssCaps.issuer, wssCapabilities);
    if (capRequest !== 'acknowledged') {
      const refused = capRequest === 'refused';
      result.wss.auth = refused ? 'refused' : 'unknown';
      result.status = refused ? 'completed' : 'unknown';
      result.failureCode = 'wss-sasl-unavailable';
      return result;
    }
    const wssPrerequisitesSent = sendAdmitted(`NICK ${wssNick}`, owner)
      && sendAdmitted('USER e91 0 * :Onyx E91 investigation', owner);
    if (!wssPrerequisitesSent) {
      result.status = 'unknown'; result.failureCode = 'wss-registration-timeout'; return result;
    }

    lineFloor = lines.length;
    if (!sendAdmitted('AUTHENTICATE PLAIN', owner)) {
      result.status = 'unknown'; result.failureCode = 'wss-auth-refused'; return result;
    }
    const challengeSeen = await waitLine(p => p.command === 'AUTHENTICATE' && p.prefix === null
      && p.params.length === 1 && p.params[0] === '+', 6_000);
    if (!challengeSeen) {
      const sourceRefusal = currentLines().some(line => {
        const parsed = parseIRCMessage(line);
        return exactOwnNumeric(parsed, '904', wssCaps.issuer, wssNick);
      });
      result.wss.auth = sourceRefusal ? 'refused' : 'unknown';
      result.status = sourceRefusal ? 'completed' : 'unknown';
      result.failureCode = 'wss-auth-refused'; return result;
    }

    const secretBytes = encoder.encode(`${config.account}\u0000${config.account}\u0000${config.password}`);
    try {
      let binary = '';
      for (const byte of secretBytes) binary += String.fromCharCode(byte);
      const admission = send(`AUTHENTICATE ${btoa(binary)}`, owner);
      binary = '';
      if (admission.kind !== 'transport-admitted') {
        result.status = 'unknown'; result.failureCode = 'wss-auth-refused'; return result;
      }
    } finally { secretBytes.fill(0); }

    const saslComplete = await waitFor(() => {
      const replies = currentLines().map(line => parseIRCMessage(line));
      const accountNumeric = replies.some(parsed => parsed.command === '900' && parsed.prefix === wssCaps.issuer
        && parsed.params[0] === wssNick && parsed.params[1] === wssNick
        && sameIrcName(parsed.params[2], config.account));
      const successNumeric = replies.some(parsed => exactOwnNumeric(parsed, '903', wssCaps.issuer, wssNick));
      return accountNumeric && successNumeric;
    }, 8_000);
    if (!saslComplete) {
      const sourceRefusal = currentLines().some(line => exactOwnNumeric(parseIRCMessage(line), '904', wssCaps.issuer, wssNick));
      result.wss.auth = sourceRefusal ? 'refused' : 'unknown';
      result.status = sourceRefusal ? 'completed' : 'unknown';
      result.failureCode = 'wss-auth-refused'; return result;
    }

    const accountId = makeAccountId(config.account);
    if (!accountId) { result.status = 'unknown'; result.failureCode = 'invalid-config'; return result; }
    const oldAuthOwner = owner;
    owner = Object.freeze({ ...owner, accountId, accountGeneration: makeAccountGeneration(oldAuthOwner.accountGeneration + 1) }) as OwnerSnapshot;
    result.wss.auth = 'authenticated';
    if (!sendAdmitted('CAP END', owner)) {
      result.status = 'unknown'; result.failureCode = 'wss-registration-timeout'; return result;
    }
    if (!(await waitLine(p => exactOwnNumeric(p, '001', wssCaps.issuer, wssNick), 10_000))) {
      result.status = 'unknown'; result.failureCode = 'wss-registration-timeout'; return result;
    }

    lineFloor = lines.length;
    if (!sendAdmitted(`JOIN ${config.room}`, owner)) {
      result.wss.joined = false; result.status = 'unknown'; result.failureCode = 'wss-join-refused'; return result;
    }
    const joined = await waitFor(() => {
      const prefixMap = wssProof.prefixMap;
      return prefixMap !== null
        && hasNamesJoinProof(currentLines(), wssCaps.issuer, wssNick, config.room, prefixMap);
    }, 8_000);
    result.wss.joined = joined;
    if (!joined) { result.status = 'unknown'; result.failureCode = 'wss-join-refused'; return result; }

    const canary = `e91-${randomRef()}`;
    lineFloor = lines.length;
    if (!sendAdmitted(`PRIVMSG ${config.room} :${canary}`, owner)) {
      result.wss.canaryEcho = false; result.status = 'unknown'; result.failureCode = 'wss-canary-timeout'; return result;
    }
    const echoReceived = await waitLine(p => isOwnRoomCanary(p, wssNick, config.room, canary), 8_000);
    const staleDriver = wtDriverRef.current;
    if (wtIntentOwner && staleDriver) {
      const staleAdmission = staleDriver.sendLine({ line: `PRIVMSG ${config.room} :${canary}`, owner: wtIntentOwner, requestId: requestId() });
      result.fallback.staleWtBlocked = staleAdmission.kind === 'blocked' && staleAdmission.reason === 'owner-changed';
    }
    const barrier = `e91-${randomRef()}`;
    const barrierSent = sendAdmitted(`PING :${barrier}`, owner);
    const barrierSeen = barrierSent && await waitLine(p => p.command === 'PONG' && p.prefix === wssCaps.issuer
      && p.params[p.params.length - 1] === barrier, 6_000);
    if (barrierSeen) {
      const echoCount = currentLines().filter(line => isOwnRoomCanary(parseIRCMessage(line), wssNick, config.room, canary)).length;
      result.wss.canaryEcho = echoCount > 0;
      if (result.fallback.staleWtBlocked === true) result.fallback.canaryExactlyOnce = echoCount === 1;
    } else {
      result.wss.canaryEcho = echoReceived ? true : null;
    }
    if (result.fallback.staleWtBlocked !== true) {
      result.status = 'unknown'; result.failureCode = 'owner-fence-failed'; return result;
    }
    if (!barrierSeen || result.fallback.canaryExactlyOnce !== true) {
      result.status = 'unknown'; result.failureCode = 'wss-canary-timeout'; return result;
    }
    result.status = result.failureCode === null ? 'completed' : 'unknown';
    return result;
  } catch {
    result.status = 'unknown';
    if (!result.failureCode) result.failureCode = result.stage === 'wt-connect' ? 'wt-connect-unknown' : 'cleanup-incomplete';
    return result;
  } finally {
    try { adapter.dispose(); } catch { cleanupFailed = true; }
    try { transport.dispose(); } catch { cleanupFailed = true; }
    result.stage = 'cleanup';
    if (cleanupFailed) { result.status = 'unknown'; result.failureCode = 'cleanup-incomplete'; }
  }
}

async function runFromButton(config: E91ProbeConfig): Promise<ProbeResult> {
  runButton.disabled = true;
  statusNode.textContent = 'Running bounded WebTransport investigation.';
  resultNode.textContent = '';
  try {
    const result = await runProbe(config);
    const safe = JSON.stringify(result);
    resultNode.textContent = safe;
    statusNode.textContent = `Investigation ${result.status}; ${result.stage}.`;
    return result;
  } finally { runButton.disabled = false; }
}

(window as ProbeWindow).__runOnyxE91Probe = runFromButton;
runButton.addEventListener('click', () => {
  statusNode.textContent = 'Waiting for private runner configuration.';
});
