// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  emptyIdentityProfileMemory,
  IDENTITY_PROFILE_STORAGE_KEY,
  LEGACY_IDENTITY_PROFILE_STORAGE_KEYS,
  loadIdentityProfileMemory,
  MAX_CUSTOM_STATUS_LENGTH,
  MAX_IDENTITY_PROFILE_STORAGE_CHARS,
  MAX_SELF_BANNER_URL_LENGTH,
  saveIdentityProfileMemory,
} from './identityProfileMemory';

const alice = { serverUrl: 'wss://profile.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://profile.example/ws', identity: 'bob' } as const;

describe('account-scoped identity profile memory', () => {
  beforeEach(() => localStorage.clear());

  it('isolates owners and purges current and rebrand-era ownerless drafts', () => {
    localStorage.setItem(IDENTITY_PROFILE_STORAGE_KEY, JSON.stringify({ selfBio: 'legacy' }));
    for (const key of LEGACY_IDENTITY_PROFILE_STORAGE_KEYS) localStorage.setItem(key, 'legacy');

    expect(saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: ' Alice status ',
      selfBio: ' Alice bio ',
    }, alice)).toBe(true);
    expect(saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      selfBio: 'Bob bio',
    }, bob)).toBe(true);

    expect(loadIdentityProfileMemory(alice)).toMatchObject({ customStatus: 'Alice status', selfBio: 'Alice bio' });
    expect(loadIdentityProfileMemory(bob)).toMatchObject({ customStatus: '', selfBio: 'Bob bio' });
    expect(localStorage.getItem(IDENTITY_PROFILE_STORAGE_KEY)).toBeNull();
    for (const key of LEGACY_IDENTITY_PROFILE_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('bounds text, rejects control characters, and admits only credential-free HTTP banner URLs', () => {
    expect(saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: 'x'.repeat(MAX_CUSTOM_STATUS_LENGTH + 1),
      selfDisplayName: 'bad\nname',
      selfBio: 'valid bio',
      selfBannerUrl: 'javascript:alert(1)',
    }, alice)).toBe(true);

    expect(loadIdentityProfileMemory(alice)).toEqual({
      ...emptyIdentityProfileMemory(),
      selfBio: 'valid bio',
    });

    expect(saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      selfBannerUrl: `https://profile.example/${'x'.repeat(MAX_SELF_BANNER_URL_LENGTH)}`,
    }, alice)).toBe(true);
    expect(loadIdentityProfileMemory(alice).selfBannerUrl).toBe('');

    expect(saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      selfBannerUrl: 'https://user:secret@profile.example/banner.png',
    }, alice)).toBe(true);
    expect(loadIdentityProfileMemory(alice).selfBannerUrl).toBe('');
  });

  it('persists valid expiry and removes an empty owner namespace', () => {
    const key = deviceMemoryStorageKey(IDENTITY_PROFILE_STORAGE_KEY, alice)!;
    const expiry = new Date('2026-07-17T12:00:00.000Z');
    expect(saveIdentityProfileMemory({ ...emptyIdentityProfileMemory(), customStatusExpiry: expiry }, alice)).toBe(true);
    expect(loadIdentityProfileMemory(alice).customStatusExpiry).toEqual(expiry);

    expect(saveIdentityProfileMemory(emptyIdentityProfileMemory(), alice)).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('rejects oversized owner profile storage before parsing', () => {
    const key = deviceMemoryStorageKey(IDENTITY_PROFILE_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `{${'x'.repeat(MAX_IDENTITY_PROFILE_STORAGE_CHARS)}}`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadIdentityProfileMemory(alice)).toEqual(emptyIdentityProfileMemory());
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
});
