// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import type { ChatMessage } from '@/lib/irc/types';
import {
  DM_PINS_STORAGE_KEY,
  clearDeviceDMPins,
  loadDMPins,
  saveDMPins,
} from './dmPins';

const alice = { serverUrl: 'wss://pins.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://pins.example/ws', identity: 'bob' } as const;

function encryptedPin(id: string, plaintext: string): ChatMessage {
  return {
    id,
    time: new Date('2026-07-16T12:00:00.000Z'),
    from: 'trev',
    text: `TSUMUGI1 ${id}-ciphertext`,
    plaintext,
    encrypted: true,
    type: 'msg',
    target: 'alice',
    replyTo: { id: 'reply', from: 'trev', text: 'decrypted reply preview' },
  };
}

describe('account-scoped DM pins', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates Alice and Bob while purging the unsafe ownerless journal', () => {
    localStorage.setItem(DM_PINS_STORAGE_KEY, JSON.stringify({
      trev: [encryptedPin('legacy', 'legacy decrypted plaintext')],
    }));
    expect(saveDMPins(new Map([['trev', [encryptedPin('alice', 'Alice decrypted plaintext')]]]), alice))
      .toBe(true);
    expect(saveDMPins(new Map([['trev', [encryptedPin('bob', 'Bob decrypted plaintext')]]]), bob))
      .toBe(true);

    expect([...loadDMPins(alice).values()].flat().map((message) => message.id)).toEqual(['alice']);
    expect([...loadDMPins(bob).values()].flat().map((message) => message.id)).toEqual(['bob']);
    expect(localStorage.getItem(DM_PINS_STORAGE_KEY)).toBeNull();
  });

  it('never persists decrypted bodies or encrypted reply previews', () => {
    expect(saveDMPins(new Map([['trev', [encryptedPin('alice', 'Alice decrypted plaintext')]]]), alice))
      .toBe(true);
    const key = deviceMemoryStorageKey(DM_PINS_STORAGE_KEY, alice)!;
    const raw = localStorage.getItem(key) ?? '';

    expect(raw).toContain('alice-ciphertext');
    expect(raw).not.toContain('Alice decrypted plaintext');
    expect(raw).not.toContain('decrypted reply preview');
    expect([...loadDMPins(alice).values()].flat()[0]).not.toHaveProperty('plaintext');
  });

  it('clears every owner scope without touching adjacent keys', () => {
    saveDMPins(new Map([['trev', [encryptedPin('alice', 'Alice')]]]), alice);
    saveDMPins(new Map([['trev', [encryptedPin('bob', 'Bob')]]]), bob);
    localStorage.setItem(`${DM_PINS_STORAGE_KEY}:adjacent`, 'keep');

    expect(clearDeviceDMPins()).toBe(true);
    expect(loadDMPins(alice)).toEqual(new Map());
    expect(loadDMPins(bob)).toEqual(new Map());
    expect(localStorage.getItem(`${DM_PINS_STORAGE_KEY}:adjacent`)).toBe('keep');
  });

  it('does not claim a device clear when one owner journal is retained', () => {
    saveDMPins(new Map([['trev', [encryptedPin('alice', 'Alice')]]]), alice);
    const aliceKey = deviceMemoryStorageKey(DM_PINS_STORAGE_KEY, alice)!;
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === aliceKey) throw new DOMException('blocked');
      removeItem(key);
    });

    expect(clearDeviceDMPins()).toBe(false);
    expect([...loadDMPins(alice).values()].flat().map((message) => message.id)).toEqual(['alice']);
  });
});
