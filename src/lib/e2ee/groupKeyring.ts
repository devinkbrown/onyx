// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral room-epoch key storage for Onyx v1 group encryption.
 *
 * This keyring deliberately never serializes CryptoKeys. The history vault
 * stores only ONYXROOM1 ciphertext; commits/welcomes may re-establish a room
 * epoch after a reload, but a device never writes a room secret to IndexedDB.
 * A later authenticated group-control-plane implementation owns key creation,
 * distribution, rotation, and recovery. This module owns only bounded,
 * fail-closed local lookup and the in-memory active-epoch pointer used for
 * local seal/open. It does not implement MLS/TreeKEM or interpret E2EEGROUP
 * control payloads.
 */

export const MAX_ROOM_EPOCHS = 8;
const MAX_ROOM_NAME_BYTES = 256;

export type InstallRoomEpochKeyResult = 'installed' | 'unchanged' | 'conflict' | 'invalid';
type RoomEpochEntry = { key: CryptoKey; authenticatedId: string };

type RoomState = {
  epochs: Map<number, RoomEpochEntry>;
  /** Epoch used for local seal when no explicit epoch is chosen. */
  activeEpoch: number | null;
};

/**
 * Canonical room name for keyring lookup and AES-GCM AAD binding.
 * Trim + lowercase; reject empty and oversized names.
 */
export function normalizeGroupRoom(room: string): string | null {
  const normalized = room.trim().toLowerCase();
  if (!normalized || new TextEncoder().encode(normalized).byteLength > MAX_ROOM_NAME_BYTES) {
    return null;
  }
  return normalized;
}

export function validRoomEpoch(epoch: number): boolean {
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

function highestEpoch(epochs: Map<number, RoomEpochEntry>): number | null {
  if (epochs.size === 0) return null;
  let max = -1;
  for (const epoch of epochs.keys()) {
    if (epoch > max) max = epoch;
  }
  return max < 0 ? null : max;
}

/**
 * Process-local keyring. A conflicting key for a known epoch is rejected: an
 * unverified control-plane update must not silently replace the key that opens
 * already authenticated room ciphertext.
 *
 * Active epoch advances only to a higher installed epoch (or the first one).
 * Lower-epoch installs remain available for open but do not demote seal.
 */
export class RoomEpochKeyring {
  private readonly rooms = new Map<string, RoomState>();

  install(
    room: string,
    epoch: number,
    key: CryptoKey,
    authenticatedId: string,
  ): InstallRoomEpochKeyResult {
    const normalized = normalizeGroupRoom(room);
    if (
      !normalized
      || !validRoomEpoch(epoch)
      || !validRoomKey(key)
      || !validAuthenticatedId(authenticatedId)
    ) {
      return 'invalid';
    }

    const state = this.rooms.get(normalized) ?? {
      epochs: new Map<number, RoomEpochEntry>(),
      activeEpoch: null as number | null,
    };
    const existing = state.epochs.get(epoch);
    if (existing) {
      return existing.authenticatedId === authenticatedId ? 'unchanged' : 'conflict';
    }

    state.epochs.set(epoch, { key, authenticatedId });
    while (state.epochs.size > MAX_ROOM_EPOCHS) {
      const lowest = Math.min(...state.epochs.keys());
      state.epochs.delete(lowest);
    }

    // Promote active when first key lands or a newer epoch is installed.
    if (state.activeEpoch === null || !state.epochs.has(state.activeEpoch) || epoch > state.activeEpoch) {
      const promoted = state.epochs.has(epoch)
        ? epoch
        : highestEpoch(state.epochs);
      state.activeEpoch = promoted;
    }
    // If eviction dropped the active epoch, re-point to highest retained.
    if (state.activeEpoch !== null && !state.epochs.has(state.activeEpoch)) {
      state.activeEpoch = highestEpoch(state.epochs);
    }

    this.rooms.set(normalized, state);
    return 'installed';
  }

  get(room: string, epoch: number): CryptoKey | null {
    const normalized = normalizeGroupRoom(room);
    if (!normalized || !validRoomEpoch(epoch)) return null;
    return this.rooms.get(normalized)?.epochs.get(epoch)?.key ?? null;
  }

  /** Active seal epoch for a room, or null when none is installed. */
  activeEpoch(room: string): number | null {
    const normalized = normalizeGroupRoom(room);
    if (!normalized) return null;
    return this.rooms.get(normalized)?.activeEpoch ?? null;
  }

  /** CryptoKey for the active seal epoch, or null. */
  getActive(room: string): CryptoKey | null {
    const normalized = normalizeGroupRoom(room);
    if (!normalized) return null;
    const state = this.rooms.get(normalized);
    if (!state || state.activeEpoch === null) return null;
    return state.epochs.get(state.activeEpoch)?.key ?? null;
  }

  /**
   * Explicitly select a retained epoch as active for local seal.
   * Returns false when the room/epoch is missing or invalid.
   */
  activate(room: string, epoch: number): boolean {
    const normalized = normalizeGroupRoom(room);
    if (!normalized || !validRoomEpoch(epoch)) return false;
    const state = this.rooms.get(normalized);
    if (!state || !state.epochs.has(epoch)) return false;
    state.activeEpoch = epoch;
    return true;
  }

  clearRoom(room: string): void {
    const normalized = normalizeGroupRoom(room);
    if (normalized) this.rooms.delete(normalized);
  }

  clear(): void {
    this.rooms.clear();
  }
}
