// SPDX-License-Identifier: AGPL-3.0-or-later
import { open } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseIRCMessage, splitWireFrame } from '../../src/lib/irc/parser';

type SafeProbeResult = {
  schemaVersion: 2;
  status: 'completed' | 'unknown' | 'blocked';
  stage: 'wt-connect' | 'wt-registration' | 'wt-framing' | 'auth-policy' | 'wss-fallback' | 'cleanup';
  failureCode: string | null;
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

type ProbeWindow = Window & {
  __runOnyxE91Probe?: (config: {
    wtUrl: string;
    wssUrl: string;
    certificateSha256Hex: string;
    account: string;
    password: string;
    room: string;
  }) => Promise<unknown>;
  __e91ResultPromise?: Promise<unknown>;
};

const SASL_MECHANISMS = new Set([
  'PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512', 'SCRAM-SHA-256-PLUS', 'SCRAM-SHA-512-PLUS',
  'EXTERNAL', 'SESSION-TOKEN', 'OAUTHBEARER', 'ANONYMOUS',
]);
const FAILURE_CODES = new Set([
  'invalid-config', 'insecure-context', 'api-unavailable', 'wt-connect-unknown',
  'wt-registration-timeout', 'wt-framing-timeout', 'wss-connect-unknown',
  'wss-sasl-unavailable', 'wss-auth-refused', 'wss-registration-timeout',
  'wss-join-refused', 'wss-canary-timeout', 'fallback-not-confirmed',
  'owner-fence-failed', 'cleanup-incomplete',
]);
const RESULT_STAGES = new Set(['wt-connect', 'wt-registration', 'wt-framing', 'auth-policy', 'wss-fallback', 'cleanup']);

const origin = process.env.ONYX_E91_ORIGIN;
const wtUrl = process.env.ONYX_E91_WT_URL;
const wssUrl = process.env.ONYX_E91_WSS_URL;
const certificateSha256Hex = process.env.ONYX_E91_CERT_SHA256_HEX;
const account = process.env.ONYX_E91_ACCOUNT;
const password = process.env.ONYX_E91_PASSWORD;
const room = process.env.ONYX_E91_ROOM;
const resultPath = process.env.ONYX_E91_RESULT;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function safeMechanismList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 9
    && value.every(item => typeof item === 'string' && SASL_MECHANISMS.has(item));
}

