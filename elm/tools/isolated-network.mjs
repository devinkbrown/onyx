// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readlink, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const ISOLATED_NETWORK_CHILD_ENV = 'ONYX_ISOLATED_NETWORK_CHILD';
export const PARENT_NETWORK_NAMESPACE_ENV = 'ONYX_PARENT_NETWORK_NAMESPACE';
export const PARENT_PID_NAMESPACE_ENV = 'ONYX_PARENT_PID_NAMESPACE';
const ISOLATED_SCRATCH_ROOT_PREFIX = 'onyx-network-';
const UNSHARE_STDERR_CAPTURE_LIMIT = 1024;
const ownedScratchRoots = new Set();

const STARTUP_ERRNO_CODES = new Map([
  ['Operation not permitted', 'EPERM'],
  ['Permission denied', 'EACCES'],
  ['Function not implemented', 'ENOSYS'],
  ['Operation not supported', 'EOPNOTSUPP'],
  ['Invalid argument', 'EINVAL'],
  ['No such file or directory', 'ENOENT'],
  ['Bad file descriptor', 'EBADF'],
  ['No such process', 'ESRCH'],
  ['Device or resource busy', 'EBUSY'],
  ['Resource temporarily unavailable', 'EAGAIN'],
  ['Cannot allocate memory', 'ENOMEM'],
  ['Too many open files', 'EMFILE'],
  ['Read-only file system', 'EROFS'],
  ['Broken pipe', 'EPIPE'],
  ['Input/output error', 'EIO'],
  ['Interrupted system call', 'EINTR'],
]);

const STARTUP_STEP_PREFIXES = Object.freeze([
  ['unshare: unshare failed: ', 'unshare'],
  ['unshare: capget failed: ', 'capget'],
  ['unshare: capset failed: ', 'capset'],
  ['unshare: prctl(PR_CAP_AMBIENT) failed: ', 'prctl-cap-ambient'],
  ['unshare: pidfd_open failed: ', 'pidfd-open'],
  ['unshare: write failed /proc/self/uid_map: ', 'uid-map'],
  ['unshare: write failed /proc/self/gid_map: ', 'gid-map'],
  ['unshare: write failed /proc/self/setgroups: ', 'setgroups'],
]);

function makeStartupDiagnostic(bytes, truncated, streamError) {
  const diagnosticBase = {
    stderrBytes: bytes.length,
    stderrSha256: createHash('sha256').update(bytes).digest('hex'),
    stderrTruncated: truncated,
  };
  if (truncated || streamError) {
    return Object.freeze({ kind: 'unclassified', step: null, errno: null, ...diagnosticBase });
  }

  let line = bytes.toString('utf8');
  if (line.endsWith('\n')) line = line.slice(0, -1);
  if (line === 'FAIL: E84 investigation did not complete (internal-error)'
    || line === 'FAIL: E91 investigation did not complete (internal-error)') {
    return Object.freeze({ kind: 'worker-internal-error', step: 'worker-entrypoint', errno: null, ...diagnosticBase });
  }

  let step = null;
  let errnoPhrase = null;
  for (const [prefix, candidateStep] of STARTUP_STEP_PREFIXES) {
    if (line.startsWith(prefix)) {
      step = candidateStep;
      errnoPhrase = line.slice(prefix.length);
      break;
    }
  }
  const executePrefix = 'unshare: failed to execute ';
  if (step === null && line.startsWith(executePrefix)) {
    const separator = line.lastIndexOf(': ');
    if (separator > executePrefix.length && line.slice(executePrefix.length, separator) === process.execPath) {
      step = 'exec';
      errnoPhrase = line.slice(separator + 2);
    }
  }

  const errno = errnoPhrase === null ? undefined : STARTUP_ERRNO_CODES.get(errnoPhrase);
  if (step === null || !errno) {
    return Object.freeze({ kind: 'unclassified', step: null, errno: null, ...diagnosticBase });
  }
  const kind = step === 'unshare' ? 'unshare-preexec-refusal' : 'launcher-step-failed';
  return Object.freeze({ kind, step, errno, ...diagnosticBase });
}

