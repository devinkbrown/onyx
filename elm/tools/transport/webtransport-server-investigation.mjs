#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { connect as tlsConnect } from 'node:tls';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createPrivateRun, LOOPBACK, nodeToml, privateWrite, sha256 } from '../lab/config.mjs';
import { provisionFoundationAccount } from '../lab/raw-scenarios.mjs';
import { serve } from '../lab/serve-https.mjs';
import {
  ISOLATED_NETWORK_CHILD_ENV,
  PARENT_PID_NAMESPACE_ENV,
  PARENT_NETWORK_NAMESPACE_ENV,
  launchIsolatedNetworkNamespace,
  verifyIsolatedLoopbackOnly,
  createIsolatedScratchRoot,
  removeIsolatedScratchRoot,
} from '../isolated-network.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TIMEOUT_MS = 300_000;
const PRIVATE_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_OS_ERROR_CODES = new Set(['EACCES', 'EEXIST', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'ENOENT', 'EROFS']);
const SAFE_FAILURE_PHASES = new Set(['preflight', 'wt-connect', 'wt-registration', 'cleanup']);
const SAFE_FAILURE_OPERATIONS = new Set([
  'environment-root-create', 'environment-root-permissions', 'environment-home-create',
  'environment-configuration', 'browser-result-path', 'isolated-server-setup', 'wt-connect',
  'server-startup', 'wt-registration', 'browser-setup', 'browser-probe', 'cleanup', 'receipt-write',
]);
const FAILURE_CODES = new Set([
  'invalid-config', 'insecure-context', 'api-unavailable', 'wt-connect-unknown',
  'wt-registration-timeout', 'wt-framing-timeout', 'wss-connect-unknown',
  'wss-sasl-unavailable', 'wss-auth-refused', 'wss-registration-timeout',
  'wss-join-refused', 'wss-canary-timeout', 'fallback-not-confirmed',
  'owner-fence-failed', 'cleanup-incomplete',
]);
const RUNNER_FAILURE_CODES = Object.freeze({
  setupUnavailable: 'setup-unavailable',
  browserRunTimeout: 'browser-run-timeout',
  incompleteObservation: 'incomplete-observation',
});
const SASL_MECHANISMS = new Set([
  'PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512', 'SCRAM-SHA-256-PLUS', 'SCRAM-SHA-512-PLUS',
  'EXTERNAL', 'SESSION-TOKEN', 'OAUTHBEARER', 'ANONYMOUS',
]);
const CLIENT_SOURCE_INPUTS = Object.freeze([
  'elm/tools/transport/webtransport-server-investigation.mjs',
  'elm/tools/transport/webtransport-server-investigation.ts',
  'elm/tools/transport/webtransport-server-investigation.html',
  'tests/e2e/elm-local-webtransport-server-investigation.spec.ts',
  'elm/runtime/webtransport-adapter.ts',
  'elm/runtime/transport-owner.ts',
  'elm/runtime/contracts.ts',
  'elm/runtime/client-line-validator.ts',
  'src/lib/irc/parser.ts',
  'elm/tools/isolated-network.mjs',
  'elm/tools/lab/config.mjs',
  'elm/tools/lab/raw-irc.mjs',
  'elm/tools/lab/raw-scenarios.mjs',
  'elm/tools/lab/serve-https.mjs',
  'tests/e2e/elm-local.config.ts',
  'package.json',
  'pnpm-lock.yaml',
]);
let activePlaywright = null;

function failureOrigin(phase, operation, error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
  return {
    phase: SAFE_FAILURE_PHASES.has(phase) ? phase : 'preflight',
    operation: SAFE_FAILURE_OPERATIONS.has(operation) ? operation : 'unknown',
    errno: SAFE_OS_ERROR_CODES.has(code) ? code : 'UNKNOWN',
  };
}

function parseArgs(argv) {
  const allowed = new Set(['--server-bin', '--server-source', '--server-build-receipt', '--receipt']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith('--') || !allowed.has(key) || values.has(key)) throw new Error('invalid-arguments');
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || /[\0\r\n]/u.test(value)) throw new Error('invalid-arguments');
    values.set(key, value);
    index += 1;
  }
  for (const key of allowed) if (key !== '--server-source' && !values.has(key)) throw new Error('missing-arguments');
  const receipt = resolve(values.get('--receipt'));
  if (receipt !== '/tmp' && !receipt.startsWith('/tmp/')) throw new Error('receipt-outside-tmp');
  return Object.freeze({
    serverBin: resolve(values.get('--server-bin')),
    serverSource: resolve(values.get('--server-source') ?? '/home/kain/onyx-server'),
    buildReceipt: resolve(values.get('--server-build-receipt')),
    receipt,
  });
}

function runBounded(command, args, { cwd, env, timeout = 20_000, maxBuffer = 8192 } = {}) {
  const result = spawnSync(command, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer, windowsHide: true });
  if (result.error || result.status !== 0 || result.signal) throw new Error('isolated-setup-failed');
}

