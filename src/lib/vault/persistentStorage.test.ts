// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readVaultPersistence,
  requestVaultPersistence,
  supportsVaultPersistenceRequest,
} from './persistentStorage';

describe('persistent vault storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('progressively reports unsupported without attempting a request', async () => {
    vi.stubGlobal('navigator', { storage: {} });

    expect(supportsVaultPersistenceRequest()).toBe(false);
    await expect(readVaultPersistence()).resolves.toMatchObject({ state: 'unsupported' });
    await expect(requestVaultPersistence()).resolves.toMatchObject({ state: 'unsupported' });
  });

  it('reads persisted state without invoking the user-initiated request', async () => {
    const persisted = vi.fn().mockResolvedValue(true);
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persisted, persist } });

    await expect(readVaultPersistence()).resolves.toMatchObject({ state: 'persisted' });
    expect(persisted).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });

  it('distinguishes a granted request from browser denial', async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(false), persist },
    });

    await expect(requestVaultPersistence()).resolves.toMatchObject({ state: 'granted' });
    await expect(requestVaultPersistence()).resolves.toMatchObject({ state: 'denied' });
  });

  it('returns truthful error states when either browser operation rejects', async () => {
    const persisted = vi.fn().mockRejectedValue(new Error('blocked read'));
    const persist = vi.fn().mockRejectedValue(new Error('blocked request'));
    vi.stubGlobal('navigator', { storage: { persisted, persist } });

    await expect(readVaultPersistence()).resolves.toMatchObject({ state: 'error' });
    await expect(requestVaultPersistence()).resolves.toMatchObject({ state: 'error' });
  });
});
