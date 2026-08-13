// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  FALLBACK_ZIG_VERSION,
  PREFERRED_ZIG_VERSION,
  SUPPORTED_ZIG_LINE,
  exitCodeFromChild,
  formatZigGateError,
  isSupportedZigVersion,
  loadPreferredZigVersion,
  parseZigVersionOutput,
  probeZigVersion,
  resolveZigBinary,
  runDesktopZig,
} from './desktop-zig.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXACT_PIN = '0.17.0-dev.1476+91a29d707';
const NATIVE_SDK_PATCH = readFileSync(
  resolve(REPO_ROOT, 'patches/@native-sdk__cli@0.6.2.patch'),
  'utf8',
);

describe('desktop-zig version policy', () => {
  it('loads exact pin from .zigversion and matches fallback constant', () => {
    const fromFile = readFileSync(resolve(REPO_ROOT, '.zigversion'), 'utf8').trim();
    expect(fromFile).toBe(EXACT_PIN);
    expect(FALLBACK_ZIG_VERSION).toBe(EXACT_PIN);
    expect(PREFERRED_ZIG_VERSION).toBe(EXACT_PIN);
    expect(loadPreferredZigVersion(REPO_ROOT)).toBe(EXACT_PIN);
    expect(SUPPORTED_ZIG_LINE).toBe('0.17');
  });

  it('accepts only the exact pin; rejects other 0.17.0-dev snapshots and 0.16', () => {
    expect(isSupportedZigVersion('0.17.0-dev.1476+91a29d707')).toBe(true);
    expect(isSupportedZigVersion(' 0.17.0-dev.1476+91a29d707\n')).toBe(true);
    // Older/newer 0.17.0-dev builds must not pass the gate.
    expect(isSupportedZigVersion('0.17.0-dev.1282+c0f9b51d8')).toBe(false);
    expect(isSupportedZigVersion('0.17.0-dev.9999+deadbeef0')).toBe(false);
    expect(isSupportedZigVersion('0.16.0')).toBe(false);
    expect(isSupportedZigVersion('0.16.1')).toBe(false);
    expect(isSupportedZigVersion('0.17.0')).toBe(false);
    expect(isSupportedZigVersion('0.15.2')).toBe(false);
    expect(isSupportedZigVersion('')).toBe(false);
  });

  it('parses the first non-empty version line', () => {
    expect(parseZigVersionOutput('0.17.0-dev.1476+91a29d707\n')).toBe(
      '0.17.0-dev.1476+91a29d707',
    );
    expect(parseZigVersionOutput('\n  0.17.0-dev.1476+91a29d707  \nextra\n')).toBe(
      '0.17.0-dev.1476+91a29d707',
    );
    expect(parseZigVersionOutput('')).toBe('');
  });
});

describe('Native SDK packaged SPA patch', () => {
  it('loads the configured entry through the zero origin root for SPA routers', () => {
    expect(NATIVE_SDK_PATCH).toContain(
      '-        char *uri = g_strdup_printf("%s/%s", origin, entry);',
    );
    expect(NATIVE_SDK_PATCH).toContain(
      '+        char *uri = g_strdup_printf("%s/", origin);',
    );
  });
});

describe('desktop-zig resolution', () => {
  it('prefers non-empty ONYX_ZIG over PATH zig', () => {
    expect(resolveZigBinary({ ONYX_ZIG: '/opt/zig-0.17/zig' })).toBe('/opt/zig-0.17/zig');
    expect(resolveZigBinary({ ONYX_ZIG: '  /tmp/zig  ' })).toBe('/tmp/zig');
    expect(resolveZigBinary({ ONYX_ZIG: '   ' })).toBe('zig');
    expect(resolveZigBinary({})).toBe('zig');
    expect(resolveZigBinary({ ONYX_ZIG: undefined })).toBe('zig');
  });
});