async function reserveTcpPorts(count) {
  const ports = [];
  for (let index = 0; index < count; index += 1) {
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK, resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('port-reservation-failed');
    ports.push(address.port);
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
  return ports;
}

async function reserveUdpPort() {
  const socket = createSocket('udp4');
  await new Promise((resolvePromise, reject) => {
    socket.once('error', reject);
    socket.bind(0, LOOPBACK, resolvePromise);
  });
  const address = socket.address();
  if (typeof address === 'string') throw new Error('port-reservation-failed');
  const port = address.port;
  await new Promise(resolvePromise => socket.close(resolvePromise));
  return port;
}

async function generateTls(root, env) {
  const keyPath = join(root, 'local-p256.key');
  const certPath = join(root, 'local-p256.crt');
  runBounded('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ], { cwd: root, env, timeout: 30_000, maxBuffer: 4096 });
  await chmod(keyPath, FILE_MODE);
  await chmod(certPath, FILE_MODE);
  const cert = await readFile(certPath);
  const leafDer = new X509Certificate(cert).raw;
  if (!leafDer || leafDer.length < 128) throw new Error('certificate-invalid');
  return { keyPath, certPath, key: await readFile(keyPath), cert, leafDerSha256: sha256(leafDer) };
}

function cleanEnv(root) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: join(root, 'home'), TMPDIR: root, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CI: '1',
  };
}

function startDaemon(binary, configPath, cwd, env, children) {
  const child = spawn(binary, [configPath], { cwd, env, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  children.push(child);
  return child;
}

async function waitForTls(port, children, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error('daemon-exited');
    const ready = await new Promise(resolvePromise => {
      const socket = tlsConnect({ host: LOOPBACK, port, servername: '127.0.0.1', rejectUnauthorized: false });
      const timer = setTimeout(() => { socket.destroy(); resolvePromise(false); }, 700);
      socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); resolvePromise(true); });
      socket.once('error', () => { clearTimeout(timer); resolvePromise(false); });
    });
    if (ready) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
  }
  throw new Error('daemon-start-timeout');
}

function processGroupExists(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

async function stopChild(child, timeoutMs = 2_000) {
  if (!child) return;
  if (processGroupExists(child.pid)) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already closed */ } }
    await Promise.race([
      new Promise(resolvePromise => child.once('close', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, timeoutMs)),
    ]);
  }
  if (processGroupExists(child.pid)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already closed */ } }
    await Promise.race([
      new Promise(resolvePromise => child.once('close', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 1_000)),
    ]);
  }
}

async function buildHarness(stageDir) {
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    build: {
      target: 'es2022', outDir: stageDir, emptyOutDir: true, minify: true, sourcemap: false,
      rollupOptions: { input: join(ROOT, 'elm/tools/transport/webtransport-server-investigation.html') },
    },
  });
}

async function snapshotInputs() {
  const rows = [];
  for (const relativePath of [...CLIENT_SOURCE_INPUTS].sort()) {
    const path = resolve(ROOT, relativePath);
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('client-source-input-unavailable');
    rows.push({ path: relativePath, mode: info.mode & 0o777, sha256: sha256(await readFile(path)) });
  }
  return { files: rows, sha256: sha256(Buffer.from(JSON.stringify(rows))) };
}

async function snapshotStage(stageRoot) {
  const files = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('stage-invalid-entry');
      if (info.isDirectory()) await walk(path, relativePath);
      else if (info.isFile()) files.push({ path: relativePath, mode: info.mode & 0o777, sha256: sha256(await readFile(path)) });
      else throw new Error('stage-invalid-entry');
    }
  }
  await walk(stageRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, sha256: sha256(Buffer.from(JSON.stringify(files))) };
}