function classifyUnshareStartupRefusal(diagnostic) {
  if (diagnostic?.kind !== 'unshare-preexec-refusal') return null;
  if (diagnostic.errno === 'EPERM' || diagnostic.errno === 'EACCES') return 'namespace-permission-denied';
  if (diagnostic.errno === 'ENOSYS') return 'namespace-unavailable';
  return null;
}

export async function createIsolatedScratchRoot() {
  const root = await mkdtemp(join('/tmp', ISOLATED_SCRATCH_ROOT_PREFIX));
  try { await chmod(root, 0o700); }
  catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  ownedScratchRoots.add(root);
  return root;
}

export async function removeIsolatedScratchRoot(root) {
  if (typeof root !== 'string' || !ownedScratchRoots.has(root)
    || resolve(root) !== root || dirname(root) !== '/tmp'
    || !basename(root).startsWith(ISOLATED_SCRATCH_ROOT_PREFIX)) return false;
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      ownedScratchRoots.delete(root);
      return false;
    }
    await rm(root, { recursive: true, force: false });
    ownedScratchRoots.delete(root);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      ownedScratchRoots.delete(root);
      return true;
    }
    return false;
  }
}

function validNamespaceIdentity(value, kind) {
  return typeof value === 'string' && new RegExp(`^${kind}:\\[[0-9]+\\]$`, 'u').test(value);
}

async function namespaceIdentity(path, kind) {
  const identity = await readlink(path);
  if (!validNamespaceIdentity(identity, kind)) throw new Error('namespace-identity-unavailable');
  return identity;
}

export async function currentNetworkNamespaceIdentity() {
  return namespaceIdentity('/proc/self/ns/net', 'net');
}

export async function currentPidNamespaceIdentity() {
  return namespaceIdentity('/proc/self/ns/pid', 'pid');
}

function runIp(args) {
  try {
    return spawnSync('ip', args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 8192, windowsHide: true });
  } catch { return null; }
}