describe('desktop-zig errors', () => {
  it('mentions ONYX_ZIG and docs without promising auto-install', () => {
    const missing = formatZigGateError({ binary: 'zig', kind: 'missing' });
    expect(missing).toMatch(/ONYX_ZIG/);
    expect(missing).toMatch(/desktop-host\.md/);
    expect(missing).toMatch(/does not download/);
    expect(missing).not.toMatch(/curl|wget|install zig automatically/i);

    const bad = formatZigGateError({
      binary: '/usr/local/bin/zig',
      kind: 'unsupported',
      version: '0.16.0',
    });
    expect(bad).toMatch(/0\.16\.0/);
    expect(bad).toMatch(/0\.17\.0-dev\.1476\+91a29d707/);
    expect(bad).toMatch(/exactly Zig/);

    const otherDev = formatZigGateError({
      binary: 'zig',
      kind: 'unsupported',
      version: '0.17.0-dev.1282+c0f9b51d8',
    });
    expect(otherDev).toMatch(/0\.17\.0-dev\.1282\+c0f9b51d8/);
    expect(otherDev).toMatch(/0\.17\.0-dev\.1476\+91a29d707/);
    expect(otherDev).toMatch(/Other 0\.17\.0-dev snapshots are not accepted/);
  });
});

describe('desktop-zig probe', () => {
  it('accepts a supported version from spawnSync stdout', () => {
    const probe = probeZigVersion('/pin/zig', {
      spawnSyncImpl: () => ({
        status: 0,
        signal: null,
        stdout: '0.17.0-dev.1476+91a29d707\n',
        stderr: '',
        error: undefined,
      }),
    });
    expect(probe).toEqual({ ok: true, version: '0.17.0-dev.1476+91a29d707' });
  });

  it('rejects unsupported versions including other 0.17.0-dev snapshots', () => {
    const probe16 = probeZigVersion('zig', {
      spawnSyncImpl: () => ({
        status: 0,
        signal: null,
        stdout: '0.16.0\n',
        stderr: '',
        error: undefined,
      }),
    });
    expect(probe16.ok).toBe(false);
    if (!probe16.ok) {
      expect(probe16.kind).toBe('unsupported');
      expect(probe16.version).toBe('0.16.0');
    }

    const probeOtherDev = probeZigVersion('zig', {
      spawnSyncImpl: () => ({
        status: 0,
        signal: null,
        stdout: '0.17.0-dev.1282+c0f9b51d8\n',
        stderr: '',
        error: undefined,
      }),
    });
    expect(probeOtherDev.ok).toBe(false);
    if (!probeOtherDev.ok) {
      expect(probeOtherDev.kind).toBe('unsupported');
      expect(probeOtherDev.version).toBe('0.17.0-dev.1282+c0f9b51d8');
    }
  });

  it('maps ENOENT to missing', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const probe = probeZigVersion('zig', {
      spawnSyncImpl: () => ({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: err,
      }),
    });
    expect(probe).toMatchObject({ ok: false, kind: 'missing' });
  });
});

describe('desktop-zig exit / spawn gate', () => {
  it('maps signal deaths to 128+signo when available', () => {
    const code = exitCodeFromChild(null, 'SIGTERM');
    expect(code).toBeGreaterThanOrEqual(128);
    expect(exitCodeFromChild(0, null)).toBe(0);
    expect(exitCodeFromChild(3, null)).toBe(3);
    expect(exitCodeFromChild(null, null)).toBe(1);
  });

  it('does not spawn zig when the version gate fails', async () => {
    const spawnImpl = vi.fn();
    const chunks = [];
    const stderr = { write: (s) => { chunks.push(String(s)); } };

    const code = await runDesktopZig(['build', '-Dplatform=null'], {
      env: { ONYX_ZIG: '/no/such/zig' },
      spawnImpl,
      spawnSyncImpl: () => ({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('enoent'), { code: 'ENOENT' }),
      }),
      stderr,
    });

    expect(code).toBe(127);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(chunks.join('')).toMatch(/not found|Zig not found/i);
  });

  it('forwards args with shell disabled after a green version probe', async () => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn();

    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    const pin = '/opt/zig-0.17.0-dev/zig';
    const code = await runDesktopZig(['build', 'test', '-Dplatform=null'], {
      env: { ONYX_ZIG: pin },
      spawnImpl,
      spawnSyncImpl: () => ({
        status: 0,
        signal: null,
        stdout: '0.17.0-dev.1476+91a29d707\n',
        stderr: '',
        error: undefined,
      }),
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawnImpl.mock.calls[0];
    expect(bin).toBe(pin);
    expect(args).toEqual(['build', 'test', '-Dplatform=null']);
    expect(options.shell).toBe(false);
    expect(options.stdio).toBe('inherit');
  });
});
