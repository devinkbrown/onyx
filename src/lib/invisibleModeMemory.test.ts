// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  INVISIBLE_MODE_STORAGE_KEY,
  loadInvisibleMode,
  saveInvisibleMode,
} from './invisibleModeMemory';

const endpoint = 'wss://invisible-memory.example/ws';
const alice = { serverUrl: endpoint, identity: 'alice' } as const;
const bob = { serverUrl: endpoint, identity: 'bob' } as const;
const guest = { serverUrl: endpoint, identity: 'guest42' } as const;
const aliceElsewhere = { serverUrl: 'wss://elsewhere.example/ws', identity: 'alice' } as const;

function storageKey(owner = alice): string {
  return deviceMemoryStorageKey(INVISIBLE_MODE_STORAGE_KEY, owner)!;
}

describe('account-scoped invisible mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('isolates exact endpoint+account/guest owners and purges ownerless legacy state', () => {
    localStorage.setItem(INVISIBLE_MODE_STORAGE_KEY, '1');

    expect(saveInvisibleMode(true, alice)).toBe(true);
    expect(saveInvisibleMode(false, bob)).toBe(false);
    expect(saveInvisibleMode(true, guest)).toBe(true);

    expect(loadInvisibleMode(alice)).toBe(true);
    expect(loadInvisibleMode(bob)).toBe(false);
    expect(loadInvisibleMode(guest)).toBe(true);
    expect(loadInvisibleMode(aliceElsewhere)).toBe(false);
    expect(localStorage.getItem(INVISIBLE_MODE_STORAGE_KEY)).toBeNull();
  });

  it('fails closed without an owner and for non-canonical stored values', () => {
    expect(saveInvisibleMode(true)).toBeNull();
    expect(loadInvisibleMode()).toBe(false);
    expect(localStorage.length).toBe(0);

    for (const hostile of ['0', 'true', 'yes', '11', '1'.repeat(65 * 1024)]) {
      localStorage.setItem(storageKey(), hostile);
      expect(loadInvisibleMode(alice)).toBe(false);
    }

    localStorage.setItem(storageKey(), '1');
    expect(loadInvisibleMode(alice)).toBe(true);
  });

  it('removes false values and reports storage failures', () => {
    expect(saveInvisibleMode(true, alice)).toBe(true);
    expect(localStorage.getItem(storageKey())).toBe('1');
    expect(saveInvisibleMode(false, alice)).toBe(false);
    expect(localStorage.getItem(storageKey())).toBeNull();

    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    expect(saveInvisibleMode(true, alice)).toBeNull();
  });
});