function sanitizeProbe(value: unknown): SafeProbeResult {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'status', 'stage', 'failureCode', 'wt', 'wss', 'fallback', 'externalParity'])
    || value.schemaVersion !== 2
    || (value.status !== 'completed' && value.status !== 'unknown' && value.status !== 'blocked')
    || typeof value.stage !== 'string' || !RESULT_STAGES.has(value.stage)
    || (value.failureCode !== null && (typeof value.failureCode !== 'string' || !FAILURE_CODES.has(value.failureCode)))
    || value.externalParity !== false
    || !isRecord(value.wt)
    || !hasExactKeys(value.wt, ['ready', 'registration', 'rawPingPong', 'textCanary', 'echoAdvertised', 'echoRequest', 'saslMechanisms', 'plainProbe', 'sessionToken'])
    || typeof value.wt.ready !== 'boolean'
    || (value.wt.registration !== 'registered' && value.wt.registration !== 'unknown' && value.wt.registration !== 'blocked')
    || !nullableBoolean(value.wt.rawPingPong) || !nullableBoolean(value.wt.textCanary) || !nullableBoolean(value.wt.echoAdvertised)
    || (value.wt.echoRequest !== 'not-attempted' && value.wt.echoRequest !== 'acknowledged'
      && value.wt.echoRequest !== 'refused' && value.wt.echoRequest !== 'unknown')
    || (value.wt.echoAdvertised !== true && value.wt.echoRequest !== 'not-attempted')
    || (value.wt.echoAdvertised === true && value.wt.echoRequest === 'not-attempted')
    || !safeMechanismList(value.wt.saslMechanisms)
    || (value.wt.plainProbe !== 'not-sent' && value.wt.plainProbe !== 'challenge-no-secret-sent'
      && value.wt.plainProbe !== 'source-refused' && value.wt.plainProbe !== 'unknown')
    || (value.wt.sessionToken !== 'not-attempted' && value.wt.sessionToken !== 'source-refused' && value.wt.sessionToken !== 'unknown')
    || !isRecord(value.wss)
    || !hasExactKeys(value.wss, ['ready', 'auth', 'saslMechanisms', 'joined', 'canaryEcho'])
    || typeof value.wss.ready !== 'boolean'
    || (value.wss.auth !== 'authenticated' && value.wss.auth !== 'unknown' && value.wss.auth !== 'refused')
    || !safeMechanismList(value.wss.saslMechanisms)
    || !nullableBoolean(value.wss.joined) || !nullableBoolean(value.wss.canaryEcho)
    || !isRecord(value.fallback)
    || !hasExactKeys(value.fallback, ['explicitOnly', 'freshOwner', 'staleWtBlocked', 'canaryExactlyOnce'])
    || value.fallback.explicitOnly !== true
    || !nullableBoolean(value.fallback.freshOwner) || !nullableBoolean(value.fallback.staleWtBlocked)
    || !nullableBoolean(value.fallback.canaryExactlyOnce)) {
    throw new Error('e91-result-invalid');
  }

  return {
    schemaVersion: 2,
    status: value.status as SafeProbeResult['status'],
    stage: value.stage as SafeProbeResult['stage'],
    failureCode: value.failureCode as string | null,
    wt: {
      ready: value.wt.ready,
      registration: value.wt.registration as SafeProbeResult['wt']['registration'],
      rawPingPong: value.wt.rawPingPong,
      textCanary: value.wt.textCanary,
      echoAdvertised: value.wt.echoAdvertised,
      echoRequest: value.wt.echoRequest as SafeProbeResult['wt']['echoRequest'],
      saslMechanisms: [...value.wt.saslMechanisms],
      plainProbe: value.wt.plainProbe as SafeProbeResult['wt']['plainProbe'],
      sessionToken: value.wt.sessionToken as SafeProbeResult['wt']['sessionToken'],
    },
    wss: {
      ready: value.wss.ready,
      auth: value.wss.auth as SafeProbeResult['wss']['auth'],
      saslMechanisms: [...value.wss.saslMechanisms],
      joined: value.wss.joined,
      canaryEcho: value.wss.canaryEcho,
    },
    fallback: {
      explicitOnly: true,
      freshOwner: value.fallback.freshOwner,
      staleWtBlocked: value.fallback.staleWtBlocked,
      canaryExactlyOnce: value.fallback.canaryExactlyOnce,
    },
    externalParity: false,
  };
}

function isLocalEndpoint(value: string | undefined, protocol: 'https:' | 'wss:'): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === protocol && url.hostname === '127.0.0.1' && Number(url.port) > 0
      && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

type WssWireProof = {
  attempts: number;
  beforeConfirmation: number;
  afterConfirmation: number;
  capLsComplete: boolean;
  capLsAdvertisedSasl: boolean;
  capLsAdvertisedEcho: boolean;
  capReqSaslAndEcho: boolean;
  capAckSaslAndEcho: boolean;
  plainChallenge: boolean;
  saslSuccess: boolean;
  accountNumeric: boolean;
  nickAndUserSent: boolean;
  capEndAfterAuth: boolean;
  welcomeMatched: boolean;
  joinSent: boolean;
  ownJoinObserved: boolean;
  endNamesMatched: boolean;
  oneOwnCanaryEcho: boolean;
  pingPongBarrierAfterEcho: boolean;
};

function completeWssWireProof(proof: WssWireProof): boolean {
  return proof.attempts === 1 && proof.beforeConfirmation === 0 && proof.afterConfirmation === 1
    && proof.capLsComplete && proof.capLsAdvertisedSasl && proof.capLsAdvertisedEcho
    && proof.capReqSaslAndEcho && proof.capAckSaslAndEcho && proof.plainChallenge
    && proof.saslSuccess && proof.accountNumeric && proof.nickAndUserSent && proof.capEndAfterAuth
    && proof.welcomeMatched && proof.joinSent && proof.ownJoinObserved && proof.endNamesMatched
    && proof.oneOwnCanaryEcho && proof.pingPongBarrierAfterEcho;
}