function normalizeProbe(raw) {
  const allowed = (value, values, fallback) => values.has(value) ? value : fallback;
  const nullableBool = value => typeof value === 'boolean' ? value : null;
  const validStringArray = (value, values, limit) => Array.isArray(value) && value.length <= limit
    && value.every(item => values.has(item));
  const stringArray = value => [...new Set(value)];
  const hasKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  if (!hasKeys(raw, ['schemaVersion', 'status', 'stage', 'failureCode', 'wt', 'wss', 'fallback', 'externalParity']) || raw.schemaVersion !== 2
    || !hasKeys(raw.wt, ['ready', 'registration', 'rawPingPong', 'textCanary', 'echoAdvertised', 'echoRequest', 'saslMechanisms', 'plainProbe', 'sessionToken'])
    || !hasKeys(raw.wss, ['ready', 'auth', 'saslMechanisms', 'joined', 'canaryEcho'])
    || !hasKeys(raw.fallback, ['explicitOnly', 'freshOwner', 'staleWtBlocked', 'canaryExactlyOnce'])) return null;
  const stages = new Set(['wt-connect', 'wt-registration', 'wt-framing', 'auth-policy', 'wss-fallback', 'cleanup']);
  const statuses = new Set(['completed', 'unknown', 'blocked']);
  const registration = new Set(['registered', 'unknown', 'blocked']);
  const echoRequest = new Set(['not-attempted', 'acknowledged', 'refused', 'unknown']);
  const plainProbe = new Set(['not-sent', 'challenge-no-secret-sent', 'source-refused', 'unknown']);
  const sessionToken = new Set(['not-attempted', 'source-refused', 'unknown']);
  const wssAuth = new Set(['authenticated', 'unknown', 'refused']);
  if (!statuses.has(raw.status) || !stages.has(raw.stage) || !registration.has(raw.wt.registration)
    || !echoRequest.has(raw.wt.echoRequest)
    || !plainProbe.has(raw.wt.plainProbe) || !sessionToken.has(raw.wt.sessionToken) || !wssAuth.has(raw.wss.auth)
    || !validStringArray(raw.wt.saslMechanisms, SASL_MECHANISMS, SASL_MECHANISMS.size)
    || !validStringArray(raw.wss.saslMechanisms, SASL_MECHANISMS, SASL_MECHANISMS.size)) return null;
  for (const value of [raw.wt.rawPingPong, raw.wt.textCanary, raw.wt.echoAdvertised, raw.wss.joined, raw.wss.canaryEcho,
    raw.fallback.freshOwner, raw.fallback.staleWtBlocked, raw.fallback.canaryExactlyOnce]) {
    if (value !== null && typeof value !== 'boolean') return null;
  }
  if ((raw.wt.echoAdvertised !== true && raw.wt.echoRequest !== 'not-attempted')
    || (raw.wt.echoAdvertised === true && raw.wt.echoRequest === 'not-attempted')) return null;
  if (raw.failureCode !== null && !FAILURE_CODES.has(raw.failureCode)) return null;
  if (typeof raw.wt.ready !== 'boolean' || typeof raw.wss.ready !== 'boolean'
    || typeof raw.fallback.explicitOnly !== 'boolean' || raw.externalParity !== false) return null;
  const code = raw.failureCode;
  if (raw.status === 'blocked' && (!['invalid-config', 'insecure-context', 'api-unavailable'].includes(code) || raw.stage !== 'wt-connect')) return null;
  return {
    schemaVersion: 2,
    status: allowed(raw.status, statuses, 'unknown'),
    stage: allowed(raw.stage, stages, 'cleanup'),
    failureCode: code,
    wt: {
      ready: raw.wt?.ready === true,
      registration: allowed(raw.wt?.registration, registration, 'unknown'),
      rawPingPong: nullableBool(raw.wt?.rawPingPong),
      textCanary: nullableBool(raw.wt?.textCanary),
      echoAdvertised: nullableBool(raw.wt?.echoAdvertised),
      echoRequest: allowed(raw.wt?.echoRequest, echoRequest, 'unknown'),
      saslMechanisms: stringArray(raw.wt.saslMechanisms),
      plainProbe: allowed(raw.wt?.plainProbe, plainProbe, 'unknown'),
      sessionToken: allowed(raw.wt?.sessionToken, sessionToken, 'unknown'),
    },
    wss: {
      ready: raw.wss?.ready === true,
      auth: allowed(raw.wss?.auth, wssAuth, 'unknown'),
      saslMechanisms: stringArray(raw.wss.saslMechanisms),
      joined: nullableBool(raw.wss?.joined),
      canaryEcho: nullableBool(raw.wss?.canaryEcho),
    },
    fallback: {
      explicitOnly: raw.fallback.explicitOnly === true,
      freshOwner: nullableBool(raw.fallback?.freshOwner),
      staleWtBlocked: nullableBool(raw.fallback?.staleWtBlocked),
      canaryExactlyOnce: nullableBool(raw.fallback?.canaryExactlyOnce),
    },
    externalParity: false,
  };
}

function hasCompleteObservation(probe) {
  return probe?.status === 'completed'
    && probe.failureCode === null
    && probe.wt.ready && probe.wt.registration === 'registered'
    && probe.wt.rawPingPong === true && probe.wt.textCanary === true
    && probe.wt.echoAdvertised === true && probe.wt.echoRequest === 'acknowledged'
    && probe.wt.sessionToken === 'source-refused'
    && probe.fallback.explicitOnly && probe.fallback.freshOwner === true
    && probe.fallback.staleWtBlocked === true && probe.fallback.canaryExactlyOnce === true
    && probe.wss.ready && probe.wss.auth === 'authenticated'
    && probe.wss.joined === true && probe.wss.canaryEcho === true;
}

function incompleteObservationStage(probe) {
  if (!probe.wt.ready) return 'wt-connect';
  if (probe.wt.registration !== 'registered') return 'wt-registration';
  if (probe.wt.rawPingPong !== true || probe.wt.textCanary !== true
    || probe.wt.echoAdvertised !== true || probe.wt.echoRequest !== 'acknowledged') return 'wt-framing';
  if (probe.wt.sessionToken !== 'source-refused') return 'auth-policy';
  if (!probe.fallback.explicitOnly || probe.fallback.freshOwner !== true
    || probe.fallback.staleWtBlocked !== true || probe.fallback.canaryExactlyOnce !== true
    || !probe.wss.ready) return 'wss-fallback';
  if (probe.wss.auth !== 'authenticated' || probe.wss.joined !== true || probe.wss.canaryEcho !== true) return 'wss-fallback';
  return probe.stage;
}

async function readProbe(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 2 || info.size > 16 * 1024) return null;
    return normalizeProbe(JSON.parse(await readFile(path, 'utf8')));
  } catch { return null; }
}

async function writePrivateReceipt(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_MODE });
  const parent = await realpath(dirname(path));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('receipt-outside-tmp');
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await writeFile(path, bytes, { mode: FILE_MODE, flag: 'wx' });
  await chmod(path, FILE_MODE);
}

