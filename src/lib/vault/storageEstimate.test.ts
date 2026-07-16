// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatOriginStorageBytes, readOriginStorageEstimate } from './storageEstimate';

describe('origin storage estimate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats coarse bounded values without unsafe or false precision', () => {
    expect(formatOriginStorageBytes(0)).toBe('0 B');
    expect(formatOriginStorageBytes(512_000)).toBe('< 1 MiB');
    expect(formatOriginStorageBytes(12.4 * 1024 * 1024)).toBe('12 MiB');
    expect(formatOriginStorageBytes(1.46 * 1024 * 1024 * 1024)).toBe('1.5 GiB');
    expect(formatOriginStorageBytes(Number.MAX_VALUE)).toBe('8 PiB');
    expect(formatOriginStorageBytes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatOriginStorageBytes(-1)).toBeNull();
    expect(formatOriginStorageBytes('1024')).toBeNull();
  });

  it('reports a complete estimate as origin-wide rather than vault-only', async () => {
    const estimate = vi.fn().mockResolvedValue({
      usage: 12 * 1024 * 1024,
      quota: 2 * 1024 * 1024 * 1024,
    });
    vi.stubGlobal('navigator', { storage: { estimate } });

    await expect(readOriginStorageEstimate()).resolves.toEqual({
      state: 'available',
      usage: '12 MiB',
      quota: '2 GiB',
      detail: expect.stringMatching(/origin-wide storage, not vault-only/i),
    });
    expect(estimate).toHaveBeenCalledOnce();
  });

  it('keeps partial estimates truthful when one field is missing', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockResolvedValue({ usage: 3 * 1024 * 1024 }) },
    });

    await expect(readOriginStorageEstimate()).resolves.toMatchObject({
      state: 'partial',
      usage: '3 MiB',
      quota: null,
      detail: expect.stringMatching(/quota was not reported/i),
    });
  });

  it('progressively reports an unsupported estimate API', async () => {
    vi.stubGlobal('navigator', { storage: {} });

    await expect(readOriginStorageEstimate()).resolves.toMatchObject({
      state: 'unsupported',
      usage: null,
      quota: null,
    });
  });

  it('returns error state for rejection or unusable browser values', async () => {
    const estimate = vi.fn()
      .mockRejectedValueOnce(new Error('private mode'))
      .mockResolvedValueOnce({ usage: Number.NaN, quota: -1 });
    vi.stubGlobal('navigator', { storage: { estimate } });

    await expect(readOriginStorageEstimate()).resolves.toMatchObject({ state: 'error' });
    await expect(readOriginStorageEstimate()).resolves.toMatchObject({ state: 'error' });
  });
});