type SubscribeFrames = (listener: (payload: unknown) => void) => void;

function makeWssWireObserver(expectedUrl: string, accountName: string, targetRoom: string, confirmed: () => boolean) {
  const proof: WssWireProof = {
    attempts: 0, beforeConfirmation: 0, afterConfirmation: 0,
    capLsComplete: false, capLsAdvertisedSasl: false, capLsAdvertisedEcho: false,
    capReqSaslAndEcho: false, capAckSaslAndEcho: false, plainChallenge: false,
    saslSuccess: false, accountNumeric: false, nickAndUserSent: false,
    capEndAfterAuth: false, welcomeMatched: false, joinSent: false,
    ownJoinObserved: false, endNamesMatched: false, oneOwnCanaryEcho: false,
    pingPongBarrierAfterEcho: false,
  };
  let issuer: string | null = null;
  let nick: string | null = null;
  let capReqSent = false;
  let userSent = false;
  let authMechanismSent = false;
  let authChallengeSeen = false;
  let authDataSent = false;
  let saslSuccessSeen = false;
  let accountNumericSeen = false;
  let capEndAfterAuth = false;
  let welcomeSeen = false;
  let joinRequested = false;
  let namesFinished = false;
  let ownCanary: string | null = null;
  let ownCanarySent = 0;
  let ownCanaryEchoes = 0;
  let barrierToken: string | null = null;
  let barrierPingSent = false;
  let barrierPingCount = 0;
  let barrierPongCount = 0;
  let echoCountAtBarrier = 0;

  const capNames = (values: readonly string[]) => values.join(' ').split(/\s+/u)
    .filter(Boolean).filter(value => !value.startsWith('-')).map(value => value.split('=', 1)[0]?.toLowerCase() ?? '');
  const outboundCapMessage = (message: ReturnType<typeof parseIRCMessage>) => {
    const targetOffset = message.params[0] === '*' ? 1 : 0;
    return {
      targetOffset,
      subcommand: message.params[targetOffset]?.toUpperCase() ?? '',
      values: message.params.slice(targetOffset + 1),
    };
  };
  const ownCapTarget = (value: string | undefined) => value === '*' || (nick !== null && value === nick);

  function observeLine(direction: 'sent' | 'received', line: string): void {
    const message = parseIRCMessage(line);
    if (!message.command) return;
    const params = message.params;

    if (direction === 'sent') {
      if (message.command === 'CAP') {
        const cap = outboundCapMessage(message);
        const names = capNames(cap.values);
        if (cap.subcommand === 'REQ') {
          proof.capReqSaslAndEcho = names.includes('sasl') && names.includes('echo-message');
          capReqSent = proof.capReqSaslAndEcho;
        }
        if (cap.subcommand === 'END') {
          capEndAfterAuth = nick !== null && userSent && saslSuccessSeen && accountNumericSeen;
          proof.capEndAfterAuth = capEndAfterAuth;
        }
      }
      if (message.command === 'NICK' && params[0] && /^[A-Za-z][A-Za-z0-9_-]{0,30}$/u.test(params[0])) {
        nick = params[0];
      }
      if (message.command === 'USER' && params.length === 4 && /^[A-Za-z0-9_-]{1,32}$/u.test(params[0] ?? '')
        && params[1] === '0' && params[2] === '*' && Boolean(params[3])) userSent = true;
      if (message.command === 'AUTHENTICATE') {
        const payload = params[0] ?? '';
        if (payload.toUpperCase() === 'PLAIN' && proof.capAckSaslAndEcho && nick !== null) authMechanismSent = true;
        else if (authChallengeSeen && payload !== '+' && /^[A-Za-z0-9+/]+={0,2}$/u.test(payload)) authDataSent = true;
      }
      if (message.command === 'JOIN' && params[0] === targetRoom && welcomeSeen) {
        proof.joinSent = true;
        joinRequested = true;
      }
      if (message.command === 'PRIVMSG' && params[0] === targetRoom && joinRequested && namesFinished) {
        const body = params[1] ?? '';
        if (/^e91-[A-Za-z0-9_-]{24}$/u.test(body)) {
          ownCanary = body;
          ownCanarySent += 1;
        }
      }
      if (message.command === 'PING' && ownCanaryEchoes > 0) {
        const token = params.at(-1);
        if (token && /^e91-[A-Za-z0-9_-]{24}$/u.test(token) && token !== ownCanary) {
          barrierToken = token;
          barrierPingSent = true;
          barrierPingCount += 1;
          if (barrierPingCount > 1) proof.pingPongBarrierAfterEcho = false;
        }
      }
      return;
    }

    if (message.command === 'CAP') {
      const subcommand = params[1]?.toUpperCase() ?? '';
      const target = params[0];
      const issuerMatches = Boolean(message.prefix && (issuer === null || message.prefix === issuer));
      if (subcommand === 'LS' && ownCapTarget(target) && issuerMatches && message.prefix) {
        if (issuer === null) issuer = message.prefix;
        const continuation = params[2] === '*';
        const names = capNames(continuation ? params.slice(3) : params.slice(2));
        proof.capLsAdvertisedSasl ||= names.includes('sasl');
        proof.capLsAdvertisedEcho ||= names.includes('echo-message');
        if (!continuation) proof.capLsComplete = true;
      }
      if (subcommand === 'ACK' && ownCapTarget(target) && issuer !== null && message.prefix === issuer
        && capReqSent && proof.capReqSaslAndEcho && proof.capLsComplete
        && proof.capLsAdvertisedSasl && proof.capLsAdvertisedEcho) {
        const names = capNames(params.slice(2));
        if (names.includes('sasl') && names.includes('echo-message')) proof.capAckSaslAndEcho = true;
      }
      return;
    }

    if (message.command === 'AUTHENTICATE' && message.prefix === null && params[0] === '+'
      && authMechanismSent && !authChallengeSeen) {
      proof.plainChallenge = true;
      authChallengeSeen = true;
      return;
    }
    if (message.command === '903' && issuer !== null && message.prefix === issuer && nick !== null
      && params[0] === nick && authMechanismSent && authChallengeSeen && authDataSent) {
      proof.saslSuccess = true;
      saslSuccessSeen = true;
      return;
    }
    if (message.command === '900' && issuer !== null && message.prefix === issuer && nick !== null
      && params[0] === nick && params[1] === nick && params[2] === accountName
      && authMechanismSent && authChallengeSeen && authDataSent) {
      proof.accountNumeric = true;
      accountNumericSeen = true;
      return;
    }
    if (message.command === '001' && issuer !== null && message.prefix === issuer && nick !== null
      && params[0] === nick && userSent && capEndAfterAuth && proof.capEndAfterAuth
      && proof.saslSuccess && proof.accountNumeric) {
      proof.nickAndUserSent = true;
      proof.welcomeMatched = true;
      welcomeSeen = true;
      return;
    }
    if (message.command === 'JOIN' && nick !== null && message.prefix?.includes('!')
      && message.nick === nick && params[0] === targetRoom && welcomeSeen) {
      proof.ownJoinObserved = true;
      return;
    }
    if (message.command === '366' && issuer !== null && message.prefix === issuer && nick !== null
      && params[0] === nick && params[1] === targetRoom && joinRequested) {
      proof.endNamesMatched = true;
      namesFinished = true;
      return;
    }
    if (message.command === 'PRIVMSG' && nick !== null && message.prefix?.includes('!')
      && message.nick === nick && params[0] === targetRoom
      && ownCanary !== null && params[1] === ownCanary && proof.ownJoinObserved && proof.endNamesMatched) {
      ownCanaryEchoes += 1;
      proof.oneOwnCanaryEcho = ownCanarySent === 1 && ownCanaryEchoes === 1;
      return;
    }
    if (message.command === 'PONG' && issuer !== null && message.prefix === issuer && barrierToken !== null
      && params.at(-1) === barrierToken && barrierPingSent && ownCanaryEchoes > 0) {
      echoCountAtBarrier = ownCanaryEchoes;
      barrierPongCount += 1;
      proof.pingPongBarrierAfterEcho = barrierPingCount === 1 && barrierPongCount === 1
        && echoCountAtBarrier === 1 && ownCanarySent === 1;
    }
  }

  function attach(url: string, addSent: SubscribeFrames, addReceived: SubscribeFrames): void {
    let matchesExpectedUrl = false;
    try { matchesExpectedUrl = new URL(url).href === new URL(expectedUrl).href; } catch { return; }
    if (!matchesExpectedUrl) return;
    proof.attempts += 1;
    if (confirmed()) proof.afterConfirmation += 1;
    else proof.beforeConfirmation += 1;
    addSent(payload => {
      if (typeof payload !== 'string') return;
      for (const line of splitWireFrame(payload)) observeLine('sent', line);
    });
    addReceived(payload => {
      if (typeof payload !== 'string') return;
      for (const line of splitWireFrame(payload)) observeLine('received', line);
    });
  }

  return { proof, attach };
}