export async function verifyIsolatedLoopbackOnly(parentNamespaceIdentity, parentNamespaceFd = 3, parentPidNamespaceIdentity, parentPidNamespaceFd = 4) {
  if (!validNamespaceIdentity(parentNamespaceIdentity, 'net') || !validNamespaceIdentity(parentPidNamespaceIdentity, 'pid')) {
    return { kind: 'blocked', reason: 'namespace-identity-unavailable' };
  }
  let descriptorIdentity;
  let pidDescriptorIdentity;
  try {
    descriptorIdentity = await readlink(`/proc/self/fd/${parentNamespaceFd}`);
    pidDescriptorIdentity = await readlink(`/proc/self/fd/${parentPidNamespaceFd}`);
  }
  catch { return { kind: 'blocked', reason: 'namespace-identity-unavailable' }; }
  if (descriptorIdentity !== parentNamespaceIdentity || pidDescriptorIdentity !== parentPidNamespaceIdentity) {
    return { kind: 'blocked', reason: 'namespace-identity-unavailable' };
  }
  try { closeSync(parentNamespaceFd); } catch { /* inherited namespace descriptor is best-effort closed */ }
  try { closeSync(parentPidNamespaceFd); } catch { /* inherited namespace descriptor is best-effort closed */ }
  let namespaceIdentity;
  let pidNamespaceIdentity;
  try { namespaceIdentity = await currentNetworkNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-identity-unavailable' }; }
  try { pidNamespaceIdentity = await currentPidNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-identity-unavailable' }; }
  if (namespaceIdentity === parentNamespaceIdentity || pidNamespaceIdentity === parentPidNamespaceIdentity || process.pid !== 1) {
    return { kind: 'blocked', reason: 'namespace-not-isolated' };
  }

  const raised = runIp(['link', 'set', 'lo', 'up']);
  if (!raised || raised.error || raised.status !== 0 || raised.signal) return { kind: 'blocked', reason: 'loopback-setup-unavailable' };
  const inventory = runIp(['-json', 'link', 'show']);
  if (!inventory || inventory.error || inventory.status !== 0 || inventory.signal || typeof inventory.stdout !== 'string') {
    return { kind: 'blocked', reason: 'network-interface-inventory-unavailable' };
  }
  let links;
  try { links = JSON.parse(inventory.stdout); }
  catch { return { kind: 'blocked', reason: 'network-interface-inventory-unavailable' }; }
  if (!Array.isArray(links) || links.length !== 1 || links[0]?.ifname !== 'lo'
    || !Array.isArray(links[0]?.flags) || !links[0].flags.includes('LOOPBACK') || !links[0].flags.includes('UP')) {
    return { kind: 'blocked', reason: 'network-not-loopback-only' };
  }
  let verifiedIdentity;
  try { verifiedIdentity = await currentNetworkNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-identity-unavailable' }; }
  let verifiedPidIdentity;
  try { verifiedPidIdentity = await currentPidNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-identity-unavailable' }; }
  if (verifiedIdentity !== namespaceIdentity || verifiedIdentity === parentNamespaceIdentity
    || verifiedPidIdentity !== pidNamespaceIdentity || verifiedPidIdentity === parentPidNamespaceIdentity || process.pid !== 1) {
    return { kind: 'blocked', reason: 'namespace-identity-unavailable' };
  }
  return { kind: 'ready', proof: Object.freeze({
    parentNamespaceIdentity,
    namespaceIdentity,
    parentPidNamespaceIdentity,
    pidNamespaceIdentity,
    interfaces: Object.freeze(['lo']),
  }) };
}

function processGroupExists(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

async function waitForGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  return !processGroupExists(pid);
}

async function stopGroup(child) {
  if (!child?.pid || !processGroupExists(child.pid)) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch { /* owned launcher already exited */ } }
  if (await waitForGroupExit(child.pid, 5_000)) return;
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* owned launcher already exited */ } }
  await waitForGroupExit(child.pid, 1_500);
}

export async function launchIsolatedNetworkNamespace({ command, args, env, timeoutMs }) {
  if (typeof command !== 'string' || command.length === 0 || !Array.isArray(args)
    || args.some(argument => typeof argument !== 'string' || /\0/u.test(argument))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    return { kind: 'blocked', reason: 'namespace-launch-failed' };
  }
  let parentNamespaceIdentity;
  try { parentNamespaceIdentity = await currentNetworkNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-launch-failed' }; }
  let parentPidNamespaceIdentity;
  try { parentPidNamespaceIdentity = await currentPidNamespaceIdentity(); }
  catch { return { kind: 'blocked', reason: 'namespace-launch-failed' }; }

  let namespaceHandle;
  let pidNamespaceHandle;
  try { namespaceHandle = await open('/proc/self/ns/net', 'r'); }
  catch { return { kind: 'blocked', reason: 'namespace-launch-failed' }; }
  try { pidNamespaceHandle = await open('/proc/self/ns/pid', 'r'); }
  catch { await namespaceHandle.close(); return { kind: 'blocked', reason: 'namespace-launch-failed' }; }
  try {
    const descriptorIdentity = await readlink(`/proc/self/fd/${namespaceHandle.fd}`);
    const pidDescriptorIdentity = await readlink(`/proc/self/fd/${pidNamespaceHandle.fd}`);
    if (descriptorIdentity !== parentNamespaceIdentity || pidDescriptorIdentity !== parentPidNamespaceIdentity) {
      await namespaceHandle.close();
      await pidNamespaceHandle.close();
      return { kind: 'blocked', reason: 'namespace-launch-failed' };
    }
  } catch {
    await namespaceHandle.close();
    await pidNamespaceHandle.close();
    return { kind: 'blocked', reason: 'namespace-launch-failed' };
  }
  let child;
  try {
    child = spawn('unshare', ['--user', '--map-current-user', '--keep-caps', '--net', '--pid', '--fork', '--kill-child', '--', command, ...args], {
      env: {
        ...env,
        LC_ALL: 'C',
        [ISOLATED_NETWORK_CHILD_ENV]: '1',
        [PARENT_NETWORK_NAMESPACE_ENV]: parentNamespaceIdentity,
        [PARENT_PID_NAMESPACE_ENV]: parentPidNamespaceIdentity,
      },
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', namespaceHandle.fd, pidNamespaceHandle.fd],
      windowsHide: true,
    });
  } catch {
    await namespaceHandle.close();
    await pidNamespaceHandle.close();
    return { kind: 'blocked', reason: 'namespace-launch-failed' };
  }
  let spawnErrorCode = null;
  let childClosed = false;
  let stderrStreamError = false;
  const stderrCapture = Buffer.alloc(UNSHARE_STDERR_CAPTURE_LIMIT);
  let stderrCaptureBytes = 0;
  let stderrCaptureTruncated = false;
  child.stderr?.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const copyBytes = Math.min(bytes.length, UNSHARE_STDERR_CAPTURE_LIMIT - stderrCaptureBytes);
    if (copyBytes > 0) {
      bytes.copy(stderrCapture, stderrCaptureBytes, 0, copyBytes);
      stderrCaptureBytes += copyBytes;
    }
    if (copyBytes < bytes.length) stderrCaptureTruncated = true;
  });
  child.stderr?.on('error', () => { stderrStreamError = true; });
  const closed = new Promise(resolvePromise => {
    child.once('close', (status, signal) => {
      childClosed = true;
      resolvePromise({ status, signal });
    });
    child.once('error', error => {
      spawnErrorCode = error?.code === 'ENOENT' ? 'unshare-unavailable' : 'namespace-launch-failed';
      resolvePromise({ status: null, signal: null });
    });
  });
  let timedOut = false;
  let cancelledBy = null;
  let timer;
  let cancelResolve;
  const cancelled = new Promise(resolvePromise => { cancelResolve = resolvePromise; });
  const onInterrupt = () => { cancelledBy = 'SIGINT'; cancelResolve({ status: null, signal: 'SIGINT' }); };
  const onTerminate = () => { cancelledBy = 'SIGTERM'; cancelResolve({ status: null, signal: 'SIGTERM' }); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    try {
      await namespaceHandle.close();
      await pidNamespaceHandle.close();
    } catch { return { kind: 'blocked', reason: 'namespace-launch-failed' }; }
    const timeout = new Promise(resolvePromise => {
      timer = setTimeout(() => { timedOut = true; resolvePromise({ status: null, signal: null }); }, timeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([closed, timeout, cancelled]);
    if (spawnErrorCode) return { kind: 'blocked', reason: spawnErrorCode };
    let startupDiagnostic;
    if (childClosed && !timedOut && !cancelledBy && result.signal === null
      && Number.isInteger(result.status) && result.status !== 0) {
      startupDiagnostic = makeStartupDiagnostic(
        stderrCapture.subarray(0, stderrCaptureBytes), stderrCaptureTruncated, stderrStreamError,
      );
      const startupRefusal = classifyUnshareStartupRefusal(startupDiagnostic);
      if (startupRefusal) return { kind: 'blocked', reason: startupRefusal, startupDiagnostic };
    }
    return {
      kind: 'exited', ...result, timedOut, cancelledBy, spawnErrorCode,
      parentNamespaceIdentity, parentPidNamespaceIdentity,
      ...(startupDiagnostic ? { startupDiagnostic } : {}),
    };
  } finally {
    stderrCapture.fill(0);
    clearTimeout(timer);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    await Promise.allSettled([namespaceHandle.close(), pidNamespaceHandle.close()]);
    await stopGroup(child);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await Promise.race([closed, new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))]);
    }
  }
}
