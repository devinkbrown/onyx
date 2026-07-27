// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral room-epoch key storage for Onyx v1 group encryption.
 *
 * This keyring deliberately never serializes CryptoKeys. The history vault
 * stores only ONYXROOM1 ciphertext; commits/welcomes may re-establish a room
 * epoch after a reload, but a device never writes a room secret to IndexedDB.
 * A later authenticated group-control-plane implementation owns key creation,
 * distribution, rotation, and recovery. This module owns only bounded,
 * fail-closed local lookup.
 */

export const MAX_ROOM_EPOCHS = 8;
const MAX_ROOM_NAME_BYTES = 256;

export type InstallRoomEpochKeyResult = 'installed' | 'unchanged' | 'conflict' | 'invalid';
type RoomEpochEntry = { key: CryptoKey; authenticatedId: string };

function roomKey(room: string): string | null {
  const normalized = room.trim().toLowerCase();
  if (!normalized || new TextEncoder().encode(normalized).byteLength > MAX_ROOM_NAME_BYTES) {
    return null;
  }
  return normalized;
}

function validEpoch(epoch: number): boolean {
  return Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffffffff;
}

function validAuthenticatedId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validRoomKey(key: CryptoKey): boolean {
  return key.type === 'secret'
    && key.algorithm.name === 'AES-GCM'
    && !key.extractable
    && key.usages.includes('encrypt')
    && key.usages.includes('decrypt');
}

/**
 * Process-local keyring. A conflicting key for a known epoch is rejected: an
 * unverified control-plane update must not silently replace the key that opens
 * already authenticated room ciphertext.
 */
export class RoomEpochKeyring {
  private readonly rooms = new Map<string, Map<number, RoomEpochEntry>>();

  install(
    room: string,
    epoch: number,
    key: CryptoKey,
    authenticatedId: string,
  ): InstallRoomEpochKeyResult {
    const normalized = roomKey(room);
    if (
      !normalized
      || !validEpoch(epoch)
      || !validRoomKey(key)
      || !validAuthenticatedId(authenticatedId)
    ) {
      return 'invalid';
    }

    const epochs = this.rooms.get(normalized) ?? new Map<number, RoomEpochEntry>();
    const existing = epochs.get(epoch);
    if (existing) return existing.authenticatedId === authenticatedId ? 'unchanged' : 'conflict';

    epochs.set(epoch, { key, authenticatedId });
    while (epochs.size > MAX_ROOM_EPOCHS) {
      const lowest = Math.min(...epochs.keys());
      epochs.delete(lowest);
    }
    this.rooms.set(normalized, epochs);
    return 'installed';
  }

  get(room: string, epoch: number): CryptoKey | null {
    const normalized = roomKey(room);
    if (!normalized || !validEpoch(epoch)) return null;
    return this.rooms.get(normalized)?.get(epoch)?.key ?? null;
  }

  clearRoom(room: string): void {
    const normalized = roomKey(room);
    if (normalized) this.rooms.delete(normalized);
  }

  clear(): void {
    this.rooms.clear();
  }
}