async function readProbe(page: import('@playwright/test').Page): Promise<SafeProbeResult> {
  let raw: unknown;
  try {
    raw = await page.evaluate(async () => (window as ProbeWindow).__e91ResultPromise ?? null);
  } catch { throw new Error('e91-probe-result-unavailable'); }
  return sanitizeProbe(raw);
}

async function writeSafeResult(path: string, result: SafeProbeResult): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(result)}\n`, 'utf8');
    await handle.sync();
  } catch { throw new Error('e91-result-write-failed'); }
  finally { await handle?.close().catch(() => undefined); }
}

test('actual-server WebTransport policy and explicit fresh WSS fallback', async ({ page }) => {
  test.setTimeout(150_000);
  if (!isLocalEndpoint(origin, 'https:') || !isLocalEndpoint(wtUrl, 'https:') || !isLocalEndpoint(wssUrl, 'wss:')
    || !certificateSha256Hex || !/^[a-f0-9]{64}$/u.test(certificateSha256Hex)
    || !account || !/^[A-Za-z][A-Za-z0-9_-]{0,30}$/u.test(account)
    || !password || password.length === 0 || !room || !/^#[A-Za-z0-9_-]{1,48}$/u.test(room)
    || !resultPath || !resultPath.startsWith('/tmp/')) {
    throw new Error('e91-lab-configuration-invalid');
  }

  let confirmationStarted = false;
  const wire = makeWssWireObserver(wssUrl, account, room, () => confirmationStarted);
  page.on('websocket', socket => {
    wire.attach(
      socket.url(),
      listener => socket.on('framesent', event => listener(event.payload)),
      listener => socket.on('framereceived', event => listener(event.payload)),
    );
  });

  try {
    await page.goto(`${origin}/elm/tools/transport/webtransport-server-investigation.html`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('e91-run').waitFor({ state: 'visible' });
  } catch { throw new Error('e91-page-load-failed'); }

  try {
    await page.evaluate(input => {
      const probe = (window as ProbeWindow).__runOnyxE91Probe;
      if (!probe) throw new Error('e91-probe-unavailable');
      (window as ProbeWindow).__e91ResultPromise = probe(input);
    }, {
      wtUrl, wssUrl, certificateSha256Hex, account, password, room,
    });
  } catch { throw new Error('e91-probe-start-failed'); }

  const fallback = page.getByTestId('e91-confirm-wss-fallback');
  let gate: 'confirmation' | 'terminal';
  try {
    const handle = await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="e91-confirm-wss-fallback"]');
      if (button && !button.hidden && !button.disabled) return 'confirmation';
      const result = document.querySelector('[data-testid="e91-result"]');
      if (result?.textContent?.trim()) return 'terminal';
      return false;
    }, undefined, { timeout: 90_000 });
    gate = await handle.jsonValue() as 'confirmation' | 'terminal';
    await handle.dispose();
  } catch { throw new Error('e91-fallback-state-timeout'); }

  if (gate === 'terminal') {
    const result = await readProbe(page);
    await writeSafeResult(resultPath, result);
    expect(wire.proof.beforeConfirmation).toBe(0);
    expect(wire.proof.attempts).toBe(0);
    expect(result.wss.ready).toBe(false);
    expect(result.wss.auth).toBe('unknown');
    expect(result.status).not.toBe('completed');
    throw new Error('e91-enabled-fallback-button-missing');
  }

  await expect(fallback).toBeVisible();
  await expect(fallback).toBeEnabled();
  const statusBeforeConfirmation = await page.getByTestId('e91-status').textContent();
  const resultBeforeConfirmation = await page.getByTestId('e91-result').textContent();
  if (statusBeforeConfirmation !== 'WebTransport observation complete. Confirm a new trusted WSS connection to continue.'
    || Boolean(resultBeforeConfirmation?.trim())) {
    throw new Error('e91-premature-fallback-status');
  }
  expect(wire.proof.attempts).toBe(0);
  expect(wire.proof.beforeConfirmation).toBe(0);

  // The single click below is the only authorization for the fresh WSS attempt.
  confirmationStarted = true;
  try { await fallback.click(); } catch { throw new Error('e91-fallback-confirm-click-failed'); }
  const result = await readProbe(page);
  await writeSafeResult(resultPath, result);

  // Unknown/refused/timeout outcomes are written first, then fail the positive
  // acceptance assertions. A finite helper result alone cannot satisfy them.
  expect(result.schemaVersion).toBe(2);
  expect(result.stage).toBe('cleanup');
  expect(result.status).toBe('completed');
  expect(result.failureCode).toBeNull();
  expect(result.externalParity).toBe(false);
  expect(result.fallback.explicitOnly).toBe(true);
  expect(result.fallback.freshOwner).toBe(true);
  expect(result.fallback.staleWtBlocked).toBe(true);
  expect(result.fallback.canaryExactlyOnce).toBe(true);
  expect(result.wt.ready).toBe(true);
  expect(result.wt.registration).toBe('registered');
  expect(result.wt.rawPingPong).toBe(true);
  expect(result.wt.textCanary).toBe(true);
  expect(result.wt.echoAdvertised).toBe(true);
  expect(result.wt.echoRequest).toBe('acknowledged');
  expect(result.wt.plainProbe).not.toBe('challenge-no-secret-sent');
  expect(result.wt.sessionToken).toBe('source-refused');
  expect(result.wss.ready).toBe(true);
  expect(result.wss.auth).toBe('authenticated');
  expect(result.wss.saslMechanisms).toContain('PLAIN');
  expect(result.wss.joined).toBe(true);
  expect(result.wss.canaryEcho).toBe(true);

  // Independently require actual WSS frames after confirmation. The observer
  // stores only finite flags/counts; AUTHENTICATE payload frames are discarded.
  await expect.poll(() => completeWssWireProof(wire.proof), { timeout: 10_000 }).toBe(true);
  expect(wire.proof.attempts).toBe(1);
  expect(wire.proof.beforeConfirmation).toBe(0);
  expect(wire.proof.afterConfirmation).toBe(1);
  expect(wire.proof.capLsComplete).toBe(true);
  expect(wire.proof.capLsAdvertisedSasl).toBe(true);
  expect(wire.proof.capLsAdvertisedEcho).toBe(true);
  expect(wire.proof.capReqSaslAndEcho).toBe(true);
  expect(wire.proof.capAckSaslAndEcho).toBe(true);
  expect(wire.proof.plainChallenge).toBe(true);
  expect(wire.proof.saslSuccess).toBe(true);
  expect(wire.proof.accountNumeric).toBe(true);
  expect(wire.proof.nickAndUserSent).toBe(true);
  expect(wire.proof.capEndAfterAuth).toBe(true);
  expect(wire.proof.welcomeMatched).toBe(true);
  expect(wire.proof.joinSent).toBe(true);
  expect(wire.proof.ownJoinObserved).toBe(true);
  expect(wire.proof.endNamesMatched).toBe(true);
  expect(wire.proof.oneOwnCanaryEcho).toBe(true);
  expect(wire.proof.pingPongBarrierAfterEcho).toBe(true);
});
