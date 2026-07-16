// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  _resetVaultForTests,
  classifyVaultDmSearchPrivacy,
  clearVault,
  importVault,
  saveMessages,
  type VaultExportSnapshot,
} from './historyVault';
import {
  VAULT_DM_PRIVACY_CACHE_CAP,
  _vaultDmPrivacyCacheSizeForTests,
  beginVaultDmPrivacyClear,
  captureVaultDmPrivacyEpoch,
  commitVaultDmSearchPrivacy,
  finishVaultDmPrivacyClear,
  getVaultDmSearchPrivacy,
  invalidateVaultDmSearchPrivacy,
} from './dmSearchPrivacy';

function message(id: string, encrypted = false): ChatMessage {
  return {
    id,
    from: 'Mika',
    text: encrypted ? 'TSUMUGI1 opaque-ciphertext' : 'ordinary line',
    target: 'Mika',
    type: 'msg',
    time: new Date('2026-07-16T08:00:00.000Z'),
    ...(encrypted ? { encrypted: true } : {}),
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  _resetVaultForTests();
});

describe('vault DM server-search privacy state', () => {
  it('invalidates a plain proof synchronously before an encrypted save commits', async () => {
    await saveMessages('Mika', [message('plain')]);
    expect(await classifyVaultDmSearchPrivacy('Mika')).toBe('plain');

    const saving = saveMessages('Mika', [message('cipher', true)]);
    expect(getVaultDmSearchPrivacy('Mika')).toBe('unknown');

    expect(await saving).toBe(true);
    expect(getVaultDmSearchPrivacy('Mika')).toBe('encrypted');
  });

  it('classifies imported encrypted rows and promotes targets only after a verified clear', async () => {
    expect(await classifyVaultDmSearchPrivacy('Mika')).toBe('plain');
    const snapshot: VaultExportSnapshot = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-16T08:00:00.000Z',
      targets: [{ target: 'Mika', messages: [message('imported-cipher', true)] }],
    };

    const importing = importVault(snapshot);
    expect(getVaultDmSearchPrivacy('Mika')).toBe('unknown');
    expect(await importing).toEqual({ targets: 1, messages: 1 });
    expect(getVaultDmSearchPrivacy('Mika')).toBe('encrypted');

    const clearing = clearVault();
    expect(getVaultDmSearchPrivacy('Mika')).toBe('unknown');
    expect(await clearing).toBe(true);
    expect(getVaultDmSearchPrivacy('Mika')).toBe('plain');
    expect(getVaultDmSearchPrivacy('UnseenPeer')).toBe('plain');
  });

  it('LRU-bounds private owner/target proofs and makes evicted entries unknown', () => {
    for (let index = 0; index < VAULT_DM_PRIVACY_CACHE_CAP; index += 1) {
      const target = `owner-and-target-${index}`;
      expect(commitVaultDmSearchPrivacy(captureVaultDmPrivacyEpoch(target), 'plain')).toBe(true);
    }
    expect(_vaultDmPrivacyCacheSizeForTests()).toBe(VAULT_DM_PRIVACY_CACHE_CAP);

    // Keep the first proof hot, so adding one more target evicts the second.
    expect(getVaultDmSearchPrivacy('owner-and-target-0')).toBe('plain');
    expect(commitVaultDmSearchPrivacy(
      captureVaultDmPrivacyEpoch('owner-and-target-new'),
      'plain',
    )).toBe(true);
    expect(_vaultDmPrivacyCacheSizeForTests()).toBe(VAULT_DM_PRIVACY_CACHE_CAP);
    expect(getVaultDmSearchPrivacy('owner-and-target-0')).toBe('plain');
    expect(getVaultDmSearchPrivacy('owner-and-target-1')).toBe('unknown');
  });

  it('invalidates an in-flight proof when bounded eviction changes the cache epoch', () => {
    const stale = captureVaultDmPrivacyEpoch('slow-scan');
    for (let index = 0; index <= VAULT_DM_PRIVACY_CACHE_CAP; index += 1) {
      const target = `other-target-${index}`;
      expect(commitVaultDmSearchPrivacy(captureVaultDmPrivacyEpoch(target), 'plain')).toBe(true);
    }

    expect(commitVaultDmSearchPrivacy(stale, 'plain')).toBe(false);
    expect(getVaultDmSearchPrivacy('slow-scan')).toBe('unknown');
  });

  it('does not reuse the verified-empty fallback after a tracked write and eviction', () => {
    const clearGeneration = beginVaultDmPrivacyClear();
    finishVaultDmPrivacyClear(clearGeneration, true);
    expect(getVaultDmSearchPrivacy('unseen-before-write')).toBe('plain');

    const encryptedTarget = 'owner-and-encrypted-target';
    const epoch = invalidateVaultDmSearchPrivacy(encryptedTarget);
    expect(commitVaultDmSearchPrivacy(epoch, 'encrypted')).toBe(true);
    for (let index = 0; index < VAULT_DM_PRIVACY_CACHE_CAP; index += 1) {
      const target = `post-write-target-${index}`;
      expect(commitVaultDmSearchPrivacy(captureVaultDmPrivacyEpoch(target), 'plain')).toBe(true);
    }

    expect(getVaultDmSearchPrivacy(encryptedTarget)).toBe('unknown');
  });
});