async function assertUnusedReceipt(path) {
  const parent = resolve(dirname(path));
  const actualParent = await realpath(parent);
  if (actualParent !== '/tmp' && !actualParent.startsWith('/tmp/')) throw new Error('receipt-outside-tmp');
  try { await lstat(path); throw new Error('receipt-path-not-empty'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

const STARTUP_DIAGNOSTIC_KINDS = new Set([
  'unclassified', 'worker-internal-error', 'unshare-preexec-refusal', 'launcher-step-failed',
]);
const STARTUP_DIAGNOSTIC_STEPS = new Set([
  'unshare', 'capget', 'capset', 'prctl-cap-ambient', 'pidfd-open', 'uid-map', 'gid-map', 'setgroups', 'exec', 'worker-entrypoint',
]);
const STARTUP_DIAGNOSTIC_ERRNOS = new Set([
  'EPERM', 'EACCES', 'ENOSYS', 'EOPNOTSUPP', 'EINVAL', 'ENOENT', 'EBADF', 'ESRCH', 'EBUSY', 'EAGAIN',
  'ENOMEM', 'EMFILE', 'EROFS', 'EPIPE', 'EIO', 'EINTR',
]);

function safeStartupDiagnostic(value) {
  if (!value || !STARTUP_DIAGNOSTIC_KINDS.has(value.kind)
    || !(value.step === null || STARTUP_DIAGNOSTIC_STEPS.has(value.step))
    || !(value.errno === null || STARTUP_DIAGNOSTIC_ERRNOS.has(value.errno))
    || !Number.isInteger(value.stderrBytes) || value.stderrBytes < 0 || value.stderrBytes > 1024
    || typeof value.stderrSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.stderrSha256)
    || typeof value.stderrTruncated !== 'boolean') return null;
  if (value.kind === 'unclassified' && (value.step !== null || value.errno !== null)) return null;
  if (value.kind === 'worker-internal-error' && (value.step !== 'worker-entrypoint' || value.errno !== null)) return null;
  if (value.kind === 'unshare-preexec-refusal' && (value.step !== 'unshare' || value.errno === null)) return null;
  if (value.kind === 'launcher-step-failed'
    && (value.step === null || value.step === 'unshare' || value.step === 'worker-entrypoint' || value.errno === null)) return null;
  return {
    kind: value.kind, step: value.step, errno: value.errno,
    stderrBytes: value.stderrBytes, stderrSha256: value.stderrSha256, stderrTruncated: value.stderrTruncated,
  };
}

async function writeBlockedReceipt(args, reason, startedAt, sourceBinding = null, startupDiagnosticValue = null) {
  const startupDiagnostic = safeStartupDiagnostic(startupDiagnosticValue);
  const reasons = new Set([
    'namespace-identity-unavailable', 'namespace-not-isolated', 'loopback-setup-unavailable',
    'network-interface-inventory-unavailable', 'network-not-loopback-only', 'unshare-unavailable',
    'namespace-permission-denied', 'namespace-unavailable',
    'namespace-launch-failed', 'namespace-startup-refused', 'namespace-run-timeout', 'namespace-run-cancelled',
  ]);
  const safeReason = reasons.has(reason) ? reason : 'namespace-launch-failed';
  await writePrivateReceipt(args.receipt, {
    schemaVersion: 1,
    kind: 'onyx-e91-webtransport-server-investigation',
    startedAt,
    finishedAt: new Date().toISOString(),
    networkContainment: { status: 'blocked', reason: safeReason, ...(startupDiagnostic ? { startupDiagnostic } : {}) },
    sourceBinding,
    probe: {
      schemaVersion: 2, status: 'blocked', stage: 'wt-connect', failureCode: null,
      wt: { ready: false, registration: 'blocked', rawPingPong: null, textCanary: null, echoAdvertised: null, echoRequest: 'not-attempted', saslMechanisms: [], plainProbe: 'not-sent', sessionToken: 'not-attempted' },
      wss: { ready: false, auth: 'unknown', saslMechanisms: [], joined: null, canaryEcho: null },
      fallback: { explicitOnly: true, freshOwner: null, staleWtBlocked: null, canaryExactlyOnce: null },
      externalParity: false,
    },
    interpretation: { expectedObservationComplete: false, wssPolicyEquivalent: false, mediaTransportAvailable: false },
    limitations: ['Network isolation was unavailable or could not be verified; no daemon, browser, or listener was started.'],
    teardown: { ownedChildrenStopped: true, privateScratchRemoved: true },
  });
  process.stderr.write(`BLOCKED: E91 network containment unavailable (${safeReason})\n`);
  process.exitCode = 1;
}

async function writeUnknownReceipt(args, startedAt, reason = 'namespace-worker-incomplete', privateScratchRemoved = false, startupDiagnosticValue = null) {
  const startupDiagnostic = safeStartupDiagnostic(startupDiagnosticValue);
  await writePrivateReceipt(args.receipt, {
    schemaVersion: 1,
    kind: 'onyx-e91-webtransport-server-investigation',
    startedAt,
    finishedAt: new Date().toISOString(),
    networkContainment: { status: 'unknown', reason, ...(startupDiagnostic ? { startupDiagnostic } : {}) },
    sourceBinding: null,
    probe: {
      schemaVersion: 2, status: 'unknown', stage: 'cleanup', failureCode: 'cleanup-incomplete',
      wt: { ready: false, registration: 'unknown', rawPingPong: null, textCanary: null, echoAdvertised: null, echoRequest: 'not-attempted', saslMechanisms: [], plainProbe: 'unknown', sessionToken: 'unknown' },
      wss: { ready: false, auth: 'unknown', saslMechanisms: [], joined: null, canaryEcho: null },
      fallback: { explicitOnly: true, freshOwner: null, staleWtBlocked: null, canaryExactlyOnce: null },
      externalParity: false,
    },
    interpretation: { expectedObservationComplete: false, wssPolicyEquivalent: false, mediaTransportAvailable: false },
    limitations: ['The namespace worker did not produce a final receipt; whether listeners were started is unknown.'],
    teardown: { ownedChildrenStopped: false, privateScratchRemoved },
  });
  process.exitCode = 1;
}

async function markReceiptUnknown(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 2 || info.size > 2 * 1024 * 1024) return false;
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (!receipt || receipt.kind !== 'onyx-e91-webtransport-server-investigation' || !receipt.probe) return false;
    receipt.finishedAt = new Date().toISOString();
    receipt.probe = { ...receipt.probe, status: 'unknown', stage: 'cleanup', failureCode: 'cleanup-incomplete' };
    receipt.interpretation = { ...(receipt.interpretation || {}), expectedObservationComplete: false, wssPolicyEquivalent: false, mediaTransportAvailable: false };
    receipt.harness = { ...(receipt.harness || {}), namespaceWorkerTimedOut: true };
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: FILE_MODE, flag: 'wx' });
    await chmod(temporary, FILE_MODE);
    await rename(temporary, path);
    return true;
  } catch { return false; }
}

