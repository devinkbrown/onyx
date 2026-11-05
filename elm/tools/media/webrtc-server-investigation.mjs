#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createPrivateRun, LOOPBACK, nodeToml, privateWrite, sha256 } from '../lab/config.mjs';
import { provisionFoundationAccount, waitForTopology } from '../lab/raw-scenarios.mjs';
import { serve } from '../lab/serve-https.mjs';
import {
  ISOLATED_NETWORK_CHILD_ENV,
  PARENT_PID_NAMESPACE_ENV,
  PARENT_NETWORK_NAMESPACE_ENV,
  createIsolatedScratchRoot,
  launchIsolatedNetworkNamespace,
  removeIsolatedScratchRoot,
  verifyIsolatedLoopbackOnly,
} from '../isolated-network.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MEDIA_DIR = dirname(fileURLToPath(import.meta.url));
const PROCESS_TIMEOUT_MS = 180_000;
const FILE_MODE = 0o600;
const PRIVATE_MODE = 0o700;
const PROBES = new Set(['standards', 'cadence-dtls']);
const SAFE_OS_ERROR_CODES = new Set(['EACCES', 'EEXIST', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'ENOENT', 'EROFS']);
const SAFE_FAILURE_PHASES = new Set(['preflight', 'server-startup', 'browser-setup', 'browser-probe', 'receipt']);
const SAFE_FAILURE_OPERATIONS = new Set([
  'namespace-proof', 'browser-result-path', 'environment-root-create', 'environment-root-permissions',
  'environment-home-create', 'isolated-server-setup', 'server-startup', 'browser-setup', 'browser-probe',
  'receipt-write',
]);
const CLIENT_SOURCE_INPUTS = Object.freeze([
  'elm/tools/media/webrtc-server-investigation.mjs',
  'elm/tools/media/webrtc-server-investigation.ts',
  'elm/tools/media/webrtc-server-investigation.html',
  'elm/tools/media/tsconfig.json',
  'tests/e2e/elm-local-webrtc-server-investigation.spec.ts',
  'src/lib/irc/parser.ts',
  'elm/runtime/client-line-validator.ts',
  'elm/tools/lab/raw-irc.mjs',
  'elm/tools/lab/raw-scenarios.mjs',
  'elm/tools/lab/config.mjs',
  'elm/tools/lab/serve-https.mjs',
  'elm/tools/isolated-network.mjs',
  'tests/e2e/elm-local.config.ts',
  'tsconfig.json',
  'package.json',
  'pnpm-lock.yaml',
]);

function failureOrigin(phase, operation, error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
  return {
    phase: SAFE_FAILURE_PHASES.has(phase) ? phase : 'preflight',
    operation: SAFE_FAILURE_OPERATIONS.has(operation) ? operation : 'unknown',
    errno: SAFE_OS_ERROR_CODES.has(code) ? code : 'UNKNOWN',
  };
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['--server-bin', '--server-source', '--server-build-receipt', '--receipt', '--probe']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith('--') || !allowed.has(flag) || values.has(flag)) throw new Error('invalid-arguments');
    const value = argv[i + 1];
    if (!value || value.startsWith('--') || /[\0\r\n]/u.test(value)) throw new Error('invalid-arguments');
    values.set(flag, value); i += 1;
  }
  for (const required of ['--server-bin', '--server-source', '--server-build-receipt', '--receipt']) {
    if (!values.has(required)) throw new Error('missing-arguments');
  }
  const receipt = resolve(values.get('--receipt'));
  if (receipt !== '/tmp' && !receipt.startsWith('/tmp/')) throw new Error('receipt-outside-tmp');
  const mode = values.get('--probe') ?? 'standards';
  if (!PROBES.has(mode)) throw new Error('invalid-probe');
  return Object.freeze({
    serverBin: resolve(values.get('--server-bin')),
    serverSource: resolve(values.get('--server-source')),
    buildReceipt: resolve(values.get('--server-build-receipt')),
    receipt,
    mode,
  });
}

function runBounded(command, args, { cwd, env, timeout = 20_000, maxBuffer = 8192 } = {}) {
  const result = spawnSync(command, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer, windowsHide: true });
  if (result.error || result.status !== 0 || result.signal) throw new Error('isolated-server-setup-failed');
}

async function reservePorts(count) {
  const { createServer } = await import('node:net');
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK, resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('isolated-port-reservation-failed');
    result.push(address.port);
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
  return result;
}

