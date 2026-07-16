// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PORTABLE_IMPORT_LOCK_NAME,
  PortableImportLockError,
  supportsPortableImportLock,
  withPortableImportLock,
} from './portableImportLock';

describe('portable import lock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves direct import behavior when Web Locks is unsupported', async () => {
    const operation = vi.fn().mockResolvedValue('imported');
    vi.stubGlobal('navigator', {});

    expect(supportsPortableImportLock()).toBe(false);
    await expect(withPortableImportLock(operation)).resolves.toEqual({
      state: 'completed',
      value: 'imported',
      coordinated: false,
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it('requests an origin-scoped exclusive lock without waiting', async () => {
    const lock = { name: PORTABLE_IMPORT_LOCK_NAME, mode: 'exclusive' } as Lock;
    const request = vi.fn(async (
      name: string,
      options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback(lock));
    const operation = vi.fn().mockResolvedValue('imported');
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(withPortableImportLock(operation)).resolves.toEqual({
      state: 'completed',
      value: 'imported',
      coordinated: true,
    });
    expect(request).toHaveBeenCalledWith(
      PORTABLE_IMPORT_LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(operation).toHaveBeenCalledOnce();
  });

  it('returns immediate contention without running the destructive operation', async () => {
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback(null));
    const operation = vi.fn();
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(withPortableImportLock(operation)).resolves.toEqual({ state: 'contended' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('distinguishes lock acquisition failure from an operation rejection', async () => {
    const requestFailure = vi.fn().mockRejectedValue(new Error('locks unavailable'));
    vi.stubGlobal('navigator', { locks: { request: requestFailure } });
    await expect(withPortableImportLock(vi.fn())).rejects.toBeInstanceOf(PortableImportLockError);

    const operationError = new Error('import failed');
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback({ name: PORTABLE_IMPORT_LOCK_NAME, mode: 'exclusive' } as Lock));
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(withPortableImportLock(vi.fn().mockRejectedValue(operationError))).rejects.toBe(operationError);
  });
});
