// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sharePortableVaultJson, supportsPortableFileShare } from './portableShare';

describe('portable vault file sharing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('progressively reports unsupported without materializing or sharing a file', async () => {
    vi.stubGlobal('navigator', {});

    expect(supportsPortableFileShare()).toBe(false);
    await expect(sharePortableVaultJson('{}')).resolves.toMatchObject({ state: 'unsupported' });
  });

  it('confirms and shares the exact same safe JSON File', async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare, share });

    await expect(sharePortableVaultJson('{"kind":"onyx-vault"}', {
      now: new Date('2026-07-16T12:00:00.000Z'),
    })).resolves.toMatchObject({ state: 'shared' });

    const confirmed = canShare.mock.calls[0]?.[0] as ShareData;
    const shared = share.mock.calls[0]?.[0] as ShareData;
    const file = confirmed.files?.[0];
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('onyx-portable-2026-07-16.json');
    expect(file?.type).toBe('application/json');
    expect(confirmed.title).toBeUndefined();
    expect(shared.files?.[0]).toBe(file);
    expect(shared.title).toBe('Onyx portable vault');
  });

  it('does not invoke share unless canShare confirms the generated file', async () => {
    const canShare = vi.fn().mockReturnValue(false);
    const share = vi.fn();
    vi.stubGlobal('navigator', { canShare, share });

    await expect(sharePortableVaultJson('{}')).resolves.toMatchObject({ state: 'unsupported' });
    expect(canShare).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();
  });

  it('bounds UTF-8 bytes before constructing a share payload', async () => {
    const canShare = vi.fn();
    const share = vi.fn();
    vi.stubGlobal('navigator', { canShare, share });

    await expect(sharePortableVaultJson('石石石', { maxJsonBytes: 8 })).resolves.toMatchObject({
      state: 'too-large',
    });
    expect(canShare).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('distinguishes user cancellation from a rejected share', async () => {
    const share = vi.fn()
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    vi.stubGlobal('navigator', { canShare: vi.fn().mockReturnValue(true), share });

    await expect(sharePortableVaultJson('{}')).resolves.toMatchObject({ state: 'cancelled' });
    await expect(sharePortableVaultJson('{}')).resolves.toMatchObject({ state: 'rejected' });
  });
});