async function generateLabTls(root, env) {
  const keyPath = join(root, 'local.key');
  const certPath = join(root, 'local.crt');
  runBounded('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], {
    cwd: root, env, timeout: 30_000, maxBuffer: 4096,
  });
  await chmod(keyPath, FILE_MODE);
  await chmod(certPath, FILE_MODE);
  return { key: await readFile(keyPath), cert: await readFile(certPath), keyPath, certPath };
}

function startDaemon(binary, configPath, directory, env, children) {
  const child = spawn(binary, [configPath], { cwd: directory, env, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  children.push(child);
  return child;
}

async function stopChildren(children) {
  const stopOne = async child => {
    if (!child?.pid || !processGroupExists(child.pid)) return true;
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    if (await waitForProcessGroupExit(child.pid, 1_500)) return true;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    return waitForProcessGroupExit(child.pid, 1_500);
  };
  const stopped = await Promise.all([...children].reverse().map(stopOne));
  return stopped.every(Boolean);
}

async function buildHarness(stageDir) {
  await build({
    configFile: false,
    root: MEDIA_DIR,
    publicDir: false,
    build: {
      target: 'es2022',
      outDir: stageDir,
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      rollupOptions: { input: join(MEDIA_DIR, 'webrtc-server-investigation.html') },
    },
  });
}

async function snapshotClientSources() {
  const files = [];
  for (const relativePath of [...CLIENT_SOURCE_INPUTS].sort()) {
    const path = resolve(ROOT, relativePath);
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('client-source-input-unavailable');
    files.push({ path: relativePath, mode: info.mode & 0o777, sha256: sha256(await readFile(path)) });
  }
  return { sha256: sha256(Buffer.from(JSON.stringify(files))), files };
}

async function snapshotServedStage(root) {
  const files = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('served-stage-invalid-entry');
      if (info.isDirectory()) await walk(path, relativePath);
      else if (info.isFile()) files.push({ path: relativePath, mode: info.mode & 0o777, sha256: sha256(await readFile(path)) });
      else throw new Error('served-stage-invalid-entry');
    }
  }
  await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { sha256: sha256(Buffer.from(JSON.stringify(files))), files };
}

function processGroupExists(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  return !processGroupExists(pid);
}

async function stopOwnedProcessGroup(child) {
  if (!child?.pid || !processGroupExists(child.pid)) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch { /* owned child already exited */ } }
  if (await waitForProcessGroupExit(child.pid, 1_500)) return;
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* owned child already exited */ } }
  await waitForProcessGroupExit(child.pid, 1_500);
}

async function runTrackedPlaywright(args, options) {
  const child = spawn('pnpm', args, { ...options, detached: true, stdio: 'ignore', windowsHide: true });
  let timedOut = false;
  let cancelledBy = null;
  let spawnErrorCode = null;
  let timer;
  let cancelResolve;
  const cancelled = new Promise(resolvePromise => { cancelResolve = resolvePromise; });
  const onInterrupt = () => { cancelledBy = 'SIGINT'; cancelResolve({ status: null, signal: 'SIGINT' }); };
  const onTerminate = () => { cancelledBy = 'SIGTERM'; cancelResolve({ status: null, signal: 'SIGTERM' }); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const closed = new Promise(resolvePromise => {
    child.once('close', (status, signal) => resolvePromise({ status, signal }));
    child.once('error', error => { spawnErrorCode = error?.code === 'ENOENT' ? 'playwright-runner-unavailable' : 'playwright-runner-failed'; resolvePromise({ status: null, signal: null }); });
  });
  try {
    const timeout = new Promise(resolvePromise => {
      timer = setTimeout(() => { timedOut = true; resolvePromise({ status: null, signal: null }); }, PROCESS_TIMEOUT_MS);
      timer.unref?.();
    });
    const result = await Promise.race([closed, timeout, cancelled]);
    return { ...result, timedOut, cancelledBy, spawnErrorCode };
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    await stopOwnedProcessGroup(child);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await Promise.race([closed, new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))]);
    }
  }
}

async function writePrivateReceipt(path, value) {
  const receiptDirectory = await realpath(dirname(path));
  if (receiptDirectory !== '/tmp' && !receiptDirectory.startsWith('/tmp/')) throw new Error('receipt-outside-tmp');
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const handle = await import('node:fs/promises').then(fs => fs.open(path, 'wx', FILE_MODE));
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await chmod(path, FILE_MODE);
}

