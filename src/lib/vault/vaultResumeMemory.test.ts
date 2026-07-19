// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  VAULT_RESUME_STORAGE_KEY,
  loadVaultResumeTarget,
  normalizeVaultResumeTarget,
  saveVaultResumeTarget,
} from './vaultResumeMemory';

const ALICE = { serverUrl: 'wss://memory.example/ws', identity: 'alice' } as const;
const BOB = { serverUrl: 'wss://memory.example/ws', identity: 'bob' } as const;

describe('vault resume memory', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a bounded owner-scoped conversation target', () => {
    expect(saveVaultResumeTarget({ kind: 'channel', target: '#General' }, ALICE)).toBe(true);

    expect(loadVaultResumeTarget(ALICE)).toEqual({ kind: 'channel', target: '#general' });
    expect(loadVaultResumeTarget(BOB)).toBeNull();
    expect(localStorage.getItem(VAULT_RESUME_STORAGE_KEY)).toBeNull();
  });

  it('fails closed on malformed or mismatched target kinds', () => {
    expect(saveVaultResumeTarget({ kind: 'channel', target: 'alice' }, ALICE)).toBe(false);
    expect(saveVaultResumeTarget({ kind: 'dm', target: '#private' }, ALICE)).toBe(false);
    expect(saveVaultResumeTarget({ kind: 'dm', target: 'bad nick' }, ALICE)).toBe(false);
    expect(loadVaultResumeTarget(ALICE)).toBeNull();
  });

  it('rejects oversized or control-character targets at the normalize boundary', () => {
    expect(normalizeVaultResumeTarget({ kind: 'channel', target: `#${'a'.repeat(512)}` })).toBeNull();
    expect(normalizeVaultResumeTarget({ kind: 'channel', target: '#evil\nroom' })).toBeNull();
    expect(normalizeVaultResumeTarget({ kind: 'dm', target: 'trev,alias' })).toBeNull();
    expect(normalizeVaultResumeTarget({ kind: 'channel', target: '#ok' })).toEqual({
      kind: 'channel',
      target: '#ok',
    });
  });

  it('fails closed on corrupt or non-object resume storage without throwing', () => {
    const key = deviceMemoryStorageKey(VAULT_RESUME_STORAGE_KEY, ALICE);
    expect(key).toBeTruthy();

    localStorage.setItem(key!, '{not-json');
    expect(loadVaultResumeTarget(ALICE)).toBeNull();

    localStorage.setItem(key!, JSON.stringify({ kind: 'channel', target: 12 }));
    expect(loadVaultResumeTarget(ALICE)).toBeNull();

    localStorage.setItem(key!, JSON.stringify({ kind: 'status', target: '#ok' }));
    expect(loadVaultResumeTarget(ALICE)).toBeNull();
  });
});
