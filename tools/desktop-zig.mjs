// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Resolve and gate the Zig compiler used by package desktop:* scripts.
 *
 * Native SDK 0.6.2 + this tree's build.zig target Zig 0.17 build APIs
 * (graph.release_mode, pathFromRoot via root.joinString, local sysroot,
 * PATH-based Run path dirs). Official pin is the exact contents of
 * `.zigversion` (currently 0.17.0-dev.1476+91a29d707). This wrapper never
 * downloads Zig and accepts only that exact version string — not older or
 * newer 0.17.0-dev snapshots.
 *
 * Resolution: ONYX_ZIG (exact path) if set, else `zig` from PATH.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fallback if `.zigversion` is missing/unreadable. Must stay identical to the
 * checked-in pin; tests cross-check both.
 */
export const FALLBACK_ZIG_VERSION = '0.17.0-dev.1476+91a29d707';

/** Supported major.minor line (documentation / error context only). */
export const SUPPORTED_ZIG_LINE = '0.17';

/**
 * First non-empty line of `zig version` stdout or `.zigversion` file text.
 * @param {string} stdout
 * @returns {string}
 */
export function parseZigVersionOutput(stdout) {
  const text = String(stdout ?? '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Exact required Zig version: first non-empty line of repo `.zigversion`.
 * @param {string} [root] repo root (default: parent of tools/)
 * @returns {string}
 */
export function loadPreferredZigVersion(root = REPO_ROOT) {
  try {
    const pin = parseZigVersionOutput(readFileSync(join(root, '.zigversion'), 'utf8'));
    if (pin) return pin;
  } catch {
    // missing/unreadable — fall through to compile-time fallback constant
  }
  return FALLBACK_ZIG_VERSION;
}

/** Exact pin from `.zigversion` (source of truth when present). */
export const PREFERRED_ZIG_VERSION = loadPreferredZigVersion();

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Executable path or bare `zig` for PATH lookup
 */
export function resolveZigBinary(env = process.env) {
  const pinned = typeof env.ONYX_ZIG === 'string' ? env.ONYX_ZIG.trim() : '';
  if (pinned) return pinned;
  return 'zig';
}

/**
 * Accept only the exact preferred pin (`.zigversion` / PREFERRED_ZIG_VERSION).
 * Rejects other 0.17.0-dev snapshots, stable 0.17.0, 0.16.x, empty, etc.
 * @param {string} version
 * @param {string} [preferred]
 * @returns {boolean}
 */
export function isSupportedZigVersion(version, preferred = PREFERRED_ZIG_VERSION) {
  return String(version ?? '').trim() === preferred;
}

/**
 * Concise, actionable error for missing or wrong Zig.
 * @param {{ binary: string, version?: string | null, kind: 'missing' | 'version-failed' | 'unsupported' }} opts
 * @returns {string}
 */
export function formatZigGateError(opts) {
  const binary = opts.binary;
  const via = binary === 'zig' ? 'PATH (`zig`)' : `ONYX_ZIG / path (${binary})`;
  const pin = `exactly Zig ${PREFERRED_ZIG_VERSION}`;
  const footer =
    'Set ONYX_ZIG to that exact official Zig binary (see .zigversion), or put that ' +
    'compiler first on PATH. Other 0.17.0-dev snapshots are not accepted. ' +
    'This wrapper does not download or install Zig. See docs/desktop-host.md.';

  if (opts.kind === 'missing') {
    return `desktop-zig: Zig not found via ${via}. Desktop host requires ${pin}.\n${footer}`;
  }
  if (opts.kind === 'version-failed') {
    return (
      `desktop-zig: could not run \`${binary} version\` (exit/signal failure). ` +
      `Desktop host requires ${pin}.\n${footer}`
    );
  }
  const found = opts.version ? opts.version : '(empty version output)';
  return (
    `desktop-zig: incompatible Zig ${found} via ${via}. ` +
    `Desktop host requires ${pin} (Native SDK 0.6.2 + 0.17 build graph; ` +
    `only the .zigversion pin is accepted).\n` +
    footer
  );
}

/**
 * Run `binary version` without a shell; return structured result.
 * @param {string} binary
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 * @returns {{ ok: true, version: string } | { ok: false, kind: 'missing' | 'version-failed' | 'unsupported', version?: string, error?: Error }}
 */
export function probeZigVersion(binary, opts = {}) {
  const run = opts.spawnSyncImpl ?? spawnSync;
  let result;
  try {
    result = run(binary, ['version'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { ok: false, kind: 'missing', error: err };
    }
    return { ok: false, kind: 'version-failed', error: err };
  }

  if (result.error) {
    if (/** @type {NodeJS.ErrnoException} */ (result.error).code === 'ENOENT') {
      return { ok: false, kind: 'missing', error: result.error };
    }
    return { ok: false, kind: 'version-failed', error: result.error };
  }
  if (result.status !== 0 || result.signal) {
    return { ok: false, kind: 'version-failed' };
  }

  const version = parseZigVersionOutput(result.stdout ?? '');
  if (!isSupportedZigVersion(version)) {
    return { ok: false, kind: 'unsupported', version };
  }
  return { ok: true, version };
}

/**
 * Exit code for a child closed by signal (128 + signo), or status, or 1.
 * @param {number | null} code
 * @param {NodeJS.Signals | null} signal
 * @returns {number}
 */
export function exitCodeFromChild(code, signal) {
  if (signal) {
    const map = osConstants.signals;
    const num = map && typeof map[signal] === 'number' ? map[signal] : null;
    return num != null ? 128 + num : 1;
  }
  return code == null ? 1 : code;
}

/**
 * Gate version then spawn Zig with inherited stdio, no shell, faithful exit.
 * @param {string[]} zigArgs args after the binary (e.g. ['build', '-Dplatform=null'])
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   spawnImpl?: typeof spawn,
 *   spawnSyncImpl?: typeof spawnSync,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 * }} [opts]
 * @returns {Promise<number>} process exit code to use
 */
export function runDesktopZig(zigArgs, opts = {}) {
  const env = opts.env ?? process.env;
  const binary = resolveZigBinary(env);
  const probe = probeZigVersion(binary, { spawnSyncImpl: opts.spawnSyncImpl });
  const errOut = opts.stderr ?? process.stderr;

  if (!probe.ok) {
    errOut.write(formatZigGateError({ binary, kind: probe.kind, version: probe.version }) + '\n');
    return Promise.resolve(probe.kind === 'missing' ? 127 : 1);
  }

  const spawnImpl = opts.spawnImpl ?? spawn;
  return new Promise((resolvePromise) => {
    const child = spawnImpl(binary, zigArgs, {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env,
    });

    const forward = (signal) => {
      if (!child.killed) {
        try {
          child.kill(signal);
        } catch {
          // ignore races if the child already exited
        }
      }
    };

    const onSigInt = () => forward('SIGINT');
    const onSigTerm = () => forward('SIGTERM');
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);

    const cleanup = () => {
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
    };

    child.on('error', (error) => {
      cleanup();
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
        errOut.write(formatZigGateError({ binary, kind: 'missing' }) + '\n');
        resolvePromise(127);
        return;
      }
      errOut.write(
        `desktop-zig: failed to spawn ${binary}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      resolvePromise(1);
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolvePromise(exitCodeFromChild(code, signal));
    });
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const code = await runDesktopZig(process.argv.slice(2));
  process.exit(code);
}