function safeProbeResult(value) {
  if (!value || typeof value !== 'object') return null;
  const allowedStatuses = new Set(['server-refused', 'signaling-only', 'unknown', 'blocked']);
  const codes = new Set(['NO_CODECS', 'NO_COMMON_CODEC', 'BAD_FINGERPRINT', 'DTLS_UNAVAILABLE', 'SECURE_SIGNALING_REQUIRED', 'TRANSPORT_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'UNSUPPORTED', 'OTHER']);
  const modes = new Set(['standards', 'cadence-dtls']);
  const status = allowedStatuses.has(value.status) ? value.status : 'unknown';
  const mode = modes.has(value.mode) ? value.mode : 'standards';
  const code = typeof value.serverFailureCode === 'string' && codes.has(value.serverFailureCode) ? value.serverFailureCode : null;
  const requestedCodecs = Array.isArray(value.requestedCodecs) ? value.requestedCodecs.filter(item => ['opus', 'vp8', 'cadencevox'].includes(item)).slice(0, 3) : [];
  const browserCodecs = Array.isArray(value.browserCodecs) ? value.browserCodecs.filter(item => ['audio/opus', 'video/VP8'].includes(item)).slice(0, 2) : [];
  const families = new Set(['prefixless-fail', 'server-notice-fail', 'server-event-offer-ack', 'server-event-transport', 'timeout', 'none']);
  return {
    schemaVersion: 1,
    mode,
    status,
    stage: typeof value.stage === 'string' && /^[a-z-]{1,32}$/u.test(value.stage) ? value.stage : 'unknown',
    serverFailureCode: code,
    responseFamily: families.has(value.responseFamily) ? value.responseFamily : 'none',
    requestedCodecs,
    browserCodecs,
    browserFingerprintGenerated: value.browserFingerprintGenerated === true,
    browserFingerprintSent: value.browserFingerprintSent === true,
    fingerprintAlgorithm: value.fingerprintAlgorithm === 'sha-256' ? 'sha-256' : null,
    fingerprintOctets: value.fingerprintOctets === 32 ? 32 : null,
    serverFingerprintFormatValid: typeof value.serverFingerprintFormatValid === 'boolean' ? value.serverFingerprintFormatValid : null,
    mediaInterop: false,
    decodedAudioPackets: null,
    decodedVideoFrames: null,
    errorCode: typeof value.errorCode === 'string' && /^[a-z0-9-]{1,48}$/u.test(value.errorCode) ? value.errorCode : null,
  };
}

async function readBrowserResult(resultPath) {
  try {
    const stat = await import('node:fs/promises').then(fs => fs.lstat(resultPath));
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > 16 * 1024) return null;
    const parsed = JSON.parse(await readFile(resultPath, 'utf8'));
    return safeProbeResult(parsed);
  } catch { return null; }
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

async function writeEnvironmentBlockedReceipt(args, reason, startedAt = new Date().toISOString(), startupDiagnosticValue = null) {
  const startupDiagnostic = safeStartupDiagnostic(startupDiagnosticValue);
  const allowedReasons = new Set([
    'namespace-identity-unavailable', 'namespace-not-isolated', 'loopback-setup-unavailable',
    'network-interface-inventory-unavailable', 'network-not-loopback-only', 'unshare-unavailable',
    'namespace-permission-denied', 'namespace-unavailable',
    'namespace-launch-failed', 'namespace-run-timeout', 'namespace-run-cancelled', 'namespace-startup-refused',
  ]);
  const safeReason = allowedReasons.has(reason) ? reason : 'namespace-launch-failed';
  await writePrivateReceipt(args.receipt, {
    schemaVersion: 1,
    kind: 'onyx-e84-webrtc-server-investigation',
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceBinding: null,
    networkContainment: { status: 'blocked', reason: safeReason, ...(startupDiagnostic ? { startupDiagnostic } : {}) },
    probe: {
      schemaVersion: 1, mode: args.mode, status: 'blocked', stage: 'preflight', serverFailureCode: null,
      responseFamily: 'none', requestedCodecs: [], browserCodecs: [], browserFingerprintGenerated: false,
      browserFingerprintSent: false, fingerprintAlgorithm: null, fingerprintOctets: null,
      serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null,
      decodedVideoFrames: null, errorCode: 'network-isolation-unavailable',
    },
    interpretation: {
      expectedSourceObservation: false, standardsCodecInteroperability: false, customCodecSignalingOnly: false,
      remoteCertificateBindingVerified: false, decodedMediaVerified: false, normalCallSelectionEnabled: false,
    },
    limitations: ['Network namespace containment was unavailable or could not be proven; no daemon or listener was started.'],
  });
  process.stderr.write(`BLOCKED: E84 network containment unavailable (${safeReason})\n`);
  process.exitCode = 1;
}

async function writeUnknownChildReceipt(args, startedAt, launch = null) {
  const startupDiagnostic = safeStartupDiagnostic(launch?.startupDiagnostic);
  await writePrivateReceipt(args.receipt, {
    schemaVersion: 1,
    kind: 'onyx-e84-webrtc-server-investigation',
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceBinding: null,
    networkContainment: { status: 'unknown', reason: 'child-receipt-missing' },
    probe: {
      schemaVersion: 1, mode: args.mode, status: 'unknown', stage: 'preflight', serverFailureCode: null,
      responseFamily: 'none', requestedCodecs: [], browserCodecs: [], browserFingerprintGenerated: false,
      browserFingerprintSent: false, fingerprintAlgorithm: null, fingerprintOctets: null,
      serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null,
      decodedVideoFrames: null, errorCode: 'child-receipt-missing',
    },
    interpretation: {
      expectedSourceObservation: false, standardsCodecInteroperability: false, customCodecSignalingOnly: false,
      remoteCertificateBindingVerified: false, decodedMediaVerified: false, normalCallSelectionEnabled: false,
    },
    harness: launch ? {
      namespaceRunnerStatus: launch.status,
      namespaceRunnerSignal: launch.signal,
      namespaceRunnerTimedOut: launch.timedOut,
      namespaceRunnerCancelledBy: launch.cancelledBy,
      ...(startupDiagnostic ? { startupDiagnostic } : {}),
    } : undefined,
    limitations: ['The isolated child ended without a receipt; startup and cleanup outcome are unknown. No server refusal is inferred.'],
  });
  process.stderr.write('UNKNOWN: E84 isolated child ended without a receipt\n');
  process.exitCode = 1;
}

async function markReceiptRunBlocked(path, reason, launch) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 2 || info.size > 64 * 1024) return false;
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    const errorCode = reason === 'namespace-run-timeout' ? 'network-run-timeout' : 'network-run-cancelled';
    receipt.finishedAt = new Date().toISOString();
    if (receipt.probe && typeof receipt.probe === 'object') {
      receipt.probe = { ...receipt.probe, status: 'unknown', errorCode };
    }
    if (receipt.interpretation && typeof receipt.interpretation === 'object') {
      receipt.interpretation = { ...receipt.interpretation, expectedSourceObservation: false };
    }
    receipt.harness = { ...(receipt.harness && typeof receipt.harness === 'object' ? receipt.harness : {}),
      namespaceRunnerStatus: launch.status, namespaceRunnerSignal: launch.signal,
      namespaceRunnerTimedOut: launch.timedOut, namespaceRunnerCancelledBy: launch.cancelledBy };
    await import('node:fs/promises').then(fs => fs.writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: FILE_MODE }));
    await chmod(path, FILE_MODE);
    return true;
  } catch { return false; }
}