async function markReceiptScratchCleanupFailed(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 2 || info.size > 2 * 1024 * 1024) return false;
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (!receipt || receipt.kind !== 'onyx-e91-webtransport-server-investigation' || !receipt.probe) return false;
    receipt.finishedAt = new Date().toISOString();
    receipt.probe = { ...receipt.probe, status: 'unknown', stage: 'cleanup', failureCode: 'cleanup-incomplete' };
    receipt.interpretation = { ...(receipt.interpretation || {}), expectedObservationComplete: false, wssPolicyEquivalent: false, mediaTransportAvailable: false };
    receipt.teardown = { ...(receipt.teardown || {}), parentScratchRemoved: false };
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: FILE_MODE, flag: 'wx' });
    await chmod(temporary, FILE_MODE);
    await rename(temporary, path);
    return true;
  } catch { return false; }
}

async function runPlaywright(specPath, env, reportPath) {
  const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config=tests/e2e/elm-local.config.ts', specPath, '--reporter=json'], {
    cwd: ROOT, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath }, detached: true,
    stdio: 'ignore', windowsHide: true,
  });
  activePlaywright = child;
  let timer;
  let timedOut = false;
  const closed = new Promise(resolvePromise => {
    child.once('close', (status, signal) => resolvePromise({ status, signal }));
    child.once('error', error => resolvePromise({ status: null, signal: error?.code === 'ENOENT' ? 'spawn-unavailable' : 'spawn-failed' }));
  });
  const timeout = new Promise(resolvePromise => {
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group gone */ } }
      resolvePromise({ status: null, signal: 'timeout' });
    }, TIMEOUT_MS);
    timer.unref?.();
  });
  const result = await Promise.race([closed, timeout]);
  clearTimeout(timer);
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group gone */ }
    await Promise.race([closed, new Promise(resolvePromise => setTimeout(resolvePromise, 1500))]);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group gone */ }
  }
  activePlaywright = null;
  return { ...result, timedOut, ownedGroupStopped: !processGroupExists(child.pid) };
}

async function snapshotVersion(command, args, pattern) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, windowsHide: true });
  const match = `${result.stdout || ''}${result.stderr || ''}`.match(pattern);
  return result.status === 0 && match ? match[1] : 'unknown';
}

