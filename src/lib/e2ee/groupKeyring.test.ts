// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { MAX_ROOM_EPOCHS, RoomEpochKeyring } from './groupKeyring';

async function key(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

describe('RoomEpochKeyring', () => {
  it('looks up a normalized room epoch without persisting the secret', async () => {
    const ring = new RoomEpochKeyring();
    const roomKey = await key();

    expect(ring.install(' #Root ', 7, roomKey, 'commit-7')).toBe('installed');
    expect(ring.get('#root', 7)).toBe(roomKey);
    expect(ring.get('#root', 8)).toBeNull();
  });

  it('rejects a conflicting key for an already-known epoch', async () => {
    const ring = new RoomEpochKeyring();
    const first = await key();
    const second = await key();

    expect(ring.install('#root', 2, first, 'commit-2')).toBe('installed');
    expect(ring.install('#root', 2, first, 'commit-2')).toBe('unchanged');
    expect(ring.install('#root', 2, second, 'commit-2')).toBe('unchanged');
    expect(ring.install('#root', 2, second, 'different-commit')).toBe('conflict');
    expect(ring.get('#root', 2)).toBe(first);
  });

  it('bounds retained epochs and clears keys on request', async () => {
    const ring = new RoomEpochKeyring();
    for (let epoch = 0; epoch <= MAX_ROOM_EPOCHS; epoch += 1) {
      expect(ring.install('#root', epoch, await key(), `commit-${epoch}`)).toBe('installed');
    }
    expect(ring.get('#root', 0)).toBeNull();
    expect(ring.get('#root', MAX_ROOM_EPOCHS)).not.toBeNull();

    ring.clearRoom('#root');
    expect(ring.get('#root', MAX_ROOM_EPOCHS)).toBeNull();
  });

  it('evicts the numerically lowest epoch after out-of-order delivery', async () => {
    const ring = new RoomEpochKeyring();
    for (let epoch = 10; epoch < 10 + MAX_ROOM_EPOCHS; epoch += 1) {
      expect(ring.install('#root', epoch, await key(), `commit-${epoch}`)).toBe('installed');
    }
    expect(ring.install('#root', 2, await key(), 'commit-2')).toBe('installed');
    expect(ring.get('#root', 2)).toBeNull();
    expect(ring.get('#root', 10)).not.toBeNull();
    expect(ring.get('#root', 10 + MAX_ROOM_EPOCHS - 1)).not.toBeNull();
  });

  it('rejects extractable or incorrectly scoped keys and invalid authenticators', async () => {
    const ring = new RoomEpochKeyring();
    const extractable = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const encryptOnly = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    expect(ring.install('#root', 1, extractable, 'commit-1')).toBe('invalid');
    expect(ring.install('#root', 1, encryptOnly, 'commit-1')).toBe('invalid');
    expect(ring.install('#root', 1, await key(), 'bad id')).toBe('invalid');
  });
});