async function markReceiptCleanupUnknown(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 2 || info.size > 64 * 1024) return false;
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || !receipt.probe || typeof receipt.probe !== 'object' || Array.isArray(receipt.probe)) return false;
    receipt.finishedAt = new Date().toISOString();
    receipt.probe = { ...receipt.probe, status: 'unknown', stage: 'cleanup', errorCode: 'cleanup-failed' };
    if (receipt.interpretation && typeof receipt.interpretation === 'object' && !Array.isArray(receipt.interpretation)) {
      receipt.interpretation = { ...receipt.interpretation, expectedSourceObservation: false };
    }
    receipt.harness = { ...(receipt.harness && typeof receipt.harness === 'object' && !Array.isArray(receipt.harness) ? receipt.harness : {}), cleanupStatus: 'failed' };
    receipt.limitations = [
      ...(Array.isArray(receipt.limitations) ? receipt.limitations.filter(item => typeof item === 'string').slice(0, 15) : []),
      'Owned process or private scratch cleanup did not complete; the result is unknown.',
    ];
    await import('node:fs/promises').then(fs => fs.writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: FILE_MODE }));
    await chmod(path, FILE_MODE);
    process.exitCode = 1;
    return true;
  } catch { return false; }
}

async function printReceiptSummary(path) {
  try {
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    const status = ['server-refused', 'signaling-only', 'unknown', 'blocked'].includes(receipt?.probe?.status)
      ? receipt.probe.status : 'unknown';
    const expected = receipt?.interpretation?.expectedSourceObservation === true;
    process.stdout.write(`receipt=${path}\nprobe=${status}\nsourceObservation=${expected ? 'expected' : 'unexpected'}\n`);
  } catch { /* safe summary is omitted if the receipt cannot be read */ }
}

