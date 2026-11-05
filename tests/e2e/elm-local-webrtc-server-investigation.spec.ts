// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { open } from 'node:fs/promises';

type SafeProbeResult = {
  schemaVersion: number;
  mode: string;
  status: string;
  stage: string;
  serverFailureCode: string | null;
  responseFamily: string;
  browserFingerprintGenerated: boolean;
  browserFingerprintSent: boolean;
  fingerprintAlgorithm: string | null;
  fingerprintOctets: number | null;
  serverFingerprintFormatValid: boolean | null;
  mediaInterop: false;
  decodedAudioPackets: null;
  decodedVideoFrames: null;
  errorCode: string | null;
};

type ProbePage = Window & {
  __runOnyxE84Probe?: (config: {
    wsUrl: string;
    account: string;
    password: string;
    room: string;
    mode: 'standards' | 'cadence-dtls';
  }) => Promise<SafeProbeResult>;
  __testOnyxE84Parser?: () => Record<string, boolean>;
};

const mode = process.env.ONYX_E84_MODE;
const wsUrl = process.env.ONYX_E84_WS;
const account = process.env.ONYX_E84_ACCOUNT;
const password = process.env.ONYX_E84_PASSWORD;
const room = process.env.ONYX_E84_ROOM;
const resultPath = process.env.ONYX_E84_RESULT;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('real browser probe records only sanitized existing-server outcome', async ({ page }) => {
  test.setTimeout(55_000);
  expect(mode === 'standards' || mode === 'cadence-dtls').toBe(true);
  expect(wsUrl).toMatch(/^wss:\/\/127\.0\.0\.1:\d+\/$/u);
  expect(account).toBeTruthy();
  expect(password).toBeTruthy();
  expect(room).toMatch(/^#e84-[a-f0-9]{12}$/u);
  expect(resultPath).toMatch(/^\/tmp\//u);

  await page.goto('/webrtc-server-investigation.html', { waitUntil: 'domcontentloaded' });
  const parserChecks = await page.evaluate(() => (window as ProbePage).__testOnyxE84Parser?.() ?? null);
  expect(parserChecks).toEqual({
    sourceFailAccepted: true,
    inventedPrefixedFailureIgnored: true,
    ownedPrefixlessSaslChallengeAccepted: true,
    prefixedSaslChallengeRejected: true,
    retiredSaslChallengeRejected: true,
    wrongIssuerIgnored: true,
    wrongRecipientIgnored: true,
    actualSpaceFingerprintAccepted: true,
    duplicateFingerprintRejected: true,
    sdesDowngradeRejected: true,
    crlfFingerprintAccepted: true,
    conflictingFingerprintRejected: true,
    bareCarriageReturnRejected: true,
    nulSdpRejected: true,
  });

  const result = await page.evaluate(async input => {
    const run = (window as ProbePage).__runOnyxE84Probe;
    if (!run) throw new Error('probe-not-installed');
    return run(input);
  }, {
    wsUrl: wsUrl!, account: account!, password: password!, room: room!, mode: mode as 'standards' | 'cadence-dtls',
  });
  expect(result.schemaVersion).toBe(1);
  expect(result.mode).toBe(mode);
  expect(result.mediaInterop).toBe(false);
  expect(result.decodedAudioPackets).toBeNull();
  expect(result.decodedVideoFrames).toBeNull();
  expect(result.browserFingerprintGenerated).toBe(true);
  expect(result.browserFingerprintSent).toBe(true);
  expect(result.fingerprintAlgorithm).toBe('sha-256');
  expect(result.fingerprintOctets).toBe(32);

  // The runner reads this private file and filters it again before receipt creation.
  const handle = await open(resultPath!, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(result)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (mode === 'standards') {
    expect(result.status).toBe('server-refused');
    expect(result.serverFailureCode).toBe('NO_CODECS');
    expect(['prefixless-fail', 'server-notice-fail']).toContain(result.responseFamily);
  } else if (result.status === 'server-refused') {
    expect(result.serverFailureCode).toBe('DTLS_UNAVAILABLE');
  } else {
    expect(result.status).toBe('signaling-only');
    expect(result.responseFamily).toBe('server-event-transport');
    expect(result.serverFingerprintFormatValid).toBe(true);
  }
});