async function runIsolated(args, networkProof, startedAt) {
  if (!networkProof || networkProof.interfaces?.length !== 1 || networkProof.interfaces[0] !== 'lo'
    || !networkProof.namespaceIdentity || !networkProof.parentNamespaceIdentity
    || !networkProof.pidNamespaceIdentity || !networkProof.parentPidNamespaceIdentity
    || networkProof.namespaceIdentity === networkProof.parentNamespaceIdentity
    || networkProof.pidNamespaceIdentity === networkProof.parentPidNamespaceIdentity) {
    await writeBlockedReceipt(args, 'namespace-identity-unavailable', startedAt);
    return;
  }

  let envRoot = null;
  let env = null;
  let browserResultPath = null;
  const children = [];
  let privateRun = null;
  let httpsServer = null;
  let cancelledBy = null;
  let failureOperation = 'environment-root-create';
  const onSignal = signal => {
    cancelledBy = signal;
    if (httpsServer) { try { httpsServer.server.close(() => {}); } catch { /* already closed */ } }
    if (activePlaywright?.pid) { try { process.kill(-activePlaywright.pid, 'SIGTERM'); } catch { /* group gone */ } }
    for (const child of children) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group gone */ } }
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  let receipt = null;
  let sourceBinding = null;
  let probe = null;
  let phase = 'preflight';
  let teardown = { ownedChildrenStopped: false, privateScratchRemoved: false };
  let playwrightGroupStopped = true;
  try {
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    envRoot = await mkdtemp(join(tmpdir(), 'onyx-e91-env-'));
    failureOperation = 'environment-root-permissions';
    await chmod(envRoot, PRIVATE_MODE);
    failureOperation = 'environment-home-create';
    await mkdir(join(envRoot, 'home'), { mode: PRIVATE_MODE });
    failureOperation = 'environment-configuration';
    env = cleanEnv(envRoot);
    failureOperation = 'browser-result-path';
    browserResultPath = join(envRoot, 'browser-result.json');
    failureOperation = 'isolated-server-setup';
    if (cancelledBy) throw new Error('cancelled');
    privateRun = await createPrivateRun({
      scratchParent: tmpdir(), serverBin: args.serverBin,
      serverSource: args.serverSource, serverBuildReceipt: args.buildReceipt,
    });
    if (!privateRun.buildReceipt) throw new Error('server-build-provenance-required');

    const sourceBeforeBuild = await snapshotInputs();
    const tls = await generateTls(privateRun.root, env);
    const portsRaw = await reserveTcpPorts(10);
    const wtPort = await reserveUdpPort();
    const ports = {
      irc: [portsRaw[0], portsRaw[5]], ws: [portsRaw[1], portsRaw[6]],
      s2s: [portsRaw[2], portsRaw[7]], tls: [portsRaw[3], portsRaw[8]],
      metrics: [portsRaw[4], portsRaw[9]],
    };
    const directory = join(privateRun.root, 'node-1');
    for (const name of ['accounts-private', 'issuer-private', 'presence-private']) {
      await mkdir(join(directory, name), { recursive: true, mode: PRIVATE_MODE });
    }
    const baseConfig = nodeToml({ index: 0, ports, directory, line3: false, exact: false, certPath: tls.certPath, keyPath: tls.keyPath });
    const config = baseConfig.replace('\nwebtransport = 0\n', `\nwebtransport = ${wtPort}\n`);
    if (config === baseConfig) throw new Error('webtransport-config-field-missing');
    const configPath = join(directory, 'node.toml');
    await privateWrite(configPath, config);
    runBounded(privateRun.binary, ['--check-config', configPath], { cwd: directory, env, timeout: 20_000 });
    runBounded(privateRun.binary, ['--initialize-guest-issuer', configPath], { cwd: directory, env, timeout: 20_000 });
    if (cancelledBy) throw new Error('cancelled');
    failureOperation = 'server-startup';
    startDaemon(privateRun.binary, configPath, directory, env, children);
    phase = 'wt-connect';
    failureOperation = 'wt-connect';
    await waitForTls(ports.tls[0], children);

    const account = await provisionFoundationAccount(ports.tls[0]);
    phase = 'wt-registration';
    failureOperation = 'wt-registration';
    const room = `#e91-${randomBytes(7).toString('hex')}`;
    const wtUrl = `https://${LOOPBACK}:${wtPort}/`;
    const wssUrl = `wss://${LOOPBACK}:${ports.ws[0]}/`;
    const servedRoot = join(privateRun.root, 'served-stage');
    failureOperation = 'browser-setup';
    await mkdir(servedRoot, { mode: PRIVATE_MODE });
    await buildHarness(servedRoot);
    const sourceAfterBuild = await snapshotInputs();
    const stageAfterBuild = await snapshotStage(servedRoot);

    httpsServer = await serve({ root: servedRoot, key: tls.key, cert: tls.cert });
    const origin = httpsServer.url;
    const sourceBeforeRun = await snapshotInputs();
    const stageBeforeRun = await snapshotStage(servedRoot);
    const initialBinding = sourceBeforeBuild.sha256 === sourceAfterBuild.sha256
      && sourceAfterBuild.sha256 === sourceBeforeRun.sha256
      && stageAfterBuild.sha256 === stageBeforeRun.sha256;

    const reportPath = join(privateRun.root, 'playwright-report.json');
    const browserVersion = await snapshotVersion('/usr/bin/chromium', ['--version'], /Chromium ([0-9.]+)/u);
    let playwright = { status: null, signal: 'source-binding-mismatch', timedOut: false };
    if (initialBinding) {
      phase = 'wt-connect';
      failureOperation = 'browser-probe';
      playwright = await runPlaywright('tests/e2e/elm-local-webtransport-server-investigation.spec.ts', {
        ...env,
        ONYX_ELM_LAB_BASE: origin,
        ONYX_ELM_LAB_WS: wssUrl,
        ONYX_ELM_LAB_CERT_BYPASS: '1',
        ONYX_TEST_ARTIFACTS_ROOT: join(privateRun.root, 'playwright-artifacts'),
        ONYX_E91_ORIGIN: origin,
        ONYX_E91_WT_URL: wtUrl,
        ONYX_E91_WSS_URL: wssUrl,
        ONYX_E91_CERT_SHA256_HEX: tls.leafDerSha256,
        ONYX_E91_ACCOUNT: account.account,
        ONYX_E91_PASSWORD: account.password,
        ONYX_E91_ROOM: room,
        ONYX_E91_RESULT: browserResultPath,
        ONYX_CHROMIUM_EXECUTABLE: '/usr/bin/chromium',
      }, reportPath);
      playwrightGroupStopped = playwright.ownedGroupStopped;
    }
    phase = 'cleanup';
    failureOperation = 'cleanup';
    const sourceAfterRun = await snapshotInputs();
    const stageAfterRun = await snapshotStage(servedRoot);
    const sourceStable = initialBinding && sourceBeforeRun.sha256 === sourceAfterRun.sha256;
    const stageStable = initialBinding && stageBeforeRun.sha256 === stageAfterRun.sha256;
    probe = await readProbe(browserResultPath);
    if (!probe) {
      probe = {
        schemaVersion: 2, status: 'unknown',
        stage: !sourceStable || !stageStable ? 'cleanup' : 'browser-run',
        failureCode: !sourceStable || !stageStable ? 'owner-fence-failed'
          : playwright.timedOut ? RUNNER_FAILURE_CODES.browserRunTimeout
            : playwright.signal === 'spawn-unavailable' ? 'api-unavailable' : RUNNER_FAILURE_CODES.incompleteObservation,
        wt: { ready: false, registration: 'unknown', rawPingPong: null, textCanary: null, echoAdvertised: null, echoRequest: 'not-attempted', saslMechanisms: [], plainProbe: 'unknown', sessionToken: 'unknown' },
        wss: { ready: false, auth: 'unknown', saslMechanisms: [], joined: null, canaryEcho: null },
        fallback: { explicitOnly: true, freshOwner: null, staleWtBlocked: null, canaryExactlyOnce: null },
        externalParity: false,
      };
    }
    if (!sourceStable || !stageStable) {
      probe = { ...probe, status: 'unknown', stage: 'cleanup', failureCode: 'owner-fence-failed' };
    } else if (probe.status === 'completed' && !hasCompleteObservation(probe)) {
      probe = { ...probe, status: 'unknown', stage: incompleteObservationStage(probe), failureCode: RUNNER_FAILURE_CODES.incompleteObservation };
    }

    sourceBinding = {
      server: {
        sourceManifestSha256: privateRun.sourceManifestSha256,
        binarySha256: privateRun.artifactHash,
        buildReceiptVerified: true,
        compilerVersion: privateRun.buildReceipt.compilerVersion,
        compilerSha256: privateRun.buildReceipt.compilerSha256,
      },
      clientInputs: sourceBeforeRun.files,
      clientManifestSha256BeforeBuild: sourceBeforeBuild.sha256,
      clientManifestSha256AfterBuild: sourceAfterBuild.sha256,
      clientManifestSha256BeforeRun: sourceBeforeRun.sha256,
      clientManifestSha256AfterRun: sourceAfterRun.sha256,
      servedStageSha256AfterBuild: stageAfterBuild.sha256,
      servedStageSha256BeforeRun: stageBeforeRun.sha256,
      servedStageSha256AfterRun: stageAfterRun.sha256,
      servedStageFiles: stageBeforeRun.files,
      sourceStable,
      servedStageStable: stageStable,
    };
    const expectedObservationComplete = hasCompleteObservation(probe);
    failureOperation = 'receipt-write';
    receipt = {
      schemaVersion: 1,
      kind: 'onyx-e91-webtransport-server-investigation',
      startedAt,
      finishedAt: new Date().toISOString(),
      networkContainment: { status: 'verified', ...networkProof },
      sourceBinding,
      server: {
        webtransportConfigured: true,
        webtransportPort: wtPort,
        wssPort: ports.ws[0],
        tlsPort: ports.tls[0],
        configSha256: sha256(Buffer.from(config)),
        certificateLeafDerSha256: tls.leafDerSha256,
        accountProvisioned: true,
        roomSha256: sha256(Buffer.from(room)),
      },
      browser: { engine: 'Chromium', version: browserVersion, originPort: Number(new URL(origin).port) },
      probe,
      interpretation: {
        expectedObservationComplete,
        wssPolicyEquivalent: false,
        mediaTransportAvailable: false,
      },
      harness: {
        playwrightExitCode: playwright.status,
        playwrightSignal: playwright.signal,
        playwrightTimedOut: playwright.timedOut,
        reportPresent: Boolean(await readFile(reportPath).catch(() => null)),
        clientSourceStable: sourceStable,
        servedStageStable: stageStable,
      },
      limitations: [
        'The WebTransport UDP listener binds all interfaces; isolation was verified inside a private loopback-only network namespace.',
        'The local P-256 certificate hash is an explicit experiment trust mode, not production WebPKI validation.',
        'WebTransport bridged IRC transport does not inherit the daemon TLS flag; SASL, TLS-only room admission, and SESSION token policy are not equivalent to WSS.',
        'No media transport, datagram support, cross-node interoperability, or production deployment behavior is inferred.',
      ],
      teardown: { ownedChildrenStopped: false, privateScratchRemoved: false },
    };
    if (playwright.status !== 0 || !expectedObservationComplete || !sourceStable || !stageStable) process.exitCode = 1;
  } catch (error) {
    const failureCode = cancelledBy ? 'cleanup-incomplete'
      : phase === 'preflight' ? RUNNER_FAILURE_CODES.setupUnavailable
        : phase === 'cleanup' ? 'cleanup-incomplete' : 'wt-connect-unknown';
    probe = {
      schemaVersion: 2, status: cancelledBy ? 'unknown' : phase === 'preflight' ? 'blocked' : 'unknown',
      failureCode,
      stage: cancelledBy || phase === 'cleanup' ? 'cleanup' : phase,
      wt: { ready: false, registration: 'unknown', rawPingPong: null, textCanary: null, echoAdvertised: null, echoRequest: 'not-attempted', saslMechanisms: [], plainProbe: 'not-sent', sessionToken: 'not-attempted' },
      wss: { ready: false, auth: 'unknown', saslMechanisms: [], joined: null, canaryEcho: null },
      fallback: { explicitOnly: true, freshOwner: null, staleWtBlocked: null, canaryExactlyOnce: null },
      externalParity: false,
    };
    receipt = {
      schemaVersion: 1, kind: 'onyx-e91-webtransport-server-investigation', startedAt,
      finishedAt: new Date().toISOString(), networkContainment: { status: 'verified', ...networkProof },
      sourceBinding: privateRun ? {
        server: { sourceManifestSha256: privateRun.sourceManifestSha256, binarySha256: privateRun.artifactHash, buildReceiptVerified: Boolean(privateRun.buildReceipt) },
      } : null,
      probe,
      interpretation: { expectedObservationComplete: false, wssPolicyEquivalent: false, mediaTransportAvailable: false },
      harness: { failureOrigin: failureOrigin(phase, failureOperation, error) },
      limitations: ['The investigation did not produce a complete browser observation; no equivalence or interoperability claim is made.'],
      teardown: { ownedChildrenStopped: false, privateScratchRemoved: false },
    };
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (httpsServer) {
      httpsServer.server.closeAllConnections?.();
      await new Promise(resolvePromise => httpsServer.server.close(resolvePromise));
    }
    for (const child of [...children].reverse()) await stopChild(child);
    if (activePlaywright) {
      await stopChild(activePlaywright);
      playwrightGroupStopped = !processGroupExists(activePlaywright.pid);
      activePlaywright = null;
    }
    teardown.ownedChildrenStopped = playwrightGroupStopped
      && children.every(child => (child.exitCode !== null || child.signalCode !== null) && !processGroupExists(child.pid));
    let scratchRemoved = true;
    try { if (privateRun) await rm(privateRun.root, { recursive: true, force: true }); }
    catch { scratchRemoved = false; }
    if (envRoot) {
      try { await rm(envRoot, { recursive: true, force: true }); }
      catch { scratchRemoved = false; }
    }
    teardown.privateScratchRemoved = scratchRemoved;
    if (!teardown.ownedChildrenStopped || !teardown.privateScratchRemoved || cancelledBy) {
      if (probe) probe = { ...probe, status: 'unknown', stage: 'cleanup', failureCode: 'cleanup-incomplete' };
      if (receipt) {
        receipt.probe = probe;
        receipt.interpretation = { ...receipt.interpretation, expectedObservationComplete: false };
      }
      process.exitCode = 1;
    }
    if (receipt) {
      receipt.finishedAt = new Date().toISOString();
      receipt.teardown = teardown;
      if (sourceBinding) receipt.sourceBinding = sourceBinding;
      try { await writePrivateReceipt(args.receipt, receipt); }
      catch { process.stderr.write('FAIL: E91 receipt could not be written (receipt-write-failed)\n'); process.exitCode = 1; }
    }
  }
}