async function main(networkProof) {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const children = [];
  let privateRun = null;
  let httpsServer = null;
  let finalResult = null;
  let sourceBindingDetails = null;
  let cancelledBy = null;
  let phase = 'preflight';
  let failureOperation = 'namespace-proof';
  let activityLaunched = false;
  const stopForCancellation = () => {
    if (httpsServer) {
      const server = httpsServer.server;
      httpsServer = null;
      try { server.close(() => {}); } catch { /* listener already closed */ }
    }
    void stopChildren(children);
  };
  const onInterrupt = () => { cancelledBy = 'SIGINT'; stopForCancellation(); };
  const onTerminate = () => { cancelledBy = 'SIGTERM'; stopForCancellation(); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  let browserResultPath = null;
  let envRoot = null;
  let env = null;
  try {
    if (!networkProof || !networkProof.parentNamespaceIdentity || !networkProof.namespaceIdentity
      || networkProof.parentNamespaceIdentity === networkProof.namespaceIdentity
      || networkProof.interfaces?.length !== 1 || networkProof.interfaces[0] !== 'lo') {
      await writeEnvironmentBlockedReceipt(args, 'namespace-identity-unavailable', startedAt);
      return;
    }
    failureOperation = 'browser-result-path';
    browserResultPath = join(tmpdir(), `onyx-e84-result-${process.pid}-${randomBytes(6).toString('hex')}.json`);
    failureOperation = 'environment-root-create';
    envRoot = await mkdtemp(join(tmpdir(), 'onyx-e84-env-'));
    failureOperation = 'environment-root-permissions';
    await chmod(envRoot, PRIVATE_MODE);
    env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: join(envRoot, 'home'), TMPDIR: envRoot, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CI: '1',
    };
    failureOperation = 'environment-home-create';
    await mkdir(env.HOME, { mode: PRIVATE_MODE });
    failureOperation = 'isolated-server-setup';
    privateRun = await createPrivateRun({ scratchParent: tmpdir(), serverBin: args.serverBin, serverSource: args.serverSource, serverBuildReceipt: args.buildReceipt });
    if (!privateRun.buildReceipt) throw new Error('server-build-provenance-required');
    const portsRaw = await reservePorts(10);
    const ports = { irc: [portsRaw[0], portsRaw[5]], ws: [portsRaw[1], portsRaw[6]], s2s: [portsRaw[2], portsRaw[7]], tls: [portsRaw[3], portsRaw[8]], metrics: [portsRaw[4], portsRaw[9]] };
    const tls = await generateLabTls(privateRun.root, env);
    const nodes = [];
    for (const index of [1, 0]) {
      const id = String.fromCharCode(65 + index);
      const directory = join(privateRun.root, `node-${index + 1}`);
      for (const name of ['accounts-private', 'issuer-private', 'presence-private']) await mkdir(join(directory, name), { recursive: true, mode: PRIVATE_MODE });
      const base = nodeToml({ index, ports, directory, line3: false, exact: false, certPath: tls.certPath, keyPath: tls.keyPath });
      const config = `${base}\n[media]\nenabled = true\nws_media_relay = false\ndtls_srtp = false\ndtls13 = false\n`;
      const configPath = join(directory, 'node.toml');
      await privateWrite(configPath, config);
      runBounded(privateRun.binary, ['--check-config', configPath], { cwd: directory, env, timeout: 20_000 });
      runBounded(privateRun.binary, ['--initialize-guest-issuer', configPath], { cwd: directory, env, timeout: 20_000 });
      if (cancelledBy) throw new Error('investigation-cancelled');
      phase = 'server-startup';
      failureOperation = 'server-startup';
      activityLaunched = true;
      startDaemon(privateRun.binary, configPath, directory, env, children);
      nodes.push({ id, host: LOOPBACK, ircPort: ports.irc[index], tlsPort: ports.tls[index], wsPort: ports.ws[index], s2sPort: ports.s2s[index], metricsPort: ports.metrics[index] });
    }
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    await waitForTopology(nodes, children, 'two', 45_000);
    const account = await provisionFoundationAccount(ports.tls[0]);
    const room = `#e84-${randomBytes(6).toString('hex')}`;
    const wsUrl = `wss://${LOOPBACK}:${ports.ws[0]}/`;
    phase = 'browser-setup';
    failureOperation = 'browser-setup';
    const browserRoot = join(privateRun.root, 'browser');
    await mkdir(browserRoot, { recursive: true, mode: PRIVATE_MODE });
    const clientSourcesBeforeBuild = await snapshotClientSources();
    await buildHarness(browserRoot);
    const clientSourcesAfterBuild = await snapshotClientSources();
    const servedStageAfterBuild = await snapshotServedStage(browserRoot);
    httpsServer = await serve({ root: browserRoot, key: tls.key, cert: tls.cert });
    const browserVersionResult = spawnSync('/usr/bin/chromium', ['--version'], { cwd: privateRun.root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
    const browserVersion = browserVersionResult.status === 0 ? (browserVersionResult.stdout.match(/Chromium ([0-9.]+)/u)?.[1] ?? 'unknown') : 'unknown';
    const playwrightReport = join(privateRun.root, 'playwright-report.json');
    const clientSourcesBeforeMeasurement = await snapshotClientSources();
    const servedStageBeforeMeasurement = await snapshotServedStage(browserRoot);
    const sourceStableBeforeMeasurement = clientSourcesBeforeBuild.sha256 === clientSourcesAfterBuild.sha256
      && clientSourcesAfterBuild.sha256 === clientSourcesBeforeMeasurement.sha256;
    const stageStableBeforeMeasurement = servedStageAfterBuild.sha256 === servedStageBeforeMeasurement.sha256;
    let run = { status: null, signal: null, timedOut: false, cancelledBy: null, spawnErrorCode: null };
    if (sourceStableBeforeMeasurement && stageStableBeforeMeasurement) {
      phase = 'browser-probe';
      failureOperation = 'browser-probe';
      run = await runTrackedPlaywright(['exec', 'playwright', 'test', '--config=tests/e2e/elm-local.config.ts', 'tests/e2e/elm-local-webrtc-server-investigation.spec.ts', '--reporter=json'], {
      cwd: ROOT,
      env: {
        ...env,
        ONYX_ELM_LAB_BASE: httpsServer.url,
        ONYX_ELM_LAB_WS: wsUrl,
        ONYX_ELM_LAB_CERT_BYPASS: '1',
        ONYX_TEST_ARTIFACTS_ROOT: join(privateRun.root, 'playwright-artifacts'),
        ONYX_E84_WS: wsUrl,
        ONYX_E84_ACCOUNT: account.account,
        ONYX_E84_PASSWORD: account.password,
        ONYX_E84_ROOM: room,
        ONYX_E84_MODE: args.mode,
        ONYX_E84_RESULT: browserResultPath,
        ONYX_E84_EXPECTED_SOURCE: privateRun.sourceManifestSha256,
        PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightReport,
        ONYX_CHROMIUM_EXECUTABLE: '/usr/bin/chromium',
      },
      });
    }
    const clientSourcesAfterMeasurement = await snapshotClientSources();
    const servedStageAfterMeasurement = await snapshotServedStage(browserRoot);
    const clientSourceStable = sourceStableBeforeMeasurement
      && clientSourcesBeforeMeasurement.sha256 === clientSourcesAfterMeasurement.sha256;
    const servedStageStable = stageStableBeforeMeasurement
      && servedStageBeforeMeasurement.sha256 === servedStageAfterMeasurement.sha256;
    const sourceBindingVerified = clientSourceStable && servedStageStable;
    sourceBindingDetails = {
      probeMode: args.mode,
      clientSourceFiles: clientSourcesBeforeBuild.files,
      clientSourceManifestSha256BeforeBuild: clientSourcesBeforeBuild.sha256,
      clientSourceManifestSha256AfterBuild: clientSourcesAfterBuild.sha256,
      clientSourceManifestSha256BeforeMeasurement: clientSourcesBeforeMeasurement.sha256,
      clientSourceManifestSha256AfterMeasurement: clientSourcesAfterMeasurement.sha256,
      clientSourceStable,
      servedStageSha256AfterBuild: servedStageAfterBuild.sha256,
      servedStageSha256BeforeMeasurement: servedStageBeforeMeasurement.sha256,
      servedStageSha256AfterMeasurement: servedStageAfterMeasurement.sha256,
      servedStageFiles: servedStageBeforeMeasurement.files,
      servedStageStable,
      sourceBindingVerified,
    };
    finalResult = await readBrowserResult(browserResultPath);
    if (!finalResult) finalResult = {
      schemaVersion: 1, mode: args.mode, status: 'unknown', stage: 'server-request', serverFailureCode: null,
      responseFamily: 'none', requestedCodecs: args.mode === 'standards' ? ['opus', 'vp8'] : ['cadencevox'],
      browserCodecs: [], browserFingerprintGenerated: false, browserFingerprintSent: false, fingerprintAlgorithm: null,
      fingerprintOctets: null, serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null,
      decodedVideoFrames: null, errorCode: run.timedOut ? 'browser-run-timeout'
        : run.cancelledBy ? 'browser-run-cancelled'
          : run.spawnErrorCode || (!sourceStableBeforeMeasurement || !stageStableBeforeMeasurement
            ? 'source-binding-mismatch' : 'browser-investigation-incomplete'),
    };
    if (!sourceBindingVerified) finalResult = { ...finalResult, status: 'unknown', errorCode: 'source-binding-mismatch' };
    const acceptedExpectedResult = args.mode === 'standards'
      ? finalResult.status === 'server-refused' && finalResult.serverFailureCode === 'NO_CODECS'
      : finalResult.status === 'server-refused' && finalResult.serverFailureCode === 'DTLS_UNAVAILABLE'
        || finalResult.status === 'signaling-only' && finalResult.responseFamily === 'server-event-transport' && finalResult.serverFingerprintFormatValid === true;
    const receipt = {
      schemaVersion: 1,
      kind: 'onyx-e84-webrtc-server-investigation',
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceBinding: {
        sourceManifestSha256: privateRun.sourceManifestSha256,
        serverBinarySha256: privateRun.artifactHash,
        buildReceiptVerified: true,
        compilerVersion: privateRun.buildReceipt.compilerVersion,
        compilerSha256: privateRun.buildReceipt.compilerSha256,
        ...sourceBindingDetails,
      },
      networkContainment: { status: 'verified', ...networkProof },
      server: { endpoint: `wss://${LOOPBACK}:${ports.ws[0]}/`, networkId: 'onyx-e84-isolated-lab', mediaEnabled: true, dtlsSrtpEnabled: false, roomSha256: sha256(Buffer.from(room)) },
      browser: { engine: 'Chromium', version: browserVersion, pageOrigin: httpsServer.url },
      probe: finalResult,
      interpretation: {
        expectedSourceObservation: acceptedExpectedResult,
        standardsCodecInteroperability: false,
        customCodecSignalingOnly: args.mode === 'cadence-dtls' && finalResult.status === 'signaling-only',
        remoteCertificateBindingVerified: false,
        decodedMediaVerified: false,
        normalCallSelectionEnabled: false,
      },
      harness: { playwrightExitCode: run.status ?? null, playwrightSignal: run.signal ?? null,
        playwrightTimedOut: run.timedOut, playwrightCancelledBy: run.cancelledBy,
        playwrightErrorCode: run.spawnErrorCode, sourceBindingVerified,
        browserReportPresent: Boolean(await readFile(playwrightReport).catch(() => null)) },
      limitations: [
        'Isolated authenticated lab WSS connection; not a production endpoint or cross-node interoperability result.',
        'The server currently supports cadencevox/cadencevis/raw, not browser Opus/VP8; a standards refusal is not interoperability.',
        'The custom-codec probe validates signaling only and never applies remote SDP, opens a media path, or verifies a DTLS peer certificate.',
        'No SDP, ICE candidate, ICE password, server credential, account identifier, or fingerprint bytes are persisted in this receipt.',
      ],
    };
    phase = 'receipt';
    failureOperation = 'receipt-write';
    await writePrivateReceipt(args.receipt, receipt);
    if (!acceptedExpectedResult || !sourceBindingVerified || run.status !== 0) process.exitCode = 1;
    else process.exitCode = 0;
    process.stdout.write(`receipt=${args.receipt}\nprobe=${finalResult.status}\nsourceObservation=${acceptedExpectedResult ? 'expected' : 'unexpected'}\n`);
  } catch (error) {
    const safeCode = cancelledBy ? 'environment-run-cancelled'
      : privateRun ? 'isolated-investigation-failed' : 'source-bound-server-setup-failed';
    const resultStatus = activityLaunched ? 'unknown' : 'blocked';
    const resultStage = activityLaunched ? phase : 'preflight';
    const receipt = {
      schemaVersion: 1, kind: 'onyx-e84-webrtc-server-investigation', startedAt, finishedAt: new Date().toISOString(),
      sourceBinding: privateRun ? { sourceManifestSha256: privateRun.sourceManifestSha256, serverBinarySha256: privateRun.artifactHash, buildReceiptVerified: Boolean(privateRun.buildReceipt), ...sourceBindingDetails } : null,
      networkContainment: { status: 'verified', ...networkProof },
      probe: { schemaVersion: 1, mode: args.mode, status: resultStatus, stage: resultStage, serverFailureCode: null, responseFamily: 'none', requestedCodecs: [], browserCodecs: [], browserFingerprintGenerated: false, browserFingerprintSent: false, fingerprintAlgorithm: null, fingerprintOctets: null, serverFingerprintFormatValid: null, mediaInterop: false, decodedAudioPackets: null, decodedVideoFrames: null, errorCode: safeCode },
      interpretation: { expectedSourceObservation: false, standardsCodecInteroperability: false, customCodecSignalingOnly: false, remoteCertificateBindingVerified: false, decodedMediaVerified: false, normalCallSelectionEnabled: false },
      harness: { failureOrigin: failureOrigin(phase, failureOperation, error) },
      limitations: [activityLaunched
        ? 'The isolated server or browser flow started but did not complete; no server refusal or interoperability claim is made.'
        : 'Setup was blocked before an isolated server or browser flow started; no server refusal or interoperability claim is made.'],
    };
    try { await writePrivateReceipt(args.receipt, receipt); } catch { /* a path collision is reported only by the fixed code below */ }
    process.stderr.write(`FAIL: E84 investigation did not complete (${safeCode})\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    let cleanupFailed = false;
    if (httpsServer) {
      try {
        await new Promise((resolvePromise, reject) => httpsServer.server.close(error => error ? reject(error) : resolvePromise()));
      } catch { cleanupFailed = true; }
    }
    try { if (!await stopChildren(children)) cleanupFailed = true; }
    catch { cleanupFailed = true; }
    for (const path of [privateRun?.root, envRoot, browserResultPath]) {
      if (!path) continue;
      try { await rm(path, { recursive: path !== browserResultPath, force: true }); }
      catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      process.stderr.write('FAIL: E84 owned resource cleanup incomplete\n');
      process.exitCode = 1;
      if (!await markReceiptCleanupUnknown(args.receipt)) {
        try { await writeUnknownChildReceipt(args, startedAt); } catch { /* preserve any existing unreadable receipt */ }
      }
    }
  }
}

async function entrypoint() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env[ISOLATED_NETWORK_CHILD_ENV] === '1') {
    const verified = await verifyIsolatedLoopbackOnly(
      process.env[PARENT_NETWORK_NAMESPACE_ENV] || '',
      3,
      process.env[PARENT_PID_NAMESPACE_ENV] || '',
      4,
    );
    if (verified.kind !== 'ready') {
      await writeEnvironmentBlockedReceipt(args, verified.reason);
      return;
    }
    await main(verified.proof);
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    await lstat(args.receipt);
    process.stderr.write('FAIL: E84 receipt path already exists\n');
    process.exitCode = 1;
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write('FAIL: E84 receipt path is unavailable\n');
      process.exitCode = 1;
      return;
    }
  }
  let scratchRoot;
  try { scratchRoot = await createIsolatedScratchRoot(); }
  catch {
    await writeEnvironmentBlockedReceipt(args, 'namespace-launch-failed', startedAt);
    return;
  }
  let summaryNeeded = false;
  try {
    const launch = await launchIsolatedNetworkNamespace({
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      env: { ...process.env, TMPDIR: scratchRoot },
      timeoutMs: PROCESS_TIMEOUT_MS + 120_000,
    });
    if (launch.kind === 'blocked') {
      await writeEnvironmentBlockedReceipt(args, launch.reason, startedAt, launch.startupDiagnostic);
      summaryNeeded = true;
      return;
    }
    let receiptExists = false;
    try {
      const info = await lstat(args.receipt);
      receiptExists = !info.isSymbolicLink() && info.isFile();
    } catch { /* no child receipt means containment/startup did not complete */ }
    if (launch.timedOut || launch.cancelledBy) {
      const reason = launch.timedOut ? 'namespace-run-timeout' : 'namespace-run-cancelled';
      if (receiptExists) {
        if (!await markReceiptRunBlocked(args.receipt, reason, launch)) await writeUnknownChildReceipt(args, startedAt, launch);
      } else {
        await writeUnknownChildReceipt(args, startedAt, launch);
      }
      summaryNeeded = true;
      process.exitCode = 1;
      return;
    }
    if (!receiptExists) {
      if (launch.spawnErrorCode) await writeEnvironmentBlockedReceipt(args, launch.spawnErrorCode, startedAt);
      else await writeUnknownChildReceipt(args, startedAt, launch);
      summaryNeeded = true;
      return;
    }
    summaryNeeded = true;
    process.exitCode = launch.status ?? 1;
  } finally {
    let scratchRemoved = false;
    try { scratchRemoved = await removeIsolatedScratchRoot(scratchRoot); }
    catch { scratchRemoved = false; }
    if (!scratchRemoved) {
      process.stderr.write('FAIL: E84 private scratch cleanup incomplete\n');
      process.exitCode = 1;
      if (!await markReceiptCleanupUnknown(args.receipt)) {
        try { await writeUnknownChildReceipt(args, startedAt); summaryNeeded = true; } catch { /* preserve any existing unreadable receipt */ }
      }
    }
    if (summaryNeeded) await printReceiptSummary(args.receipt);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  entrypoint().catch(() => { process.stderr.write('FAIL: E84 investigation did not complete (internal-error)\n'); process.exitCode = 1; });
}
