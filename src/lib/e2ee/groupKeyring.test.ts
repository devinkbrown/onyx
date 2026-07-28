// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MAX_ROOM_EPOCHS,
  RoomEpochKeyring,
  normalizeGroupRoom,
  validRoomEpoch,
} from './groupKeyring';

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
    expect(normalizeGroupRoom(' #Root ')).toBe('#root');
    expect(normalizeGroupRoom('')).toBeNull();
    expect(validRoomEpoch(7)).toBe(true);
    expect(validRoomEpoch(-1)).toBe(false);
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
    expect(ring.activeEpoch('#root')).toBe(MAX_ROOM_EPOCHS);

    ring.clearRoom('#root');
    expect(ring.get('#root', MAX_ROOM_EPOCHS)).toBeNull();
    expect(ring.activeEpoch('#root')).toBeNull();
    expect(ring.getActive('#root')).toBeNull();
  });

  it('evicts the numerically lowest epoch after out-of-order delivery', async () => {
    const ring = new RoomEpochKeyring();
    for (let epoch = 10; epoch < 10 + MAX_ROOM_EPOCHS; epoch += 1) {
      expect(ring.install('#root', epoch, await key(), `commit-${epoch}`)).toBe('installed');
    }
    expect(ring.install('#root', 2, await key(), 'commit-2')).toBe('installed');
    // Epoch 2 is installed then immediately dropped as the lowest when over capacity.
    expect(ring.get('#root', 2)).toBeNull();
    expect(ring.get('#root', 10)).not.toBeNull();
    expect(ring.get('#root', 10 + MAX_ROOM_EPOCHS - 1)).not.toBeNull();
    // Active remains the highest retained epoch (not demoted by failed low insert).
    expect(ring.activeEpoch('#root')).toBe(10 + MAX_ROOM_EPOCHS - 1);
  });

  it('tracks active epoch for local seal and refuses demotion on lower installs', async () => {
    const ring = new RoomEpochKeyring();
    const k1 = await key();
    const k2 = await key();
    const k3 = await key();

    expect(ring.activeEpoch('#root')).toBeNull();
    expect(ring.getActive('#root')).toBeNull();

    expect(ring.install('#root', 1, k1, 'commit-1')).toBe('installed');
    expect(ring.activeEpoch('#root')).toBe(1);
    expect(ring.getActive('#root')).toBe(k1);

    expect(ring.install('#root', 3, k3, 'commit-3')).toBe('installed');
    expect(ring.activeEpoch('#root')).toBe(3);
    expect(ring.getActive('#root')).toBe(k3);

    // Lower epoch retained for open, does not demote active seal pointer.
    expect(ring.install('#root', 2, k2, 'commit-2')).toBe('installed');
    expect(ring.get('#root', 2)).toBe(k2);
    expect(ring.activeEpoch('#root')).toBe(3);
    expect(ring.getActive('#root')).toBe(k3);

    // Explicit activate can select a retained older epoch for local seal.
    expect(ring.activate('#root', 2)).toBe(true);
    expect(ring.activeEpoch('#root')).toBe(2);
    expect(ring.getActive('#root')).toBe(k2);
    expect(ring.activate('#root', 99)).toBe(false);
    expect(ring.activeEpoch('#root')).toBe(2);
  });

  it('re-points active when the active epoch is evicted', async () => {
    const ring = new RoomEpochKeyring();
    // Fill with epochs 0..MAX-1 so active is MAX-1, then install a far-higher
    // epoch that forces eviction of the lowest while active stays high.
    for (let epoch = 0; epoch < MAX_ROOM_EPOCHS; epoch += 1) {
      expect(ring.install('#root', epoch, await key(), `commit-${epoch}`)).toBe('installed');
    }
    expect(ring.activeEpoch('#root')).toBe(MAX_ROOM_EPOCHS - 1);

    // Pin active to the lowest retained epoch, then install enough higher
    // epochs to evict it and force re-point.
    expect(ring.activate('#root', 0)).toBe(true);
    expect(ring.activeEpoch('#root')).toBe(0);
    for (let epoch = MAX_ROOM_EPOCHS; epoch < MAX_ROOM_EPOCHS + 2; epoch += 1) {
      expect(ring.install('#root', epoch, await key(), `commit-${epoch}`)).toBe('installed');
    }
    expect(ring.get('#root', 0)).toBeNull();
    expect(ring.get('#root', 1)).toBeNull();
    // Active must not stick to an evicted epoch.
    expect(ring.activeEpoch('#root')).not.toBe(0);
    expect(ring.activeEpoch('#root')).toBe(MAX_ROOM_EPOCHS + 1);
    expect(ring.getActive('#root')).not.toBeNull();
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
    expect(ring.activeEpoch('#root')).toBeNull();
  });
});