async function entrypoint() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  await assertUnusedReceipt(args.receipt);
  if (process.env[ISOLATED_NETWORK_CHILD_ENV] === '1') {
    const verified = await verifyIsolatedLoopbackOnly(
      process.env[PARENT_NETWORK_NAMESPACE_ENV] || '', 3,
      process.env[PARENT_PID_NAMESPACE_ENV] || '', 4,
    );
    if (verified.kind !== 'ready') {
      await writeBlockedReceipt(args, verified.reason, startedAt);
      return;
    }
    await runIsolated(args, verified.proof, startedAt);
    return;
  }

  let outerScratch;
  let launch;
  let launchAttempted = false;
  let outerScratchRemoved = false;
  let scratchSetupFailed = false;
  try {
    outerScratch = await createIsolatedScratchRoot();
    launchAttempted = true;
    launch = await launchIsolatedNetworkNamespace({
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      env: { ...process.env, TMPDIR: outerScratch },
      timeoutMs: TIMEOUT_MS + 90_000,
    });
  } catch {
    scratchSetupFailed = true;
  } finally {
    if (outerScratch) {
      try { outerScratchRemoved = await removeIsolatedScratchRoot(outerScratch); }
      catch { outerScratchRemoved = false; }
    }
  }
  if (scratchSetupFailed && !launchAttempted && !outerScratch) {
    await writeBlockedReceipt(args, 'namespace-launch-failed', startedAt);
    return;
  }
  if (scratchSetupFailed && !launchAttempted && outerScratchRemoved) {
    await writeBlockedReceipt(args, 'namespace-launch-failed', startedAt);
    return;
  }
  if (!outerScratchRemoved) {
    let childReceipt = false;
    try {
      const info = await lstat(args.receipt);
      childReceipt = !info.isSymbolicLink() && info.isFile() && info.size > 2 && info.size <= 2 * 1024 * 1024;
    } catch { /* no child receipt to revise */ }
    if (childReceipt) await markReceiptScratchCleanupFailed(args.receipt);
    else await writeUnknownReceipt(args, startedAt, 'namespace-worker-incomplete', false, launch?.startupDiagnostic);
    process.exitCode = 1;
    return;
  }
  if (scratchSetupFailed) {
    await writeUnknownReceipt(args, startedAt, 'namespace-launch-outcome-unknown', outerScratchRemoved);
    return;
  }
  if (!launch) {
    await writeBlockedReceipt(args, 'namespace-launch-failed', startedAt);
    return;
  }
  if (launch.kind === 'blocked') {
    await writeBlockedReceipt(args, launch.reason, startedAt, null, launch.startupDiagnostic);
    return;
  }
  let childReceipt = false;
  try {
    const info = await lstat(args.receipt);
    childReceipt = !info.isSymbolicLink() && info.isFile() && info.size > 2 && info.size <= 2 * 1024 * 1024;
  } catch { /* absent receipt means containment did not reach the worker */ }
  if (launch.timedOut || launch.cancelledBy) {
    if (!childReceipt) await writeUnknownReceipt(args, startedAt, launch.timedOut ? 'namespace-worker-timeout' : 'namespace-worker-cancelled', outerScratchRemoved, launch.startupDiagnostic);
    else await markReceiptUnknown(args.receipt);
    process.exitCode = 1;
    return;
  }
  if (!childReceipt) {
    await writeUnknownReceipt(args, startedAt, 'namespace-worker-incomplete', outerScratchRemoved, launch.startupDiagnostic);
    return;
  }
  process.exitCode = launch.status ?? 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  entrypoint().catch(() => {
    process.stderr.write('FAIL: E91 investigation did not complete (internal-error)\n');
    process.exitCode = 1;
  });
}
