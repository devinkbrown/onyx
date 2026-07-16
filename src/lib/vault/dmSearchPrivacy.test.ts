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
import { getVaultDmSearchPrivacy } from './dmSearchPrivacy';

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
});
